import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppException } from '../../../errors/exception-types';
import { MixpanelService } from './services/mixpanel.service';

/**
 * Lazy module for Mixpanel operations.
 * This module is lazy-loaded when the Mixpanel service is accessed via LazyModuleLoader
 * (from MetricsService). Used for dynamic lazy loading - does not include a controller;
 * the endpoint lives in MetricsController.
 */
@Module({
  imports: [
    ConfigModule,
    AppException,
  ],
  providers: [MixpanelService],
  exports: [MixpanelService],
})
export class MixpanelLazyModule {}
