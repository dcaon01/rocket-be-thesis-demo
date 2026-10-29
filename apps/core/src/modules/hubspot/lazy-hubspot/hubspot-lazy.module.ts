import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppException } from '../../../errors/exception-types';
import { HubspotService } from './services/hubspot.service';

/**
 * Lazy module for HubSpot operations.
 * This module is lazy-loaded when HubSpot services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    AppException,
  ],
  providers: [HubspotService],
  exports: [HubspotService],
})
export class HubspotLazyModule {}
