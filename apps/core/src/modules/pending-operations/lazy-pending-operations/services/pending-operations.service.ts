import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { Condition, transaction } from "dynamoose";
import { plainToInstance } from "class-transformer";
import { InjectModel, Model } from "nestjs-dynamoose";
import { v4 as uuidv4 } from "uuid";
import { RocketNotificationDto } from "../../../../commons/dtos/rocket-notification.dto";
import { toDynamooseUpdate } from "../../../../commons/persistence/removable-update.helper";
import { isTransactionCanceled } from "../../../../commons/persistence/write-errors.helper";
import { BusinessException, DatabaseException, EntityNotFoundException } from "../../../../errors/exception-types";
import { EventBridgeService } from "../../../event-bridge/lazy-event-bridge/services/event-bridge.service";
import { ResponsePendingOperationDto } from "../../dtos/response-pending-operation.dto";
import { PendingOperationKind, TENANT_OPERATION_KINDS, USER_OPERATION_KINDS } from "../../enums/pending-operation-kind.enum";
import { PendingOperationState } from "../../enums/pending-operation-state.enum";
import { PendingOperation, PendingOperationKey } from "../../schemas/pending-operation.schema";
import { PendingOperationSchedulerService } from "./pending-operation-scheduler.service";

/** A single write of a DynamoDB transaction, as Dynamoose builds it. */
export type TransactionWrite = Parameters<typeof transaction>[0][number];

/** Minutes to wait before each new attempt: the first after the sending, then growing; the last repeats. */
const RETRY_DELAYS_MINUTES = [5, 15, 60, 240, 1440];

/** Minutes an operation stays overdue before the sweep sends it, leaving its own schedule the time to fire first. */
const SWEEP_GRACE_MINUTES = 10;

/** What an operation needs to be written: the rest is decided here. */
export interface NewPendingOperation {
  /** Identifier of the product the operation is sent to. */
  productId: string;
  /** What the operation asks the product to do. */
  kind: PendingOperationKind;
  /** Identifier of the record the operation creates. */
  targetId: string;
  /** Builds the notification to send from the operation id, which travels in `metadata.rocketOperationId`. */
  buildNotification: (operationId: string) => RocketNotificationDto;
  /** Whether the operation waits for another one to be confirmed before its first sending. */
  deferred?: boolean;
  /** Cognito sub of the operator who asked for it; absent when Rocket itself did. */
  requestedBy?: string;
}

/**
 * Service for the operations Rocket sent to a product and is still waiting on.
 *
 * An operation is never written alone: `createWrite` returns the write to put in the
 * same transaction as the record it creates, so that a tenant or user in REQUESTED
 * always has its operation and the other way round; `dispatch` sends it once the
 * transaction is committed. Every sending counts as an attempt and schedules the next
 * one along `RETRY_DELAYS_MINUTES`, until the product answers or the operator gives up.
 * A deferred operation has no attempt yet and is out of the retry index until `releaseWrite`.
 * A failed sending is not an error for the caller: the operation stays pending and the
 * scheduled attempt sends it again.
 *
 * Every operation ready to be sent is in `retryIndex`, from its birth or its release, so
 * that `sweep` can send the ones whose own schedule never fired: a schedule not created,
 * or a process that stopped between the commit and the first sending.
 */
@Injectable()
export class PendingOperationsService {
  /** Logger instance for PendingOperationsService. */
  private readonly _logger = new Logger(PendingOperationsService.name);

  /** Lazy-loaded EventBridge service. */
  private _eventBridgeService: EventBridgeService | null = null;

  /**
   * Constructor for PendingOperationsService.
   * @param _pendingOperationModel the Dynamoose model used to persist pending operations.
   * @param _schedulerService the scheduler of the next attempts.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the EventBridge service on demand.
   */
  constructor(
    @InjectModel("PendingOperation")
    private readonly _pendingOperationModel: Model<PendingOperation, PendingOperationKey>,
    private readonly _schedulerService: PendingOperationSchedulerService,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) {}

  /**
   * Builds a new operation and the write that stores it, for the caller's transaction.
   * @param input the product, kind, target and notification of the operation.
   * @returns the operation and its transaction write.
   */
  createWrite(input: NewPendingOperation): { operation: PendingOperation; write: TransactionWrite } {
    const id = uuidv4();
    const operation: PendingOperation = {
      productId: input.productId,
      id,
      kind: input.kind,
      targetId: input.targetId,
      payload: input.buildNotification(id) as unknown as Record<string, unknown>,
      state: PendingOperationState.Pending,
      attempts: 0,
      ...(input.requestedBy && { requestedBy: input.requestedBy }),
      // Due from its birth, so that the sweep sends it if `dispatch` never runs; a deferred one waits for its release.
      ...(!input.deferred && { nextAttemptAt: this._nextAttemptAt(1) }),
    };
    return { operation, write: this._pendingOperationModel.transaction.create(operation) };
  }

  /**
   * Sends an operation for the first time, once the transaction that wrote it is committed.
   * @param operation the operation returned by `createWrite`.
   */
  async dispatch(operation: PendingOperation): Promise<void> {
    await this._attempt(operation);
  }

  /**
   * Builds the write that releases a deferred operation whose prerequisite is confirmed: its notification is
   * completed and it becomes due now, so that the sweep sends it if `release` never runs.
   * @param operation the deferred operation.
   * @param complete edits the notification before it is sent (e.g. the tenant id of the product).
   * @returns the transaction write.
   */
  releaseWrite(operation: PendingOperation, complete: (notification: RocketNotificationDto) => RocketNotificationDto): TransactionWrite {
    const payload = complete(operation.payload as unknown as RocketNotificationDto) as unknown as Record<string, unknown>;
    return this._pendingOperationModel.transaction.update(
      { productId: operation.productId, id: operation.id },
      { payload, nextAttemptAt: new Date().toISOString() },
    );
  }

  /**
   * Sends the operations released by `releaseWrite`, once the transaction that released them is committed.
   * Operations already sent or closed meanwhile are left alone.
   * @param keys the operations to send.
   */
  async release(keys: PendingOperationKey[]): Promise<void> {
    for (const key of keys) {
      const operation = await this.get(key);
      if (operation.state !== PendingOperationState.Pending || operation.attempts > 0) continue;
      await this._attempt(operation);
    }
  }

  /**
   * Sends a pending operation again when its scheduled attempt fires; a closed or rescheduled one is left alone.
   * @param key the product and identifier of the operation.
   */
  async retry(key: PendingOperationKey): Promise<void> {
    const operation = await this._pendingOperationModel.get(key);
    if (!operation || operation.state !== PendingOperationState.Pending || !operation.nextAttemptAt) {
      this._logger.log(`Pending operation ${key.id} is no longer due; retry skipped.`);
      return;
    }
    await this._attempt(operation);
  }

  /**
   * Sends an operation again at the operator's request, reopening it when it failed. The reopening is committed in one
   * transaction with the caller's writes on the record, and becomes due at once, so that the sweep sends it if this
   * process stops before the sending.
   * @param key the product and identifier of the operation.
   * @param alongside the caller's writes, such as the record moving back to REQUESTED.
   * @returns the operation as sent.
   * @throws EntityNotFoundException if the operation does not exist.
   * @throws BusinessException if the operation or the record changed meanwhile (e.g. the product answered).
   * @throws DatabaseException if the reopening cannot be written.
   */
  async resend(key: PendingOperationKey, alongside: TransactionWrite[] = []): Promise<PendingOperation> {
    const operation = await this.get(key);
    const nextAttemptAt = new Date().toISOString();
    try {
      await transaction([
        ...alongside,
        this._pendingOperationModel.transaction.update(
          key,
          toDynamooseUpdate<PendingOperation>({ state: PendingOperationState.Pending, nextAttemptAt }, ["lastError"]),
          { condition: new Condition().where("state").in([PendingOperationState.Pending, PendingOperationState.Failed]) },
        ),
      ]);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        throw new BusinessException("The request changed while it was being sent again: reload it.", "REQUEST_CHANGED");
      }
      this._logger.error(`Error reopening pending operation ${key.id}`, error);
      throw new DatabaseException(`An error occurred while reopening the pending operation with ID: ${key.id}.`, error);
    }
    return await this._attempt({ ...operation, state: PendingOperationState.Pending, nextAttemptAt });
  }

  /**
   * Reads an operation, consistently: it may have been written or released a moment before.
   * @param key the product and identifier of the operation.
   * @returns the operation.
   * @throws EntityNotFoundException if the operation does not exist.
   */
  async get(key: PendingOperationKey): Promise<PendingOperation> {
    const operation = await this._pendingOperationModel.get(key, { consistent: true, return: "item" });
    if (!operation) {
      throw new EntityNotFoundException("PendingOperation", key.id);
    }
    return operation;
  }

  /**
   * Reads an operation that may not exist, such as the one named by a product's answer.
   * @param key the product and identifier of the operation.
   * @returns the operation, or null when there is none.
   */
  async find(key: PendingOperationKey): Promise<PendingOperation | null> {
    return (await this._pendingOperationModel.get(key, { consistent: true, return: "item" })) ?? null;
  }

  /**
   * Records a change the product made on its own and told Rocket about, already DONE, so that it shows in the history
   * of its record. A message the product or the queue delivers again finds itself as the record's last line and is
   * not written twice. Written after the change is applied: a failure only leaves the history short, and is logged.
   * @param productId the product that made the change.
   * @param kind what the product did.
   * @param targetId the identifier of the record on the product.
   * @param notification the message the product sent.
   */
  async recordFromProduct(productId: string, kind: PendingOperationKind, targetId: string, notification: RocketNotificationDto): Promise<void> {
    try {
      const kinds = TENANT_OPERATION_KINDS.includes(kind) ? TENANT_OPERATION_KINDS : USER_OPERATION_KINDS;
      const [last] = (await this._pendingOperationModel.query("targetId").eq(targetId).using("targetIndex").all().exec())
        .filter(operation => operation.productId === productId && kinds.includes(operation.kind))
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      if (last?.fromProduct && last.kind === kind && this._canonical(last.payload) === this._canonical(notification)) {
        this._logger.log(`Change ${kind} of record ${targetId} by product ${productId} already in its history; not recorded again.`);
        return;
      }
      await this._pendingOperationModel.create({
        productId,
        id: uuidv4(),
        kind,
        targetId,
        payload: notification as unknown as Record<string, unknown>,
        state: PendingOperationState.Done,
        attempts: 0,
        fromProduct: true,
      });
    } catch (error) {
      this._logger.error(`Change ${kind} of record ${targetId} by product ${productId} not recorded in its history`, error);
    }
  }

  /**
   * Lists the operations of a record, newest first: its history towards the product.
   * @param productId the product of the record.
   * @param targetId the identifier of the record on the product.
   * @param kinds the kinds of the record's entity, since a product may give a tenant and a user the same id.
   * @param since when the record replaced a DELETED one with the same id, leaving out the operations of that one.
   * @returns the operations.
   * @throws DatabaseException if the query fails.
   */
  async listByTarget(productId: string, targetId: string, kinds: PendingOperationKind[], since?: string): Promise<ResponsePendingOperationDto[]> {
    try {
      const operations = await this._pendingOperationModel.query("targetId").eq(targetId).using("targetIndex").all().exec();
      return operations
        .filter(operation => operation.productId === productId && kinds.includes(operation.kind)
          && (!since || (operation.createdAt !== undefined && operation.createdAt >= new Date(since))))
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
        .map(operation => plainToInstance(ResponsePendingOperationDto, operation, { excludeExtraneousValues: true }));
    } catch (error) {
      this._logger.error(`Error listing the operations of record ${targetId} of product ${productId}`, error);
      throw new DatabaseException(`An error occurred while listing the operations of the record with ID: ${targetId}.`, error);
    }
  }

  /**
   * Builds the write that records the product's confirmation, pointing the operation at the record as the product keys it.
   * @param key the product and identifier of the operation.
   * @param targetId the identifier of the record on the product.
   * @returns the transaction write.
   */
  resolveWrite(key: PendingOperationKey, targetId: string): TransactionWrite {
    return this._closeWrite(key, { state: PendingOperationState.Done, targetId });
  }

  /**
   * Builds the write that records the product's error.
   * @param key the product and identifier of the operation.
   * @param error the error the product answered with.
   * @returns the transaction write.
   */
  failWrite(key: PendingOperationKey, error: string): TransactionWrite {
    return this._closeWrite(key, { state: PendingOperationState.Failed, lastError: error });
  }

  /**
   * Builds the write that records that the operator gave up on the operation.
   * @param key the product and identifier of the operation.
   * @returns the transaction write.
   */
  abandonWrite(key: PendingOperationKey): TransactionWrite {
    return this._closeWrite(key, { state: PendingOperationState.Abandoned });
  }

  /**
   * Cancels the scheduled attempt of a closed operation; a schedule that cannot be deleted only fires once, on nothing.
   * @param operationId the identifier of the operation.
   */
  async cancelSchedule(operationId: string): Promise<void> {
    try {
      await this._schedulerService.cancelAttempt(operationId);
    } catch (error) {
      this._logger.warn(`Schedule of pending operation ${operationId} not cancelled; its attempt will be skipped.`, error);
    }
  }

  /**
   * Lists the pending operations due to be sent again, across every product.
   * @param now the moment of the check (ISO 8601).
   * @returns the operations whose next attempt is due.
   * @throws DatabaseException if the query fails.
   */
  async getDue(now: string): Promise<PendingOperation[]> {
    try {
      return await this._pendingOperationModel
        .query("state").eq(PendingOperationState.Pending)
        .where("nextAttemptAt").le(now)
        .using("retryIndex")
        .all()
        .exec();
    } catch (error) {
      this._logger.error("Error listing the pending operations due", error);
      throw new DatabaseException("An error occurred while listing the pending operations due.", error);
    }
  }

  /**
   * Sends again the pending operations overdue by more than `SWEEP_GRACE_MINUTES`, whose own schedule never fired.
   * An operation that cannot be sent is logged and left to the next sweep.
   * @throws DatabaseException if the operations due cannot be listed.
   */
  async sweep(): Promise<void> {
    const due = await this.getDue(new Date(Date.now() - SWEEP_GRACE_MINUTES * 60_000).toISOString());
    if (due.length === 0) return;
    this._logger.warn(`Sweep found ${due.length} pending operation(s) left behind; sending them again.`);
    for (const operation of due) {
      try {
        await this.retry({ productId: operation.productId, id: operation.id });
      } catch (error) {
        this._logger.error(`Sweep could not send pending operation ${operation.id} again`, error);
      }
    }
  }

  /**
   * Sends an operation, counts the attempt and schedules the next one.
   * A sending error is logged and kept on the operation: the next attempt tries again.
   * @param operation the operation to send.
   * @returns the operation with the attempt counted.
   * @throws DatabaseException if the attempt cannot be recorded.
   */
  private async _attempt(operation: PendingOperation): Promise<PendingOperation> {
    const key = { productId: operation.productId, id: operation.id };
    const attempts = operation.attempts + 1;
    const nextAttemptAt = this._nextAttemptAt(attempts);

    let lastError: string | undefined;
    try {
      const eventBridgeService = await this._loadEventBridgeService();
      await eventBridgeService.sendNotification(operation.payload as unknown as RocketNotificationDto);
    } catch (error) {
      lastError = (error as Error).message;
      this._logger.warn(`Sending pending operation ${operation.id} failed; it will be sent again at ${nextAttemptAt}.`, error);
    }

    try {
      await this._pendingOperationModel.update(key, { attempts, nextAttemptAt, ...(lastError && { lastError }) });
    } catch (error) {
      this._logger.error(`Error recording the attempt of pending operation ${operation.id}`, error);
      throw new DatabaseException(`An error occurred while recording the attempt of the pending operation with ID: ${operation.id}.`, error);
    }

    try {
      await this._schedulerService.scheduleAttempt(key, nextAttemptAt);
    } catch (error) {
      this._logger.warn(`Next attempt of pending operation ${operation.id} not scheduled; it can be sent again by hand.`, error);
    }
    return { ...operation, attempts, nextAttemptAt, ...(lastError && { lastError }) };
  }

  /**
   * Builds the write that moves an operation out of the pending state, removing its next attempt.
   * @param key the product and identifier of the operation.
   * @param set the closing state and what goes with it.
   * @returns the transaction write.
   */
  private _closeWrite(key: PendingOperationKey, set: Partial<PendingOperation>): TransactionWrite {
    return this._pendingOperationModel.transaction.update(key, toDynamooseUpdate<PendingOperation>(set, ["nextAttemptAt"]));
  }

  /**
   * Serializes a value with its keys sorted, since DynamoDB does not keep the order of the keys of a map.
   * @param value the value.
   * @returns the serialization.
   */
  private _canonical(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item);
  }

  /**
   * Computes when an operation is due again after a number of attempts.
   * @param attempts the attempts made so far.
   * @returns the moment of the next attempt (ISO 8601).
   */
  private _nextAttemptAt(attempts: number): string {
    const minutes = RETRY_DELAYS_MINUTES[Math.min(attempts, RETRY_DELAYS_MINUTES.length) - 1];
    return new Date(Date.now() + minutes * 60_000).toISOString();
  }

  /**
   * Lazy loads the EventBridgeService from its module.
   * @returns a Promise resolving to the EventBridgeService instance.
   */
  private async _loadEventBridgeService(): Promise<EventBridgeService> {
    if (!this._eventBridgeService) {
      const { EventBridgeLazyModule } = await import("../../../event-bridge/lazy-event-bridge/event-bridge-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => EventBridgeLazyModule);
      this._eventBridgeService = moduleRef.get<EventBridgeService>(EventBridgeService);
    }
    return this._eventBridgeService;
  }
}
