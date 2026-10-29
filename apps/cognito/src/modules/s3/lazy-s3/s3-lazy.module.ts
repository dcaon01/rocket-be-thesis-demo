import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { S3Service } from "./services/s3.service";

/**
 * Lazy module for S3 operations.
 * Loaded on demand (via LazyModuleLoader): S3Service requires S3_BUCKET in its
 * constructor, so keeping it out of the bootstrap lets the app start without
 * the S3 environment configured.
 */
@Module({
  imports: [ConfigModule],
  providers: [S3Service],
  exports: [S3Service],
})
export class S3LazyModule {}
