import { Controller } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiTags } from "@nestjs/swagger";
import { StripeService } from "../lazy-stripe/services/stripe.service";

/**
 * Controller for Stripe functionalities.
 * Uses lazy loading to load StripeService only when needed.
 * Note: Webhook endpoint is handled by WebhookModule at /webhooks/stripe
 */
@ApiTags("Stripe")
@Controller("stripe")
export class StripeController {
  /** Lazy-loaded stripe service */
  private _stripeService: StripeService | null = null;

  /**
   * Constructor for StripeController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) {}

  /**
   * Lazy loads the StripeService from its module.
   * @returns A Promise resolving to the StripeService instance.
   */
  private async _loadStripeService(): Promise<StripeService> {
    if (!this._stripeService) {
      const { StripeLazyModule } = await import(
        "../lazy-stripe/stripe-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => StripeLazyModule,
      );
      this._stripeService = moduleRef.get<StripeService>(StripeService);
    }
    return this._stripeService;
  }
}
