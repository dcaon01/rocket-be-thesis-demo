import { Injectable, Logger } from "@nestjs/common";
import {
  SchedulerClient,
  ConflictException,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  FlexibleTimeWindowMode,
  GetScheduleCommand,
  ResourceNotFoundException,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import { AppException } from "../../../../errors/exception-types";
import { EntityTypeEnum } from "../../../../commons/enums/entity-type.enum";
import { OperationEnum } from "../../../../commons/enums/operation.enum";
import { KEUS_STRIPE_ACCOUNT } from "../../constants/stripe-account.constant";
import { DunningStep } from "../../enums/dunning-step.enum";
import type { InvoiceKey } from "../../schemas/invoice.schema";

/**
 * Schedules the events of the charges via AWS EventBridge Scheduler:
 *   - the charge of the resellers on the 4th of a month, one schedule per month created by the first invoice charged
 *     in that month, so no recurring schedule is needed;
 *   - the dunning of an unpaid invoice, one schedule per invoice moved from step to step and deleted at collection.
 */
@Injectable()
export class ChargeSchedulerService {
  private readonly _logger = new Logger(ChargeSchedulerService.name);
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

    this._logger.log('ChargeSchedulerService initialized successfully');
  }

  /**
   * Makes sure the charge of a month is scheduled on its 4th day; an existing schedule is left as it is.
   * @param month the month of the charge (format: "YYYY-MM").
   */
  async ensureMonthlyCharge(month: string): Promise<void> {
    const name = `reseller-charge-${month}`;
    try {
      await this._client.send(new GetScheduleCommand({ Name: name }));
      return;
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        this._logger.error(`Error reading schedule: ${name}`, error);
        throw new AppException(`Failed to read schedule ${name}`, 500, error);
      }
    }

    // A charge date already past (an invoice issued late) fires within five minutes.
    const chargeAt = new Date(`${month}-04T06:00:00.000Z`);
    const at = chargeAt > new Date() ? chargeAt : new Date(Date.now() + 5 * 60 * 1000);
    const payload = {
      productId: KEUS_STRIPE_ACCOUNT,
      operation: OperationEnum.Update,
      entityType: EntityTypeEnum.ResellerCharge,
      payload: [{ month }],
    };
    try {
      await this._client.send(new CreateScheduleCommand({
        Name: name,
        ScheduleExpression: `at(${at.toISOString().replace(/\.\d{3}Z$/, '')})`,
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
        Target: {
          Arn: this._sqsQueueArn,
          RoleArn: this._roleArn,
          Input: JSON.stringify(payload),
        },
        ActionAfterCompletion: 'DELETE',
      }));
      this._logger.log(`Created schedule: ${name}`);
    } catch (error) {
      // Two invoices of the same month can create it together: the second finds it there.
      if (error instanceof ConflictException) return;
      this._logger.error(`Error scheduling: ${name}`, error);
      throw new AppException(`Failed to create schedule ${name}`, 500, error);
    }
  }

  /**
   * Schedules the next step of the dunning of an unpaid invoice, replacing the one before.
   * A date already past fires within five minutes.
   * @param key the billed party and the identifier of the invoice.
   * @param step the step to run.
   * @param at when to run it (ISO string).
   */
  async scheduleDunning(key: InvoiceKey, step: DunningStep, at: string): Promise<void> {
    const name = this._dunningScheduleName(key.id);
    const date = new Date(at) > new Date() ? new Date(at) : new Date(Date.now() + 5 * 60 * 1000);
    const input = {
      Name: name,
      ScheduleExpression: `at(${date.toISOString().replace(/\.\d{3}Z$/, '')})`,
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
      Target: {
        Arn: this._sqsQueueArn,
        RoleArn: this._roleArn,
        Input: JSON.stringify({
          productId: KEUS_STRIPE_ACCOUNT,
          operation: OperationEnum.Update,
          entityType: EntityTypeEnum.InvoiceDunning,
          payload: [{ billedPartyId: key.billedPartyId, id: key.id, step }],
        }),
      },
      ActionAfterCompletion: 'DELETE' as const,
    };
    try {
      try {
        await this._client.send(new UpdateScheduleCommand(input));
      } catch (error) {
        if (!(error instanceof ResourceNotFoundException)) throw error;
        await this._client.send(new CreateScheduleCommand(input));
      }
      this._logger.log(`Scheduled ${step} of invoice ${key.id} at ${date.toISOString()}.`);
    } catch (error) {
      this._logger.error(`Error scheduling: ${name}`, error);
      throw new AppException(`Failed to schedule ${name}`, 500, error);
    }
  }

  /**
   * Cancels the dunning of an invoice (idempotent): it was collected, voided or forgiven.
   * @param invoiceId the identifier of the invoice.
   */
  async cancelDunning(invoiceId: string): Promise<void> {
    const name = this._dunningScheduleName(invoiceId);
    try {
      await this._client.send(new DeleteScheduleCommand({ Name: name }));
      this._logger.log(`Deleted schedule: ${name}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) return;
      this._logger.error(`Error deleting schedule: ${name}`, error);
      throw new AppException(`Failed to delete schedule ${name}`, 500, error);
    }
  }

  /**
   * Builds the name of the dunning schedule of an invoice.
   * @param invoiceId the identifier of the invoice.
   * @returns the schedule name.
   */
  private _dunningScheduleName(invoiceId: string): string {
    return `invoice-dunning-${invoiceId}`;
  }
}
