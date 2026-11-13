import { Injectable, Logger } from "@nestjs/common";
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  FlexibleTimeWindowMode,
  UpdateScheduleCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-scheduler";
import { AppException } from "../../../../errors/exception-types";
import { EntityTypeEnum } from "../../../../commons/enums/entity-type.enum";
import { OperationEnum } from "../../../../commons/enums/operation.enum";
import { PendingOperationKey } from "../../schemas/pending-operation.schema";

/**
 * Service that schedules the next attempt of a pending operation via AWS EventBridge Scheduler.
 * Each operation has at most one one-time schedule, named after it, which delivers a
 * PENDING_OPERATION message to the SQS inbound queue at `nextAttemptAt`; the inbound
 * handler then sends the operation again if it is still pending.
 */
@Injectable()
export class PendingOperationSchedulerService {
  /** Logger instance for PendingOperationSchedulerService. */
  private readonly _logger = new Logger(PendingOperationSchedulerService.name);

  /** AWS EventBridge Scheduler client. */
  private readonly _client: SchedulerClient;

  /** ARN of the SQS inbound queue used as the schedule target. */
  private readonly _sqsQueueArn: string;

  /** ARN of the IAM role assumed by the scheduler to send messages to SQS. */
  private readonly _roleArn: string;

  /**
   * Constructor for PendingOperationSchedulerService.
   * Initializes the EventBridge Scheduler client with environment-specific credentials.
   */
  constructor() {
    const region = process.env.AWS_REGION;

    this._sqsQueueArn = process.env.SQS_INBOUND_QUEUE_ARN || '';
    this._roleArn = process.env.SCHEDULER_ROLE_ARN || '';

    if (process.env.NODE_ENV === 'development') {
      this._client = new SchedulerClient({
        region: region || 'eu-west-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
      });
    } else {
      this._client = new SchedulerClient({
        region: region || 'eu-west-1',
      });
    }

    this._logger.log('Pending operation scheduler service initialized successfully');
  }

  /**
   * Schedules the next attempt of an operation, replacing the previous schedule if any.
   * @param key the product and identifier of the operation.
   * @param at the moment of the next attempt (ISO 8601).
   * @throws AppException if the schedule cannot be written.
   */
  async scheduleAttempt(key: PendingOperationKey, at: string): Promise<void> {
    // EventBridge Scheduler refuses a past moment: a late call fires a minute from now.
    const date = new Date(Math.max(new Date(at).getTime(), Date.now() + 60_000));
    const input = {
      Name: this._scheduleName(key.id),
      ScheduleExpression: `at(${date.toISOString().replace(/\.\d{3}Z$/, '')})`,
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
      Target: {
        Arn: this._sqsQueueArn,
        RoleArn: this._roleArn,
        Input: JSON.stringify({
          productId: key.productId,
          operation: OperationEnum.Update,
          entityType: EntityTypeEnum.PendingOperation,
          payload: [{ id: key.id }],
        }),
      },
      ActionAfterCompletion: 'DELETE' as const,
    };

    try {
      await this._client.send(new UpdateScheduleCommand(input));
      this._logger.log(`Updated schedule: ${input.Name}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        await this._client.send(new CreateScheduleCommand(input));
        this._logger.log(`Created schedule: ${input.Name}`);
        return;
      }
      this._logger.error(`Error scheduling: ${input.Name}`, error);
      throw new AppException(`Failed to create schedule ${input.Name}`, 500, error);
    }
  }

  /**
   * Cancels the next attempt of an operation (idempotent).
   * @param operationId the identifier of the operation.
   * @throws AppException if the schedule cannot be deleted.
   */
  async cancelAttempt(operationId: string): Promise<void> {
    const name = this._scheduleName(operationId);
    try {
      await this._client.send(new DeleteScheduleCommand({ Name: name }));
      this._logger.log(`Cancelled schedule: ${name}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        return;
      }
      this._logger.error(`Error cancelling schedule: ${name}`, error);
      throw new AppException(`Failed to cancel schedule ${name}`, 500, error);
    }
  }

  /**
   * Builds the schedule name of an operation, within the 64 characters EventBridge allows.
   * @param operationId the identifier of the operation.
   * @returns the schedule name.
   */
  private _scheduleName(operationId: string): string {
    return `pending-op-${operationId}`;
  }
}
