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
import { RecipientTypeEnum } from "../../../../commons/enums/recipient-type.enum";
import { ProductMessageTemplate } from "../../../../commons/enums/product-message-template.enum";
import { TrialStatus } from "../../enums/trial-status.enum";

/**
 * Service for scheduling trial expiration events via AWS EventBridge Scheduler.
 * Creates one-time schedules that fire at the trial expiration date
 * to transition the trial status to EXPIRED.
 */
@Injectable()
export class TrialSchedulerService {
  /** Logger instance for TrialSchedulerService. */
  private readonly _logger = new Logger(TrialSchedulerService.name);

  /** AWS EventBridge Scheduler client. */
  private readonly _client: SchedulerClient;

  /** ARN of the SQS inbound queue used as the schedule target. */
  private readonly _sqsQueueArn: string;

  /** ARN of the IAM role assumed by the scheduler to send messages to SQS. */
  private readonly _roleArn: string;

  /**
   * Constructor for TrialSchedulerService.
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

    this._logger.log('TrialSchedulerService initialized successfully');
  }

  /**
   * Schedules the trial expiration event.
   * Fires at the expiration date to transition the trial to EXPIRED
   * via an SQS message processed by SqsInboundEventService.
   * @param params the scheduling parameters.
   */
  async scheduleExpiration(params: {
    trialId: string;
    productId: string;
    expiresAt: Date;
  }): Promise<void> {
    const scheduleName = this._expirationScheduleName(params.trialId);
    const scheduleDate = this._ensureFutureDate(new Date(params.expiresAt));
    const scheduleExpression = `at(${scheduleDate.toISOString().replace(/\.\d{3}Z$/, '')})`;

    const payload = {
      productId: params.productId,
      operation: OperationEnum.Update,
      entityType: EntityTypeEnum.Trial,
      payload: [{ id: params.trialId, status: TrialStatus.Expired }],
    };

    await this._createOrUpdateSchedule(scheduleName, scheduleExpression, payload);
  }

  /**
   * Cancels a scheduled trial expiration (idempotent).
   * @param trialId the trial ID.
   */
  async cancelExpiration(trialId: string): Promise<void> {
    await this._deleteSchedule(this._expirationScheduleName(trialId));
  }

  /**
   * Schedules the two reminder MESSAGE notifications for a trial:
   *  - midpoint of the trial window
   *  - 3 days before expiration
   *
   * Each schedule writes a MESSAGE notification to the SQS inbound queue;
   * the dispatcher then forwards it to the product via EventBridge.
   * @param params the scheduling parameters.
   */
  async scheduleReminders(params: {
    trialId: string;
    productId: string;
    productName: string;
    associatedEmail: string;
    activatedAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    const activatedMs = new Date(params.activatedAt).getTime();
    const expiresMs = new Date(params.expiresAt).getTime();
    const totalDays = Math.max(1, Math.ceil((expiresMs - activatedMs) / 86_400_000));

    const midpointDate = this._ensureFutureDate(new Date(activatedMs + (expiresMs - activatedMs) / 2));
    const threeDaysDate = this._ensureFutureDate(new Date(expiresMs - 3 * 86_400_000));

    const midDays = Math.max(1, Math.ceil(totalDays / 2));

    await this._createOrUpdateSchedule(
      this._reminderMidScheduleName(params.trialId),
      this._atExpression(midpointDate),
      this._buildReminderPayload(
        params.productId,
        params.associatedEmail,
        midDays,
        `Ciao! Sei a metà del tuo trial ${params.productName}.\nIn caso volessi acquistare la licenza ti ricordiamo che puoi contattare un nostro commerciale di riferimento.`,
      ),
    );

    await this._createOrUpdateSchedule(
      this._reminderThreeDaysScheduleName(params.trialId),
      this._atExpression(threeDaysDate),
      this._buildReminderPayload(
        params.productId,
        params.associatedEmail,
        3,
        `Ciao! Il tuo trial ${params.productName} scadrà a breve.\nIn caso volessi acquistare la licenza ti ricordiamo che puoi contattare un nostro commerciale di riferimento.`,
      ),
    );
  }

  /**
   * Cancels both reminder schedules (idempotent).
   * @param trialId the trial ID.
   */
  async cancelReminders(trialId: string): Promise<void> {
    await this._deleteSchedule(this._reminderMidScheduleName(trialId));
    await this._deleteSchedule(this._reminderThreeDaysScheduleName(trialId));
  }

  /**
   * Builds the EventBridge schedule name for trial expiration.
   * @param trialId the trial ID.
   * @returns the sanitized schedule name.
   */
  private _expirationScheduleName(trialId: string): string {
    return `trial-expiration-${trialId.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
  }

  /**
   * Builds the schedule name for the midpoint reminder.
   * @param trialId the trial ID.
   */
  private _reminderMidScheduleName(trialId: string): string {
    return `trial-reminder-mid-${trialId.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
  }

  /**
   * Builds the schedule name for the 3-days-before reminder.
   * @param trialId the trial ID.
   */
  private _reminderThreeDaysScheduleName(trialId: string): string {
    return `trial-reminder-3d-${trialId.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
  }

  /**
   * Formats a date as an `at(YYYY-MM-DDTHH:mm:ss)` Scheduler expression.
   * @param date the date to format.
   */
  private _atExpression(date: Date): string {
    return `at(${date.toISOString().replace(/\.\d{3}Z$/, '')})`;
  }

  /**
   * Builds the MESSAGE payload written to SQS by reminder schedules.
   * @param productId target product.
   * @param tenantId tenant recipient.
   * @param daysRemaining number of days remaining at fire time.
   */
  private _buildReminderPayload(
    productId: string,
    associatedEmail: string,
    daysRemaining: number,
    message: string,
  ): object {
    return {
      productId,
      operation: OperationEnum.Create,
      entityType: EntityTypeEnum.Message,
      payload: [
        {
          recipientType: RecipientTypeEnum.User,
          to: associatedEmail,
          subject: 'Promemoria trial',
          template: ProductMessageTemplate.TrialResidue,
          body: { message, days: daysRemaining },
        },
      ],
    };
  }

  /**
   * Ensures the date is in the future. If past, sets it to 5 minutes from now.
   * @param date the date to check.
   * @returns the date, adjusted if necessary.
   */
  private _ensureFutureDate(date: Date): Date {
    const now = new Date();
    if (date <= now) {
      date.setTime(now.getTime() + 5 * 60 * 1000);
    }
    return date;
  }

  /**
   * Creates or updates an EventBridge schedule.
   * Attempts an update first; if the schedule does not exist, creates it.
   * @param scheduleName the unique name for the schedule.
   * @param scheduleExpression the schedule expression (e.g., `at(2026-06-30T23:59:59)`).
   * @param payload the SQS message payload to deliver when the schedule fires.
   */
  private async _createOrUpdateSchedule(
    scheduleName: string,
    scheduleExpression: string,
    payload: object,
  ): Promise<void> {
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
   * Deletes an EventBridge schedule (idempotent).
   * Silently succeeds if the schedule does not exist.
   * @param scheduleName the name of the schedule to delete.
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
