import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppException } from '../../../errors/exception-types';
import { SentryService } from './services/sentry.service';

/**
 * Lazy module for Sentry operations.
 * This module is lazy-loaded when the Sentry service is accessed via LazyModuleLoader
 * (from MetricsService). It has no controller: the endpoints live in MetricsController.
 */
@Module({
  imports: [
    ConfigModule,
    AppException,
  ],
  providers: [SentryService],
  exports: [SentryService],
})
export class SentryLazyModule {}
