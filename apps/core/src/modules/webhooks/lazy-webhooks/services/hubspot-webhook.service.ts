import { Injectable, Logger } from "@nestjs/common";
import { SYSTEM_SCOPE } from "@rocket-be/scoping";
import { LazyModuleLoader } from "@nestjs/core";
import * as crypto from 'node:crypto';
import { ProductsService } from "../../../products/lazy-products/services/products.service";
import { CompaniesService } from "../../../companies/lazy-companies/services/companies.service";
import { HubspotService } from "../../../hubspot/lazy-hubspot/services/hubspot.service";
import { productsPipelineId } from "../../../hubspot/helpers/hubspot-products.helper";
import { OrdersService } from "../../../orders/lazy-orders/services/orders.service";
import { TrialsService } from "../../../trials/lazy-trials/services/trials.service";
import { OrderLineInput } from "../../../orders/classes/order-line-input.class";
import { CreateTrialDto } from "../../../trials/dtos/create-trial.dto";
import { TrialStatus } from "../../../trials/enums/trial-status.enum";
import { UsersLimitType } from "../../../trials/enums/users-limit-type.enum";
import { HubspotEventType } from "../../enums/hubspot-event-type.enum";
import { HubspotWebhookPayload } from "../../interfaces/hubspot-webhook-payload.interface";
import { BusinessException, ValidationException } from "../../../../errors/exception-types";


/**
 * The deal details the closed-won handler reads to open an order.
 */
type HubspotDealForOrder = {
  /** Name of the deal. */
  dealname: string;
  /** Company associated with the deal. */
  primaryCompany?: { name?: string; phone?: string; address?: string; vatNumber?: string; pec?: string; sdi?: string };
  /** Contact associated with the deal. */
  primaryContact?: { firstname?: string; lastname?: string; email?: string; phone?: string; address?: string };
};

/**
 * Service for handling HubSpot webhook events.
 */
@Injectable()
export class HubspotWebhookService {
  /** Logger instance for HubspotWebhookService. */
  private readonly _logger = new Logger(HubspotWebhookService.name);

  /** Lazy-loaded products service */
  private _productsService: ProductsService | null = null;
  /** Lazy-loaded companies service */
  private _companiesService: CompaniesService | null = null;
  /** Lazy-loaded orders service */
  private _ordersService: OrdersService | null = null;
  /** Lazy-loaded hubspot service */
  private _hubspotService: HubspotService | null = null;
  /** Lazy-loaded trials service */
  private _trialsService: TrialsService | null = null;

  /**
   * Constructor for HubspotWebhookService.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

  /**
   * Lazy loads the ProductsService from its module.
   * @returns A Promise resolving to the ProductsService instance.
   */
  private async _loadProductsService(): Promise<ProductsService> {
    if (!this._productsService) {
      const { ProductsLazyModule } = await import(
        "../../../products/lazy-products/products-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ProductsLazyModule,
      );
      this._productsService = moduleRef.get<ProductsService>(ProductsService);
    }
    return this._productsService;
  }

  /**
   * Lazy loads the CompaniesService from its module.
   * @returns A Promise resolving to the CompaniesService instance.
   */
  private async _loadCompaniesService(): Promise<CompaniesService> {
    if (!this._companiesService) {
      const { CompaniesLazyModule } = await import(
        "../../../companies/lazy-companies/companies-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => CompaniesLazyModule,
      );
      this._companiesService = moduleRef.get<CompaniesService>(CompaniesService);
    }
    return this._companiesService;
  }

  /**
   * Lazy loads the OrdersService from its module.
   * @returns A Promise resolving to the OrdersService instance.
   */
  private async _loadOrdersService(): Promise<OrdersService> {
    if (!this._ordersService) {
      const { OrdersLazyModule } = await import(
        "../../../orders/lazy-orders/orders-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => OrdersLazyModule,
      );
      this._ordersService = moduleRef.get<OrdersService>(OrdersService);
    }
    return this._ordersService;
  }

  /**
   * Lazy loads the HubspotService from its module.
   * @returns A Promise resolving to the HubspotService instance.
   */
  private async _loadHubspotService(): Promise<HubspotService> {
    if (!this._hubspotService) {
      const { HubspotLazyModule } = await import(
        "../../../hubspot/lazy-hubspot/hubspot-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => HubspotLazyModule,
      );
      this._hubspotService = moduleRef.get<HubspotService>(HubspotService);
    }
    return this._hubspotService;
  }

  /**
   * Lazy loads the TrialsService from its module.
   * @returns A Promise resolving to the TrialsService instance.
   */
  private async _loadTrialsService(): Promise<TrialsService> {
    if (!this._trialsService) {
      const { TrialsLazyModule } = await import(
        "../../../trials/lazy-trials/trials-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => TrialsLazyModule,
      );
      this._trialsService = moduleRef.get<TrialsService>(TrialsService);
    }
    return this._trialsService;
  }

  /**
   * Process HubSpot webhook events.
   * Verifies signature using the HUBSPOT_CLIENT_SECRET env variable,
   * then processes each event by matching the deal's solutions of interest to the products.
   * @param events Array of HubSpot webhook events.
   * @param signature The X-HubSpot-Signature header value.
   * @param rawBody The raw request body string for signature verification.
   */
  async processWebhookEvents(
    events: HubspotWebhookPayload[],
    signature?: string,
    rawBody?: string,
  ): Promise<void> {
    this._logger.log(`Processing ${events.length} HubSpot webhook events`);

    if (!events.length) return;

    // Verify webhook signature using the env client secret
    if (signature && rawBody) {
      const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
      const isValid = this._verifySignature(signature, rawBody, clientSecret);
      if (!isValid) {
        this._logger.warn(`Invalid HubSpot webhook signature`);
        throw new Error('Invalid webhook signature');
      }
    }

    for (const event of events) {
      try {
        this._logger.log(`Processing HubSpot event: ${event.subscriptionType} for object ${event.objectId}`);

        switch (event.subscriptionType as HubspotEventType) {
          case HubspotEventType.DealUpdated:
            await this._handleDealUpdated(event);
            break;

          default:
            this._logger.log(`Unhandled HubSpot event type: ${event.subscriptionType}`);
        }
      } catch (error) {
        this._logger.error(`Error processing HubSpot event ${event.eventId}`, error);
        // Continue processing other events
      }
    }
  }

  /**
   * Handle deal.propertyChange event.
   * - When a deal moves to a "trial" stage: creates a trial in DRAFT status.
   * - When a deal moves to "closed won": opens an order in DRAFT.
   * Only the deals of the products pipeline count; their products are the ones whose
   * hubspotSolution is among the solutions of interest of the deal, possibly more than one.
   * @param event The HubSpot webhook event payload.
   */
  private async _handleDealUpdated(event: HubspotWebhookPayload): Promise<void> {
    this._logger.log(`Handling deal.propertyChange from deal`, event);

    // Only process dealstage changes
    if (event.propertyName !== 'dealstage') {
      this._logger.log(`Ignoring property change: ${event.propertyName} = ${event.propertyValue}`);
      return;
    }

    try {
      const productsService: ProductsService = await this._loadProductsService();
      const hubspotService = await this._loadHubspotService();

      const allProducts = await productsService.getAllProducts();
      if (!allProducts.length) {
        this._logger.warn('No products found - cannot process deal event');
        return;
      }

      // Fetch deal details from HubSpot
      const dealDetails = await hubspotService.getHubspotDealById(allProducts[0].id, `${event.objectId}`);
      this._logger.log(`Fetched deal details: ${dealDetails.dealname}, stage: ${dealDetails.dealstage}, pipeline: ${dealDetails.pipeline}, solutions: ${dealDetails.solutions.join(', ')}, isClosedWon: ${dealDetails.isClosedWon}`);

      // Consulting and reseller deals sit in other pipelines and can carry a product solution too.
      if (dealDetails.pipeline !== productsPipelineId()) {
        this._logger.log(`Deal ${event.objectId} is not in the products pipeline - skipping`);
        return;
      }

      const products = allProducts.filter(p => p.hubspotSolution && dealDetails.solutions.includes(p.hubspotSolution));
      if (!products.length) {
        this._logger.warn(`No product found for solutions "${dealDetails.solutions.join(', ')}" - skipping deal ${event.objectId}`);
        return;
      }

      // Check if the deal moved to a "trial" stage
      const isTrialStage = await this._isTrialStage(hubspotService, event.propertyValue);
      if (isTrialStage) {
        for (const product of products) {
          await this._handleTrialStage(event, dealDetails, product);
        }
        return;
      }

      // Check if the deal moved to "Closed Won"
      if (dealDetails.isClosedWon) {
        await this._handleClosedWon(event, dealDetails, products);
        return;
      }

      this._logger.log(`Deal ${event.objectId} stage "${dealDetails.dealstage}" is neither trial nor closed won - skipping`);

    } catch (error) {
      this._logger.error(`Failed to process deal stage change for deal ${event.objectId}`, error);
    }
  }

  /**
   * Checks if a deal stage ID corresponds to a "trial" stage by looking up pipeline stage labels.
   * @param hubspotService the HubSpot service instance.
   * @param stageId the deal stage ID from the webhook event.
   * @returns True if the stage label contains "trial" (case-insensitive).
   */
  private async _isTrialStage(hubspotService: HubspotService, stageId: string): Promise<boolean> {
    const pipelines = await hubspotService.getDealPipelines();
    for (const pipeline of pipelines) {
      const stage = pipeline.stages.find(s => s.id === stageId);
      if (stage && stage.label.toLowerCase().includes('trial')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Handles a deal moving to a trial stage: creates a trial in DRAFT status,
   * carrying the deal, unless the deal already opened one.
   * Uses the deal's primary contact email.
   * @param event the webhook event.
   * @param dealDetails the deal details from HubSpot.
   * @param product one of the products the deal is about.
   */
  private async _handleTrialStage(
    event: HubspotWebhookPayload,
    dealDetails: { dealname: string; primaryContact?: { email?: string } },
    product: { id: string },
  ): Promise<void> {
    const contactEmail = dealDetails.primaryContact?.email;
    if (!contactEmail) {
      this._logger.warn(`Deal ${event.objectId} moved to trial but has no contact email - skipping trial creation`);
      return;
    }

    const trialsService = await this._loadTrialsService();
    const dealId = `${event.objectId}`;
    // The trials of a product sit in one partition: reading it is enough to recognise the deal.
    const existingTrials = await trialsService.getTrialsByProduct(product.id, SYSTEM_SCOPE);
    if (existingTrials.some(trial => trial.dealId === dealId)) {
      this._logger.warn(`Deal ${dealId} already opened a trial - skipping creation`);
      return;
    }

    const trialData: CreateTrialDto = {
      productId: product.id,
      associatedEmail: contactEmail,
      status: TrialStatus.Draft,
      usersLimitType: UsersLimitType.Product,
      dealId,
    };

    try {
      const trial = await trialsService.createTrial(trialData);
      this._logger.log(`Successfully created draft trial ${trial.id} for deal ${event.objectId} (email: ${contactEmail})`);
    } catch (error) {
      this._logger.warn(`Failed to create trial for deal ${event.objectId}`, error);
    }
  }

  /**
   * Handles a deal moving to "Closed Won": opens an order in DRAFT for the
   * deal's company, with one line per product the deal is about and no plan,
   * which the salesperson chooses when completing the order. The order carries
   * the deal, so a deal never opens two orders. HubSpot is the direct channel of
   * Keus: the company is looked up and created among the direct ones only.
   * @param event the webhook event.
   * @param dealDetails the deal details from HubSpot.
   * @param products the products the deal is about.
   */
  private async _handleClosedWon(
    event: HubspotWebhookPayload,
    dealDetails: HubspotDealForOrder,
    products: { id: string }[],
  ): Promise<void> {
    const dealId = `${event.objectId}`;
    const companyId = await this._findOrCreateCompany(dealId, dealDetails);
    if (!companyId) {
      return;
    }

    const ordersService = await this._loadOrdersService();
    try {
      const order = await ordersService.createOrder(
        { companyId, lines: products.map(product => new OrderLineInput(product.id)), dealId },
        SYSTEM_SCOPE,
      );
      this._logger.log(`Deal ${dealId} closed won: draft order ${order.code} opened`);
    } catch (error) {
      // An order already opened by the deal, or a product that cannot be ordered: nothing to do but tell.
      if (error instanceof BusinessException || error instanceof ValidationException) {
        this._logger.warn(`Deal ${dealId} closed won, but no order was opened: ${error.message}`);
        return;
      }
      throw error;
    }
  }

  /**
   * Finds the direct company of a deal by VAT number, then by email, and creates
   * it from the deal when it is not on record yet, with the primary contact as its referent.
   * @param dealId the identifier of the deal, for the logs.
   * @param dealDetails the deal details from HubSpot.
   * @returns the identifier of the company, or undefined when the deal carries too little to create one.
   */
  private async _findOrCreateCompany(dealId: string, dealDetails: HubspotDealForOrder): Promise<string | undefined> {
    const companiesService = await this._loadCompaniesService();
    const company = dealDetails.primaryCompany;
    const contact = dealDetails.primaryContact;

    const byVat = company?.vatNumber ? await companiesService.getDirectCompanyByVatNumber(company.vatNumber) : null;
    if (byVat) {
      return byVat.id;
    }
    const byEmail = contact?.email ? await companiesService.getDirectCompanyByEmail(contact.email) : null;
    if (byEmail) {
      // Matching on the contact email alone is weaker than the VAT number: leave a trace to check it.
      this._logger.warn(`Deal ${dealId}: no company with its VAT number, order attached by contact email to company ${byEmail.id}`);
      return byEmail.id;
    }

    const name = company?.name || (contact ? `${contact.firstname || ''} ${contact.lastname || ''}`.trim() : '');
    if (!contact?.email || !name) {
      this._logger.warn(`Deal ${dealId} closed won, but it has no company name or contact email to create the company - skipping`);
      return undefined;
    }

    const created = await companiesService.createCompany({
      name,
      email: contact.email,
      ...(company?.vatNumber && { vatNumber: company.vatNumber }),
      ...(company?.pec && { pec: company.pec }),
      ...(company?.sdi && { sdi: company.sdi }),
      ...((company?.phone || contact.phone) && { phoneNumber: company?.phone || contact.phone }),
      ...((company?.address || contact.address) && { address: company?.address || contact.address }),
      // The primary contact of the deal is the referent.
      referent: {
        ...(contact.firstname && { firstName: contact.firstname }),
        ...(contact.lastname && { lastName: contact.lastname }),
        email: contact.email,
        ...(contact.phone && { phoneNumber: contact.phone }),
      },
    }, SYSTEM_SCOPE);
    this._logger.log(`Deal ${dealId}: company ${created.id} created from the deal`);
    return created.id;
  }

  /**
   * Verify HubSpot webhook signature.
   * @param signature The X-HubSpot-Signature header value.
   * @param body The raw request body.
   * @param clientSecret The HubSpot app client secret.
   * @returns True if signature is valid.
   */
  private _verifySignature(signature: string, body: string, clientSecret: string): boolean {
    // HubSpot signature verification using SHA-256
    // signature = SHA-256(clientSecret + requestBody)
    const expectedSignature = crypto
      .createHash('sha256')
      .update(clientSecret + body)
      .digest('hex');

    return signature === expectedSignature;
  }
}
