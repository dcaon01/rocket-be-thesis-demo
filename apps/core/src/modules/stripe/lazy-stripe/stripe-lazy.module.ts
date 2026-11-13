import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppException } from '../../../errors/exception-types';
import { StripeService } from './services/stripe.service';

/**
 * Lazy module for Stripe operations.
 * This module is lazy-loaded when Stripe services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    AppException,
  ],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeLazyModule {}
