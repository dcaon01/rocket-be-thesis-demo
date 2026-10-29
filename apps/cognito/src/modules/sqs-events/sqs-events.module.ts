import { Module } from "@nestjs/common";
import { SqsEventsController } from "./controllers/sqs-events.controller";

/**
 * Lightweight SQS Events Module for Cognito app.
 * Only registers the controller - the actual SqsS3EventService is lazy-loaded
 * via SqsEventsLazyModule when an event arrives.
 */
@Module({
  controllers: [SqsEventsController],
})
export class SqsEventsModule {}
