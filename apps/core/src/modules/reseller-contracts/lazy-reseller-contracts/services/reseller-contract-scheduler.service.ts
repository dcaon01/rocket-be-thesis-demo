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
import { KEUS_FEE_PRODUCT_ID } from "../../../stripe/helpers/keus-stripe-account.helper";
import { ResellerContractStatus } from "../../enums/reseller-contract-status.enum";

/**
 * Schedules the renewal and end events of the reseller contracts via AWS EventBridge Scheduler.
 * Each event reaches the SQS inbound queue as a RESELLER_CONTRACT update.
 */
@Injectable()
export class ResellerContractSchedulerService {
  private readonly _logger = new Logger(ResellerContractSchedulerService.name);
  private readonly _client: SchedulerClient;
  private readonly _sqsQueueArn: string;
  private readonly _roleArn: string;

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

    this._logger.log('ResellerContractSchedulerService initialized successfully');
  }

  /**
   * Schedules the annual renewal of a reseller contract.
   * @param params the contract, its reseller, the renewal date and the validity years after it.
   */
  async scheduleRenewal(params: {
    contractId: string;
    resellerId: string;
    renewalDate: Date;
    validityYears: number;
  }): Promise<void> {
    const scheduleDate = this._ensureFutureDate(new Date(params.renewalDate));
    await this._createOrUpdateSchedule(this._renewalScheduleName(params.contractId), scheduleDate, {
      contractId: params.contractId,
      resellerId: params.resellerId,
      validityYears: params.validityYears,
    });
  }

  /**
   * Cancels a scheduled renewal (idempotent).
   * @param contractId the contract ID.
   */
  async cancelRenewal(contractId: string): Promise<void> {
    await this._deleteSchedule(this._renewalScheduleName(contractId));
  }

  /**
   * Schedules the end of a reseller contract, one hour before its end date.
   * @param params the contract, its reseller and the end date.
   */
  async scheduleEnd(params: {
    contractId: string;
    resellerId: string;
    endDate: Date;
  }): Promise<void> {
    const scheduleDate = this._ensureFutureDate(new Date(params.endDate.getTime() - 60 * 60 * 1000));
    await this._createOrUpdateSchedule(this._endScheduleName(params.contractId), scheduleDate, {
      contractId: params.contractId,
      resellerId: params.resellerId,
      status: ResellerContractStatus.Ended,
    });
  }

  /**
   * Cancels a scheduled end (idempotent).
   * @param contractId the contract ID.
   */
  async cancelEnd(contractId: string): Promise<void> {
    await this._deleteSchedule(this._endScheduleName(contractId));
  }

  private _renewalScheduleName(contractId: string): string {
    return `reseller-contract-renewal-${contractId.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
  }

  private _endScheduleName(contractId: string): string {
    return `reseller-contract-end-${contractId.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
  }

  /**
   * Ensures the date is in the future. If past, sets it to 5 minutes from now.
   */
  private _ensureFutureDate(date: Date): Date {
    const now = new Date();
    if (date <= now) {
      date.setTime(now.getTime() + 5 * 60 * 1000);
    }
    return date;
  }

  private async _createOrUpdateSchedule(scheduleName: string, scheduleDate: Date, item: object): Promise<void> {
    const payload = {
      productId: KEUS_FEE_PRODUCT_ID,
      operation: OperationEnum.Update,
      entityType: EntityTypeEnum.ResellerContract,
      payload: [item],
    };
    const input = {
      Name: scheduleName,
      ScheduleExpression: `at(${scheduleDate.toISOString().replace(/\.\d{3}Z$/, '')})`,
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
      Target: {
        Arn: this._sqsQueueArn,
        RoleArn: this._roleArn,
        Input: JSON.stringify(payload),
      },
      ActionAfterCompletion: 'DELETE' as const,
    };

    try {
      await this._client.send(new UpdateScheduleCommand(input));
      this._logger.log(`Updated schedule: ${scheduleName}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        await this._client.send(new CreateScheduleCommand(input));
        this._logger.log(`Created schedule: ${scheduleName}`);
      } else {
        this._logger.error(`Error scheduling: ${scheduleName}`, error);
        throw new AppException(`Failed to create schedule ${scheduleName}`, 500, error);
      }
    }
  }

  private async _deleteSchedule(scheduleName: string): Promise<void> {
    try {
      await this._client.send(new DeleteScheduleCommand({ Name: scheduleName }));
      this._logger.log(`Cancelled schedule: ${scheduleName}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        this._logger.log(`No schedule found to cancel: ${scheduleName}`);
        return;
      }
      this._logger.error(`Error cancelling schedule: ${scheduleName}`, error);
      throw new AppException(`Failed to cancel schedule ${scheduleName}`, 500, error);
    }
  }
}
