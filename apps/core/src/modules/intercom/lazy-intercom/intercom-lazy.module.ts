import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppException } from '../../../errors/exception-types';
import { IntercomService } from './services/intercom.service';

/**
 * Lazy module for Intercom operations.
 * This module is lazy-loaded when the Intercom service is accessed via LazyModuleLoader
 * (from MetricsService). It has no controller: the endpoints live in MetricsController.
 */
@Module({
  imports: [
    ConfigModule,
    AppException,
  ],
  providers: [IntercomService],
  exports: [IntercomService],
})
export class IntercomLazyModule {}
