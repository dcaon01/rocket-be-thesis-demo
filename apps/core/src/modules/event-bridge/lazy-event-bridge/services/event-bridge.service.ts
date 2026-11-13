import { Injectable, Logger } from "@nestjs/common";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { AppException } from "../../../../errors/exception-types";
import type { RocketNotificationDto } from "../../../../commons/dtos/rocket-notification.dto";
import type { MessagePayloadDto } from "../../../../commons/dtos/message-payload.dto";
import { EntityTypeEnum } from "../../../../commons/enums/entity-type.enum";
import { OperationEnum } from "../../../../commons/enums/operation.enum";
import { integrationsEnabled } from "../../../../commons/integrations/integrations.helper";
import { DemoProductService } from "./demo-product.service";

/**
 * Service for sending outbound notifications via AWS EventBridge.
 * Used by other modules to notify external products of entity changes. With the integrations off there are no
 * products to reach: `DemoProductService` answers in their place.
 */
@Injectable()
export class EventBridgeService {
  /** Logger instance for EventBridgeService. */
  private readonly _logger = new Logger(EventBridgeService.name);

  /** EventBridge client instance. */
  private readonly _client: EventBridgeClient;

  /** EventBridge event bus name. */
  private readonly _busName: string;

  /** EventBridge event source. */
  private readonly _source: string;

  /**
   * Constructor for EventBridgeService: builds the client with the credentials of the environment.
   * @param _demoProductService the stand-in for the products while the integrations are off.
   */
  constructor(
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    private readonly _demoProductService: DemoProductService,
  ) {
    const region = process.env.AWS_REGION;

    this._busName = process.env.EVENTBRIDGE_BUS_NAME || 'default';
    this._source = process.env.EVENTBRIDGE_SOURCE || 'rocket';

    if (process.env.NODE_ENV === 'development') {
      this._client = new EventBridgeClient({
        region: region || 'eu-west-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
      });
    } else {
      this._client = new EventBridgeClient({
        region: region || 'eu-west-1',
      });
    }

    this._logger.log('EventBridge service initialized successfully');
  }

  /**
   * Sends a notification via EventBridge.
   * EventBridge rules route to the correct microservice based on `detail.productId`. With the integrations off,
   * the answer of the product goes straight to the inbound queue instead.
   * @param notification the RocketNotificationDto to send.
   */
  async sendNotification(notification: RocketNotificationDto): Promise<void> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      return this._demoProductService.answer(notification);
    }

    this._logger.log(`Sending EventBridge notification: ${JSON.stringify(notification)}`);

    try {
      const command = new PutEventsCommand({
        Entries: [{
          Source: this._source,
          DetailType: 'rocket-notification',
          Detail: JSON.stringify(notification),
          EventBusName: this._busName,
        }],
      });

      const result = await this._client.send(command);

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        const entry = result.Entries?.[0];
        this._logger.error(`EventBridge failed entry: ${JSON.stringify({ notification: notification.productId, error: entry?.ErrorCode, message: entry?.ErrorMessage })}`);
        throw new AppException(
          `Failed to send EventBridge notification for product ${notification.productId}`,
          500,
        );
      }

      this._logger.log(`EventBridge notification sent successfully for product ${notification.productId}`);
    } catch (error) {
      if (error instanceof AppException) throw error;

      this._logger.error(`Error sending EventBridge notification for product ${notification.productId}`, error);
      throw new AppException(
        'Failed to send EventBridge notification',
        500,
        error,
      );
    }
  }

  /**
   * Sends a generic MESSAGE notification to a product.
   * Rocket only forwards the message; the receiving product is responsible
   * for the actual email delivery via its own mail service.
   * @param productId the identifier of the target product.
   * @param message the message payload (recipient, subject, body).
   */
  async sendMessage(productId: string, message: MessagePayloadDto): Promise<void> {
    return this.sendNotification({
      productId,
      operation: OperationEnum.Create,
      entityType: EntityTypeEnum.Message,
      payload: [message],
    });
  }
}
