import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { Condition, transaction } from "dynamoose";
import { SortOrder } from "dynamoose/dist/General";
import { InjectModel, Model } from "nestjs-dynamoose";
import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import { isConditionalCheckFailed, isTransactionCanceled } from "../../../../commons/persistence/write-errors.helper";
import { toDynamooseUpdate } from "../../../../commons/persistence/removable-update.helper";
import { Page, pageByDueDate, paginateMerged, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { AppException, BusinessException, DatabaseException, EntityNotFoundException, ValidationException } from "../../../../errors/exception-types";
import { fatturaPaOf } from "../../../sibill/helpers/fattura-pa.helper";
import type { SibillService } from "../../../sibill/lazy-sibill/services/sibill.service";
import type { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import { SYSTEM_SCOPE } from "@rocket-be/scoping";
import { BilledPartyType } from "../../enums/billed-party-type.enum";
import { InvoiceDocumentStatus, SIBILL_DOCUMENT_STATUSES } from "../../enums/invoice-document-status.enum";
import { InvoiceStatus } from "../../enums/invoice-status.enum";
import { DUNNING_DAYS, DunningStep } from "../../enums/dunning-step.enum";
import { formatDate, formatEuro, rocketUrl } from "../../../../commons/formatting/notice-format.helper";
import { MailTemplate } from "../../../mail/enums/mail-template.enum";
import type { ContractNoticesService } from "../../../contracts/lazy-contracts/services/contract-notices.service";
import type { ContractsService } from "../../../contracts/lazy-contracts/services/contracts.service";
import type { ResellerContractsService } from "../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service";
import { dropRecorded, EXPECTED_CACHE_MS } from "../../helpers/expected-charges.helper";
import { invoiceAmounts } from "../../helpers/invoice-amounts.helper";
import { InvoiceDraft } from "../../interfaces/invoice-draft.interface";
import { Invoice, InvoiceKey } from "../../schemas/invoice.schema";
import { todayInItaly } from "../../../../commons/dates/calendar-day.helper";
import { integrationsEnabled } from "../../../../commons/integrations/integrations.helper";
import { InvoiceFiltersPageQueryDto, InvoicesPageQueryDto, PeriodInvoicesPageQueryDto } from "../../dtos/invoices-page-query.dto";
import { KeusSchedulePageQueryDto } from "../../dtos/keus-schedule-page-query.dto";
import { ResponseInvoiceDto } from "../../dtos/response-invoice.dto";
import { ResponseInvoicesPageDto } from "../../dtos/response-invoices-page.dto";
import { ResponseScheduleEntryDto } from "../../dtos/response-schedule-entry.dto";
import { ResponseSchedulePageDto } from "../../dtos/response-schedule-page.dto";
import { ScheduleDirection } from "../../enums/schedule-direction.enum";
import { ScheduleStatus } from "../../enums/schedule-status.enum";
import type { ExpectedCharge } from "../../interfaces/expected-charge.interface";
import { ChargeSchedulerService } from "./charge-scheduler.service";
import { ProFormaService } from "./pro-forma.service";


/** Longest period a listing by month reads: one partition per month. */
const MAX_PERIOD_MONTHS = 24;

/**
 * Service for the invoices Rocket records: it computes their amounts as the electronic invoice
 * checks them, follows the collection of the Stripe invoice that charges them and, once an invoice is
 * paid, creates its electronic invoice as a draft at Sibill: an invoice never paid never reaches Sibill,
 * and the reminders and the suspension depend on the payment only. The creation goes in two steps: the
 * invoice is recorded TO_ISSUE first, then at the payment one caller claims it (`documentStatus`) and
 * calls Sibill, so a repeated event never creates it twice. The CEO issues the draft from Sibill, whose
 * webhook brings the following states.
 * An invoice stays in the schedule (`dueMonth`) once paid, as a collected payment, and leaves it only when void; it
 * stays in the unpaid set (`unpaidChannel`) only while its charge has failed.
 */
@Injectable()
export class InvoicesService {
  /** Logger instance for InvoicesService. */
  private readonly _logger = new Logger(InvoicesService.name);

  /** Lazy-loaded Sibill service. */
  private _sibillService: SibillService | null = null;

  /** Lazy-loaded resellers service, for the visibility of a reseller's invoices. */
  private _resellersService: ResellersService | null = null;

  /** Lazy-loaded contracts service, for the suspension at the end of the dunning. */
  private _contractsService: ContractsService | null = null;

  /** Lazy-loaded reseller contracts service, for the fees expected in the schedule. */
  private _resellerContractsService: ResellerContractsService | null = null;

  /** Expected payments counted recently, by period and product, with when they were counted. */
  private readonly _expectedCache = new Map<string, { countedAt: number; charges: Promise<ExpectedCharge[]> }>();

  /** Lazy-loaded contract notices service, for the reminders of the dunning. */
  private _contractNoticesService: ContractNoticesService | null = null;

  /**
   * Constructor for InvoicesService.
   * @param _invoiceModel the Dynamoose model for invoices.
   * @param _chargeScheduler the scheduler of the charge of the resellers on the 4th and of the dunning.
   * @param _proFormaService the pro forma of the invoices to the resellers.
   * @param _lazyModuleLoader the lazy module loader, for the Sibill, resellers, contracts and reseller contracts services.
   */
  constructor(
    @InjectModel("Invoice") private readonly _invoiceModel: Model<Invoice, InvoiceKey>,
    private readonly _chargeScheduler: ChargeSchedulerService,
    private readonly _proFormaService: ProFormaService,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) {}

  /**
   * Lazy loads the SibillService from its module.
   * @returns a Promise resolving to the SibillService instance.
   */
  private async _loadSibillService(): Promise<SibillService> {
    if (!this._sibillService) {
      const { SibillLazyModule } = await import("../../../sibill/lazy-sibill/sibill-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => SibillLazyModule);
      const { SibillService } = await import("../../../sibill/lazy-sibill/services/sibill.service");
      this._sibillService = moduleRef.get<SibillService>(SibillService);
    }
    return this._sibillService;
  }

  /**
   * Issues an invoice charged by a Stripe invoice: it is recorded TO_ISSUE, and its electronic invoice is created at
   * the payment. The same draft issued again for the same charge returns the invoice already recorded, so a repeated
   * webhook does not issue twice. A total that differs from the amount Stripe charges stops the electronic invoice:
   * it is recorded as FAILED, for an operator once it is paid.
   * @param draft the invoice to issue.
   * @param charge the Stripe invoice that charges it.
   * @returns the recorded invoice.
   * @throws AppException if the Stripe invoice has no id.
   * @throws DatabaseException if the write fails.
   */
  async issueInvoice(draft: InvoiceDraft, charge: Stripe.Invoice): Promise<Invoice> {
    const stripeInvoiceId = charge.id;
    if (!stripeInvoiceId) {
      throw new AppException("A Stripe invoice without id cannot be recorded.", HttpStatus.BAD_REQUEST);
    }

    const already = (await this.getInvoicesOfCharge(stripeInvoiceId))
      .find(invoice => invoice.billedPartyId === draft.billedPartyId && invoice.orderId === draft.orderId && invoice.lineProductId === draft.lineProductId);
    if (already) {
      this._logger.log(`Invoice for Stripe invoice ${stripeInvoiceId} already recorded as ${already.id}.`);
      return already;
    }

    const amounts = invoiceAmounts(draft.items, draft.vatRatePercent);
    const mismatch = amounts.amountCents !== charge.total
      ? `The invoice totals ${amounts.amountCents} cents but Stripe charges ${charge.total}: check that the Stripe account rounds the tax at invoice level.`
      : undefined;
    if (mismatch) {
      this._logger.error(`Invoice of Stripe invoice ${stripeInvoiceId}: ${mismatch}`);
    }

    const issuedAt = new Date().toISOString();
    const invoice: Invoice = {
      ...draft,
      ...amounts,
      id: uuidv4(),
      status: InvoiceStatus.Open,
      issuedAt,
      issueMonth: issuedAt.slice(0, 7),
      stripeInvoiceId,
      ...(draft.dueDate && { dueMonth: draft.dueDate.slice(0, 7) }),
      documentStatus: mismatch ? InvoiceDocumentStatus.Failed : InvoiceDocumentStatus.ToIssue,
      ...(mismatch && { documentError: mismatch }),
    };

    let created: Invoice;
    try {
      created = await this._invoiceModel.create(invoice);
      this._logger.log(`Invoice ${created.id} recorded for ${draft.billedPartyType} ${draft.billedPartyId}, ${created.amountCents} cents.`);
    } catch (error) {
      this._logger.error(`Error recording the invoice of Stripe invoice ${stripeInvoiceId}`, error);
      throw new DatabaseException("An error occurred while recording the invoice.", error);
    }
    return created;
  }

  /**
   * Issues an invoice that no Stripe charge collects at issue: the one to the finance company of a financed order,
   * open until an operator records its payment, or a period or a proration of seats billed to a reseller, charged on the
   * 4th of the next month. A contract gets one such invoice per party and period, and one per proration, so
   * issuing again returns the one recorded.
   * Rocket creates the electronic invoice of a reseller period at its payment, and meanwhile sends the reseller its
   * pro forma; it does not invoice the finance company, whose invoice only tracks the bank transfer.
   * @param draft the invoice to issue.
   * @returns the recorded invoice.
   * @throws DatabaseException if the write fails.
   */
  async issueManualInvoice(draft: InvoiceDraft): Promise<Invoice> {
    if (draft.contractId) {
      // A proration is billed once; a period of fee once per party.
      const already = (await this.getInvoicesOfContract(draft.contractId)).find(invoice => draft.prorationId
        ? invoice.prorationId === draft.prorationId
        : !invoice.prorationId && invoice.billedPartyId === draft.billedPartyId && invoice.billingPeriodStart === draft.billingPeriodStart);
      if (already) {
        this._logger.log(`Invoice of contract ${draft.contractId} to ${draft.billedPartyId} already recorded as ${already.id}.`);
        return already;
      }
    }

    const issuedAt = new Date().toISOString();
    const invoice: Invoice = {
      ...draft,
      ...invoiceAmounts(draft.items, draft.vatRatePercent),
      id: uuidv4(),
      status: InvoiceStatus.Open,
      issuedAt,
      issueMonth: issuedAt.slice(0, 7),
      ...(draft.dueDate && { dueMonth: draft.dueDate.slice(0, 7) }),
      ...(draft.billedPartyType !== BilledPartyType.Financier && { documentStatus: InvoiceDocumentStatus.ToIssue }),
    };

    let created: Invoice;
    try {
      created = await this._invoiceModel.create(invoice);
      this._logger.log(`Invoice ${created.id} recorded for ${draft.billedPartyType} ${draft.billedPartyId}, ${created.amountCents} cents.`);
      if (created.toChargeMonth) {
        await this._chargeScheduler.ensureMonthlyCharge(created.toChargeMonth);
      }
    } catch (error) {
      this._logger.error(`Error recording the invoice of contract ${draft.contractId}`, error);
      throw new DatabaseException("An error occurred while recording the invoice.", error);
    }

    if (created.billedPartyType === BilledPartyType.Reseller) {
      await this._proFormaService.sendProForma(created);
    }
    return created;
  }

  /**
   * Creates the electronic invoice of an invoice as a draft at Sibill. The invoice is claimed first with a conditional
   * write, so only one caller ever calls Sibill for it; the outcome is then recorded, and never thrown: the caller,
   * often a webhook, carries on. A refusal leaves it FAILED, to create again once fixed; a missing answer leaves it
   * UNCERTAIN, because Sibill may have created it and creating it again would leave two drafts of one invoice.
   * Without Sibill the invoice is left as it is, with no electronic invoice.
   * @param invoice the invoice to issue.
   * @param from the states the claim accepts: TO_ISSUE, or more when an operator issues it again.
   * @returns the invoice as it ends up.
   */
  async issueDocument(invoice: Invoice, from: InvoiceDocumentStatus[] = [InvoiceDocumentStatus.ToIssue]): Promise<Invoice> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      return invoice;
    }

    const key = { billedPartyId: invoice.billedPartyId, id: invoice.id };
    let claimed: Invoice;
    try {
      claimed = await this._invoiceModel.update(
        key,
        toDynamooseUpdate<Invoice>({ documentStatus: InvoiceDocumentStatus.Issuing }, ["documentError"]),
        { condition: new Condition().where("documentStatus").in(from), return: "item" },
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        this._logger.log(`Invoice ${invoice.id} is not waiting to be issued: another caller has it.`);
        return this.getInvoice(key);
      }
      this._logger.error(`Error claiming invoice ${invoice.id} for its issue`, error);
      return invoice;
    }

    let outcome: Partial<Invoice>;
    try {
      const sibillService = await this._loadSibillService();
      const company = await sibillService.getCompany();
      const document = await sibillService.createDraftInvoice(fatturaPaOf(claimed, company, new Date()), claimed.stripeInvoiceId ?? claimed.id);
      outcome = { documentStatus: this._documentStatusOf(document.status), sibillId: document.id, ...(document.number && { number: document.number }) };
    } catch (error) {
      const uncertain = (error as { uncertain?: boolean }).uncertain === true;
      const message = error instanceof Error ? error.message : String(error);
      this._logger.error(`Invoice ${invoice.id} ${uncertain ? "may have been created at Sibill: check Sibill before anything else" : "was not created at Sibill"}: ${message}`, error);
      outcome = { documentStatus: uncertain ? InvoiceDocumentStatus.Uncertain : InvoiceDocumentStatus.Failed, documentError: message };
    }

    try {
      return await this._invoiceModel.update(
        key,
        toDynamooseUpdate<Invoice>(outcome, outcome.documentError ? [] : ["documentError"]),
        { return: "item" },
      );
    } catch (error) {
      // The document may exist at Sibill: the invoice stays ISSUING, which nothing retries, and the log has what to link.
      this._logger.error(`Invoice ${invoice.id} stays ISSUING: its outcome could not be recorded (${JSON.stringify(outcome)}).`, error);
      return claimed;
    }
  }

  /**
   * Creates again, at an operator's request, the electronic invoice of a paid invoice that is not at Sibill. An
   * UNCERTAIN one, or one stuck ISSUING, is created again only when the operator confirms that Sibill has no document
   * for it.
   * @param key the billed party and the identifier of the invoice.
   * @param confirmedNotAtSibill whether the operator checked that Sibill has no document for it.
   * @returns the invoice as it ends up.
   * @throws EntityNotFoundException if the invoice does not exist.
   * @throws BusinessException if the invoice cannot be issued again.
   */
  async reissueDocument(key: InvoiceKey, confirmedNotAtSibill: boolean): Promise<Invoice> {
    const invoice = await this.getInvoice(key);
    if (invoice.status !== InvoiceStatus.Paid) {
      throw new BusinessException(`Invoice ${key.id} is ${invoice.status}: its electronic invoice is created once it is paid.`, "INVOICE_NOT_PAID");
    }

    const from = [InvoiceDocumentStatus.Failed, ...(confirmedNotAtSibill ? [InvoiceDocumentStatus.Uncertain, InvoiceDocumentStatus.Issuing] : [])];
    if (!invoice.documentStatus || !from.includes(invoice.documentStatus)) {
      throw new BusinessException(
        `The electronic invoice of invoice ${key.id} is ${invoice.documentStatus ?? "not issued by Rocket"}: it cannot be created again` +
        (invoice.documentStatus === InvoiceDocumentStatus.Uncertain ? " until Sibill is checked." : "."),
        "INVOICE_DOCUMENT_NOT_REISSUABLE",
      );
    }

    return this.issueDocument(invoice, from);
  }

  /**
   * Records the state of an electronic invoice, as the Sibill webhook reports it, with its number once Sibill assigns
   * it. Sibill may deliver events twice or out of order, so a state older than the one recorded is discarded. A total
   * that differs from the charged one means the draft was changed at Sibill, and is logged as an error; so are a
   * discarded or refused invoice, which are fixed and sent again from Sibill.
   * @param sibillId the identifier of the document at Sibill.
   * @param status the state of the document.
   * @param updatedAt when Sibill changed the document (ISO 8601).
   * @param number the number of the document, when it has one.
   * @param grossAmount the total of the document, VAT included, as a decimal string.
   * @throws DatabaseException if the invoice cannot be read or written.
   */
  async recordDocumentStatus(sibillId: string, status: string, updatedAt: string, number?: string, grossAmount?: string): Promise<void> {
    const documentStatus = status as InvoiceDocumentStatus;
    if (!SIBILL_DOCUMENT_STATUSES.includes(documentStatus)) {
      this._logger.log(`State ${status} of Sibill document ${sibillId} is not one Rocket follows: ignored.`);
      return;
    }

    let invoices: Invoice[];
    try {
      invoices = await this._invoiceModel.query("sibillId").eq(sibillId).using("sibillIndex").exec();
    } catch (error) {
      this._logger.error(`Error reading the invoice of Sibill document ${sibillId}`, error);
      throw new DatabaseException("An error occurred while reading the invoice of the document.", error);
    }

    const invoice = invoices[0];
    if (!invoice) {
      this._logger.log(`Sibill document ${sibillId} belongs to no invoice of Rocket: ignored.`);
      return;
    }

    let recorded: Invoice;
    try {
      recorded = await this._invoiceModel.update(
        { billedPartyId: invoice.billedPartyId, id: invoice.id },
        { documentStatus, documentUpdatedAt: updatedAt, ...(number && { number }) },
        { condition: new Condition().where("documentUpdatedAt").not().exists().or().where("documentUpdatedAt").lt(updatedAt), return: "item" },
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        this._logger.log(`State ${status} of Sibill document ${sibillId} is older than the recorded one: discarded.`);
        return;
      }
      this._logger.error(`Error recording the state of Sibill document ${sibillId}`, error);
      throw new DatabaseException("An error occurred while recording the state of the document.", error);
    }

    const name = recorded.number ?? recorded.id;
    if (grossAmount !== undefined && Math.round(Number(grossAmount) * 100) !== recorded.amountCents) {
      this._logger.error(`Invoice ${name} totals ${grossAmount} at Sibill, but Rocket charged ${formatEuro(recorded.amountCents)}: the draft was changed at Sibill.`);
    }

    if (documentStatus === InvoiceDocumentStatus.Discarded || documentStatus === InvoiceDocumentStatus.Refused) {
      this._logger.error(`Invoice ${name} is ${status}: fix it and send it again from Sibill.`);
    } else {
      this._logger.log(`Invoice ${name} is ${status} at Sibill.`);
    }
  }

  /**
   * Links the document an operator found at Sibill to an invoice whose creation was uncertain.
   * @param key the billed party and the identifier of the invoice.
   * @param sibillId the identifier of the document at Sibill.
   * @returns the linked invoice.
   * @throws EntityNotFoundException if the invoice does not exist.
   * @throws BusinessException if the invoice is not uncertain, or the document cannot be read.
   */
  async linkDocument(key: InvoiceKey, sibillId: string): Promise<Invoice> {
    const invoice = await this.getInvoice(key);
    const linkable = [InvoiceDocumentStatus.Uncertain, InvoiceDocumentStatus.Issuing];
    if (!invoice.documentStatus || !linkable.includes(invoice.documentStatus)) {
      throw new BusinessException(`The electronic invoice of invoice ${key.id} is ${invoice.documentStatus ?? "not issued by Rocket"}: there is nothing to link.`, "INVOICE_DOCUMENT_NOT_LINKABLE");
    }

    const sibillService = await this._loadSibillService();
    const document = await sibillService.getDocument(sibillId);

    try {
      return await this._invoiceModel.update(
        key,
        toDynamooseUpdate<Invoice>(
          { documentStatus: this._documentStatusOf(document.status), sibillId: document.id, ...(document.number && { number: document.number }) },
          ["documentError"],
        ),
        { condition: new Condition().where("documentStatus").in(linkable), return: "item" },
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new BusinessException(`Invoice ${key.id} changed meanwhile: read it again.`, "INVOICE_DOCUMENT_NOT_LINKABLE");
      }
      throw new DatabaseException("An error occurred while linking the document of the invoice.", error);
    }
  }

  /**
   * Reads the state of a document Sibill returned as the state of the electronic invoice.
   * @param status the state at Sibill.
   * @returns the state, DRAFT for one Rocket does not follow: the document exists, so the work of Rocket is done.
   */
  private _documentStatusOf(status: string): InvoiceDocumentStatus {
    if (SIBILL_DOCUMENT_STATUSES.includes(status as InvoiceDocumentStatus)) {
      return status as InvoiceDocumentStatus;
    }

    this._logger.warn(`Sibill returned a document in state ${status}, which Rocket does not follow: recorded as a draft.`);
    return InvoiceDocumentStatus.Draft;
  }

  /**
   * Records by hand the payment of an invoice that no Stripe charge collects, and creates its electronic invoice when
   * it has one.
   * @param key the billed party and the identifier of the invoice.
   * @returns the paid invoice.
   * @throws EntityNotFoundException if the invoice does not exist.
   * @throws BusinessException if the invoice is collected by Stripe or is not open.
   */
  async markPaid(key: InvoiceKey): Promise<Invoice> {
    const invoice = await this.getInvoice(key);
    if (invoice.stripeInvoiceId) {
      throw new BusinessException(`Invoice ${key.id} is collected by Stripe: its payment arrives by itself.`, "INVOICE_COLLECTED_BY_STRIPE");
    }

    let paid: Invoice;
    try {
      paid = await this._invoiceModel.update(
        key,
        this._paidUpdate(),
        { condition: new Condition().where("status").in([InvoiceStatus.Open, InvoiceStatus.Unpaid]), return: "item" },
      );
      this._logger.log(`Invoice ${key.id} marked paid by hand.`);
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new BusinessException(`Invoice ${key.id} is ${invoice.status}: only an open invoice can be marked paid.`, "INVOICE_NOT_OPEN");
      }
      this._logger.error(`Error marking invoice ${key.id} paid`, error);
      throw new DatabaseException("An error occurred while marking the invoice paid.", error);
    }

    return paid.documentStatus === InvoiceDocumentStatus.ToIssue ? this.issueDocument(paid) : paid;
  }

  /**
   * Reads the invoices still to charge in a month.
   * @param month the month of the charge (format: "YYYY-MM").
   * @returns the invoices, by billed party.
   * @throws DatabaseException if the query fails.
   */
  async getInvoicesToCharge(month: string): Promise<Invoice[]> {
    try {
      return await this._invoiceModel.query("toChargeMonth").eq(month).using("toChargeIndex").all().exec();
    } catch (error) {
      this._logger.error(`Error reading the invoices to charge in ${month}`, error);
      throw new DatabaseException("An error occurred while reading the invoices to charge.", error);
    }
  }

  /**
   * Links invoices to the Stripe invoice that charges them: they leave the charges to come, and the webhooks of that
   * Stripe invoice mark them paid or unpaid together.
   * @param invoices the invoices charged.
   * @param stripeInvoiceId the Stripe invoice that charges them.
   */
  async linkCharge(invoices: Invoice[], stripeInvoiceId: string): Promise<void> {
    for (const invoice of invoices) {
      await this._invoiceModel.update(
        { billedPartyId: invoice.billedPartyId, id: invoice.id },
        toDynamooseUpdate<Invoice>({ stripeInvoiceId }, ["toChargeMonth"]),
      );
    }
  }

  /**
   * Moves invoices that could not be charged to the charge of another month, and makes sure that charge is scheduled.
   * @param invoices the invoices to move.
   * @param month the month of the next charge (format: "YYYY-MM").
   */
  async postponeCharge(invoices: Invoice[], month: string): Promise<void> {
    for (const invoice of invoices) {
      await this._invoiceModel.update({ billedPartyId: invoice.billedPartyId, id: invoice.id }, { toChargeMonth: month });
    }

    if (invoices.length > 0) {
      await this._chargeScheduler.ensureMonthlyCharge(month);
    }
  }

  /**
   * Reads the invoices a contract gave rise to.
   * @param contractId the contract.
   * @returns the invoices, by issue date.
   * @throws DatabaseException if the query fails.
   */
  async getInvoicesOfContract(contractId: string): Promise<Invoice[]> {
    try {
      return await this._invoiceModel.query("contractId").eq(contractId).using("contractIndex").all().exec();
    } catch (error) {
      this._logger.error(`Error reading the invoices of contract ${contractId}`, error);
      throw new DatabaseException("An error occurred while reading the invoices of the contract.", error);
    }
  }

  /**
   * Reads the invoices of a party issued in a period, void ones included, for the dashboard of a reseller: one query on
   * its partition by `issuedIndex`.
   * @param billedPartyId the billed party.
   * @param from the start of the period (ISO).
   * @param to the end of the period (ISO).
   * @returns the invoices, by issue date.
   * @throws DatabaseException if the query fails.
   */
  async getInvoicesIssuedTo(billedPartyId: string, from: string, to: string): Promise<Invoice[]> {
    try {
      return await this._invoiceModel.query("billedPartyId").eq(billedPartyId).where("issuedAt").between(from, to).using("issuedIndex").all().exec();
    } catch (error) {
      this._logger.error(`Error reading the invoices of ${billedPartyId} issued from ${from} to ${to}`, error);
      throw new DatabaseException("An error occurred while reading the invoices.", error);
    }
  }

  /**
   * Reads the invoices of a party still to pay, open or unpaid, whenever they fall due, for the dashboard of a
   * reseller. The status is a filter on the partition of the party, which holds only its own invoices.
   * @param billedPartyId the billed party.
   * @returns the invoices still to pay.
   * @throws DatabaseException if the query fails.
   */
  async getInvoicesToPayOf(billedPartyId: string): Promise<Invoice[]> {
    try {
      return await this._invoiceModel.query("billedPartyId").eq(billedPartyId).where("status").in([InvoiceStatus.Open, InvoiceStatus.Unpaid]).all().exec();
    } catch (error) {
      this._logger.error(`Error reading the invoices of ${billedPartyId} still to pay`, error);
      throw new DatabaseException("An error occurred while reading the invoices.", error);
    }
  }

  /**
   * Reads the invoices collected in a month, for the revenue figures: an invoice to a reseller is issued in a month
   * and charged on the 4th of the next one, so its revenue belongs to the month of the payment.
   * @param month the month of collection (format: "YYYY-MM").
   * @returns the invoices, by collection date.
   * @throws DatabaseException if the query fails.
   */
  async getInvoicesPaidInMonth(month: string): Promise<Invoice[]> {
    try {
      return await this._invoiceModel.query("paidMonth").eq(month).using("paidMonthIndex").all().exec();
    } catch (error) {
      this._logger.error(`Error reading the invoices paid in ${month}`, error);
      throw new DatabaseException("An error occurred while reading the invoices of the month.", error);
    }
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
   * Lazy loads the ContractsService from its module.
   * @returns a Promise resolving to the ContractsService instance.
   */
  private async _loadContractsService(): Promise<ContractsService> {
    if (!this._contractsService) {
      const { ContractsLazyModule } = await import("../../../contracts/lazy-contracts/contracts-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ContractsLazyModule);
      const { ContractsService } = await import("../../../contracts/lazy-contracts/services/contracts.service");
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
      const { ContractNoticesService } = await import("../../../contracts/lazy-contracts/services/contract-notices.service");
      this._contractNoticesService = moduleRef.get<ContractNoticesService>(ContractNoticesService);
    }
    return this._contractNoticesService;
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
   * Lists one page of the invoices issued in a period, for the invoices page: one partition of `monthIndex` per month
   * of the period, read on the range of `issuedAt` and merged. An invoice is listed once paid or once its due date is
   * reached: before, it is a payment to collect, in the schedule only.
   * @param query the period, the page and its filters.
   * @returns the page of invoices, newest first.
   * @throws ValidationException if the period or the cursor is not valid.
   * @throws DatabaseException if the query fails.
   */
  async listInvoicesOfPeriod(query: PeriodInvoicesPageQueryDto): Promise<ResponseInvoicesPageDto> {
    const { from, to } = query;
    const endOfToday = `${todayInItaly().slice(0, 10)}T23:59:59.999Z`;
    const isInvoiceYet = (invoice: Invoice): boolean => invoice.status === InvoiceStatus.Paid || (!!invoice.dueDate && invoice.dueDate <= endOfToday);

    return this._listPage(
      accept => paginateMerged(
        this._monthsOf(from, to).map(month => ({
          id: month,
          build: () => this._invoiceModel.query("issueMonth").eq(month).where("issuedAt").between(from, to).using("monthIndex").sort(SortOrder.descending),
        })),
        ["billedPartyId", "id", "issueMonth", "issuedAt"],
        (a, b) => b.issuedAt.localeCompare(a.issuedAt),
        query.limit,
        query.cursor,
        invoice => isInvoiceYet(invoice) && accept(invoice),
      ),
      query,
      `the invoices issued from ${from} to ${to}`,
    );
  }

  /**
   * Lists one page of the schedule of Keus in a period: the payments recorded, to collect, failed or collected, read
   * from `scheduleIndex` one partition per month, and the payments expected from the contracts in force
   * (`ContractsService.getExpectedCharges`) and from the fees of the resellers (`ResellerContractsService.getExpectedFees`).
   * An expected payment that an invoice already records is dropped (`dropRecorded`). The period is read whole and
   * ordered by due date in memory.
   * @param query the period, the page and its filters.
   * @returns the page of the schedule, by due date.
   * @throws ValidationException if the period or the cursor is not valid.
   * @throws DatabaseException if a read fails.
   */
  async listScheduleOfPeriod(query: KeusSchedulePageQueryDto): Promise<ResponseSchedulePageDto> {
    const { from, to, status, documentStatus, channel, productId, search } = query;
    const months = this._monthsOf(from, to);
    // An expected payment has no electronic invoice, so any document status leaves it out.
    const withExpected = (!status?.length || status.includes(ScheduleStatus.Expected)) && !documentStatus?.length;

    let invoices: Invoice[];
    let expected: ExpectedCharge[];
    try {
      [invoices, expected] = await Promise.all([
        Promise.all(months.map(month => this._invoiceModel
          .query("dueMonth").eq(month).where("dueDate").between(from, to).using("scheduleIndex")
          .all().exec())).then(pages => pages.flat()),
        withExpected ? this._readExpected(from, to, productId) : Promise.resolve<ExpectedCharge[]>([]),
      ]);
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }

      this._logger.error(`Error reading the payment schedule from ${from} to ${to}`, error);
      throw new DatabaseException("An error occurred while reading the payment schedule.", error);
    }

    const statuses = status as string[] | undefined;
    const entries = [
      ...invoices
        .filter(invoice => this._matchesInvoice(invoice, { ...query, status: statuses }))
        .map(invoice => ({ key: `invoice#${invoice.id}`, direction: ScheduleDirection.ToKeus, dueDate: invoice.dueDate ?? invoice.issuedAt, invoice })),
      ...dropRecorded(expected, invoices)
        .filter(charge => (!channel || charge.channel === channel)
          && (!productId || charge.productId === productId)
          && startsWithAny(search, charge.billedPartyName, charge.companyName, charge.contractCode))
        .map(({ prorationId: _prorationId, ...charge }) => ({
          key: `expected#${charge.contractId ?? charge.resellerContractId}#${charge.periodStart}`,
          direction: ScheduleDirection.ToKeus,
          dueDate: charge.dueDate,
          expected: charge,
        })),
    ];

    const page = pageByDueDate(entries, query.limit, query.cursor);
    return {
      items: page.items.map(entry => plainToInstance(ResponseScheduleEntryDto, entry)),
      ...(page.nextCursor && { nextCursor: page.nextCursor }),
    };
  }

  /**
   * Reads the payments expected in a period, counted again only after `EXPECTED_CACHE_MS`: the pages of a schedule
   * reuse them, while the invoices that drop the ones already recorded are always read live. A failed count is not
   * kept, so the next request tries again.
   * @param from the start of the period (ISO string).
   * @param to the end of the period (ISO string).
   * @param productId the only product to count, every product when absent.
   * @returns the expected payments, unsorted.
   */
  private _readExpected(from: string, to: string, productId: string | undefined): Promise<ExpectedCharge[]> {
    const now = Date.now();
    for (const [key, entry] of this._expectedCache) {
      if (now - entry.countedAt >= EXPECTED_CACHE_MS) {
        this._expectedCache.delete(key);
      }
    }

    const key = `${from}|${to}|${productId ?? ""}`;
    const cached = this._expectedCache.get(key);
    if (cached) {
      return cached.charges;
    }

    const charges = this._countExpected(from, to, productId);
    this._expectedCache.set(key, { countedAt: now, charges });
    charges.catch(() => this._expectedCache.delete(key));
    return charges;
  }

  /**
   * Counts the payments expected in a period from the contracts of the products and from the fees of the resellers.
   * A product filter counts only that product and leaves the fees out, which have none.
   * @param from the start of the period (ISO string).
   * @param to the end of the period (ISO string).
   * @param productId the only product to count, every product when absent.
   * @returns the expected payments, unsorted.
   */
  private async _countExpected(from: string, to: string, productId: string | undefined): Promise<ExpectedCharge[]> {
    const contractsService = await this._loadContractsService();
    if (productId) {
      return contractsService.getExpectedCharges(from, to, productId);
    }

    const resellerContractsService = await this._loadResellerContractsService();
    const [charges, fees] = await Promise.all([contractsService.getExpectedCharges(from, to), resellerContractsService.getExpectedFees(from, to)]);
    return [...charges, ...fees];
  }

  /**
   * Reads the invoices of a reseller that fall due in a period, for its schedule and its invoices: one partition of
   * `scheduleIndex` per month of the period, kept to the reseller. A void invoice leaves the index, so it never shows.
   * @param resellerId the reseller.
   * @param from the start of the period (ISO).
   * @param to the end of the period (ISO).
   * @param statuses the statuses to read, by default the ones still to pay.
   * @returns the invoices in those statuses.
   * @throws ValidationException if the period is not valid.
   * @throws DatabaseException if the query fails.
   */
  async getResellerDues(
    resellerId: string,
    from: string,
    to: string,
    statuses: InvoiceStatus[] = [InvoiceStatus.Open, InvoiceStatus.Unpaid],
  ): Promise<Invoice[]> {
    const months = this._monthsOf(from, to);

    try {
      const pages = await Promise.all(months.map(month => this._invoiceModel
        .query("dueMonth").eq(month).where("dueDate").between(from, to).using("scheduleIndex")
        .where("billedPartyId").eq(resellerId)
        .where("status").in(statuses)
        .all().exec()));
      return pages.flat();
    } catch (error) {
      this._logger.error(`Error reading the dues of reseller ${resellerId} from ${from} to ${to}`, error);
      throw new DatabaseException("An error occurred while reading the invoices.", error);
    }
  }

  /**
   * Lists the months of a period, the partitions of the indexes by month that hold it.
   * @param from the start of the period (ISO).
   * @param to the end of the period (ISO).
   * @returns the months (YYYY-MM), in order.
   * @throws ValidationException if the period ends before it starts or spans more than `MAX_PERIOD_MONTHS`.
   */
  private _monthsOf(from: string, to: string): string[] {
    if (to < from) {
      throw new ValidationException("The period ends before it starts.", [{ field: "to" }]);
    }

    const months: string[] = [];
    const date = new Date(`${from.slice(0, 7)}-01T00:00:00.000Z`);
    while (date.toISOString().slice(0, 7) <= to.slice(0, 7)) {
      months.push(date.toISOString().slice(0, 7));
      if (months.length > MAX_PERIOD_MONTHS) {
        throw new ValidationException(`The period spans more than ${MAX_PERIOD_MONTHS} months.`, [{ field: "to" }]);
      }
      date.setUTCMonth(date.getUTCMonth() + 1);
    }

    return months;
  }

  /**
   * Reads one page of an invoice listing, filtered by status, document status, channel, product and search.
   * @param read reads the page of the listing, keeping the invoices the filters accept.
   * @param query the page and its filters.
   * @param what what is being listed, for the log.
   * @returns the page of invoices.
   * @throws ValidationException if the cursor is not valid.
   * @throws DatabaseException if the query fails.
   */
  private async _listPage(
    read: (accept: (invoice: Invoice) => boolean) => Promise<Page<Invoice>>,
    query: InvoicesPageQueryDto,
    what: string,
  ): Promise<ResponseInvoicesPageDto> {
    try {
      const page = await read(invoice => this._matchesInvoice(invoice, query));
      return { items: page.items.map(invoice => plainToInstance(ResponseInvoiceDto, invoice)), nextCursor: page.nextCursor };
    } catch (error) {
      if (error instanceof ValidationException) {
        throw error;
      }
      this._logger.error(`Error reading ${what}`, error);
      throw new DatabaseException("An error occurred while reading the invoices.", error);
    }
  }

  /**
   * Tells whether an invoice passes the filters of a listing: status, document status, channel, product and search.
   * @param invoice the invoice.
   * @param filters the filters; an absent or empty one lets every invoice through.
   * @returns true when the invoice is listed.
   */
  private _matchesInvoice(invoice: Invoice, filters: InvoiceFiltersPageQueryDto & { status?: string[] }): boolean {
    const { status, documentStatus, channel, productId, search } = filters;
    return (!status?.length || status.includes(invoice.status))
      && (!documentStatus?.length || (invoice.documentStatus !== undefined && documentStatus.includes(invoice.documentStatus)))
      && (!channel || invoice.channel === channel)
      && (!productId || invoice.items.some(item => item.productId === productId))
      && startsWithAny(search, invoice.number, invoice.billedParty.name, invoice.billedParty.vatNumber);
  }

  /**
   * Reads an invoice.
   * @param key the billed party and the identifier of the invoice.
   * @returns the invoice.
   * @throws EntityNotFoundException if the invoice does not exist.
   */
  async getInvoice(key: InvoiceKey): Promise<Invoice> {
    const invoice = await this._invoiceModel.get(key);
    if (!invoice) {
      throw new EntityNotFoundException("Invoice", key.id);
    }

    return invoice;
  }

  /**
   * Reads the invoices charged by a Stripe invoice: one, or several when a single charge collects them.
   * @param stripeInvoiceId the identifier of the Stripe invoice.
   * @returns the invoices, possibly none.
   * @throws DatabaseException if the query fails.
   */
  async getInvoicesOfCharge(stripeInvoiceId: string): Promise<Invoice[]> {
    try {
      return await this._invoiceModel.query("stripeInvoiceId").eq(stripeInvoiceId).using("stripeInvoiceIndex").all().exec();
    } catch (error) {
      this._logger.error(`Error reading the invoices of Stripe invoice ${stripeInvoiceId}`, error);
      throw new DatabaseException("An error occurred while reading the invoices of the charge.", error);
    }
  }

  /**
   * Records the collection of a charge: its invoices are paid and leave the unpaid set, then their
   * electronic invoices are created at Sibill. Every paid invoice of the charge still TO_ISSUE is created, not only
   * the ones paid now, so a repeated webhook resumes a creation left halfway.
   * @param stripeInvoiceId the identifier of the Stripe invoice collected.
   * @returns the invoices paid.
   */
  async markChargePaid(stripeInvoiceId: string): Promise<Invoice[]> {
    const paid = await this._moveInvoicesOfCharge(
      stripeInvoiceId,
      [InvoiceStatus.Open, InvoiceStatus.Unpaid],
      InvoiceStatus.Paid,
      () => this._paidUpdate(),
    );
    await this._stopDunning(paid);

    const toCreate = (await this.getInvoicesOfCharge(stripeInvoiceId))
      .filter(invoice => invoice.status === InvoiceStatus.Paid && invoice.documentStatus === InvoiceDocumentStatus.ToIssue);
    for (const invoice of toCreate) {
      await this.issueDocument(invoice);
    }

    return paid;
  }

  /**
   * Builds the write that records the payment of an invoice: it leaves the unpaid set and stays in the schedule as
   * collected.
   * @returns the update.
   */
  private _paidUpdate(): Partial<Invoice> {
    const paidAt = new Date().toISOString();

    return toDynamooseUpdate<Invoice>({ status: InvoiceStatus.Paid, paidAt, paidMonth: paidAt.slice(0, 7) }, ["unpaidChannel"]);
  }

  /**
   * Records a failed attempt of a charge: its invoices become unpaid, enter the unpaid set of their channel and count
   * the attempt. An attempt already recorded, as on a repeated webhook, moves nothing.
   * @param stripeInvoiceId the identifier of the Stripe invoice whose charge failed.
   * @param attempt the attempts Stripe has made on the charge so far.
   * @returns the invoices that recorded the attempt.
   */
  async markChargeUnpaid(stripeInvoiceId: string, attempt: number): Promise<Invoice[]> {
    const failedAt = new Date().toISOString();
    const unpaid = await this._moveInvoicesOfCharge(
      stripeInvoiceId,
      [InvoiceStatus.Open, InvoiceStatus.Unpaid],
      InvoiceStatus.Unpaid,
      invoice => ({ status: InvoiceStatus.Unpaid, unpaidChannel: invoice.channel, failedAttempts: attempt, lastFailedAt: failedAt }),
      new Condition().where("failedAttempts").not().exists().or().where("failedAttempts").lt(attempt),
    );

    // Every failure schedules the first step again, at the same time: only an invoice whose dunning started skips it.
    for (const invoice of unpaid.filter(invoice => !invoice.dunningStep)) {
      await this._chargeScheduler.scheduleDunning(invoice, DunningStep.FirstReminder, this._dunningDate(invoice, DunningStep.FirstReminder));
    }

    return unpaid;
  }

  /**
   * Reopens a charge the customer disputed with its bank: its paid invoices become unpaid again, enter the unpaid set
   * of their channel and start the dunning from the first step, counted from the dispute, as after a failed charge.
   * Their electronic invoices stay, since the amount is still owed. A charge already reopened, as on a repeated
   * webhook, moves nothing, but its disputed invoices whose dunning has not started yet are scheduled again: a schedule
   * that failed before is recovered, and one in place is only rewritten. A failed schedule is logged and the others go
   * on, so the dispute is still notified. A dispute closed in favour of Keus pays the charge again with `markChargePaid`.
   * @param stripeInvoiceId the identifier of the Stripe invoice whose debit was disputed.
   * @returns the invoices reopened now.
   */
  async reopenCharge(stripeInvoiceId: string): Promise<Invoice[]> {
    const disputedAt = new Date().toISOString();
    const reopened = await this._moveInvoicesOfCharge(
      stripeInvoiceId,
      [InvoiceStatus.Paid],
      InvoiceStatus.Unpaid,
      invoice => toDynamooseUpdate<Invoice>(
        { status: InvoiceStatus.Unpaid, unpaidChannel: invoice.channel, lastFailedAt: disputedAt, disputedAt },
        ["paidAt", "paidMonth", "dunningStep"],
      ),
    );

    const waiting = (await this.getInvoicesOfCharge(stripeInvoiceId))
      .filter(invoice => invoice.status === InvoiceStatus.Unpaid && invoice.disputedAt && !invoice.dunningStep);
    for (const invoice of waiting) {
      try {
        await this._chargeScheduler.scheduleDunning(invoice, DunningStep.FirstReminder, this._dunningDate(invoice, DunningStep.FirstReminder));
      } catch (error) {
        this._logger.error(`Error scheduling the dunning of disputed invoice ${invoice.id}: it stays unpaid without reminders until scheduled again.`, error);
      }
    }

    return reopened;
  }

  /**
   * Records the cancellation of a charge: its invoices are void and leave the schedule and the unpaid set.
   * @param stripeInvoiceId the identifier of the Stripe invoice voided.
   * @returns the invoices voided.
   */
  async voidCharge(stripeInvoiceId: string): Promise<Invoice[]> {
    const voided = await this._moveInvoicesOfCharge(
      stripeInvoiceId,
      [InvoiceStatus.Open, InvoiceStatus.Unpaid],
      InvoiceStatus.Void,
      () => toDynamooseUpdate<Invoice>({ status: InvoiceStatus.Void }, ["dueMonth", "unpaidChannel"]),
    );
    await this._stopDunning(voided);

    return voided;
  }

  /**
   * Runs a step of the dunning of an unpaid invoice (UR-RK-156, UR-RK-157), from its schedule, and schedules the next.
   * An invoice collected meanwhile, or a step already done, stops here. On the direct channel the reminders and the
   * notice go to the company and to the administration, and the last step suspends the access of the contract unless
   * the administration postponed it; an invoice of Keus to a reseller runs the same steps, and the last one blocks the
   * users of the reseller in Rocket.
   * @param key the billed party and the identifier of the invoice.
   * @param step the step to run.
   * @throws EntityNotFoundException if the invoice does not exist.
   */
  async runDunningStep(key: InvoiceKey, step: DunningStep): Promise<void> {
    const invoice = await this.getInvoice(key);
    const steps = Object.values(DunningStep);
    const done = invoice.dunningStep ? steps.indexOf(invoice.dunningStep) : -1;
    if (invoice.status !== InvoiceStatus.Unpaid || steps.indexOf(step) <= done) {
      this._logger.log(`Invoice ${key.id} is ${invoice.status} at dunning step ${invoice.dunningStep ?? "none"}: ${step} skipped.`);
      return;
    }

    if (!(await this._noticeDunningStep(invoice, step))) {
      return;
    }

    try {
      await this._invoiceModel.update(key, { dunningStep: step }, { condition: new Condition().where("status").eq(InvoiceStatus.Unpaid), return: "item" });
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        this._logger.log(`Invoice ${key.id} was collected during ${step}: the dunning ends.`);
        return;
      }
      this._logger.error(`Error recording ${step} on invoice ${key.id}`, error);
      throw new DatabaseException("An error occurred while recording the dunning of the invoice.", error);
    }

    const next = steps[steps.indexOf(step) + 1];
    if (next) {
      await this._chargeScheduler.scheduleDunning(key, next, this._dunningDate(invoice, next));
    }
  }

  /**
   * Stops the dunning of the unpaid invoices of a contract: the administration gave the access back before the money
   * arrived, so the same invoices must not suspend it again.
   * @param contractId the contract.
   */
  async stopDunningOfContract(contractId: string): Promise<void> {
    const invoices = await this.getInvoicesOfContract(contractId);
    await this._stopDunning(invoices.filter(invoice => invoice.status === InvoiceStatus.Unpaid));
  }

  /**
   * Stops the dunning of the unpaid invoices of a billed party: the administration gave a reseller its access back
   * before the money arrived, so the same invoices must not block it again. Each is marked at the last step, so a
   * later failed attempt of its charge does not start its dunning over.
   * @param billedPartyId the billed party.
   * @throws DatabaseException if a mark fails for a reason other than the invoice being collected meanwhile.
   */
  async stopDunningOfBilledParty(billedPartyId: string): Promise<void> {
    const unpaid = (await this.getInvoicesToPayOf(billedPartyId)).filter(invoice => invoice.status === InvoiceStatus.Unpaid);
    await this._stopDunning(unpaid);

    for (const invoice of unpaid) {
      try {
        await this._invoiceModel.update(
          { billedPartyId: invoice.billedPartyId, id: invoice.id },
          { dunningStep: DunningStep.Suspension },
          { condition: new Condition().where("status").eq(InvoiceStatus.Unpaid), return: "item" },
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          continue;
        }
        this._logger.error(`Error closing the dunning of invoice ${invoice.id}`, error);
        throw new DatabaseException("An error occurred while closing the dunning of the invoice.", error);
      }
    }
    this._logger.log(`Dunning of ${unpaid.length} unpaid invoices of ${billedPartyId} closed by hand.`);
  }

  /**
   * Sends the notices of a step of the dunning, or suspends the access at the last one.
   * @param invoice the unpaid invoice.
   * @param step the step to run.
   * @returns whether the step is done; false when the suspension waits for the date the administration chose.
   */
  private async _noticeDunningStep(invoice: Invoice, step: DunningStep): Promise<boolean> {
    const contractNoticesService = await this._loadContractNoticesService();
    const facts = {
      invoiceNumber: invoice.number ?? "",
      amount: formatEuro(invoice.amountCents),
      issuedAt: formatDate(invoice.issuedAt),
    };
    const reminder = step === DunningStep.FirstReminder ? 1 : 2;
    const reminderLabel = reminder === 1 ? "primo" : "secondo";

    if (invoice.billedPartyType === BilledPartyType.Reseller) {
      return this._noticeResellerDunningStep(invoice, step, { contractNoticesService, facts, reminder, reminderLabel });
    }

    if (!invoice.contractId || !invoice.lineProductId) {
      this._logger.warn(`Invoice ${invoice.id} belongs to no contract: ${step} has no one to notify.`);
      return true;
    }

    const contractsService = await this._loadContractsService();
    const contract = await contractsService.getContract(invoice.lineProductId, invoice.contractId, SYSTEM_SCOPE);
    switch (step) {
      case DunningStep.FirstReminder:
      case DunningStep.SecondReminder:
        await contractNoticesService.toCompany(contract, MailTemplate.CompanyPaymentReminder, { ...facts, reminder });
        await contractNoticesService.toAccounting(MailTemplate.PaymentReminderAdmin, {
          ...facts,
          reminderLabel,
          partyName: contract.companyName,
          scheduleUrl: rocketUrl("/billing/schedule"),
        }, contract);
        return true;
      case DunningStep.SuspensionNotice: {
        const suspensionDate = formatDate(this._suspensionDate(invoice, contract.suspensionPostponedUntil));
        await contractNoticesService.toCompany(contract, MailTemplate.CompanySuspensionNotice, { ...facts, suspensionDate });
        await contractNoticesService.toAccounting(MailTemplate.SuspensionNoticeAdmin, { ...facts, suspensionDate }, contract);
        return true;
      }
      case DunningStep.Suspension: {
        const postponed = contract.suspensionPostponedUntil;
        if (postponed && new Date(postponed) > new Date()) {
          await this._chargeScheduler.scheduleDunning(invoice, DunningStep.Suspension, postponed);
          this._logger.log(`Suspension of contract ${contract.code} postponed until ${postponed}.`);
          return false;
        }
        await contractsService.suspendAccess(contract.productId, contract.id, { invoice: { number: invoice.number, amountCents: invoice.amountCents } });
        return true;
      }
    }
  }

  /**
   * Computes the date of a step of the dunning, counted in days from the due date of the invoice: the issue for a
   * charge of the direct channel, the 4th of the month of the charge for the reseller's. A disputed debit counts from
   * the dispute, which comes weeks after the due date.
   * @param invoice the invoice.
   * @param step the step.
   * @returns the date of the step (ISO string).
   */
  private _dunningDate(invoice: Invoice, step: DunningStep): string {
    const date = new Date(invoice.disputedAt ?? invoice.dueDate ?? invoice.issuedAt);
    date.setUTCDate(date.getUTCDate() + DUNNING_DAYS[step]);
    return date.toISOString();
  }

  /**
   * Runs a step of the dunning of an invoice of Keus to a reseller: reminders on the fifth and tenth day, the date of
   * the block on the fourteenth, and the block of its users in Rocket on the fifteenth. Every notice goes to the
   * reseller and to the administration.
   * @param invoice the unpaid invoice.
   * @param step the step to run.
   * @param notice the notices service, the invoice facts already formatted, and the number and label of the reminder.
   * @returns always true: the block of a reseller is never postponed.
   */
  private async _noticeResellerDunningStep(
    invoice: Invoice,
    step: DunningStep,
    notice: { contractNoticesService: ContractNoticesService; facts: Record<string, string>; reminder: number; reminderLabel: string },
  ): Promise<boolean> {
    const { contractNoticesService, facts, reminder, reminderLabel } = notice;
    const partyName = invoice.billedParty.name;
    const resellerUrl = rocketUrl(`/resellers/edit/${invoice.billedPartyId}`);

    switch (step) {
      case DunningStep.FirstReminder:
      case DunningStep.SecondReminder: {
        await contractNoticesService.toInvoicedReseller(invoice.billedPartyId, MailTemplate.PaymentReminder, { ...facts, reminder });
        await contractNoticesService.toAccounting(MailTemplate.PaymentReminderAdmin, {
          ...facts,
          reminderLabel,
          partyName,
          scheduleUrl: rocketUrl("/billing/schedule"),
        });
        return true;
      }
      case DunningStep.SuspensionNotice: {
        const suspensionDate = formatDate(this._suspensionDate(invoice));
        await contractNoticesService.toInvoicedReseller(invoice.billedPartyId, MailTemplate.ResellerSuspensionNotice, { ...facts, suspensionDate });
        await contractNoticesService.toAccounting(MailTemplate.ResellerSuspensionNoticeAdmin, { ...facts, suspensionDate, partyName, resellerUrl });
        return true;
      }
      case DunningStep.Suspension: {
        const resellersService = await this._loadResellersService();
        await resellersService.suspendAccess(invoice.billedPartyId, { number: invoice.number, amountCents: invoice.amountCents, partyName });
        return true;
      }
    }
  }

  /**
   * Computes when the access of a contract will be suspended for an invoice: the fifteenth day, or the date the
   * administration postponed it to.
   * @param invoice the unpaid invoice.
   * @param postponedUntil the postponement of the contract, if any.
   * @returns the date of the suspension.
   */
  private _suspensionDate(invoice: Invoice, postponedUntil?: string): Date {
    const day = new Date(this._dunningDate(invoice, DunningStep.Suspension));
    return postponedUntil && new Date(postponedUntil) > day ? new Date(postponedUntil) : day;
  }

  /**
   * Cancels the dunning schedules of invoices that no longer wait for money, or that the administration forgave.
   * @param invoices the invoices.
   */
  private async _stopDunning(invoices: Invoice[]): Promise<void> {
    for (const invoice of invoices.filter(invoice => invoice.failedAttempts)) {
      await this._chargeScheduler.cancelDunning(invoice.id);
    }
  }

  /**
   * Moves the invoices of a charge to a new state, each with a write conditioned on the state it was read in.
   * An invoice already moved, as on a repeated webhook, is left alone. An invoice of a reseller that enters or leaves
   * the unpaid set is counted on the reseller in the same transaction, and the overdue mark follows (UR-RK-101).
   * @param stripeInvoiceId the identifier of the Stripe invoice.
   * @param from the states the invoices can leave.
   * @param to the state the invoices reach.
   * @param update the update of one invoice.
   * @param when a further condition the invoice must meet, if any.
   * @returns the invoices moved.
   * @throws DatabaseException if a write fails for a reason other than its condition.
   */
  private async _moveInvoicesOfCharge(
    stripeInvoiceId: string,
    from: InvoiceStatus[],
    to: InvoiceStatus,
    update: (invoice: Invoice) => Partial<Invoice>,
    when?: InstanceType<typeof Condition>,
  ): Promise<Invoice[]> {
    const moved: Invoice[] = [];
    for (const invoice of await this.getInvoicesOfCharge(stripeInvoiceId)) {
      if (!from.includes(invoice.status)) {
        this._logger.log(`Invoice ${invoice.id} is ${invoice.status}: left as it is.`);
        continue;
      }

      const key = { billedPartyId: invoice.billedPartyId, id: invoice.id };
      const condition = new Condition().where("status").eq(invoice.status);
      if (when) {
        condition.and().parenthesis(when);
      }
      const delta = Number(to === InvoiceStatus.Unpaid) - Number(invoice.status === InvoiceStatus.Unpaid);

      try {
        if (invoice.billedPartyType === BilledPartyType.Reseller && delta !== 0) {
          const resellersService = await this._loadResellersService();
          await transaction([
            this._invoiceModel.transaction.update(key, update(invoice), { condition }),
            resellersService.unpaidInvoiceWrite(invoice.billedPartyId, delta > 0 ? 1 : -1),
          ]);
          await resellersService.settleOverdue(invoice.billedPartyId, new Date().toISOString());
          moved.push(await this.getInvoice(key));
        } else {
          moved.push(await this._invoiceModel.update(key, update(invoice), { condition, return: "item" }));
        }
      } catch (error) {
        if (isConditionalCheckFailed(error) || isTransactionCanceled(error)) {
          this._logger.log(`Invoice ${invoice.id} changed meanwhile or has this attempt already: left as it is.`);
          continue;
        }
        if (error instanceof AppException) throw error;
        this._logger.error(`Error updating invoice ${invoice.id}`, error);
        throw new DatabaseException("An error occurred while updating the invoice.", error);
      }
    }

    return moved;
  }
}
