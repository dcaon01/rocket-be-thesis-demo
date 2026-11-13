import { Module } from "@nestjs/common";
import { S3Controller } from "./controllers/s3.controller";

/**
 * Lightweight module for S3.
 * Only registers the controller - the actual S3Service is lazy-loaded
 * via S3LazyModule when a request arrives.
 */
@Module({
  controllers: [S3Controller],
})
export class S3Module {}
