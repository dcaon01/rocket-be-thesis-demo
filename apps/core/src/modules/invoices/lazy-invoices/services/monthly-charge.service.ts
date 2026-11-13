import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { SYSTEM_SCOPE } from "@rocket-be/scoping";
import { BusinessException } from "../../../../errors/exception-types";
import type { ProductsService } from "../../../products/lazy-products/services/products.service";
import type { ResellerContractsService } from "../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service";
import type { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import { RESELLER_CHARGE_PURPOSE } from "../../../stripe/constants/metadata-purpose.constant";
import type { StripeService } from "../../../stripe/lazy-stripe/services/stripe.service";
import { Invoice } from "../../schemas/invoice.schema";
import { InvoicesService } from "./invoices.service";
import { integrationsEnabled } from "../../../../commons/integrations/integrations.helper";

/**
 * Service for the charge of the resellers on the 4th of a month: for each reseller and each Stripe account, one Stripe
 * invoice collects the invoices of the month before and is debited once on the mandate of the reseller there.
 */
@Injectable()
export class MonthlyChargeService {
  /** Logger instance for MonthlyChargeService. */
  private readonly _logger = new Logger(MonthlyChargeService.name);

  /** Lazy-loaded products service. */
  private _productsService: ProductsService | null = null;

  /** Lazy-loaded resellers service. */
  private _resellersService: ResellersService | null = null;

  /** Lazy-loaded reseller contracts service, which holds the mandates. */
  private _resellerContractsService: ResellerContractsService | null = null;

  /** Lazy-loaded Stripe service. */
  private _stripeService: StripeService | null = null;

  /**
   * Constructor for MonthlyChargeService.
   * @param _invoicesService the service of the invoices to charge.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the other services on demand.
   */
  constructor(
    private readonly _invoicesService: InvoicesService,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

  /**
   * Lazy loads the ProductsService from its module.
   * @returns a Promise resolving to the ProductsService instance.
   */
  private async _loadProductsService(): Promise<ProductsService> {
    if (!this._productsService) {
      const { ProductsLazyModule } = await import("../../../products/lazy-products/products-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ProductsLazyModule);
      const { ProductsService } = await import("../../../products/lazy-products/services/products.service");
      this._productsService = moduleRef.get<ProductsService>(ProductsService);
    }
    return this._productsService;
  }

  /**
   * Lazy loads the ResellerContractsService from its module.
   * @returns a Promise resolving to the ResellerContractsService instance.
   */
  private async _loadResellerContractsService(): Promise<ResellerContractsService> {
    if (!this._resellerContractsService) {
      const { ResellerContractsLazyModule } = await import("../../../reseller-contracts/lazy-reseller-contracts/reseller-contracts-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ResellerContractsLazyModule);
      const { ResellerContractsService } = await import("../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service");
      this._resellerContractsService = moduleRef.get<ResellerContractsService>(ResellerContractsService);
    }
    return this._resellerContractsService;
  }

  /**
   * Lazy loads the ResellersService from its module.
   * @returns a Promise resolving to the ResellersService instance.
   */
  private async _loadResellersService(): Promise<ResellersService> {
    if (!this._resellersService) {
      const { ResellersLazyModule } = await import("../../../resellers/lazy-resellers/resellers-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ResellersLazyModule);
      const { ResellersService } = await import("../../../resellers/lazy-resellers/services/resellers.service");
      this._resellersService = moduleRef.get<ResellersService>(ResellersService);
    }
    return this._resellersService;
  }

  /**
   * Lazy loads the StripeService from its module.
   * @returns a Promise resolving to the StripeService instance.
   */
  private async _loadStripeService(): Promise<StripeService> {
    if (!this._stripeService) {
      const { StripeLazyModule } = await import("../../../stripe/lazy-stripe/stripe-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => StripeLazyModule);
      const { StripeService } = await import("../../../stripe/lazy-stripe/services/stripe.service");
      this._stripeService = moduleRef.get<StripeService>(StripeService);
    }
    return this._stripeService;
  }

  /**
   * Charges the invoices of a month, one Stripe invoice per reseller and account. A group that cannot be charged,
   * for lack of a mandate or a failed call, moves to the next month; the others go on. Without Stripe nothing is
   * charged: the invoices stay open, to be marked paid by hand.
   * @param month the month of the charge (format: "YYYY-MM").
   */
  async chargeMonth(month: string): Promise<void> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      this._logger.log(`Charge of ${month} skipped: Stripe is off.`);
      return;
    }

    const invoices = await this._invoicesService.getInvoicesToCharge(month);
    const groups = new Map<string, Invoice[]>();
    for (const invoice of invoices) {
      const key = `${invoice.billedPartyId}|${invoice.stripeAccount}`;
      groups.set(key, [...(groups.get(key) ?? []), invoice]);
    }
    for (const group of groups.values()) {
      try {
        await this._chargeGroup(month, group);
      } catch (error) {
        this._logger.error(`Charge of ${month} failed for reseller ${group[0].billedPartyId} on ${group[0].stripeAccount}: moved to the next month`, error);
        await this._invoicesService.postponeCharge(group, this._nextMonth(month));
      }
    }
    this._logger.log(`Charge of ${month}: ${invoices.length} invoices in ${groups.size} groups.`);
  }

  /**
   * Charges the invoices of one reseller on one account with a single Stripe invoice, linked before it is finalized
   * so that its payment events find them. Each invoice is one item for its total, VAT included and without a Stripe
   * tax rate: the electronic invoices are already issued, and Stripe only collects what they say.
   * @param month the month of the charge.
   * @param invoices the invoices of the reseller on the account.
   */
  private async _chargeGroup(month: string, invoices: Invoice[]): Promise<void> {
    const { billedPartyId: resellerId, stripeAccount: accountKey } = invoices[0];
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(resellerId, SYSTEM_SCOPE);
    const resellerContractsService = await this._loadResellerContractsService();
    const link = await resellerContractsService.getMandateOf(reseller, accountKey);
    if (!link?.paymentMethodId) {
      this._logger.warn(`Reseller ${reseller.code} has no mandate on ${accountKey}: its charge of ${month} moves to the next month.`);
      await this._invoicesService.postponeCharge(invoices, this._nextMonth(month));
      return;
    }

    const productsService = await this._loadProductsService();
    const product = await productsService.getProduct(accountKey);
    if (!product.stripeApiKey) {
      throw new BusinessException(`Product ${accountKey} has no Stripe account configured.`, "PRODUCT_WITHOUT_STRIPE");
    }
    const stripeService = await this._loadStripeService();
    const draft = await stripeService.createDraftInvoice({
      customerId: link.customerId,
      paymentMethodId: link.paymentMethodId,
      lines: invoices.map(invoice => ({
        description: invoice.number ? `Fattura ${invoice.number}` : invoice.items.map(item => item.description).join(", "),
        amountCents: invoice.amountCents,
      })),
      metadata: { purpose: RESELLER_CHARGE_PURPOSE, resellerId, accountKey, month },
      idempotencyKey: `reseller-charge-${resellerId}-${accountKey}-${month}`,
      stripeApiKey: product.stripeApiKey,
    });
    await this._invoicesService.linkCharge(invoices, draft.id);
    await stripeService.finalizeInvoice(draft.id, product.stripeApiKey);
    this._logger.log(`Reseller ${reseller.code} charged ${invoices.length} invoices on ${accountKey} for ${month}.`);
  }

  /**
   * Returns the month after another one.
   * @param month the month (format: "YYYY-MM").
   * @returns the next month (format: "YYYY-MM").
   */
  private _nextMonth(month: string): string {
    const date = new Date(`${month}-01T00:00:00.000Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    return date.toISOString().slice(0, 7);
  }
}
