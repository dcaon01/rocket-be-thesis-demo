import { Module } from "@nestjs/common";
import { StripeController } from "./controllers/stripe.controller";

/**
 * Lightweight module for Stripe.
 * Only registers the controller - the actual StripeService is lazy-loaded
 * via StripeLazyModule when a request arrives.
 */
@Module({
  controllers: [StripeController],
})
export class StripeModule {}
