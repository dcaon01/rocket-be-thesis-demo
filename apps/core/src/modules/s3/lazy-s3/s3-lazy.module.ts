import { Module } from '@nestjs/common';
import { S3Service } from './services/s3.service';
import { AppException } from '../../../errors/exception-types';

/**
 * Lazy module for S3 operations.
 * This module is lazy-loaded when S3 services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    AppException,
  ],
  providers: [S3Service],
  exports: [S3Service]
})
export class S3LazyModule {}
