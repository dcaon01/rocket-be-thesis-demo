import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { S3LazyModule } from "../../s3/lazy-s3/s3-lazy.module";
import { SqsS3EventService } from "./services/sqs-s3-event.service";

/**
 * Lazy module for SQS event handling.
 * Loaded on demand (via LazyModuleLoader): SqsS3EventService requires
 * COGNITO_USER_POOL_ID in its constructor (and depends on S3Service), so
 * keeping it out of the bootstrap lets the app start without the environment
 * configured.
 */
@Module({
  imports: [ConfigModule, S3LazyModule],
  providers: [SqsS3EventService],
  exports: [SqsS3EventService],
})
export class SqsEventsLazyModule {}
