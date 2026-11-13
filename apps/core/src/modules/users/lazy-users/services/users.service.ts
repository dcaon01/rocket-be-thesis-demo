import { Injectable, Logger } from "@nestjs/common";
import { isUnrestricted, RequestScope, SYSTEM_SCOPE } from "@rocket-be/scoping";
import { paginate, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { UsersPageQueryDto } from "../../dtos/users-page-query.dto";
import { ResponseUsersPageDto } from "../../dtos/response-users-page.dto";
import { assertCollaborator, assertPathVisible } from "../../../../commons/scoping/scoped-access.helper";
import { AppException, AuthorizationException } from "../../../../errors/exception-types";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { Condition, transaction } from "dynamoose";
import { InjectModel, Model } from "nestjs-dynamoose";
import { v4 as uuidv4 } from "uuid";
import { BusinessException, DatabaseException, EntityNotFoundException, ValidationException } from "../../../../errors/exception-types";
import { EventBridgeService } from "../../../event-bridge/lazy-event-bridge/services/event-bridge.service";
import { ProductsService } from "../../../products/lazy-products/services/products.service";
import { StructureTypeCheckService } from "../../../products/lazy-products/services/structure-type-check.service";
import { TenantsService } from "../../../tenants/lazy-tenants/services/tenants.service";
import { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import { CreateUserDto } from "../../dtos/create-user.dto";
import { ResponseUserDto } from "../../dtos/response-user.dto";
import { UpdateUserDto } from "../../dtos/update-user.dto";
import { SyncState } from "../../../../commons/enums/sync-state.enum";
import { UserStatus } from "../../enums/user-status.enum";
import { TenantStatus } from "../../../tenants/enums/tenant-status.enum";
import { User, UserKey } from "../../schemas/user.schema";
import { OperationEnum } from "../../../../commons/enums/operation.enum";
import { EntityTypeEnum } from "../../../../commons/enums/entity-type.enum";
import { AccountType } from "../../../../commons/enums/account-type.enum";
import { toDynamooseUpdate } from "../../../../commons/persistence/removable-update.helper";
import { PendingOperationKind, USER_OPERATION_KINDS } from "../../../pending-operations/enums/pending-operation-kind.enum";
import { ResponsePendingOperationDto } from "../../../pending-operations/dtos/response-pending-operation.dto";
import { PendingOperationState } from "../../../pending-operations/enums/pending-operation-state.enum";
import { NewPendingOperation, PendingOperationsService, TransactionWrite } from "../../../pending-operations/lazy-pending-operations/services/pending-operations.service";
import { PendingOperation, PendingOperationKey } from "../../../pending-operations/schemas/pending-operation.schema";
import { OrdersService } from "../../../orders/lazy-orders/services/orders.service";
import type { UserPayloadDto } from "../../dtos/user-payload.dto";
import { isConditionalCheckFailed, isTransactionCanceled } from "../../../../commons/persistence/write-errors.helper";

/** Attempts at writing a change of a user while its operations keep changing under it. */
const MAX_QUEUE_ATTEMPTS = 3;

/** Writes DynamoDB accepts in one transaction. */
const MAX_TRANSACTION_WRITES = 100;

/** Settings of the creation that replaces a user the product deleted, keeping its id. */
const REPLACE_DELETED_USER = { overwrite: true, condition: new Condition().where('status').eq(UserStatus.Deleted) };

/** A user request ready to be committed: the record, its pending operation and the writes that store both. */
export interface UserRequest {
  /** The user in REQUESTED, with the id Rocket decided. */
  user: User;
  /** The operation that asks the product to create it. */
  operation: PendingOperation;
  /** The writes of the record and of the operation, for one transaction. */
  writes: TransactionWrite[];
}

/** The users requests released by the confirmation of their tenant: the writes to commit with it and the operations to send after. */
export interface UserRelease {
  /** The writes that move the users to the tenant's id and release their operations, for the tenant's transaction. */
  writes: TransactionWrite[];
  /** The operations to send once the transaction is committed. */
  operations: PendingOperationKey[];
}

/** What a user request takes from its tenant and product, which may not be written yet. */
export interface UserRequestContext {
  /** Name of the tenant the user joins. */
  tenantName: string;
  /** Reseller lineage of the tenant, inherited by the user. */
  resellerPath?: string;
  /** Name of the product. */
  productName: string;
}

/**
 * Service for managing the users of the products.
 *
 * A user Rocket asks for follows the tenant's path: written at once in REQUESTED with its
 * pending operation, confirmed or failed by the product's answer through
 * `metadata.rocketOperationId`, and rewritten under the product's id when it differs
 * (the product's identity provider decides the user id). The seat is counted on the
 * tenant only at confirmation. Users the product creates on its own initiative arrive
 * without `rocketOperationId` and are created as they come.
 */
@Injectable()
export class UsersService {
  /** Logger instance for UsersService. */
  private readonly _logger = new Logger(UsersService.name);

  /** Lazy-loaded products service */
  private _productsService: ProductsService | null = null;

  /** Lazy-loaded structure type check service */
  private _structureTypeCheckService: StructureTypeCheckService | null = null;

  /** Lazy-loaded tenants service */
  private _tenantsService: TenantsService | null = null;

  /** Lazy-loaded pending operations service. */
  private _pendingOperationsService: PendingOperationsService | null = null;

  /** Lazy-loaded orders service. */
  private _ordersService: OrdersService | null = null;

  /** Lazy-loaded event bridge service */
  private _eventBridgeService: EventBridgeService | null = null;

  /** Lazy-loaded resellers service */
  private _resellersService: ResellersService | null = null;

  /**
   * Constructor for UsersService.
   * @param _userModel the Dynamoose model for users.
   */
  constructor(
    @InjectModel("User")
    private readonly _userModel: Model<User, UserKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

  /**
   * Lazy loads the ProductsService from its module.
   * @returns A Promise resolving to the ProductsService instance.
   */
  private async _loadProductsService(): Promise<ProductsService> {
    if (!this._productsService) {
      const { ProductsLazyModule } = await import(
        "../../../products/lazy-products/products-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ProductsLazyModule,
      );
      this._productsService = moduleRef.get<ProductsService>(ProductsService);
    }
    return this._productsService;
  }

  /**
   * Lazy loads the StructureTypeCheckService from its module.
   * @returns A Promise resolving to the StructureTypeCheckService instance.
   */
  private async _loadStructureTypeCheckService(): Promise<StructureTypeCheckService> {
    if (!this._structureTypeCheckService) {
      const { ProductsLazyModule } = await import(
        "../../../products/lazy-products/products-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ProductsLazyModule,
      );
      this._structureTypeCheckService = moduleRef.get<StructureTypeCheckService>(StructureTypeCheckService);
    }
    return this._structureTypeCheckService;
  }

  /**
   * Lazy loads the TenantsService from its module.
   * @returns A Promise resolving to the TenantsService instance.
   */
  private async _loadTenantsService(): Promise<TenantsService> {
    if (!this._tenantsService) {
      const { TenantsLazyModule } = await import(
        "../../../tenants/lazy-tenants/tenants-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => TenantsLazyModule,
      );
      this._tenantsService = moduleRef.get<TenantsService>(TenantsService);
    }
    return this._tenantsService;
  }

  /**
   * Lazy loads the ResellersService from its module.
   * @returns A Promise resolving to the ResellersService instance.
   */
  private async _loadResellersService(): Promise<ResellersService> {
    if (!this._resellersService) {
      const { ResellersLazyModule } = await import(
        "../../../resellers/lazy-resellers/resellers-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(() => ResellersLazyModule);
      this._resellersService = moduleRef.get<ResellersService>(ResellersService);
    }
    return this._resellersService;
  }


  /**
   * Lazy loads the EventBridgeService from its module.
   * @returns A Promise resolving to the EventBridgeService instance.
   */
  private async _loadEventBridgeService(): Promise<EventBridgeService> {
    if (!this._eventBridgeService) {
      const { EventBridgeLazyModule } = await import(
        "../../../event-bridge/lazy-event-bridge/event-bridge-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => EventBridgeLazyModule,
      );
      this._eventBridgeService = moduleRef.get<EventBridgeService>(EventBridgeService);
    }
    return this._eventBridgeService;
  }

  /**
   * Creates a user the product created on its own initiative, as it arrives from the product.
   * A user that already exists under that id is returned as it is, so a repeated message is harmless.
   * @param user the user data to create.
   * @returns the created user.
   */
  async createUser(user: CreateUserDto): Promise<ResponseUserDto> {
    try {
      let historySince: string | undefined;
      if (user.id) {
        const existingUser = await this._userModel.get({ productId: user.productId, id: user.id });
        if (existingUser && existingUser.status !== UserStatus.Deleted) {
          this._logger.log(`User with ID: ${user.id} already exists; creation skipped.`);
          return plainToInstance(ResponseUserDto, existingUser);
        }
        // A user deleted on the product frees its id: the new one replaces it, with a history of its own.
        if (existingUser) {
          historySince = new Date().toISOString();
        }
      }

      const productsService = await this._loadProductsService();
      const structureTypeCheckService = await this._loadStructureTypeCheckService();
      const product = await productsService.getProduct(user.productId);

      // Validate user data structure against product userStructure.
      const isValid = structureTypeCheckService.checkType(
        user.data,
        product.userStructure
      );
      if (!isValid) {
        this._logger.warn(`User data structure is invalid for product ID: ${user.productId}`);
        throw new ValidationException('User data structure does not match the product user structure.', []);
      }

      const id = user.id ?? uuidv4();

      // Increment active users count for the tenant
      const tenantsService = await this._loadTenantsService();
      const { trialLimitExceeded } = await tenantsService.incrementActiveUsers(user.productId, user.tenant);

      const userStatus = trialLimitExceeded ? UserStatus.Inactive : UserStatus.Active;

      const newUser: User = {
        ...user,
        id,
        status: userStatus,
        syncState: SyncState.InSync,
        accountType: user.accountType ?? AccountType.Company,
        customAttributes: user.customAttributes?.map(attr => ({
          name: attr.name,
          value: attr.value
        })) || [],
        monthIndex: new Date().toISOString().slice(0, 7),
        ...(historySince && { historySince }),
      }

      this._logger.log(`Creating user with ID: ${id}`, newUser);
      const createdUser = historySince
        ? await this._userModel.create(newUser, { ...REPLACE_DELETED_USER, return: 'item' })
        : await this._userModel.create(newUser);

      if (trialLimitExceeded) {
        await this._notifyTrialLimitExceeded(user.productId, id, user.tenant);
      }

      return plainToInstance(ResponseUserDto, createdUser);

    } catch (error) {
      this._logger.error('Error creating user', error);
      if (error instanceof EntityNotFoundException || error instanceof ValidationException || error instanceof BusinessException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while creating the user.', error);
    }
  }

  /**
   * Prepares a user request: validates it, decides the id and builds the REQUESTED record and its pending operation.
   * Nothing is written: the caller commits `writes` in one transaction and then dispatches the operation,
   * or leaves it deferred until the tenant is confirmed.
   * @param user the user to ask the product for.
   * @param context the tenant and product names, and the tenant's reseller lineage.
   * @param options `deferred` to wait for the tenant, `referent` for the first user of a tenant from an order (or
   * `user.referent` for the operator's choice), `requestedBy` for the operator asking for it.
   * @returns the record, the operation and their writes.
   * @throws ValidationException if the data do not match the product's user structure.
   */
  async prepareUserRequest(
    user: CreateUserDto,
    context: UserRequestContext,
    options: { deferred?: boolean; referent?: boolean; requestedBy?: string } = {},
  ): Promise<UserRequest> {
    const productsService = await this._loadProductsService();
    const structureTypeCheckService = await this._loadStructureTypeCheckService();
    const product = await productsService.getProduct(user.productId);
    // Generated fields are filled by the product, so a request cannot carry them yet.
    const requestStructure = product.userStructure.filter(field => !field.generated);
    if (!structureTypeCheckService.checkType(user.data, requestStructure)) {
      this._logger.warn(`User data structure is invalid for product ID: ${user.productId}`);
      throw new ValidationException('User data structure does not match the product user structure.', []);
    }

    const id = uuidv4();
    const referent = options.referent || user.referent;
    const pendingOperationsService = await this._loadPendingOperationsService();
    const { operation, write } = pendingOperationsService.createWrite({
      productId: user.productId,
      kind: PendingOperationKind.CreateUser,
      targetId: id,
      deferred: options.deferred,
      requestedBy: options.requestedBy,
      buildNotification: operationId => ({
        productId: user.productId,
        operation: OperationEnum.Create,
        entityType: EntityTypeEnum.User,
        payload: [this._userRequestPayload({ ...user, ...context, id }, operationId, referent)],
      }),
    });

    const { id: _requestedId, referent: _referent, ...fields } = user;
    const record: User = {
      ...fields,
      ...context,
      id,
      status: UserStatus.Requested,
      accountType: user.accountType ?? AccountType.Company,
      customAttributes: user.customAttributes?.map(attr => ({ name: attr.name, value: attr.value })) || [],
      monthIndex: new Date().toISOString().slice(0, 7),
      pendingOperationId: operation.id,
      syncState: SyncState.Pending,
      ...(referent && { referent: true }),
    };
    return { user: record, operation, writes: [this._userModel.transaction.create(record), write] };
  }

  /**
   * Records the product's answer to a user request, found through `metadata.rocketOperationId`.
   * An error leaves the user REQUESTED with `syncState` FAILED. A confirmation counts the seat on the tenant, moves the user to
   * ACTIVE (INACTIVE past the trial limit, which the product is told) and rewrites it under the product's
   * id when that differs from Rocket's; a confirmation after a cancellation still lands, flagged.
   * @param productId the product that answered.
   * @param item the user as the product sent it back.
   * @returns the confirmed user, or null when nothing was confirmed.
   * @throws EntityNotFoundException if the user of the operation does not exist.
   */
  async confirmUserRequest(productId: string, item: UserPayloadDto): Promise<User | null> {
    const pendingOperationsService = await this._loadPendingOperationsService();
    const operationKey = { productId, id: String(item.metadata?.rocketOperationId) };
    const operation = await pendingOperationsService.find(operationKey);
    // An unknown operation would never be found by retrying the message: it is dropped, not sent to the dead-letter queue.
    if (!operation) {
      this._logger.warn(`User answer from product ${productId} names unknown operation ${operationKey.id}; answer dropped.`);
      return null;
    }
    if (operation.state === PendingOperationState.Done) {
      this._logger.log(`User request ${operation.id} already confirmed; answer ignored.`);
      return null;
    }

    const user = await this._userModel.get({ productId, id: operation.targetId }, { consistent: true, return: 'item' });
    if (!user) {
      throw new EntityNotFoundException('User', operation.targetId);
    }
    const sameStatus = { condition: new Condition().where('status').eq(user.status) };

    if (item.error) {
      try {
        const writes = [pendingOperationsService.failWrite(operationKey, item.error.message)];
        // A cancelled user stays as it is: the operator already discarded it.
        if (user.status === UserStatus.Requested) {
          writes.push(this._userModel.transaction.update(
            { productId, id: user.id },
            { syncState: SyncState.Failed, failureReason: item.error.message },
            sameStatus,
          ));
        }
        await transaction(writes);
      } catch (error) {
        return this._answerNotRecorded(operation.id, error);
      }
      await pendingOperationsService.cancelSchedule(operation.id);
      this._logger.warn(`User request ${operation.id} failed on product ${productId}: ${item.error.message}`);
      return null;
    }

    // The seat is counted first, as on a creation; it is given back if the answer cannot be recorded.
    const tenantsService = await this._loadTenantsService();
    const { trialLimitExceeded } = await tenantsService.incrementActiveUsers(productId, user.tenant);

    const id = item.id ?? user.id;
    const confirmation = {
      ...(item.email && { email: item.email }),
      ...(item.roles && { roles: item.roles }),
      ...(item.name && { name: item.name }),
      ...(item.surname && { surname: item.surname }),
      data: { ...(user.data ?? {}), ...(item.data ?? {}) },
      status: trialLimitExceeded ? UserStatus.Inactive : UserStatus.Active,
      syncState: SyncState.InSync,
      ...(user.status === UserStatus.Cancelled && { confirmedAfterCancellation: true }),
    };
    const { failureReason: _failureReason, ...kept } = JSON.parse(JSON.stringify(user)) as User;
    const confirmed: User = { ...kept, ...confirmation, id };
    // Under the product's id there may be a user it deleted: the new one replaces it, with a history of its own.
    const replaced = id !== user.id ? await this._userModel.get({ productId, id }, { consistent: true, return: 'item' }) : undefined;
    if (replaced?.status === UserStatus.Deleted) {
      confirmed.historySince = new Date().toISOString();
    }
    // A cancelled user was already settled by its cancellation.
    const settleWrites = user.status === UserStatus.Cancelled ? [] : await tenantsService.settleUserWrites(productId, user.tenant);

    try {
      // A key cannot change in place: under the product's own id the record is deleted and written again.
      const recordWrites = id === user.id
        ? [this._userModel.transaction.update({ productId, id }, toDynamooseUpdate<User>(confirmation, ['failureReason']), sameStatus)]
        : [
          this._userModel.transaction.delete({ productId, id: user.id }, sameStatus),
          this._userModel.transaction.create(confirmed, confirmed.historySince ? REPLACE_DELETED_USER : undefined),
        ];
      await transaction([...recordWrites, ...settleWrites, pendingOperationsService.resolveWrite(operationKey, id)]);
    } catch (error) {
      if (!trialLimitExceeded) {
        await tenantsService.decrementActiveUsers(productId, user.tenant);
      }
      return this._answerNotRecorded(operation.id, error);
    }
    await pendingOperationsService.cancelSchedule(operation.id);
    this._logger.log(`User request ${operation.id} confirmed by product ${productId} as user ${id}.`);

    if (trialLimitExceeded) {
      await this._notifyTrialLimitExceeded(productId, id, user.tenant);
    }
    if (confirmed.referent) {
      await this._clearOtherReferents(productId, user.tenant, id);
    }
    if (settleWrites.length > 0) {
      await this.completeProvisioning(productId, user.tenant, confirmed);
    }
    return confirmed;
  }

  /**
   * Sends again the open operation of a user (its creation, a change or a deletion), reopening it when the product
   * had answered with an error.
   * @param productId the product of the user.
   * @param id the identifier of the user.
   * @param scope the request scope.
   * @returns the user, waiting for the product again.
   * @throws BusinessException if the user has no open operation, or it is a creation whose tenant is not confirmed yet.
   */
  async resendUserRequest(productId: string, id: string, scope: RequestScope): Promise<ResponseUserDto> {
    assertCollaborator(scope, 'resendUserRequest');
    const user = await this.getUser(productId, id, scope);
    const isOpen = user.status === UserStatus.Requested || [SyncState.Pending, SyncState.Failed].includes(user.syncState);
    if (!user.pendingOperationId || !isOpen) {
      throw new BusinessException('Only a user with an operation waiting for the product, or failed, can be sent again.', 'USER_NOT_PENDING');
    }
    // A user asked with its tenant leaves with the tenant's id on the product, known only at its confirmation.
    if (user.status === UserStatus.Requested) {
      const tenantsService = await this._loadTenantsService();
      const tenant = await tenantsService.getTenant(productId, user.tenant);
      if (![TenantStatus.Active, TenantStatus.Inactive].includes(tenant.status)) {
        throw new BusinessException('The user is sent with its tenant: wait for the product to confirm the tenant.', 'USER_TENANT_NOT_CONFIRMED');
      }
    }
    try {
      const recordWrites = user.syncState === SyncState.Failed
        ? [this._userModel.transaction.update(
          { productId, id },
          toDynamooseUpdate<User>({ syncState: SyncState.Pending }, ['failureReason']),
          { condition: new Condition().where('syncState').eq(SyncState.Failed) },
        )]
        : [];
      const pendingOperationsService = await this._loadPendingOperationsService();
      await pendingOperationsService.resend({ productId, id: user.pendingOperationId }, recordWrites);
      this._logger.log(`User request for user ${id} sent again to product ${productId}.`);
      return await this.getUser(productId, id, scope);
    } catch (error) {
      if (error instanceof AppException) throw error;
      this._logger.error(`Error sending again the request of user ${id}`, error);
      throw new DatabaseException('An error occurred while sending the user request again.', error);
    }
  }

  /**
   * Discards the operation of a user the product answered with an error. A discarded creation marks the user
   * CANCELLED, not deleted; a discarded change or deletion leaves the user as it is on the product. An operation
   * without an answer is never discarded, since the product may have carried it out: it is only sent again.
   * @param productId the product of the user.
   * @param id the identifier of the user.
   * @param scope the request scope.
   * @returns the user.
   * @throws BusinessException if the product has not answered the operation with an error, or the user changed meanwhile.
   */
  async cancelUserRequest(productId: string, id: string, scope: RequestScope): Promise<ResponseUserDto> {
    assertCollaborator(scope, 'cancelUserRequest');
    const user = await this.getUser(productId, id, scope);
    if (!user.pendingOperationId || user.syncState !== SyncState.Failed) {
      throw new BusinessException('Only an operation the product answered with an error can be discarded.', 'USER_NOT_FAILED');
    }
    const isCreation = user.status === UserStatus.Requested;
    try {
      const pendingOperationsService = await this._loadPendingOperationsService();
      const tenantsService = await this._loadTenantsService();
      const settleWrites = isCreation ? await tenantsService.settleUserWrites(productId, user.tenant) : [];
      const failed = new Condition().where('syncState').eq(SyncState.Failed);
      const record = await this._userModel.get({ productId, id }, { consistent: true, return: 'item' });
      const after = isCreation || !record
        ? {
          writes: [this._userModel.transaction.update(
            { productId, id },
            toDynamooseUpdate<User>({ ...(isCreation && { status: UserStatus.Cancelled }), syncState: SyncState.InSync }, ['failureReason']),
            { condition: failed },
          )],
        }
        : await this._moveToNextOperationWrites(record, failed, { syncState: SyncState.InSync }, ['failureReason']);
      await transaction([
        ...after.writes,
        pendingOperationsService.abandonWrite({ productId, id: user.pendingOperationId }),
        ...settleWrites,
      ]);
      await pendingOperationsService.cancelSchedule(user.pendingOperationId);
      await this._sendNext('next' in after ? after.next : undefined);
      if (settleWrites.length > 0) {
        await this.completeProvisioning(productId, user.tenant);
      }
      this._logger.log(`User request for user ${id} of product ${productId} cancelled.`);
      return await this.getUser(productId, id, scope);
    } catch (error) {
      if (error instanceof AppException) throw error;
      if (isTransactionCanceled(error)) {
        throw new BusinessException('The user changed while it was being cancelled: reload it.', 'REQUEST_CHANGED');
      }
      this._logger.error(`Error cancelling the request of user ${id}`, error);
      throw new DatabaseException('An error occurred while cancelling the user request.', error);
    }
  }

  /**
   * Lists the operations sent to the product for a user, newest first: its history.
   * @param productId the product of the user.
   * @param id the identifier of the user.
   * @param scope the request scope.
   * @returns the operations of the user.
   * @throws EntityNotFoundException if the user does not exist.
   */
  async listUserOperations(productId: string, id: string, scope: RequestScope): Promise<ResponsePendingOperationDto[]> {
    // Read first for its visibility to the caller.
    await this.getUser(productId, id, scope);
    const user = await this._userModel.get({ productId, id });
    const pendingOperationsService = await this._loadPendingOperationsService();
    return pendingOperationsService.listByTarget(productId, id, USER_OPERATION_KINDS, user?.historySince);
  }

  /**
   * Checks that the user is on the product, so that the operator can change or delete it.
   * @param productId the product of the user.
   * @param id the identifier of the user.
   * @param scope the caller's scope.
   * @returns the user.
   * @throws BusinessException if the user is requested, failed or cancelled.
   */
  async assertUserOnProduct(productId: string, id: string, scope: RequestScope): Promise<ResponseUserDto> {
    const user = await this.getUser(productId, id, scope);
    if (![UserStatus.Active, UserStatus.Inactive].includes(user.status)) {
      throw new BusinessException('Only an active or inactive user can be changed: the product has not created this one.', 'USER_NOT_ON_PRODUCT');
    }
    return user;
  }

  /**
   * Builds the release of the user requests that waited for their tenant, for the transaction that confirms it:
   * each user moves to the tenant's id on the product, which may differ from the one Rocket decided, and each
   * deferred operation gets that id in its notification and becomes due. At most 45 users per tenant
   * (`MAX_PROVISIONED_USERS`), so the writes fit in the tenant's transaction.
   * Users not waiting any more (cancelled, already sent) are left alone.
   * @param productId the product of the tenant.
   * @param requestedTenantId the id the tenant had while it was requested.
   * @param tenantId the id of the tenant on the product.
   * @returns the writes to commit with the tenant and the operations to send after.
   * @throws DatabaseException if the waiting users or their operations cannot be read.
   */
  async prepareUserRelease(productId: string, requestedTenantId: string, tenantId: string): Promise<UserRelease> {
    try {
      const waiting = await this._waitingUserRequests(productId, requestedTenantId);
      const pendingOperationsService = await this._loadPendingOperationsService();
      const operations = await Promise.all(waiting.map(user => pendingOperationsService.get({ productId, id: user.pendingOperationId })));
      const deferred = operations.filter(operation => operation.state === PendingOperationState.Pending && operation.attempts === 0);

      const userWrites = tenantId === requestedTenantId
        ? []
        : waiting.map(user => this._userModel.transaction.update({ productId, id: user.id }, { tenant: tenantId }));
      const operationWrites = deferred.map(operation => pendingOperationsService.releaseWrite(
        operation,
        notification => ({ ...notification, payload: notification.payload.map(item => ({ ...item, tenant: tenantId })) }),
      ));
      return {
        writes: [...userWrites, ...operationWrites],
        operations: deferred.map(operation => ({ productId, id: operation.id })),
      };
    } catch (error) {
      if (error instanceof AppException) throw error;
      this._logger.error(`Error preparing the release of the user requests of tenant ${tenantId}`, error);
      throw new DatabaseException('An error occurred while preparing the release of the user requests of the tenant.', error);
    }
  }

  /**
   * Builds the writes that discard the user requests waiting for a tenant the operator discards, for the tenant's
   * transaction: each user is marked CANCELLED and its operation abandoned. At most 45 users per tenant
   * (`MAX_PROVISIONED_USERS`), so the writes fit in the transaction.
   * @param productId the product of the tenant.
   * @param tenantId the id of the tenant being cancelled.
   * @returns the writes of the users and of their operations.
   * @throws DatabaseException if the waiting users cannot be read.
   */
  async cancelWritesOfTenant(productId: string, tenantId: string): Promise<TransactionWrite[]> {
    try {
      const waiting = await this._waitingUserRequests(productId, tenantId);
      const pendingOperationsService = await this._loadPendingOperationsService();
      return waiting.flatMap(user => [
        this._userModel.transaction.update(
          { productId, id: user.id },
          { status: UserStatus.Cancelled, syncState: SyncState.InSync },
          { condition: new Condition().where('status').eq(UserStatus.Requested) },
        ),
        pendingOperationsService.abandonWrite({ productId, id: user.pendingOperationId }),
      ]);
    } catch (error) {
      this._logger.error(`Error reading the user requests of tenant ${tenantId}`, error);
      throw new DatabaseException('An error occurred while reading the user requests of the tenant.', error);
    }
  }

  /**
   * Handles an answer that could not be recorded: a concurrent change of the request is not an error.
   * @param operationId the pending operation of the request.
   * @param error the error of the transaction.
   * @returns null, nothing having been confirmed.
   * @throws DatabaseException if the failure is not a concurrent change.
   */
  private _answerNotRecorded(operationId: string, error: unknown): null {
    if (isTransactionCanceled(error)) {
      this._logger.warn(`User request ${operationId} changed while recording the answer; answer ignored.`);
      return null;
    }
    this._logger.error(`Error recording the answer to user request ${operationId}`, error);
    throw new DatabaseException('An error occurred while recording the answer to the user request.', error);
  }

  /**
   * Provisions the order line of a tenant once every user asked with it is settled, with the users the product created.
   * Called after the last user is settled, and by the operator for a line left behind; a line already provisioned
   * is left alone by `markLineProvisioned`.
   * @param productId the product of the tenant.
   * @param tenantId the identifier of the tenant on the product.
   * @param confirmed the user just confirmed, which the tenant index may not show yet.
   * @returns whether the provisioning was settled and the line recorded.
   */
  async completeProvisioning(productId: string, tenantId: string, confirmed?: User): Promise<boolean> {
    const tenantsService = await this._loadTenantsService();
    const orderId = await tenantsService.settledProvisioningOrder(productId, tenantId);
    if (!orderId) return false;

    const created = (await this._userModel.query("productId").eq(productId).where("tenant").eq(tenantId).using("tenantIndex").all().exec())
      .filter(user => user.id !== confirmed?.id
        && [UserStatus.Active, UserStatus.Inactive].includes(user.status));
    const users = [...(confirmed ? [confirmed] : []), ...created];
    const ordersService = await this._loadOrdersService();
    await ordersService.markLineProvisioned(productId, orderId, tenantId, users);
    return true;
  }

  /**
   * Reads the user requests of a tenant still waiting to be sent or answered.
   * @param productId the product of the tenant.
   * @param tenantId the id of the tenant the users were asked for.
   * @returns the users in REQUESTED with their pending operation.
   */
  private async _waitingUserRequests(productId: string, tenantId: string): Promise<User[]> {
    return (await this._userModel.query("productId").eq(productId).where("tenant").eq(tenantId).using("tenantIndex").all().exec())
      .filter(user => user.status === UserStatus.Requested && user.pendingOperationId);
  }

  /**
   * Tells the product that a user created past the trial seat limit of its tenant is INACTIVE.
   * @param productId the product of the user.
   * @param id the identifier of the user on the product.
   * @param tenant the identifier of the tenant.
   */
  private async _notifyTrialLimitExceeded(productId: string, id: string, tenant: string): Promise<void> {
    this._logger.warn(`User ${id} set INACTIVE: trial seat limit exceeded for tenant ${tenant}`);
    const eventBridgeService = await this._loadEventBridgeService();
    await eventBridgeService.sendNotification({
      productId,
      operation: OperationEnum.Update,
      entityType: EntityTypeEnum.User,
      payload: [{ id, status: UserStatus.Inactive, tenant } as UserPayloadDto],
    });
  }

  /**
   * Builds the payload of a user request: the standard fields, the data, and the Rocket-only fields in `metadata`,
   * which the product sends back unchanged together with `rocketOperationId`.
   * @param user the user, with the id Rocket decided.
   * @param operationId the pending operation of the request.
   * @param referent whether the user is the referent of its tenant.
   * @returns the payload item.
   */
  private _userRequestPayload(user: CreateUserDto, operationId: string, referent?: boolean): UserPayloadDto {
    const { productId: _productId, data, tenantName: _tenantName, productName, customAttributes, referent: _referent, ...standard } = user;
    return {
      ...standard,
      data,
      metadata: { productName, customAttributes, rocketOperationId: operationId, ...(referent && { referent: true }) },
    };
  }

  /**
   * Gets a user by its ID.
   * @param productId the product ID the user belongs to.
   * @param id the unique identifier of the user.
   * @returns the user with the specified ID.
  */
  async getUser(productId: string, id: string, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseUserDto> {
    try {
      const user = await this._userModel.get({ productId, id }); // O(1)

      if (!user) {
        this._logger.warn(`User with ID: ${id} for product ID: ${productId} not found.`);
        throw new EntityNotFoundException('User', id);
      }

      // Resellers only see users attributed to issuers of their subtree.
      const viewerPath = await this._resolveScopePath(scope);
      assertPathVisible(scope, viewerPath, user.resellerPath, `User ${id}`);

      this._logger.log(`User with ID: ${id} for product ID: ${productId} retrieved successfully.`);
      return plainToInstance(ResponseUserDto, user);

    } catch (error) {
      this._logger.error(`Error retrieving user with ID: ${id} for product ID: ${productId}`, error);
      if (error instanceof EntityNotFoundException || error instanceof AuthorizationException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while retrieving the user.', error);
    }
  }

  /**
   * Retrieves the users of a company on every product: the users of the tenants of the company.
   * @param companyId the company of the users.
   * @param scope the request scope.
   * @returns the users of the company, by surname and name.
   */
  async getUsersByCompany(companyId: string, scope: RequestScope): Promise<ResponseUserDto[]> {
    try {
      const tenantsService = await this._loadTenantsService();
      const tenants = await tenantsService.getTenantsByCompany(companyId, scope);

      const users = (await Promise.all(tenants.map(tenant =>
        this._userModel.query("productId").eq(tenant.productId).where("tenant").eq(tenant.id).using("tenantIndex").all().exec(),
      ))).flat().filter(user => user.status !== UserStatus.Deleted);

      this._logger.log(`Retrieved ${users.length} users for company ID: ${companyId}.`);
      return users
        .sort((a, b) => `${a.surname ?? ""} ${a.name ?? ""}`.localeCompare(`${b.surname ?? ""} ${b.name ?? ""}`))
        .map(user => plainToInstance(ResponseUserDto, user));

    } catch (error) {
      this._logger.error(`Error retrieving the users of company ${companyId}`, error);
      if (error instanceof AppException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while retrieving the users of the company.', error);
    }
  }

  /**
   * Lists one page of the users of a product; a reseller sees only those of its subtree, its salesperson included,
   * read off the reseller path index.
   * @param productId the product of the users.
   * @param query the page and its filters.
   * @param scope the request scope.
   * @returns the page of users.
   * @throws ValidationException if the cursor is not valid.
   */
  async listUsers(productId: string, query: UsersPageQueryDto, scope: RequestScope): Promise<ResponseUsersPageDto> {
    const { limit, cursor, status, search, tenantName } = query;

    try {
      const viewerPath = isUnrestricted(scope) ? undefined : await this._resolveScopePath(scope);
      if (!isUnrestricted(scope) && !viewerPath) {
        return { items: [] };
      }

      const page = await paginate<User>(
        () => viewerPath
          ? this._userModel.query("productId").eq(productId).where("resellerPath").beginsWith(viewerPath).using("resellerPathIndex")
          : this._userModel.query("productId").eq(productId),
        viewerPath ? ["productId", "id", "resellerPath"] : ["productId", "id"],
        limit,
        cursor,
        user =>
          (status?.length ? status.includes(user.status) : user.status !== UserStatus.Deleted)
          && startsWithAny(search, user.name, user.surname, user.email)
          && startsWithAny(tenantName, user.tenantName),
      );
      return { items: page.items.map(user => plainToInstance(ResponseUserDto, user)), nextCursor: page.nextCursor };
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this._logger.error(`Error listing the users of product ${productId}`, error);
      throw new DatabaseException('An error occurred while retrieving the users.', error);
    }
  }


  /**
   * Resolves the requesting reseller's materialized path (undefined for
   * unrestricted scopes: collaborators / system).
   * @param scope the request scope.
   * @returns the viewer's reseller path, or undefined.
   */
  private async _resolveScopePath(scope: RequestScope): Promise<string | undefined> {
    if (isUnrestricted(scope) || !scope.resellerCode) {
      return undefined;
    }
    const resellersService = await this._loadResellersService();
    return await resellersService.getResellerPath(scope.resellerCode);
  }

  /**
   * Updates a user by its ID.
   * @param productId the identifier of the product the user belongs to.
   * @param id the identifier of the user to update.
   * @param user the DTO with the information to update the user.
   * @returns the updated user.
   */
  async updateUser(productId: string, id: string, user: UpdateUserDto): Promise<ResponseUserDto> {
    try {
      const existingUser = await this._userModel.get({ productId, id });

      // Check if user exists.
      if (!existingUser) {
        this._logger.warn(`User with ID: ${id} for product ID: ${productId} not found.`);
        throw new EntityNotFoundException('User', id);
      }

      // Validate user data structure against product userStructure.
      const productsService = await this._loadProductsService();
      const structureTypeCheckService = await this._loadStructureTypeCheckService();
      const product = await productsService.getProduct(existingUser.productId);
      const isValid = structureTypeCheckService.checkType(
        user.data,
        product.userStructure
      );
      if (!isValid) {
        this._logger.warn(`User data structure is invalid for user ID: ${id}`);
        throw new ValidationException('User data structure does not match the product user structure.', []);
      }

      const isStatusChanging = !!user.status && user.status !== existingUser.status;
      const plainUpdateUser: Partial<User> = JSON.parse(JSON.stringify(user)) as Partial<User>;
      // accountType is immutable after creation (a professional/client is never
      // converted): never let an update — including inbound event metadata — change it.
      delete plainUpdateUser.accountType;

      // When the status is changing, perform a conditional write guarded on the OLD status.
      // Rationale: SQS at-least-once delivery (and concurrent Lambda invocations of the inbound
      // event handler) can deliver the same status-change event twice; without a guard, both
      // workers read `status: INACTIVE`, both call increment/decrement, and the active-users
      // counter drifts by 2 instead of 1. The conditional write ensures only the first writer
      // flips the status; the duplicate(s) get a ConditionalCheckFailedException and exit early
      // without touching the tenant counter.
      if (isStatusChanging) {
        this._logger.log(
          `Updating user with ID: ${id} for product ID: ${productId} (conditional on status=${existingUser.status})`,
          plainUpdateUser,
        );
        let savedUser: User;
        try {
          savedUser = await this._userModel.update(
            { productId, id },
            plainUpdateUser,
            { condition: new Condition().where('status').eq(existingUser.status), return: 'item' },
          );
        } catch (error) {
          if (isConditionalCheckFailed(error)) {
            this._logger.log(
              `Concurrent / duplicate status update on user ${id} ignored: status was already flipped from ${existingUser.status}.`,
            );
            const refreshed = await this._userModel.get({ productId, id });
            return plainToInstance(ResponseUserDto, refreshed);
          }
          throw error;
        }

        // Conditional write succeeded → apply the active-users side effect exactly once.
        const tenantsService = await this._loadTenantsService();
        if (existingUser.status === UserStatus.Active && user.status === UserStatus.Inactive) {
          await tenantsService.decrementActiveUsers(productId, existingUser.tenant);
        } else if (existingUser.status === UserStatus.Inactive && user.status === UserStatus.Active) {
          await tenantsService.incrementActiveUsers(productId, existingUser.tenant);
        }

        return plainToInstance(ResponseUserDto, savedUser);
      }

      // No status change: regular unconditional update.
      this._logger.log(`Updating user with ID: ${id} for product ID: ${productId}`, plainUpdateUser);
      const savedUser = await this._userModel.update({ productId, id }, plainUpdateUser);
      return plainToInstance(ResponseUserDto, savedUser);

    } catch (error) {
      this._logger.error(`Error updating user with ID: ${id} for product ID: ${productId}`, error);
      if (error instanceof EntityNotFoundException || error instanceof ValidationException || error instanceof BusinessException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while updating the user.', error);
    }
  }

  /**
   * Lazy loads the OrdersService from its module.
   * @returns a Promise resolving to the OrdersService instance.
   */
  private async _loadOrdersService(): Promise<OrdersService> {
    if (!this._ordersService) {
      const { OrdersLazyModule } = await import("../../../orders/lazy-orders/orders-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => OrdersLazyModule);
      this._ordersService = moduleRef.get<OrdersService>(OrdersService);
    }
    return this._ordersService;
  }

  /**
   * Lazy loads the PendingOperationsService from its module.
   * @returns a Promise resolving to the PendingOperationsService instance.
   */
  private async _loadPendingOperationsService(): Promise<PendingOperationsService> {
    if (!this._pendingOperationsService) {
      const { PendingOperationsLazyModule } = await import(
        "../../../pending-operations/lazy-pending-operations/pending-operations-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(() => PendingOperationsLazyModule);
      this._pendingOperationsService = moduleRef.get<PendingOperationsService>(PendingOperationsService);
    }
    return this._pendingOperationsService;
  }


  /**
   * Records that the product deleted a user on its own: the user becomes DELETED and the change joins its history.
   * @param productId the product of the user.
   * @param item the user as the product sent it.
   * @throws DatabaseException if the user cannot be marked.
   */
  async applyUserDeletion(productId: string, item: UserPayloadDto): Promise<void> {
    const id = String(item.id);
    const user = await this._userModel.get({ productId, id }, { consistent: true, return: 'item' });
    if (!user) {
      this._logger.warn(`User ${id} deleted by product ${productId} is not on Rocket; nothing to record.`);
      return;
    }
    await this._markUserDeleted(user);
    await this._recordProductChange(productId, PendingOperationKind.DeleteUser, OperationEnum.Delete, id, item);
  }

  /**
   * Records that the product changed a user on its own: the change is applied and joins the user's history.
   * @param productId the product of the user.
   * @param item the user as the product sent it.
   * @throws EntityNotFoundException if the user does not exist.
   */
  async applyUserUpdate(productId: string, item: UserPayloadDto): Promise<void> {
    const { id, data, metadata, error: _error, ...standard } = item;
    await this.updateUser(productId, String(id), { ...standard, data, ...(metadata || {}) } as UpdateUserDto);
    await this._recordProductChange(productId, PendingOperationKind.UpdateUser, OperationEnum.Update, String(id), item);
  }

  /**
   * Records that the product created a user on its own, in the user's history.
   * @param productId the product of the user.
   * @param item the user as the product sent it.
   */
  async recordUserCreation(productId: string, item: UserPayloadDto): Promise<void> {
    await this._recordProductChange(productId, PendingOperationKind.CreateUser, OperationEnum.Create, String(item.id), item);
  }

  /**
   * Records the product's answer to a change or a deletion of a user, found through `metadata.rocketOperationId`.
   * An error leaves the user as it was with `syncState` FAILED. A confirmed change is applied before the operation
   * is closed, so that a process stopping in between applies it again at the next sending; a confirmed deletion
   * makes the user DELETED. An answer to an unknown or closed operation, or to a user purged meanwhile, is dropped.
   * @param productId the product that answered.
   * @param item the user as the product sent it back.
   * @throws DatabaseException if the answer cannot be recorded.
   */
  async confirmUserOperation(productId: string, item: UserPayloadDto): Promise<void> {
    const pendingOperationsService = await this._loadPendingOperationsService();
    const operationKey = { productId, id: String(item.metadata?.rocketOperationId) };
    const operation = await pendingOperationsService.find(operationKey);
    if (!operation) {
      this._logger.warn(`User answer from product ${productId} names unknown operation ${operationKey.id}; answer dropped.`);
      return;
    }
    if (operation.state !== PendingOperationState.Pending) {
      this._logger.log(`User operation ${operation.id} is ${operation.state}; answer ignored.`);
      return;
    }
    const user = await this._userModel.get({ productId, id: operation.targetId }, { consistent: true, return: 'item' });
    if (!user) {
      this._logger.warn(`User ${operation.targetId} of operation ${operation.id} is no longer on Rocket; answer dropped.`);
      return;
    }
    const ownOperation = { condition: new Condition().where('pendingOperationId').eq(operation.id) };

    if (item.error) {
      // An operation queued behind this one, such as a suspension, goes on: the error stays in the history.
      const after = await this._moveToNextOperationWrites(user, ownOperation.condition, { syncState: SyncState.Failed, failureReason: item.error.message }, []);
      try {
        await transaction([pendingOperationsService.failWrite(operationKey, item.error.message), ...after.writes]);
      } catch (error) {
        this._answerNotRecorded(operation.id, error);
        return;
      }
      await pendingOperationsService.cancelSchedule(operation.id);
      this._logger.warn(`User operation ${operation.id} failed on product ${productId}: ${item.error.message}`);
      await this._sendNext(after.next);
      return;
    }

    if (operation.kind === PendingOperationKind.DeleteUser) {
      await this._markUserDeleted(user, operationKey);
      return;
    }
    const { id: _id, data, metadata, error: _error, ...standard } = item;
    const { rocketOperationId: _operationId, ...fields } = metadata ?? {};
    await this.updateUser(productId, user.id, { ...standard, data, ...fields } as UpdateUserDto);
    if (fields['referent'] === true) {
      await this._clearOtherReferents(productId, user.tenant, user.id);
    }
    const after = await this._moveToNextOperationWrites(user, ownOperation.condition, { syncState: SyncState.InSync }, ['failureReason']);
    try {
      await transaction([pendingOperationsService.resolveWrite(operationKey, user.id), ...after.writes]);
    } catch (error) {
      this._answerNotRecorded(operation.id, error);
      return;
    }
    await pendingOperationsService.cancelSchedule(operation.id);
    this._logger.log(`User operation ${operation.id} confirmed by product ${productId}.`);
    await this._sendNext(after.next);
  }

  /**
   * Asks the product to suspend or reactivate the users of a tenant, one operation per user: on suspension each active
   * user becomes INACTIVE and keeps its previous status, on reactivation it gets it back. A user with an operation
   * already open gets its own queued behind it, sent when that one is answered; the order is kept and the change is
   * never lost. Users not on the product are left out.
   * @param productId the product of the tenant.
   * @param tenantId the identifier of the tenant.
   * @param deactivating whether the tenant is being suspended rather than reactivated.
   * @param requestedBy the operator who changed the tenant, absent when Rocket did (an unpaid invoice, a trial ending).
   * @throws DatabaseException if an operation cannot be written.
   */
  async requestStatusChanges(productId: string, tenantId: string, deactivating: boolean, requestedBy?: string): Promise<void> {
    const users = (await this._userModel.query("productId").eq(productId).where("tenant").eq(tenantId).using("tenantIndex").all().exec())
      .filter(user => [UserStatus.Active, UserStatus.Inactive].includes(user.status));
    for (const user of users) {
      if (!deactivating && !user.prevStatus) continue;
      const change = deactivating
        ? { status: UserStatus.Inactive, metadata: { prevStatus: user.status } }
        : { status: user.prevStatus, metadata: { prevStatus: undefined } };
      await this._requestOrQueueUserOperation(user, requestedBy, operationId => ({
        id: user.id,
        tenant: tenantId,
        status: change.status,
        metadata: { ...change.metadata, rocketOperationId: operationId },
      } as UserPayloadDto));
    }
    this._logger.log(`${deactivating ? 'Suspension' : 'Reactivation'} of ${users.length} user(s) of tenant ${tenantId} asked to product ${productId}.`);
  }

  /**
   * Writes a change of a user asked by Rocket itself: sent at once when no operation on the user is open, queued
   * behind the open one otherwise. Each write is conditional on the user as read, so that an operation answered or
   * queued meanwhile makes it read the user again and take the right way.
   * @param user the user.
   * @param requestedBy the operator behind the change, if any.
   * @param buildItem builds the payload item from the operation id.
   * @throws BusinessException if the user keeps changing.
   * @throws DatabaseException if the operation cannot be written.
   */
  private async _requestOrQueueUserOperation(user: User, requestedBy: string | undefined, buildItem: (operationId: string) => UserPayloadDto): Promise<void> {
    const pendingOperationsService = await this._loadPendingOperationsService();
    const key = { productId: user.productId, id: user.id };
    let current: User | undefined = user;
    for (let attempt = 0; attempt < MAX_QUEUE_ATTEMPTS && current; attempt++) {
      const isOpen = current.syncState === SyncState.Pending || current.syncState === SyncState.Failed;
      const { operation, write } = pendingOperationsService.createWrite(this._userChange(current, requestedBy, buildItem, isOpen));
      const userWrite = isOpen
        ? this._userModel.transaction.update(
          key,
          this._queueFields([...(current.queuedOperationIds ?? []), operation.id]),
          { condition: this._withSameQueue(new Condition().where('syncState').in([SyncState.Pending, SyncState.Failed]), current) },
        )
        : this._userModel.transaction.update(
          key,
          toDynamooseUpdate<User>({ syncState: SyncState.Pending, pendingOperationId: operation.id }, ['failureReason']),
          { condition: new Condition().where('syncState').not().exists().or().where('syncState').eq(SyncState.InSync) },
        );
      try {
        await transaction([userWrite, write]);
      } catch (error) {
        if (!isTransactionCanceled(error)) {
          this._logger.error(`Error writing an operation of user ${user.id}`, error);
          throw new DatabaseException('An error occurred while asking the product for the change of the user.', error);
        }
        current = await this._userModel.get(key, { consistent: true, return: 'item' });
        continue;
      }
      if (!isOpen) {
        await pendingOperationsService.dispatch(operation);
      }
      return;
    }
    if (!current) {
      this._logger.warn(`User ${user.id} removed while a change was being asked; nothing to send.`);
      return;
    }
    throw new BusinessException(`User ${user.id} kept changing while a change was being asked to the product: try again.`, 'REQUEST_CHANGED');
  }

  /**
   * Extends a condition on a user with its queue as read, so that an operation queued meanwhile is not lost.
   * @param condition the condition on the user.
   * @param user the user as read.
   * @returns the extended condition.
   */
  private _withSameQueue(condition: InstanceType<typeof Condition>, user: User): InstanceType<typeof Condition> {
    const queued = user.queuedOperationIds ?? [];
    return queued.length > 0
      ? condition.and().where('queueKey').eq(queued.join(','))
      : condition.and().where('queueKey').not().exists();
  }

  /**
   * Writes a queue of a user with its key, the string `_withSameQueue` compares.
   * @param queued the operations waiting, oldest first; at least one.
   * @returns the fields to set.
   */
  private _queueFields(queued: string[]): Partial<User> {
    return { queuedOperationIds: queued, queueKey: queued.join(',') };
  }

  /**
   * Describes a change of a user for `createWrite`.
   * @param user the user.
   * @param requestedBy the operator behind the change, if any.
   * @param buildItem builds the payload item from the operation id.
   * @param deferred whether the operation waits for its turn.
   * @returns the new operation.
   */
  private _userChange(user: User, requestedBy: string | undefined, buildItem: (operationId: string) => UserPayloadDto, deferred: boolean): NewPendingOperation {
    return {
      productId: user.productId,
      kind: PendingOperationKind.UpdateUser,
      targetId: user.id,
      requestedBy,
      deferred,
      buildNotification: operationId => ({ productId: user.productId, operation: OperationEnum.Update, entityType: EntityTypeEnum.User, payload: [buildItem(operationId)] }),
    };
  }

  /**
   * Builds the writes that move a user past its open operation: to the first operation queued behind it, which
   * becomes due at once (the sweep sends it if this process stops), or else to the state the closing leaves.
   * The user must be read consistently: the writes hold only if its queue has not changed since.
   * @param user the user.
   * @param condition the condition that the user still has the operation being closed.
   * @param closed what the closing writes on the user when nothing is queued.
   * @param removed the fields the closing removes when nothing is queued.
   * @returns the writes, and the operation to send once they are committed.
   * @throws EntityNotFoundException if the queued operation does not exist.
   */
  private async _moveToNextOperationWrites(
    user: User,
    condition: InstanceType<typeof Condition>,
    closed: Partial<User>,
    removed: (keyof User)[],
  ): Promise<{ writes: TransactionWrite[]; next?: PendingOperationKey }> {
    const pendingOperationsService = await this._loadPendingOperationsService();
    const key = { productId: user.productId, id: user.id };
    const sameQueue = { condition: this._withSameQueue(condition, user) };
    const [nextId, ...rest] = user.queuedOperationIds ?? [];
    if (!nextId) {
      return { writes: [this._userModel.transaction.update(key, toDynamooseUpdate<User>(closed, removed), sameQueue)] };
    }
    const next = await pendingOperationsService.get({ productId: user.productId, id: nextId });
    return {
      writes: [
        this._userModel.transaction.update(
          key,
          toDynamooseUpdate<User>(
            { syncState: SyncState.Pending, pendingOperationId: nextId, ...(rest.length > 0 && this._queueFields(rest)) },
            ['failureReason', ...(rest.length > 0 ? [] : ['queuedOperationIds', 'queueKey'])],
          ),
          sameQueue,
        ),
        pendingOperationsService.releaseWrite(next, notification => notification),
      ],
      next: { productId: next.productId, id: next.id },
    };
  }

  /**
   * Sends the operation that took its turn on a user, once the transaction that released it is committed.
   * @param next the operation, if one was queued.
   */
  private async _sendNext(next?: PendingOperationKey): Promise<void> {
    if (!next) return;
    const pendingOperationsService = await this._loadPendingOperationsService();
    await pendingOperationsService.release([next]);
  }

  /**
   * Marks DELETED the users of a tenant the product deleted. Their open operations, creations included, and the
   * ones queued behind them are abandoned: the product has nothing left to apply them to. A user's writes stay in
   * one transaction; users already DELETED are skipped, so that a run stopped halfway can be repeated.
   * @param productId the product of the tenant.
   * @param tenantId the identifier of the tenant.
   * @throws DatabaseException if the users cannot be marked, or one changed meanwhile.
   */
  async markUsersOfTenantDeleted(productId: string, tenantId: string): Promise<void> {
    const pendingOperationsService = await this._loadPendingOperationsService();
    const abandoned: string[] = [];
    try {
      const users = (await this._userModel.query("productId").eq(productId).where("tenant").eq(tenantId).using("tenantIndex").consistent().all().exec())
        .filter(user => user.status !== UserStatus.Deleted);
      const chunks: TransactionWrite[][] = [[]];
      for (const user of users) {
        const open = user.syncState === SyncState.Pending && user.pendingOperationId ? [user.pendingOperationId] : [];
        const writes = [
          this._userModel.transaction.update(
            { productId, id: user.id },
            toDynamooseUpdate<User>({ status: UserStatus.Deleted, syncState: SyncState.InSync }, ['failureReason', 'queuedOperationIds', 'queueKey']),
            { condition: this._withSameQueue(new Condition().where('status').eq(user.status), user) },
          ),
          ...[...open, ...(user.queuedOperationIds ?? [])].map(id => pendingOperationsService.abandonWrite({ productId, id })),
        ];
        if (chunks[chunks.length - 1].length + writes.length > MAX_TRANSACTION_WRITES) chunks.push([]);
        chunks[chunks.length - 1].push(...writes);
        abandoned.push(...open);
      }
      for (const chunk of chunks.filter(writes => writes.length > 0)) {
        await transaction(chunk);
      }
    } catch (error) {
      this._logger.error(`Error marking deleted the users of tenant ${tenantId}`, error);
      throw new DatabaseException('An error occurred while marking deleted the users of the tenant.', error);
    }
    for (const id of abandoned) {
      await pendingOperationsService.cancelSchedule(id);
    }
  }

  /**
   * Removes for good a user deleted on the product, or a request discarded after the product's error.
   * Its operations stay in their table.
   * @param productId the product of the user.
   * @param id the identifier of the user.
   * @param scope the request scope.
   * @throws BusinessException if the user is neither DELETED nor CANCELLED.
   */
  async purgeUser(productId: string, id: string, scope: RequestScope): Promise<void> {
    assertCollaborator(scope, 'purgeUser');
    const user = await this.getUser(productId, id, scope);
    if (![UserStatus.Deleted, UserStatus.Cancelled].includes(user.status)) {
      throw new BusinessException('Only a user deleted on the product, or a discarded request, can be removed for good.', 'USER_NOT_PURGEABLE');
    }
    try {
      // A one-write transaction, since a conditional delete is typed as a request builder.
      await transaction([this._userModel.transaction.delete({ productId, id }, { condition: new Condition().where('status').eq(user.status) })]);
      this._logger.log(`User ${id} of product ${productId} removed for good.`);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        throw new BusinessException('The user changed while it was being removed: reload it.', 'REQUEST_CHANGED');
      }
      this._logger.error(`Error removing user ${id}`, error);
      throw new DatabaseException('An error occurred while removing the user.', error);
    }
  }

  /**
   * Removes for good the DELETED or CANCELLED users of a tenant being purged.
   * @param productId the product of the tenant.
   * @param tenantId the identifier of the tenant.
   * @throws DatabaseException if the users cannot be removed.
   */
  async purgeUsersOfTenant(productId: string, tenantId: string): Promise<void> {
    try {
      const users = (await this._userModel.query("productId").eq(productId).where("tenant").eq(tenantId).using("tenantIndex").all().exec())
        .filter(user => [UserStatus.Deleted, UserStatus.Cancelled].includes(user.status));
      for (let start = 0; start < users.length; start += 25) {
        await this._userModel.batchDelete(users.slice(start, start + 25).map(user => ({ productId, id: user.id })));
      }
    } catch (error) {
      this._logger.error(`Error removing the users of tenant ${tenantId}`, error);
      throw new DatabaseException('An error occurred while removing the users of the tenant.', error);
    }
  }

  /**
   * Marks a user DELETED, giving back its seat when it was active, and closes the operation that deleted it.
   * @param user the user.
   * @param operationKey the deletion asked by Rocket, absent when the product deleted the user on its own.
   * @throws DatabaseException if the user cannot be marked.
   */
  private async _markUserDeleted(user: User, operationKey?: PendingOperationKey): Promise<void> {
    const tenantsService = await this._loadTenantsService();
    const pendingOperationsService = await this._loadPendingOperationsService();
    const seatWrites = user.status === UserStatus.Active ? await tenantsService.releaseSeatWrites(user.productId, user.tenant) : [];
    try {
      await transaction([
        // Changes queued behind the deletion have nothing left to change.
        ...(user.queuedOperationIds ?? []).map(id => pendingOperationsService.abandonWrite({ productId: user.productId, id })),
        this._userModel.transaction.update(
          { productId: user.productId, id: user.id },
          toDynamooseUpdate<User>({ status: UserStatus.Deleted, syncState: SyncState.InSync }, ['failureReason', 'queuedOperationIds', 'queueKey']),
          { condition: this._withSameQueue(new Condition().where('status').eq(user.status), user) },
        ),
        ...seatWrites,
        ...(operationKey ? [pendingOperationsService.resolveWrite(operationKey, user.id)] : []),
      ]);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        this._logger.warn(`User ${user.id} changed while it was being marked deleted; left as it is.`);
        return;
      }
      this._logger.error(`Error marking deleted user ${user.id}`, error);
      throw new DatabaseException('An error occurred while marking the user deleted.', error);
    }
    if (operationKey) {
      await pendingOperationsService.cancelSchedule(operationKey.id);
    }
    this._logger.log(`User ${user.id} of product ${user.productId} deleted on the product.`);
  }

  /**
   * Records a change the product made on a user on its own, in the user's history.
   * @param productId the product of the user.
   * @param kind what the product did.
   * @param operation the operation of the product's message.
   * @param id the identifier of the user.
   * @param item the user as the product sent it.
   */
  private async _recordProductChange(productId: string, kind: PendingOperationKind, operation: OperationEnum, id: string, item: UserPayloadDto): Promise<void> {
    const pendingOperationsService = await this._loadPendingOperationsService();
    await pendingOperationsService.recordFromProduct(productId, kind, id, { productId, operation, entityType: EntityTypeEnum.User, payload: [item] });
  }

  /**
   * Batch updates all users of a given tenant with the provided data.
   * @param productId the product of the tenant.
   * @param tenantId the tenant ID to filter users by.
   * @param updateData the partial user data to apply to all matched users.
   */
  async batchUpdateUsers(productId: string, tenantId: string, updateData: Partial<User>): Promise<void> {
    try {
      const users = await this._userModel.query("productId").eq(productId).where("tenant").eq(tenantId).using("tenantIndex").all().exec();
      this._logger.log(`Batch updating ${users.length} users for tenant ID: ${tenantId}`);

      for (const user of users) {
        await this._userModel.update({ productId: user.productId, id: user.id }, updateData);
      }

      this._logger.log(`Batch update completed for tenant ID: ${tenantId}`);
    } catch (error) {
      this._logger.error(`Error batch updating users for tenant ID: ${tenantId}`, error);
      throw new DatabaseException('An error occurred while batch updating users.', error);
    }
  }

  /**
   * Asks the product to create a user on an active tenant: the user is written at once in REQUESTED with its
   * pending operation, then the request is sent; the product's answer moves it on through the SQS inbound queue.
   * @param user the user to ask for.
   * @param scope the request scope.
   * @returns the user in REQUESTED.
   * @throws BusinessException if the tenant is not active.
   */
  async notifyCreateUser(user: CreateUserDto, scope: RequestScope): Promise<ResponseUserDto> {
    // Read with the caller's scope: a reseller adds users only to the tenants of its subtree.
    const tenantsService = await this._loadTenantsService();
    const tenant = await tenantsService.getTenant(user.productId, user.tenant, scope);
    if (tenant.status !== TenantStatus.Active) {
      throw new BusinessException(`Tenant ${tenant.id} is not active: users are added once the product has created it.`, 'TENANT_NOT_ACTIVE');
    }
    const productsService = await this._loadProductsService();
    const product = await productsService.getProduct(user.productId);

    const request = await this.prepareUserRequest(user, {
      tenantName: tenant.name,
      productName: product.name,
      ...(tenant.resellerPath && { resellerPath: tenant.resellerPath }),
    }, { requestedBy: scope.system ? undefined : scope.sub });
    try {
      this._logger.log(`Requesting user ${request.user.id} to product ${user.productId}`);
      await transaction(request.writes);
    } catch (error) {
      this._logger.error(`Error writing the request of user ${request.user.id}`, error);
      throw new DatabaseException('An error occurred while requesting the user.', error);
    }
    const pendingOperationsService = await this._loadPendingOperationsService();
    await pendingOperationsService.dispatch(request.operation);
    return plainToInstance(ResponseUserDto, request.user);
  }

  /**
   * Asks the product to change a user, as a pending operation: the change lands on Rocket when the product
   * confirms it. Only one operation per user is open at a time.
   * @param productId the product of the user.
   * @param id the identifier of the user.
   * @param user the fields to change.
   * @param scope the request scope.
   * @returns the user, waiting for the product.
   * @throws BusinessException if the user is not on the product, another operation on it is still open, or the email
   * would change: it is the login on the product, fixed at the creation.
   */
  async requestUserUpdate(productId: string, id: string, user: UpdateUserDto, scope: RequestScope): Promise<ResponseUserDto> {
    const existing = await this._getUserReadyForOperation(productId, id);
    const email = (user as UpdateUserDto & { email?: string }).email;
    if (email !== undefined && email !== existing.email) {
      throw new BusinessException('The email of a user cannot change after its creation.', 'EMAIL_NOT_EDITABLE');
    }
    const { data, customAttributes, referent, ...standard } = user;
    return this._requestUserOperation(existing, PendingOperationKind.UpdateUser, OperationEnum.Update, scope, operationId => ({
      id,
      ...standard,
      data,
      tenant: existing.tenant,
      metadata: { customAttributes, ...(referent !== undefined && { referent }), rocketOperationId: operationId },
    }));
  }

  /**
   * Asks the product to delete a user, as a pending operation: the user becomes DELETED when the product confirms it.
   * @param productId the product of the user.
   * @param id the identifier of the user.
   * @param scope the request scope.
   * @returns the user, waiting for the product.
   * @throws BusinessException if the user is not on the product, or another operation on it is still open.
   */
  async requestUserDelete(productId: string, id: string, scope: RequestScope): Promise<ResponseUserDto> {
    assertCollaborator(scope, 'requestUserDelete');
    const existing = await this._getUserReadyForOperation(productId, id);
    return this._requestUserOperation(existing, PendingOperationKind.DeleteUser, OperationEnum.Delete, scope, operationId => ({
      id,
      tenant: existing.tenant,
      metadata: { rocketOperationId: operationId },
    } as UserPayloadDto));
  }

  /**
   * Reads a user the operator wants to change or delete on the product.
   * @param productId the product of the user.
   * @param id the identifier of the user.
   * @returns the user.
   * @throws EntityNotFoundException if the user does not exist.
   * @throws BusinessException if the user is not on the product, or another operation on it is still open.
   */
  private async _getUserReadyForOperation(productId: string, id: string): Promise<User> {
    const user = await this._userModel.get({ productId, id }, { consistent: true, return: 'item' });
    if (!user) {
      throw new EntityNotFoundException('User', id);
    }
    if (![UserStatus.Active, UserStatus.Inactive].includes(user.status)) {
      throw new BusinessException('Only an active or inactive user can be changed: the product has not created this one.', 'USER_NOT_ON_PRODUCT');
    }
    if (user.syncState && user.syncState !== SyncState.InSync) {
      throw new BusinessException('Another operation on the user is still waiting for the product.', 'USER_OPERATION_OPEN');
    }
    return user;
  }

  /**
   * Writes an operation on a user together with its `syncState`, and sends it once committed.
   * @param user the user the operation targets.
   * @param kind what the operation asks the product to do.
   * @param operation the operation of the notification.
   * @param scope the request scope, whose operator is recorded on the operation.
   * @param buildItem builds the payload item from the operation id.
   * @returns the user, waiting for the product.
   * @throws BusinessException if another operation on the user opened meanwhile.
   * @throws DatabaseException if the operation cannot be written.
   */
  private async _requestUserOperation(
    user: User,
    kind: PendingOperationKind,
    operation: OperationEnum,
    scope: RequestScope,
    buildItem: (operationId: string) => UserPayloadDto,
  ): Promise<ResponseUserDto> {
    const key = { productId: user.productId, id: user.id };
    const pendingOperationsService = await this._loadPendingOperationsService();
    const { operation: pending, write } = pendingOperationsService.createWrite({
      productId: user.productId,
      kind,
      targetId: user.id,
      requestedBy: scope.system ? undefined : scope.sub,
      buildNotification: operationId => ({ productId: user.productId, operation, entityType: EntityTypeEnum.User, payload: [buildItem(operationId)] }),
    });
    try {
      await transaction([
        this._userModel.transaction.update(
          key,
          toDynamooseUpdate<User>({ syncState: SyncState.Pending, pendingOperationId: pending.id }, ['failureReason']),
          { condition: new Condition().where('syncState').not().exists().or().where('syncState').eq(SyncState.InSync) },
        ),
        write,
      ]);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        throw new BusinessException('Another operation on the user is still waiting for the product.', 'USER_OPERATION_OPEN');
      }
      this._logger.error(`Error writing operation ${kind} of user ${user.id}`, error);
      throw new DatabaseException('An error occurred while asking the product for the operation.', error);
    }
    await pendingOperationsService.dispatch(pending);
    this._logger.log(`Operation ${kind} of user ${user.id} sent to product ${user.productId}.`);
    const { failureReason: _failureReason, ...rest } = user;
    return plainToInstance(ResponseUserDto, { ...rest, syncState: SyncState.Pending, pendingOperationId: pending.id });
  }

  /**
   * Tells whether a tenant has a referent on the product, who can accept its contract.
   * @param productId the product of the tenant.
   * @param tenantId the identifier of the tenant.
   * @returns whether an active or inactive user of the tenant is its referent.
   * @throws DatabaseException if the users cannot be read.
   */
  async hasReferent(productId: string, tenantId: string): Promise<boolean> {
    return !!(await this.getReferent(productId, tenantId));
  }

  /**
   * Returns the referent of a tenant on the product, active or inactive: a tenant suspended for an unpaid invoice has
   * its users inactive, and its referent is still told why.
   * @param productId the product of the tenant.
   * @param tenantId the identifier of the tenant.
   * @returns the referent, if the tenant has one.
   * @throws DatabaseException if the users cannot be read.
   */
  async getReferent(productId: string, tenantId: string): Promise<ResponseUserDto | undefined> {
    try {
      const users = await this._userModel.query('productId').eq(productId).where('tenant').eq(tenantId).using('tenantIndex').all().exec();
      const referent = users.find(user => user.referent && [UserStatus.Active, UserStatus.Inactive].includes(user.status));
      return referent ? plainToInstance(ResponseUserDto, referent) : undefined;
    } catch (error) {
      this._logger.error(`Error reading the referent of tenant ${tenantId}`, error);
      throw new DatabaseException('An error occurred while reading the referent of the tenant.', error);
    }
  }

  /**
   * Takes the referent mark away from the other users of a tenant, once the product confirmed a new referent: the
   * product does the same on its side, so each keeps one per tenant.
   * @param productId the product of the tenant.
   * @param tenantId the identifier of the tenant.
   * @param referentId the user who is now the referent.
   */
  private async _clearOtherReferents(productId: string, tenantId: string, referentId: string): Promise<void> {
    const users = await this._userModel.query('productId').eq(productId).where('tenant').eq(tenantId).using('tenantIndex').all().exec();
    await Promise.all(users.filter(user => user.referent && user.id !== referentId)
      .map(user => this._userModel.update({ productId, id: user.id }, toDynamooseUpdate<User>({}, ['referent']))));
  }

  /**
   * Retrieves the users of a product created in a month, via the monthIndex LSI.
   * @param productId the product of the users.
   * @param monthIndex the month index (format: "YYYY-MM").
   * @returns a list of users for the given month.
   */
  async getByMonthIndex(productId: string, monthIndex: string): Promise<ResponseUserDto[]> {
    try {
      const users = await this._userModel.query('productId').eq(productId).where('monthIndex').eq(monthIndex).using('monthIndex').all().exec();
      this._logger.log(`Retrieved ${users.length} users for monthIndex: ${monthIndex}.`);
      return users.map(user => plainToInstance(ResponseUserDto, user));

    } catch (error) {
      this._logger.error(`Error retrieving users by monthIndex: ${monthIndex}`, error);
      throw new DatabaseException('An error occurred while retrieving users by monthIndex.', error);
    }
  }

  /**
   * Retrieves the users of a product in a status, via the statusIndex LSI.
   * @param productId the product of the users.
   * @param status the user status to filter by.
   * @returns a list of users with the given status.
   */
  async getByStatus(productId: string, status: UserStatus): Promise<ResponseUserDto[]> {
    try {
      const users = await this._userModel.query('productId').eq(productId).where('status').eq(status).using('statusIndex').all().exec();
      this._logger.log(`Retrieved ${users.length} users for status: ${status}.`);
      return users.map(user => plainToInstance(ResponseUserDto, user));

    } catch (error) {
      this._logger.error(`Error retrieving users by status: ${status}`, error);
      throw new DatabaseException('An error occurred while retrieving users by status.', error);
    }
  }
}
