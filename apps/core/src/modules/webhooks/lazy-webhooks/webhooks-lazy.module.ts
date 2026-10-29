import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StripeWebhookService } from './services/stripe-webhook.service';
import { HubspotWebhookService } from './services/hubspot-webhook.service';
import { SibillWebhookService } from './services/sibill-webhook.service';

/**
 * Lazy module for HTTP webhook operations (Stripe, HubSpot, Sibill).
 * This module is lazy-loaded when webhook services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
  ],
  providers: [
    StripeWebhookService,
    HubspotWebhookService,
    SibillWebhookService,
  ],
  exports: [
    StripeWebhookService,
    HubspotWebhookService,
    SibillWebhookService,
  ]
})
export class WebhooksLazyModule {}
