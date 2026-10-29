import { Body, Controller, HttpStatus, Logger, Post } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiExcludeController, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { SQSEvent, S3Event } from "aws-lambda";
import { SqsS3EventService } from "../lazy-sqs-events/services/sqs-s3-event.service";

/**
 * Controller for handling SQS events in Cognito app.
 * Processes S3 event notifications for profile photo uploads.
 */
@ApiExcludeController()
@ApiTags("SQS Events")
@Controller("events")
export class SqsEventsController {
  /** Logger instance for SqsEventsController. */
  private readonly _logger = new Logger(SqsEventsController.name);

  /** Lazy-loaded SQS S3 event service */
  private _sqsS3EventService: SqsS3EventService | null = null;

  /**
   * Constructor for SqsEventsController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(private readonly _lazyModuleLoader: LazyModuleLoader) {}

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
   * SQS event handler endpoint.
   * Receives SQS Lambda events via AWS_LWA_PASS_THROUGH_PATH and processes
   * S3 event notifications.
   * @param body The SQS Lambda event.
   * @returns Acknowledgment of the event.
   */
  @Post()
  @ApiOperation({
    summary: 'SQS event handler endpoint',
    description: 'Receives SQS events forwarded by Lambda (via AWS LWA). Processes S3 event notifications for profile photo uploads.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Event processed successfully.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Error processing event.'
  })
  async handleSqsEvent(
    @Body() body: SQSEvent
  ): Promise<{ message: string }> {
    try {
      for (const record of body.Records) {
        this._logger.log(`Processing SQS record ${record.messageId} from ${record.eventSourceARN} | body: ${record.body}`);
        const s3Event = JSON.parse(record.body) as S3Event;
        const sqsS3EventService = await this._loadSqsS3EventService();
        await sqsS3EventService.handleS3Event(s3Event);
      }

      return { message: 'Events processed' };

    } catch (error) {
      this._logger.error('Error processing SQS event', error);
      throw error;
    }
  }
}
