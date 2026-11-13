import { Body, Controller, HttpStatus, Logger, Post } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { SQSEvent, S3Event } from "aws-lambda";
import { SqsS3EventService } from "../lazy-sqs-events/services/sqs-s3-event.service";
import { SqsInboundEventService } from "../lazy-sqs-events/services/sqs-inbound-event.service";
import { ApiExcludeController } from '@nestjs/swagger';

/**
 * Controller for handling SQS events.
 * Uses lazy loading to load event services only when needed.
 */
@ApiExcludeController()
@ApiTags("SQS Events")
@Controller("events")
export class SqsEventsController {
  /** Logger instance for SqsEventsController. */
  private readonly _logger = new Logger(SqsEventsController.name);

  /** Lazy-loaded SQS S3 event service */
  private _sqsS3EventService: SqsS3EventService | null = null;

  /** Lazy-loaded SQS inbound event service */
  private _sqsInboundEventService: SqsInboundEventService | null = null;

  /**
   * Constructor for SqsEventsController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) {}

  /**
   * Lazy loads the SqsS3EventService from its module.
   * @returns A Promise resolving to the SqsS3EventService instance.
   */
  private async _loadSqsS3EventService(): Promise<SqsS3EventService> {
    if (!this._sqsS3EventService) {
      const { SqsEventsLazyModule } = await import(
        "../lazy-sqs-events/sqs-events-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => SqsEventsLazyModule,
      );
      this._sqsS3EventService = moduleRef.get<SqsS3EventService>(SqsS3EventService);
    }
    return this._sqsS3EventService;
  }

  /**
   * Lazy loads the SqsInboundEventService from its module.
   * @returns A Promise resolving to the SqsInboundEventService instance.
   */
  private async _loadSqsInboundEventService(): Promise<SqsInboundEventService> {
    if (!this._sqsInboundEventService) {
      const { SqsEventsLazyModule } = await import(
        "../lazy-sqs-events/sqs-events-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => SqsEventsLazyModule,
      );
      this._sqsInboundEventService = moduleRef.get<SqsInboundEventService>(SqsInboundEventService);
    }
    return this._sqsInboundEventService;
  }

  /**
   * SQS event handler endpoint.
   * Receives SQS Lambda events via AWS_LWA_PASS_THROUGH_PATH and routes
   * them based on eventSourceARN.
   * @param body The SQS Lambda event.
   * @returns Acknowledgment of the event.
   */
  @Post()
  @ApiOperation({
    summary: 'SQS event handler endpoint',
    description: 'Receives SQS events forwarded by Lambda (via AWS LWA). Routes based on queue ARN to S3 event or inbound message handlers.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Event processed successfully.'
  })
  async handleSqsEvent(
    @Body() body: SQSEvent
  ): Promise<{ message: string }> {
    const s3QueueName = process.env.SQS_S3_EVENTS_QUEUE_NAME ?? 'core-s3-events';
    const inboundQueueName = process.env.SQS_INBOUND_QUEUE_NAME ?? 'inbound';

    try {
      for (const record of body.Records) {
        this._logger.log(`Processing SQS record ${record.messageId} from ${record.eventSourceARN} | body: ${record.body}`);

        if (record.eventSourceARN.includes(s3QueueName)) {
          const s3Event = JSON.parse(record.body) as S3Event;
          const sqsS3EventService = await this._loadSqsS3EventService();
          await sqsS3EventService.handleS3Event(s3Event);

        } else if (record.eventSourceARN.includes(inboundQueueName)) {
          const messageBody: unknown = JSON.parse(record.body);
          const sqsInboundEventService = await this._loadSqsInboundEventService();
          await sqsInboundEventService.handleInboundMessage(messageBody);

        } else {
          this._logger.warn(`Unknown SQS source ARN: ${record.eventSourceARN}`);
        }
      }

      return { message: 'Events processed' };

    } catch (error) {
      this._logger.error('Error processing SQS event', error);
      throw error;
    }
  }
}
