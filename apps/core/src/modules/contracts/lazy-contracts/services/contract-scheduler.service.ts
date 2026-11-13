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
import { ContractEvent } from "../../enums/contract-event.enum";
import { subtractDays } from "../../helpers/contract-dates.helper";

/** Days before the renewal the notice goes out (UR-RK-405): ahead of the term of cancellation, so it can still be used. */
const RENEWAL_NOTICE_DAYS = 90;

/**
 * Schedules the events of the contracts via AWS EventBridge Scheduler: renewal and its notice, termination, billing
 * of the reseller, dunning of a payment never set up, billing of the seats added during the day.
 * Each event has one schedule per contract, fired once on the SQS inbound queue and then deleted.
 */
@Injectable()
export class ContractSchedulerService {
  /** Logger instance for ContractSchedulerService. */
  private readonly _logger = new Logger(ContractSchedulerService.name);

  /** Client of EventBridge Scheduler. */
  private readonly _client: SchedulerClient;

  /** SQS inbound queue the schedules deliver to. */
  private readonly _sqsQueueArn: string;

  /** Role EventBridge Scheduler takes to send to the queue. */
  private readonly _roleArn: string;

  /**
   * Constructor for ContractSchedulerService: builds the client with the credentials of the environment.
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

    this._logger.log('ContractSchedulerService initialized successfully');
  }

  /**
   * Schedules the renewal of a contract at its renewal date, and the notice of the renewal ninety days ahead of it
   * (UR-RK-405).
   * @param productId the product of the contract.
   * @param contractId the contract ID.
   * @param renewalDate the renewal date (ISO string).
   */
  async scheduleRenewal(productId: string, contractId: string, renewalDate: string): Promise<void> {
    await this._createOrUpdateSchedule(this._renewalScheduleName(contractId), renewalDate, productId, contractId, ContractEvent.Renew);

    const noticeDate = subtractDays(renewalDate, RENEWAL_NOTICE_DAYS);
    await this._createOrUpdateSchedule(this._renewalNoticeScheduleName(contractId), noticeDate, productId, contractId, ContractEvent.RenewalNotice);
  }

  /**
   * Cancels a scheduled renewal and its notice (idempotent).
   * @param contractId the contract ID.
   */
  async cancelRenewal(contractId: string): Promise<void> {
    await this._deleteSchedule(this._renewalScheduleName(contractId));
    await this._deleteSchedule(this._renewalNoticeScheduleName(contractId));
  }

  /**
   * Schedules the termination of a contract at its termination date.
   * @param productId the product of the contract.
   * @param contractId the contract ID.
   * @param terminationDate the termination date (ISO string).
   */
  async scheduleTermination(productId: string, contractId: string, terminationDate: string): Promise<void> {
    await this._createOrUpdateSchedule(this._terminationScheduleName(contractId), terminationDate, productId, contractId, ContractEvent.Terminate);
  }

  /**
   * Cancels a scheduled termination (idempotent).
   * @param contractId the contract ID.
   */
  async cancelTermination(contractId: string): Promise<void> {
    await this._deleteSchedule(this._terminationScheduleName(contractId));
  }

  /**
   * Schedules the billing of the next period of an indirect contract.
   * @param productId the product of the contract.
   * @param contractId the contract ID.
   * @param billingDate the billing date (ISO string).
   */
  async scheduleBilling(productId: string, contractId: string, billingDate: string): Promise<void> {
    await this._createOrUpdateSchedule(this._billingScheduleName(contractId), billingDate, productId, contractId, ContractEvent.Bill);
  }

  /**
   * Cancels a scheduled billing (idempotent).
   * @param contractId the contract ID.
   */
  async cancelBilling(contractId: string): Promise<void> {
    await this._deleteSchedule(this._billingScheduleName(contractId));
  }

  /**
   * Schedules the next day of the dunning of a contract whose payment is not set up.
   * @param productId the product of the contract.
   * @param contractId the contract ID.
   * @param at the date of the step (ISO string).
   */
  async schedulePaymentDunning(productId: string, contractId: string, at: string): Promise<void> {
    await this._createOrUpdateSchedule(this._paymentDunningScheduleName(contractId), at, productId, contractId, ContractEvent.PaymentDunning);
  }

  /**
   * Cancels the dunning of a payment not set up (idempotent).
   * @param contractId the contract ID.
   */
  async cancelPaymentDunning(contractId: string): Promise<void> {
    await this._deleteSchedule(this._paymentDunningScheduleName(contractId));
  }

  /**
   * Schedules the billing of the seats a contract added but not invoiced yet, once a day at most: every increase of the
   * day moves it to the same time, and one after the run of the day brings it five minutes ahead.
   * @param productId the product of the contract.
   * @param contractId the contract ID.
   * @param at when the seats are billed (ISO string).
   */
  async scheduleSeatBilling(productId: string, contractId: string, at: string): Promise<void> {
    await this._createOrUpdateSchedule(this._seatBillingScheduleName(contractId), at, productId, contractId, ContractEvent.SeatBilling);
  }

  /**
   * Names the schedule of the renewal of a contract, safe for EventBridge.
   * @param contractId the contract ID.
   * @returns the name of the schedule.
   */
  private _renewalScheduleName(contractId: string): string {
    return `contract-renewal-${contractId.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
  }

  /**
   * Names the schedule of the notice of the renewal of a contract, safe for EventBridge.
   * @param contractId the contract ID.
   * @returns the name of the schedule.
   */
  private _renewalNoticeScheduleName(contractId: string): string {
    return `contract-renewal-notice-${contractId.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
  }

  /**
   * Names the schedule of the termination of a contract, safe for EventBridge.
   * @param contractId the contract ID.
   * @returns the name of the schedule.
   */
  private _terminationScheduleName(contractId: string): string {
    return `contract-termination-${contractId.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
  }

  /**
   * Names the schedule of the billing of the reseller of a contract, safe for EventBridge.
   * @param contractId the contract ID.
   * @returns the name of the schedule.
   */
  private _billingScheduleName(contractId: string): string {
    return `contract-billing-${contractId.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
  }

  /**
   * Names the schedule of the dunning of the payment of a contract, safe for EventBridge.
   * @param contractId the contract ID.
   * @returns the name of the schedule.
   */
  private _paymentDunningScheduleName(contractId: string): string {
    return `contract-payment-${contractId.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
  }

  /**
   * Names the schedule of the billing of the seats of a contract, safe for EventBridge.
   * @param contractId the contract ID.
   * @returns the name of the schedule.
   */
  private _seatBillingScheduleName(contractId: string): string {
    return `contract-seats-${contractId.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
  }

  /**
   * Moves a date already past to five minutes from now: EventBridge refuses a one-time schedule in the past.
   * @param date the date of the event.
   * @returns the same date, or five minutes from now.
   */
  private _ensureFutureDate(date: Date): Date {
    const now = new Date();
    if (date <= now) {
      date.setTime(now.getTime() + 5 * 60 * 1000);
    }

    return date;
  }

  /**
   * Creates the schedule of an event of a contract, or moves it if it exists: a contract has one schedule per event.
   * @param scheduleName the name of the schedule.
   * @param at when the event fires (ISO string).
   * @param productId the product of the contract.
   * @param contractId the contract ID.
   * @param event the event.
   * @throws AppException if EventBridge refuses the schedule.
   */
  private async _createOrUpdateSchedule(
    scheduleName: string,
    at: string,
    productId: string,
    contractId: string,
    event: ContractEvent,
  ): Promise<void> {
    const scheduleDate = this._ensureFutureDate(new Date(at));
    const scheduleExpression = `at(${scheduleDate.toISOString().replace(/\.\d{3}Z$/, '')})`;

    const payload = {
      productId,
      operation: OperationEnum.Update,
      entityType: EntityTypeEnum.Contract,
      payload: [{ contractId, event }],
    };
    const input = {
      Name: scheduleName,
      ScheduleExpression: scheduleExpression,
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

  /**
   * Deletes a schedule; one already fired or never created is not an error.
   * @param scheduleName the name of the schedule.
   * @throws AppException if EventBridge refuses the deletion.
   */
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
