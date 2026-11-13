import { Injectable, Logger } from "@nestjs/common";
import { SYSTEM_SCOPE } from "@rocket-be/scoping";
import { LazyModuleLoader } from "@nestjs/core";
import Stripe from "stripe";
import { AppException } from "../../../../errors/exception-types";
import { ContractStatus } from "../../../contracts/enums/contract-status.enum";
import type { CompaniesService } from "../../../companies/lazy-companies/services/companies.service";
import { SalesChannel } from "../../../companies/enums/sales-channel.enum";
import { KEUS_STRIPE_ACCOUNT } from "../../../invoices/constants/stripe-account.constant";
import { billedPartyOf } from "../../../invoices/helpers/billed-party.helper";
import { BilledPartyType } from "../../../invoices/enums/billed-party-type.enum";
import type { InvoiceDraft } from "../../../invoices/interfaces/invoice-draft.interface";
import type { InvoicesService } from "../../../invoices/lazy-invoices/services/invoices.service";
import type { ProductsService } from "../../../products/lazy-products/services/products.service";
import type { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import { ResellerContractStatus } from "../../../reseller-contracts/enums/reseller-contract-status.enum";
import { CONTRACT_CHECKOUT_PURPOSE, RESELLER_CHARGE_PURPOSE, RESELLER_MANDATE_CHECKOUT_PURPOSE } from "../../../stripe/constants/metadata-purpose.constant";
import { keusStripeAccount } from "../../../stripe/helpers/keus-stripe-account.helper";
import type { StripeService } from "../../../stripe/lazy-stripe/services/stripe.service";
import { ContractsService } from "../../../contracts/lazy-contracts/services/contracts.service";
import { ContractNoticesService } from "../../../contracts/lazy-contracts/services/contract-notices.service";
import type { Invoice } from "../../../invoices/schemas/invoice.schema";
import { MailTemplate } from "../../../mail/enums/mail-template.enum";
import { formatDate, formatEuro, rocketUrl } from "../../../../commons/formatting/notice-format.helper";
import type { ResellerContractsService } from "../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service";

/** The contract an invoice or a subscription belongs to: a reseller contract when `resellerId` is set. */
type ContractRef = { contractId: string; productId: string; resellerId?: string };

/** The Stripe account an event comes from: its name for the notices, and its key to read Stripe back. */
export type StripeEventAccount = { name: string; apiKey?: string };

/** What the webhooks read of a contract, whichever entity it is. */
type BilledContract = {
  /** Status of the contract. */
  status: ContractStatus | ResellerContractStatus;
  /** Stripe subscription already recorded on the contract. */
  stripeSubscriptionId?: string;
};

/**
 * Service for handling Stripe webhook events.
 */
@Injectable()
export class StripeWebhookService {
  /** Logger instance for StripeWebhookService. */
  private readonly _logger = new Logger(StripeWebhookService.name);

  /** Lazy-loaded contracts service */
  private _contractsService: ContractsService | null = null;

  /** Lazy-loaded contract notices service */
  private _contractNoticesService: ContractNoticesService | null = null;

  /** Lazy-loaded reseller contracts service */
  private _resellerContractsService: ResellerContractsService | null = null;

  /** Lazy-loaded companies service */
  private _companiesService: CompaniesService | null = null;

  /** Lazy-loaded invoices service */
  private _invoicesService: InvoicesService | null = null;

  /** Lazy-loaded resellers service */
  private _resellersService: ResellersService | null = null;

  /** Lazy-loaded products service */
  private _productsService: ProductsService | null = null;

  /** Lazy-loaded Stripe service */
  private _stripeService: StripeService | null = null;

  /**
   * Constructor for StripeWebhookService.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

  /**
   * Lazy loads the ContractsService from its module.
   * @returns A Promise resolving to the ContractsService instance.
   */
  private async _loadContractsService(): Promise<ContractsService> {
    if (!this._contractsService) {
      const { ContractsLazyModule } = await import(
        "../../../contracts/lazy-contracts/contracts-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ContractsLazyModule,
      );
      this._contractsService = moduleRef.get<ContractsService>(ContractsService);
    }
    return this._contractsService;
  }

  /**
   * Lazy loads the ContractNoticesService from the contracts module.
   * @returns a Promise resolving to the ContractNoticesService instance.
   */
  private async _loadContractNoticesService(): Promise<ContractNoticesService> {
    if (!this._contractNoticesService) {
      const { ContractsLazyModule } = await import("../../../contracts/lazy-contracts/contracts-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ContractsLazyModule);
      this._contractNoticesService = moduleRef.get<ContractNoticesService>(ContractNoticesService);
    }
    return this._contractNoticesService;
  }

  /**
   * Lazy loads the ResellerContractsService from its module.
   * @returns A Promise resolving to the ResellerContractsService instance.
   */
  private async _loadResellerContractsService(): Promise<ResellerContractsService> {
    if (!this._resellerContractsService) {
      const { ResellerContractsLazyModule } = await import(
        "../../../reseller-contracts/lazy-reseller-contracts/reseller-contracts-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ResellerContractsLazyModule,
      );
      const { ResellerContractsService } = await import(
        "../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service"
      );
      this._resellerContractsService = moduleRef.get<ResellerContractsService>(ResellerContractsService);
    }
    return this._resellerContractsService;
  }

  /**
   * Reads the contract an event belongs to, from the customer or the reseller contracts.
   * @param ref the contract reference found in the Stripe metadata.
   * @returns what the webhooks need of the contract.
   */
  private async _readContract(ref: ContractRef): Promise<BilledContract> {
    if (ref.resellerId) {
      const resellerContractsService = await this._loadResellerContractsService();
      return resellerContractsService.getContract(ref.resellerId, ref.contractId, SYSTEM_SCOPE);
    }
    const contractsService = await this._loadContractsService();
    return contractsService.getContract(ref.productId, ref.contractId, SYSTEM_SCOPE);
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
      const moduleRef = await this._lazyModuleLoader.load(() => CompaniesLazyModule);
      const { CompaniesService } = await import(
        "../../../companies/lazy-companies/services/companies.service"
      );
      this._companiesService = moduleRef.get<CompaniesService>(CompaniesService);
    }
    return this._companiesService;
  }

  /**
   * Lazy loads the InvoicesService from its module.
   * @returns A Promise resolving to the InvoicesService instance.
   */
  private async _loadInvoicesService(): Promise<InvoicesService> {
    if (!this._invoicesService) {
      const { InvoicesLazyModule } = await import("../../../invoices/lazy-invoices/invoices-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => InvoicesLazyModule);
      const { InvoicesService } = await import("../../../invoices/lazy-invoices/services/invoices.service");
      this._invoicesService = moduleRef.get<InvoicesService>(InvoicesService);
    }
    return this._invoicesService;
  }

  /**
   * Lazy loads the ResellersService from its module.
   * @returns A Promise resolving to the ResellersService instance.
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
   * Lazy loads the ProductsService from its module.
   * @returns A Promise resolving to the ProductsService instance.
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
   * Lazy loads the StripeService from its module.
   * @returns A Promise resolving to the StripeService instance.
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
   * Process a Stripe webhook event.
   * @param event The Stripe event to process.
   * @param account the Stripe account the event comes from.
   */
  async processWebhookEvent(event: Stripe.Event, account: StripeEventAccount): Promise<void> {
    this._logger.log(`Processing webhook event: ${event.type}`);

    switch (event.type) {
      // `invoice.paid` also comes for an invoice marked paid by hand and for the invoice of a one-off checkout, created
      // once the debit succeeds: the handler is safe to run twice on the same invoice.
      case 'invoice.payment_succeeded':
      case 'invoice.paid':
        await this._handleInvoicePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await this._handleInvoicePaymentFailed(event.data.object);
        break;

      case 'invoice.finalized':
        await this._handleInvoiceFinalized(event.data.object);
        break;

      case 'invoice.voided':
        await this._handleInvoiceVoided(event.data.object);
        break;

      case 'customer.subscription.deleted':
        this._handleSubscriptionDeleted(event.data.object);
        break;

      case 'checkout.session.completed':
        await this._handleCheckoutSessionCompleted(event.data.object);
        break;

      case 'checkout.session.async_payment_failed':
        await this._handleCheckoutPaymentFailed(event.data.object);
        break;

      case 'charge.dispute.created':
        await this._handleDisputeCreated(event.data.object, account);
        break;

      case 'charge.dispute.closed':
        await this._handleDisputeClosed(event.data.object, account);
        break;

      case 'charge.refunded':
        await this._handleChargeRefunded(event.data.object, account);
        break;

      case 'mandate.updated':
        await this._handleMandateUpdated(event.data.object, account);
        break;

      default:
        this._logger.log(`Unhandled event type: ${event.type}`);
    }
  }

  /**
   * Handle checkout.session.completed event: the checkout of a contract records its mandate and subscription, a
   * reseller's mandate checkout records the SEPA mandate of the reseller.
   */
  private async _handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const { purpose, contractId, productId, resellerId, accountKey } = session.metadata ?? {};
    if (purpose === CONTRACT_CHECKOUT_PURPOSE && contractId && productId) {
      const contractsService = await this._loadContractsService();
      await contractsService.recordCheckout(productId, contractId, session.id);
      return;
    }
    const setupIntent = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id;
    if (session.mode !== 'setup' || !setupIntent) {
      this._logger.log(`Checkout session ${session.id} is not a known checkout, skipping`);
      return;
    }
    if (purpose === RESELLER_MANDATE_CHECKOUT_PURPOSE && resellerId && contractId && accountKey) {
      const resellerContractsService = await this._loadResellerContractsService();
      await resellerContractsService.recordMandate(resellerId, contractId, accountKey, setupIntent);
    } else {
      this._logger.warn(`Setup checkout ${session.id} has no known purpose, skipping`);
    }
  }

  /**
   * Handle checkout.session.async_payment_failed event: the SEPA debit of a one-off checkout failed days after the
   * checkout was completed. Stripe creates no invoice for it, so the contract goes back to its checkout and the Keus
   * administration is told, as for any failed charge. A checkout of a subscription learns the failure from its invoice,
   * and a contract reopened already, as on a repeated webhook, tells nothing again.
   */
  private async _handleCheckoutPaymentFailed(session: Stripe.Checkout.Session): Promise<void> {
    const { purpose, contractId, productId } = session.metadata ?? {};
    if (purpose !== CONTRACT_CHECKOUT_PURPOSE || !contractId || !productId || session.mode !== 'payment') {
      this._logger.log(`Checkout session ${session.id} is not the one-off payment of a contract, skipping`);
      return;
    }

    const contractsService = await this._loadContractsService();
    if (!(await contractsService.reopenCheckout(productId, contractId))) {
      return;
    }
    const contract = await contractsService.getContract(productId, contractId, SYSTEM_SCOPE);

    const contractNoticesService = await this._loadContractNoticesService();
    await contractNoticesService.toAccounting(MailTemplate.PaymentFailed, {
      partyName: contract.companyName,
      amount: formatEuro(session.amount_total ?? 0),
      attempt: 1,
      nextAttempt: "",
      invoices: "non ancora emessa",
      scheduleUrl: rocketUrl("/billing/schedule"),
    });
  }

  /**
   * Handle charge.dispute.created event: the customer disputed a SEPA debit with its bank, and Stripe gave the amount
   * back. The invoices of the charge are unpaid again and their dunning starts from the dispute; the Keus
   * administration is told. A dispute already recorded, as on a repeated webhook, tells nothing again.
   */
  private async _handleDisputeCreated(dispute: Stripe.Dispute, account: StripeEventAccount): Promise<void> {
    const stripeInvoiceId = await this._invoiceOfPayment(dispute.payment_intent, account, `Dispute ${dispute.id}`);
    if (!stripeInvoiceId) {
      return;
    }

    const invoicesService = await this._loadInvoicesService();
    const reopened = await invoicesService.reopenCharge(stripeInvoiceId);
    if (!reopened.length) {
      this._logger.log(`Dispute ${dispute.id} of invoice ${stripeInvoiceId} already recorded: nothing to notify.`);
      return;
    }
    await this._noticeDispute(dispute, reopened, {});
  }

  /**
   * Handle charge.dispute.closed event. Won: the amount comes back to Keus, the invoices are paid again and the access
   * suspended meanwhile returns. Lost: the amount stays with the customer, the invoices stay unpaid and the dunning
   * goes on. Either way the Keus administration is told; a dispute closed as an inquiry changes nothing.
   */
  private async _handleDisputeClosed(dispute: Stripe.Dispute, account: StripeEventAccount): Promise<void> {
    if (dispute.status !== 'won' && dispute.status !== 'lost') {
      this._logger.log(`Dispute ${dispute.id} closed as ${dispute.status}: nothing to record.`);
      return;
    }
    const stripeInvoiceId = await this._invoiceOfPayment(dispute.payment_intent, account, `Dispute ${dispute.id}`);
    if (!stripeInvoiceId) {
      return;
    }

    const invoicesService = await this._loadInvoicesService();
    if (dispute.status === 'lost') {
      const invoices = await invoicesService.getInvoicesOfCharge(stripeInvoiceId);
      if (invoices.length) {
        await this._noticeDispute(dispute, invoices, { lost: true });
      }
      return;
    }

    const paid = await invoicesService.markChargePaid(stripeInvoiceId);
    if (!paid.length) {
      this._logger.log(`Dispute ${dispute.id} of invoice ${stripeInvoiceId} already won: nothing to notify.`);
      return;
    }
    const contractsService = await this._loadContractsService();
    for (const invoice of paid.filter(invoice => invoice.contractId && invoice.lineProductId)) {
      await contractsService.restoreAccess(invoice.lineProductId, invoice.contractId);
    }
    await this._noticeDispute(dispute, paid, { won: true });
  }

  /**
   * Tells the Keus administration about a dispute: opened, won or lost.
   * @param dispute the Stripe dispute.
   * @param invoices the invoices of the disputed charge.
   * @param outcome how the dispute closed, nothing while it is open.
   */
  private async _noticeDispute(dispute: Stripe.Dispute, invoices: Invoice[], outcome: { won?: true; lost?: true }): Promise<void> {
    const contractNoticesService = await this._loadContractNoticesService();
    await contractNoticesService.toAccounting(MailTemplate.PaymentDisputed, {
      partyName: invoices[0].billedParty.name,
      amount: formatEuro(dispute.amount),
      invoices: this._invoicesLabel(invoices),
      scheduleUrl: rocketUrl("/billing/schedule"),
      ...outcome,
    });
  }

  /**
   * Handle charge.refunded event: Keus refunded a charge on Stripe. Rocket leaves its invoices as they are, since the
   * credit note is issued on Sibill: the Keus administration is told, with the amount refunded so far.
   */
  private async _handleChargeRefunded(charge: Stripe.Charge, account: StripeEventAccount): Promise<void> {
    const stripeInvoiceId = await this._invoiceOfPayment(charge.payment_intent, account, `Charge ${charge.id}`);
    if (!stripeInvoiceId) {
      return;
    }

    const invoicesService = await this._loadInvoicesService();
    const invoices = await invoicesService.getInvoicesOfCharge(stripeInvoiceId);
    if (!invoices.length) {
      this._logger.log(`Refund of charge ${charge.id} belongs to no invoice of Rocket: nothing to notify.`);
      return;
    }

    const contractNoticesService = await this._loadContractNoticesService();
    await contractNoticesService.toAccounting(MailTemplate.PaymentRefunded, {
      partyName: invoices[0].billedParty.name,
      amount: formatEuro(charge.amount_refunded),
      chargedAmount: formatEuro(charge.amount),
      invoices: this._invoicesLabel(invoices),
      scheduleUrl: rocketUrl("/billing/schedule"),
    });
  }

  /**
   * Handle mandate.updated event: a SEPA mandate no longer active, revoked by its holder, makes the next debits fail,
   * so the Keus administration is told before they do. A mandate whose payment method Rocket detached, as for the
   * mandates of a reseller it no longer needs, tells nothing.
   */
  private async _handleMandateUpdated(mandate: Stripe.Mandate, account: StripeEventAccount): Promise<void> {
    if (mandate.status !== 'inactive') {
      return;
    }
    if (!account.apiKey) {
      this._logger.warn(`Mandate ${mandate.id} of account ${account.name} became inactive, but the account has no Stripe key: skipped.`);
      return;
    }

    const paymentMethodId = typeof mandate.payment_method === 'string' ? mandate.payment_method : mandate.payment_method.id;
    const stripeService = await this._loadStripeService();
    const holder = await stripeService.getPaymentMethodHolder(paymentMethodId, account.apiKey);
    if (!holder) {
      this._logger.log(`Mandate ${mandate.id} is inactive because its payment method was detached: nothing to notify.`);
      return;
    }

    const contractNoticesService = await this._loadContractNoticesService();
    await contractNoticesService.toAccounting(MailTemplate.MandateRevoked, {
      customerName: holder.name,
      customerEmail: holder.email ?? "",
      accountName: account.name,
      scheduleUrl: rocketUrl("/billing/schedule"),
    });
  }

  /**
   * Finds the Stripe invoice a payment collected, for an event about the payment rather than the invoice.
   * @param paymentIntent the payment intent of the event.
   * @param account the Stripe account the event comes from.
   * @param subject what the event is about, for the log.
   * @returns the Stripe invoice ID, or null when there is none to find.
   */
  private async _invoiceOfPayment(paymentIntent: string | Stripe.PaymentIntent | null, account: StripeEventAccount, subject: string): Promise<string | null> {
    const paymentIntentId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id;
    if (!paymentIntentId || !account.apiKey) {
      this._logger.warn(`${subject} has no payment intent, or account ${account.name} has no Stripe key: skipped.`);
      return null;
    }

    const stripeService = await this._loadStripeService();
    const stripeInvoiceId = await stripeService.findInvoiceOfPayment(paymentIntentId, account.apiKey);
    if (!stripeInvoiceId) {
      this._logger.log(`${subject} is about a payment of no invoice: nothing to record.`);
    }
    return stripeInvoiceId;
  }

  /**
   * Describes the invoices of a charge for a notice: their numbers, or that they have none yet.
   * @param invoices the invoices of the charge.
   * @returns the label, such as «fatture 12, 13».
   */
  private _invoicesLabel(invoices: Invoice[]): string {
    const numbers = invoices.map(invoice => invoice.number).filter((number): number is string => !!number);
    if (!numbers.length) {
      return "fattura non ancora numerata";
    }
    return `${numbers.length === 1 ? "fattura" : "fatture"} ${numbers.join(", ")}`;
  }

  /**
   * Handle invoice.payment_succeeded event.
   * Marks the invoices of the charge paid, records the subscription and the end of the period it paid, and gives access
   * back to the tenant.
   * For a reseller contract it also sets the price of the next year of fee.
   */
  private async _handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    this._logger.log(`Handling invoice.payment_succeeded for invoice: ${invoice.id}`);

    // The invoices of the charge, a contract's or a reseller's monthly ones, are paid.
    await this._recordInvoice(invoice);
    const invoicesService = await this._loadInvoicesService();
    await invoicesService.markChargePaid(invoice.id);

    // The charge of the 4th is collected: a mandate that nothing is owed on any more can go.
    if (invoice.metadata?.purpose === RESELLER_CHARGE_PURPOSE && invoice.metadata.resellerId) {
      const resellerContractsService = await this._loadResellerContractsService();
      await resellerContractsService.settleMandates(invoice.metadata.resellerId);
    }

    const metadata = this._getMetadataFromInvoice(invoice);
    if (!metadata.contractId || !metadata.productId) {
      this._logger.log(`Invoice ${invoice.id} belongs to no contract: nothing else to do`);
      return;
    }

    const ref = metadata as ContractRef;
    const contract = await this._readContract(ref);

    // Assign subscription ID from invoice if the contract doesn't have one yet
    const sub = invoice.parent?.subscription_details?.subscription;
    const subscriptionId = typeof sub === 'string' ? sub : sub?.id;

    // A reseller contract has its own entity: it records the subscription and starts at the first payment.
    if (ref.resellerId) {
      const resellerContractsService = await this._loadResellerContractsService();
      if (subscriptionId && !contract.stripeSubscriptionId) {
        await resellerContractsService.recordSubscription(ref.resellerId, ref.contractId, subscriptionId);
      }
      // The first payment settles the fee: the contract starts once its mandates are all active too.
      if (contract.status === ResellerContractStatus.Signed) {
        await resellerContractsService.activateIfReady(ref.resellerId, ref.contractId);
      }
      // Each paid year moves the subscription onto the fee of the next one.
      const periodStart = invoice.lines.data[0]?.period.start;
      if (invoice.amount_due > 0 && periodStart) {
        await resellerContractsService.prepareNextYearPrice(ref.resellerId, ref.contractId, periodStart);
      }
      return;
    }

    const contractsService = await this._loadContractsService();
    if (subscriptionId && !contract.stripeSubscriptionId) {
      await contractsService.recordSubscription(metadata.productId, metadata.contractId, subscriptionId);
    }
    // A subscription invoice pays up to the end of its lines: the period ahead, and the prorations up to the same end.
    const periodEnd = Math.max(0, ...invoice.lines.data.map(line => line.period.end));
    if (subscriptionId && periodEnd > 0) {
      await contractsService.recordSubscriptionPaidUntil(metadata.productId, metadata.contractId, new Date(periodEnd * 1000).toISOString());
    }
    // A paid invoice gives access back to a tenant suspended for a previous one.
    await contractsService.restoreAccess(metadata.productId, metadata.contractId);
  }

  /**
   * Handle invoice.payment_failed event.
   * Marks the invoices of the charge unpaid and tells the Keus administration, at every failed attempt (UR-RK-155).
   * Access is never suspended here: Stripe keeps retrying, and the suspension comes only after the days of dunning.
   */
  private async _handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    this._logger.log(`Handling invoice.payment_failed for invoice: ${invoice.id}`);

    // The invoices of the charge, a contract's or a reseller's monthly ones, are unpaid.
    await this._recordInvoice(invoice);
    const invoicesService = await this._loadInvoicesService();
    const unpaid = await invoicesService.markChargeUnpaid(invoice.id, invoice.attempt_count);
    if (!unpaid.length) {
      this._logger.log(`Attempt ${invoice.attempt_count} of invoice ${invoice.id} already recorded: nothing to notify.`);
      return;
    }
    await this._noticePaymentFailed(invoice, unpaid);
  }

  /**
   * Tells the Keus administration that a charge failed: who, how much, which attempt and whether Stripe tries again.
   * @param charge the Stripe invoice whose charge failed.
   * @param invoices the invoices the charge collects.
   */
  private async _noticePaymentFailed(charge: Stripe.Invoice, invoices: Invoice[]): Promise<void> {
    const numbers = invoices.map(invoice => invoice.number).filter((number): number is string => !!number);
    const contractNoticesService = await this._loadContractNoticesService();
    await contractNoticesService.toAccounting(MailTemplate.PaymentFailed, {
      partyName: invoices[0].billedParty.name,
      amount: formatEuro(charge.amount_due),
      attempt: charge.attempt_count,
      nextAttempt: charge.next_payment_attempt ? formatDate(new Date(charge.next_payment_attempt * 1000)) : "",
      invoices: numbers.length ? numbers.join(", ") : "non ancora numerate",
      scheduleUrl: rocketUrl("/billing/schedule"),
    });
  }

  /**
   * Handle invoice.finalized event: the invoice is issued, and marked paid if Stripe already collected it.
   */
  private async _handleInvoiceFinalized(invoice: Stripe.Invoice): Promise<void> {
    this._logger.log(`Handling invoice.finalized for invoice: ${invoice.id}`);
    await this._recordInvoice(invoice);
    if (invoice.status === 'paid') {
      const invoicesService = await this._loadInvoicesService();
      await invoicesService.markChargePaid(invoice.id);
    }
  }

  /**
   * Handle invoice.voided event: the invoices it charged are void.
   */
  private async _handleInvoiceVoided(invoice: Stripe.Invoice): Promise<void> {
    this._logger.log(`Handling invoice.voided for invoice: ${invoice.id}`);
    const invoicesService = await this._loadInvoicesService();
    await invoicesService.voidCharge(invoice.id);
  }

  /**
   * Issues the invoice of a Stripe invoice, from the contract or the reseller contract it charges, with the details
   * of the billed party frozen at issue. Issuing again the same charge is a no-op, so any event may come first.
   * Each item takes the taxable amount of its Stripe line, net of discounts and VAT.
   * @param invoice the Stripe invoice.
   * @returns whether the charge has its invoice: false for a charge of no contract or of no amount.
   */
  private async _recordInvoice(invoice: Stripe.Invoice): Promise<boolean> {
    const ref = this._getMetadataFromInvoice(invoice);
    if (!invoice.id || !ref.contractId || !ref.productId || invoice.total === 0) {
      return false;
    }
    const items = invoice.lines.data.map(line => ({ description: line.description ?? '', amountCents: this._taxableOf(line) }));
    const dueDate = new Date((invoice.due_date ?? invoice.created) * 1000).toISOString();

    let draft: InvoiceDraft;
    if (ref.resellerId) {
      const account = keusStripeAccount();
      const vatRatePercent = await this._vatRateOf(account.taxRateId, account.apiKey, "KEUS_STRIPE_TAX_RATE_ID");
      const resellersService = await this._loadResellersService();
      const reseller = await resellersService.getReseller(ref.resellerId, SYSTEM_SCOPE);
      draft = {
        vatRatePercent,
        dueDate,
        billedPartyId: reseller.id,
        billedPartyType: BilledPartyType.Reseller,
        billedParty: billedPartyOf(reseller),
        channel: SalesChannel.Reseller,
        items,
        resellerContractId: ref.contractId,
        stripeAccount: KEUS_STRIPE_ACCOUNT,
      };
    } else {
      const contractsService = await this._loadContractsService();
      const contract = await contractsService.getContract(ref.productId, ref.contractId, SYSTEM_SCOPE);
      const productsService = await this._loadProductsService();
      const product = await productsService.getProduct(contract.productId);
      if (!product.stripeApiKey) {
        throw new AppException(`Product ${contract.productId} has no Stripe account configured.`, 500);
      }
      const vatRatePercent = await this._vatRateOf(product.stripeTaxRateId, product.stripeApiKey, `stripeTaxRateId of product ${product.id}`);
      const companiesService = await this._loadCompaniesService();
      const company = await companiesService.getCompany(contract.companyId, SYSTEM_SCOPE);
      draft = {
        vatRatePercent,
        dueDate,
        billedPartyId: company.id,
        billedPartyType: BilledPartyType.Company,
        billedParty: billedPartyOf(company),
        channel: SalesChannel.Direct,
        items: items.map(item => ({ ...item, orderId: contract.orderId, productId: contract.productId })),
        orderId: contract.orderId,
        lineProductId: contract.productId,
        contractId: contract.id,
        stripeAccount: contract.productId,
        ...(ref.prorationId && { prorationId: ref.prorationId }),
      };
    }
    const invoicesService = await this._loadInvoicesService();
    await invoicesService.issueInvoice(draft, invoice);
    return true;
  }

  /**
   * Reads the VAT rate of an account from the tax rate configured for it, the one Stripe applies to its invoices.
   * @param taxRateId the configured Stripe tax rate.
   * @param stripeApiKey the secret API key of the account.
   * @param setting where the tax rate is configured, for the error.
   * @returns the VAT rate, in percent.
   * @throws AppException if no tax rate is configured: the invoice cannot carry the VAT.
   */
  private async _vatRateOf(taxRateId: string | undefined, stripeApiKey: string, setting: string): Promise<number> {
    if (!taxRateId) {
      throw new AppException(`No Stripe tax rate configured in ${setting}: the invoice cannot carry the VAT.`, 500);
    }
    const stripeService = await this._loadStripeService();
    return stripeService.getTaxRatePercent(taxRateId, stripeApiKey);
  }

  /**
   * Returns the taxable amount of a Stripe invoice line: the base of its tax when Stripe taxed it, otherwise its
   * amount net of the discounts and of the credits applied before tax.
   * @param line the invoice line.
   * @returns the taxable amount in cents.
   */
  private _taxableOf(line: Stripe.InvoiceLineItem): number {
    const taxed = line.taxes?.find(tax => tax.taxable_amount !== null);
    if (taxed?.taxable_amount != null) {
      return taxed.taxable_amount;
    }
    const discounts = (line.discount_amounts ?? []).reduce((total, discount) => total + discount.amount, 0);
    const credits = (line.pretax_credit_amounts ?? []).reduce((total, credit) => total + credit.amount, 0);
    return line.amount - discounts - credits;
  }

  /**
   * Handle subscription.deleted event.
   * A subscription ends only by a decision of Keus, and access is suspended only after the days of dunning: a
   * subscription gone on Stripe, as when its retries are set to cancel it, is flagged for the operator.
   */
  private _handleSubscriptionDeleted(subscription: Stripe.Subscription): void {
    const { contractId, resellerId } = subscription.metadata;
    this._logger.error(
      `Subscription ${subscription.id} of ${resellerId ? `reseller contract ${contractId}` : `contract ${contractId}`} was deleted on Stripe: check the retry settings of the account.`,
    );
  }

  /**
   * Extract contract metadata from invoice.
   */
  private _getMetadataFromInvoice(invoice: Stripe.Invoice): { contractId?: string; productId?: string; resellerId?: string; prorationId?: string } {
    // Try subscription metadata first (available on subscription-generated invoices)
    const subDetails = invoice.parent?.subscription_details;
    if (subDetails?.metadata) {
      const { contractId, productId, resellerId } = subDetails.metadata;
      if (contractId && productId) {
        return { contractId, productId, ...(resellerId && { resellerId }) };
      }
    }

    // Fallback to invoice metadata
    if (invoice.metadata) {
      return {
        contractId: invoice.metadata.contractId,
        productId: invoice.metadata.productId,
        ...(invoice.metadata.resellerId && { resellerId: invoice.metadata.resellerId }),
        ...(invoice.metadata.prorationId && { prorationId: invoice.metadata.prorationId }),
      };
    }

    return {};
  }
}
