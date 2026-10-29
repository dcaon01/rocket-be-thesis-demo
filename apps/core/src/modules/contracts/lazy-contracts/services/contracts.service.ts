import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { Condition, transaction } from "dynamoose";
import { SortOrder } from "dynamoose/dist/General";
import { InjectModel, Model } from "nestjs-dynamoose";
import type Stripe from "stripe";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import { isUnrestricted, RequestScope, SYSTEM_SCOPE } from "@rocket-be/scoping";
import { todayInItaly } from "../../../../commons/dates/calendar-day.helper";
import { isWithin, paginate, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { ContractsPageQueryDto } from "../../dtos/contracts-page-query.dto";
import { ResponseContractsPageDto } from "../../dtos/response-contracts-page.dto";
import { AppException, AuthorizationException, BusinessException, DatabaseException, EntityNotFoundException } from "../../../../errors/exception-types";
import { assertCollaborator, assertPathVisible, isKeusSalespersonOnly, isPathVisible, isSalespersonOnly } from "../../../../commons/scoping/scoped-access.helper";
import { isConditionalCheckFailed } from "../../../../commons/persistence/write-errors.helper";
import { toDynamooseUpdate } from "../../../../commons/persistence/removable-update.helper";
import { EntityTypeEnum } from "../../../../commons/enums/entity-type.enum";
import { OperationEnum } from "../../../../commons/enums/operation.enum";
import { formatDate, formatEuro, rocketUrl } from "../../../../commons/formatting/notice-format.helper";
import { DEMO_VAT_RATE_PERCENT, integrationsEnabled } from "../../../../commons/integrations/integrations.helper";
import { MailTemplate } from "../../../mail/enums/mail-template.enum";
import { CompaniesService } from "../../../companies/lazy-companies/services/companies.service";
import { EventBridgeService } from "../../../event-bridge/lazy-event-bridge/services/event-bridge.service";
import type { TransactionWrite } from "../../../pending-operations/lazy-pending-operations/services/pending-operations.service";
import { SalesChannel } from "../../../companies/enums/sales-channel.enum";
import { BilledPartyType } from "../../../invoices/enums/billed-party-type.enum";
import { ChargeCadence } from "../../../invoices/enums/charge-cadence.enum";
import { billedPartyOf } from "../../../invoices/helpers/billed-party.helper";
import { occurrencesBetween } from "../../../invoices/helpers/charge-occurrences.helper";
import { invoiceAmounts } from "../../../invoices/helpers/invoice-amounts.helper";
import type { ExpectedCharge } from "../../../invoices/interfaces/expected-charge.interface";
import type { InvoicesService } from "../../../invoices/lazy-invoices/services/invoices.service";
import type { LineCharges } from "../../../orders/interfaces/line-charges.interface";
import type { OrdersService } from "../../../orders/lazy-orders/services/orders.service";
import { BillingInterval } from "../../../plans/enums/billing-interval.enum";
import { PlanType } from "../../../plans/enums/plan-type.enum";
import { PlansService } from "../../../plans/lazy-plans/services/plans.service";
import { ProductsService } from "../../../products/lazy-products/services/products.service";
import { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import type { RenderService } from "../../../render/lazy-render/services/render.service";
import { PresignedUrlResponseDto } from "../../../s3/dtos/presigned-url-response.dto";
import { S3Service } from "../../../s3/lazy-s3/services/s3.service";
import { StripeService } from "../../../stripe/lazy-stripe/services/stripe.service";
import { TemplateType } from "../../../templates/enums/template-type.enum";
import { TemplatesService } from "../../../templates/lazy-templates/services/templates.service";
import { UpdateTenantDto } from "../../../tenants/dtos/update-tenant.dto";
import { TenantStatus } from "../../../tenants/enums/tenant-status.enum";
import { TenantsService } from "../../../tenants/lazy-tenants/services/tenants.service";
import { CONTRACT_CHECKOUT_PURPOSE } from "../../../stripe/constants/metadata-purpose.constant";
import { DUNNING_DAYS, DunningStep } from "../../../invoices/enums/dunning-step.enum";
import { ContractPayloadDto } from "../../dtos/contract-payload.dto";
import { ResponseContractDto } from "../../dtos/response-contract.dto";
import { ContractEvent } from "../../enums/contract-event.enum";
import { ContractStatus, IN_FORCE_STATUSES } from "../../enums/contract-status.enum";
import { ContractTerminationReason } from "../../enums/contract-termination-reason.enum";
import { ContractAcceptance, contractDocumentData } from "../../helpers/contract-document.helper";
import { addMonths, addYears, monthOf, subtractDays } from "../../helpers/contract-dates.helper";
import { Contract, ContractKey } from "../../schemas/contract.schema";
import type { CustomerChargesService } from "../../../invoices/lazy-invoices/services/customer-charges.service";
import type { Invoice } from "../../../invoices/schemas/invoice.schema";
import type { ResponsePlanDto } from "../../../plans/dtos/response-plan.dto";
import { SeatEvent } from "../../classes/seat-event.class";
import { SeatEventKind } from "../../enums/seat-event-kind.enum";
import { ContractNoticesService } from "./contract-notices.service";
import { ContractSchedulerService } from "./contract-scheduler.service";
import { CompanyProduct, CompanyProductKey } from "../../schemas/company-product.schema";

/** Names of the finance companies, as printed on their invoices. */
const FINANCIER_NAMES: Record<string, string> = { GRENKE: 'Grenke' };

/** What the provisioning of an order line knows of the contract it creates. */
export type NewContract = {
  /** Product of the line. */
  productId: string;
  /** Order of the line. */
  orderId: string;
  /** Salesperson who opened the order. */
  assignedSalesId?: string;
  /** Company of the order. */
  companyId: string;
  /** Tenant the line provisioned. */
  tenantId: string;
  /** Plan of the line. */
  planId: string;
  /** Seats of the line. */
  seats: number;
  /** Recurring amount per billing period of the plan, customization included, in cents. */
  recurringCents?: number;
  /** Materialized path of the selling reseller. */
  resellerPath?: string;
  /** Years the finance company pays, on a financed order: a recurring contract ends with them. */
  financedYears?: number;
  /** End of the period paid through the reseller the company came from, on a contract taking over a transferred one. */
  paidUntil?: string;
};

/** The unpaid invoice behind a suspension, as the notices name it. */
type UnpaidInvoiceFacts = { number?: string; amountCents: number };

/** Why the access of a contract is suspended: an unpaid invoice, or a payment never set up; absent when by hand. */
type SuspensionCause = { invoice: UnpaidInvoiceFacts } | { paymentNotSetUp: true };

/** The line items and the single coupon of the checkout of a contract. */
type CheckoutItems = { mode: "subscription" | "payment"; lineItems: Stripe.Checkout.SessionCreateParams.LineItem[]; couponId?: string };

/** Hours a checkout must still last to be reused: the customer needs time to fill it in. */
const CHECKOUT_MIN_HOURS_LEFT = 1;

/** Hours ahead the trial of a checkout must end at least, as Stripe requires. */
const CHECKOUT_MIN_TRIAL_HOURS = 48;

/** Namespace of the identifiers of the prorations, fixed by contract and seats reached or by anniversary. */
const PRORATION_NAMESPACE = "3f6c2a8e-5b1d-4e7a-9c0f-8d2b6e4a1c57";

/** A period of a contract expected to be paid, before the contract and the VAT are added to it. */
type ExpectedPeriod = Omit<ExpectedCharge, 'contractId' | 'contractCode' | 'productId' | 'companyId' | 'companyName' | 'vatCents' | 'amountCents'>;

/** The reseller an indirect contract bills, as the expected payments name it. */
type BillingReseller = { id: string; name: string };

/** Readers of one count of the expected payments, each reading a reseller or a line once per request. */
type ExpectedReaders = {
  /** Reads who bills a reseller from its code. */
  resellerOf: (code: string) => Promise<BillingReseller | undefined>;
  /** Reads what the line of a contract charges, at the given seats when they differ from the ones sold. */
  lineOf: (productId: string, orderId: string, seats?: number) => Promise<LineCharges>;
};

/**
 * A charge of seats beyond the ones paid: the proration of the increases of a day, or the year of the seats beyond the
 * financed ones at an anniversary. It becomes an invoice at once, with its communication (UR-RK-401, UR-RK-402).
 */
type SeatCharge = {
  /** Fixed identifier of the charge: billing it again finds the invoice already recorded. */
  prorationId: string;
  /** Who pays it: the reseller on the indirect channel, the company otherwise. */
  channel: SalesChannel;
  /** Line of the invoice. */
  description: string;
  /** Seats paid before the charge. */
  seatsFrom: number;
  /** Seats paid with the charge. */
  seatsTo: number;
  /** Start of the time the charge covers (ISO string). */
  periodStart: string;
  /** End of the period the charge covers (ISO string). */
  periodEnd: string;
  /** Amount, net of VAT, in cents. */
  amountCents: number;
  /** Amount at the price the customer pays the reseller, on the indirect channel, in cents. */
  customerAmountCents?: number;
};

/** What a seat increase changes on a contract, before the write that records it. */
type SeatVariation = {
  /** New amount of the renewal, when the contract renews. */
  renewalAmountCents?: number;
  /** Whether the increase costs more and someone already pays the contract, so that a proration is due. */
  billable: boolean;
  /** Subscription to bring to the new seats, on the direct channel. */
  subscription?: { subscriptionId: string; plan: ResponsePlanDto; stripeApiKey: string };
};

/**
 * Service for the lifecycle of the contracts: reads, cancellation, renewal, termination and access to the tenant.
 */
@Injectable()
export class ContractsService {
  /** Logger instance for ContractsService. */
  private readonly _logger = new Logger(ContractsService.name);

  /** Lazy-loaded companies service. */
  private _companiesService: CompaniesService | null = null;

  /** Lazy-loaded customer charges service. */
  private _customerChargesService: CustomerChargesService | null = null;

  /** Lazy-loaded EventBridge service. */
  private _eventBridgeService: EventBridgeService | null = null;

  /** Lazy-loaded invoices service. */
  private _invoicesService: InvoicesService | null = null;

  /** Lazy-loaded orders service. */
  private _ordersService: OrdersService | null = null;

  /** Lazy-loaded plans service. */
  private _plansService: PlansService | null = null;

  /** Lazy-loaded products service. */
  private _productsService: ProductsService | null = null;

  /** Lazy-loaded render service. */
  private _renderService: RenderService | null = null;

  /** Lazy-loaded resellers service. */
  private _resellersService: ResellersService | null = null;

  /** Lazy-loaded S3 service. */
  private _s3Service: S3Service | null = null;

  /** Lazy-loaded Stripe service. */
  private _stripeService: StripeService | null = null;

  /** Lazy-loaded templates service. */
  private _templatesService: TemplatesService | null = null;

  /** Lazy-loaded tenants service. */
  private _tenantsService: TenantsService | null = null;

  /**
   * Constructor for ContractsService.
   * @param _contractModel the Dynamoose model used to persist the contracts.
   * @param _companyProductModel the Dynamoose model of the products each company holds, one contract in force at a time.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the other services on demand.
   * @param _contractSchedulerService the scheduler of the renewal and termination events.
   * @param _contractNoticesService the sender of the notices of the contract's life.
   */
  constructor(
    @InjectModel("Contract")
    private readonly _contractModel: Model<Contract, ContractKey>,
    @InjectModel("CompanyProduct")
    private readonly _companyProductModel: Model<CompanyProduct, CompanyProductKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader,
    private readonly _contractSchedulerService: ContractSchedulerService,
    private readonly _contractNoticesService: ContractNoticesService,
  ) { }

  /**
   * Lazy loads the EventBridgeService from its module.
   * @returns a Promise resolving to the EventBridgeService instance.
   */
  private async _loadEventBridgeService(): Promise<EventBridgeService> {
    if (!this._eventBridgeService) {
      const { EventBridgeLazyModule } = await import("../../../event-bridge/lazy-event-bridge/event-bridge-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => EventBridgeLazyModule);
      this._eventBridgeService = moduleRef.get<EventBridgeService>(EventBridgeService);
    }
    return this._eventBridgeService;
  }

  /**
   * Lazy loads the CompaniesService from its module.
   * @returns a Promise resolving to the CompaniesService instance.
   */
  private async _loadCompaniesService(): Promise<CompaniesService> {
    if (!this._companiesService) {
      const { CompaniesLazyModule } = await import("../../../companies/lazy-companies/companies-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => CompaniesLazyModule);
      this._companiesService = moduleRef.get<CompaniesService>(CompaniesService);
    }
    return this._companiesService;
  }

  /**
   * Lazy loads the CustomerChargesService from the invoices module.
   * @returns a Promise resolving to the CustomerChargesService instance.
   */
  private async _loadCustomerChargesService(): Promise<CustomerChargesService> {
    if (!this._customerChargesService) {
      const { InvoicesLazyModule } = await import("../../../invoices/lazy-invoices/invoices-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => InvoicesLazyModule);
      const { CustomerChargesService } = await import("../../../invoices/lazy-invoices/services/customer-charges.service");
      this._customerChargesService = moduleRef.get<CustomerChargesService>(CustomerChargesService);
    }
    return this._customerChargesService;
  }

  /**
   * Lazy loads the InvoicesService from its module.
   * @returns a Promise resolving to the InvoicesService instance.
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
   * Lazy loads the OrdersService from its module.
   * @returns a Promise resolving to the OrdersService instance.
   */
  private async _loadOrdersService(): Promise<OrdersService> {
    if (!this._ordersService) {
      const { OrdersLazyModule } = await import("../../../orders/lazy-orders/orders-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => OrdersLazyModule);
      const { OrdersService } = await import("../../../orders/lazy-orders/services/orders.service");
      this._ordersService = moduleRef.get<OrdersService>(OrdersService);
    }
    return this._ordersService;
  }

  /**
   * Lazy loads the PlansService from its module.
   * @returns a Promise resolving to the PlansService instance.
   */
  private async _loadPlansService(): Promise<PlansService> {
    if (!this._plansService) {
      const { PlansLazyModule } = await import("../../../plans/lazy-plans/plans-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => PlansLazyModule);
      this._plansService = moduleRef.get<PlansService>(PlansService);
    }
    return this._plansService;
  }

  /**
   * Lazy loads the RenderService from its module.
   * @returns a Promise resolving to the RenderService instance.
   */
  private async _loadRenderService(): Promise<RenderService> {
    if (!this._renderService) {
      const { RenderLazyModule } = await import("../../../render/lazy-render/render-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => RenderLazyModule);
      const { RenderService } = await import("../../../render/lazy-render/services/render.service");
      this._renderService = moduleRef.get<RenderService>(RenderService);
    }
    return this._renderService;
  }

  /**
   * Lazy loads the S3Service from its module.
   * @returns a Promise resolving to the S3Service instance.
   */
  private async _loadS3Service(): Promise<S3Service> {
    if (!this._s3Service) {
      const { S3LazyModule } = await import("../../../s3/lazy-s3/s3-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => S3LazyModule);
      this._s3Service = moduleRef.get<S3Service>(S3Service);
    }
    return this._s3Service;
  }

  /**
   * Lazy loads the TemplatesService from its module.
   * @returns a Promise resolving to the TemplatesService instance.
   */
  private async _loadTemplatesService(): Promise<TemplatesService> {
    if (!this._templatesService) {
      const { TemplatesLazyModule } = await import("../../../templates/lazy-templates/templates-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => TemplatesLazyModule);
      this._templatesService = moduleRef.get<TemplatesService>(TemplatesService);
    }
    return this._templatesService;
  }

  /**
   * Lazy loads the ProductsService from its module.
   * @returns a Promise resolving to the ProductsService instance.
   */
  private async _loadProductsService(): Promise<ProductsService> {
    if (!this._productsService) {
      const { ProductsLazyModule } = await import("../../../products/lazy-products/products-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ProductsLazyModule);
      this._productsService = moduleRef.get<ProductsService>(ProductsService);
    }
    return this._productsService;
  }

  /**
   * Lazy loads the ResellersService from its module.
   * @returns a Promise resolving to the ResellersService instance.
   */
  private async _loadResellersService(): Promise<ResellersService> {
    if (!this._resellersService) {
      const { ResellersLazyModule } = await import("../../../resellers/lazy-resellers/resellers-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ResellersLazyModule);
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
      this._stripeService = moduleRef.get<StripeService>(StripeService);
    }
    return this._stripeService;
  }

  /**
   * Lazy loads the TenantsService from its module.
   * @returns a Promise resolving to the TenantsService instance.
   */
  private async _loadTenantsService(): Promise<TenantsService> {
    if (!this._tenantsService) {
      const { TenantsLazyModule } = await import("../../../tenants/lazy-tenants/tenants-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => TenantsLazyModule);
      this._tenantsService = moduleRef.get<TenantsService>(TenantsService);
    }
    return this._tenantsService;
  }

  /**
   * Lists one page of the contracts of a product; a reseller sees only those of its subtree, its salesperson included,
   * read off the reseller path index.
   * @param productId the product of the contracts.
   * @param query the page and its filters.
   * @param scope the request scope.
   * @returns the page of contracts.
   * @throws ValidationException if the cursor is not valid.
   */
  async listContracts(productId: string, query: ContractsPageQueryDto, scope: RequestScope): Promise<ResponseContractsPageDto> {
    const { limit, cursor, status, search, dateField, from, to } = query;

    try {
      const viewerPath = isUnrestricted(scope) ? undefined : await this._resolveScopePath(scope);
      if (!isUnrestricted(scope) && !viewerPath) {
        return { items: [] };
      }

      const page = await paginate<Contract>(
        () => viewerPath
          ? this._contractModel.query("productId").eq(productId).where("resellerPath").beginsWith(viewerPath).using("resellerPathIndex")
          : this._contractModel.query("productId").eq(productId),
        viewerPath ? ["productId", "id", "resellerPath"] : ["productId", "id"],
        limit,
        cursor,
        contract =>
          (!status?.length || status.includes(contract.status))
          && startsWithAny(search, contract.code, contract.companyName)
          && isWithin(contract[dateField ?? "startDate"], from, to),
      );
      return { items: page.items.map(contract => this._toResponse(contract, scope)), nextCursor: page.nextCursor };
    } catch (error) {
      throw this._wrap(error, `Error listing the contracts of product ${productId}`, 'An error occurred while retrieving the contracts by product.');
    }
  }

  /**
   * Retrieves the contracts of a company, terminated ones included; a reseller sees only those of its subtree.
   * @param companyId the company of the contracts.
   * @param scope the request scope.
   * @returns the contracts of the company, by start date.
   */
  async getContractsByCompany(companyId: string, scope: RequestScope): Promise<ResponseContractDto[]> {
    try {
      const contracts = [...await this._contractModel.query("companyId").eq(companyId).using("companyIndex").all().exec()];
      const visible = isUnrestricted(scope) ? contracts : await this._visibleTo(scope, contracts);
      this._logger.log(`Retrieved ${visible.length} contracts for company ID: ${companyId}.`);
      return visible.map(contract => this._toResponse(contract, scope));
    } catch (error) {
      throw this._wrap(error, `Error retrieving the contracts of company ${companyId}`, 'An error occurred while retrieving the contracts by company.');
    }
  }


  /**
   * Builds the write that has an order hold a product of a company, for the transaction that provisions its line: it
   * fails while another order holds the pair, and passes again for the order already holding it, as on a retry.
   * @param companyId the company of the order.
   * @param productId the product of the line.
   * @param orderId the order of the line.
   * @returns the transaction write.
   */
  productHoldWrite(companyId: string, productId: string, orderId: string): TransactionWrite {
    return this._companyProductModel.transaction.update(
      { companyId, productId },
      { orderId },
      { condition: new Condition().where("orderId").not().exists().or().where("orderId").eq(orderId) },
    );
  }

  /**
   * Reads the holds the order of a contract keeps on its product, on every record of the company, for the transaction
   * that terminates the contract: once it is terminated the company can take a new order on the product. A hold taken
   * by another order is not this contract's, and stays; a company no longer on record leaves only its own record.
   * @param contract the contract being terminated.
   * @returns the keys of the holds of its order.
   */
  private async _productHoldsOf(contract: Contract): Promise<{ companyId: string; productId: string }[]> {
    const companiesService = await this._loadCompaniesService();
    const companyIds = await companiesService.getCompanyGroupIds(contract.companyId).catch(error => {
      if (error instanceof EntityNotFoundException) return [contract.companyId];
      throw error;
    });

    const holds = await Promise.all(companyIds.map(companyId => this._companyProductModel.get({ companyId, productId: contract.productId })));
    return holds.flatMap(hold => hold?.orderId === contract.orderId ? [{ companyId: hold.companyId, productId: hold.productId }] : []);
  }

  /**
   * Reads which order holds a product of a company, to name it when a provisioning finds the pair taken.
   * @param companyId the company.
   * @param productId the product.
   * @returns the identifier of the holding order, undefined while the pair is free.
   */
  async getProductHolder(companyId: string, productId: string): Promise<string | undefined> {
    const hold = await this._companyProductModel.get({ companyId, productId });
    return hold?.orderId;
  }

  /**
   * Retrieves all contracts. Cross-product scan: reserved to Keus collaborators.
   * @param scope the request scope.
   * @returns all contracts.
   */
  async getAllContracts(scope: RequestScope): Promise<ResponseContractDto[]> {
    assertCollaborator(scope, 'getAllContracts');
    try {
      const contracts = await this._contractModel.scan().exec(); // Every product at once: there is no key to query on.
      this._logger.log(`Retrieved ${contracts.length} contracts.`);
      return contracts.map(contract => plainToInstance(ResponseContractDto, contract));
    } catch (error) {
      throw this._wrap(error, 'Error retrieving contracts', 'An error occurred while retrieving the contracts.');
    }
  }

  /**
   * Retrieves a contract.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param scope the request scope.
   * @returns the contract.
   * @throws EntityNotFoundException if the contract does not exist.
   */
  async getContract(productId: string, id: string, scope: RequestScope): Promise<ResponseContractDto> {
    try {
      return this._toResponse(await this._getVisibleContract(productId, id, scope), scope);
    } catch (error) {
      throw this._wrap(error, `Error retrieving contract ${id} of product ${productId}`, 'An error occurred while retrieving the contract.');
    }
  }

  /**
   * Retrieves a contract for its detail page, with whether it still waits for the company to set up the payment and
   * whether a finance company paid it.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param scope the request scope.
   * @returns the contract.
   * @throws EntityNotFoundException if the contract does not exist.
   */
  async getContractDetail(productId: string, id: string, scope: RequestScope): Promise<ResponseContractDto> {
    try {
      const contract = await this._getVisibleContract(productId, id, scope);
      // Only a direct contract in force can wait for its mandate, or end with a financing.
      if (!IN_FORCE_STATUSES.includes(contract.status) || contract.resellerPath) {
        return this._toResponse({ ...contract, paymentRequired: false }, scope);
      }

      const ordersService = await this._loadOrdersService();
      const charges = await ordersService.getLineCharges(productId, contract.orderId);
      const paymentRequired = await this._awaitsPayment(contract, charges);
      return this._toResponse({ ...contract, paymentRequired, financed: !!charges.financing }, scope);
    } catch (error) {
      throw this._wrap(error, `Error retrieving contract ${id} of product ${productId}`, 'An error occurred while retrieving the contract.');
    }
  }

  /**
   * Prepares the contract of a provisioned order line: fills its document from the CONTRACT template and stores it,
   * then returns the write that creates the record, to commit with the line.
   * @param input what the provisioning knows of the contract.
   * @returns the contract and its transaction write.
   * @throws BusinessException if no contract template is in force.
   */
  async prepareContract(input: NewContract): Promise<{ contract: Contract; write: TransactionWrite }> {
    const [product, plan] = await Promise.all([
      this._loadProductsService().then(service => service.getProduct(input.productId)),
      this._loadPlansService().then(service => service.getPlan(input.productId, input.planId)),
    ]);
    const companiesService = await this._loadCompaniesService();
    const company = await companiesService.getCompany(input.companyId, SYSTEM_SCOPE);

    const id = uuidv4();
    const startDate = new Date().toISOString();
    const oneOff = plan.type === PlanType.OneTime;
    // A financed contract ends with its financing and never renews: its renewal dates are only the anniversaries on
    // which the company pays the seats beyond the financed ones.
    const financedUntil = !oneOff && input.financedYears ? addYears(startDate, input.financedYears) : undefined;
    // A contract taking over a transferred one is charged from the end of the period paid: its year starts there.
    const anniversary = addYears(input.paidUntil ?? startDate, 1);
    const renewalDate = oneOff || (financedUntil && anniversary >= financedUntil) ? undefined : anniversary;
    const terminationDate = financedUntil ?? (oneOff && plan.termMonths ? addMonths(startDate, plan.termMonths) : undefined);
    const yearlyFactor = plan.billingInterval === BillingInterval.Monthly ? 12 : 1;
    // The reseller is billed by Rocket period by period; the first period is billed at provisioning.
    const nextBillingDate = input.resellerPath && !oneOff ? addMonths(startDate, 12 / yearlyFactor) : undefined;
    const code = this._generateContractCode(product.prefix, await this._getLastContract(input.productId, product.prefix));

    const templatesService = await this._loadTemplatesService();
    const document = await templatesService.renderPublished(
      TemplateType.Contract,
      contractDocumentData(company, product.name, { code, seats: input.seats, startDate, renewalDate }),
    );
    const documentS3Key = `contract-documents/${input.productId}/${id}/contract.html`;
    const s3Service = await this._loadS3Service();
    await s3Service.putObject(documentS3Key, document.html, "text/html; charset=utf-8");

    const contract = {
      productId: input.productId,
      id,
      code,
      companyId: input.companyId,
      companyName: company.name,
      tenantId: input.tenantId,
      planId: input.planId,
      orderId: input.orderId,
      ...(input.assignedSalesId && { assignedSalesId: input.assignedSalesId }),
      seats: input.seats,
      invoicedSeats: input.seats,
      // The events are appended with list_append, which needs the list to exist.
      seatEvents: [],
      startDate,
      noticeDays: plan.noticeDays ?? 0,
      status: financedUntil ? ContractStatus.Terminating : ContractStatus.Active,
      monthIndex: monthOf(startDate),
      documentS3Key,
      templateId: document.templateId,
      ...(renewalDate && { renewalDate, ...(!financedUntil && { renewalMonth: monthOf(renewalDate) }) }),
      ...(nextBillingDate && { nextBillingDate }),
      ...(renewalDate && input.recurringCents !== undefined && { renewalAmountCents: financedUntil ? 0 : input.recurringCents * yearlyFactor }),
      ...(terminationDate && { terminationDate, terminationMonth: monthOf(terminationDate) }),
      ...(input.resellerPath && { resellerPath: input.resellerPath }),
      ...(input.paidUntil && { paidUntil: input.paidUntil }),
    } as Contract;
    return { contract, write: this._contractModel.transaction.create(contract, { overwrite: false }) };
  }

  /**
   * Realigns the company name copied on the contracts of a company, after the company changed it.
   * @param companyId the company.
   * @param companyName the new name.
   */
  async syncCompanyName(companyId: string, companyName: string): Promise<void> {
    const contracts = await this._contractModel.query("companyId").eq(companyId).using("companyIndex").all().exec();
    for (const contract of contracts.filter(item => item.companyName !== companyName)) {
      await this._contractModel.update({ productId: contract.productId, id: contract.id }, { companyName });
    }
    this._logger.log(`Company name realigned on the contracts of company ${companyId}.`);
  }

  /**
   * Moves the contracts in force of a company to another reseller (UR-RK-105). The reseller billed for a period is
   * read off the path when the period is invoiced (`_invoiceReseller`), so the new one is billed from the next
   * period, with the amounts of the order line; terminated contracts stay the history of the old reseller.
   * @param companyId the company being transferred.
   * @param resellerPath the path of the reseller it joins.
   */
  async transferCompanyContracts(companyId: string, resellerPath: string): Promise<void> {
    const contracts = await this._contractModel.query("companyId").eq(companyId).using("companyIndex").all().exec();
    const moving = contracts.filter(contract => IN_FORCE_STATUSES.includes(contract.status) && contract.resellerPath !== resellerPath);

    for (const contract of moving) {
      await this._contractModel.update({ productId: contract.productId, id: contract.id }, { resellerPath });
    }
    this._logger.log(`Company ${companyId}: ${moving.length} contract(s) moved to reseller path ${resellerPath}.`);
  }

  /**
   * Schedules the next event of a contract just created: its renewal (the first anniversary, on a financed one), or the
   * end of a one-off plan with a term or of a financing within one year.
   * @param contract the contract committed.
   */
  async scheduleLifecycle(contract: Contract): Promise<void> {
    if (contract.nextBillingDate) {
      await this._contractSchedulerService.scheduleBilling(contract.productId, contract.id, contract.nextBillingDate);
    }
    if (contract.renewalDate) {
      await this._contractSchedulerService.scheduleRenewal(contract.productId, contract.id, contract.renewalDate);
    } else if (contract.terminationDate) {
      await this._contractSchedulerService.scheduleTermination(contract.productId, contract.id, contract.terminationDate);
    }
  }

  /**
   * Tells the product of a contract that it exists, so that the referent of its tenant accepts it at the first access,
   * after setting up the payment when the company pays it and has no mandate yet.
   * @param contract the contract just created, or whose acceptance came before the payment.
   */
  async notifyCreated(contract: Contract): Promise<void> {
    const payload: ContractPayloadDto = {
      id: contract.id,
      tenantId: contract.tenantId,
      code: contract.code,
      seats: contract.seats,
      startDate: contract.startDate,
      paymentRequired: await this._awaitsPayment(contract),
    };

    const eventBridgeService = await this._loadEventBridgeService();
    await eventBridgeService.sendNotification({
      productId: contract.productId,
      operation: OperationEnum.Create,
      entityType: EntityTypeEnum.Contract,
      payload: [payload],
    });
    this._logger.log(`Product ${contract.productId} told of contract ${contract.code}.`);
  }

  /**
   * Sends the product a fresh signed link to the document of a contract, for the dialog in which its referent accepts it.
   * Only the link travels: the document stays on S3. While the payment is not set up, the same answer carries the
   * link of the checkout the referent completes first.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @throws EntityNotFoundException if the contract does not exist.
   */
  async sendDocumentUrl(productId: string, id: string): Promise<void> {
    const contract = await this._getVisibleContract(productId, id, SYSTEM_SCOPE);
    const s3Service = await this._loadS3Service();
    const signed = await s3Service.signDownloadUrl(contract.documentS3Key);
    const paymentRequired = await this._awaitsPayment(contract);
    const checkout = paymentRequired ? await this._ensureCheckout(contract) : undefined;

    const payload: ContractPayloadDto = {
      id: contract.id,
      tenantId: contract.tenantId,
      documentUrl: signed.url,
      documentUrlExpiresAt: new Date(Date.now() + signed.expiresIn * 1000).toISOString(),
      paymentRequired,
      ...(checkout && { checkoutUrl: checkout.checkoutSessionUrl, checkoutExpiresAt: checkout.checkoutSessionExpiresAt }),
    };

    const eventBridgeService = await this._loadEventBridgeService();
    await eventBridgeService.sendNotification({
      productId,
      operation: OperationEnum.Update,
      entityType: EntityTypeEnum.Contract,
      payload: [payload],
    });
    this._logger.log(`Link to the document of contract ${contract.code} sent to product ${productId}.`);
  }

  /**
   * Records the acceptance of a contract by the referent of its tenant, at the first access. The document is filled
   * again from the template it was born with, now with who accepted and when, and rendered into PDF beside it; the
   * order line becomes ACTIVATED and Rocket emails both files to the company and to whoever accepted it.
   * The PDF comes before the acceptance is recorded, so an accepted contract always has it: a failed rendering
   * leaves the contract to accept, and the product sends the acceptance again.
   * A contract already accepted is left as it is, so a repeated message changes nothing. An acceptance that comes
   * before the payment is set up is refused, and the product gets the contract again to show the dialog back.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param userId the identifier on the product of the user who accepted.
   * @param acceptance when the contract was accepted and by whom, as printed on the document.
   * @throws EntityNotFoundException if the contract does not exist.
   */
  async acceptContract(productId: string, id: string, userId: string, acceptance: ContractAcceptance): Promise<void> {
    const contract = await this._getVisibleContract(productId, id, SYSTEM_SCOPE);
    if (contract.acceptedAt) {
      this._logger.log(`Contract ${contract.code} was already accepted on ${contract.acceptedAt}; nothing to record.`);
      return;
    }
    if (await this._awaitsPayment(contract)) {
      this._logger.warn(`Acceptance of contract ${contract.code} refused: its payment is not set up yet.`);
      await this.notifyCreated(contract);
      return;
    }

    const [company, product] = await Promise.all([
      this._loadCompaniesService().then(service => service.getCompany(contract.companyId, SYSTEM_SCOPE)),
      this._loadProductsService().then(service => service.getProduct(productId)),
    ]);
    const templatesService = await this._loadTemplatesService();
    const html = await templatesService.renderTemplate(
      TemplateType.Contract,
      contract.templateId,
      contractDocumentData(company, product.name, contract, acceptance),
    );
    const renderService = await this._loadRenderService();
    const pdf = await renderService.renderPdf(html);
    const documentPdfS3Key = `contract-documents/${productId}/${id}/contract.pdf`;
    const s3Service = await this._loadS3Service();
    await Promise.all([
      s3Service.putObject(contract.documentS3Key, html, "text/html; charset=utf-8"),
      s3Service.putObject(documentPdfS3Key, pdf, "application/pdf"),
    ]);

    try {
      await this._contractModel.update(
        { productId, id },
        { acceptedAt: acceptance.acceptedAt, acceptedByUserId: userId, documentPdfS3Key },
        { condition: new Condition().where("acceptedAt").not().exists(), return: "item" },
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        this._logger.log(`Contract ${contract.code} was accepted meanwhile; nothing to record.`);
        return;
      }
      throw this._wrap(error, `Error recording the acceptance of contract ${id}`, "An error occurred while recording the acceptance of the contract.");
    }
    this._logger.log(`Contract ${contract.code} accepted by user ${userId} of product ${productId}.`);

    const ordersService = await this._loadOrdersService();
    await ordersService.markLineActivated(productId, contract.orderId, acceptance.acceptedAt);
    await this._sendAcceptedContract(contract, html, pdf, acceptance.userEmail);
  }

  /**
   * Emails the accepted contract, filled again with the acceptance, to the company and to whoever accepted it, as PDF
   * and as HTML.
   * @param contract the contract accepted.
   * @param html the document filled with the acceptance.
   * @param pdf the document rendered into PDF.
   * @param acceptedByEmail the address of whoever accepted it, if known.
   */
  private async _sendAcceptedContract(contract: Contract, html: string, pdf: Buffer, acceptedByEmail?: string): Promise<void> {
    await this._contractNoticesService.toCompany(contract, MailTemplate.CompanyContractAccepted, {}, {
      attachments: [
        { fileName: `${contract.code}.pdf`, contentType: "application/pdf", content: pdf },
        { fileName: `${contract.code}.html`, contentType: "text/html; charset=utf-8", content: Buffer.from(html) },
      ],
      ...(acceptedByEmail && { also: acceptedByEmail }),
    });
  }

  /**
   * Returns the link of the checkout of a contract waiting for its payment, for an email to the company. A checkout
   * that cannot be generated leaves the email without the link.
   * @param contract the contract waiting for its payment.
   * @returns the link, if generated.
   */
  private async _checkoutUrlForNotice(contract: Contract): Promise<string | undefined> {
    try {
      return (await this._ensureCheckout(contract)).checkoutSessionUrl;
    } catch (error) {
      this._logger.warn(`Checkout of contract ${contract.code} not generated for its email`, error);
      return undefined;
    }
  }

  /**
   * Signs a link to the document of a contract, the PDF once accepted; the link expires, so it is asked again at
   * every opening.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param scope the request scope.
   * @returns the signed URL of the document.
   * @throws EntityNotFoundException if the contract does not exist.
   */
  async getDocumentUrl(productId: string, id: string, scope: RequestScope): Promise<PresignedUrlResponseDto> {
    try {
      const contract = await this._getVisibleContract(productId, id, scope);
      const s3Service = await this._loadS3Service();
      return await s3Service.signDownloadUrl(contract.documentPdfS3Key ?? contract.documentS3Key);
    } catch (error) {
      throw this._wrap(error, `Error signing the document of contract ${id}`, 'An error occurred while signing the document of the contract.');
    }
  }

  /**
   * Generates the checkout that starts charging a contract, or keeps the one still valid: the backoffice sends its
   * link to the company or fills it in on its behalf. The checkout collects the SEPA mandate and creates the
   * subscription, with items, amounts and recurrence on the page; on a financed contract it only collects the mandate.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param scope the request scope.
   * @returns the contract with the checkout link.
   * @throws BusinessException if the contract is not in force, is charged to its reseller, or the mandate is already there.
   */
  async createMandateCheckout(productId: string, id: string, scope: RequestScope): Promise<ResponseContractDto> {
    try {
      const contract = await this._getVisibleContract(productId, id, scope);
      if (!IN_FORCE_STATUSES.includes(contract.status)) {
        throw new BusinessException(`Contract ${id} is terminated.`, 'CONTRACT_TERMINATED');
      }

      const ordersService = await this._loadOrdersService();
      const charges = await ordersService.getLineCharges(productId, contract.orderId);
      if (!charges.chargedToCompany && !charges.financing) {
        throw new BusinessException(`Contract ${id} is charged to its reseller, not to the company.`, 'CONTRACT_NOT_CHARGED_TO_COMPANY');
      }
      if ((await this._stripeLinkOf(contract))?.paymentMethodId) {
        throw new BusinessException(`Company ${contract.companyId} already has a mandate on the account of product ${productId}.`, 'MANDATE_ALREADY_COLLECTED');
      }

      return plainToInstance(ResponseContractDto, await this._ensureCheckout(contract));
    } catch (error) {
      throw this._wrap(error, `Error generating the checkout of contract ${id}`, 'An error occurred while generating the checkout.');
    }
  }

  /**
   * Records a completed checkout of a contract: its SEPA mandate becomes the default payment method of the customer
   * and is kept on the company, the subscription it created is recorded, the other checkouts are closed and the
   * dunning stops. The contract starts again from today, with the subscription, unless the checkout only collected
   * the mandate of a financed contract. The product learns that the contract
   * can be accepted, and a tenant suspended for the missing payment gets its access back. A checkout recorded already
   * has no link left on the contract, so a webhook delivered again changes nothing.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param sessionId the completed checkout session.
   */
  async recordCheckout(productId: string, id: string, sessionId: string): Promise<void> {
    const contract = await this._getVisibleContract(productId, id, SYSTEM_SCOPE);
    if (!contract.stripeCustomerId) {
      this._logger.warn(`Checkout ${sessionId} of contract ${id} ignored: the contract has no Stripe customer.`);
      return;
    }
    if (!contract.checkoutSessionUrl) {
      this._logger.log(`Checkout ${sessionId} of contract ${id} already recorded; nothing to do.`);
      return;
    }
    const stripeApiKey = await this._stripeApiKeyOf(productId);
    const stripeService = await this._loadStripeService();
    const outcome = await stripeService.getCheckoutOutcome(sessionId, stripeApiKey);
    await stripeService.setDefaultPaymentMethod(contract.stripeCustomerId, outcome.paymentMethodId, stripeApiKey);
    await stripeService.expireOpenContractCheckouts(contract.stripeCustomerId, id, stripeApiKey);

    const companiesService = await this._loadCompaniesService();
    await companiesService.linkStripeAccount(contract.companyId, {
      accountKey: productId,
      customerId: contract.stripeCustomerId,
      paymentMethodId: outcome.paymentMethodId,
      mandateAt: new Date().toISOString(),
    });
    if (outcome.subscriptionId) {
      await this.recordSubscription(productId, id, outcome.subscriptionId);
    }
    await this._contractModel.update({ productId, id }, toDynamooseUpdate<Contract>({}, ['checkoutSessionUrl', 'checkoutSessionExpiresAt']));
    await this._contractSchedulerService.cancelPaymentDunning(id);
    // A mandate alone charged nothing: the contract keeps the dates of its financing.
    if (!outcome.mandateOnly) {
      await this._restartFromToday(contract);
    }
    this._logger.log(`Checkout ${sessionId} of contract ${contract.code} recorded on company ${contract.companyId}.`);

    const eventBridgeService = await this._loadEventBridgeService();
    await eventBridgeService.sendNotification({
      productId,
      operation: OperationEnum.Update,
      entityType: EntityTypeEnum.Contract,
      payload: [{ id, tenantId: contract.tenantId, paymentRequired: false } satisfies ContractPayloadDto],
    });
    await this.restoreAccess(productId, id);
  }

  /**
   * Brings a contract back to its checkout when the single SEPA payment of the checkout fails, days after it was
   * completed: on a one-off plan Stripe creates the invoice only once the debit succeeds, so no invoice event tells
   * the failure. A new checkout is generated, the dunning of the payment starts again, the product learns that the
   * contract needs paying, as before the checkout, and last the mandate of the failed payment is forgotten. A contract
   * charged by a subscription learns the failure from its invoice instead. A contract with no mandate left was
   * reopened already, as on a repeated webhook, and changes nothing; since the mandate goes last, a webhook repeated
   * after a step failed redoes the steps before it, which all bear running twice.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @returns whether the contract went back to its checkout now.
   */
  async reopenCheckout(productId: string, id: string): Promise<boolean> {
    const contract = await this._getVisibleContract(productId, id, SYSTEM_SCOPE);
    if (!IN_FORCE_STATUSES.includes(contract.status) || contract.stripeSubscriptionId) {
      this._logger.log(`Contract ${contract.code} is ${contract.status} or has a subscription: its failed checkout payment changes nothing.`);
      return false;
    }
    if (!(await this._stripeLinkOf(contract))?.paymentMethodId) {
      this._logger.log(`Contract ${contract.code} has no mandate left: its checkout was reopened already.`);
      return false;
    }

    await this._ensureCheckout(contract);
    await this._contractModel.update({ productId, id }, toDynamooseUpdate<Contract>({}, ['paymentDunningStep']));
    await this._contractSchedulerService.schedulePaymentDunning(productId, id, this._paymentDunningDate(contract, DunningStep.FirstReminder));
    this._logger.log(`The checkout payment of contract ${contract.code} failed: the contract waits for a new checkout.`);

    const eventBridgeService = await this._loadEventBridgeService();
    await eventBridgeService.sendNotification({
      productId,
      operation: OperationEnum.Update,
      entityType: EntityTypeEnum.Contract,
      payload: [{ id, tenantId: contract.tenantId, paymentRequired: true } satisfies ContractPayloadDto],
    });

    const companiesService = await this._loadCompaniesService();
    await companiesService.dropMandate(contract.companyId, productId);
    return true;
  }

  /**
   * Moves the start of a contract to today, when its checkout is completed after the provisioning: renewal, notice and
   * end of a one-off term follow, so the year paid on Stripe is the year of the contract. On a contract taking over a
   * transferred one the year starts at the end of the period paid, as the trial of its subscription does. A contract
   * already cancelled keeps its dates.
   * @param contract the contract whose payment was just set up.
   */
  private async _restartFromToday(contract: Contract): Promise<void> {
    if (contract.status !== ContractStatus.Active) {
      this._logger.log(`Contract ${contract.code} is ${contract.status}: its dates stay.`);
      return;
    }

    const plansService = await this._loadPlansService();
    const plan = await plansService.getPlan(contract.productId, contract.planId);
    const startDate = new Date().toISOString();
    const oneOff = plan.type === PlanType.OneTime;
    const renewalDate = oneOff ? undefined : addYears(this._paidAhead(contract) ?? startDate, 1);
    const terminationDate = oneOff && plan.termMonths ? addMonths(startDate, plan.termMonths) : undefined;
    const restarted = await this._contractModel.update({ productId: contract.productId, id: contract.id }, {
      startDate,
      ...(renewalDate && { renewalDate, renewalMonth: monthOf(renewalDate) }),
      ...(terminationDate && { terminationDate, terminationMonth: monthOf(terminationDate) }),
    }, { return: 'item' });
    await this._contractSchedulerService.cancelRenewal(contract.id);
    await this._contractSchedulerService.cancelTermination(contract.id);
    await this.scheduleLifecycle(restarted);
    this._logger.log(`Contract ${contract.code} starts again on ${startDate}.`);
  }

  /**
   * Creates the checkout that starts charging a contract, the same link for the backoffice and for the product, or
   * keeps the one that still lasts long enough. The company becomes a Stripe customer of the product's account first.
   * A financed contract gets a checkout that only collects the mandate, with no charge.
   * @param contract the contract waiting for its payment.
   * @returns the contract with its checkout.
   * @throws BusinessException if the product has no Stripe account.
   */
  private async _ensureCheckout(contract: Contract): Promise<Contract> {
    const expiresAt = contract.checkoutSessionExpiresAt;
    if (contract.checkoutSessionUrl && expiresAt && new Date(expiresAt).getTime() - Date.now() > CHECKOUT_MIN_HOURS_LEFT * 3_600_000) {
      return contract;
    }

    const { productId, id } = contract;
    const [product, plan, charges] = await Promise.all([
      this._loadProductsService().then(service => service.getProduct(productId)),
      this._loadPlansService().then(service => service.getPlan(productId, contract.planId)),
      this._loadOrdersService().then(service => service.getLineCharges(productId, contract.orderId)),
    ]);
    if (!product.stripeApiKey) {
      throw new BusinessException(`Product ${productId} has no Stripe account configured.`, 'PRODUCT_WITHOUT_STRIPE');
    }
    const stripeApiKey = product.stripeApiKey;
    const customerId = await this._ensureStripeCustomer(contract, stripeApiKey);

    const flow = charges.financing ? 'mandate' : 'payment';
    const checkout = {
      customerId,
      metadata: { purpose: CONTRACT_CHECKOUT_PURPOSE, contractId: id, productId, companyId: contract.companyId },
      successUrl: this._returnUrl(product.domain, `/${flow}-success`),
      cancelUrl: this._returnUrl(product.domain, `/${flow}-cancelled`),
      stripeApiKey,
    };
    const stripeService = await this._loadStripeService();
    // The period paid through the reseller is not charged again; a period ending within the trial Stripe allows is.
    const paidAhead = this._paidAhead(contract);
    const trialEnd = paidAhead && new Date(paidAhead).getTime() - Date.now() > CHECKOUT_MIN_TRIAL_HOURS * 3_600_000
      ? Math.floor(new Date(paidAhead).getTime() / 1000)
      : undefined;
    // The finance company paid the contract: the company only gives the mandate, for the seats beyond the financed ones.
    const session = charges.financing
      ? await stripeService.createMandateCheckoutSession(checkout)
      : await stripeService.createContractCheckoutSession({
        ...checkout,
        ...(await this._checkoutItems(contract, plan, charges, product.name, stripeApiKey)),
        taxRateId: product.stripeTaxRateId,
        ...(trialEnd && { trialEnd }),
      });
    const updated = await this._contractModel.update({ productId, id }, {
      stripeCustomerId: customerId,
      checkoutSessionUrl: session.url ?? undefined,
      checkoutSessionExpiresAt: new Date(session.expires_at * 1000).toISOString(),
    }, { return: 'item' });
    this._logger.log(`Checkout ${session.id} generated for contract ${contract.code}.`);
    return updated;
  }

  /**
   * Builds the page Stripe sends the company back to: the product's own, styled like the product, or Rocket's when the
   * product has no domain.
   * @param domain the domain of the product, such as `next.getgenio.it`.
   * @param path the return page, such as `/payment-success`.
   * @returns the absolute URL.
   */
  private _returnUrl(domain: string | undefined, path: string): string {
    if (!domain) {
      return rocketUrl(path);
    }
    return `${domain.startsWith('http') ? domain : `https://${domain}`}${path}`;
  }

  /**
   * Returns the Stripe customer of the company of a contract on the account of its product, creating it the first time.
   * @param contract the contract.
   * @param stripeApiKey the Stripe secret API key of the product.
   * @returns the customer ID.
   */
  private async _ensureStripeCustomer(contract: Contract, stripeApiKey: string): Promise<string> {
    const companiesService = await this._loadCompaniesService();
    const company = await companiesService.getCompany(contract.companyId, SYSTEM_SCOPE);
    const link = company.stripeAccounts?.find(item => item.accountKey === contract.productId);
    if (link?.customerId) {
      return link.customerId;
    }

    const address = company.legalAddress;
    const stripeService = await this._loadStripeService();
    const customer = await stripeService.createOrGetCustomer({
      email: company.email,
      name: company.name,
      ...(company.vatNumber && { vatNumber: /^[A-Z]{2}/.test(company.vatNumber) ? company.vatNumber : `IT${company.vatNumber}` }),
      ...(address && { address: { line1: address.street, city: address.city, postal_code: address.zipCode, state: address.province, country: address.country ?? 'IT' } }),
      stripeApiKey,
    });
    await companiesService.linkStripeAccount(company.id, { accountKey: contract.productId, customerId: customer.id });

    return customer.id;
  }

  /**
   * Prices the checkout of a contract. A checkout takes a single coupon, so only the recurring fee keeps the plan's
   * prices and the coupon of its discount, limited to the plan's product: seats and renewals then work as on a
   * subscription created by Rocket. The one-off items carry their amounts already discounted.
   * @param contract the contract.
   * @param plan the plan of the contract.
   * @param charges the charges of its order line.
   * @param productName the name of the product, for the customization.
   * @param stripeApiKey the Stripe secret API key of the product.
   * @returns the mode, the line items and the coupon of the checkout.
   */
  private async _checkoutItems(contract: Contract, plan: ResponsePlanDto, charges: LineCharges, productName: string, stripeApiKey: string): Promise<CheckoutItems> {
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    const discounted = (percent: number, cents: number | undefined, product: string | undefined): boolean =>
      percent > 0 && cents !== undefined && !!product;

    if (plan.type === PlanType.OneTime && plan.stripePriceIds?.[0]) {
      lineItems.push(discounted(charges.recurringDiscountPercent, charges.recurringCents, plan.stripeProductId)
        ? { price_data: { currency: 'eur', product: plan.stripeProductId, unit_amount: charges.recurringCents }, quantity: 1 }
        : { price: plan.stripePriceIds[0], quantity: 1 });
    }
    if (plan.stripeActivationPriceId) {
      lineItems.push(discounted(charges.activationDiscountPercent, charges.activationCents, plan.stripeActivationProductId)
        ? { price_data: { currency: 'eur', product: plan.stripeActivationProductId, unit_amount: charges.activationCents }, quantity: 1 }
        : { price: plan.stripeActivationPriceId, quantity: 1 });
    }
    if (plan.stripeAssistancePriceId) {
      lineItems.push({ price: plan.stripeAssistancePriceId, quantity: 1 });
    }
    const customization = charges.customization;
    const customizationProduct = { name: `Personalizzazione ${productName}` };
    if (customization?.oneOffCents) {
      lineItems.push({ price_data: { currency: 'eur', product_data: customizationProduct, unit_amount: customization.oneOffCents }, quantity: 1 });
    }
    if (plan.type === PlanType.OneTime) {
      return { mode: 'payment', lineItems };
    }

    lineItems.unshift(...this._recurringItems(plan, contract.seats));
    if (customization?.recurringIncreaseCents) {
      const interval = plan.billingInterval === BillingInterval.Monthly ? 'month' : 'year';
      lineItems.push({ price_data: { currency: 'eur', product_data: customizationProduct, unit_amount: customization.recurringIncreaseCents, recurring: { interval } }, quantity: 1 });
    }
    const stripeService = await this._loadStripeService();
    const couponId = charges.recurringDiscountPercent > 0 && plan.stripeProductId
      ? await stripeService.ensurePercentCoupon(charges.recurringDiscountPercent, stripeApiKey, [plan.stripeProductId])
      : undefined;
    return { mode: 'subscription', lineItems, ...(couponId && { couponId }) };
  }

  /**
   * Lists the recurring items of a contract on the Stripe prices of its plan: the volume price by seats and the base
   * fee, or the flat price.
   * @param plan the plan of the contract.
   * @param seats the seats of the contract.
   * @returns the items, without discount.
   */
  private _recurringItems(plan: ResponsePlanDto, seats: number): { price: string; quantity: number }[] {
    if (plan.type === PlanType.TieredVolume && plan.stripeVolumePriceId) {
      return [
        { price: plan.stripeVolumePriceId, quantity: seats },
        ...(plan.stripeBasePriceId ? [{ price: plan.stripeBasePriceId, quantity: 1 }] : []),
      ];
    }
    return plan.stripePriceIds?.[0] ? [{ price: plan.stripePriceIds[0], quantity: 1 }] : [];
  }

  /**
   * Reads the Stripe customer and mandate of the company of a contract on the account of its product.
   * @param contract the contract.
   * @returns the link, if the company is a customer there.
   */
  private async _stripeLinkOf(contract: Contract): Promise<{ customerId: string; paymentMethodId?: string } | undefined> {
    const companiesService = await this._loadCompaniesService();
    const company = await companiesService.getCompany(contract.companyId, SYSTEM_SCOPE);
    return company.stripeAccounts?.find(item => item.accountKey === contract.productId);
  }

  /**
   * Tells whether a contract waits for its payment to be set up: in force, paid by its company or financed, not
   * charged yet, and the company has no mandate on the account of the product. A financed contract needs the mandate
   * too, at 0 euro, for the seats beyond the financed ones. Until then the product blocks it and the referent cannot
   * accept it (UR-RK-019). A contract taking over a transferred one waits only once the period paid through the
   * reseller is over: the company keeps working meanwhile. Without Stripe there is no payment to set up.
   * @param contract the contract.
   * @param lineCharges the charges of its order line, when the caller has read them already.
   * @returns true when the company must complete the checkout.
   */
  private async _awaitsPayment(contract: Contract, lineCharges?: LineCharges): Promise<boolean> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      return false;
    }

    if (!IN_FORCE_STATUSES.includes(contract.status) || contract.resellerPath || contract.stripeSubscriptionId || this._paidAhead(contract)) {
      return false;
    }

    const charges = lineCharges
      ?? await (await this._loadOrdersService()).getLineCharges(contract.productId, contract.orderId);
    if (!charges.chargedToCompany && !charges.financing) {
      return false;
    }

    return !(await this._stripeLinkOf(contract))?.paymentMethodId;
  }

  /**
   * Starts charging a contract on the SEPA mandate of its company: a subscription with a coupon per discounted item, or
   * a single invoice on one-off plans. Without a mandate the checkout does it, and the dunning of the payment starts.
   * A financed contract is invoiced to the finance company, and the company still gives its mandate. A contract taking
   * over a transferred one is charged from the end of the period paid through the reseller, and dunned from there.
   * Without Stripe the company is not charged: only the invoice of the finance company is recorded.
   * @param productId the product of the contract.
   * @param id the contract ID.
   */
  async startBilling(productId: string, id: string): Promise<void> {
    const contract = await this._getVisibleContract(productId, id, SYSTEM_SCOPE);
    if (contract.stripeSubscriptionId || !IN_FORCE_STATUSES.includes(contract.status)) {
      return;
    }
    if (contract.resellerPath) {
      await this._invoiceReseller(contract, contract.startDate, true);
      return;
    }
    const ordersService = await this._loadOrdersService();
    const charges = await ordersService.getLineCharges(productId, contract.orderId);
    if (!charges.chargedToCompany && !charges.financing) {
      return;
    }
    if (charges.financing) {
      await this._invoiceFinancier(contract, charges, charges.financing);
    }
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      return;
    }
    const link = await this._stripeLinkOf(contract);
    if (!link?.paymentMethodId) {
      this._logger.log(`Contract ${id} waits for the checkout of company ${contract.companyId}.`);
      if (!contract.paymentDunningStep) {
        await this._contractSchedulerService.schedulePaymentDunning(productId, id, this._paymentDunningDate(contract, DunningStep.FirstReminder));
      }
      return;
    }
    // The finance company paid the contract: the mandate only serves the seats beyond the financed ones.
    if (charges.financing) {
      return;
    }

    const [product, plan] = await Promise.all([
      this._loadProductsService().then(service => service.getProduct(productId)),
      this._loadPlansService().then(service => service.getPlan(productId, contract.planId)),
    ]);
    if (!product.stripeApiKey) {
      throw new BusinessException(`Product ${productId} has no Stripe account configured.`, 'PRODUCT_WITHOUT_STRIPE');
    }
    const stripeApiKey = product.stripeApiKey;
    const stripeService = await this._loadStripeService();
    if (contract.stripeCustomerId !== link.customerId) {
      await this._contractModel.update({ productId, id }, { stripeCustomerId: link.customerId });
    }
    const discount = async (percent: number): Promise<{ discounts?: { coupon: string }[] }> =>
      percent > 0 ? { discounts: [{ coupon: await stripeService.ensurePercentCoupon(percent, stripeApiKey) }] } : {};

    const oneOff: Stripe.SubscriptionCreateParams.AddInvoiceItem[] = [];
    const recurring: Stripe.SubscriptionCreateParams.Item[] = [];
    if (plan.stripeActivationPriceId) {
      oneOff.push({ price: plan.stripeActivationPriceId, ...await discount(charges.activationDiscountPercent) });
    }
    if (plan.stripeAssistancePriceId) {
      oneOff.push({ price: plan.stripeAssistancePriceId });
    }
    const customization = charges.customization;
    const customizationProduct = customization?.oneOffCents || customization?.recurringIncreaseCents
      ? await stripeService.createProduct(`Personalizzazione ${product.name}`, stripeApiKey)
      : undefined;
    if (customizationProduct && customization?.oneOffCents) {
      oneOff.push({ price_data: { currency: 'eur', product: customizationProduct, unit_amount: customization.oneOffCents } });
    }

    const metadata = { contractId: id, productId };
    if (plan.type === PlanType.OneTime) {
      if (plan.stripePriceIds?.[0]) {
        oneOff.unshift({ price: plan.stripePriceIds[0], ...await discount(charges.recurringDiscountPercent) });
      }
      await stripeService.chargeOneOff({
        customerId: link.customerId, paymentMethodId: link.paymentMethodId, items: oneOff,
        taxRateId: product.stripeTaxRateId, metadata, idempotencyKey: `contract-${id}`, stripeApiKey,
      });
      this._logger.log(`One-off plan of contract ${id} charged.`);
      return;
    }

    const recurringDiscount = await discount(charges.recurringDiscountPercent);
    recurring.push(...this._recurringItems(plan, contract.seats).map(item => ({ ...item, ...recurringDiscount })));
    if (customizationProduct && customization?.recurringIncreaseCents) {
      const interval = plan.billingInterval === BillingInterval.Monthly ? 'month' : 'year';
      recurring.push({ price_data: { currency: 'eur', product: customizationProduct, unit_amount: customization.recurringIncreaseCents, recurring: { interval } }, quantity: 1 });
    }
    // The period paid through the reseller is not charged again: the subscription stays in trial until its end.
    const paidAhead = this._paidAhead(contract);
    const subscription = await stripeService.createSubscription({
      customerId: link.customerId, paymentMethodId: link.paymentMethodId, items: recurring, addInvoiceItems: oneOff,
      taxRateId: product.stripeTaxRateId, metadata, idempotencyKey: `contract-${id}`, stripeApiKey,
      ...(paidAhead && { trialEnd: Math.floor(new Date(paidAhead).getTime() / 1000) }),
    });
    await this.recordSubscription(productId, id, subscription.id);
  }

  /**
   * Records the cancellation of a contract; within the notice period the coming renewal still happens.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param scope the request scope.
   * @returns the contract, now terminating.
   * @throws BusinessException if the contract is not active or does not renew.
   * @throws AuthorizationException when a salesperson asks for a contract not of its orders, for a Keus one of its direct orders.
   */
  async terminateAtRenewal(productId: string, id: string, scope: RequestScope): Promise<ResponseContractDto> {
    try {
      const contract = await this._getVisibleContract(productId, id, scope);
      this._assertOwnContract(contract, scope);
      if (contract.status !== ContractStatus.Active) {
        throw new BusinessException(`Contract ${id} is ${contract.status}: only an active contract can be cancelled.`, 'CONTRACT_NOT_ACTIVE');
      }
      if (!contract.renewalDate) {
        throw new BusinessException(`Contract ${id} does not renew: it ends by itself.`, 'CONTRACT_NOT_RENEWING');
      }

      const inTime = new Date() < new Date(subtractDays(contract.renewalDate, contract.noticeDays));
      const terminationDate = inTime ? contract.renewalDate : addYears(contract.renewalDate, 1);
      if (inTime) {
        await this._contractSchedulerService.cancelRenewal(id);
        await this._contractSchedulerService.scheduleTermination(productId, id, terminationDate);
      }

      const updated = await this._contractModel.update(
        { productId, id },
        toDynamooseUpdate<Contract>(
          { status: ContractStatus.Terminating, terminationDate, terminationMonth: monthOf(terminationDate), cancelledAt: new Date().toISOString() },
          inTime ? ['renewalMonth'] : [],
        ),
        { condition: new Condition().where('status').eq(ContractStatus.Active), return: 'item' },
      );
      this._logger.log(`Contract ${id} terminating on ${terminationDate}${inTime ? '' : ', after the coming renewal'}.`);
      return this._toResponse(updated, scope);
    } catch (error) {
      throw this._wrap(error, `Error cancelling contract ${id}`, 'An error occurred while cancelling the contract.');
    }
  }

  /**
   * Withdraws the cancellation of a contract, which goes back to renewing as usual.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param scope the request scope.
   * @returns the contract, active again.
   * @throws BusinessException if the contract is not terminating, or is financed and ends with its financing.
   * @throws AuthorizationException when a salesperson asks for a contract not of its orders, for a Keus one of its direct orders.
   */
  async withdrawTermination(productId: string, id: string, scope: RequestScope): Promise<ResponseContractDto> {
    try {
      const contract = await this._getVisibleContract(productId, id, scope);
      this._assertOwnContract(contract, scope);
      if (contract.status !== ContractStatus.Terminating || !contract.renewalDate) {
        throw new BusinessException(`Contract ${id} has no cancellation to withdraw.`, 'CONTRACT_NOT_TERMINATING');
      }
      const ordersService = await this._loadOrdersService();
      if ((await ordersService.getLineCharges(productId, contract.orderId)).financing) {
        throw new BusinessException(`Contract ${id} is financed: it ends with its financing.`, 'CONTRACT_FINANCED');
      }

      await this._contractSchedulerService.cancelTermination(id);
      await this._contractSchedulerService.scheduleRenewal(productId, id, contract.renewalDate);
      const updated = await this._contractModel.update(
        { productId, id },
        toDynamooseUpdate<Contract>(
          { status: ContractStatus.Active, renewalMonth: monthOf(contract.renewalDate) },
          ['terminationDate', 'terminationMonth', 'cancelledAt'],
        ),
        { condition: new Condition().where('status').eq(ContractStatus.Terminating), return: 'item' },
      );
      this._logger.log(`Cancellation of contract ${id} withdrawn.`);
      return this._toResponse(updated, scope);
    } catch (error) {
      throw this._wrap(error, `Error withdrawing the cancellation of contract ${id}`, 'An error occurred while withdrawing the cancellation.');
    }
  }

  /**
   * Terminates a contract at once, by decision of an operator.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param scope the request scope.
   * @returns the terminated contract.
   * @throws BusinessException if the contract is already terminated.
   */
  async terminateNow(productId: string, id: string, scope: RequestScope): Promise<ResponseContractDto> {
    try {
      const contract = await this._getVisibleContract(productId, id, scope);
      if (!IN_FORCE_STATUSES.includes(contract.status)) {
        throw new BusinessException(`Contract ${id} is already terminated.`, 'CONTRACT_TERMINATED');
      }

      return plainToInstance(ResponseContractDto, await this._terminate(contract));
    } catch (error) {
      throw this._wrap(error, `Error terminating contract ${id}`, 'An error occurred while terminating the contract.');
    }
  }

  /**
   * Terminates the indirect contract of a company moving from its inactive reseller to Keus (UR-RK-105), for a direct
   * contract to take over on the same tenant: the tenant stays active, and the period already invoiced to the reseller
   * stays its own. A contract already terminated is returned as it is, so a transfer can be repeated.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @returns the contract, terminated, with the end of the period invoiced to the reseller as it was.
   * @throws EntityNotFoundException if the contract does not exist.
   */
  async terminateForTransfer(productId: string, id: string): Promise<Contract> {
    const contract = await this._getVisibleContract(productId, id, SYSTEM_SCOPE);
    if (!IN_FORCE_STATUSES.includes(contract.status)) {
      return contract;
    }
    await this._terminate(contract, ContractTerminationReason.Transfer);
    return contract;
  }

  /**
   * Handles a scheduled event of a contract: the renewal extends it by one year (on a financed contract the anniversary
   * charges a year of the seats beyond the financed ones), the termination ends it, the billing
   * invoices the next period to the reseller, the renewal notice tells whoever pays that the renewal is near, the
   * payment dunning reminds the company of a payment never set up and finally suspends it, the seat billing invoices
   * the seats added during the day.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param event the scheduled event.
   */
  async handleScheduledEvent(productId: string, id: string, event: ContractEvent): Promise<void> {
    const contract = await this._contractModel.get({ productId, id });
    if (!contract || !IN_FORCE_STATUSES.includes(contract.status)) {
      this._logger.warn(`Scheduled ${event} of contract ${id} skipped: the contract is missing or terminated.`);
      return;
    }
    if (event === ContractEvent.Terminate) {
      await this._terminate(contract);
      return;
    }
    if (event === ContractEvent.Bill) {
      await this._billNextPeriod(contract);
      return;
    }
    if (event === ContractEvent.RenewalNotice) {
      await this._noticeRenewal(contract);
      return;
    }
    if (event === ContractEvent.PaymentDunning) {
      await this._runPaymentDunningStep(contract);
      return;
    }
    if (event === ContractEvent.SeatBilling) {
      await this._billSeats(productId, id);
      return;
    }
    if (!contract.renewalDate) {
      this._logger.warn(`Scheduled renewal of contract ${id} skipped: the contract does not renew.`);
      return;
    }
    // The scheduler delivers at least once: a renewal already done has moved the date into the future.
    if (new Date(contract.renewalDate).getTime() > Date.now()) {
      this._logger.log(`Scheduled renewal of contract ${id} skipped: already renewed until ${contract.renewalDate}.`);
      return;
    }

    const renewalDate = addYears(contract.renewalDate, 1);
    // A late cancellation lets this renewal happen and ends the contract at the next date; a financed contract passes
    // its anniversaries until its financing ends.
    if (contract.status === ContractStatus.Terminating) {
      const terminationDate = contract.terminationDate ?? renewalDate;
      // The year is charged before the date moves on: a failed charge leaves the anniversary to the next delivery, and
      // the charge is fixed by the anniversary, so two deliveries bill it once.
      const yearCharge = await this._financedYearCharge(contract, renewalDate < terminationDate ? renewalDate : terminationDate);
      if (yearCharge) {
        await this._chargeSeats(contract, yearCharge);
      }
      try {
        await this._contractModel.update(
          { productId, id },
          toDynamooseUpdate<Contract>({ renewalDate }, ['renewalMonth']),
          { condition: new Condition().where('renewalDate').eq(contract.renewalDate), return: 'item' },
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          this._logger.log(`Scheduled renewal of contract ${id} skipped: another delivery renewed it.`);
          return;
        }
        throw error;
      }
      if (yearCharge) {
        await this._noticeSeatCharge(contract, yearCharge);
      }
      if (renewalDate < terminationDate) {
        await this._contractSchedulerService.scheduleRenewal(productId, id, renewalDate);
      } else {
        await this._contractSchedulerService.scheduleTermination(productId, id, terminationDate);
      }
    } else {
      await this._contractModel.update({ productId, id }, { renewalDate, renewalMonth: monthOf(renewalDate) });
      await this._contractSchedulerService.scheduleRenewal(productId, id, renewalDate);
    }
    this._logger.log(`Contract ${id} renewed until ${renewalDate}.`);
  }

  /**
   * Runs the next step of the dunning of a contract whose payment is not set up, as for an unpaid invoice (UR-RK-156,
   * UR-RK-157): reminders on the 5th and 10th day from the start, the notice on the 14th, the suspension on the 15th.
   * @param contract the contract, in force.
   */
  private async _runPaymentDunningStep(contract: Contract): Promise<void> {
    if (!(await this._awaitsPayment(contract))) {
      this._logger.log(`Payment of contract ${contract.code} is set up: the dunning ends.`);
      return;
    }
    const steps = Object.values(DunningStep);
    const step = steps[contract.paymentDunningStep ? steps.indexOf(contract.paymentDunningStep) + 1 : 0];
    if (!step) {
      return;
    }
    const postponed = contract.suspensionPostponedUntil;
    if (step === DunningStep.Suspension && postponed && new Date(postponed) > new Date()) {
      await this._contractSchedulerService.schedulePaymentDunning(contract.productId, contract.id, postponed);
      this._logger.log(`Suspension of contract ${contract.code} postponed until ${postponed}.`);
      return;
    }

    if (step === DunningStep.Suspension) {
      await this.suspendAccess(contract.productId, contract.id, { paymentNotSetUp: true });
    } else {
      const suspensionDate = formatDate(this._paymentSuspensionDate(contract));
      const notice = step === DunningStep.SuspensionNotice;
      const checkoutUrl = await this._checkoutUrlForNotice(contract);
      await this._contractNoticesService.toCompany(contract, MailTemplate.CompanyPaymentSetupReminder, {
        reminder: steps.indexOf(step) + 1,
        ...(notice && { suspensionDate }),
        ...(checkoutUrl && { checkoutUrl }),
      });
    }
    await this._contractModel.update({ productId: contract.productId, id: contract.id }, { paymentDunningStep: step });
    const next = steps[steps.indexOf(step) + 1];
    if (next) {
      await this._contractSchedulerService.schedulePaymentDunning(contract.productId, contract.id, this._paymentDunningDate(contract, next));
    }
  }

  /**
   * Computes the date of a step of the dunning of a payment not set up, in days from the start of the contract, or
   * from the end of the period paid through the reseller on a contract taking over a transferred one.
   * @param contract the contract.
   * @param step the step.
   * @returns the date of the step (ISO string).
   */
  private _paymentDunningDate(contract: Contract, step: DunningStep): string {
    const date = new Date(contract.paidUntil ?? contract.startDate);
    date.setUTCDate(date.getUTCDate() + DUNNING_DAYS[step]);
    return date.toISOString();
  }

  /**
   * Computes when a contract whose payment is not set up loses its access: the fifteenth day, or the postponement.
   * @param contract the contract.
   * @returns the date of the suspension.
   */
  private _paymentSuspensionDate(contract: Contract): Date {
    const day = new Date(this._paymentDunningDate(contract, DunningStep.Suspension));
    const postponed = contract.suspensionPostponedUntil;
    return postponed && new Date(postponed) > day ? new Date(postponed) : day;
  }

  /**
   * Reads the end of the period a contract taking over a transferred one has already paid, while it is still ahead.
   * @param contract the contract.
   * @returns the end of the period paid (ISO string), or undefined when there is none or it is over.
   */
  private _paidAhead(contract: Contract): string | undefined {
    return contract.paidUntil && new Date(contract.paidUntil).getTime() > Date.now() ? contract.paidUntil : undefined;
  }

  /**
   * Records the Stripe subscription that charges a contract, the first time it is seen.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param subscriptionId the Stripe subscription ID.
   */
  async recordSubscription(productId: string, id: string, subscriptionId: string): Promise<void> {
    try {
      await this._contractModel.update(
        { productId, id },
        { stripeSubscriptionId: subscriptionId },
        { condition: new Condition().where('stripeSubscriptionId').not().exists(), return: 'item' },
      );
      this._logger.log(`Assigned subscription ${subscriptionId} to contract ${id}.`);
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return;
      }

      throw this._wrap(error, `Error recording the subscription of contract ${id}`, 'An error occurred while recording the subscription.');
    }
  }

  /**
   * Records the end of the period the Stripe subscription of a direct contract has paid, shown as paid until and as the
   * next charge. Stripe may deliver the invoices out of order, or the same one twice: only a later end is written.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param paidUntil the end of the period paid (ISO string).
   */
  async recordSubscriptionPaidUntil(productId: string, id: string, paidUntil: string): Promise<void> {
    try {
      await this._contractModel.update(
        { productId, id },
        { subscriptionPaidUntil: paidUntil },
        { condition: new Condition().where('subscriptionPaidUntil').not().exists().or().where('subscriptionPaidUntil').lt(paidUntil), return: 'item' },
      );
      this._logger.log(`Contract ${id} paid until ${paidUntil}.`);
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return;
      }

      throw this._wrap(error, `Error recording the period paid of contract ${id}`, 'An error occurred while recording the period paid.');
    }
  }

  /**
   * Records that the tenant of a contract reached more active users than its seats (UR-RK-401): the seats become the
   * new count, which never goes down, and the renewal amount and the subscription on Stripe follow at once. The
   * proration is not charged here: the increases of a day make one invoice, billed at its end (`_billSeats`). An
   * increase that costs nothing, or one on a contract nobody charges yet, counts as invoiced at once: a direct contract
   * not charged yet pays the new seats with its first charge.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param seats the active users the tenant reached.
   */
  async recordSeatIncrease(productId: string, id: string, seats: number): Promise<void> {
    // Concurrent sign-ups raise the seats one after the other: each write holds on the seats it read.
    for (let attempt = 0; attempt < 3; attempt++) {
      const contract = await this._getVisibleContract(productId, id, SYSTEM_SCOPE);
      if (seats <= contract.seats || !IN_FORCE_STATUSES.includes(contract.status)) {
        return;
      }
      const variation = await this._seatVariation(contract, seats);
      const now = new Date().toISOString();
      // With nothing waiting to be invoiced, a billable increase starts the proration of the day.
      const waiting = contract.invoicedSeats < contract.seats;
      const event = { ...new SeatEvent(now, SeatEventKind.SeatsAdded, seats, seats) };

      try {
        await this._contractModel.update(
          { productId, id },
          {
            $SET: {
              seats,
              ...(variation.renewalAmountCents !== undefined && { renewalAmountCents: variation.renewalAmountCents }),
              ...(!waiting && (variation.billable ? { seatsChangedAt: now } : { invoicedSeats: seats })),
            },
            $ADD: { seatEvents: [event] },
          },
          { condition: new Condition().where('seats').eq(contract.seats).and().where('invoicedSeats').eq(contract.invoicedSeats), return: 'item' },
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) continue;
        throw this._wrap(error, `Error recording the seats of contract ${id}`, 'An error occurred while recording the seats of the contract.');
      }
      this._logger.log(`Contract ${contract.code} now has ${seats} seats${variation.billable ? ', proration billed at the end of the day' : ''}.`);

      if (variation.subscription) {
        try {
          await this._updateStripeSeats(contract, variation.subscription);
        } catch (error) {
          // The seats are recorded: Stripe stays behind until the next variation, and the renewal charges the old ones.
          this._logger.error(`Stripe subscription of contract ${contract.code} not moved to ${seats} seats`, error);
        }
      }
      if (variation.billable) {
        try {
          await this._contractSchedulerService.scheduleSeatBilling(productId, id, `${now.slice(0, 10)}T23:59:00.000Z`);
        } catch (error) {
          this._logger.error(`Billing of the seats of contract ${contract.code} not scheduled`, error);
        }
      }
      return;
    }
    this._logger.warn(`Seats of contract ${id} kept changing; variation to ${seats} seats not recorded.`);
  }

  /**
   * Brings the contract of a tenant up to the active users it reached before the contract existed, during the
   * provisioning of its order line.
   * @param contract the contract just created.
   */
  async catchUpSeats(contract: Contract): Promise<void> {
    const tenantsService = await this._loadTenantsService();
    const tenant = await tenantsService.getTenant(contract.productId, contract.tenantId, SYSTEM_SCOPE);
    if (tenant.maxConstraintValue > contract.seats) {
      await this.recordSeatIncrease(contract.productId, contract.id, tenant.maxConstraintValue);
    }
  }

  /**
   * Builds the write that records on a contract a user deleted from its tenant (UR-RK-403), for the transaction that
   * gives back the user's seat. The seats billed stay where they are.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param users the active users left on the tenant.
   * @param seats the seats of the tenant.
   * @returns the transaction write.
   */
  userRemovedWrite(productId: string, id: string, users: number, seats: number): TransactionWrite {
    const event = { ...new SeatEvent(new Date().toISOString(), SeatEventKind.UserRemoved, users, seats) };
    return this._contractModel.transaction.update({ productId, id }, { $ADD: { seatEvents: [event] } });
  }

  /**
   * Bills the seats a contract added and did not invoice yet, at the end of the day of the increases (UR-RK-401,
   * UR-RK-402): one invoice on the difference of the fee between the seats invoiced and the seats reached, prorated
   * from the first increase to the end of its period, and the communication to whoever pays it. The seats are claimed
   * before the charge, so a second delivery of the event charges nothing; a failed charge gives them back and is tried
   * again the next day.
   * @param productId the product of the contract.
   * @param id the contract ID.
   */
  private async _billSeats(productId: string, id: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const contract = await this._getVisibleContract(productId, id, SYSTEM_SCOPE);
      if (contract.seats <= contract.invoicedSeats) {
        this._logger.log(`Seats of contract ${contract.code} already invoiced.`);
        return;
      }
      const charge = await this._seatCharge(contract);

      try {
        await this._contractModel.update(
          { productId, id },
          toDynamooseUpdate<Contract>({ invoicedSeats: contract.seats }, ['seatsChangedAt']),
          { condition: new Condition().where('seats').eq(contract.seats).and().where('invoicedSeats').eq(contract.invoicedSeats), return: 'item' },
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) continue;
        throw this._wrap(error, `Error claiming the seats of contract ${id}`, 'An error occurred while billing the seats of the contract.');
      }
      if (!charge) {
        this._logger.log(`Seats of contract ${contract.code} up to ${contract.seats} counted as invoiced: nothing to charge.`);
        return;
      }

      try {
        await this._chargeSeats(contract, charge);
      } catch (error) {
        this._logger.error(`Proration of contract ${contract.code} up to ${contract.seats} seats not charged; tried again tomorrow`, error);
        await this._giveBackSeats(contract);
        return;
      }
      await this._noticeSeatCharge(contract, charge);
      return;
    }
    this._logger.warn(`Seats of contract ${id} kept changing; their billing is left to the next increase.`);
  }

  /**
   * Gives back to a contract the seats claimed by a charge that failed, with the date of their first increase, and
   * schedules the billing again for the next day.
   * @param contract the contract as read before the claim.
   */
  private async _giveBackSeats(contract: Contract): Promise<void> {
    try {
      await this._contractModel.update(
        { productId: contract.productId, id: contract.id },
        { invoicedSeats: contract.invoicedSeats, ...(contract.seatsChangedAt && { seatsChangedAt: contract.seatsChangedAt }) },
        { condition: new Condition().where('invoicedSeats').eq(contract.seats), return: 'item' },
      );

      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await this._contractSchedulerService.scheduleSeatBilling(contract.productId, contract.id, tomorrow);
    } catch (error) {
      this._logger.error(`Seats of contract ${contract.code} not given back after a failed charge: check its invoices`, error);
    }
  }

  /**
   * Computes the proration of the seats a contract added beyond the ones invoiced: the difference of the fee per
   * period, taken from the line with its discount or margin (`getLineCharges`), for the time from the first increase to
   * the end of the period it fell in. A period started since then is already charged on the new seats: Stripe has the
   * new quantity, and the reseller is billed on the seats of the contract. One charge covers every tier crossed.
   * @param contract the contract.
   * @returns the charge, or none when the seats cost nothing more or nobody charges the contract yet.
   */
  private async _seatCharge(contract: Contract): Promise<SeatCharge | undefined> {
    const ordersService = await this._loadOrdersService();
    const [before, after] = await Promise.all([
      ordersService.getLineCharges(contract.productId, contract.orderId, contract.invoicedSeats),
      ordersService.getLineCharges(contract.productId, contract.orderId, contract.seats),
    ]);
    // A financed contract pays only the seats beyond the financed ones, each at the price of its own tier.
    const financed = after.financing;
    const deltaCents = financed
      ? (financed.extraSeatsCents ?? 0) - (before.financing?.extraSeatsCents ?? 0)
      : (after.recurringCents ?? 0) - (before.recurringCents ?? 0);
    if (deltaCents <= 0) {
      return undefined;
    }

    const plansService = await this._loadPlansService();
    const plan = await plansService.getPlan(contract.productId, contract.planId);
    const months = plan.billingInterval === BillingInterval.Monthly ? 1 : 12;
    const since = contract.seatsChangedAt ?? new Date().toISOString();

    // Who pays: the reseller period by period, the company on its subscription, or on its mandate year by year when
    // the contract is financed.
    let period: { start: string; end: string } | undefined;
    let periodDeltaCents = deltaCents;
    if (contract.resellerPath && contract.nextBillingDate) {
      period = this._periodAround(contract.nextBillingDate, since, months);
    } else if (!contract.resellerPath && contract.stripeSubscriptionId) {
      const stripeService = await this._loadStripeService();
      const subscription = { subscriptionId: contract.stripeSubscriptionId, plan, stripeApiKey: await this._stripeApiKeyOf(contract.productId) };
      const current = await stripeService.getSeatsPeriod(subscription);
      period = since >= current.start ? current : { start: addMonths(current.start, -months), end: current.start };
    } else if (financed) {
      const end = contract.renewalDate ?? contract.terminationDate;
      period = end ? this._periodAround(end, since, 12) : undefined;
      periodDeltaCents = deltaCents * (12 / months);
    }
    if (!period) {
      return undefined;
    }

    const periodMs = new Date(period.end).getTime() - new Date(period.start).getTime();
    const leftMs = Math.max(0, new Date(period.end).getTime() - new Date(since).getTime());
    const amountCents = Math.round(periodDeltaCents * leftMs / periodMs);
    if (amountCents <= 0) {
      return undefined;
    }

    // The customer of a reseller pays the same days at its own price.
    const customerDeltaCents = (after.customer?.recurringCents ?? 0) - (before.customer?.recurringCents ?? 0);
    return {
      prorationId: uuidv5(`${contract.id}#seats#${contract.seats}`, PRORATION_NAMESPACE),
      channel: contract.resellerPath ? SalesChannel.Reseller : SalesChannel.Direct,
      description: `Variazione postazioni da ${contract.invoicedSeats} a ${contract.seats}, fino al ${formatDate(period.end)}`,
      seatsFrom: contract.invoicedSeats,
      seatsTo: contract.seats,
      periodStart: since,
      periodEnd: period.end,
      amountCents,
      ...(contract.resellerPath && { customerAmountCents: Math.max(0, Math.round(customerDeltaCents * leftMs / periodMs)) }),
    };
  }

  /**
   * Finds the period of a fixed length that contains a date, walking back from one of its boundaries.
   * @param boundary the end of the current period (ISO string).
   * @param at the date (ISO string).
   * @param months the length of the period, in months.
   * @returns the start and end of the period.
   */
  private _periodAround(boundary: string, at: string, months: number): { start: string; end: string } {
    let end = boundary;
    while (addMonths(end, -months) > at) {
      end = addMonths(end, -months);
    }
    return { start: addMonths(end, -months), end };
  }

  /**
   * Charges a charge of seats to whoever pays it: on the indirect channel the reseller is invoiced and charged on the
   * 4th of the next month; otherwise Stripe charges the company at once on its mandate and the webhook records the
   * invoice. Both find the invoice already recorded by `prorationId`.
   * @param contract the contract.
   * @param charge the charge.
   * @throws BusinessException if the company has no mandate on the product's account.
   */
  private async _chargeSeats(contract: Contract, charge: SeatCharge): Promise<void> {
    const invoicesService = await this._loadInvoicesService();

    if (charge.channel === SalesChannel.Reseller) {
      const sellerCode = (contract.resellerPath ?? '').split('#').filter(Boolean).pop() ?? '';
      const resellersService = await this._loadResellersService();
      const reseller = await resellersService.getResellerByCode(sellerCode);
      if (!reseller) {
        throw new EntityNotFoundException('Reseller', sellerCode);
      }
      const salesId = await this._salesIdOf(contract);

      const chargeMonth = monthOf(addMonths(new Date().toISOString(), 1));
      const invoice = await invoicesService.issueManualInvoice({
        billedPartyId: reseller.id,
        billedPartyType: BilledPartyType.Reseller,
        billedParty: billedPartyOf(reseller),
        channel: SalesChannel.Reseller,
        vatRatePercent: await this._vatRateOf(contract.productId),
        dueDate: `${chargeMonth}-04T00:00:00.000Z`,
        items: [{ description: charge.description, amountCents: charge.amountCents, orderId: contract.orderId, productId: contract.productId }],
        orderId: contract.orderId,
        lineProductId: contract.productId,
        contractId: contract.id,
        stripeAccount: contract.productId,
        prorationId: charge.prorationId,
        toChargeMonth: chargeMonth,
      });
      await this._recordCustomerShare(contract, invoice, salesId, charge.description, charge.periodStart, charge.periodEnd, charge.customerAmountCents ?? 0);

      this._logger.log(`Proration ${charge.prorationId} of contract ${contract.code} invoiced to reseller ${reseller.code}, charged in ${chargeMonth}.`);
      return;
    }

    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      this._logger.log(`Proration ${charge.prorationId} of contract ${contract.code} not charged: Stripe is off.`);
      return;
    }

    // The webhook records the Stripe invoice: a charge seen there is not charged again once the idempotency key expired.
    const already = (await invoicesService.getInvoicesOfContract(contract.id)).find(invoice => invoice.prorationId === charge.prorationId);
    if (already) {
      this._logger.log(`Proration ${charge.prorationId} of contract ${contract.code} already charged as invoice ${already.id}.`);
      return;
    }

    const companiesService = await this._loadCompaniesService();
    const company = await companiesService.getCompany(contract.companyId, SYSTEM_SCOPE);
    const link = company.stripeAccounts?.find(item => item.accountKey === contract.productId);
    if (!link?.paymentMethodId) {
      throw new BusinessException(`Company ${company.id} has no mandate on the account of product ${contract.productId}.`, 'COMPANY_WITHOUT_MANDATE');
    }

    const productsService = await this._loadProductsService();
    const product = await productsService.getProduct(contract.productId);
    const stripeApiKey = await this._stripeApiKeyOf(contract.productId);
    const stripeService = await this._loadStripeService();
    const stripeProduct = await stripeService.createProduct(charge.description, stripeApiKey);
    const invoice = await stripeService.chargeOneOff({
      customerId: link.customerId,
      paymentMethodId: link.paymentMethodId,
      items: [{ price_data: { currency: 'eur', product: stripeProduct, unit_amount: charge.amountCents } }],
      taxRateId: product.stripeTaxRateId,
      metadata: { contractId: contract.id, productId: contract.productId, prorationId: charge.prorationId },
      idempotencyKey: `proration-${charge.prorationId}`,
      stripeApiKey,
    });

    this._logger.log(`Proration ${charge.prorationId} of contract ${contract.code} charged with Stripe invoice ${invoice.id}.`);
  }

  /**
   * Tells whoever pays a charge of seats what it bills (UR-RK-402): the company through its product, or the reseller on
   * the indirect channel, with the seats, the amount and the renewal. A failed notice ends in the log.
   * @param contract the contract.
   * @param charge the charge just billed.
   */
  private async _noticeSeatCharge(contract: Contract, charge: SeatCharge): Promise<void> {
    const facts = {
      seatsFrom: charge.seatsFrom,
      seatsTo: charge.seatsTo,
      proratedAmount: formatEuro(charge.amountCents),
      periodEnd: formatDate(charge.periodEnd),
      renewalAmount: contract.renewalAmountCents !== undefined ? formatEuro(contract.renewalAmountCents) : '',
      renewalDate: contract.renewalDate ? formatDate(contract.renewalDate) : '',
    };

    if (charge.channel === SalesChannel.Reseller) {
      await this._contractNoticesService.toReseller(contract, MailTemplate.SeatVariation, facts);
      return;
    }
    await this._contractNoticesService.toCompany(contract, MailTemplate.CompanySeatVariation, facts);
  }

  /**
   * Computes what a seat increase changes on a contract at once: the new renewal amount, the subscription to bring to
   * the new seats, and whether a proration is due. A plan not priced by seats changes nothing.
   * @param contract the contract.
   * @param seats the new seats.
   * @returns the new renewal amount, the subscription, and whether the increase is billable.
   */
  private async _seatVariation(contract: Contract, seats: number): Promise<SeatVariation> {
    const ordersService = await this._loadOrdersService();
    const [before, after] = await Promise.all([
      ordersService.getLineCharges(contract.productId, contract.orderId, contract.seats),
      ordersService.getLineCharges(contract.productId, contract.orderId, seats),
    ]);
    // A financed contract pays only the seats beyond the financed ones, each at the price of its own tier.
    const financed = after.financing;
    const deltaCents = financed
      ? (financed.extraSeatsCents ?? 0) - (before.financing?.extraSeatsCents ?? 0)
      : (after.recurringCents ?? 0) - (before.recurringCents ?? 0);
    if (deltaCents <= 0) {
      return { billable: false };
    }

    const plansService = await this._loadPlansService();
    const plan = await plansService.getPlan(contract.productId, contract.planId);
    const yearlyFactor = plan.billingInterval === BillingInterval.Monthly ? 12 : 1;
    const renewalAmountCents = !contract.renewalDate
      ? undefined
      : financed
        ? (financed.extraSeatsCents ?? 0) * yearlyFactor
        : ((after.recurringCents ?? 0) + (after.customization?.recurringIncreaseCents ?? 0)) * yearlyFactor;

    // Someone pays a proration when the reseller is billed period by period, the company has its subscription, or the
    // contract is financed; a direct contract not charged yet pays the new seats with its first charge.
    const subscription = !contract.resellerPath && contract.stripeSubscriptionId
      ? { subscriptionId: contract.stripeSubscriptionId, plan, stripeApiKey: await this._stripeApiKeyOf(contract.productId) }
      : undefined;
    const billable = !!(contract.resellerPath && contract.nextBillingDate) || !!subscription || !!financed;
    return { renewalAmountCents, subscription, billable };
  }

  /**
   * Builds the charge of the year that starts at an anniversary of a financed contract: a full year of the fee of the
   * seats beyond the financed ones, its renewal amount. It is always a charge of its own, so that its period does not
   * mix with a proration of the year before.
   * @param contract the contract at its anniversary.
   * @param periodEnd the end of the year: the next anniversary, or the end of the financing.
   * @returns the charge, or none when the contract is not financed or has no seats beyond.
   */
  private async _financedYearCharge(contract: Contract, periodEnd: string): Promise<SeatCharge | undefined> {
    if (!contract.renewalAmountCents) {
      return undefined;
    }

    const ordersService = await this._loadOrdersService();
    const { financing } = await ordersService.getLineCharges(contract.productId, contract.orderId);
    if (!financing) {
      return undefined;
    }

    const seatsFrom = financing.seats ?? 0;
    return {
      prorationId: uuidv5(`${contract.id}#financed#${contract.renewalDate}`, PRORATION_NAMESPACE),
      channel: SalesChannel.Direct,
      description: `Postazioni oltre le ${seatsFrom} finanziate (${contract.seats} in tutto), fino al ${formatDate(periodEnd)}`,
      seatsFrom,
      seatsTo: contract.seats,
      periodStart: contract.renewalDate ?? periodEnd,
      periodEnd,
      amountCents: contract.renewalAmountCents,
    };
  }

  /**
   * Brings the subscription of a contract to the seats it has now, read again so that a later increase wins.
   * @param contract the contract.
   * @param subscription the subscription, its plan and the account.
   */
  private async _updateStripeSeats(contract: Contract, subscription: NonNullable<SeatVariation['subscription']>): Promise<void> {
    const current = await this._getVisibleContract(contract.productId, contract.id, SYSTEM_SCOPE);
    const stripeService = await this._loadStripeService();
    await stripeService.updateSeats({ ...subscription, seats: current.seats });
  }

  /**
   * Takes access away from the tenant of a contract for an unpaid invoice (UR-RK-157), at the fifteenth day or when the
   * administration decides: the contract stays in force and keeps the mark of the suspension, and the company and the
   * administration are told. A tenant already inactive for another reason is left alone and not marked.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param cause the unpaid invoice or the payment never set up behind the suspension, absent when by hand.
   * @param scope the request scope.
   * @returns the contract.
   * @throws BusinessException if the contract is sold by a reseller: an unpaid reseller suspends nothing.
   */
  async suspendAccess(productId: string, id: string, cause?: SuspensionCause, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseContractDto> {
    try {
      const contract = await this._getVisibleContract(productId, id, scope);
      this._assertDirect(contract);
      if (!IN_FORCE_STATUSES.includes(contract.status) || contract.accessSuspendedAt
        || !(await this._setTenantStatus(contract, TenantStatus.Active, TenantStatus.Inactive))) {
        return plainToInstance(ResponseContractDto, contract);
      }
      const suspended = await this._contractModel.update(
        { productId, id },
        toDynamooseUpdate<Contract>({ accessSuspendedAt: new Date().toISOString() }, ['suspensionPostponedUntil']),
        { return: 'item' },
      );
      const invoice = cause && 'invoice' in cause ? cause.invoice : undefined;
      const paymentNotSetUp = !!cause && 'paymentNotSetUp' in cause;
      this._logger.log(`Access of contract ${contract.code} suspended${invoice ? ` for invoice ${invoice.number ?? ''}` : paymentNotSetUp ? ' for the payment never set up' : ' by hand'}.`);

      const facts = invoice ? { invoiceNumber: invoice.number ?? '', amount: formatEuro(invoice.amountCents) } : {};
      // Its users are inactive now: the referent pays from the link of the email, not from the product.
      const checkoutUrl = paymentNotSetUp ? await this._checkoutUrlForNotice(contract) : undefined;
      await this._contractNoticesService.toCompany(contract, MailTemplate.CompanyAccessSuspended, {
        ...facts,
        ...(paymentNotSetUp && { paymentNotSetUp }),
        ...(checkoutUrl && { checkoutUrl }),
      });
      await this._contractNoticesService.toAccounting(MailTemplate.AccessSuspended, facts, contract);
      return plainToInstance(ResponseContractDto, suspended);
    } catch (error) {
      throw this._wrap(error, `Error suspending the access of contract ${id}`, 'An error occurred while suspending the access of the contract.');
    }
  }

  /**
   * Gives access back to the tenant of a contract in force, only if an unpaid invoice took it (UR-RK-158): at the
   * collection, or when the administration decides, as for an agreed payment. The administration's choice also stops
   * the dunning of the contract's unpaid invoices, so they do not suspend it again. The company and the administration
   * are told.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param byHand whether the administration restores it, before any collection.
   * @param scope the request scope.
   * @returns the contract.
   */
  async restoreAccess(productId: string, id: string, byHand = false, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseContractDto> {
    try {
      const contract = await this._getVisibleContract(productId, id, scope);
      if (!IN_FORCE_STATUSES.includes(contract.status) || !contract.accessSuspendedAt) {
        return plainToInstance(ResponseContractDto, contract);
      }
      await this._setTenantStatus(contract, TenantStatus.Inactive, TenantStatus.Active);
      const restored = await this._contractModel.update({ productId, id }, toDynamooseUpdate<Contract>({}, ['accessSuspendedAt']), { return: 'item' });
      if (byHand) {
        const invoicesService = await this._loadInvoicesService();
        await invoicesService.stopDunningOfContract(id);
        await this._contractSchedulerService.cancelPaymentDunning(id);
      }
      this._logger.log(`Access of contract ${contract.code} restored${byHand ? ' by hand' : ''}.`);

      await this._contractNoticesService.toCompany(contract, MailTemplate.CompanyAccessRestored, {});
      await this._contractNoticesService.toAccounting(MailTemplate.AccessRestored, { byHand }, contract);
      return plainToInstance(ResponseContractDto, restored);
    } catch (error) {
      throw this._wrap(error, `Error restoring the access of contract ${id}`, 'An error occurred while restoring the access of the contract.');
    }
  }

  /**
   * Postpones the suspension of a contract's access for an unpaid invoice to a date (UR-RK-157): an explicit choice of
   * the administration on this contract. The fifteenth day of the dunning then waits for that date.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param until the date the suspension waits for (ISO string).
   * @param scope the request scope.
   * @returns the updated contract.
   * @throws BusinessException if the contract is sold by a reseller, or no longer in force.
   */
  async postponeSuspension(productId: string, id: string, until: string, scope: RequestScope): Promise<ResponseContractDto> {
    try {
      this._assertDirect(await this._getVisibleContract(productId, id, scope));

      const updated = await this._contractModel.update(
        { productId, id },
        { suspensionPostponedUntil: new Date(until).toISOString() },
        { condition: new Condition().where('status').in(IN_FORCE_STATUSES), return: 'item' },
      );
      this._logger.log(`Suspension of contract ${id} postponed until ${until}.`);
      return plainToInstance(ResponseContractDto, updated);
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new BusinessException(`Contract ${id} is no longer in force: there is no suspension to postpone.`, 'CONTRACT_NOT_IN_FORCE');
      }

      throw this._wrap(error, `Error postponing the suspension of contract ${id}`, 'An error occurred while postponing the suspension.');
    }
  }

  /**
   * Refuses the suspension of a contract sold by a reseller: on the indirect channel the unpaid invoices are the
   * reseller's, and they never take the access of its customers (UR-RK-101, UR-RK-157).
   * @param contract the contract.
   * @throws BusinessException if the contract is sold by a reseller.
   */
  private _assertDirect(contract: Contract): void {
    if (contract.resellerPath) {
      throw new BusinessException(`Contract ${contract.code} is sold by a reseller: its access is never suspended for an unpaid invoice.`, 'CONTRACT_INDIRECT');
    }
  }

  /**
   * Retrieves the contracts of a product created in a month, for the metrics.
   * @param productId the product of the contracts.
   * @param monthIndex the month (format: "YYYY-MM").
   * @returns the contracts created in that month.
   */
  async getByMonthIndex(productId: string, monthIndex: string): Promise<ResponseContractDto[]> {
    try {
      const contracts = await this._contractModel.query('productId').eq(productId).where('monthIndex').eq(monthIndex).using('monthIndex').all().exec();
      return contracts.map(contract => plainToInstance(ResponseContractDto, contract));
    } catch (error) {
      throw this._wrap(error, `Error retrieving contracts by monthIndex: ${monthIndex}`, 'An error occurred while retrieving contracts by monthIndex.');
    }
  }

  /**
   * Retrieves the contracts in force of a product, for the metrics.
   * @param productId the product of the contracts.
   * @returns the active and terminating contracts of the product.
   */
  async getInForceByProduct(productId: string): Promise<ResponseContractDto[]> {
    const contracts = await this._inForceOf(productId);
    return contracts.map(contract => plainToInstance(ResponseContractDto, contract));
  }

  /**
   * Retrieves every contract of a product in a status, for the metrics.
   * @param productId the product of the contracts.
   * @param status the status of the contracts.
   * @returns the contracts of the product in that status.
   * @throws DatabaseException if the query fails.
   */
  async getByStatus(productId: string, status: ContractStatus): Promise<ResponseContractDto[]> {
    try {
      const contracts = await this._contractModel.query('productId').eq(productId).where('status').eq(status).using('statusIndex').all().exec();
      return contracts.map(contract => plainToInstance(ResponseContractDto, contract));
    } catch (error) {
      throw this._wrap(error, `Error retrieving the ${status} contracts of product ${productId}`, 'An error occurred while retrieving the contracts by status.');
    }
  }

  /**
   * Retrieves the contracts that will renew in a month, of every product, for the metrics: `renewalMonth` is present
   * only while a contract will renew, so the cancelled and the ended ones are not there.
   * @param monthIndex the month of the renewal (format: "YYYY-MM").
   * @returns the contracts renewing in that month.
   * @throws DatabaseException if the query fails.
   */
  async getRenewingIn(monthIndex: string): Promise<ResponseContractDto[]> {
    try {
      const contracts = await this._contractModel.query('renewalMonth').eq(monthIndex).using('renewalIndex').all().exec();
      return contracts.map(contract => plainToInstance(ResponseContractDto, contract));
    } catch (error) {
      throw this._wrap(error, `Error retrieving the contracts renewing in ${monthIndex}`, 'An error occurred while retrieving the renewing contracts.');
    }
  }

  /**
   * Counts the payments Keus expects in a period from the contracts in force, before an invoice records them:
   *   - direct with a Stripe subscription: the next periods, charged on the anniversaries of the start (or of the end
   *     of the period paid through a reseller), from today on;
   *   - indirect: the periods billed to the reseller from `nextBillingDate`, due on the 4th of the next month, priced
   *     on the line of the order as the invoice will be, with what the customer pays the reseller for them;
   *   - financed: the seats beyond the financed ones, charged at each anniversary from `renewalDate`.
   * A contract being cancelled stops at its `terminationDate`. One-off plans, contracts with no amount and direct
   * contracts still waiting for their checkout have no payment to count.
   * Products and contracts are read side by side.
   * @param from the start of the period (ISO string).
   * @param to the end of the period (ISO string).
   * @param productId the only product to count, every product when absent.
   * @returns the expected payments, unsorted, the ones already invoiced included: the caller drops them.
   * @throws BusinessException if a product with payments to count has no Stripe tax rate.
   * @throws DatabaseException if a read fails.
   */
  async getExpectedCharges(from: string, to: string, productId?: string): Promise<ExpectedCharge[]> {
    const productsService = await this._loadProductsService();
    const products = (await productsService.getAllProducts()).filter(product => !productId || product.id === productId);
    const today = todayInItaly();
    const readers = this._expectedReaders();

    const byProduct = await Promise.all(products.map(async product => {
      const contracts = await this._inForceOf(product.id);
      return this._expectedOfContracts(product.id, contracts, from < today ? today : from, to, readers);
    }));
    return byProduct.flat();
  }

  /**
   * Counts the payments expected in a period from the indirect contracts in force sold by one reseller, as
   * `getExpectedCharges` does, for its own schedule: the contracts of its sub-resellers are theirs. Each product is
   * read through `resellerPathIndex`, under the path of the reseller.
   * @param resellerCode the code of the reseller.
   * @param from the start of the period (ISO string).
   * @param to the end of the period (ISO string).
   * @returns the expected payments, unsorted, the ones already invoiced included: the caller drops them.
   * @throws BusinessException if a product with payments to count has no Stripe tax rate.
   * @throws DatabaseException if a read fails.
   */
  async getExpectedChargesOfReseller(resellerCode: string, from: string, to: string): Promise<ExpectedCharge[]> {
    const resellersService = await this._loadResellersService();
    const path = await resellersService.getResellerPath(resellerCode);
    if (!path) {
      return [];
    }

    const productsService = await this._loadProductsService();
    const products = await productsService.getAllProducts();
    const today = todayInItaly();
    const readers = this._expectedReaders();

    const byProduct = await Promise.all(products.map(async product => {
      let contracts: Contract[];
      try {
        contracts = await this._contractModel.query('productId').eq(product.id)
          .where('resellerPath').beginsWith(path).using('resellerPathIndex').all().exec();
      } catch (error) {
        throw this._wrap(error, `Error retrieving the contracts of reseller ${resellerCode} on product ${product.id}`, 'An error occurred while retrieving the contracts of the reseller.');
      }

      const sold = contracts.filter(contract => IN_FORCE_STATUSES.includes(contract.status)
        && (contract.resellerPath ?? '').split('#').filter(Boolean).pop() === resellerCode);
      return this._expectedOfContracts(product.id, sold, from < today ? today : from, to, readers);
    }));
    return byProduct.flat();
  }

  /**
   * Builds the readers of one count of the expected payments: each reseller and each line is read once per request,
   * so contracts sharing them do not read them again.
   * @returns the readers.
   */
  private _expectedReaders(): ExpectedReaders {
    const resellers = new Map<string, Promise<BillingReseller | undefined>>();
    const lines = new Map<string, Promise<LineCharges>>();

    return {
      resellerOf: (code: string): Promise<BillingReseller | undefined> => {
        if (!resellers.has(code)) {
          resellers.set(code, this._loadResellersService()
            .then(service => service.getResellerByCode(code))
            .then(reseller => reseller ? { id: reseller.id, name: billedPartyOf(reseller).name } : undefined));
        }
        return resellers.get(code);
      },
      lineOf: (productId: string, orderId: string, seats?: number): Promise<LineCharges> => {
        const key = `${productId}#${orderId}#${seats ?? ''}`;
        if (!lines.has(key)) {
          const line = this._loadOrdersService().then(service => service.getLineCharges(productId, orderId, seats));
          // A failed read is not kept, so the caller decides on it once and a later read tries again.
          line.catch(() => lines.delete(key));
          lines.set(key, line);
        }
        return lines.get(key);
      },
    };
  }

  /**
   * Counts the payments expected in a period from some contracts in force of one product, as `getExpectedCharges`
   * does, the contracts read side by side.
   * @param productId the product.
   * @param inForce the contracts in force of the product to count.
   * @param from the start of the period (ISO string), not before today.
   * @param to the end of the period (ISO string).
   * @param readers the readers of the request, which read each reseller and each line once.
   * @returns the expected payments of the contracts.
   * @throws BusinessException if the product has no Stripe tax rate: its amounts would leave the VAT out.
   */
  private async _expectedOfContracts(
    productId: string,
    inForce: Contract[],
    from: string,
    to: string,
    readers: ExpectedReaders,
  ): Promise<ExpectedCharge[]> {
    const contracts = inForce.filter(contract => contract.renewalAmountCents);
    if (!contracts.length) {
      return [];
    }

    const plansService = await this._loadPlansService();
    const vatRatePercent = await this._vatRateOf(productId);
    const plans = new Map<string, Promise<ResponsePlanDto>>();
    const byContract = await Promise.all(contracts.map(async contract => {
      if (!plans.has(contract.planId)) {
        plans.set(contract.planId, plansService.getPlan(productId, contract.planId));
      }
      const plan = await plans.get(contract.planId);
      if (plan.type === PlanType.OneTime) {
        return [];
      }

      const periods = await this._expectedPeriodsOf(contract, plan, from, to, readers);
      return periods.map(period => ({
        contractId: contract.id,
        contractCode: contract.code,
        productId: contract.productId,
        companyId: contract.companyId,
        companyName: contract.companyName,
        ...period,
        ...invoiceAmounts([{ amountCents: period.taxableCents }], vatRatePercent),
      }));
    }));

    return byContract.flat();
  }

  /**
   * Lists the periods of a contract in force that fall due within a period and no invoice has billed yet, as
   * `getExpectedCharges` counts them.
   * @param contract the contract, with an amount.
   * @param plan its recurring plan.
   * @param from the start of the period (ISO string), not before today.
   * @param to the end of the period (ISO string).
   * @param readers the readers of the request, which read each reseller and each line once.
   * @returns the periods, with who pays them and their taxable amount.
   */
  private async _expectedPeriodsOf(
    contract: Contract,
    plan: ResponsePlanDto,
    from: string,
    to: string,
    readers: ExpectedReaders,
  ): Promise<ExpectedPeriod[]> {
    const months = plan.billingInterval === BillingInterval.Monthly ? 1 : 12;
    const yearly = contract.renewalAmountCents ?? 0;
    const fee = {
      periodMonths: months,
      description: `Canone ${plan.name}, ${months === 1 ? 'un mese' : 'un anno'}`,
      taxableCents: Math.round(yearly * months / 12),
    };
    // A period that starts on the termination date is not billed.
    const ruleEnd = contract.terminationDate && new Date(new Date(contract.terminationDate).getTime() - 1).toISOString();
    const company = { channel: SalesChannel.Direct, billedPartyType: BilledPartyType.Company, billedPartyId: contract.companyId, billedPartyName: contract.companyName };

    if (contract.resellerPath) {
      return this._expectedResellerPeriods(contract, fee, ruleEnd, from, to, readers);
    }

    if (contract.stripeSubscriptionId) {
      const cadence = months === 1 ? ChargeCadence.Monthly : ChargeCadence.Annual;
      return occurrencesBetween({ ruleStart: contract.paidUntil ?? contract.startDate, cadence, ...(ruleEnd && { ruleEnd }) }, from, to)
        .map(periodStart => ({ ...company, ...fee, periodStart, dueDate: periodStart }));
    }

    const anniversaries = contract.renewalDate
      ? occurrencesBetween({ ruleStart: contract.renewalDate, cadence: ChargeCadence.Annual, ...(ruleEnd && { ruleEnd }) }, from, to)
      : [];
    // The line is read only when an anniversary falls in the period, so a long schedule does not read every order.
    if (!anniversaries.length) {
      return [];
    }

    const { financing } = await readers.lineOf(contract.productId, contract.orderId);
    // Without a financing the direct contract still waits for its checkout: the day of its first charge is unknown.
    if (!financing) {
      return [];
    }

    return anniversaries
      .map(periodStart => ({
        ...company,
        periodStart,
        periodMonths: 12,
        dueDate: periodStart,
        description: `Postazioni oltre le ${financing.seats ?? 0} finanziate (${contract.seats} in tutto)`,
        taxableCents: yearly,
        prorationId: uuidv5(`${contract.id}#financed#${periodStart}`, PRORATION_NAMESPACE),
      }));
  }

  /**
   * Lists the periods of an indirect contract the reseller will be billed for, due within a period: one after the
   * other from `nextBillingDate`, as `_billNextPeriod` moves the date on, each due on the 4th of the month after it
   * starts, when the monthly charge collects it. Each is priced on the line of the order, net of the margin, with what
   * the customer pays the reseller for it.
   * @param contract the indirect contract.
   * @param fee the length, the description and the amount of a period from the contract, which the line replaces.
   * @param ruleEnd the last instant a period can start, absent when the contract renews.
   * @param from the start of the period of the due dates (ISO string).
   * @param to the end of the period of the due dates (ISO string).
   * @param readers the readers of the request, which read each reseller and each line once.
   * @returns the periods, billed to the selling reseller; none when it cannot be read.
   */
  private async _expectedResellerPeriods(
    contract: Contract,
    fee: { periodMonths: number; description: string; taxableCents: number },
    ruleEnd: string | undefined,
    from: string,
    to: string,
    readers: ExpectedReaders,
  ): Promise<ExpectedPeriod[]> {
    const sellerCode = (contract.resellerPath ?? '').split('#').filter(Boolean).pop() ?? '';
    const reseller = await readers.resellerOf(sellerCode);
    if (!contract.nextBillingDate || !reseller) {
      return [];
    }

    const periods: ExpectedPeriod[] = [];
    for (let periodStart = contract.nextBillingDate; periodStart <= to && (!ruleEnd || periodStart <= ruleEnd); periodStart = addMonths(periodStart, fee.periodMonths)) {
      const dueDate = `${monthOf(addMonths(periodStart, 1))}-04T00:00:00.000Z`;
      if (dueDate >= from && dueDate <= to) {
        periods.push({
          channel: SalesChannel.Reseller,
          billedPartyType: BilledPartyType.Reseller,
          billedPartyId: reseller.id,
          billedPartyName: reseller.name,
          periodStart,
          dueDate,
          ...fee,
        });
      }
    }

    if (!periods.length) {
      return periods;
    }

    // Priced on the line as `_invoiceReseller` bills a period, read only when a period falls in the schedule.
    let charges: LineCharges;
    try {
      charges = await readers.lineOf(contract.productId, contract.orderId, contract.seats);
    } catch (error) {
      // A missing line leaves the amount of the contract, so one broken contract does not hide the whole schedule.
      if (error instanceof EntityNotFoundException) {
        this._logger.warn(`Line of contract ${contract.code} not found: its expected periods keep the amount of the contract.`);
        return periods;
      }
      throw error;
    }
    const taxableCents = (charges.recurringCents ?? 0) + (charges.customization?.recurringIncreaseCents ?? 0);
    const customerCents = (charges.customer?.recurringCents ?? 0) + (charges.customer?.customizationRecurringIncreaseCents ?? 0);
    return periods.map(period => ({ ...period, taxableCents, customerCents }));
  }

  /**
   * Reads the contracts in force of a product: the active and the terminating ones.
   * @param productId the product of the contracts.
   * @returns the contracts.
   * @throws DatabaseException if the query fails.
   */
  private async _inForceOf(productId: string): Promise<Contract[]> {
    try {
      const byStatus = await Promise.all(IN_FORCE_STATUSES.map(status =>
        this._contractModel.query('productId').eq(productId).where('status').eq(status).using('statusIndex').all().exec(),
      ));
      return byStatus.flat();
    } catch (error) {
      throw this._wrap(error, `Error retrieving the contracts in force of product ${productId}`, 'An error occurred while retrieving the contracts in force.');
    }
  }

  /**
   * Ends a contract: the recurring charge stops, the schedules are cancelled and the tenant loses access. A contract
   * ended by a transfer hands its tenant to the one taking over, so the tenant and its users stay active.
   * @param contract the contract to end.
   * @param reason why it ends, when it matters.
   * @returns the terminated contract.
   */
  private async _terminate(contract: Contract, reason?: ContractTerminationReason): Promise<Contract> {
    if (contract.stripeSubscriptionId) {
      const productsService = await this._loadProductsService();
      const product = await productsService.getProduct(contract.productId);
      const stripeService = await this._loadStripeService();
      await stripeService.cancelSubscription(contract.stripeSubscriptionId, product.stripeApiKey);
    }
    await this._contractSchedulerService.cancelRenewal(contract.id);
    await this._contractSchedulerService.cancelTermination(contract.id);
    await this._contractSchedulerService.cancelBilling(contract.id);
    await this._contractSchedulerService.cancelPaymentDunning(contract.id);

    // The holds of the product go with the status, in one transaction: a terminated contract never keeps one.
    const key = { productId: contract.productId, id: contract.id };
    const holds = await this._productHoldsOf(contract);
    await transaction([
      this._contractModel.transaction.update(key, toDynamooseUpdate<Contract>(
        { status: ContractStatus.Terminated, terminationDate: new Date().toISOString(), ...(reason && { terminationReason: reason }) },
        ['renewalMonth', 'terminationMonth', 'accessSuspendedAt', 'nextBillingDate'],
      )),
      // No condition: while the hold of this order exists no other order can take it, so the write is never refused.
      ...holds.map(hold => this._companyProductModel.transaction.delete(hold)),
    ]);
    const terminated = await this._contractModel.get(key, { consistent: true, return: "item" });
    if (reason !== ContractTerminationReason.Transfer) {
      await this._setTenantStatus(contract, TenantStatus.Active, TenantStatus.Inactive);
    }

    this._logger.log(`Contract ${contract.id} terminated.`);
    return terminated;
  }

  /**
   * Moves the tenant of a contract from one status to another; the tenant cascades to its users.
   * @param contract the contract governing the tenant.
   * @param from the status the tenant must be in.
   * @param to the status to move it to.
   * @returns whether the tenant was moved.
   */
  private async _setTenantStatus(contract: Contract, from: TenantStatus, to: TenantStatus): Promise<boolean> {
    const tenantsService = await this._loadTenantsService();
    const tenant = await tenantsService.getTenant(contract.productId, contract.tenantId, SYSTEM_SCOPE);
    if (tenant.status !== from) {
      return false;
    }
    await tenantsService.updateTenant(contract.productId, contract.tenantId, { status: to } as UpdateTenantDto);
    this._logger.log(`Tenant ${contract.tenantId} of contract ${contract.id} moved to ${to}.`);
    return true;
  }

  /**
   * Reads the last contract of the year of a product, to number the next one.
   * @param productId the product of the contracts.
   * @param productPrefix the prefix of the product codes.
   * @returns the last contract of the year, if any.
   */
  private async _getLastContract(productId: string, productPrefix: string): Promise<Contract | undefined> {
    const last = await this._contractModel
      .query("productId").eq(productId)
      .where("code").beginsWith(`${productPrefix}-${new Date().getFullYear()}`)
      .using("codeIndex")
      .sort(SortOrder.descending)
      .limit(1)
      .exec();
    return last[0];
  }

  /**
   * Generates the code of a contract, {product prefix}-{year}-{sequence}; two codes alike harm nothing, as no key uses them.
   * @param productPrefix the prefix of the product codes.
   * @param lastContract the last contract of the year, if any.
   * @returns the code of the new contract.
   */
  private _generateContractCode(productPrefix: string, lastContract: Contract | undefined): string {
    const sequence = lastContract ? parseInt(lastContract.code.split('-')[2], 10) + 1 : 1;
    return `${productPrefix}-${new Date().getFullYear()}-${String(sequence).padStart(5, '0')}`;
  }

  /**
   * Bills the reseller for the period starting at the next billing date of an indirect contract, then moves the date
   * on by one period. A contract ending before that date bills nothing more.
   * @param contract the indirect contract.
   */
  private async _billNextPeriod(contract: Contract): Promise<void> {
    const periodStart = contract.nextBillingDate;
    if (!periodStart) {
      return;
    }

    if (contract.terminationDate && new Date(periodStart) >= new Date(contract.terminationDate)) {
      await this._contractModel.update({ productId: contract.productId, id: contract.id }, toDynamooseUpdate<Contract>({}, ['nextBillingDate']));
      return;
    }

    const months = await this._invoiceReseller(contract, periodStart, false);
    const nextBillingDate = addMonths(periodStart, months);
    await this._contractModel.update({ productId: contract.productId, id: contract.id }, { nextBillingDate });
    await this._contractSchedulerService.scheduleBilling(contract.productId, contract.id, nextBillingDate);
  }

  /**
   * Tells whoever pays a contract that it is about to renew, with date and amount (UR-RK-405): the company through its
   * product, the reseller on the indirect channel. A contract already cancelled does not renew, and is not told.
   * @param contract the contract.
   */
  private async _noticeRenewal(contract: Contract): Promise<void> {
    if (contract.status !== ContractStatus.Active || !contract.renewalDate) {
      this._logger.log(`Renewal notice of contract ${contract.code} skipped: the contract does not renew.`);
      return;
    }

    const facts = {
      renewalDate: formatDate(contract.renewalDate),
      renewalAmount: contract.renewalAmountCents !== undefined ? formatEuro(contract.renewalAmountCents) : '',
    };
    if (contract.resellerPath) {
      await this._contractNoticesService.toReseller(contract, MailTemplate.RenewalNotice, facts);
      return;
    }

    await this._contractNoticesService.toCompany(contract, MailTemplate.CompanyRenewalNotice, facts);
  }

  /**
   * Issues to the selling reseller the invoice of one period of an indirect contract, with the amounts net of its
   * margin; the first period adds the one-off items. It is charged with the others of the month on the 4th of the next.
   * @param contract the indirect contract.
   * @param periodStart the first day of the period billed.
   * @param first whether it is the period that starts at provisioning.
   * @returns the length of the period, in months.
   */
  private async _invoiceReseller(contract: Contract, periodStart: string, first: boolean): Promise<number> {
    const ordersService = await this._loadOrdersService();
    // The fee follows the seats of the contract, which grow past the ones sold on the line (UR-RK-401).
    const charges = await ordersService.getLineCharges(contract.productId, contract.orderId, contract.seats);
    const plansService = await this._loadPlansService();
    const plan = await plansService.getPlan(contract.productId, contract.planId);
    const oneOff = plan.type === PlanType.OneTime;
    const months = plan.billingInterval === BillingInterval.Monthly ? 1 : 12;

    // Each line carries the price the customer pays the reseller for it; the assistance is at full price for both.
    const customer = charges.customer;
    const lines: { description: string; amountCents: number; customerCents: number }[] = [];
    if (charges.recurringCents && (first || !oneOff)) {
      lines.push({
        description: oneOff ? `Licenza ${plan.name}` : `Canone ${plan.name}, ${months === 1 ? 'un mese' : 'un anno'}`,
        amountCents: charges.recurringCents,
        customerCents: customer?.recurringCents ?? 0,
      });
    }
    if (!oneOff && charges.customization?.recurringIncreaseCents) {
      lines.push({
        description: 'Incremento del canone per la personalizzazione',
        amountCents: charges.customization.recurringIncreaseCents,
        customerCents: customer?.customizationRecurringIncreaseCents ?? 0,
      });
    }
    if (first && charges.activationCents) {
      lines.push({ description: `Attivazione ${plan.name}`, amountCents: charges.activationCents, customerCents: customer?.activationCents ?? 0 });
    }
    if (first && charges.assistance?.amountCents) {
      lines.push({ description: charges.assistance.label ?? 'Assistenza', amountCents: charges.assistance.amountCents, customerCents: charges.assistance.amountCents });
    }
    if (first && charges.customization?.oneOffCents) {
      lines.push({ description: 'Personalizzazione', amountCents: charges.customization.oneOffCents, customerCents: customer?.customizationOneOffCents ?? 0 });
    }
    if (lines.length === 0) {
      return months;
    }
    const items = lines.map(line => ({ description: line.description, amountCents: line.amountCents, orderId: contract.orderId, productId: contract.productId }));

    const sellerCode = (contract.resellerPath ?? '').split('#').filter(Boolean).pop() ?? '';
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getResellerByCode(sellerCode);
    if (!reseller) {
      throw new EntityNotFoundException('Reseller', sellerCode);
    }
    const salesId = await this._salesIdOf(contract);
    const chargeMonth = monthOf(addMonths(periodStart, 1));
    const invoicesService = await this._loadInvoicesService();
    const invoice = await invoicesService.issueManualInvoice({
      billedPartyId: reseller.id,
      billedPartyType: BilledPartyType.Reseller,
      billedParty: billedPartyOf(reseller),
      channel: SalesChannel.Reseller,
      vatRatePercent: await this._vatRateOf(contract.productId),
      dueDate: `${chargeMonth}-04T00:00:00.000Z`,
      items,
      orderId: contract.orderId,
      lineProductId: contract.productId,
      contractId: contract.id,
      stripeAccount: contract.productId,
      billingPeriodStart: periodStart,
      toChargeMonth: chargeMonth,
    });
    await this._recordCustomerShare(
      contract,
      invoice,
      salesId,
      lines.map(line => line.description).join(', '),
      periodStart,
      oneOff ? undefined : addMonths(periodStart, months),
      lines.reduce((sum, line) => sum + line.customerCents, 0),
    );
    this._logger.log(`Contract ${contract.id} billed to reseller ${reseller.code} for the period from ${periodStart}, charged in ${chargeMonth}.`);
    return months;
  }

  /**
   * Records what the reseller bills its customer for the period of an invoice of Keus, at the price the customer pays,
   * due on the first day of the period, with what Keus bills for it and who sold the order, for the dashboard of the
   * reseller. Billing the period again finds the share already recorded.
   * @param contract the indirect contract.
   * @param invoice the invoice of Keus to the reseller.
   * @param salesId the salesperson who opened the order of the contract, if any.
   * @param description what the period bills.
   * @param periodStart the first day of the period.
   * @param periodEnd the end of the period, absent on a one-off plan.
   * @param amountCents the amount at the price of the customer, net of VAT, in cents.
   */
  private async _recordCustomerShare(
    contract: Contract,
    invoice: Invoice,
    salesId: string | undefined,
    description: string,
    periodStart: string,
    periodEnd: string | undefined,
    amountCents: number,
  ): Promise<void> {
    const customerChargesService = await this._loadCustomerChargesService();
    await customerChargesService.recordContractCharge({
      resellerId: invoice.billedPartyId,
      invoiceId: invoice.id,
      companyId: contract.companyId,
      companyName: contract.companyName,
      description,
      amountCents,
      dueDate: periodStart,
      ...(periodEnd && { periodEnd }),
      contractId: contract.id,
      productId: contract.productId,
      contractCode: contract.code,
      keusCents: invoice.taxableCents,
      ...(salesId && { salesId }),
    });
  }

  /**
   * Reads who sold the order of a contract, before its period is invoiced to the reseller: a failed read stops the
   * billing before the invoice exists, instead of leaving an invoice without its share.
   * @param contract the indirect contract.
   * @returns the salesperson who opened the order, if any.
   */
  private async _salesIdOf(contract: Contract): Promise<string | undefined> {
    const ordersService = await this._loadOrdersService();

    return (await ordersService.getSalesIds([contract.orderId])).get(contract.orderId);
  }

  /**
   * Issues the single invoice of a financed contract to the finance company: the one-off items and the fee for the
   * whole duration of the order. No Stripe charge collects it: it is paid by bank transfer and marked paid by hand.
   * @param contract the financed contract.
   * @param charges the charges of its order line.
   * @param financing the financing of the order.
   */
  private async _invoiceFinancier(contract: Contract, charges: LineCharges, financing: NonNullable<LineCharges["financing"]>): Promise<void> {
    const plansService = await this._loadPlansService();
    const plan = await plansService.getPlan(contract.productId, contract.planId);
    const oneOff = plan.type === PlanType.OneTime;
    const years = oneOff ? 1 : financing.years ?? 1;
    const yearlyFactor = plan.billingInterval === BillingInterval.Monthly ? 12 : 1;
    const reference = financing.reference ? ` (pratica ${financing.reference})` : '';

    const lines: { description: string; amountCents: number }[] = [];
    if (charges.recurringCents) {
      lines.push(oneOff
        ? { description: `Licenza ${plan.name}${reference}`, amountCents: charges.recurringCents }
        : { description: `Canone ${plan.name}, ${years} ${years === 1 ? 'anno' : 'anni'}${reference}`, amountCents: charges.recurringCents * yearlyFactor * years });
    }
    if (charges.activationCents) {
      lines.push({ description: `Attivazione ${plan.name}`, amountCents: charges.activationCents });
    }
    if (charges.assistance?.amountCents) {
      lines.push({ description: charges.assistance.label ?? 'Assistenza', amountCents: charges.assistance.amountCents });
    }
    if (charges.customization?.oneOffCents) {
      lines.push({ description: 'Personalizzazione', amountCents: charges.customization.oneOffCents });
    }
    if (!oneOff && charges.customization?.recurringIncreaseCents) {
      lines.push({ description: `Incremento del canone per la personalizzazione, ${years} ${years === 1 ? 'anno' : 'anni'}`, amountCents: charges.customization.recurringIncreaseCents * yearlyFactor * years });
    }
    const items = lines.map(line => ({ ...line, orderId: contract.orderId, productId: contract.productId }));

    const invoicesService = await this._loadInvoicesService();
    await invoicesService.issueManualInvoice({
      billedPartyId: financing.financier,
      billedPartyType: BilledPartyType.Financier,
      billedParty: { name: FINANCIER_NAMES[financing.financier] ?? financing.financier },
      channel: SalesChannel.Direct,
      vatRatePercent: await this._vatRateOf(contract.productId),
      dueDate: new Date().toISOString(),
      items,
      orderId: contract.orderId,
      lineProductId: contract.productId,
      contractId: contract.id,
      stripeAccount: contract.productId,
    });
    this._logger.log(`Contract ${contract.id} invoiced to the finance company ${financing.financier} for ${years} years.`);
  }

  /**
   * Reads the secret API key of the Stripe account of a product.
   * @param productId the product.
   * @returns the API key.
   * @throws BusinessException if the product has no Stripe account.
   */
  private async _stripeApiKeyOf(productId: string): Promise<string> {
    const productsService = await this._loadProductsService();
    const product = await productsService.getProduct(productId);
    if (!product.stripeApiKey) {
      throw new BusinessException(`Product ${productId} has no Stripe account configured.`, 'PRODUCT_WITHOUT_STRIPE');
    }
    return product.stripeApiKey;
  }

  /**
   * Reads the VAT rate of a product from its Stripe tax rate, the one its account charges; without Stripe, the fixed rate.
   * @param productId the product.
   * @returns the VAT rate, in percent.
   * @throws BusinessException if the product has no Stripe account or no tax rate.
   */
  private async _vatRateOf(productId: string): Promise<number> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      return DEMO_VAT_RATE_PERCENT;
    }

    const productsService = await this._loadProductsService();
    const product = await productsService.getProduct(productId);
    if (!product.stripeApiKey || !product.stripeTaxRateId) {
      throw new BusinessException(`Product ${productId} has no Stripe tax rate: its invoices cannot carry the VAT.`, 'PRODUCT_WITHOUT_TAX_RATE');
    }
    const stripeService = await this._loadStripeService();
    return stripeService.getTaxRatePercent(product.stripeTaxRateId, product.stripeApiKey);
  }

  /**
   * Keeps the contracts within the subtree of the requesting reseller.
   * @param scope the request scope, restricted.
   * @param contracts the contracts to filter.
   * @returns the visible contracts.
   */
  private async _visibleTo(scope: RequestScope, contracts: Contract[]): Promise<Contract[]> {
    const viewerPath = await this._resolveScopePath(scope);
    return contracts.filter(contract => isPathVisible(viewerPath, contract.resellerPath));
  }

  /**
   * Reads a contract and checks that the scope can see it.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param scope the request scope.
   * @returns the contract.
   * @throws EntityNotFoundException if the contract does not exist.
   */
  private async _getVisibleContract(productId: string, id: string, scope: RequestScope): Promise<Contract> {
    const contract = await this._contractModel.get({ productId, id });
    if (!contract) {
      this._logger.warn(`Contract with ID: ${id} for product ID: ${productId} not found.`);
      throw new EntityNotFoundException('Contract', id);
    }

    const viewerPath = await this._resolveScopePath(scope);
    assertPathVisible(scope, viewerPath, contract.resellerPath, `Contract ${id}`);

    return contract;
  }

  /**
   * Shapes a contract for the requester. A reseller salesperson does not see the purchase terms (analysis, pag. 51):
   * the renewal amount is what its reseller pays, as the billed amounts its orders hide.
   * @param contract the contract, with the fields of its detail page when read for it.
   * @param scope the request scope.
   * @returns the response DTO.
   */
  private _toResponse(contract: Contract & Pick<ResponseContractDto, "paymentRequired" | "financed">, scope: RequestScope): ResponseContractDto {
    return plainToInstance(ResponseContractDto, isSalespersonOnly(scope) ? { ...contract, renewalAmountCents: undefined } : contract);
  }

  /**
   * Asserts that a salesperson cancels, or takes the cancellation back, only on the contracts of the orders it opened,
   * which `assignedSalesId` copies from the order. A Keus salesperson only on direct ones: the customers of its
   * resellers it reads, but their cancellation is the reseller's (UR-RK-405).
   * @param contract the contract to change.
   * @param scope the request scope.
   * @throws AuthorizationException when the contract is not of an order opened by the salesperson.
   */
  private _assertOwnContract(contract: Contract, scope: RequestScope): void {
    if (isKeusSalespersonOnly(scope) && (contract.resellerPath || contract.assignedSalesId !== scope.sub)) {
      throw new AuthorizationException(`Contract ${contract.id} is not of a direct order opened by the requester.`);
    }
    if (isSalespersonOnly(scope) && contract.assignedSalesId !== scope.sub) {
      throw new AuthorizationException(`Contract ${contract.id} is not of an order opened by the requester.`);
    }
  }


  /**
   * Resolves the requesting reseller's materialized path (undefined for
   * unrestricted scopes: collaborators / system).
   * @param scope the request scope.
   * @returns the viewer's reseller path, or undefined.
   */
  private async _resolveScopePath(scope: RequestScope): Promise<string | undefined> {
    if (isUnrestricted(scope) || !scope.resellerCode) {
      return undefined;
    }
    const resellersService = await this._loadResellersService();
    return await resellersService.getResellerPath(scope.resellerCode);
  }

  /**
   * Logs an error and turns it into the exception to throw: domain errors pass, a failed condition means a concurrent change.
   * @param error the error caught.
   * @param logMessage the message to log.
   * @param message the message of the DatabaseException for unexpected errors.
   * @returns the exception to throw.
   */
  private _wrap(error: unknown, logMessage: string, message: string): Error {
    this._logger.error(logMessage, error);
    if (error instanceof AppException) {
      return error;
    }
    if (isConditionalCheckFailed(error)) {
      return new BusinessException('The contract changed in the meantime: reload it and try again.', 'CONTRACT_CHANGED');
    }
    return new DatabaseException(message, error);
  }
}
