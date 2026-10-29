import { Injectable, Logger } from "@nestjs/common";
import Stripe from "stripe";
import { AppException } from "../../../../errors/exception-types";
import { ResponsePlanDto } from "../../../plans/dtos/response-plan.dto";
import { Tier } from "../../../plans/classes/tier.class";
import { BillingInterval } from "../../../plans/enums/billing-interval.enum";
import { PlanType } from "../../../plans/enums/plan-type.enum";
import { CreateStripePlanDto } from "../../dtos/create-stripe-plan.dto";

/** What `createStripePricingForPlan` creates on Stripe for a plan. */
export interface StripePlanPricing {
  /** Product mirroring the plan. */
  stripeProductId: string;
  /** Every Price of the plan's own Product. */
  stripePriceIds: string[];
  /** Native volume-tiered Price, on TIERED_VOLUME plans. */
  stripeVolumePriceId?: string;
  /** Flat base-fee Price, on TIERED_VOLUME plans with a base cost. */
  stripeBasePriceId?: string;
  /** Product of the activation fee. */
  stripeActivationProductId?: string;
  /** One-time Price of the activation fee. */
  stripeActivationPriceId?: string;
  /** Product of the assistance component. */
  stripeAssistanceProductId?: string;
  /** One-time Price of the assistance component. */
  stripeAssistancePriceId?: string;
}

/**
 * Service for Stripe functionalities.
 * @remarks every public method that hits the Stripe API is multi-tenant and
 * requires the caller to pass the Stripe secret API key of the target account.
 * A per-apiKey client cache avoids re-instantiating the SDK on every call.
 */
@Injectable()
export class StripeService {
  /** Logger instance for StripeService. */
  private readonly _logger = new Logger(StripeService.name);

  /** Cache of Stripe API clients keyed by their secret API key. */
  private readonly _clients = new Map<string, Stripe>();

  /** Percentages of the tax rates read so far, by tax rate id: a rate never changes its percentage on Stripe. */
  private readonly _taxRatePercents = new Map<string, number>();

  /**
   * Lazily-built Stripe client used only to verify webhook signatures.
   * Signature verification does not require a real apiKey since it is purely
   * an HMAC check, so a placeholder is enough.
   */
  private _signatureVerifier: Stripe | null = null;

  /**
   * Returns a Stripe client for the given secret API key, reusing a cached
   * instance when available.
   * @param apiKey the Stripe secret API key.
   * @returns a Stripe client bound to the given key.
   */
  private _getCompany(apiKey: string): Stripe {
    if (!apiKey) {
      throw new AppException('Stripe API key is required to call this operation', 500);
    }
    const cached = this._clients.get(apiKey);
    if (cached) return cached;
    const client = new Stripe(apiKey);
    this._clients.set(apiKey, client);
    return client;
  }

  /**
   * Returns the Stripe client used exclusively to verify webhook signatures.
   * No Stripe API call is ever performed through this instance.
   * @returns a Stripe client suitable for webhook signature verification.
   */
  private _getSignatureVerifier(): Stripe {
    if (!this._signatureVerifier) {
      this._signatureVerifier = new Stripe('sk_signature_verifier_placeholder');
    }
    return this._signatureVerifier;
  }

  /**
   * Create or retrieve a Stripe Customer.
   * @param params Customer fields plus the Stripe secret API key.
   * @returns The Stripe Customer.
   */
  async createOrGetCustomer(params: {
    email: string;
    name: string;
    phone?: string;
    address?: Stripe.AddressParam;
    vatNumber?: string;
    stripeApiKey: string;
  }): Promise<Stripe.Customer> {
    const stripe = this._getCompany(params.stripeApiKey);
    try {
      // Search for existing customer by email
      const existingCustomers = await stripe.customers.list({
        email: params.email,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        this._logger.log(`Found existing Stripe customer for email: ${params.email}`);
        return existingCustomers.data[0];
      }

      // Create new customer
      const customer = await stripe.customers.create({
        email: params.email,
        name: params.name,
        ...(params.phone && { phone: params.phone }),
        ...(params.address && { address: params.address }),
      });

      // Attach tax ID (VAT number) if provided
      if (params.vatNumber) {
        await stripe.customers.createTaxId(customer.id, {
          type: 'eu_vat',
          value: params.vatNumber,
        });
      }

      this._logger.log(`Created new Stripe customer: ${customer.id}`);
      return customer;

    } catch (error) {
      this._logger.error('Error creating/retrieving Stripe customer', error);
      throw new AppException(
        "Something went wrong trying to create/retrieve Stripe customer",
        500,
        error
      );
    }
  }

  /**
   * Creates a checkout session that only collects a SEPA mandate, with no charge.
   * @param params the customer, the return URLs, the metadata for the webhook and the Stripe secret API key.
   * @returns the created Stripe Checkout Session.
   */
  async createMandateCheckoutSession(params: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    stripeApiKey: string;
  }): Promise<Stripe.Checkout.Session> {
    const stripe = this._getCompany(params.stripeApiKey);
    try {
      const session = await stripe.checkout.sessions.create({
        customer: params.customerId,
        mode: 'setup',
        payment_method_types: ['sepa_debit'],
        currency: 'eur',
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        metadata: params.metadata,
        setup_intent_data: { metadata: params.metadata },
      });
      this._logger.log(`Created mandate checkout session ${session.id} for customer ${params.customerId}`);
      return session;
    } catch (error) {
      this._logger.error(`Error creating the mandate checkout session for customer ${params.customerId}`, error);
      throw new AppException('Something went wrong trying to create the mandate checkout session', 500, error);
    }
  }

  /**
   * Creates the checkout that starts charging a contract: it collects the SEPA mandate and, in the same step, creates
   * the subscription (or charges a one-off plan, keeping the mandate for later charges). Its link is sent by the
   * backoffice, or opened by the product for the referent.
   * @param params the customer, the mode, the line items, the coupon of the recurring fee, the tax rate, the metadata
   *   read by the webhooks, the return URLs, the Stripe secret API key and the end of a trial, if any.
   * @returns the created Stripe Checkout Session.
   */
  async createContractCheckoutSession(params: {
    customerId: string;
    mode: 'subscription' | 'payment';
    lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
    couponId?: string;
    taxRateId?: string;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    stripeApiKey: string;
    /** Unix time the subscription starts being charged, at least 48 hours ahead: it stays in trial until then. */
    trialEnd?: number;
  }): Promise<Stripe.Checkout.Session> {
    const stripe = this._getCompany(params.stripeApiKey);
    try {
      const session = await stripe.checkout.sessions.create({
        customer: params.customerId,
        mode: params.mode,
        payment_method_types: ['sepa_debit'],
        line_items: params.lineItems.map(item => ({ ...item, ...(params.taxRateId && { tax_rates: [params.taxRateId] }) })),
        ...(params.couponId && { discounts: [{ coupon: params.couponId }] }),
        metadata: params.metadata,
        ...(params.mode === 'subscription'
          ? { subscription_data: { metadata: params.metadata, ...(params.trialEnd && { trial_end: params.trialEnd }) } }
          : {
            payment_intent_data: { setup_future_usage: 'off_session' as const, metadata: params.metadata },
            invoice_creation: { enabled: true, invoice_data: { metadata: params.metadata } },
          }),
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
      });
      this._logger.log(`Created contract checkout session ${session.id} for customer ${params.customerId}`);
      return session;
    } catch (error) {
      this._logger.error(`Error creating the contract checkout session for customer ${params.customerId}`, error);
      throw new AppException('Something went wrong trying to create the contract checkout session', 500, error);
    }
  }

  /**
   * Reads what a completed contract checkout created: the SEPA payment method, and the subscription in subscription
   * mode. A checkout in setup mode only collected the mandate.
   * @param sessionId the checkout session.
   * @param stripeApiKey the Stripe secret API key of the account.
   * @returns the payment method ID, the subscription ID if any, and whether the checkout only collected the mandate.
   */
  async getCheckoutOutcome(sessionId: string, stripeApiKey: string): Promise<{ paymentMethodId: string; subscriptionId?: string; mandateOnly?: true }> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription', 'payment_intent', 'setup_intent'] });
      const subscription = typeof session.subscription === 'string' ? undefined : session.subscription;
      const paymentIntent = typeof session.payment_intent === 'string' ? undefined : session.payment_intent;
      const setupIntent = typeof session.setup_intent === 'string' ? undefined : session.setup_intent;
      const paymentMethod = subscription?.default_payment_method ?? paymentIntent?.payment_method ?? setupIntent?.payment_method;
      if (!paymentMethod) {
        throw new AppException(`Checkout session ${sessionId} has no payment method.`, 500);
      }
      return {
        paymentMethodId: typeof paymentMethod === 'string' ? paymentMethod : paymentMethod.id,
        ...(subscription && { subscriptionId: subscription.id }),
        ...(session.mode === 'setup' && { mandateOnly: true as const }),
      };
    } catch (error) {
      this._logger.error(`Error reading the outcome of checkout session ${sessionId}`, error);
      if (error instanceof AppException) throw error;
      throw new AppException('Something went wrong trying to read the checkout session', 500, error);
    }
  }

  /**
   * Expires the checkouts of a contract still open on a customer, once one of them is completed: an older link not
   * expired yet would otherwise start a second subscription.
   * @param customerId the Stripe customer.
   * @param contractId the contract, as written in the metadata of its checkouts.
   * @param stripeApiKey the Stripe secret API key of the account.
   */
  async expireOpenContractCheckouts(customerId: string, contractId: string, stripeApiKey: string): Promise<void> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      const sessions = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 });
      for (const session of sessions.data.filter(item => item.metadata?.contractId === contractId)) {
        await stripe.checkout.sessions.expire(session.id);
        this._logger.log(`Expired checkout session ${session.id} of contract ${contractId}`);
      }
    } catch (error) {
      this._logger.error(`Error expiring the open checkouts of contract ${contractId}`, error);
      throw new AppException('Something went wrong trying to expire the open checkouts', 500, error);
    }
  }

  /**
   * Reads the payment method a completed setup intent collected.
   * @param setupIntentId the setup intent of the mandate checkout.
   * @param stripeApiKey the Stripe secret API key of the account.
   * @returns the payment method ID.
   */
  async getSetupIntentPaymentMethod(setupIntentId: string, stripeApiKey: string): Promise<string> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      const paymentMethod = setupIntent.payment_method;
      if (!paymentMethod) {
        throw new AppException(`Setup intent ${setupIntentId} has no payment method.`, 500);
      }
      return typeof paymentMethod === 'string' ? paymentMethod : paymentMethod.id;
    } catch (error) {
      this._logger.error(`Error reading the setup intent ${setupIntentId}`, error);
      if (error instanceof AppException) throw error;
      throw new AppException('Something went wrong trying to read the setup intent', 500, error);
    }
  }

  /**
   * Makes a payment method the default of a customer, so that its invoices are charged on it.
   * @param customerId the Stripe customer.
   * @param paymentMethodId the payment method.
   * @param stripeApiKey the Stripe secret API key of the account.
   */
  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string, stripeApiKey: string): Promise<void> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
      this._logger.log(`Payment method ${paymentMethodId} is now the default of customer ${customerId}`);
    } catch (error) {
      this._logger.error(`Error setting the default payment method of customer ${customerId}`, error);
      throw new AppException('Something went wrong trying to set the default payment method', 500, error);
    }
  }

  /**
   * Returns the coupon of a percent discount that lasts forever, reused by value (`percent-20`) instead of one per charge.
   * Limited to some products, it is reused by value and products: a checkout takes one coupon, kept off the other items.
   * @param percent the discount, in percent.
   * @param stripeApiKey the Stripe secret API key of the account.
   * @param productIds the products the discount applies to, when not all.
   * @returns the coupon ID.
   */
  async ensurePercentCoupon(percent: number, stripeApiKey: string, productIds?: string[]): Promise<string> {
    const stripe = this._getCompany(stripeApiKey);
    const id = `percent-${String(percent).replace('.', '_')}${productIds?.length ? `-${productIds.join('-')}` : ''}`;
    try {
      await stripe.coupons.retrieve(id);
      return id;
    } catch (error) {
      if ((error as Stripe.errors.StripeError).code !== 'resource_missing') {
        throw new AppException(`Something went wrong trying to read the coupon ${id}`, 500, error);
      }
    }
    try {
      await stripe.coupons.create({
        id,
        percent_off: percent,
        duration: 'forever',
        name: `Sconto ${percent}%`,
        ...(productIds?.length && { applies_to: { products: productIds } }),
      });
      this._logger.log(`Created coupon ${id}`);
      return id;
    } catch (error) {
      // Two charges can create it together: the loser finds it there.
      if ((error as Stripe.errors.StripeError).code === 'resource_already_exists') return id;
      throw new AppException(`Something went wrong trying to create the coupon ${id}`, 500, error);
    }
  }

  /**
   * Creates the Stripe product the free prices of a charge are created on, such as a customization or a seat variation.
   * @param name the name shown on the invoices.
   * @param stripeApiKey the Stripe secret API key of the account.
   * @returns the product ID.
   */
  async createProduct(name: string, stripeApiKey: string): Promise<string> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      const product = await stripe.products.create({ name });
      return product.id;
    } catch (error) {
      throw new AppException(`Something went wrong trying to create the product ${name}`, 500, error);
    }
  }

  /**
   * Creates the subscription of a contract, charged on the SEPA mandate of the customer from now on, or from the end
   * of its trial.
   * @param params the customer and its mandate, the recurring items, the one-off items of the first invoice,
   *   the tax rate, the metadata read by the webhooks, an idempotency key, the Stripe secret API key and the end of
   *   a trial, if any.
   * @returns the created subscription.
   */
  async createSubscription(params: {
    customerId: string;
    paymentMethodId: string;
    items: Stripe.SubscriptionCreateParams.Item[];
    addInvoiceItems: Stripe.SubscriptionCreateParams.AddInvoiceItem[];
    taxRateId?: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
    stripeApiKey: string;
    /** Unix time the first period starts being charged: the subscription stays in trial until then. */
    trialEnd?: number;
  }): Promise<Stripe.Subscription> {
    const stripe = this._getCompany(params.stripeApiKey);
    try {
      const subscription = await stripe.subscriptions.create({
        customer: params.customerId,
        default_payment_method: params.paymentMethodId,
        collection_method: 'charge_automatically',
        payment_settings: { payment_method_types: ['sepa_debit'] },
        items: params.items,
        add_invoice_items: params.addInvoiceItems,
        ...(params.taxRateId && { default_tax_rates: [params.taxRateId] }),
        ...(params.trialEnd && { trial_end: params.trialEnd }),
        metadata: params.metadata,
      }, { idempotencyKey: params.idempotencyKey });
      this._logger.log(`Created subscription ${subscription.id} for customer ${params.customerId}`);
      return subscription;
    } catch (error) {
      this._logger.error(`Error creating the subscription for customer ${params.customerId}`, error);
      throw new AppException('Something went wrong trying to create the subscription', 500, error);
    }
  }

  /**
   * Charges one-off items on the SEPA mandate of the customer with a single invoice, finalized at once.
   * @param params the customer and its mandate, the items, the tax rate, the metadata read by the webhooks,
   *   an idempotency key and the Stripe secret API key.
   * @returns the finalized invoice.
   */
  async chargeOneOff(params: {
    customerId: string;
    paymentMethodId: string;
    items: Stripe.SubscriptionCreateParams.AddInvoiceItem[];
    taxRateId?: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
    stripeApiKey: string;
  }): Promise<Stripe.Invoice> {
    const stripe = this._getCompany(params.stripeApiKey);
    try {
      const invoice = await stripe.invoices.create({
        customer: params.customerId,
        collection_method: 'charge_automatically',
        default_payment_method: params.paymentMethodId,
        payment_settings: { payment_method_types: ['sepa_debit'] },
        pending_invoice_items_behavior: 'exclude',
        ...(params.taxRateId && { default_tax_rates: [params.taxRateId] }),
        metadata: params.metadata,
      }, { idempotencyKey: `${params.idempotencyKey}-invoice` });
      for (const [index, item] of params.items.entries()) {
        await stripe.invoiceItems.create({
          customer: params.customerId,
          invoice: invoice.id,
          ...(item.price ? { pricing: { price: item.price } } : {}),
          ...(item.price_data ? { price_data: item.price_data } : {}),
          ...(item.quantity ? { quantity: item.quantity } : {}),
          ...(item.discounts ? { discounts: item.discounts as Stripe.InvoiceItemCreateParams.Discount[] } : {}),
        }, { idempotencyKey: `${params.idempotencyKey}-item-${index}` });
      }
      const finalized = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: true });
      this._logger.log(`Created one-off invoice ${finalized.id} for customer ${params.customerId}`);
      return finalized;
    } catch (error) {
      this._logger.error(`Error charging one-off items to customer ${params.customerId}`, error);
      throw new AppException('Something went wrong trying to charge the one-off items', 500, error);
    }
  }

  /**
   * Creates a draft invoice with free amounts, charged on the SEPA mandate of the customer once finalized; left as a
   * draft so that the caller links it before any payment event can arrive.
   * @param params the customer and its mandate, the lines, the tax rate, the metadata read by the webhooks,
   *   an idempotency key and the Stripe secret API key.
   * @returns the draft invoice.
   */
  async createDraftInvoice(params: {
    customerId: string;
    paymentMethodId: string;
    lines: { description: string; amountCents: number }[];
    taxRateId?: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
    stripeApiKey: string;
  }): Promise<Stripe.Invoice> {
    const stripe = this._getCompany(params.stripeApiKey);
    try {
      const invoice = await stripe.invoices.create({
        customer: params.customerId,
        collection_method: 'charge_automatically',
        default_payment_method: params.paymentMethodId,
        payment_settings: { payment_method_types: ['sepa_debit'] },
        pending_invoice_items_behavior: 'exclude',
        ...(params.taxRateId && { default_tax_rates: [params.taxRateId] }),
        metadata: params.metadata,
      }, { idempotencyKey: `${params.idempotencyKey}-invoice` });
      for (const [index, line] of params.lines.entries()) {
        await stripe.invoiceItems.create({
          customer: params.customerId,
          invoice: invoice.id,
          amount: line.amountCents,
          currency: 'eur',
          description: line.description,
        }, { idempotencyKey: `${params.idempotencyKey}-item-${index}` });
      }
      return invoice;
    } catch (error) {
      this._logger.error(`Error creating the draft invoice of customer ${params.customerId}`, error);
      throw new AppException('Something went wrong trying to create the draft invoice', 500, error);
    }
  }

  /**
   * Finalizes a draft invoice, which Stripe then charges on its default payment method.
   * @param invoiceId the draft invoice.
   * @param stripeApiKey the Stripe secret API key of the account.
   * @returns the finalized invoice.
   */
  async finalizeInvoice(invoiceId: string, stripeApiKey: string): Promise<Stripe.Invoice> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      return await stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: true });
    } catch (error) {
      this._logger.error(`Error finalizing invoice ${invoiceId}`, error);
      throw new AppException('Something went wrong trying to finalize the invoice', 500, error);
    }
  }

  /**
   * Update an existing Stripe Customer with new data.
   * Phone and address are left untouched when undefined and cleared when null:
   * Stripe unsets a field on an empty string.
   * @param customerId The Stripe Customer ID.
   * @param params The fields to update plus the Stripe secret API key.
   * @returns The updated Stripe Customer.
   */
  async updateCustomer(customerId: string, params: {
    name?: string;
    email?: string;
    phone?: string | null;
    address?: Stripe.AddressParam | null;
    stripeApiKey: string;
  }): Promise<Stripe.Customer> {
    const stripe = this._getCompany(params.stripeApiKey);
    try {
      const customer = await stripe.customers.update(customerId, {
        ...(params.name && { name: params.name }),
        ...(params.email && { email: params.email }),
        ...(params.phone !== undefined && { phone: params.phone ?? '' }),
        ...(params.address !== undefined && { address: params.address ?? '' }),
      });
      this._logger.log(`Updated Stripe customer: ${customerId}`);
      return customer;
    } catch (error) {
      this._logger.error(`Error updating Stripe customer: ${customerId}`, error);
      throw new AppException('Error updating Stripe customer', 500, error);
    }
  }

  /**
   * Create a Stripe Checkout Session for the given Plan.
   * The line items and the session mode are derived from the plan type:
   *   - TIERED_VOLUME  → subscription mode, line item with `price = stripeVolumePriceId`
   *                      and `quantity` = the seat count (Stripe applies the volume tier natively).
   *                      When `stripeBasePriceId` is set (baseCost > 0), a second line item with
   *                      that price and quantity 1 is added for the flat base fee.
   *   - RECURRING_FLAT → subscription mode, single line item with `price = stripePriceIds[0]`
   *                      and quantity 1; the price is fixed regardless of seats.
   *   - ONE_TIME       → payment mode, single line item with `price = stripePriceIds[0]`
   *                      and quantity 1.
   * A `priceId` given instead of a plan (a reseller subscription fee) is billed as a single
   * subscription line item with quantity 1.
   * `trialEnd` keeps the subscription in trial until the contract starts, so the SEPA
   * mandate is collected now and the first charge comes at the start date.
   * @param params Parameters for creating the checkout session, including the Stripe secret API key.
   * @returns The created Stripe Checkout Session.
   */
  async createCheckoutSession(params: {
    customerId: string;
    /** Plan the session bills. Required unless `priceId` is given. */
    plan?: ResponsePlanDto;
    /** Yearly price billed on its own, as a reseller subscription fee; replaces the plan. */
    priceId?: string;
    /** Quantity for TIERED_VOLUME (seat count); ignored for RECURRING_FLAT/ONE_TIME (forced to 1). */
    quantity: number;
    contractId: string;
    productId: string;
    successUrl: string;
    cancelUrl: string;
    /**
     * Unix timestamp (seconds) the first charge is deferred to, for a contract that starts later.
     * The subscription stays in trial until then (subscription mode only, at least 48 hours ahead).
     */
    trialEnd?: number;
    /** Reseller of a reseller contract, carried in the metadata so the webhooks reach the right entity. */
    resellerId?: string;
    /** Stripe secret API key of the owning account. */
    stripeApiKey: string;
    /** Stripe Tax Rate id applied to the line item. If omitted, no tax rate is attached. */
    stripeTaxRateId?: string;
  }): Promise<Stripe.Checkout.Session> {
    const stripe = this._getCompany(params.stripeApiKey);
    try {
      const { plan } = params;

      // Resolve line items and session mode from the price, or from the plan type.
      const baseLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      let mode: 'subscription' | 'payment';

      if (params.priceId) {
        baseLineItems.push({ price: params.priceId, quantity: 1 });
        mode = 'subscription';
      } else if (!plan) {
        throw new AppException('A checkout session needs a plan or a price.', 500);
      } else if (plan.type === PlanType.TieredVolume) {
        if (!plan.stripeVolumePriceId) {
          throw new AppException(`Plan ${plan.id} is TIERED_VOLUME but has no stripeVolumePriceId.`, 500);
        }
        baseLineItems.push({ price: plan.stripeVolumePriceId, quantity: params.quantity });
        // Optional flat base-fee line item, billed once per interval alongside the per-seat tiered price.
        if (plan.stripeBasePriceId) {
          baseLineItems.push({ price: plan.stripeBasePriceId, quantity: 1 });
        }
        mode = 'subscription';
      } else if (plan.type === PlanType.RecurringFlat) {
        if (!plan.stripePriceIds?.length) {
          throw new AppException(`Plan ${plan.id} is RECURRING_FLAT but has no stripePriceIds.`, 500);
        }
        baseLineItems.push({ price: plan.stripePriceIds[0], quantity: 1 });
        mode = 'subscription';
      } else {
        if (!plan.stripePriceIds?.length) {
          throw new AppException(`Plan ${plan.id} is ONE_TIME but has no stripePriceIds.`, 500);
        }
        baseLineItems.push({ price: plan.stripePriceIds[0], quantity: 1 });
        mode = 'payment';
      }

      const taxRateId = params.stripeTaxRateId;
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = baseLineItems.map(item => ({
        ...item,
        ...(taxRateId && { tax_rates: [taxRateId] }),
      }));

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        customer: params.customerId,
        payment_method_types: ['sepa_debit'],
        mode,
        line_items: lineItems,
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        metadata: {
          contractId: params.contractId,
          productId: params.productId,
          ...(params.resellerId && { resellerId: params.resellerId }),
        },
        ...(mode === 'subscription' && {
          subscription_data: {
            metadata: {
              contractId: params.contractId,
              productId: params.productId,
              ...(params.resellerId && { resellerId: params.resellerId }),
            },
            ...(params.trialEnd && { trial_end: params.trialEnd }),
          },
        }),
        // Stripe does not auto-generate an Invoice for payment-mode sessions; opt in
        // explicitly so ONE_TIME purchases produce an Invoice we can persist as a
        // billing record on Rocket via the existing invoice.created /
        // invoice.payment_succeeded webhook handlers. Metadata is propagated to the
        // generated Invoice so _getMetadataFromInvoice can resolve the contract.
        ...(mode === 'payment' && {
          invoice_creation: {
            enabled: true,
            invoice_data: {
              metadata: {
                contractId: params.contractId,
                productId: params.productId,
              },
            },
          },
        }),
      };

      const session = await stripe.checkout.sessions.create(sessionParams);
      this._logger.log(`Created Stripe checkout session: ${session.id} for contract: ${params.contractId}`);

      return session;

    } catch (error) {
      this._logger.error('Error creating Stripe checkout session', error);
      if (error instanceof AppException) {
        throw error;
      }
      throw new AppException(
        "Something went wrong trying to create Stripe checkout session",
        500,
        error
      );
    }
  }

  /**
   * Construct and verify a Stripe webhook event.
   * Uses a dedicated, apiKey-agnostic Stripe instance since signature verification
   * is a pure HMAC check against the given webhook secret.
   * @param payload The raw request body.
   * @param signature The Stripe signature header.
   * @param webhookSecret The per-product Stripe webhook signing secret.
   * @returns The verified Stripe event.
   */
  constructWebhookEvent(payload: Buffer, signature: string, webhookSecret: string): Stripe.Event {
    if (!webhookSecret) {
      throw new AppException('Stripe webhook secret is required to verify the event', 500);
    }

    try {
      return this._getSignatureVerifier().webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (error) {
      this._logger.error('Error verifying webhook signature', error);
      throw new AppException('Invalid webhook signature', 400, error);
    }
  }

  /**
   * Finds the Stripe invoice a payment collected, to bring a dispute or a refund of the payment back to its invoice.
   * @param paymentIntentId the payment intent of the charge.
   * @param stripeApiKey Stripe secret API key of the owning account.
   * @returns the Stripe invoice ID, or null when the payment collected no invoice.
   * @throws AppException if Stripe cannot be read.
   */
  async findInvoiceOfPayment(paymentIntentId: string, stripeApiKey: string): Promise<string | null> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      const payments = await stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntentId }, limit: 1 });
      const invoice = payments.data[0]?.invoice;
      return typeof invoice === 'string' ? invoice : invoice?.id ?? null;
    } catch (error) {
      this._logger.error(`Error finding the invoice of payment ${paymentIntentId}`, error);
      throw new AppException('Error finding the invoice of a payment on Stripe', 500, error);
    }
  }

  /**
   * Reads who holds a SEPA payment method still attached to a customer: the name and email of the customer, or of the
   * billing details. A payment method detached, as Rocket does with the mandates it no longer needs, has no holder.
   * @param paymentMethodId the Stripe payment method ID.
   * @param stripeApiKey Stripe secret API key of the owning account.
   * @returns the name and email of the holder, or null when the payment method is not attached to a live customer.
   * @throws AppException if Stripe cannot be read.
   */
  async getPaymentMethodHolder(paymentMethodId: string, stripeApiKey: string): Promise<{ name: string; email?: string } | null> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId, { expand: ['customer'] });
      // A deleted customer has no email: only a live one counts.
      const customer = paymentMethod.customer && typeof paymentMethod.customer !== 'string' && 'email' in paymentMethod.customer
        ? paymentMethod.customer
        : null;
      if (!customer) {
        return null;
      }

      const email = customer.email ?? paymentMethod.billing_details.email;
      return {
        name: customer.name ?? paymentMethod.billing_details.name ?? paymentMethodId,
        ...(email && { email }),
      };
    } catch (error) {
      this._logger.error(`Error reading the holder of payment method ${paymentMethodId}`, error);
      throw new AppException('Error reading a payment method from Stripe', 500, error);
    }
  }

  /**
   * Reads the percentage of a tax rate, once per process: Stripe does not let a tax rate change its percentage.
   * @param taxRateId the Stripe tax rate ID.
   * @param stripeApiKey Stripe secret API key of the owning account.
   * @returns the percentage of the tax rate.
   * @throws AppException if Stripe cannot be read.
   */
  async getTaxRatePercent(taxRateId: string, stripeApiKey: string): Promise<number> {
    const cached = this._taxRatePercents.get(taxRateId);
    if (cached !== undefined) {
      return cached;
    }
    const stripe = this._getCompany(stripeApiKey);
    try {
      const taxRate = await stripe.taxRates.retrieve(taxRateId);
      this._taxRatePercents.set(taxRateId, taxRate.percentage);
      return taxRate.percentage;
    } catch (error) {
      this._logger.error(`Error retrieving tax rate: ${taxRateId}`, error);
      throw new AppException('Error retrieving tax rate from Stripe', 500, error);
    }
  }

  /**
   * Get invoice details from Stripe.
   * @param invoiceId The Stripe invoice ID.
   * @param stripeApiKey Stripe secret API key of the owning account.
   * @returns The Stripe invoice.
   */
  async getInvoice(invoiceId: string, stripeApiKey: string): Promise<Stripe.Invoice> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      return await stripe.invoices.retrieve(invoiceId);
    } catch (error) {
      this._logger.error(`Error retrieving invoice: ${invoiceId}`, error);
      throw new AppException('Error retrieving invoice from Stripe', 500, error);
    }
  }

  /**
   * Get subscription details from Stripe.
   * @param subscriptionId The Stripe subscription ID.
   * @param stripeApiKey Stripe secret API key of the owning account.
   * @returns The Stripe subscription.
   */
  async getSubscription(subscriptionId: string, stripeApiKey: string): Promise<Stripe.Subscription> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      return await stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      this._logger.error(`Error retrieving subscription: ${subscriptionId}`, error);
      throw new AppException('Error retrieving subscription from Stripe', 500, error);
    }
  }

  /**
   * Cancel a Stripe subscription.
   * @param subscriptionId The Stripe subscription ID.
   * @param stripeApiKey Stripe secret API key of the owning account.
   * @returns The cancelled Stripe subscription, or null if the subscription was already gone.
   */
  async cancelSubscription(subscriptionId: string, stripeApiKey: string): Promise<Stripe.Subscription | null> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      const subscription = await stripe.subscriptions.cancel(subscriptionId);
      this._logger.log(`Cancelled Stripe subscription: ${subscriptionId}`);
      return subscription;
    } catch (error) {
      // If the subscription is already cancelled or doesn't exist, treat as idempotent success
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') {
        this._logger.warn(`Subscription ${subscriptionId} already cancelled or not found, skipping`);
        return null;
      }
      this._logger.error(`Error cancelling subscription: ${subscriptionId}`, error);
      throw new AppException('Error cancelling subscription on Stripe', 500, error);
    }
  }

  /**
   * Detaches a payment method from its customer, which revokes the SEPA mandate: nothing can be debited on it again.
   * @param paymentMethodId The Stripe payment method ID.
   * @param stripeApiKey Stripe secret API key of the owning account.
   * @throws AppException if Stripe refuses the detach; a method already gone counts as detached.
   */
  async detachPaymentMethod(paymentMethodId: string, stripeApiKey: string): Promise<void> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      await stripe.paymentMethods.detach(paymentMethodId);
      this._logger.log(`Detached Stripe payment method: ${paymentMethodId}`);
    } catch (error) {
      // A payment method that is already detached or gone is the outcome we want: idempotent success.
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') {
        this._logger.warn(`Payment method ${paymentMethodId} already detached or not found, skipping`);
        return;
      }
      this._logger.error(`Error detaching payment method: ${paymentMethodId}`, error);
      throw new AppException('Error detaching the payment method on Stripe', 500, error);
    }
  }

  /**
   * Reads the current period of the seats of a subscription on a volume plan, over which a seat variation is prorated.
   * @param params the subscription, the plan and the Stripe secret API key.
   * @returns the start and the end of the period (ISO strings).
   * @throws AppException if the volume price is not on the subscription or Stripe cannot be read.
   */
  async getSeatsPeriod(params: { subscriptionId: string; plan: ResponsePlanDto; stripeApiKey: string }): Promise<{ start: string; end: string }> {
    const item = await this._seatsItem(params.subscriptionId, params.plan, params.stripeApiKey);
    return {
      start: new Date(item.current_period_start * 1000).toISOString(),
      end: new Date(item.current_period_end * 1000).toISOString(),
    };
  }

  /**
   * Brings the seats of a subscription on a volume plan to a new count, from the next period on: the variation of the
   * current one is not prorated here, Rocket invoices it at the end of the day (UR-RK-401).
   * Stripe applies the tier of the new count, which only grows, so the tier reached never goes back.
   * @param params the subscription, the plan, the new number of seats and the Stripe secret API key.
   * @throws AppException if the volume price is not on the subscription or Stripe refuses the change.
   */
  async updateSeats(params: { subscriptionId: string; plan: ResponsePlanDto; seats: number; stripeApiKey: string }): Promise<void> {
    const item = await this._seatsItem(params.subscriptionId, params.plan, params.stripeApiKey);
    try {
      await this._getCompany(params.stripeApiKey).subscriptions.update(params.subscriptionId, {
        items: [{ id: item.id, quantity: params.seats }],
        proration_behavior: 'none',
      });
      this._logger.log(`Subscription ${params.subscriptionId} moved to ${params.seats} seats from the next period.`);
    } catch (error) {
      this._logger.error(`Error updating the seats of subscription ${params.subscriptionId}`, error);
      throw new AppException('Error updating the seats of the subscription', 500, error);
    }
  }

  /**
   * Finds the item of a subscription that carries the seats: the one on the volume price of the plan.
   * @param subscriptionId the subscription.
   * @param plan the plan of the contract.
   * @param stripeApiKey the Stripe secret API key of the account.
   * @returns the subscription item.
   * @throws AppException if the volume price is not on the subscription.
   */
  private async _seatsItem(subscriptionId: string, plan: ResponsePlanDto, stripeApiKey: string): Promise<Stripe.SubscriptionItem> {
    const subscription = await this.getSubscription(subscriptionId, stripeApiKey);
    const item = subscription.items.data.find(subscriptionItem => {
      const priceId = typeof subscriptionItem.price === 'string' ? subscriptionItem.price : subscriptionItem.price.id;
      return priceId === plan.stripeVolumePriceId;
    });
    if (!item) {
      throw new AppException(`Volume price ${plan.stripeVolumePriceId} not attached to subscription ${subscriptionId}.`, 404);
    }
    return item;
  }

  /**
   * Creates a yearly price for a reseller subscription fee, and the Stripe product of the
   * partner tier when it does not exist yet. Stripe prices never change: a new amount is a new price.
   * @param params the product (absent to create it), its name, the yearly amount and the account.
   * @returns the product and the price created.
   */
  async createYearlyFeePrice(params: {
    stripeProductId?: string;
    productName: string;
    amountCents: number;
    stripeApiKey: string;
  }): Promise<{ stripeProductId: string; stripePriceId: string }> {
    const stripe = this._getCompany(params.stripeApiKey);
    try {
      const stripeProductId = params.stripeProductId
        ?? (await stripe.products.create({ name: params.productName })).id;
      const price = await stripe.prices.create({
        product: stripeProductId,
        currency: 'eur',
        unit_amount: params.amountCents,
        recurring: { interval: 'year' },
      });
      this._logger.log(`Created yearly fee price ${price.id} of ${params.amountCents} cents on product ${stripeProductId}.`);
      return { stripeProductId, stripePriceId: price.id };
    } catch (error) {
      this._logger.error(`Error creating a yearly fee price for ${params.productName}`, error);
      throw new AppException('Error creating the yearly fee price on Stripe', 500, error);
    }
  }

  /**
   * Moves a single-price subscription onto another price, from its next invoice on and without proration.
   * @param params the subscription, the new price and the account.
   */
  async changeSubscriptionPrice(params: {
    subscriptionId: string;
    priceId: string;
    stripeApiKey: string;
  }): Promise<void> {
    const stripe = this._getCompany(params.stripeApiKey);
    try {
      const subscription = await this.getSubscription(params.subscriptionId, params.stripeApiKey);
      const item = subscription.items.data[0];
      if (!item) {
        throw new AppException(`Subscription ${params.subscriptionId} has no item to reprice.`, 404);
      }
      await stripe.subscriptions.update(params.subscriptionId, {
        items: [{ id: item.id, price: params.priceId }],
        proration_behavior: 'none',
      });
      this._logger.log(`Subscription ${params.subscriptionId} moved to price ${params.priceId}.`);
    } catch (error) {
      this._logger.error(`Error repricing subscription ${params.subscriptionId}`, error);
      if (error instanceof AppException) throw error;
      throw new AppException('Error changing the price of the subscription', 500, error);
    }
  }

  /**
   * Creates the Stripe Product + Price(s) that mirror a Rocket Plan.
   * The pricing shape depends on the plan type:
   *   - TIERED_VOLUME  → one Price with billing_scheme='tiered' and tiers_mode='volume', recurring on the given interval.
   *                      When `baseCost` > 0, an additional flat recurring Price is created on the same Product
   *                      and the same interval, representing the fixed base fee billed alongside the per-seat tiered price.
   *   - ONE_TIME       → one Price with a fixed unit_amount, no recurring.
   *   - RECURRING_FLAT → one Price with a fixed unit_amount and a recurring interval.
   * The activation fee and the assistance, when present, become one-time Prices on Products of
   * their own, so that a coupon restricted to a Product discounts only what it should.
   * If any Price creation fails after a Product was already created, every Product created is
   * archived to avoid orphan entries in Stripe.
   * @param dto the DTO describing the plan to mirror on Stripe, including the Stripe secret API key.
   * @returns the Stripe Product id, every created Price id, the volume-price id (TIERED_VOLUME only),
   *          the base-fee Price id (TIERED_VOLUME with baseCost > 0 only), and the Products and
   *          Prices of the activation fee and of the assistance.
   */
  async createStripePricingForPlan(
    dto: CreateStripePlanDto
  ): Promise<StripePlanPricing> {
    const stripe = this._getCompany(dto.stripeApiKey);
    let stripeProduct: Stripe.Product | undefined;
    const extraProductIds: string[] = [];
    try {
      stripeProduct = await stripe.products.create({
        name: dto.planName,
        ...(dto.planDescription && { description: dto.planDescription }),
        metadata: {
          productId: dto.productId,
          planType: dto.type,
          ...(dto.tiersType && { tiersType: dto.tiersType }),
        },
      });

      const currency = dto.currency.toLowerCase();
      const stripePriceIds: string[] = [];
      let stripeVolumePriceId: string | undefined;
      let stripeBasePriceId: string | undefined;

      if (dto.type === PlanType.TieredVolume) {
        const interval = this._toStripeInterval(dto.billingInterval);
        // TIERED_VOLUME prices are always provided as the MONTHLY amount per seat.
        // When the billing interval is annual, multiply by 12 so the Stripe Price
        // charges the equivalent yearly amount in a single bill (Stripe interprets
        // `unit_amount` as the price for the configured `recurring.interval`).
        const stripeTiers = this._mapTiersToStripe(dto.tiers ?? [], dto.billingInterval);

        const volumePrice = await stripe.prices.create({
          product: stripeProduct.id,
          currency,
          billing_scheme: 'tiered',
          tiers_mode: 'volume',
          tiers: stripeTiers,
          recurring: { interval },
        });
        stripePriceIds.push(volumePrice.id);
        stripeVolumePriceId = volumePrice.id;

        // Optional flat base fee billed on the same interval alongside the tiered per-seat price.
        // The input baseCost is also expressed as a MONTHLY amount on TIERED_VOLUME plans, so it
        // gets the same × 12 conversion when the interval is annual.
        if (dto.baseCost != null && dto.baseCost > 0) {
          const baseCostForInterval = this._toIntervalAmount(dto.baseCost, dto.billingInterval);
          const basePrice = await stripe.prices.create({
            product: stripeProduct.id,
            currency,
            unit_amount: Math.round(baseCostForInterval * 100),
            recurring: { interval },
          });
          stripePriceIds.push(basePrice.id);
          stripeBasePriceId = basePrice.id;
        }
      } else if (dto.type === PlanType.OneTime) {
        const price = await stripe.prices.create({
          product: stripeProduct.id,
          currency,
          unit_amount: Math.round((dto.baseCost ?? 0) * 100),
        });
        stripePriceIds.push(price.id);
      } else {
        const price = await stripe.prices.create({
          product: stripeProduct.id,
          currency,
          unit_amount: Math.round((dto.baseCost ?? 0) * 100),
          recurring: { interval: this._toStripeInterval(dto.billingInterval) },
        });
        stripePriceIds.push(price.id);
      }

      const metadata = { productId: dto.productId };
      const activation = dto.activationFeeCents
        ? await this._createOneTimePricing(stripe, `${dto.planName} - Attivazione`, dto.activationFeeCents, currency, metadata)
        : undefined;
      if (activation) extraProductIds.push(activation.productId);
      const assistance = dto.assistance?.amountCents
        ? await this._createOneTimePricing(stripe, dto.assistance.label ?? `${dto.planName} - Assistenza`, dto.assistance.amountCents, currency, metadata)
        : undefined;
      if (assistance) extraProductIds.push(assistance.productId);

      this._logger.log(`Created Stripe pricing for plan "${dto.planName}" (type: ${dto.type}, product: ${stripeProduct.id})`);
      return {
        stripeProductId: stripeProduct.id,
        stripePriceIds,
        stripeVolumePriceId,
        stripeBasePriceId,
        stripeActivationProductId: activation?.productId,
        stripeActivationPriceId: activation?.priceId,
        stripeAssistanceProductId: assistance?.productId,
        stripeAssistancePriceId: assistance?.priceId,
      };

    } catch (error) {
      // Price creation failed after a Product was created: archive every one to avoid orphan entries.
      for (const productId of [stripeProduct?.id, ...extraProductIds].filter((id): id is string => !!id)) {
        try {
          await stripe.products.update(productId, { active: false });
          this._logger.warn(`Archived orphan Stripe product ${productId} after pricing failure`);
        } catch (cleanupErr) {
          this._logger.error(`Failed to archive orphan Stripe product ${productId}`, cleanupErr);
        }
      }
      this._logger.error('Error creating Stripe pricing for plan', error);
      throw new AppException('Something went wrong creating Stripe pricing for plan', 500, error);
    }
  }

  /**
   * Creates a Stripe Product with a single one-time Price.
   * @param stripe the client of the owning account.
   * @param name the name of the Product, shown on the invoices.
   * @param amountCents the amount of the Price in cents.
   * @param currency the currency, lower case.
   * @param metadata the metadata of the Product.
   * @returns the ids of the Product and of the Price.
   */
  private async _createOneTimePricing(
    stripe: Stripe,
    name: string,
    amountCents: number,
    currency: string,
    metadata: Record<string, string>,
  ): Promise<{ productId: string; priceId: string }> {
    const product = await stripe.products.create({ name, metadata });
    const price = await stripe.prices.create({ product: product.id, currency, unit_amount: amountCents });
    return { productId: product.id, priceId: price.id };
  }

  /**
   * Archives a Stripe Product (sets active=false).
   * Intended as a rollback helper when a local persistence step fails after
   * the Stripe Product was already created. Errors are logged and swallowed
   * because the caller is already in an error path.
   * @param stripeProductId the Stripe Product id to archive.
   * @param stripeApiKey Stripe secret API key of the owning account.
   */
  async archiveStripeProduct(stripeProductId: string, stripeApiKey: string): Promise<void> {
    const stripe = this._getCompany(stripeApiKey);
    try {
      await stripe.products.update(stripeProductId, { active: false });
      this._logger.log(`Archived Stripe product: ${stripeProductId}`);
    } catch (error) {
      this._logger.error(`Error archiving Stripe product ${stripeProductId}`, error);
    }
  }

  /**
   * Maps Rocket Tier[] to the shape Stripe expects for volume-tiered prices.
   * Tiers are sorted by ascending `maxValue` and the unbounded tier (maxValue null)
   * becomes the `up_to: 'inf'` tier at the end, as required by Stripe.
   *
   * `tier.price` is always expressed as the MONTHLY unit price on TIERED_VOLUME plans.
   * When the plan billing interval is annual, the unit amount is multiplied by 12 so
   * that the Stripe Price (which charges `unit_amount` once per `recurring.interval`)
   * bills the correct yearly total in a single invoice.
   * @param tiers the Rocket tiers to convert.
   * @param interval the plan billing interval, used to scale the monthly tier price.
   * @returns the Stripe tiers array suitable for `prices.create({ tiers })`.
   */
  private _mapTiersToStripe(tiers: Tier[], interval?: BillingInterval): Stripe.PriceCreateParams.Tier[] {
    const sorted = [...tiers].sort((a, b) => {
      if (a.maxValue == null) return 1;
      if (b.maxValue == null) return -1;
      return a.maxValue - b.maxValue;
    });
    return sorted.map(tier => ({
      up_to: tier.maxValue == null ? 'inf' : tier.maxValue,
      unit_amount: Math.round(this._toIntervalAmount(tier.price, interval) * 100),
    }));
  }

  /**
   * Scales a MONTHLY amount up to the per-interval amount Stripe must charge.
   * Used for TIERED_VOLUME plan pricing (tier prices and the optional flat base fee),
   * which are always provided in monthly units regardless of the billing cadence.
   * @param monthlyAmount the amount expressed as a monthly value.
   * @param interval the plan billing interval (Annual ⇒ × 12, otherwise unchanged).
   * @returns the amount sized for one billing period.
   */
  private _toIntervalAmount(monthlyAmount: number, interval?: BillingInterval): number {
    return interval === BillingInterval.Annual ? monthlyAmount * 12 : monthlyAmount;
  }

  /**
   * Converts a Rocket BillingInterval to the corresponding Stripe recurring interval.
   * Defaults to 'month' when no interval is provided.
   * @param interval the Rocket billing interval.
   * @returns the Stripe recurring interval.
   */
  private _toStripeInterval(interval?: BillingInterval): Stripe.Price.Recurring.Interval {
    return interval === BillingInterval.Annual ? 'year' : 'month';
  }

}
