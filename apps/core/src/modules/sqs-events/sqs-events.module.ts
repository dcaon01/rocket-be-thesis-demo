import { Module } from "@nestjs/common";
import { SqsEventsController } from "./controllers/sqs-events.controller";

/**
 * Lightweight module for SQS Events.
 * Only registers the controller - the actual event services are lazy-loaded
 * via SqsEventsLazyModule when a request arrives.
 */
@Module({
  controllers: [SqsEventsController],
})
export class SqsEventsModule {}
