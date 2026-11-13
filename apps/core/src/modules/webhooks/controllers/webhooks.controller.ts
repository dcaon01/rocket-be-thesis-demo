import { Body, Controller, Headers, HttpCode, HttpStatus, Logger, Param, Post, RawBodyRequest, Req, UnauthorizedException } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiExcludeController, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { ProductsService } from "../../products/lazy-products/services/products.service";
import { SibillDocumentUpdatedEvent } from "../../sibill/interfaces/sibill.interface";
import type { SibillService } from "../../sibill/lazy-sibill/services/sibill.service";
import { keusStripeAccount } from "../../stripe/helpers/keus-stripe-account.helper";
import { StripeService } from "../../stripe/lazy-stripe/services/stripe.service";
import { HubspotWebhookPayload } from "../interfaces/hubspot-webhook-payload.interface";
import { HubspotWebhookService } from "../lazy-webhooks/services/hubspot-webhook.service";
import { SibillWebhookService } from "../lazy-webhooks/services/sibill-webhook.service";
import { StripeWebhookService } from "../lazy-webhooks/services/stripe-webhook.service";
import { RequiresIntegrations } from "../../../commons/integrations/requires-integrations.decorator";

/**
 * Controller for handling HTTP webhooks (Stripe, HubSpot, Sibill).
 * Uses lazy loading to load webhook services only when needed.
 */
@ApiExcludeController()
@ApiTags("Webhooks")
@Controller("webhooks")
export class WebhooksController {
  /** Logger instance for WebhooksController. */
  private readonly _logger = new Logger(WebhooksController.name);

  /** Lazy-loaded stripe service */
  private _stripeService: StripeService | null = null;

  /** Lazy-loaded stripe webhook service */
  private _stripeWebhookService: StripeWebhookService | null = null;

  /** Lazy-loaded hubspot webhook service */
  private _hubspotWebhookService: HubspotWebhookService | null = null;

  /** Lazy-loaded products service (used to resolve the per-product Stripe webhook secret). */
  private _productsService: ProductsService | null = null;

  /** Lazy-loaded Sibill service (used to verify the Sibill signature). */
  private _sibillService: SibillService | null = null;

  /** Lazy-loaded Sibill webhook service */
  private _sibillWebhookService: SibillWebhookService | null = null;

  /**
   * Constructor for WebhooksController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

  /**
   * Lazy loads the StripeService from its module.
   * @returns A Promise resolving to the StripeService instance.
   */
  private async _loadStripeService(): Promise<StripeService> {
    if (!this._stripeService) {
      const { StripeLazyModule } = await import(
        "../../stripe/lazy-stripe/stripe-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => StripeLazyModule,
      );
      this._stripeService = moduleRef.get<StripeService>(StripeService);
    }
    return this._stripeService;
  }

  /**
   * Lazy loads the StripeWebhookService from its module.
   * @returns A Promise resolving to the StripeWebhookService instance.
   */
  private async _loadStripeWebhookService(): Promise<StripeWebhookService> {
    if (!this._stripeWebhookService) {
      const { WebhooksLazyModule } = await import(
        "../lazy-webhooks/webhooks-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => WebhooksLazyModule,
      );
      this._stripeWebhookService = moduleRef.get<StripeWebhookService>(StripeWebhookService);
    }
    return this._stripeWebhookService;
  }

  /**
   * Lazy loads the ProductsService from its module.
   * @returns A Promise resolving to the ProductsService instance.
   */
  private async _loadProductsService(): Promise<ProductsService> {
    if (!this._productsService) {
      const { ProductsLazyModule } = await import(
        "../../products/lazy-products/products-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ProductsLazyModule,
      );
      this._productsService = moduleRef.get<ProductsService>(ProductsService);
    }
    return this._productsService;
  }

  /**
   * Lazy loads the SibillService from its module.
   * @returns A Promise resolving to the SibillService instance.
   */
  private async _loadSibillService(): Promise<SibillService> {
    if (!this._sibillService) {
      const { SibillLazyModule } = await import("../../sibill/lazy-sibill/sibill-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => SibillLazyModule);
      const { SibillService } = await import("../../sibill/lazy-sibill/services/sibill.service");
      this._sibillService = moduleRef.get<SibillService>(SibillService);
    }
    return this._sibillService;
  }

  /**
   * Lazy loads the SibillWebhookService from its module.
   * @returns A Promise resolving to the SibillWebhookService instance.
   */
  private async _loadSibillWebhookService(): Promise<SibillWebhookService> {
    if (!this._sibillWebhookService) {
      const { WebhooksLazyModule } = await import("../lazy-webhooks/webhooks-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => WebhooksLazyModule);
      this._sibillWebhookService = moduleRef.get<SibillWebhookService>(SibillWebhookService);
    }
    return this._sibillWebhookService;
  }

  /**
   * Lazy loads the HubspotWebhookService from its module.
   * @returns A Promise resolving to the HubspotWebhookService instance.
   */
  private async _loadHubspotWebhookService(): Promise<HubspotWebhookService> {
    if (!this._hubspotWebhookService) {
      const { WebhooksLazyModule } = await import(
        "../lazy-webhooks/webhooks-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => WebhooksLazyModule,
      );
      this._hubspotWebhookService = moduleRef.get<HubspotWebhookService>(HubspotWebhookService);
    }
    return this._hubspotWebhookService;
  }

  /**
   * Webhook endpoint for the Stripe account of Keus, which bills the reseller fees.
   * Declared before the per-product route, so that "keus" is never read as a product.
   * @param req The raw request object.
   * @param signature The Stripe signature header.
   * @returns Acknowledgment of the webhook.
   */
  @Post('stripe/keus')
  // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
  @RequiresIntegrations()
  @ApiOperation({
    summary: 'Stripe webhook endpoint (Keus account)',
    description: 'Receives and processes Stripe webhook events from the Stripe account of Keus, which bills the reseller fees.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Webhook event processed successfully.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid webhook signature or payload.'
  })
  async handleKeusStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string
  ): Promise<{ received: boolean }> {
    try {
      const rawBody = req.rawBody;
      if (!rawBody) {
        this._logger.error('Raw body not available for Stripe webhook verification');
        throw new Error('Raw body not available');
      }

      const account = keusStripeAccount();
      const stripeService = await this._loadStripeService();
      const event = stripeService.constructWebhookEvent(rawBody, signature, account.webhookSecret);

      const stripeWebhookService = await this._loadStripeWebhookService();
      await stripeWebhookService.processWebhookEvent(event, { name: 'Keus', apiKey: account.apiKey });

      return { received: true };

    } catch (error) {
      this._logger.error('Error processing Keus Stripe webhook', error);
      throw error;
    }
  }

  /**
   * Webhook endpoint for Stripe events, scoped to a specific Rocket Product.
   * The productId in the path identifies which Stripe account the webhook comes from,
   * so the controller can resolve the matching webhook signing secret.
   * @param productId The Rocket Product owning the Stripe account that emitted the event.
   * @param req The raw request object.
   * @param signature The Stripe signature header.
   * @returns Acknowledgment of the webhook.
   */
  @Post('stripe/:productId')
  // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
  @RequiresIntegrations()
  @ApiOperation({
    summary: 'Stripe webhook endpoint (per product)',
    description: 'Receives and processes Stripe webhook events from the Stripe account associated with the given Rocket Product.'
  })
  @ApiParam({
    name: 'productId',
    type: String,
    description: 'The Rocket Product owning the Stripe account that emitted the event.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Webhook event processed successfully.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid webhook signature or payload.'
  })
  async handleStripeWebhook(
    @Param('productId') productId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string
  ): Promise<{ received: boolean }> {
    try {
      // Get raw body for signature verification
      const rawBody = req.rawBody;
      if (!rawBody) {
        this._logger.error('Raw body not available for Stripe webhook verification');
        throw new Error('Raw body not available');
      }

      // Resolve the per-product Stripe webhook signing secret
      const productsService = await this._loadProductsService();
      const product = await productsService.getProduct(productId);
      if (!product.stripeWebhookSecret) {
        this._logger.error(`Product ${productId} has no Stripe webhook secret configured`);
        throw new Error('Stripe webhook secret not configured for this product');
      }

      // Verify and construct the event
      const stripeService = await this._loadStripeService();
      const event = stripeService.constructWebhookEvent(rawBody, signature, product.stripeWebhookSecret);

      // Process the event
      const stripeWebhookService = await this._loadStripeWebhookService();
      await stripeWebhookService.processWebhookEvent(event, { name: product.name, ...(product.stripeApiKey && { apiKey: product.stripeApiKey }) });

      return { received: true };

    } catch (error) {
      this._logger.error('Error processing Stripe webhook', error);
      throw error;
    }
  }

  /**
   * Webhook endpoint for Sibill: the state of the electronic invoices at the exchange system. The signature is checked
   * on the raw body before anything is read.
   * @param req The raw request object.
   * @param event The parsed event.
   * @param signature The Sibill signature header.
   * @returns Acknowledgment of the webhook.
   * @throws UnauthorizedException if the signature is missing or invalid.
   */
  @Post('sibill')
  // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
  @RequiresIntegrations()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sibill webhook endpoint',
    description: 'Receives the document.updated events of Sibill and records the state of the electronic invoices at the exchange system.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Webhook event processed successfully.'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid webhook signature.'
  })
  async handleSibillWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() event: SibillDocumentUpdatedEvent,
    @Headers('x-sibill-signature') signature?: string,
  ): Promise<{ received: boolean }> {
    const sibillService = await this._loadSibillService();
    if (!req.rawBody || !sibillService.verifyWebhookSignature(req.rawBody, signature)) {
      this._logger.warn('Sibill webhook with a missing or invalid signature rejected');
      throw new UnauthorizedException('Invalid Sibill signature.');
    }
    const sibillWebhookService = await this._loadSibillWebhookService();
    await sibillWebhookService.processWebhookEvent(event);
    return { received: true };
  }

  /**
   * Webhook endpoint for HubSpot events.
   * @param events The HubSpot webhook payload (array of events).
   * @param signature The HubSpot signature header for verification.
   * @returns Acknowledgment of the webhook.
   */
  @Post('hubspot')
  // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
  @RequiresIntegrations()
  @ApiOperation({
    summary: 'HubSpot webhook endpoint',
    description: 'Receives and processes HubSpot webhook events (deal changes, contact updates, etc.).'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Webhook events processed successfully.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid webhook payload.'
  })
  async handleHubspotWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() events: HubspotWebhookPayload[],
    @Headers('x-hubspot-signature') signature?: string
  ): Promise<{ received: boolean }> {
    try {
      this._logger.log(`Received HubSpot webhook with ${events?.length ?? 0} events`);
      this._logger.log('Processing following events:', JSON.stringify(events));

      const hubspotWebhookService = await this._loadHubspotWebhookService();
      const rawBody = req.rawBody?.toString() ?? JSON.stringify(events);

      if (events && Array.isArray(events)) {
        await hubspotWebhookService.processWebhookEvents(events, signature, rawBody);
      }

      return { received: true };

    } catch (error) {
      this._logger.error('Error processing HubSpot webhook', error);
      throw error;
    }
  }
}
