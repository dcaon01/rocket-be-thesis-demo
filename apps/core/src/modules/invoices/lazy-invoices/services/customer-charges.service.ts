import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { InjectModel, Model } from "nestjs-dynamoose";
import { v4 as uuidv4 } from "uuid";
import { RequestScope, SYSTEM_SCOPE } from "@rocket-be/scoping";
import { BusinessException, DatabaseException, EntityNotFoundException } from "../../../../errors/exception-types";
import { todayInItaly } from "../../../../commons/dates/calendar-day.helper";
import { pageByDueDate, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { formatDate, formatEuro, rocketUrl } from "../../../../commons/formatting/notice-format.helper";
import { isConditionalCheckFailed } from "../../../../commons/persistence/write-errors.helper";
import { splitRemovals, toDynamooseUpdate } from "../../../../commons/persistence/removable-update.helper";
import type { CompaniesService } from "../../../companies/lazy-companies/services/companies.service";
import type { ContractNoticesService } from "../../../contracts/lazy-contracts/services/contract-notices.service";
import type { ContractsService } from "../../../contracts/lazy-contracts/services/contracts.service";
import { addMonths, subtractDays } from "../../../contracts/helpers/contract-dates.helper";
import { MailTemplate } from "../../../mail/enums/mail-template.enum";
import type { ResponseResellerDto } from "../../../resellers/dtos/response-reseller.dto";
import type { ResellerContractsService } from "../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service";
import type { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import { CollectCustomerChargeDto } from "../../dtos/collect-customer-charge.dto";
import { CreateCustomerChargeDto } from "../../dtos/create-customer-charge.dto";
import { ResponseCustomerChargeDto } from "../../dtos/response-customer-charge.dto";
import { UpdateCustomerChargeDto } from "../../dtos/update-customer-charge.dto";
import { ResellerDuesPageQueryDto, ResellerInvoicesPageQueryDto, ResellerSchedulePageQueryDto } from "../../dtos/reseller-schedule-page-query.dto";
import { ResponseScheduleEntryDto } from "../../dtos/response-schedule-entry.dto";
import { ResponseSchedulePageDto } from "../../dtos/response-schedule-page.dto";
import { CustomerChargeKind } from "../../enums/customer-charge-kind.enum";
import { InvoiceStatus } from "../../enums/invoice-status.enum";
import { ScheduleDirection } from "../../enums/schedule-direction.enum";
import { ChargeRule, isOccurrence, occurrencesBetween } from "../../helpers/charge-occurrences.helper";
import { dropRecorded, EXPECTED_CACHE_MS } from "../../helpers/expected-charges.helper";
import type { ExpectedCharge } from "../../interfaces/expected-charge.interface";
import { CustomerCharge, CustomerChargeKey, CustomerChargeSchema } from "../../schemas/customer-charge.schema";
import { Invoice } from "../../schemas/invoice.schema";
import { InvoicesService } from "./invoices.service";

/** Days after a due date of a customer still open that the reseller is reminded of it again, besides the day itself. */
const DUE_REMINDER_DAYS = [5, 10];

/** What the billing of an indirect contract knows of the share the reseller bills its customer. */
export type ContractChargeInput = Pick<
  CustomerCharge,
  "resellerId" | "companyId" | "companyName" | "description" | "amountCents" | "dueDate" | "periodEnd" | "contractId" | "productId" | "contractCode"
  | "keusCents" | "salesId"
> & {
  /** Invoice of Keus to the reseller for the same period: the identifier of the item. */
  invoiceId: string;
};

/** A due date of the schedule of a reseller, before it is mapped to its response. */
type ScheduleEntry = {
  /** Identifier of the entry: the invoice, or the item and its due date. */
  key: string;
  /** Which way the money goes. */
  direction: ScheduleDirection;
  /** Due date (ISO string). */
  dueDate: string;
  /** Whether the due date of the customer is collected. */
  collected?: boolean;
  /** The invoice of Keus. */
  invoice?: Invoice;
  /** The item of the customer. */
  charge?: CustomerCharge;
  /** The payment expected from an indirect contract or from the fee of the reseller, before it is recorded. */
  expected?: ExpectedCharge;
};

/** A due date of an item of a reseller, a recurring one once per date. */
export type CustomerDue = {
  /** Due date (ISO string). */
  dueDate: string;
  /** The item. */
  charge: CustomerCharge;
};

/** The fields that make the date of an item: its due date, or its rule. */
type ChargeDates = Pick<CustomerCharge, "dueDate" | "ruleStart" | "cadence" | "ruleEnd">;

/**
 * Service for what a reseller bills its customers (decision of Damiano, 15/10/2026). Rocket writes the share of every
 * period or proration of an indirect contract, at the price the customer pays, when it bills the reseller; the
 * reseller adds its own items, once or on a recurring rule, to margin on other services. Rocket issues nothing to the
 * customer: the reseller marks each due date collected.
 *
 * The shares of the contracts are read-only. A recurring item stores only its rule: its due dates are counted when
 * read, and only the ones collected are stored, in a set on the item.
 *
 * The schedule of the reseller reads like the one of Keus: besides what is recorded, the payments expected from its
 * indirect contracts in force and from its fee, both ways, until the invoice of Keus and the share of the customer
 * record them.
 */
@Injectable()
export class CustomerChargesService {
  /** Logger instance for CustomerChargesService. */
  private readonly _logger = new Logger(CustomerChargesService.name);

  /** Lazy-loaded companies service. */
  private _companiesService: CompaniesService | null = null;

  /** Lazy-loaded contract notices service. */
  private _contractNoticesService: ContractNoticesService | null = null;

  /** Lazy-loaded contracts service. */
  private _contractsService: ContractsService | null = null;

  /** Lazy-loaded reseller contracts service. */
  private _resellerContractsService: ResellerContractsService | null = null;

  /** Lazy-loaded resellers service. */
  private _resellersService: ResellersService | null = null;

  /** Expected payments counted per reseller and period, with when they were counted. */
  private readonly _expectedCache = new Map<string, { countedAt: number; charges: Promise<ExpectedCharge[]> }>();

  /**
   * Constructor for CustomerChargesService.
   * @param _chargeModel the Dynamoose model of the items.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the other services on demand.
   * @param _invoicesService the invoices of the same module, for the dues of the reseller to Keus.
   */
  constructor(
    @InjectModel("CustomerCharge") private readonly _chargeModel: Model<CustomerCharge, CustomerChargeKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader,
    private readonly _invoicesService: InvoicesService,
  ) { }

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
   * Lazy loads the CompaniesService from its module.
   * @returns a Promise resolving to the CompaniesService instance.
   */
  private async _loadCompaniesService(): Promise<CompaniesService> {
    if (!this._companiesService) {
      const { CompaniesLazyModule } = await import("../../../companies/lazy-companies/companies-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => CompaniesLazyModule);
      const { CompaniesService } = await import("../../../companies/lazy-companies/services/companies.service");
      this._companiesService = moduleRef.get<CompaniesService>(CompaniesService);
    }
    return this._companiesService;
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
   * Records the share of a period or a proration of an indirect contract that the reseller bills its customer, once
   * per invoice of Keus: writing it again leaves the first one.
   * @param input the share, with the invoice of Keus it comes with.
   * @throws DatabaseException if the write fails.
   */
  async recordContractCharge(input: ContractChargeInput): Promise<void> {
    const { invoiceId, ...charge } = input;

    try {
      const share: CustomerCharge = { ...charge, id: invoiceId, kind: CustomerChargeKind.Contract };
      await this._chargeModel.create(share, { overwrite: false, return: 'item' });
      this._logger.log(`Share of contract ${input.contractCode} recorded for reseller ${input.resellerId}, ${input.amountCents} cents.`);
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        this._logger.log(`Share of invoice ${invoiceId} already recorded for reseller ${input.resellerId}.`);
        return;
      }
      this._logger.error(`Error recording the share of contract ${input.contractCode}`, error);
      throw new DatabaseException("An error occurred while recording the charge of the customer.", error);
    }
  }

  /**
   * Adds an item a reseller bills one of its customers, once or on a recurring rule.
   * @param resellerId the reseller.
   * @param dto the item.
   * @param scope the request scope.
   * @returns the item.
   * @throws AuthorizationException if the reseller is outside the scope of the requester.
   * @throws BusinessException if the dates do not fit the kind, or the company is not a customer of the reseller.
   */
  async createCharge(resellerId: string, dto: CreateCustomerChargeDto, scope: RequestScope): Promise<ResponseCustomerChargeDto> {
    const reseller = await this._getReseller(resellerId, scope);
    const dates = this._normalizedDates(dto);
    this._validateDates(dto.kind, dates);
    const company = await this._getCustomer(reseller, dto.companyId, scope);

    const charge: CustomerCharge = {
      resellerId,
      id: uuidv4(),
      kind: dto.kind,
      companyId: company.id,
      companyName: company.name,
      description: dto.description,
      amountCents: dto.amountCents,
      ...(dto.kind === CustomerChargeKind.OneOff
        ? { dueDate: dates.dueDate }
        : { ruleStart: dates.ruleStart, cadence: dto.cadence, ...(dates.ruleEnd && { ruleEnd: dates.ruleEnd }) }),
    };

    try {
      const created = await this._chargeModel.create(charge);
      this._logger.log(`Item ${created.id} of reseller ${reseller.code} added for company ${company.id}.`);
      return this._toResponse(created);
    } catch (error) {
      this._logger.error(`Error adding an item of reseller ${resellerId}`, error);
      throw new DatabaseException("An error occurred while adding the charge of the customer.", error);
    }
  }

  /**
   * Reads an item of a reseller.
   * @param resellerId the reseller.
   * @param id the item.
   * @param scope the request scope.
   * @returns the item.
   * @throws AuthorizationException if the reseller is outside the scope of the requester.
   * @throws EntityNotFoundException if the item does not exist.
   */
  async getCharge(resellerId: string, id: string, scope: RequestScope): Promise<ResponseCustomerChargeDto> {
    await this._getReseller(resellerId, scope);

    return this._toResponse(await this._getStored({ resellerId, id }));
  }

  /**
   * Changes an item a reseller added by hand; the shares of the contracts are read-only.
   * @param resellerId the reseller.
   * @param id the item.
   * @param dto the fields to change.
   * @param scope the request scope.
   * @returns the item.
   * @throws AuthorizationException if the reseller is outside the scope of the requester.
   * @throws EntityNotFoundException if the item does not exist.
   * @throws BusinessException if the item is the share of a contract, or the dates do not fit its kind.
   */
  async updateCharge(resellerId: string, id: string, dto: UpdateCustomerChargeDto, scope: RequestScope): Promise<ResponseCustomerChargeDto> {
    await this._getReseller(resellerId, scope);
    const current = await this._getManual({ resellerId, id });

    const plainUpdate = this._normalizedDates(JSON.parse(JSON.stringify(dto)) as Partial<CustomerCharge>);
    const { set, remove } = splitRemovals(plainUpdate, CustomerChargeSchema, "customer charge", scope);
    this._validateDates(current.kind, { ...current, ...set, ...(remove.includes("ruleEnd") && { ruleEnd: undefined }) });

    try {
      const updated = await this._chargeModel.update({ resellerId, id }, toDynamooseUpdate(set, remove));
      this._logger.log(`Item ${id} of reseller ${resellerId} updated.`);
      return this._toResponse(updated);
    } catch (error) {
      this._logger.error(`Error updating item ${id} of reseller ${resellerId}`, error);
      throw new DatabaseException("An error occurred while updating the charge of the customer.", error);
    }
  }

  /**
   * Deletes an item a reseller added by hand; the shares of the contracts stay.
   * @param resellerId the reseller.
   * @param id the item.
   * @param scope the request scope.
   * @throws AuthorizationException if the reseller is outside the scope of the requester.
   * @throws EntityNotFoundException if the item does not exist.
   * @throws BusinessException if the item is the share of a contract.
   */
  async deleteCharge(resellerId: string, id: string, scope: RequestScope): Promise<void> {
    await this._getReseller(resellerId, scope);
    await this._getManual({ resellerId, id });

    try {
      await this._chargeModel.delete({ resellerId, id });
      this._logger.log(`Item ${id} of reseller ${resellerId} deleted.`);
    } catch (error) {
      this._logger.error(`Error deleting item ${id} of reseller ${resellerId}`, error);
      throw new DatabaseException("An error occurred while deleting the charge of the customer.", error);
    }
  }

  /**
   * Marks a due date of an item collected, or not collected after a mistake: the date of a single item, or one of the
   * due dates of a recurring item, added to or taken from its set alone.
   * @param resellerId the reseller.
   * @param id the item.
   * @param dto whether it is collected, and the due date of a recurring item.
   * @param scope the request scope.
   * @returns the item.
   * @throws AuthorizationException if the reseller is outside the scope of the requester.
   * @throws EntityNotFoundException if the item does not exist.
   * @throws BusinessException if the date is not a due date of the recurring item.
   */
  async setCollected(resellerId: string, id: string, dto: CollectCustomerChargeDto, scope: RequestScope): Promise<ResponseCustomerChargeDto> {
    await this._getReseller(resellerId, scope);
    const current = await this._getStored({ resellerId, id });

    let update: Partial<CustomerCharge> | Record<string, unknown>;
    if (current.kind === CustomerChargeKind.Recurring) {
      const dueDate = dto.dueDate ? new Date(dto.dueDate).toISOString() : undefined;
      if (!dueDate || !isOccurrence(this._ruleOf(current), dueDate)) {
        throw new BusinessException(`Item ${id} does not fall due on ${dto.dueDate ?? "the date given"}.`, "CUSTOMER_CHARGE_NOT_DUE");
      }
      update = dto.collected ? { $ADD: { collectedDates: [dueDate] } } : { $DELETE: { collectedDates: [dueDate] } };
    } else {
      update = dto.collected ? { collectedAt: new Date().toISOString() } : toDynamooseUpdate<CustomerCharge>({}, ["collectedAt"]);
    }

    try {
      const updated = await this._chargeModel.update({ resellerId, id }, update as Partial<CustomerCharge>);
      this._logger.log(`Item ${id} of reseller ${resellerId} marked ${dto.collected ? "collected" : "not collected"}${dto.dueDate ? ` for ${dto.dueDate}` : ""}.`);
      return this._toResponse(updated);
    } catch (error) {
      this._logger.error(`Error marking item ${id} of reseller ${resellerId}`, error);
      throw new DatabaseException("An error occurred while marking the charge of the customer.", error);
    }
  }

  /**
   * Lists one page of the schedule of a reseller in a period, as the one of Keus: the invoices of Keus, open, unpaid or
   * paid, and the due dates of its customers, the shares of the contracts and its own items, a recurring one once per
   * due date, with the payments expected both ways from its indirect contracts and its fee. The period is read whole and merged by due date, so
   * the cursor holds the due date and the key of the last entry.
   * @param resellerId the reseller.
   * @param query the period, the page and the filters.
   * @param scope the request scope.
   * @returns the page of the schedule, by due date.
   * @throws AuthorizationException if the reseller is outside the scope of the requester.
   * @throws ValidationException if the period or the cursor is not valid.
   */
  async listSchedule(resellerId: string, query: ResellerSchedulePageQueryDto, scope: RequestScope): Promise<ResponseSchedulePageDto> {
    const reseller = await this._getReseller(resellerId, scope);
    const { from, to, direction, settled } = query;

    const entries = await this._entries(resellerId, from, to, direction, {
      statuses: [InvoiceStatus.Open, InvoiceStatus.Unpaid, InvoiceStatus.Paid],
      expectedOf: reseller.code,
    });
    const kept = entries.filter(entry => settled === undefined || this._isSettled(entry) === settled);

    return this._page(kept, query);
  }

  /**
   * Lists one page of the invoices of a reseller in a period, latest due date first: the invoices of Keus once paid or
   * due, and the due dates of its customers already reached and marked collected. Before that an entry is a payment,
   * in the schedule only.
   * @param resellerId the reseller.
   * @param query the period, the page and the filters.
   * @param scope the request scope.
   * @returns the page of the invoices, by due date, latest first.
   * @throws AuthorizationException if the reseller is outside the scope of the requester.
   * @throws ValidationException if the period or the cursor is not valid.
   */
  async listInvoices(resellerId: string, query: ResellerInvoicesPageQueryDto, scope: RequestScope): Promise<ResponseSchedulePageDto> {
    await this._getReseller(resellerId, scope);
    const { from, to, direction, settled } = query;

    const endOfToday = `${todayInItaly().slice(0, 10)}T23:59:59.999Z`;
    const entries = await this._entries(resellerId, from, to, direction, {
      statuses: [InvoiceStatus.Open, InvoiceStatus.Unpaid, InvoiceStatus.Paid],
      customersTo: to < endOfToday ? to : endOfToday,
    });
    // The reseller invoices its customers outside Rocket: a due date still to collect is not an invoice yet.
    const kept = entries
      .filter(entry => entry.invoice ? entry.invoice.status === InvoiceStatus.Paid || entry.dueDate <= endOfToday : entry.collected)
      .filter(entry => settled === undefined || this._isSettled(entry) === settled);

    return this._page(kept, query, true);
  }

  /**
   * Reads every due date of the items of a reseller in a period, for its dashboard: the single items by their due
   * date, a recurring one once per due date. No scope: the caller has already read the reseller with the requester's.
   * @param resellerId the reseller.
   * @param from the start of the period (ISO string).
   * @param to the end of the period (ISO string).
   * @returns the due dates, unsorted.
   * @throws DatabaseException if the query fails.
   */
  async getDuesOfPeriod(resellerId: string, from: string, to: string): Promise<CustomerDue[]> {
    const entries = await this._customerDues(resellerId, from, to);

    return entries.flatMap(entry => entry.charge ? [{ dueDate: entry.dueDate, charge: entry.charge }] : []);
  }

  /**
   * Reminds every reseller of the due dates of its customers still open, once a day from EventBridge Scheduler: the
   * ones of the day and the ones five and ten days late, in a single email. A reseller with nothing to collect gets
   * nothing, and Keus is not told: the money is the reseller's. A reseller that fails is logged and skipped, so the
   * others are reminded all the same and the run is never retried as a whole.
   */
  async sendDueDigests(): Promise<void> {
    const today = todayInItaly();
    const resellersService = await this._loadResellersService();
    const resellers = await resellersService.getAllResellers(SYSTEM_SCOPE);
    const contractNoticesService = await this._loadContractNoticesService();
    let reminded = 0;

    for (const reseller of resellers) {
      try {
        if (await this._sendDueDigest(reseller, today, contractNoticesService)) {
          reminded++;
        }
      } catch (error) {
        this._logger.error(`Error reminding reseller ${reseller.id} of the due dates of its customers`, error);
      }
    }
    this._logger.log(`Due dates of the customers reminded to ${reminded} reseller(s).`);
  }

  /**
   * Reminds one reseller of the due dates of its customers still open: the ones of the day and the ones five and ten
   * days late.
   * @param reseller the reseller.
   * @param today the day of the run, at midnight UTC (ISO string).
   * @param contractNoticesService the notices service that sends the email.
   * @returns whether the reseller had something to collect and was emailed.
   * @throws DatabaseException if the query fails.
   */
  private async _sendDueDigest(reseller: ResponseResellerDto, today: string, contractNoticesService: ContractNoticesService): Promise<boolean> {
    const open = (await this._customerDues(reseller.id, subtractDays(today, Math.max(...DUE_REMINDER_DAYS)), `${today.slice(0, 10)}T23:59:59.999Z`))
      .filter(entry => !entry.collected);
    const dueOn = (daysAgo: number) => open
      .filter(entry => entry.dueDate.slice(0, 10) === subtractDays(today, daysAgo).slice(0, 10))
      .map(entry => this._dueLine(entry));
    const dueToday = dueOn(0);
    const [late, veryLate] = DUE_REMINDER_DAYS.map(days => dueOn(days));
    if (dueToday.length + late.length + veryLate.length === 0) {
      return false;
    }

    await contractNoticesService.toInvoicedReseller(reseller.id, MailTemplate.CustomerDues, {
      resellerName: reseller.companyName,
      dueToday,
      late,
      veryLate,
      scheduleUrl: rocketUrl(`/resellers/workspaces/${reseller.id}/billing/schedule`),
    });
    return true;
  }

  /**
   * Reads the due dates of a reseller in a period, in the directions asked: the invoices of Keus to the reseller and
   * the due dates of its customers, and the expected ones when asked. An expected payment to Keus is dropped once an
   * invoice records it (`dropRecorded`), a paid one included; an expected due date of a customer once the share of
   * its period is recorded.
   * @param resellerId the reseller.
   * @param from the start of the period (ISO string).
   * @param to the end of the period (ISO string).
   * @param direction the direction to read, both when absent.
   * @param options the statuses of the invoices of Keus, the ones still to pay by default, the end of the period of
   * the customers, `to` by default, and the code of the reseller whose expected payments to add.
   * @returns the entries, unsorted.
   * @throws ValidationException if the period is not valid.
   * @throws DatabaseException if a query fails.
   */
  private async _entries(
    resellerId: string,
    from: string,
    to: string,
    direction: ScheduleDirection | undefined,
    options: { statuses?: InvoiceStatus[]; customersTo?: string; expectedOf?: string } = {},
  ): Promise<ScheduleEntry[]> {
    const customersTo = options.customersTo ?? to;
    const statuses = options.statuses ?? [InvoiceStatus.Open, InvoiceStatus.Unpaid];
    const toKeus = direction !== ScheduleDirection.FromCustomer;
    // A period of the customers that ends before it starts has nothing to read.
    const fromCustomers = direction !== ScheduleDirection.ToKeus && customersTo >= from;
    const invoiceStatuses = options.expectedOf ? [...new Set([...statuses, InvoiceStatus.Paid])] : statuses;
    const noInvoices: Invoice[] = [];
    const noEntries: ScheduleEntry[] = [];
    const noExpected: ExpectedCharge[] = [];

    const [invoices, customerDues, expected] = await Promise.all([
      toKeus ? this._invoicesService.getResellerDues(resellerId, from, to, invoiceStatuses) : noInvoices,
      fromCustomers ? this._customerDues(resellerId, from, customersTo) : noEntries,
      options.expectedOf ? this._readExpected(resellerId, options.expectedOf, from, to) : noExpected,
    ]);

    const keusDues: ScheduleEntry[] = invoices
      .filter(invoice => statuses.includes(invoice.status))
      .map(invoice => ({ key: `invoice#${invoice.id}`, direction: ScheduleDirection.ToKeus, dueDate: invoice.dueDate ?? invoice.issuedAt, invoice }));
    const expectedToKeus: ScheduleEntry[] = toKeus
      ? dropRecorded(expected.filter(charge => charge.dueDate >= from && charge.dueDate <= to), invoices)
        .map(({ prorationId: _prorationId, ...charge }) => ({
          key: `expected#${charge.contractId ?? charge.resellerContractId}#${charge.periodStart}`,
          direction: ScheduleDirection.ToKeus,
          dueDate: charge.dueDate,
          expected: charge,
        }))
      : noEntries;
    const expectedFromCustomers = fromCustomers ? this._expectedFromCustomers(expected, customerDues, from, customersTo) : noEntries;
    return [...keusDues, ...customerDues, ...expectedToKeus, ...expectedFromCustomers];
  }

  /**
   * Reads the payments expected of a reseller in a period, counted again only after `EXPECTED_CACHE_MS`, as the
   * schedule of Keus does: the pages of a schedule reuse them, while the recorded entries that drop them are always
   * read live. A failed count is not kept, so the next request tries again.
   * @param resellerId the reseller.
   * @param resellerCode the code of the reseller.
   * @param from the start of the period (ISO string).
   * @param to the end of the period (ISO string).
   * @returns the expected payments, unsorted, the ones already recorded included.
   */
  private _readExpected(resellerId: string, resellerCode: string, from: string, to: string): Promise<ExpectedCharge[]> {
    const now = Date.now();
    for (const [key, entry] of this._expectedCache) {
      if (now - entry.countedAt >= EXPECTED_CACHE_MS) {
        this._expectedCache.delete(key);
      }
    }

    const key = `${resellerId}|${from}|${to}`;
    const cached = this._expectedCache.get(key);
    if (cached) {
      return cached.charges;
    }

    const charges = this._expectedOf(resellerId, resellerCode, from, to);
    this._expectedCache.set(key, { countedAt: now, charges });
    charges.catch(() => this._expectedCache.delete(key));
    return charges;
  }

  /**
   * Reads the payments expected from the indirect contracts in force a reseller sold and from its fee. A period of a
   * customer falls due when it starts and the invoice of Keus for it on the 4th of the next month, so the contracts
   * are counted far enough ahead to reach both.
   * @param resellerId the reseller.
   * @param resellerCode the code of the reseller.
   * @param from the start of the period (ISO string).
   * @param to the end of the period (ISO string).
   * @returns the expected payments, unsorted, the ones already recorded included.
   * @throws DatabaseException if a read fails.
   */
  private async _expectedOf(resellerId: string, resellerCode: string, from: string, to: string): Promise<ExpectedCharge[]> {
    const [contractsService, resellerContractsService] = await Promise.all([this._loadContractsService(), this._loadResellerContractsService()]);

    const [charges, fees] = await Promise.all([
      contractsService.getExpectedChargesOfReseller(resellerCode, from, addMonths(to, 2)),
      resellerContractsService.getExpectedFees(from, to, resellerId),
    ]);
    return [...charges, ...fees];
  }

  /**
   * Turns the expected periods of the indirect contracts into due dates of the customers, at the price they pay the
   * reseller and on the first day of the period, as the share recorded with the invoice of Keus will be. A period
   * whose share is already recorded is left out.
   * @param expected the expected payments of the reseller.
   * @param customerDues the due dates of the customers read in the same period.
   * @param from the start of the period (ISO string).
   * @param to the end of the period (ISO string).
   * @returns the expected due dates of the customers.
   */
  private _expectedFromCustomers(expected: ExpectedCharge[], customerDues: ScheduleEntry[], from: string, to: string): ScheduleEntry[] {
    const recorded = new Set(customerDues
      .filter(entry => entry.charge?.kind === CustomerChargeKind.Contract)
      .map(entry => `${entry.charge?.contractId}#${entry.dueDate.slice(0, 10)}`));

    return expected
      .filter(charge => charge.contractId && charge.customerCents
        && charge.periodStart >= from && charge.periodStart <= to
        && !recorded.has(`${charge.contractId}#${charge.periodStart.slice(0, 10)}`))
      .map(({ prorationId: _prorationId, ...charge }) => ({
        key: `expected#customer#${charge.contractId}#${charge.periodStart}`,
        direction: ScheduleDirection.FromCustomer,
        dueDate: charge.periodStart,
        expected: charge,
      }));
  }

  /**
   * Tells whether a due date of a reseller is settled: an invoice of Keus paid, a due date of a customer collected. An
   * expected payment is never settled.
   * @param entry the due date.
   * @returns whether it is settled.
   */
  private _isSettled(entry: ScheduleEntry): boolean {
    return entry.invoice ? entry.invoice.status === InvoiceStatus.Paid : !!entry.collected;
  }

  /**
   * Cuts one page out of the due dates of a reseller, after the search, and maps it to its response.
   * @param entries the entries, unsorted.
   * @param query the search, the page size and the cursor.
   * @param descending whether the latest due date comes first.
   * @returns the page.
   * @throws ValidationException if the cursor is not valid.
   */
  private _page(entries: ScheduleEntry[], query: ResellerDuesPageQueryDto, descending = false): ResponseSchedulePageDto {
    const { search, limit, cursor } = query;
    const found = entries.filter(entry => entry.invoice
      ? startsWithAny(search, entry.invoice.number)
      : entry.expected
        ? startsWithAny(search, entry.expected.companyName, entry.expected.contractCode, entry.expected.description)
        : startsWithAny(search, entry.charge?.companyName, entry.charge?.contractCode, entry.charge?.description));

    const page = pageByDueDate(found, limit, cursor, descending);
    return {
      items: page.items.map(entry => plainToInstance(ResponseScheduleEntryDto, { ...entry, ...(entry.charge && { charge: this._plain(entry.charge) }) })),
      ...(page.nextCursor && { nextCursor: page.nextCursor }),
    };
  }

  /**
   * Reads the due dates of the customers of a reseller in a period: the single items by their due date, and the due
   * dates of the recurring items counted from their rules.
   * @param resellerId the reseller.
   * @param from the start of the period (ISO string).
   * @param to the end of the period (ISO string).
   * @returns the entries, unsorted.
   * @throws DatabaseException if the query fails.
   */
  private async _customerDues(resellerId: string, from: string, to: string): Promise<ScheduleEntry[]> {
    let singles: CustomerCharge[];
    let rules: CustomerCharge[];
    try {
      [singles, rules] = await Promise.all([
        this._chargeModel.query("resellerId").eq(resellerId).where("dueDate").between(from, to).using("dueIndex").all().exec(),
        this._chargeModel.query("resellerId").eq(resellerId).where("ruleStart").le(to).using("ruleIndex").all().exec(),
      ]);
    } catch (error) {
      this._logger.error(`Error reading the due dates of the customers of reseller ${resellerId}`, error);
      throw new DatabaseException("An error occurred while reading the charges of the customers.", error);
    }

    return [
      ...singles.map(charge => ({
        key: `charge#${charge.id}`,
        direction: ScheduleDirection.FromCustomer,
        dueDate: charge.dueDate ?? from,
        collected: !!charge.collectedAt,
        charge,
      })),
      ...rules.flatMap(charge => occurrencesBetween(this._ruleOf(charge), from, to).map(dueDate => ({
        key: `charge#${charge.id}#${dueDate}`,
        direction: ScheduleDirection.FromCustomer,
        dueDate,
        collected: !!charge.collectedDates?.has(dueDate),
        charge,
      }))),
    ];
  }

  /**
   * Describes a due date of a customer for the email that reminds it.
   * @param entry the due date.
   * @returns the values of its line.
   */
  private _dueLine(entry: ScheduleEntry): Record<string, string> {
    return {
      companyName: entry.charge?.companyName ?? "",
      description: entry.charge?.description ?? "",
      amount: formatEuro(entry.charge?.amountCents ?? 0),
      dueDate: formatDate(entry.dueDate),
    };
  }

  /**
   * Reads the reseller of a request, within the scope of the requester.
   * @param resellerId the reseller.
   * @param scope the request scope.
   * @returns the reseller.
   * @throws AuthorizationException if the reseller is outside the scope of the requester.
   * @throws EntityNotFoundException if the reseller does not exist.
   */
  private async _getReseller(resellerId: string, scope: RequestScope): Promise<ResponseResellerDto> {
    const resellersService = await this._loadResellersService();
    return resellersService.getReseller(resellerId, scope);
  }

  /**
   * Reads a company and checks it is a customer of the reseller: sold by it, not by one of its sub-resellers.
   * @param reseller the reseller.
   * @param companyId the company.
   * @param scope the request scope.
   * @returns the identifier and the name of the company.
   * @throws BusinessException if the company is not a customer of the reseller.
   */
  private async _getCustomer(reseller: ResponseResellerDto, companyId: string, scope: RequestScope): Promise<{ id: string; name: string }> {
    const companiesService = await this._loadCompaniesService();
    const company = await companiesService.getCompany(companyId, scope);

    const sellerCode = (company.resellerPath ?? "").split("#").filter(Boolean).pop();
    if (sellerCode !== reseller.code) {
      throw new BusinessException(`Company ${companyId} is not a customer of reseller ${reseller.code}.`, "COMPANY_NOT_CUSTOMER_OF_RESELLER");
    }
    return { id: company.id, name: company.name };
  }

  /**
   * Reads an item.
   * @param key the reseller and the identifier of the item.
   * @returns the item.
   * @throws EntityNotFoundException if the item does not exist.
   */
  private async _getStored(key: CustomerChargeKey): Promise<CustomerCharge> {
    let charge: CustomerCharge | undefined;
    try {
      charge = await this._chargeModel.get(key);
    } catch (error) {
      this._logger.error(`Error reading item ${key.id} of reseller ${key.resellerId}`, error);
      throw new DatabaseException("An error occurred while reading the charge of the customer.", error);
    }

    if (!charge) {
      throw new EntityNotFoundException("CustomerCharge", key.id);
    }
    return charge;
  }

  /**
   * Reads an item the reseller added by hand.
   * @param key the reseller and the identifier of the item.
   * @returns the item.
   * @throws EntityNotFoundException if the item does not exist.
   * @throws BusinessException if the item is the share of a contract.
   */
  private async _getManual(key: CustomerChargeKey): Promise<CustomerCharge> {
    const charge = await this._getStored(key);
    if (charge.kind === CustomerChargeKind.Contract) {
      throw new BusinessException(`Item ${key.id} is the share of contract ${charge.contractCode}: it follows the contract.`, "CUSTOMER_CHARGE_FROM_CONTRACT");
    }

    return charge;
  }

  /**
   * Checks that the dates of an item fit its kind: a due date on a one-off item, a start and a cadence on a recurring
   * one, which ends after it starts.
   * @param kind the kind of the item.
   * @param dates the dates of the item.
   * @throws BusinessException if they do not fit.
   */
  private _validateDates(kind: CustomerChargeKind, dates: ChargeDates): void {
    const fits = kind === CustomerChargeKind.OneOff
      ? !!dates.dueDate && !dates.ruleStart && !dates.cadence && !dates.ruleEnd
      : !!dates.ruleStart && !!dates.cadence && !dates.dueDate && (!dates.ruleEnd || dates.ruleEnd >= dates.ruleStart);

    if (!fits) {
      throw new BusinessException(
        kind === CustomerChargeKind.OneOff
          ? "A one-off item needs its due date and no recurring rule."
          : "A recurring item needs its start and cadence, no single due date, and an end after its start.",
        "CUSTOMER_CHARGE_DATES",
      );
    }
  }

  /**
   * Reads the rule of a recurring item.
   * @param charge the recurring item.
   * @returns its rule.
   */
  private _ruleOf(charge: CustomerCharge): ChargeRule {
    return { ruleStart: charge.ruleStart ?? "", cadence: charge.cadence, ...(charge.ruleEnd && { ruleEnd: charge.ruleEnd }) };
  }

  /**
   * Writes the dates of an item as full ISO strings, so that due dates compare as text.
   * @param dates the dates as they came in.
   * @returns the same dates, normalized.
   */
  private _normalizedDates<T extends Partial<ChargeDates>>(dates: T): T {
    const iso = (date?: string | null): string | undefined => (date ? new Date(date).toISOString() : undefined);
    return {
      ...dates,
      ...(dates.dueDate && { dueDate: iso(dates.dueDate) }),
      ...(dates.ruleStart && { ruleStart: iso(dates.ruleStart) }),
      ...(dates.ruleEnd && { ruleEnd: iso(dates.ruleEnd) }),
    };
  }

  /**
   * Maps an item to its response.
   * @param charge the item.
   * @returns the response.
   */
  private _toResponse(charge: CustomerCharge): ResponseCustomerChargeDto {
    return plainToInstance(ResponseCustomerChargeDto, this._plain(charge));
  }

  /**
   * Turns an item into a plain object, with the collected due dates as a sorted list.
   * @param charge the item.
   * @returns the plain item.
   */
  private _plain(charge: CustomerCharge): Record<string, unknown> {
    return { ...charge, ...(charge.collectedDates && { collectedDates: [...charge.collectedDates].sort() }) };
  }
}
