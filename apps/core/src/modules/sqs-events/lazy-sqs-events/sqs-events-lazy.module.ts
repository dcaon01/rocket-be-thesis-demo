import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SqsS3EventService } from './services/sqs-s3-event.service';
import { SqsInboundEventService } from './services/sqs-inbound-event.service';

/**
 * Lazy module for SQS event operations.
 * This module is lazy-loaded when SQS event services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
  ],
  providers: [
    SqsS3EventService,
    SqsInboundEventService,
  ],
  exports: [
    SqsS3EventService,
    SqsInboundEventService,
  ]
})
export class SqsEventsLazyModule {}
