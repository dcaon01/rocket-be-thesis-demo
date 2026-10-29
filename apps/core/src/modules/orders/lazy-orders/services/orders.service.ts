import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { Condition, transaction } from "dynamoose";
import { SortOrder } from "dynamoose/dist/General";
import { InjectModel, Model, Query } from "nestjs-dynamoose";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import { isUnrestricted, RequestScope, SYSTEM_SCOPE, UserRole } from "@rocket-be/scoping";
import {
  AppException,
  AuthorizationException,
  BusinessException,
  DatabaseException,
  EntityNotFoundException,
  ValidationException,
} from "../../../../errors/exception-types";
import { Page, paginate, paginateMerged, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { assertPathVisible, canSellOn, isKeusSalespersonOnly, isPathVisible, isSalespersonOnly } from "../../../../commons/scoping/scoped-access.helper";
import { SalesChannel } from "../../../companies/enums/sales-channel.enum";
import { ResponseCompanyDto } from "../../../companies/dtos/response-company.dto";
import type { TransferLine } from "../../../companies/classes/transfer-line.class";
import type { ResponseContractDto } from "../../../contracts/dtos/response-contract.dto";
import { Financier } from "../../enums/financier.enum";
import { BillingInterval } from "../../../plans/enums/billing-interval.enum";
import { PlanAudience } from "../../../plans/enums/plan-audience.enum";
import { PlanStatus } from "../../../plans/enums/plan-status.enum";
import { PlanType } from "../../../plans/enums/plan-type.enum";
import { ResponsePlanDto } from "../../../plans/dtos/response-plan.dto";
import type { Tier } from "../../../plans/classes/tier.class";
import { ResellerStatus } from "../../../resellers/enums/reseller-status.enum";
import { Reseller } from "../../../resellers/schemas/reseller.schema";
import { TemplateType } from "../../../templates/enums/template-type.enum";
import { CustomizationInput } from "../../classes/customization-input.class";
import { OrderBlocker } from "../../classes/order-blocker.class";
import { OrderLineInput } from "../../classes/order-line-input.class";
import { AcceptOrderDto } from "../../dtos/accept-order.dto";
import { ConfirmOrderDto } from "../../dtos/confirm-order.dto";
import { CreateOrderDto } from "../../dtos/create-order.dto";
import { CustomizationDiscountDto } from "../../dtos/customization-discount.dto";
import { GenerateOfferDto } from "../../dtos/generate-offer.dto";
import { SaveQuotationDto } from "../../dtos/save-quotation.dto";
import { CustomizationEvaluation } from "../../classes/customization-evaluation.class";
import { RefuseApprovalDto } from "../../dtos/refuse-approval.dto";
import { RefuseOrderDto } from "../../dtos/refuse-order.dto";
import { OrdersPageQueryDto } from "../../dtos/orders-page-query.dto";
import { ProvisioningPageQueryDto } from "../../dtos/provisioning-page-query.dto";
import { ResponseOrderDto } from "../../dtos/response-order.dto";
import { ResponseOrderLinesPageDto } from "../../dtos/response-order-lines-page.dto";
import { ResponseOrdersPageDto } from "../../dtos/response-orders-page.dto";
import { ResponseOrderSellerDto } from "../../dtos/response-order-seller.dto";
import { UpdateFinancingDto } from "../../dtos/update-financing.dto";
import { UpdateOrderDto } from "../../dtos/update-order.dto";
import { CustomizationAttachmentType } from "../../enums/customization-attachment-type.enum";
import { CustomizationKind } from "../../enums/customization-kind.enum";
import { CustomizationStatus } from "../../enums/customization-status.enum";
import { OrderBlockerKind } from "../../enums/order-blocker-kind.enum";
import { OrderLineStatus } from "../../enums/order-line-status.enum";
import { OrderRefusalReason } from "../../enums/order-refusal-reason.enum";
import { OrderStatus } from "../../enums/order-status.enum";
import { Order, OrderKey } from "../../schemas/order.schema";
import { LineCharges } from "../../interfaces/line-charges.interface";
import { OrderCustomization, OrderCustomizationKey } from "../../schemas/order-customization.schema";
import { OrderLine, OrderLineKey } from "../../schemas/order-line.schema";
import type { CompaniesService } from "../../../companies/lazy-companies/services/companies.service";
import type { PlansService } from "../../../plans/lazy-plans/services/plans.service";
import type { ProductsService } from "../../../products/lazy-products/services/products.service";
import type { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import type { ResellerContractsService } from "../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service";
import { ResellerContractMargin } from "../../../reseller-contracts/classes/reseller-contract-margin.class";
import type { TemplatesService } from "../../../templates/lazy-templates/services/templates.service";
import type { MailService } from "../../../mail/lazy-mail/services/mail.service";
import type { MailRecipient } from "../../../mail/interfaces/mail-recipient.interface";
import type { S3Service } from "../../../s3/lazy-s3/services/s3.service";
import type { TenantsService } from "../../../tenants/lazy-tenants/services/tenants.service";
import type { ContractsService, NewContract } from "../../../contracts/lazy-contracts/services/contracts.service";
import type { Contract } from "../../../contracts/schemas/contract.schema";
import type { UsersService } from "../../../users/lazy-users/services/users.service";
import type { TrialsService } from "../../../trials/lazy-trials/services/trials.service";
import type { UpdateTenantDto } from "../../../tenants/dtos/update-tenant.dto";
import type { ResponseTrialDto } from "../../../trials/dtos/response-trial.dto";
import { TrialStatus } from "../../../trials/enums/trial-status.enum";
import { IN_FORCE_STATUSES } from "../../../contracts/enums/contract-status.enum";
import type { PendingOperationsService } from "../../../pending-operations/lazy-pending-operations/services/pending-operations.service";
import type { CreateUserDto } from "../../../users/dtos/create-user.dto";
import { AccountType } from "../../../../commons/enums/account-type.enum";
import { TenantStatus } from "../../../tenants/enums/tenant-status.enum";
import { ProvisionLineDto } from "../../dtos/provision-line.dto";
import { ResponseOrderLineDto } from "../../dtos/response-order-line.dto";
import { MailTemplate } from "../../../mail/enums/mail-template.enum";
import { isConditionalCheckFailed, isTransactionCanceled } from "../../../../commons/persistence/write-errors.helper";
import { calendarDayOf } from "../../../../commons/dates/calendar-day.helper";
import { rocketUrl } from "../../../../commons/formatting/notice-format.helper";

/** Users a line can provision in one go: tenant, operation and line take 3 writes, each user 2, within a 100-write transaction. */
const MAX_PROVISIONED_USERS = 45;

/**
 * Transitions allowed on an order, keyed by the current status. Declared as
 * data rather than scattered ifs, so the lifecycle reads in one place.
 * PRICED → PRICED is the only self-transition: a quotation saved again stays there.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.Draft]: [OrderStatus.ToBePriced, OrderStatus.ToBeApproved, OrderStatus.Sent, OrderStatus.Cancelled],
  [OrderStatus.ToBePriced]: [OrderStatus.Priced, OrderStatus.Refused, OrderStatus.Cancelled],
  [OrderStatus.Priced]: [OrderStatus.Priced, OrderStatus.ToBeApproved, OrderStatus.Sent, OrderStatus.Refused, OrderStatus.Cancelled],
  [OrderStatus.ToBeApproved]: [OrderStatus.Approved, OrderStatus.Draft, OrderStatus.Priced, OrderStatus.Cancelled],
  [OrderStatus.Approved]: [OrderStatus.Sent, OrderStatus.Priced, OrderStatus.Refused, OrderStatus.Cancelled],
  [OrderStatus.Sent]: [OrderStatus.Accepted, OrderStatus.Refused, OrderStatus.Cancelled],
  [OrderStatus.Accepted]: [OrderStatus.Confirmed, OrderStatus.Refused, OrderStatus.Cancelled],
  [OrderStatus.Confirmed]: [OrderStatus.Closed],
  [OrderStatus.Closed]: [],
  [OrderStatus.Refused]: [],
  [OrderStatus.Cancelled]: [],
};

/** Statuses of the orders whose lines have a status: confirmed, and closed once every line is provisioned. */
const LINE_STATUS_ORDER_STATUSES: OrderStatus[] = [OrderStatus.Confirmed, OrderStatus.Closed];

/** Statuses after which the order leaves the queue of open orders. */
const FINAL_STATUSES: OrderStatus[] = [OrderStatus.Closed, OrderStatus.Refused, OrderStatus.Cancelled];

/** Statuses in which an order can be deleted: a draft, or an order that ended without a contract (decision of 28/10/2026). */
const DELETABLE_STATUSES: OrderStatus[] = [OrderStatus.Draft, OrderStatus.Refused, OrderStatus.Cancelled];

/** Namespace of the identifiers of the transfer orders, derived from company, reseller and previous transfer. */
const TRANSFER_ORDER_NAMESPACE = "0f4b6c1e-8a57-4d2b-9a8e-5c3d7e9f1a20";

/** Attributes of the approval of a reseller offer, voided when the quotation is saved again. */
const APPROVAL_ATTRIBUTES: (keyof Order)[] = ["approvedAt", "approvedBySub"];

/** Amount attributes of a customization request. */
const CUSTOMIZATION_AMOUNTS: (keyof OrderCustomization)[] = [
  "listOneOffCents",
  "listRecurringIncreaseCents",
  "offerOneOffCents",
  "offerRecurringIncreaseCents",
  "billedOneOffCents",
  "billedRecurringIncreaseCents",
];

/**
 * Builds an update that also removes attributes: Dynamoose accepts `$REMOVE`
 * next to the values, but its types do not declare it.
 * @param set the attributes to write.
 * @param remove the attributes to remove.
 * @returns the update object.
 */
function withRemoval<T>(set: Partial<T>, remove: (keyof T)[]): Partial<T> {
  return remove.length > 0 ? { ...set, $REMOVE: remove } : set;
}

/** A write of a DynamoDB transaction, as built by the Dynamoose models. */
type TransactionWrite = Parameters<typeof transaction>[0][number];

/** Format of the delivery date in the emails: ISO dates are calendar days, so read in UTC. */
const DELIVERY_DATE_FORMAT = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

/** Queues work to run once an action's transaction is committed, such as an email. */
type AfterCommit = (task: () => Promise<void>) => void;

/**
 * The orders a salesperson sees: the ones it opened (`assignedSalesId`) and, for a Keus salesperson, the ones sold by
 * the resellers it is the reference salesperson of, by code.
 */
type SalesOwnership = { sub: string; resellerCodes?: Set<string> };

/**
 * Who sells an order, resolved from the company it is placed for.
 * `reseller` is set on the indirect channel only.
 */
type OrderSeller = {
  /** Sales channel of the order. */
  channel: SalesChannel;
  /** Materialized reseller lineage of the seller. */
  resellerPath?: string;
  /** Code of the reseller at the root of the seller's network. */
  rootResellerCode?: string;
  /** The selling reseller, on the indirect channel. */
  reseller?: Reseller;
  /** Margin written in the contract in force of the selling reseller, on the indirect channel. */
  margin?: ResellerContractMargin;
  /** Products enabled by the contract in force of the selling reseller, on the indirect channel. */
  productIds?: string[];
};

/** Summary of lines and customization kept on the order, rewritten with them. */
type OrderSummary = Pick<Order,
  "linesTotal" | "linesProvisioned" | "linesActivated" | "productIds" | "productNames" | "hasCustomization" | "pendingCustomizations">;

/**
 * Service responsible for the lifecycle of orders, their lines and their
 * customization requests.
 *
 * An order is the supply request for a single company; its lines are the
 * units of provisioning. Order, lines and customization are written together
 * in one transaction, so an order never exists without the lines it was
 * created with, and the summary on the order never disagrees with them.
 *
 * The channel is the company's own: a company of a reseller is always sold on
 * the indirect channel, whoever opens the order.
 *
 * Pricing, computed here and never accepted from the caller:
 *   - the plan is the list price;
 *   - the seller may grant the customer a discount, printed on the offer;
 *   - on the direct channel Keus invoices the offer amount;
 *   - on the indirect channel the percentages of the reseller contract are its margin,
 *     Keus invoices the list price minus the margin, and the reseller's
 *     discount comes out of the margin, so it can never exceed it.
 */
@Injectable()
export class OrdersService {
  /** Logger instance for OrdersService. */
  private readonly _logger = new Logger(OrdersService.name);

  /** Cached instance of the lazily loaded companies service. */
  private _companiesService: CompaniesService | null = null;

  /** Cached instance of the lazily loaded plans service. */
  private _plansService: PlansService | null = null;

  /** Cached instance of the lazily loaded products service. */
  private _productsService: ProductsService | null = null;

  /** Cached instance of the lazily loaded resellers service. */
  private _resellersService: ResellersService | null = null;

  /** Cached instance of the lazily loaded reseller contracts service. */
  private _resellerContractsService: ResellerContractsService | null = null;

  /** Cached instance of the lazily loaded templates service. */
  private _templatesService: TemplatesService | null = null;

  /** Cached instance of the lazily loaded mail service. */
  private _mailService: MailService | null = null;

  /** Cached instance of the lazily loaded S3 service. */
  private _s3Service: S3Service | null = null;

  /** Cached instance of the lazily loaded tenants service. */
  private _tenantsService: TenantsService | null = null;

  /** Lazy-loaded contracts service. */
  private _contractsService: ContractsService | null = null;

  /** Cached instance of the lazily loaded users service. */
  private _usersService: UsersService | null = null;

  /** Cached instance of the lazily loaded trials service. */
  private _trialsService: TrialsService | null = null;

  /** Cached instance of the lazily loaded pending operations service. */
  private _pendingOperationsService: PendingOperationsService | null = null;

  /**
   * Constructor for OrdersService.
   * @param _orderModel the Dynamoose model used to persist orders.
   * @param _orderLineModel the Dynamoose model used to persist order lines.
   * @param _orderCustomizationModel the Dynamoose model used to persist customization requests.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the other services on demand.
   */
  constructor(
    @InjectModel("Order")
    private readonly _orderModel: Model<Order, OrderKey>,
    @InjectModel("OrderLine")
    private readonly _orderLineModel: Model<OrderLine, OrderLineKey>,
    @InjectModel("OrderCustomization")
    private readonly _orderCustomizationModel: Model<OrderCustomization, OrderCustomizationKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

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
   * Lazy loads the PlansService from its module.
   * @returns a Promise resolving to the PlansService instance.
   */
  private async _loadPlansService(): Promise<PlansService> {
    if (!this._plansService) {
      const { PlansLazyModule } = await import("../../../plans/lazy-plans/plans-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => PlansLazyModule);
      const { PlansService } = await import("../../../plans/lazy-plans/services/plans.service");
      this._plansService = moduleRef.get<PlansService>(PlansService);
    }
    return this._plansService;
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
   * Lazy loads the TenantsService from its module.
   * @returns a Promise resolving to the TenantsService instance.
   */
  private async _loadTenantsService(): Promise<TenantsService> {
    if (!this._tenantsService) {
      const { TenantsLazyModule } = await import("../../../tenants/lazy-tenants/tenants-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => TenantsLazyModule);
      const { TenantsService } = await import("../../../tenants/lazy-tenants/services/tenants.service");
      this._tenantsService = moduleRef.get<TenantsService>(TenantsService);
    }
    return this._tenantsService;
  }

  /**
   * Lazy loads the TrialsService from its module.
   * @returns a Promise resolving to the TrialsService instance.
   */
  private async _loadTrialsService(): Promise<TrialsService> {
    if (!this._trialsService) {
      const { TrialsLazyModule } = await import("../../../trials/lazy-trials/trials-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => TrialsLazyModule);
      const { TrialsService } = await import("../../../trials/lazy-trials/services/trials.service");
      this._trialsService = moduleRef.get<TrialsService>(TrialsService);
    }
    return this._trialsService;
  }

  /**
   * Lazy loads the UsersService from its module.
   * @returns a Promise resolving to the UsersService instance.
   */
  private async _loadUsersService(): Promise<UsersService> {
    if (!this._usersService) {
      const { UsersLazyModule } = await import("../../../users/lazy-users/users-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => UsersLazyModule);
      const { UsersService } = await import("../../../users/lazy-users/services/users.service");
      this._usersService = moduleRef.get<UsersService>(UsersService);
    }
    return this._usersService;
  }

  /**
   * Lazy loads the PendingOperationsService from its module.
   * @returns a Promise resolving to the PendingOperationsService instance.
   */
  private async _loadPendingOperationsService(): Promise<PendingOperationsService> {
    if (!this._pendingOperationsService) {
      const { PendingOperationsLazyModule } = await import("../../../pending-operations/lazy-pending-operations/pending-operations-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => PendingOperationsLazyModule);
      const { PendingOperationsService } = await import("../../../pending-operations/lazy-pending-operations/services/pending-operations.service");
      this._pendingOperationsService = moduleRef.get<PendingOperationsService>(PendingOperationsService);
    }
    return this._pendingOperationsService;
  }

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
   * Lazy loads the TemplatesService from its module.
   * @returns a Promise resolving to the TemplatesService instance.
   */
  private async _loadTemplatesService(): Promise<TemplatesService> {
    if (!this._templatesService) {
      const { TemplatesLazyModule } = await import("../../../templates/lazy-templates/templates-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => TemplatesLazyModule);
      const { TemplatesService } = await import("../../../templates/lazy-templates/services/templates.service");
      this._templatesService = moduleRef.get<TemplatesService>(TemplatesService);
    }
    return this._templatesService;
  }

  /**
   * Lazy loads the MailService from its module.
   * @returns a Promise resolving to the MailService instance.
   */
  private async _loadMailService(): Promise<MailService> {
    if (!this._mailService) {
      const { MailLazyModule } = await import("../../../mail/lazy-mail/mail-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => MailLazyModule);
      const { MailService } = await import("../../../mail/lazy-mail/services/mail.service");
      this._mailService = moduleRef.get<MailService>(MailService);
    }
    return this._mailService;
  }

  /**
   * Lazy loads the S3Service from its module.
   * @returns a Promise resolving to the S3Service instance.
   */
  private async _loadS3Service(): Promise<S3Service> {
    if (!this._s3Service) {
      const { S3LazyModule } = await import("../../../s3/lazy-s3/s3-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => S3LazyModule);
      const { S3Service } = await import("../../../s3/lazy-s3/services/s3.service");
      this._s3Service = moduleRef.get<S3Service>(S3Service);
    }
    return this._s3Service;
  }

  /**
   * Creates an order in DRAFT with its lines and its customization request.
   * @param orderDto the data to create the order with.
   * @param scope the request scope.
   * @returns the created order.
   * @throws ValidationException if there is no line, a customization is not on an active product, or two lines share a product.
   * @throws BusinessException if a product, a plan or a discount is not admitted on the channel. A product the company
   * already has is accepted: the draft stops at the next step (`_assertOrderFree`).
   * @throws AuthorizationException if the company is outside the requester's perimeter, or a Keus salesperson asks
   * for a company of a reseller.
   */
  async createOrder(orderDto: CreateOrderDto, scope: RequestScope): Promise<ResponseOrderDto> {
    this._assertNoDuplicateProducts(orderDto.lines);
    if ((orderDto.customizations ?? []).some(item => this._hasFiles(item))) {
      throw new ValidationException(
        "The customization files are attached by editing the draft: the order has no identifier yet.",
        [],
      );
    }

    try {
      const companiesService = await this._loadCompaniesService();
      const company = await companiesService.getCompany(orderDto.companyId, scope);
      // The indirect channel is the reseller's: a Keus salesperson reads its orders but opens only direct ones.
      if (isKeusSalespersonOnly(scope) && company.resellerPath) {
        throw new AuthorizationException(`Company ${company.id} is sold by a reseller: a Keus salesperson opens only direct orders.`);
      }
      const seller = await this._resolveSeller(company.resellerPath);

      if (orderDto.dealId) {
        await this._assertDealNotOpened(orderDto.dealId);
      }

      const id = uuidv4();
      const code = orderDto.code?.trim() || await this._generateOrderCode();
      const companyName = company.name;
      const lines = await this._buildLines({ id, code }, orderDto.lines, company, seller);
      const customizations = this._buildCustomizations({ id, code }, orderDto.customizations ?? [], lines, seller, scope, []);
      this._assertHasContent(lines);

      const requestedAt = new Date().toISOString();
      const order: Order = {
        id,
        code,
        companyId: company.id,
        companyName,
        status: OrderStatus.Draft,
        channel: seller.channel,
        requestedAt,
        requestMonth: requestedAt.slice(0, 7),
        ...this._summary(lines, customizations),
        ...(company.vatNumber && { companyVatNumber: company.vatNumber }),
        ...(seller.resellerPath && {
          resellerPath: seller.resellerPath,
          rootResellerCode: seller.rootResellerCode,
        }),
        // An order opened by the system, e.g. from a won deal, has no salesperson yet.
        ...(!scope.system && { assignedSalesId: scope.sub }),
        ...(orderDto.dealId && { dealId: orderDto.dealId }),
      };

      this._logger.log(`Creating order ${code} with ${lines.length} line(s)`);
      await transaction([
        this._orderModel.transaction.create(order, { overwrite: false }),
        ...lines.map(line => this._orderLineModel.transaction.create(line, { overwrite: false })),
        ...customizations.map(item => this._orderCustomizationModel.transaction.create(item, { overwrite: false })),
      ]);
      this._logger.log(`Order ${code} created successfully with ID: ${id}.`);

      return this.getOrder(id, scope);
    } catch (error) {
      if (this._isDomainError(error)) {
        throw error;
      }
      this._logger.error("Error creating order", error);
      throw new DatabaseException("An error occurred while creating the order.", error as Error);
    }
  }

  /**
   * Retrieves an order with its lines and its customization request.
   * @param id the identifier of the order.
   * @param scope the request scope.
   * @returns the order.
   * @throws EntityNotFoundException if the order does not exist.
   * @throws AuthorizationException if the order is outside the requester's perimeter.
   */
  async getOrder(id: string, scope: RequestScope): Promise<ResponseOrderDto> {
    try {
      const order = await this._getOrderOrThrow(id);
      await this._assertOrderVisible(order, scope);

      const [lines, customizations] = await Promise.all([
        this._getLines(id),
        this._getCustomizations(id),
      ]);
      // A draft says what would stop it at the next step, so the page can tell before the seller tries.
      const blockedBy = order.status === OrderStatus.Draft ? await this._draftBlocker(order, scope) : null;
      // Only who provisions reads where the tenants stand: the others do not need it, and are spared the reads.
      return this._toResponse(order, scope, this._provisions(scope) ? await this._withTenants(lines) : lines, customizations, blockedBy);
    } catch (error) {
      if (this._isDomainError(error)) {
        throw error;
      }
      this._logger.error(`Error retrieving order ${id}`, error);
      throw new DatabaseException(`An error occurred while retrieving the order with ID: ${id}.`, error as Error);
    }
  }

  /**
   * Lists one page of the orders visible to the requester, newest first.
   * Collaborators read one partition of the status index per status asked
   * (every status when none), merged by request date; a reseller, or a
   * collaborator previewing its workspace, reads its network off the reseller
   * index and keeps its own subtree and statuses. The period is a key
   * condition on the request date, the other filters are the page predicate,
   * so they never shorten a page.
   * @param query the page and its filters.
   * @param scope the request scope.
   * @returns the page of orders with their summary.
   * @throws ValidationException if the period is reversed or the cursor is not valid.
   */
  async listOrders(query: OrdersPageQueryDto, scope: RequestScope): Promise<ResponseOrdersPageDto> {
    const { limit, cursor, channel, search, from, to } = query;
    if (from && to && from > to) {
      throw new ValidationException("The period must not end before it starts.", []);
    }
    const lineStatuses = query.lineStatus ?? [];
    const ownership = await this._salesOwnership(scope);
    // Lines have a status only once the order is confirmed: the other partitions cannot match.
    const statuses = (query.status?.length ? query.status : Object.values(OrderStatus))
      .filter(status => !lineStatuses.length || LINE_STATUS_ORDER_STATUSES.includes(status));
    const accept = (order: Order): boolean =>
      (!lineStatuses.length || lineStatuses.some(lineStatus => this._hasLineIn(order, lineStatus)))
      && (!channel?.length || channel.includes(order.channel))
      && startsWithAny(search, order.code, order.companyName, order.companyVatNumber)
      && this._isOwnedBySalesperson(order, ownership);

    try {
      let page: Page<Order>;
      if (!isUnrestricted(scope) || query.resellerCode) {
        // A collaborator previewing a reseller workspace reads that reseller's network like the reseller does.
        const viewerPath = isUnrestricted(scope)
          ? await (await this._loadResellersService()).getResellerPath(query.resellerCode)
          : await this._viewerPath(scope);
        if (!viewerPath) {
          return { items: [] };
        }
        page = await paginate(
          () => this._requestedIn(
            this._orderModel.query("rootResellerCode").eq(viewerPath.split("#")[0]).using("resellerIndex").sort(SortOrder.descending),
            from,
            to,
          ),
          ["id", "rootResellerCode", "requestedAt"],
          limit,
          cursor,
          order => statuses.includes(order.status) && isPathVisible(viewerPath, order.resellerPath) && accept(order),
        );
      } else {
        page = await paginateMerged(
          statuses.map(status => ({
            id: status,
            build: () => this._requestedIn(
              this._orderModel.query("status").eq(status).using("statusIndex").sort(SortOrder.descending),
              from,
              to,
            ),
          })),
          ["id", "status", "requestedAt"],
          (a, b) => b.requestedAt.localeCompare(a.requestedAt),
          limit,
          cursor,
          accept,
        );
      }

      return { items: page.items.map(order => this._toResponse(order, scope)), nextCursor: page.nextCursor };
    } catch (error) {
      if (this._isDomainError(error)) {
        throw error;
      }
      this._logger.error("Error retrieving orders", error);
      throw new DatabaseException("An error occurred while retrieving the orders.", error as Error);
    }
  }

  /**
   * Retrieves the orders of a company, for its record.
   * @param companyId the identifier of the company.
   * @param scope the request scope.
   * @returns the orders of the company with their summary, newest first.
   * @throws EntityNotFoundException if the company does not exist.
   * @throws AuthorizationException if the company is outside the requester's perimeter.
   */
  async getOrdersByCompany(companyId: string, scope: RequestScope): Promise<ResponseOrderDto[]> {
    try {
      const companiesService = await this._loadCompaniesService();
      await companiesService.getCompany(companyId, scope);

      const orders = await this._orderModel
        .query("companyId").eq(companyId)
        .using("companyIndex")
        .sort(SortOrder.descending)
        .all()
        .exec();

      const ownership = await this._salesOwnership(scope);
      return orders
        .filter(order => this._isOwnedBySalesperson(order, ownership))
        .map(order => this._toResponse(order, scope));
    } catch (error) {
      if (this._isDomainError(error)) {
        throw error;
      }
      this._logger.error(`Error retrieving the orders of company ${companyId}`, error);
      throw new DatabaseException(`An error occurred while retrieving the orders of company ${companyId}.`, error as Error);
    }
  }

  /**
   * Retrieves who sells to a company, for the order form: the channel and, on the
   * indirect channel, the enabled products and the margin of the selling reseller.
   * The reseller is read on the server side: a Keus salesperson sells to the companies
   * of every reseller, while it reads only its own resellers.
   * @param companyId the identifier of the company.
   * @param scope the request scope.
   * @returns the seller; without margin when there is no contract in force, or for a reseller salesperson.
   * @throws EntityNotFoundException if the company does not exist.
   * @throws AuthorizationException if the company is outside the requester's perimeter.
   */
  async getSeller(companyId: string, scope: RequestScope): Promise<ResponseOrderSellerDto> {
    try {
      const companiesService = await this._loadCompaniesService();
      const company = await companiesService.getCompany(companyId, scope);
      if (!company.resellerPath) {
        return { channel: SalesChannel.Direct };
      }

      const code = company.resellerPath.split("#").filter(Boolean).pop() ?? "";
      const resellersService = await this._loadResellersService();
      const reseller = await resellersService.getResellerByCode(code);
      if (!reseller) {
        throw new EntityNotFoundException("Reseller", code);
      }

      const resellerContractsService = await this._loadResellerContractsService();
      // The products come from the contract in force; the margin only from it too, and not for a reseller salesperson.
      const contract = await resellerContractsService.findContractInForceOf(reseller);
      return {
        channel: SalesChannel.Reseller,
        resellerId: reseller.id,
        resellerCode: reseller.code,
        resellerName: reseller.companyName,
        productIds: contract?.productIds ?? [],
        ...(!isSalespersonOnly(scope) && contract?.margin && { margin: contract.margin }),
      };
    } catch (error) {
      if (this._isDomainError(error)) {
        throw error;
      }
      this._logger.error(`Error retrieving the seller of company ${companyId}`, error);
      throw new DatabaseException(`An error occurred while retrieving the seller of company ${companyId}.`, error as Error);
    }
  }

  /**
   * Edits a draft order, replacing its lines and its customization requests.
   * Lines are recomputed from the current plans and terms: a draft carries no
   * agreement yet, only the offer freezes the prices. The customization files
   * that drop out of the order are deleted from S3.
   * @param id the identifier of the order.
   * @param orderDto the data to apply.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws BusinessException if the order is no longer a draft, or changed while it was being edited.
   */
  async updateOrder(id: string, orderDto: UpdateOrderDto, scope: RequestScope): Promise<ResponseOrderDto> {
    try {
      const order = await this._getOrderOrThrow(id);
      await this._assertOrderSellable(order, scope);
      this._assertDraft(order);

      const [currentLines, currentCustomizations] = await Promise.all([
        this._getLines(id),
        this._getCustomizations(id),
      ]);
      const seller = await this._resolveSeller(order.resellerPath);
      // Lines and customization carry a copy of the code: a new code rewrites them too.
      const code = orderDto.code?.trim() || order.code;
      const codeChanged = code !== order.code;

      let lines = currentLines.map(line => ({ ...line, orderCode: code }));
      if (orderDto.lines) {
        this._assertNoDuplicateProducts(orderDto.lines);
        const companiesService = await this._loadCompaniesService();
        const company = await companiesService.getCompany(order.companyId, scope);
        lines = await this._buildLines({ id, code }, orderDto.lines, company, seller);
      }

      const keptProducts = new Set(lines.map(line => line.productId));
      let customizations = currentCustomizations.map(item => ({ ...item, orderCode: code }));
      if (orderDto.customizations) {
        customizations = this._buildCustomizations({ id, code }, orderDto.customizations, lines, seller, scope, currentCustomizations);
      } else if (orderDto.lines) {
        // A line taken away takes its customization with it.
        customizations = customizations.filter(item => item.kind !== CustomizationKind.Product || keptProducts.has(item.productId));
      }
      this._assertHasContent(lines);
      const writeLines = Boolean(orderDto.lines) || codeChanged;
      const writeCustomizations = Boolean(orderDto.customizations) || codeChanged;

      const removedLines = orderDto.lines ? currentLines.filter(line => !keptProducts.has(line.productId)) : [];
      const keptCustomizations = new Set(customizations.map(item => item.id));
      const removedCustomizations = currentCustomizations.filter(item => !keptCustomizations.has(item.id));

      this._logger.log(`Updating draft order ${order.code}`);
      await transaction([
        this._orderModel.transaction.update(
          { id },
          { ...this._summary(lines, customizations), ...(codeChanged && { code }) },
          { condition: new Condition().where("status").eq(OrderStatus.Draft) },
        ),
        ...(writeLines ? lines.map(line => this._orderLineModel.transaction.create(line, { overwrite: true })) : []),
        ...removedLines.map(line => this._orderLineModel.transaction.delete({ productId: line.productId, orderId: id })),
        ...(writeCustomizations ? customizations.map(item => this._orderCustomizationModel.transaction.create(item, { overwrite: true })) : []),
        ...removedCustomizations.map(item => this._orderCustomizationModel.transaction.delete({ orderId: id, id: item.id })),
      ]);
      this._logger.log(`Draft order ${order.code} updated successfully.`);
      await this._deleteCustomizationFiles(currentCustomizations, customizations);

      return this.getOrder(id, scope);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        throw new BusinessException(
          `Order ${id} changed while it was being edited: reload it and try again.`,
          "ORDER_CHANGED",
        );
      }
      if (this._isDomainError(error)) {
        throw error;
      }
      this._logger.error(`Error updating order ${id}`, error);
      throw new DatabaseException(`An error occurred while updating the order with ID: ${id}.`, error as Error);
    }
  }

  /**
   * Deletes a draft, refused or cancelled order with its lines, its customization request and its files: the
   * attachments, the signed offer and the contract of the finance company. A refused or cancelled order never reached
   * the confirmation, so no tenant or contract hangs on it; it leaves the sales metrics of the open months.
   * @param id the identifier of the order.
   * @param scope the request scope.
   * @throws BusinessException if the order is still on its way or confirmed.
   */
  async deleteOrder(id: string, scope: RequestScope): Promise<void> {
    try {
      const order = await this._getOrderOrThrow(id);
      await this._assertOrderSellable(order, scope);
      this._assertStatusIn(order, DELETABLE_STATUSES, "deleted");

      const [lines, customizations] = await Promise.all([
        this._getLines(id),
        this._getCustomizations(id),
      ]);

      await transaction([
        this._orderModel.transaction.delete(
          { id },
          { condition: new Condition().where("status").in(DELETABLE_STATUSES) },
        ),
        ...lines.map(line => this._orderLineModel.transaction.delete({ productId: line.productId, orderId: id })),
        ...customizations.map(item => this._orderCustomizationModel.transaction.delete({ orderId: id, id: item.id })),
      ]);
      this._logger.log(`Order ${order.code} deleted with ${lines.length} line(s)`);
      await this._deleteCustomizationFiles(customizations, []);
      await this._deleteOrderDocuments(order);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        throw new BusinessException(
          `Order ${id} changed while it was being deleted: reload it and try again.`,
          "ORDER_CHANGED",
        );
      }
      if (this._isDomainError(error)) {
        throw error;
      }
      this._logger.error(`Error deleting order ${id}`, error);
      throw new DatabaseException(`An error occurred while deleting the order with ID: ${id}.`, error as Error);
    }
  }

  /**
   * Rewrites the name and the VAT number of a company on its open orders and
   * their lines, after the company record changed. Closed orders keep the name
   * they were raised under, because they document an agreement made at that time.
   * @param companyId the identifier of the company.
   * @param companyName the legal name of the company.
   * @param vatNumber the VAT number of the company.
   */
  async syncCompanyDetails(companyId: string, companyName: string, vatNumber: string | undefined): Promise<void> {
    const orders = await this._orderModel
      .query("companyId").eq(companyId)
      .using("companyIndex")
      .all()
      .exec();
    const open = orders.filter(order =>
      !FINAL_STATUSES.includes(order.status) && (order.companyName !== companyName || order.companyVatNumber !== vatNumber));

    for (const order of open) {
      const lines = await this._getLines(order.id);
      await transaction([
        this._orderModel.transaction.update(
          { id: order.id },
          withRemoval<Order>({ companyName, ...(vatNumber && { companyVatNumber: vatNumber }) }, vatNumber ? [] : ["companyVatNumber"]),
        ),
        ...lines.map(line => this._orderLineModel.transaction.update(
          { productId: line.productId, orderId: line.orderId },
          { companyName },
        )),
      ]);
    }
    this._logger.log(`Company ${companyId}: details rewritten on ${open.length} open order(s)`);
  }

  /**
   * Rewrites the name of a product on its order lines and on the summary of
   * their orders, after the product was renamed.
   * @param productId the identifier of the product.
   * @param productName the new name of the product.
   */
  async syncProductName(productId: string, productName: string): Promise<void> {
    const lines = await this._orderLineModel.query("productId").eq(productId).all().exec();
    const renamed = lines.filter(line => line.productName !== productName);

    for (const line of renamed) {
      const order = await this._orderModel.get({ id: line.orderId });
      const productNames = order?.productIds.map((id, index) => id === productId ? productName : order.productNames[index]);
      await transaction([
        this._orderLineModel.transaction.update({ productId, orderId: line.orderId }, { productName }),
        ...(order && productNames ? [this._orderModel.transaction.update({ id: order.id }, { productNames })] : []),
      ]);
    }
    this._logger.log(`Product ${productId}: name rewritten on ${renamed.length} order line(s)`);
  }

  /**
   * Sends a draft with a customization request to the back office for pricing.
   * @param id the identifier of the order.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws BusinessException if the order is not a draft, has no customization waiting to be priced, or a product is held (`_assertOrderFree`).
   */
  async requestQuote(id: string, scope: RequestScope): Promise<ResponseOrderDto> {
    return this._runAction(id, "requesting the pricing of", async (order, afterCommit) => {
      await this._assertOrderSellable(order, scope);
      this._assertDraft(order);
      await this._assertOrderFree(order, scope);
      if (order.pendingCustomizations === 0) {
        throw new BusinessException(
          `Order ${order.code} has no customization waiting to be priced.`,
          "ORDER_WITHOUT_CUSTOMIZATION",
        );
      }

      afterCommit(() => this._noticeKeus(MailTemplate.QuoteRequested, order, { count: order.pendingCustomizations }));
      return [this._orderTransition(order, OrderStatus.ToBePriced)];
    }, scope);
  }

  /**
   * Saves the quotation of an order: the back office prices or refuses its customizations in one go, and none may be
   * left to price. The order moves to PRICED and the seller gets one email with the outcomes. Allowed again until the
   * offer goes out, voiding the approval of a reseller offer: once the offer is generated its amounts are those the
   * customer signs, and they no longer change.
   * @param id the identifier of the order.
   * @param quotationDto the outcome of the customizations.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws ValidationException if an outcome is both or neither priced and refused, or a customization repeats.
   * @throws EntityNotFoundException if a customization is not of the order.
   * @throws BusinessException if the offer already went out, or a customization is left to price.
   */
  async saveQuotation(id: string, quotationDto: SaveQuotationDto, scope: RequestScope): Promise<ResponseOrderDto> {
    const evaluations = new Map(quotationDto.evaluations.map(evaluation => [evaluation.customizationId, evaluation]));
    if (evaluations.size !== quotationDto.evaluations.length) {
      throw new ValidationException("Each customization can be evaluated once.", []);
    }
    for (const evaluation of evaluations.values()) {
      const priced = evaluation.listOneOffCents !== undefined || evaluation.listRecurringIncreaseCents !== undefined;
      if (priced === !!evaluation.refusalReason?.trim()) {
        throw new ValidationException("Price a customization with one or both amounts, or refuse it with a reason.", []);
      }
    }

    return this._runAction(id, "saving the quotation of", async (order, afterCommit) => {
      await this._assertOrderVisible(order, scope);
      this._assertStatusIn(order, [OrderStatus.ToBePriced, OrderStatus.Priced, OrderStatus.Approved], "priced");
      const customizations = await this._getCustomizations(order.id);
      for (const customizationId of evaluations.keys()) {
        if (!customizations.some(item => item.id === customizationId)) {
          throw new EntityNotFoundException("OrderCustomization", customizationId);
        }
      }

      const evaluatedAt = new Date().toISOString();
      const evaluated = customizations.flatMap(customization => {
        const evaluation = evaluations.get(customization.id);
        return evaluation ? [this._evaluateCustomization(customization, evaluation, scope.sub, evaluatedAt)] : [];
      });
      const outcomes = customizations.map(customization =>
        evaluated.find(item => item.outcome.id === customization.id)?.outcome ?? customization);
      if (outcomes.some(item => item.status === CustomizationStatus.Requested)) {
        throw new BusinessException("Price or refuse every customization before saving the quotation.", "CUSTOMIZATION_NOT_PRICED");
      }

      afterCommit(() => this._noticeQuotation(order, outcomes));
      return [
        this._orderTransition(order, OrderStatus.Priced, { pendingCustomizations: 0 }, APPROVAL_ATTRIBUTES),
        ...evaluated.map(({ outcome, set, remove }) => this._orderCustomizationModel.transaction.update(
          { orderId: order.id, id: outcome.id },
          withRemoval<OrderCustomization>(set, remove),
        )),
      ];
    }, scope);
  }

  /**
   * Applies the outcome of the back office to a customization, without writing it.
   * @param customization the customization as stored.
   * @param evaluation the outcome: list amounts, or a refusal reason.
   * @param sub the back-office collaborator.
   * @param evaluatedAt when it was evaluated (ISO).
   * @returns the customization as it will be stored, with the attributes to set and to remove.
   */
  private _evaluateCustomization(
    customization: OrderCustomization,
    evaluation: CustomizationEvaluation,
    sub: string,
    evaluatedAt: string,
  ): { outcome: OrderCustomization; set: Partial<OrderCustomization>; remove: (keyof OrderCustomization)[] } {
    const reason = evaluation.refusalReason?.trim();
    const set: Partial<OrderCustomization> = {
      ...(reason
        ? { status: CustomizationStatus.Refused, refusalReason: reason }
        : {
          status: CustomizationStatus.Quoted,
          ...this._priceCustomization(
            evaluation.listOneOffCents,
            evaluation.listRecurringIncreaseCents,
            customization.discountPercent,
            customization.resellerMarginPercent,
          ),
        }),
      evaluatedBySub: sub,
      evaluatedAt,
    };
    const remove: (keyof OrderCustomization)[] = reason ? [...CUSTOMIZATION_AMOUNTS] : ["refusalReason", ...this._absentAmounts(set)];
    const outcome = { ...customization, ...set };
    for (const key of remove) {
      delete outcome[key];
    }
    return { outcome, set, remove };
  }

  /**
   * Sets the discount the seller grants on a customization, before the offer.
   * @param id the identifier of the order.
   * @param customizationId the identifier of the customization.
   * @param discountDto the discount.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws BusinessException if the offer already went out, or the discount exceeds the reseller margin.
   */
  async setCustomizationDiscount(id: string, customizationId: string, discountDto: CustomizationDiscountDto, scope: RequestScope): Promise<ResponseOrderDto> {
    return this._runAction(id, "discounting the customization of", async order => {
      await this._assertOrderSellable(order, scope);
      this._assertStatusIn(order, [OrderStatus.Priced], "discounted");
      const { customization } = await this._getCustomizationOrThrow(order, customizationId);
      if (customization.status !== CustomizationStatus.Quoted) {
        throw new BusinessException(`The customization of order ${order.code} is ${customization.status}: only a priced one can be discounted.`, "CUSTOMIZATION_NOT_QUOTED");
      }

      // The reseller's discount comes out of its margin: past it, the reseller would sell at a loss.
      if (customization.resellerMarginPercent !== undefined && discountDto.discountPercent > customization.resellerMarginPercent) {
        throw new BusinessException(
          "The discount on the customization exceeds the reseller margin.",
          "DISCOUNT_EXCEEDS_MARGIN",
          { margin: customization.resellerMarginPercent },
        );
      }

      const amounts = this._priceCustomization(
        customization.listOneOffCents,
        customization.listRecurringIncreaseCents,
        discountDto.discountPercent,
        customization.resellerMarginPercent,
      );
      return [
        this._orderModel.transaction.condition({ id: order.id }, new Condition().where("status").eq(order.status)),
        this._orderCustomizationModel.transaction.update(
          { orderId: order.id, id: customization.id },
          { ...amounts, discountPercent: discountDto.discountPercent },
        ),
      ];
    }, scope);
  }

  /**
   * Asks the Keus back office to approve the offer of a reseller order, once every customization is priced.
   * @param id the identifier of the order.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws BusinessException if the order is not of a reseller, still has customizations to price, a line is incomplete, or a product is held (`_assertOrderFree`).
   */
  async requestApproval(id: string, scope: RequestScope): Promise<ResponseOrderDto> {
    return this._runAction(id, "requesting the approval of", async (order, afterCommit) => {
      await this._assertOrderSellable(order, scope);
      if (order.channel !== SalesChannel.Reseller) {
        throw new BusinessException("Only the offer of a reseller needs the approval of Keus.", "APPROVAL_RESELLER_ONLY");
      }

      this._assertStatusIn(order, [OrderStatus.Draft, OrderStatus.Priced], "sent for approval");
      await this._assertOrderFree(order, scope);
      if (order.pendingCustomizations > 0) {
        throw new BusinessException("Request the pricing of the customizations before the approval.", "CUSTOMIZATION_NOT_PRICED");
      }
      this._assertLinesComplete(await this._getLines(order.id));

      afterCommit(() => this._noticeKeus(MailTemplate.ApprovalRequested, order, {}));
      return [this._orderTransition(order, OrderStatus.ToBeApproved, { approvalRequestedAt: new Date().toISOString() }, ["approvalRefusalReason"])];
    }, scope);
  }

  /**
   * Approves the offer of a reseller order: the reseller can now generate it.
   * @param id the identifier of the order.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws BusinessException if the order is not waiting for approval.
   */
  async approveOffer(id: string, scope: RequestScope): Promise<ResponseOrderDto> {
    return this._runAction(id, "approving the offer of", async (order, afterCommit) => {
      await this._assertOrderVisible(order, scope);
      this._assertStatusIn(order, [OrderStatus.ToBeApproved], "approved");
      afterCommit(() => this._noticeSeller(MailTemplate.ApprovalGranted, order, {}));
      return [this._orderTransition(order, OrderStatus.Approved, { approvedAt: new Date().toISOString(), approvedBySub: scope.sub })];
    }, scope);
  }

  /**
   * Refuses the approval of the offer of a reseller order, with a reason: the order goes back to the reseller, priced
   * when it has customizations, as a draft otherwise.
   * @param id the identifier of the order.
   * @param refusalDto the reason of the refusal.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws BusinessException if the order is not waiting for approval.
   */
  async refuseApproval(id: string, refusalDto: RefuseApprovalDto, scope: RequestScope): Promise<ResponseOrderDto> {
    return this._runAction(id, "refusing the approval of", async (order, afterCommit) => {
      await this._assertOrderVisible(order, scope);
      this._assertStatusIn(order, [OrderStatus.ToBeApproved], "refused approval");
      afterCommit(() => this._noticeSeller(MailTemplate.ApprovalRefused, order, { reason: refusalDto.reason.trim() }));
      const next = order.hasCustomization ? OrderStatus.Priced : OrderStatus.Draft;
      return [this._orderTransition(order, next, { approvalRefusalReason: refusalDto.reason.trim() }, ["approvalRequestedAt"])];
    }, scope);
  }

  /**
   * Records that the offer has been generated from the template in force and sent.
   * The document itself is compiled by the frontend and not stored.
   * @param id the identifier of the order.
   * @param offerDto the template the offer was generated from.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws BusinessException if the customization is not priced, a line is incomplete, the template is not the one in force, or a product is held (`_assertOrderFree`).
   */
  async generateOffer(id: string, offerDto: GenerateOfferDto, scope: RequestScope): Promise<ResponseOrderDto> {
    return this._runAction(id, "generating the offer of", async order => {
      await this._assertOrderSellable(order, scope);
      // A reseller's offer goes out only once the Keus back office has approved it.
      this._assertStatusIn(
        order,
        order.channel === SalesChannel.Reseller ? [OrderStatus.Approved] : [OrderStatus.Draft, OrderStatus.Priced],
        "offered",
      );
      await this._assertOrderFree(order, scope);
      if (order.pendingCustomizations > 0) {
        throw new BusinessException("Price the customization before generating the offer.", "CUSTOMIZATION_NOT_PRICED");
      }
      this._assertLinesComplete(await this._getLines(order.id));

      const templatesService = await this._loadTemplatesService();
      const template = await templatesService.resolveTemplate(TemplateType.Offer, order.channel);
      if (!template) {
        throw new BusinessException("No published offer template for this channel.", "OFFER_TEMPLATE_MISSING", { channel: order.channel });
      }
      if (template.id !== offerDto.templateId) {
        throw new BusinessException(
          "The offer template in force has changed: generate the offer again.",
          "OFFER_TEMPLATE_OUTDATED",
          { templateId: template.id },
        );
      }

      return [this._orderTransition(order, OrderStatus.Sent, {
        offerTemplateId: template.id,
        offerGeneratedAt: new Date().toISOString(),
      })];
    }, scope);
  }

  /**
   * Records the acceptance of the offer with the signed copy, and tells the Keus back office the order waits for its
   * confirmation; on the reseller channel the reseller gets a receipt too.
   * @param id the identifier of the order.
   * @param acceptDto the S3 key of the signed offer.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws ValidationException if the file is not the order's signed offer.
   * @throws BusinessException if the offer has not been sent.
   */
  async acceptOrder(id: string, acceptDto: AcceptOrderDto, scope: RequestScope): Promise<ResponseOrderDto> {
    return this._runAction(id, "accepting", async (order, afterCommit) => {
      await this._assertOrderSellable(order, scope);
      this._assertOrderFile(order, acceptDto.signedOfferS3Key, `orders/${order.id}/signed-offer.pdf`);

      afterCommit(() => this._noticeKeus(MailTemplate.OrderAccepted, order, {}));
      if (order.channel === SalesChannel.Reseller) {
        afterCommit(() => this._noticeSeller(MailTemplate.OrderSubmitted, order, {}));
      }

      return [this._orderTransition(order, OrderStatus.Accepted, {
        signedOfferS3Key: acceptDto.signedOfferS3Key,
        acceptedAt: new Date().toISOString(),
      })];
    }, scope);
  }

  /**
   * Records the refusal of the offer, with a reason from the closed list.
   * @param id the identifier of the order.
   * @param refusalDto the reason and the note.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws ValidationException if the reason is OTHER and the note is missing.
   * @throws BusinessException if the offer has not been sent.
   */
  async refuseOrder(id: string, refusalDto: RefuseOrderDto, scope: RequestScope): Promise<ResponseOrderDto> {
    const note = refusalDto.note?.trim();
    if (refusalDto.reason === OrderRefusalReason.Other && !note) {
      throw new ValidationException("Specify the reason in the note.", []);
    }

    return this._runAction(id, "refusing", async order => {
      await this._assertOrderSellable(order, scope);
      this._assertStatusIn(order, [OrderStatus.Sent], "refused");
      return [this._orderTransition(order, OrderStatus.Refused, {
        refusalReason: refusalDto.reason,
        ...(note && { refusalNote: note }),
      })];
    }, scope);
  }

  /**
   * Marks an order of the direct channel as financed, or removes the financing.
   * A financed order skips the direct debit: its invoice goes to the finance company.
   * @param id the identifier of the order.
   * @param financingDto the finance company, the application and its contract.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws BusinessException if the order is on the indirect channel or already confirmed.
   */
  async updateFinancing(id: string, financingDto: UpdateFinancingDto, scope: RequestScope): Promise<ResponseOrderDto> {
    return this._runAction(id, "updating the financing of", async order => {
      await this._assertOrderSellable(order, scope);
      if (order.channel !== SalesChannel.Direct) {
        throw new BusinessException("Only an order of the direct channel can be financed.", "FINANCING_DIRECT_ONLY");
      }
      this._assertStatusIn(order, [OrderStatus.Draft, OrderStatus.ToBePriced, OrderStatus.Priced, OrderStatus.Sent, OrderStatus.Accepted], "financed");

      const condition = { condition: new Condition().where("status").eq(order.status) };
      if (financingDto.financier === Financier.None) {
        return [this._orderModel.transaction.update(
          { id: order.id },
          withRemoval<Order>({}, ["financier", "financierReference", "financingContractS3Key", "financedYears"]),
          condition,
        )];
      }

      if (financingDto.financingContractS3Key) {
        this._assertOrderFile(order, financingDto.financingContractS3Key, `orders/${order.id}/financing-contract.pdf`, false);
      }
      const reference = financingDto.financierReference?.trim();
      return [this._orderModel.transaction.update(
        { id: order.id },
        {
          financier: financingDto.financier,
          ...(reference && { financierReference: reference }),
          ...(financingDto.financingContractS3Key && { financingContractS3Key: financingDto.financingContractS3Key }),
          ...(financingDto.financedYears && { financedYears: financingDto.financedYears }),
        },
        condition,
      )];
    }, scope);
  }

  /**
   * Confirms an accepted order with the expected delivery date, and releases
   * its lines for provisioning.
   * The fiscal data are checked here and not at provisioning, because this is
   * the last moment at which the process can stop with nothing delivered.
   * @param id the identifier of the order.
   * @param confirmDto the expected delivery date.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws BusinessException if the order is not accepted, the fiscal data are incomplete, the IBAN or the financing contract is missing.
   */
  async confirmOrder(id: string, confirmDto: ConfirmOrderDto, scope: RequestScope): Promise<ResponseOrderDto> {
    return this._runAction(id, "confirming", async (order, afterCommit) => {
      await this._assertOrderVisible(order, scope);
      this._assertTransition(order, OrderStatus.Confirmed);

      const companiesService = await this._loadCompaniesService();
      const company = await companiesService.getCompany(order.companyId, scope);
      this._assertFiscalDataComplete(company);

      const financed = order.financier !== undefined && order.financier !== Financier.None;
      if (financed && !order.financingContractS3Key) {
        throw new BusinessException("Upload the contract of the finance company before confirming.", "FINANCING_CONTRACT_MISSING");
      }
      if (order.channel === SalesChannel.Direct && !financed && !company.iban) {
        throw new BusinessException("IBAN missing: required on the direct channel.", "COMPANY_IBAN_MISSING");
      }

      const lines = await this._getLines(order.id);
      if (financed && !order.financedYears && await this._hasRecurringLine(lines)) {
        throw new BusinessException("Set the years the finance company pays before confirming.", "FINANCED_YEARS_MISSING");
      }
      if (order.channel === SalesChannel.Reseller) {
        afterCommit(() => this._noticeOrderConfirmed(order, lines, confirmDto.deliveryDate));
      } else {
        // The direct-channel notice goes to the company, an end customer, so the product sends it:
        // still open, since before provisioning the company has no tenant on the product.
        this._logger.log(`Order ${order.code} confirmed: no notice to the company on the direct channel yet.`);
      }

      // The lines carry the confirmation too: the provisioning time of each one is read from the line alone.
      const confirmedAt = new Date().toISOString();
      return [
        this._orderTransition(order, OrderStatus.Confirmed, { deliveryDate: confirmDto.deliveryDate, confirmedAt }),
        ...lines.map(line => this._orderLineModel.transaction.update(
          { productId: line.productId, orderId: line.orderId },
          { status: OrderLineStatus.ToBeProvisioned, confirmedAt },
        )),
      ];
    }, scope);
  }

  /**
   * Lists one page of the lines waiting to be provisioned: those of a product, or of every product.
   * Each product is a partition of the status index; with every product they
   * are read one after the other, in the order of the product list.
   * @param query the page and its filters.
   * @returns the page of lines in TO_BE_PROVISIONED, the ones already requested included.
   * @throws ValidationException if the cursor is not valid.
   * @throws DatabaseException if the query fails.
   */
  async listProvisioningQueue(query: ProvisioningPageQueryDto): Promise<ResponseOrderLinesPageDto> {
    const { limit, cursor, productId, search } = query;

    try {
      const productIds = productId
        ? [productId]
        : (await (await this._loadProductsService()).getAllProducts()).map(product => product.id);
      const page = await paginateMerged<OrderLine>(
        productIds.map(id => ({
          id,
          build: () => this._orderLineModel
            .query("productId").eq(id)
            .where("status").eq(OrderLineStatus.ToBeProvisioned)
            .using("statusIndex"),
        })),
        ["productId", "orderId", "status"],
        (a, b) => productIds.indexOf(a.productId) - productIds.indexOf(b.productId),
        limit,
        cursor,
        line => startsWithAny(search, line.orderCode, line.companyName),
      );
      // The queue shows where each requested tenant stands, read in one request for the whole page.
      const lines = await this._withTenants(page.items);
      return {
        items: lines.map(line => plainToInstance(ResponseOrderLineDto, line, { excludeExtraneousValues: true })),
        nextCursor: page.nextCursor,
      };
    } catch (error) {
      if (error instanceof ValidationException) {
        throw error;
      }
      this._logger.error("Error listing the provisioning queue", error);
      throw new DatabaseException("An error occurred while listing the lines to provision.", error);
    }
  }

  /**
   * Provisions an order line: in one transaction the tenant is written in REQUESTED with its pending operation,
   * the users with theirs, deferred until the product confirms the tenant, and the line points at the tenant.
   * Then the tenant request is sent; the users follow at its confirmation. The first user is the referent.
   * @param orderId the order of the line.
   * @param productId the product of the line.
   * @param provisionDto the tenant and its users.
   * @param scope the request scope.
   * @returns the line, with its tenant.
   * A line whose tenant the operator cancelled can be provisioned again with a new tenant.
   * @throws BusinessException if the order is not confirmed, the line is not waiting or already requested, the users exceed the seats, or a role is unknown to the product.
   */
  async provisionLine(orderId: string, productId: string, provisionDto: ProvisionLineDto, scope: RequestScope): Promise<ResponseOrderLineDto> {
    const order = await this._getOrderOrThrow(orderId);
    await this._assertOrderVisible(order, scope);
    const line = await this._getLineToProvision(order, productId);
    const companyIds = await (await this._loadCompaniesService()).getCompanyGroupIds(order.companyId);
    await this._assertNoContractInForce(companyIds, [productId]);
    const tenantsService = await this._loadTenantsService();
    const users = provisionDto.users;
    const maxUsers = Math.min(line.seats ?? MAX_PROVISIONED_USERS, MAX_PROVISIONED_USERS);
    if (users.length > maxUsers) {
      throw new BusinessException(`The line of ${line.productName} provisions at most ${maxUsers} users.`, "TOO_MANY_USERS", { max: maxUsers });
    }
    const product = await (await this._loadProductsService()).getProduct(productId);
    const unknownRoles = [...new Set(users.flatMap(user => user.roles))].filter(role => !product.roles.includes(role));
    if (unknownRoles.length > 0) {
      throw new BusinessException(`Roles unknown to ${product.name}: ${unknownRoles.join(", ")}.`, "UNKNOWN_ROLES", { roles: unknownRoles });
    }

    const usersService = await this._loadUsersService();
    const tenantRequest = await tenantsService.prepareTenantRequest({
      productId,
      name: provisionDto.tenant.name,
      ...(provisionDto.tenant.description && { description: provisionDto.tenant.description }),
      data: provisionDto.tenant.data ?? {},
      orderId,
      accountType: AccountType.Company,
      ...(line.seats && { maxConstraintValue: line.seats }),
    }, { resellerPath: line.resellerPath, pendingUsers: users.length, requestedBy: scope.system ? undefined : scope.sub });
    const userContext = {
      tenantName: tenantRequest.tenant.name,
      productName: product.name,
      ...(line.resellerPath && { resellerPath: line.resellerPath }),
    };
    const userRequests = await Promise.all(users.map((user, index) => usersService.prepareUserRequest(
      { ...user, productId, tenant: tenantRequest.tenant.id, accountType: AccountType.Company, ...userContext } as CreateUserDto,
      userContext,
      { deferred: true, referent: index === 0, requestedBy: scope.system ? undefined : scope.sub },
    )));

    const contractsService = await this._loadContractsService();
    try {
      this._logger.log(`Provisioning the line of ${line.productName} of order ${order.code}`);
      await transaction([
        ...tenantRequest.writes,
        ...userRequests.flatMap(request => request.writes),
        this._orderLineModel.transaction.update(
          { productId, orderId },
          { tenantId: tenantRequest.tenant.id },
          { condition: this._lineRequestCondition(line) },
        ),
        ...companyIds.map(companyId => contractsService.productHoldWrite(companyId, productId, orderId)),
      ]);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        await this._assertProductNotHeld(order, productId, companyIds);
        throw new BusinessException(`The line of ${line.productName} changed while it was being provisioned: reload it.`, "ORDER_CHANGED");
      }
      this._logger.error(`Error provisioning the line of ${line.productName} of order ${order.code}`, error);
      throw new DatabaseException("An error occurred while provisioning the order line.", error as Error);
    }

    const pendingOperationsService = await this._loadPendingOperationsService();
    await pendingOperationsService.dispatch(tenantRequest.operation);
    return plainToInstance(ResponseOrderLineDto, { ...line, tenantId: tenantRequest.tenant.id }, { excludeExtraneousValues: true });
  }

  /**
   * Provisions an order line on a tenant the product already has, such as the tenant of a trial or of a terminated
   * contract, so that the customer keeps its users and data. Nothing is asked to the product:
   *   - one transaction points the line at the tenant, hands it the order and the seats of the line, and converts its
   *     trial, so that the trial no longer expires;
   *   - the line reactivates an inactive tenant, its users through operations to the product, and cancels the
   *     schedules of the trial;
   *   - the line is then recorded as provisioned as for a new tenant: the contract is born and the referent accepts it
   *     at the next access. A previous contract stays as it is, terminated, with its own link to the tenant.
   * A step that stops halfway leaves the line to provision with its tenant, to be completed by hand from the order.
   * @param orderId the order of the line.
   * @param productId the product of the line.
   * @param tenantId the existing tenant, on the product of the line.
   * @param scope the request scope.
   * @returns the line, provisioned on the tenant.
   * @throws BusinessException if the order is not confirmed, the line is not waiting or already requested, the tenant is not on the product, has a contract in force, belongs to another company, comes from another channel or has no referent, or the line could not be recorded after the tenant was linked.
   */
  async provisionLineOnTenant(orderId: string, productId: string, tenantId: string, scope: RequestScope): Promise<ResponseOrderLineDto> {
    const order = await this._getOrderOrThrow(orderId);
    await this._assertOrderVisible(order, scope);
    const line = await this._getLineToProvision(order, productId);
    const tenantsService = await this._loadTenantsService();
    const tenant = await tenantsService.getTenant(productId, tenantId, scope);
    if (![TenantStatus.Active, TenantStatus.Inactive].includes(tenant.status)) {
      throw new BusinessException(`Tenant ${tenant.name} is not on the product: only an active or inactive tenant can take an order line.`, "TENANT_NOT_REUSABLE");
    }
    // Tenant and users carry the reseller lineage, which a line of another channel would leave behind.
    if (tenant.resellerPath !== line.resellerPath) {
      throw new BusinessException(`Tenant ${tenant.name} comes from another sales channel than the order.`, "TENANT_OF_ANOTHER_CHANNEL");
    }
    if (tenant.contractId) {
      const contract = await (await this._loadContractsService()).getContract(productId, tenant.contractId, SYSTEM_SCOPE);
      if (IN_FORCE_STATUSES.includes(contract.status)) {
        throw new BusinessException(`Tenant ${tenant.name} has contract ${contract.code} in force: a new one can follow only once it is terminated.`, "TENANT_CONTRACT_IN_FORCE");
      }
      if (contract.companyId !== order.companyId) {
        throw new BusinessException(`Tenant ${tenant.name} belongs to another company than the order.`, "TENANT_OF_ANOTHER_COMPANY");
      }
    }
    // A tenant with an order and no contract is being handed to that order: it would land on two lines.
    if (!tenant.contractId && tenant.orderId && tenant.orderId !== order.id) {
      throw new BusinessException(`Tenant ${tenant.name} is being provisioned for another order.`, "TENANT_IN_PROVISIONING");
    }
    const companyIds = await (await this._loadCompaniesService()).getCompanyGroupIds(order.companyId);
    await this._assertNoContractInForce(companyIds, [productId]);
    // The new contract is accepted by the referent: without one, nobody on the product would ever see it.
    if (!(await (await this._loadUsersService()).hasReferent(productId, tenantId))) {
      throw new BusinessException(`Tenant ${tenant.name} has no referent to accept the contract: mark one among its users first.`, "TENANT_WITHOUT_REFERENT");
    }
    const trialsService = await this._loadTrialsService();
    const trial = tenant.trialId ? await this._getTrialIfAny(trialsService, productId, tenant.trialId) : undefined;

    const contractsService = await this._loadContractsService();
    try {
      this._logger.log(`Provisioning the line of ${line.productName} of order ${order.code} on tenant ${tenantId}`);
      await transaction([
        this._orderLineModel.transaction.update({ productId, orderId }, { tenantId }, { condition: this._lineRequestCondition(line) }),
        tenantsService.orderHandoverWrite(tenant, orderId, line.seats),
        ...(trial && trial.status !== TrialStatus.Converted ? [trialsService.conversionWrite(productId, trial.id)] : []),
        ...companyIds.map(companyId => contractsService.productHoldWrite(companyId, productId, orderId)),
      ]);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        await this._assertProductNotHeld(order, productId, companyIds);
        throw new BusinessException(`The line of ${line.productName} or tenant ${tenant.name} changed while the line was being provisioned: reload it.`, "ORDER_CHANGED");
      }
      this._logger.error(`Error provisioning the line of ${line.productName} of order ${order.code} on tenant ${tenantId}`, error);
      throw new DatabaseException("An error occurred while provisioning the order line.", error as Error);
    }

    // A schedule left behind is harmless: the expiration of a converted trial is skipped.
    if (trial?.status === TrialStatus.Active) {
      await this._runAfterCommit([() => trialsService.cancelSchedules(trial.id)], order);
    }
    if (!(await this._completeOnTenant(productId, tenantId, scope))) {
      throw new BusinessException(`The line of ${line.productName} is on tenant ${tenant.name} but not provisioned yet: complete it from the order.`, "LINE_PROVISIONING_OPEN");
    }
    const provisioned = await this._orderLineModel.get({ productId, orderId });
    return plainToInstance(ResponseOrderLineDto, provisioned, { excludeExtraneousValues: true });
  }

  /**
   * Records the line of a tenant as provisioned once its provisioning is settled. An inactive tenant, such as an
   * existing tenant handed to the line, is reactivated first; a failed reactivation reaches the caller, and the same
   * call can be repeated.
   * @param productId the product of the tenant.
   * @param tenantId the tenant of the line.
   * @param scope the request scope.
   * @returns whether the line was recorded.
   */
  private async _completeOnTenant(productId: string, tenantId: string, scope: RequestScope): Promise<boolean> {
    const tenantsService = await this._loadTenantsService();
    const tenant = await tenantsService.getTenant(productId, tenantId);
    if (tenant.status === TenantStatus.Inactive) {
      await tenantsService.updateTenant(productId, tenantId, { status: TenantStatus.Active } as UpdateTenantDto, scope);
    }
    const usersService = await this._loadUsersService();
    return usersService.completeProvisioning(productId, tenantId);
  }

  /**
   * Reads the line of a confirmed order that is about to be provisioned.
   * A line already requested is provisioned again only when the operator gave up on its tenant.
   * @param order the order of the line.
   * @param productId the product of the line.
   * @returns the line.
   * @throws EntityNotFoundException if the line does not exist.
   * @throws BusinessException if the order is not confirmed, or the line is not waiting or already requested.
   */
  private async _getLineToProvision(order: Order, productId: string): Promise<OrderLine> {
    this._assertStatusIn(order, [OrderStatus.Confirmed], "provisioned");
    const line = await this._orderLineModel.get({ productId, orderId: order.id });
    if (!line) {
      throw new EntityNotFoundException("OrderLine", `${order.id}/${productId}`);
    }

    if (line.status !== OrderLineStatus.ToBeProvisioned) {
      throw new BusinessException(`The line of ${line.productName} is not waiting to be provisioned.`, "LINE_NOT_TO_PROVISION");
    }

    const tenantsService = await this._loadTenantsService();
    if (line.tenantId && (await tenantsService.getTenant(productId, line.tenantId)).status !== TenantStatus.Cancelled) {
      throw new BusinessException(`The line of ${line.productName} has already been requested to the product.`, "LINE_ALREADY_REQUESTED");
    }

    return line;
  }

  /**
   * Builds the condition under which a line takes its tenant: still waiting, and still on the tenant read, if any.
   * @param line the line as read.
   * @returns the condition.
   */
  private _lineRequestCondition(line: OrderLine): InstanceType<typeof Condition> {
    const condition = new Condition().where("status").eq(OrderLineStatus.ToBeProvisioned).and();
    return line.tenantId ? condition.where("tenantId").eq(line.tenantId) : condition.where("tenantId").not().exists();
  }

  /**
   * Reads the trial a tenant was born from, if it still exists: an operator may have deleted it.
   * @param trialsService the trials service.
   * @param productId the product of the trial.
   * @param trialId the identifier of the trial.
   * @returns the trial, or undefined if it was deleted.
   */
  private async _getTrialIfAny(trialsService: TrialsService, productId: string, trialId: string): Promise<ResponseTrialDto | undefined> {
    try {
      return await trialsService.getTrial(productId, trialId);
    } catch (error) {
      if (error instanceof EntityNotFoundException) return undefined;
      throw error;
    }
  }

  /**
   * Completes by hand a line whose tenant and users are all settled but which is still waiting, because the process
   * stopped after the last user was settled. It records the line as `markLineProvisioned` would have.
   * @param orderId the order of the line.
   * @param productId the product of the line.
   * @param scope the request scope.
   * @returns the line, provisioned.
   * @throws BusinessException if the line is not waiting, or its tenant or users are still waiting for the product.
   */
  async completeLineProvisioning(orderId: string, productId: string, scope: RequestScope): Promise<ResponseOrderLineDto> {
    const order = await this._getOrderOrThrow(orderId);
    await this._assertOrderVisible(order, scope);
    const line = await this._orderLineModel.get({ productId, orderId });
    if (!line) {
      throw new EntityNotFoundException("OrderLine", `${orderId}/${productId}`);
    }

    if (line.status !== OrderLineStatus.ToBeProvisioned || !line.tenantId) {
      throw new BusinessException(`The line of ${line.productName} is not waiting to be provisioned.`, "LINE_NOT_TO_PROVISION");
    }

    if (!(await this._completeOnTenant(productId, line.tenantId, scope))) {
      throw new BusinessException(`The tenant or the users of ${line.productName} are still waiting for the product.`, "LINE_PROVISIONING_OPEN");
    }

    const provisioned = await this._orderLineModel.get({ productId, orderId });

    return plainToInstance(ResponseOrderLineDto, provisioned, { excludeExtraneousValues: true });
  }

  /**
   * Records that a line has been provisioned, once the product confirmed its tenant and every user asked with it:
   * the line moves to PROVISIONED, its contract is born and linked to line and tenant, the order counts it, and the
   * order is CLOSED with its last line. On the indirect channel the reseller is told; on the direct one the product
   * has already sent the credentials.
   * A line already provisioned, or pointing at another tenant, is left alone.
   * @param productId the product of the line.
   * @param orderId the order of the line.
   * @param tenantId the tenant on the product the line provisioned.
   * @param users the users created on the tenant, for the reseller's notice.
   * @throws DatabaseException if the line cannot be recorded.
   */
  async markLineProvisioned(productId: string, orderId: string, tenantId: string, users: { email: string; name?: string; surname?: string }[]): Promise<void> {
    // Two lines of the same order can complete together: the counter is written on the value read, and read again on a conflict.
    let prepared: { contract: Contract; write: TransactionWrite } | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const line = await this._orderLineModel.get({ productId, orderId });
      if (!line || line.status !== OrderLineStatus.ToBeProvisioned || line.tenantId !== tenantId) {
        this._logger.log(`Line of product ${productId} in order ${orderId} is not waiting for tenant ${tenantId}; nothing to record.`);
        return;
      }
      const order = await this._getOrderOrThrow(orderId);
      const linesProvisioned = order.linesProvisioned + 1;
      const orderWrite = linesProvisioned >= order.linesTotal
        ? this._orderTransition(order, OrderStatus.Closed, { linesProvisioned })
        : this._orderModel.transaction.update(
          { id: orderId },
          { linesProvisioned },
          { condition: new Condition().where("linesProvisioned").eq(order.linesProvisioned) },
        );
      // The document is stored once, before the transaction that creates the contract.
      prepared ??= await this._prepareLineContract(order, line);
      const { contract } = prepared;
      const tenantsService = await this._loadTenantsService();
      try {
        await transaction([
          this._orderLineModel.transaction.update(
            { productId, orderId },
            { status: OrderLineStatus.Provisioned, provisionedAt: new Date().toISOString(), contractId: contract.id, contractCode: contract.code },
            { condition: new Condition().where("status").eq(OrderLineStatus.ToBeProvisioned) },
          ),
          orderWrite,
          prepared.write,
          tenantsService.contractLinkWrite(productId, tenantId, contract.id, contract.code),
        ]);
      } catch (error) {
        if (isTransactionCanceled(error)) continue;
        this._logger.error(`Error recording the provisioning of the line of ${line.productName} of order ${order.code}`, error);
        throw new DatabaseException("An error occurred while recording the provisioning of the order line.", error as Error);
      }
      this._logger.log(`Line of ${line.productName} of order ${order.code} provisioned with contract ${contract.code}${linesProvisioned >= order.linesTotal ? "; order closed" : ""}.`);

      const contractsService = await this._loadContractsService();
      await this._runAfterCommit([
        () => contractsService.scheduleLifecycle(contract),
        () => contractsService.startBilling(contract.productId, contract.id),
        () => contractsService.catchUpSeats(contract),
        () => contractsService.notifyCreated(contract),
        ...(order.channel === SalesChannel.Reseller ? [() => this._noticeLineProvisioned(order, line, users)] : []),
      ], order);
      return;
    }
    this._logger.warn(`Line of product ${productId} in order ${orderId} kept changing; provisioning not recorded.`);
  }

  /**
   * Records the first access of a provisioned line, when the referent accepts its contract: the line becomes
   * ACTIVATED and the order counts it. A line not PROVISIONED, already activated or never provisioned, is left alone.
   * @param productId the product of the line.
   * @param orderId the order of the line.
   * @param activatedAt when the contract was accepted (ISO string).
   * @throws DatabaseException if the activation cannot be recorded.
   */
  async markLineActivated(productId: string, orderId: string, activatedAt: string): Promise<void> {
    // Two lines of the same order can be activated together: the counter is written on the value read, and read again on a conflict.
    for (let attempt = 0; attempt < 3; attempt++) {
      const line = await this._orderLineModel.get({ productId, orderId });
      if (!line || line.status !== OrderLineStatus.Provisioned) {
        this._logger.log(`Line of product ${productId} in order ${orderId} is not provisioned; activation not recorded.`);
        return;
      }
      const order = await this._getOrderOrThrow(orderId);
      try {
        await transaction([
          this._orderLineModel.transaction.update(
            { productId, orderId },
            { status: OrderLineStatus.Activated, activatedAt },
            { condition: new Condition().where("status").eq(OrderLineStatus.Provisioned) },
          ),
          this._orderModel.transaction.update(
            { id: orderId },
            { linesActivated: order.linesActivated + 1 },
            { condition: new Condition().where("linesActivated").eq(order.linesActivated) },
          ),
        ]);
      } catch (error) {
        if (isTransactionCanceled(error)) continue;
        this._logger.error(`Error recording the activation of the line of ${line.productName} of order ${order.code}`, error);
        throw new DatabaseException("An error occurred while recording the activation of the order line.", error as Error);
      }
      this._logger.log(`Line of ${line.productName} of order ${order.code} activated.`);
      return;
    }

    this._logger.warn(`Line of product ${productId} in order ${orderId} kept changing; activation not recorded.`);
  }

  /**
   * Reads who sold some orders, for the metrics: the salesperson who opened each one (`assignedSalesId`). The orders
   * are read in batches of 100, as DynamoDB allows; an order without a salesperson is left out.
   * @param orderIds the identifiers of the orders.
   * @returns the salesperson of each order, by identifier.
   * @throws DatabaseException if a read fails.
   */
  async getSalesIds(orderIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(orderIds)];
    const salesIds = new Map<string, string>();

    try {
      for (let start = 0; start < ids.length; start += 100) {
        const orders = await this._orderModel.batchGet(ids.slice(start, start + 100).map(id => ({ id })));
        for (const order of orders) {
          if (order.assignedSalesId) {
            salesIds.set(order.id, order.assignedSalesId);
          }
        }
      }
    } catch (error) {
      this._logger.error(`Error reading the salespeople of ${ids.length} orders`, error);
      throw new DatabaseException("An error occurred while reading the orders.", error as Error);
    }

    return salesIds;
  }

  /**
   * Reads every order in a status, of every channel, for the metrics.
   * @param status the status of the orders.
   * @returns the orders in that status.
   * @throws DatabaseException if the query fails.
   */
  async getByStatus(status: OrderStatus): Promise<ResponseOrderDto[]> {
    try {
      const orders = await this._orderModel.query("status").eq(status).using("statusIndex").all().exec();
      return orders.map(order => this._toResponse(order, SYSTEM_SCOPE));
    } catch (error) {
      this._logger.error(`Error reading the ${status} orders`, error);
      throw new DatabaseException("An error occurred while reading the orders.", error as Error);
    }
  }

  /**
   * Tells the Keus back office of the confirmed orders past their delivery date with lines still to provision, once a
   * day from EventBridge Scheduler. Each order is noticed once: `overdueNoticedAt` is written before the email, so a
   * failed email loses the notice rather than sending one every morning. An order that fails is logged and skipped.
   * @throws DatabaseException if the confirmed orders cannot be read.
   */
  async noticeOverdueOrders(): Promise<void> {
    const today = calendarDayOf(new Date());
    let confirmed: Order[];
    try {
      confirmed = await this._orderModel.query("status").eq(OrderStatus.Confirmed).using("statusIndex").all().exec();
    } catch (error) {
      this._logger.error("Error reading the confirmed orders", error);
      throw new DatabaseException("An error occurred while reading the orders.", error as Error);
    }

    // The confirmation stores a day (YYYY-MM-DD), the transfer orders a full ISO timestamp: both start with the day.
    const overdue = confirmed.filter((order): order is Order & { deliveryDate: string } => !!order.deliveryDate
      && !order.overdueNoticedAt
      && order.deliveryDate.slice(0, 10) < today
      && order.linesProvisioned < order.linesTotal);
    let noticed = 0;

    for (const order of overdue) {
      try {
        await this._orderModel.update(
          { id: order.id },
          { overdueNoticedAt: new Date().toISOString() },
          { condition: new Condition().where("status").eq(OrderStatus.Confirmed).and().where("overdueNoticedAt").not().exists(), return: "item" },
        );
        await this._noticeKeus(MailTemplate.OrderOverdue, order, {
          deliveryDate: DELIVERY_DATE_FORMAT.format(new Date(order.deliveryDate)),
          linesProvisioned: order.linesProvisioned,
          linesTotal: order.linesTotal,
        });
        noticed++;
      } catch (error) {
        // Another run noticed the order, or it moved on since it was read.
        if (isConditionalCheckFailed(error)) continue;
        this._logger.error(`Error noticing the delay of order ${order.code}`, error);
      }
    }

    this._logger.log(`Delay noticed on ${noticed} confirmed order(s).`);
  }

  /**
   * Reads the orders opened in a month, of every channel and status, for the metrics.
   * @param monthIndex the month of the request (format: "YYYY-MM").
   * @returns the orders requested in that month.
   * @throws DatabaseException if the query fails.
   */
  async getRequestedIn(monthIndex: string): Promise<ResponseOrderDto[]> {
    try {
      const orders = await this._orderModel.query("requestMonth").eq(monthIndex).using("monthIndex").all().exec();
      return orders.map(order => this._toResponse(order, SYSTEM_SCOPE));
    } catch (error) {
      this._logger.error(`Error reading the orders requested in ${monthIndex}`, error);
      throw new DatabaseException("An error occurred while reading the orders.", error as Error);
    }
  }

  /**
   * Reads the orders still open that were requested from a date on, for the backlog of the metrics.
   * One query per open status, bound on `requestedAt`: the closed orders are never read.
   * @param since the ISO date from which the orders were requested.
   * @returns the open orders requested since that date.
   * @throws DatabaseException if a query fails.
   */
  async getOpenRequestedSince(since: string): Promise<ResponseOrderDto[]> {
    const openStatuses = Object.values(OrderStatus).filter(status => !FINAL_STATUSES.includes(status));

    try {
      const orders = await Promise.all(openStatuses.map(status =>
        this._orderModel.query("status").eq(status).where("requestedAt").ge(since).using("statusIndex").all().exec(),
      ));
      return orders.flat().map(order => this._toResponse(order, SYSTEM_SCOPE));
    } catch (error) {
      this._logger.error(`Error reading the open orders requested since ${since}`, error);
      throw new DatabaseException("An error occurred while reading the open orders.", error as Error);
    }
  }

  /**
   * Reads every line of a product in a provisioning state, for the metrics.
   * @param productId the product of the lines.
   * @param status the provisioning state of the lines.
   * @returns the lines of the product in that state.
   * @throws DatabaseException if the query fails.
   */
  async getLinesByStatus(productId: string, status: OrderLineStatus): Promise<ResponseOrderLineDto[]> {
    try {
      const lines = await this._orderLineModel.query("productId").eq(productId).where("status").eq(status).using("statusIndex").all().exec();
      return lines.map(line => plainToInstance(ResponseOrderLineDto, line, { excludeExtraneousValues: true }));
    } catch (error) {
      this._logger.error(`Error reading the ${status} lines of product ${productId}`, error);
      throw new DatabaseException("An error occurred while reading the order lines.", error as Error);
    }
  }

  /**
   * Reads what the contract of a line charges: its discounts, the customization quoted on its product, and whether
   * the company pays it itself. With a number of seats, the recurring fee is the one of those seats on the plan of
   * the line, with the same discount or margin: what a contract whose seats grew charges per period (UR-RK-401).
   * @param productId the product of the line.
   * @param orderId the order of the line.
   * @param seats the seats to price, when they differ from the ones sold on the line.
   * @returns the charges of the line.
   * @throws EntityNotFoundException if the order or the line does not exist.
   */
  async getLineCharges(productId: string, orderId: string, seats?: number): Promise<LineCharges> {
    const [order, line, customizations] = await Promise.all([
      this._getOrderOrThrow(orderId),
      this._orderLineModel.get({ productId, orderId }),
      this._orderCustomizationModel.query("orderId").eq(orderId).exec(),
    ]);
    if (!line) {
      throw new EntityNotFoundException("OrderLine", `${orderId}/${productId}`);
    }

    const customization = customizations.find(item => item.status === CustomizationStatus.Quoted && item.productId === productId);
    const financed = !!order.financier && order.financier !== Financier.None;

    return {
      chargedToCompany: order.channel === SalesChannel.Direct && !financed,
      activationDiscountPercent: line.activationDiscountPercent,
      recurringDiscountPercent: line.recurringDiscountPercent,
      activationCents: line.billedActivationCents,
      recurringCents: seats === undefined ? line.billedRecurringCents : await this._billedRecurringCents(line, seats),
      ...(line.assistance && { assistance: line.assistance }),
      ...(financed && {
        financing: {
          financier: order.financier as string,
          reference: order.financierReference,
          years: order.financedYears,
          seats: line.seats,
          ...(seats !== undefined && { extraSeatsCents: await this._billedExtraSeatsCents(line, seats) }),
        },
      }),
      ...(customization && {
        customization: {
          oneOffCents: customization.billedOneOffCents,
          recurringIncreaseCents: customization.billedRecurringIncreaseCents,
        },
      }),
      ...(line.resellerMargin && {
        customer: {
          activationCents: line.offerActivationCents,
          recurringCents: seats === undefined
            ? line.offerRecurringCents
            : await this._pricedRecurringCents(line, seats, line.recurringDiscountPercent, line.offerRecurringCents),
          ...(customization && {
            customizationOneOffCents: customization.offerOneOffCents,
            customizationRecurringIncreaseCents: customization.offerRecurringIncreaseCents,
          }),
        },
      }),
    };
  }

  /**
   * Prices the recurring fee of a line for a number of seats, as `_buildLines` does for the seats sold: list price of
   * the plan, less the reseller margin on the indirect channel or the discount of the offer on the direct one. Only
   * volume plans are priced by seats: the others keep the fee of the line.
   * @param line the order line.
   * @param seats the seats to price.
   * @returns the recurring fee billed by Keus per billing period, in cents.
   */
  private async _billedRecurringCents(line: OrderLine, seats: number): Promise<number | undefined> {
    const percent = line.resellerMargin ? line.resellerMargin.recurringPercent : line.recurringDiscountPercent;
    return this._pricedRecurringCents(line, seats, percent, line.billedRecurringCents);
  }

  /**
   * Prices the recurring fee of a line for a number of seats with a percentage off the list price. Only volume plans
   * are priced by seats: the others keep the fee recorded on the line.
   * @param line the order line.
   * @param seats the seats to price.
   * @param percent the percentage off the list price: the margin, or the discount of the offer.
   * @param fixedCents the fee recorded on the line, for the plans not priced by seats.
   * @returns the recurring fee per billing period, in cents.
   */
  private async _pricedRecurringCents(line: OrderLine, seats: number, percent: number, fixedCents: number | undefined): Promise<number | undefined> {
    if (!line.planId) return fixedCents;

    const plansService = await this._loadPlansService();
    const plan = await plansService.getPlan(line.productId, line.planId);
    if (plan.type !== PlanType.TieredVolume) return fixedCents;

    return this._applyPercent(this._listRecurringCents(plan, seats), percent);
  }

  /**
   * Prices the seats of a financed line beyond the financed ones: each seat pays the price of the tier its number falls
   * into, with the discount of the line. The base cost stays with the finance company.
   * @param line the financed order line.
   * @param seats the seats to price.
   * @returns the fee of the seats beyond the financed ones per billing period, in cents.
   * @throws BusinessException if no tier covers one of the seats.
   */
  private async _billedExtraSeatsCents(line: OrderLine, seats: number): Promise<number> {
    const financedSeats = line.seats ?? 0;
    if (!line.planId || seats <= financedSeats) return 0;
    const plansService = await this._loadPlansService();
    const plan = await plansService.getPlan(line.productId, line.planId);
    if (plan.type !== PlanType.TieredVolume) return 0;
    let monthly = 0;
    for (let seat = financedSeats + 1; seat <= seats; seat++) {
      monthly += this._tierFor(plan, seat).price;
    }

    const amount = plan.billingInterval === BillingInterval.Annual ? monthly * 12 : monthly;

    return this._applyPercent(Math.round(amount * 100), line.recurringDiscountPercent) ?? 0;
  }

  /**
   * Tells whether an order has a line on a recurring plan, whose fee a financed order pays for its whole duration.
   * @param lines the lines of the order.
   * @returns true when at least one line is not on a one-off plan.
   */
  private async _hasRecurringLine(lines: OrderLine[]): Promise<boolean> {
    const plansService = await this._loadPlansService();
    for (const line of lines.filter(item => item.planId)) {
      const plan = await plansService.getPlan(line.productId, line.planId);
      if (plan.type !== PlanType.OneTime) return true;
    }
    return false;
  }

  /**
   * Prepares the contract of a line being provisioned, with the recurring increase of the customization quoted on its product.
   * @param order the order of the line.
   * @param line the line being provisioned, already pointing at its tenant.
   * @returns the contract and the write that creates it.
   */
  private async _prepareLineContract(order: Order, line: OrderLine): Promise<{ contract: Contract; write: TransactionWrite }> {
    const customizations = await this._orderCustomizationModel.query("orderId").eq(order.id).exec();
    const customization = customizations.find(item => item.status === CustomizationStatus.Quoted && item.productId === line.productId);
    const recurringCents = line.billedRecurringCents !== undefined
      ? line.billedRecurringCents + (customization?.billedRecurringIncreaseCents ?? 0)
      : undefined;
    const input: NewContract = {
      productId: line.productId,
      orderId: order.id,
      ...(order.assignedSalesId && { assignedSalesId: order.assignedSalesId }),
      companyId: order.companyId,
      tenantId: line.tenantId,
      planId: line.planId,
      seats: line.seats ?? 0,
      ...(recurringCents !== undefined && { recurringCents }),
      ...(line.resellerPath && { resellerPath: line.resellerPath }),
      ...(order.financier && order.financier !== Financier.None && { financedYears: order.financedYears ?? 1 }),
      ...(line.paidUntil && { paidUntil: line.paidUntil }),
    };

    const contractsService = await this._loadContractsService();
    return contractsService.prepareContract(input);
  }

  /**
   * Builds the write that moves a line to its tenant as the product keys it, for the tenant's confirmation.
   * A line provisioned again with another tenant is left alone: a late confirmation must not take it back.
   * @param productId the product of the line.
   * @param orderId the order of the line.
   * @param requestedTenantId the id the tenant had while it was requested.
   * @param tenantId the identifier of the tenant on the product.
   * @returns the transaction write, or none when the line points at another tenant.
   */
  async lineTenantWrites(productId: string, orderId: string, requestedTenantId: string, tenantId: string): Promise<TransactionWrite[]> {
    const line = await this._orderLineModel.get({ productId, orderId });
    if (line?.tenantId !== requestedTenantId) return [];
    return [this._orderLineModel.transaction.update(
      { productId, orderId },
      { tenantId },
      { condition: new Condition().where("tenantId").eq(requestedTenantId) },
    )];
  }

  /**
   * Cancels an order before its confirmation.
   * @param id the identifier of the order.
   * @param scope the request scope.
   * @returns the updated order.
   * @throws BusinessException if the order is confirmed or already final.
   */
  async cancelOrder(id: string, scope: RequestScope): Promise<ResponseOrderDto> {
    return this._runAction(id, "cancelling", async order => {
      await this._assertOrderSellable(order, scope);
      return [this._orderTransition(order, OrderStatus.Cancelled)];
    }, scope);
  }

  /**
   * Checks that a company can leave its reseller as far as its orders go (UR-RK-105): a confirmed order cannot be
   * cancelled, so it blocks the transfer until its lines are provisioned. Writes nothing, so it runs before any step.
   * @param companyId the company being transferred.
   * @param resellerPath the path of the reseller it leaves.
   * @throws BusinessException if an order of that reseller is confirmed and still being provisioned.
   */
  async assertNoOrderInProvisioning(companyId: string, resellerPath: string): Promise<void> {
    const confirmed = (await this._openOrdersOf(companyId, resellerPath)).find(order => order.status === OrderStatus.Confirmed);
    if (confirmed) {
      throw new BusinessException(`Order ${confirmed.code} is still being provisioned: complete it before transferring company ${companyId}.`, "ORDER_IN_PROVISIONING");
    }
  }

  /**
   * Cancels the open orders of a company leaving a reseller (UR-RK-105), once the transfer passed its checks: that
   * reseller no longer operates, so they could not go on (`RESELLER_NOT_ACTIVE`) and would stay in the queues. The
   * final ones stay its history.
   * @param companyId the company being transferred.
   * @param resellerPath the path of the reseller it leaves.
   */
  async cancelOrdersForTransfer(companyId: string, resellerPath: string): Promise<void> {
    const orders = await this._openOrdersOf(companyId, resellerPath);

    for (const order of orders) {
      await this.cancelOrder(order.id, SYSTEM_SCOPE);
    }
    this._logger.log(`Company ${companyId}: ${orders.length} open order(s) cancelled for the transfer`);
  }

  /**
   * Reads what blocks a draft for its page. The steps check it again, so a failed read leaves the draft readable
   * without the hint rather than failing the whole page.
   * @param order the draft.
   * @param scope the request scope.
   * @returns the blocker, or null when nothing blocks it or it could not be read.
   */
  private async _draftBlocker(order: Order, scope: RequestScope): Promise<OrderBlocker | null> {
    try {
      return await this._orderBlocker(order, scope);
    } catch (error) {
      this._logger.warn(`What blocks draft ${order.code} could not be read: the page shows it without the hint`, error);
      return null;
    }
  }

  /**
   * Tells what keeps an order from going ahead on its products, on the company or on its twins: a contract in force,
   * or another order already out of the draft and not final. Drafts do not block each other, so a draft is always
   * saved and the first one to go ahead holds the products; a cancelled or refused order frees them. Two orders that
   * left the draft at the same time would block each other for good: between them the one requested first goes
   * ahead, the identifier breaking a tie.
   * @param order the order.
   * @param scope the request scope, which decides whether the blocker may be named.
   * @returns the blocker, or null when the order can go ahead.
   */
  private async _orderBlocker(order: Order, scope: RequestScope): Promise<OrderBlocker | null> {
    const productIds = order.productIds ?? [];
    if (productIds.length === 0) {
      return null;
    }

    // The twins of every channel count, not only those the requester sees.
    const companyIds = await (await this._loadCompaniesService()).getCompanyGroupIds(order.companyId);
    const inForce = await this._contractInForce(companyIds, productIds);
    if (inForce) {
      return new OrderBlocker(OrderBlockerKind.Contract, await this._isNameable(inForce.resellerPath, scope) ? inForce.code : undefined);
    }

    const orders = (await Promise.all(companyIds.map(companyId =>
      this._orderModel.query("companyId").eq(companyId).using("companyIndex").all().exec()))).flat();
    const isAhead = (other: Order): boolean => order.status === OrderStatus.Draft
      || other.requestedAt < order.requestedAt || (other.requestedAt === order.requestedAt && other.id < order.id);
    const open = orders.find(other => other.id !== order.id && other.status !== OrderStatus.Draft && !FINAL_STATUSES.includes(other.status)
      && (other.productIds ?? []).some(productId => productIds.includes(productId)) && isAhead(other));
    if (open) {
      return new OrderBlocker(OrderBlockerKind.Order, await this._isNameable(open.resellerPath, scope) ? open.code : undefined);
    }
    return null;
  }

  /**
   * Asserts that an order can leave the draft on its products (`_orderBlocker`).
   * @param order the order.
   * @param scope the request scope, which decides whether the error may name the blocker.
   * @throws BusinessException if a contract in force or another open order holds one of its products.
   */
  private async _assertOrderFree(order: Order, scope: RequestScope): Promise<void> {
    const blocker = await this._orderBlocker(order, scope);
    if (!blocker) {
      return;
    }

    if (blocker.kind === OrderBlockerKind.Contract) {
      throw new BusinessException(
        `${blocker.code ? `Contract ${blocker.code}` : "A contract"} is in force on a product of this order: a new one can follow only once it is terminated.`,
        "COMPANY_CONTRACT_IN_FORCE",
        blocker.code ? { contractCode: blocker.code } : {},
      );
    }
    throw new BusinessException(
      `${blocker.code ? `Order ${blocker.code}` : "Another order"} is already open on a product of this order: a company takes one order per product at a time.`,
      "COMPANY_ORDER_OPEN",
      blocker.code ? { orderCode: blocker.code } : {},
    );
  }

  /**
   * Asserts, after a provisioning transaction was refused, that the product of the company is not held by another
   * order, which is the one cause the caller cannot tell from a changed line.
   * @param order the order being provisioned.
   * @param productId the product of the line.
   * @param companyIds the records of the company, the order's and its twins.
   * @throws BusinessException if another order holds the product for the company.
   */
  private async _assertProductNotHeld(order: Order, productId: string, companyIds: string[]): Promise<void> {
    const contractsService = await this._loadContractsService();
    const holders = await Promise.all(companyIds.map(companyId => contractsService.getProductHolder(companyId, productId)));
    const holderId = holders.find(holder => holder && holder !== order.id);
    if (!holderId) {
      return;
    }

    const holder = await this._orderModel.get({ id: holderId });
    throw new BusinessException(
      `Order ${holder?.code ?? holderId} already provisions this product for the company: a company holds one contract per product.`,
      "COMPANY_PRODUCT_HELD",
      { orderCode: holder?.code ?? holderId },
    );
  }

  /**
   * Finds a contract in force, terminating ones included, on some products, on any of the records of a company.
   * @param companyIds the records of the company, the order's and its twins.
   * @param productIds the products.
   * @returns the contract, or undefined when none is in force.
   */
  private async _contractInForce(companyIds: string[], productIds: string[]): Promise<ResponseContractDto | undefined> {
    const contractsService = await this._loadContractsService();
    const contracts = (await Promise.all(companyIds.map(companyId => contractsService.getContractsByCompany(companyId, SYSTEM_SCOPE)))).flat();
    return contracts.find(contract => productIds.includes(contract.productId) && IN_FORCE_STATUSES.includes(contract.status));
  }

  /**
   * Asserts that a company has no contract in force, terminating ones included, on some products, on any of its
   * records: a new contract follows only once the current one is terminated.
   * @param companyIds the records of the company, the order's and its twins.
   * @param productIds the products.
   * @param scope the request scope, which decides whether the error may name the contract.
   * @throws BusinessException if one of the products has a contract in force.
   */
  private async _assertNoContractInForce(companyIds: string[], productIds: string[], scope: RequestScope = SYSTEM_SCOPE): Promise<void> {
    const inForce = await this._contractInForce(companyIds, productIds);
    if (inForce) {
      const named = await this._isNameable(inForce.resellerPath, scope);
      throw new BusinessException(
        `${named ? `Contract ${inForce.code}` : "A contract"} is in force on a product of this order: a new one can follow only once it is terminated.`,
        "COMPANY_CONTRACT_IN_FORCE",
        named ? { contractCode: inForce.code } : {},
      );
    }
  }

  /**
   * Tells whether an error may name a record of the same company: a reseller learns nothing of the records of other
   * channels, which a twin of the company may hold.
   * @param resellerPath the path of the record.
   * @param scope the request scope.
   * @returns true when the requester sees the record.
   */
  private async _isNameable(resellerPath: string | undefined, scope: RequestScope): Promise<boolean> {
    return isUnrestricted(scope) || isPathVisible(await this._viewerPath(scope), resellerPath);
  }

  /**
   * Retrieves the open orders of some records of a company, those not closed, refused or cancelled, with the products
   * they sell: what a transfer compares when it links two records of the same company.
   * @param companyIds the records of the company.
   * @returns the code, the path and the products of each open order.
   */
  async getOpenOrdersOf(companyIds: string[]): Promise<Pick<Order, "code" | "resellerPath" | "productIds">[]> {
    const orders = (await Promise.all(companyIds.map(companyId =>
      this._orderModel.query("companyId").eq(companyId).using("companyIndex").all().exec()))).flat();
    return orders
      .filter(order => !FINAL_STATUSES.includes(order.status))
      .map(order => ({ code: order.code, resellerPath: order.resellerPath, productIds: order.productIds ?? [] }));
  }

  /**
   * Reads the orders of a company sold by a reseller that are not final yet.
   * @param companyId the company.
   * @param resellerPath the path of the reseller.
   * @returns the orders still open.
   */
  private async _openOrdersOf(companyId: string, resellerPath: string): Promise<Order[]> {
    return (await this._orderModel.query("companyId").eq(companyId).using("companyIndex").all().exec())
      .filter(order => order.resellerPath === resellerPath && !FINAL_STATUSES.includes(order.status));
  }

  /**
   * Opens the order that moves the contracts in force of a company to Keus (UR-RK-105), or reads the one a previous
   * attempt of the same transfer opened, closed too: its lines may all be provisioned while a later step failed. The
   * order is born confirmed, with no offer: Keus takes the place of the reseller on a service already running. Each line takes over one contract, with its seats and the plan and discount chosen by the admin:
   * the activation is not charged again (100% discount), and the period the reseller paid is not charged twice.
   * @param companyId the company being transferred.
   * @param contracts the contracts in force the company has on its reseller.
   * @param inputs plan and discount of the direct contract taking over each of them, by product.
   * @param resellerCode the inactive reseller the company leaves.
   * @param since when the company completed its previous transfer, if any: older transfer orders are not this one's.
   * @param scope the request scope, whose collaborator follows the order.
   * @returns the lines still to provision, each with the contract it takes over.
   * @throws BusinessException if the fiscal data or the IBAN are missing, a contract has no plan, a plan is not for
   * companies, a tenant has no referent to accept the new contract, or another call is opening the same order.
   */
  async openTransferOrder(companyId: string, contracts: ResponseContractDto[], inputs: TransferLine[], resellerCode: string, since: string | undefined, scope: RequestScope): Promise<OrderLine[]> {
    const opened = (await this._orderModel.query("companyId").eq(companyId).using("companyIndex").all().exec())
      .find(order => order.transferredFromResellerCode === resellerCode
        && [OrderStatus.Confirmed, OrderStatus.Closed].includes(order.status)
        && (!since || order.requestedAt > since));
    if (opened) {
      return (await this._getLines(opened.id)).filter(line => line.status === OrderLineStatus.ToBeProvisioned);
    }
    if (contracts.length === 0) {
      return [];
    }

    const companiesService = await this._loadCompaniesService();
    const company = await companiesService.getCompany(companyId, SYSTEM_SCOPE);
    this._assertFiscalDataComplete(company);
    if (!company.iban) {
      throw new BusinessException("IBAN missing: required on the direct channel.", "COMPANY_IBAN_MISSING");
    }
    const usersService = await this._loadUsersService();
    const lineInputs: OrderLineInput[] = [];
    for (const contract of contracts) {
      const input = inputs.find(item => item.productId === contract.productId);
      if (!input) {
        throw new BusinessException(`Choose the plan of the direct contract taking over contract ${contract.code}.`, "TRANSFER_PLAN_MISSING", { contractId: contract.id });
      }
      // The new contract is accepted by the referent, as on any tenant taking an order line.
      if (!(await usersService.hasReferent(contract.productId, contract.tenantId))) {
        throw new BusinessException(`The tenant of contract ${contract.code} has no referent to accept the new contract: mark one among its users first.`, "TENANT_WITHOUT_REFERENT");
      }
      lineInputs.push({ productId: contract.productId, planId: input.planId, seats: contract.seats, activationDiscountPercent: 100, recurringDiscountPercent: input.recurringDiscountPercent ?? 0 });
    }

    try {
      // The same transfer always gets the same id: of two calls running together, the second create is refused.
      const id = uuidv5(`${companyId}#${resellerCode}#${since ?? ""}`, TRANSFER_ORDER_NAMESPACE);
      const code = await this._generateOrderCode();
      const built = await this._buildLines({ id, code }, lineInputs, company, { channel: SalesChannel.Direct });
      const now = new Date().toISOString();
      const lines: OrderLine[] = built.map(line => {
        const previous = contracts.find(contract => contract.productId === line.productId);
        return {
          ...line,
          status: OrderLineStatus.ToBeProvisioned,
          confirmedAt: now,
          previousContractId: previous.id,
          ...(previous.nextBillingDate && { paidUntil: previous.nextBillingDate }),
        };
      });
      const order: Order = {
        id,
        code,
        companyId,
        companyName: company.name,
        status: OrderStatus.Confirmed,
        channel: SalesChannel.Direct,
        requestedAt: now,
        requestMonth: now.slice(0, 7),
        deliveryDate: now,
        confirmedAt: now,
        transferredFromResellerCode: resellerCode,
        ...this._summary(lines, []),
        ...(company.vatNumber && { companyVatNumber: company.vatNumber }),
        ...(!scope.system && { assignedSalesId: scope.sub }),
      };

      this._logger.log(`Opening the transfer order ${code} of company ${companyId} with ${lines.length} line(s)`);
      await transaction([
        this._orderModel.transaction.create(order, { overwrite: false }),
        ...lines.map(line => this._orderLineModel.transaction.create(line, { overwrite: false })),
      ]);
      return lines;
    } catch (error) {
      if (isTransactionCanceled(error)) {
        throw new BusinessException(`Another call is transferring company ${companyId}: wait for it, then try again.`, "TRANSFER_IN_PROGRESS");
      }
      if (this._isDomainError(error)) {
        throw error;
      }
      this._logger.error(`Error opening the transfer order of company ${companyId}`, error);
      throw new DatabaseException("An error occurred while opening the transfer order.", error as Error);
    }
  }

  /**
   * Runs an action on an order: reads it, lets the action build its writes, and
   * applies them in one transaction.
   * Every write carries a condition on the status read, so of two concurrent
   * actions the second fails instead of both winning.
   * The action can queue work for after the commit, such as an email: it runs
   * only if the transaction succeeds, and its failure is logged without
   * undoing the action.
   * @param id the identifier of the order.
   * @param label what the action does, for the logs and the errors.
   * @param buildWrites the action, returning the writes of the transaction.
   * @param scope the request scope.
   * @returns the order after the action.
   * @throws BusinessException if the order changed while the action ran.
   */
  private async _runAction(
    id: string,
    label: string,
    buildWrites: (order: Order, afterCommit: AfterCommit) => Promise<TransactionWrite[]>,
    scope: RequestScope,
  ): Promise<ResponseOrderDto> {
    try {
      const order = await this._getOrderOrThrow(id);
      const tasks: (() => Promise<void>)[] = [];
      const writes = await buildWrites(order, task => tasks.push(task));
      this._logger.log(`${label.charAt(0).toUpperCase()}${label.slice(1)} order ${order.code}`);
      await transaction(writes);
      await this._runAfterCommit(tasks, order);
      return this.getOrder(id, scope);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        throw new BusinessException(`Order ${id} changed while ${label} it: reload it and try again.`, "ORDER_CHANGED");
      }
      if (this._isDomainError(error)) {
        throw error;
      }
      this._logger.error(`Error ${label} order ${id}`, error);
      throw new DatabaseException(`An error occurred while ${label} the order with ID: ${id}.`, error as Error);
    }
  }

  /**
   * Runs the work an action queued for after its commit, one task at a time.
   * The action is already committed, so a failed task is only logged.
   * @param tasks the queued work.
   * @param order the order the action ran on.
   */
  private async _runAfterCommit(tasks: (() => Promise<void>)[], order: Order): Promise<void> {
    for (const task of tasks) {
      try {
        await task();
      } catch (error) {
        this._logger.error(`Error running the follow-up of an action on order ${order.code}`, error);
      }
    }
  }

  /**
   * Builds the write that moves an order to a new status, conditioned on the
   * status read. Reaching a final status removes the order from the queue.
   * @param order the order as read.
   * @param next the target status.
   * @param set the attributes to write with the transition.
   * @param remove the attributes to remove with the transition.
   * @returns the transaction write.
   * @throws BusinessException if the transition is not allowed.
   */
  private _orderTransition(
    order: Order,
    next: OrderStatus,
    set: Partial<Order> = {},
    remove: (keyof Order)[] = [],
  ): TransactionWrite {
    this._assertTransition(order, next);
    return this._orderModel.transaction.update(
      { id: order.id },
      withRemoval<Order>({ ...set, status: next }, remove),
      { condition: new Condition().where("status").eq(order.status) },
    );
  }

  /**
   * Asserts that an order may move to a status, according to the lifecycle.
   * @param order the order.
   * @param next the target status.
   * @throws BusinessException if the transition is not allowed.
   */
  private _assertTransition(order: Order, next: OrderStatus): void {
    if (!ALLOWED_TRANSITIONS[order.status].includes(next)) {
      throw new BusinessException(
        `Order ${order.code} cannot move from ${order.status} to ${next}.`,
        "INVALID_ORDER_TRANSITION",
        { current: order.status, next, allowed: ALLOWED_TRANSITIONS[order.status] },
      );
    }
  }

  /**
   * Asserts that an order is in one of the given statuses.
   * @param order the order.
   * @param statuses the statuses in which the action is allowed.
   * @param action what would be done to the order, for the message.
   * @throws BusinessException if the order is in another status.
   */
  private _assertStatusIn(order: Order, statuses: OrderStatus[], action: string): void {
    if (!statuses.includes(order.status)) {
      throw new BusinessException(
        `Order ${order.code} is ${order.status} and cannot be ${action}.`,
        "ORDER_STATUS_NOT_ALLOWED",
        { status: order.status, allowed: statuses },
      );
    }
  }

  /**
   * Reads a customization request of an order, with the others of the same order.
   * @param order the order.
   * @param customizationId the identifier of the customization.
   * @returns the customization and the other ones.
   * @throws EntityNotFoundException if the order has no such customization.
   */
  private async _getCustomizationOrThrow(order: Order, customizationId: string): Promise<{ customization: OrderCustomization; others: OrderCustomization[] }> {
    const customizations = await this._getCustomizations(order.id);
    const customization = customizations.find(item => item.id === customizationId);
    if (!customization) {
      throw new EntityNotFoundException("OrderCustomization", customizationId);
    }
    return { customization, others: customizations.filter(item => item.id !== customizationId) };
  }


  /**
   * Computes the offer and the invoiced amounts of a customization from its list amounts.
   * @param listOneOffCents the one-off list amount.
   * @param listRecurringIncreaseCents the list increase of the recurring fee.
   * @param discountPercent the discount granted to the customer.
   * @param marginPercent the reseller's customization margin, on the indirect channel.
   * @returns the amounts to write; those not computable are left out.
   */
  private _priceCustomization(
    listOneOffCents: number | undefined,
    listRecurringIncreaseCents: number | undefined,
    discountPercent: number,
    marginPercent: number | undefined,
  ): Partial<OrderCustomization> {
    const offerOneOffCents = this._applyPercent(listOneOffCents, discountPercent);
    const offerRecurringIncreaseCents = this._applyPercent(listRecurringIncreaseCents, discountPercent);
    const billedOneOffCents = marginPercent !== undefined ? this._applyPercent(listOneOffCents, marginPercent) : offerOneOffCents;
    const billedRecurringIncreaseCents = marginPercent !== undefined
      ? this._applyPercent(listRecurringIncreaseCents, marginPercent)
      : offerRecurringIncreaseCents;

    return {
      ...(listOneOffCents !== undefined && { listOneOffCents }),
      ...(listRecurringIncreaseCents !== undefined && { listRecurringIncreaseCents }),
      ...(offerOneOffCents !== undefined && { offerOneOffCents }),
      ...(offerRecurringIncreaseCents !== undefined && { offerRecurringIncreaseCents }),
      ...(billedOneOffCents !== undefined && { billedOneOffCents }),
      ...(billedRecurringIncreaseCents !== undefined && { billedRecurringIncreaseCents }),
    };
  }

  /**
   * Lists the customization amounts absent from a pricing, so a re-pricing clears the old ones.
   * @param amounts the amounts written by the pricing.
   * @returns the amount attributes to remove.
   */
  private _absentAmounts(amounts: Partial<OrderCustomization>): (keyof OrderCustomization)[] {
    return CUSTOMIZATION_AMOUNTS.filter(key => amounts[key] === undefined);
  }

  /**
   * Asserts that a file key is the expected document of the order.
   * @param order the order.
   * @param key the S3 key received.
   * @param expected the key the upload of that document produces.
   * @param required whether an empty key is refused.
   * @throws ValidationException if the key is not the expected one.
   */
  private _assertOrderFile(order: Order, key: string, expected: string, required = true): void {
    if ((required || key) && key !== expected) {
      throw new ValidationException(`The file must be uploaded as ${expected} for order ${order.code}.`, []);
    }
  }

  /**
   * Asserts that the fiscal data of a company are complete (UR-RK-082):
   * an 11-digit VAT number or a valid tax code, a certified mail address or a
   * recipient code, and the registered office.
   * @param company the company of the order.
   * @throws BusinessException listing the missing data.
   */
  private _assertFiscalDataComplete(company: ResponseCompanyDto): void {
    const missing: string[] = [];
    const hasVat = /^\d{11}$/.test(company.vatNumber ?? "");
    const hasFiscalCode = /^([A-Z0-9]{16}|\d{11})$/i.test(company.fiscalCode ?? "");
    if (!hasVat && !hasFiscalCode) {
      missing.push("vatNumber");
    }

    if (!company.pec && !company.sdi) {
      missing.push("pec");
    }

    if (!company.legalAddress?.street || !company.legalAddress?.city || !company.legalAddress?.zipCode) {
      missing.push("legalAddress");
    }

    if (missing.length > 0) {
      throw new BusinessException("Company fiscal data incomplete.", "COMPANY_FISCAL_DATA_INCOMPLETE", { missing });
    }
  }

  /**
   * Reads an order by its identifier.
   * @param id the identifier of the order.
   * @returns the order.
   * @throws EntityNotFoundException if the order does not exist.
   */
  private async _getOrderOrThrow(id: string): Promise<Order> {
    const order = await this._orderModel.get({ id });
    if (!order) {
      this._logger.warn(`Order with ID: ${id} not found.`);
      throw new EntityNotFoundException("Order", id);
    }
    return order;
  }

  /**
   * Emails the Keus back office and admins about an order that waits for them, naming who sells it: the reseller, or
   * on the direct channel the salesperson who opened the order.
   * @param template the email to send.
   * @param order the order.
   * @param data the values of the template beyond the order's own.
   */
  private async _noticeKeus(template: MailTemplate, order: Order, data: Record<string, unknown>): Promise<void> {
    const mailService = await this._loadMailService();
    const seller = await this._sellerOf(order);
    // The name only words the email: a failed lookup falls back to the generic seller, never drops the notice.
    let opener: MailRecipient | null = null;
    if (!seller && order.assignedSalesId) {
      try {
        opener = await mailService.findCollaborator(order.assignedSalesId);
      } catch (error) {
        this._logger.error(`Error finding who opened order ${order.code}`, error);
      }
    }

    await mailService.sendToGroups(template, [UserRole.KeusAdmin, UserRole.KeusBackoffice], {
      orderCode: order.code,
      companyName: order.companyName,
      sellerName: seller?.companyName ?? opener?.fullName ?? "Il commerciale Keus",
      orderUrl: this._orderUrl(order.id),
      ...data,
    });
  }

  /**
   * Emails who sells an order: the address of the reseller, its owner and back office plus whoever opened the order,
   * or the Keus salesperson on the direct channel. The end customer is never reached.
   * @param template the email to send.
   * @param order the order.
   * @param data the values of the template beyond the order's own.
   * @param subs other collaborators to reach, such as the authors of the customizations.
   */
  private async _noticeSeller(template: MailTemplate, order: Order, data: Record<string, unknown>, subs: string[] = []): Promise<void> {
    const mailService = await this._loadMailService();
    const seller = await this._sellerOf(order);
    // Without Cognito the reseller's own address still gets the notice, and one person not found costs only theirs.
    let recipients: MailRecipient[] = [];
    if (seller) {
      try {
        recipients = await mailService.findCollaboratorsInGroups([UserRole.ResellerOwner, UserRole.ResellerBackoffice], seller.code);
      } catch (error) {
        this._logger.error(`Error finding the collaborators of reseller ${seller.code} for order ${order.code}`, error);
      }
    }
    const people = await Promise.all([...new Set([order.assignedSalesId, ...subs])]
      .filter((sub): sub is string => !!sub)
      .map(async (sub): Promise<MailRecipient | null> => {
        try {
          return await mailService.findCollaborator(sub);
        } catch (error) {
          this._logger.error(`Error finding collaborator ${sub} for order ${order.code}`, error);
          return null;
        }
      }));
    const emails = new Set([
      ...(seller?.email ? [seller.email] : []),
      ...[...recipients, ...people.filter(person => person !== null)].map(person => person.email),
    ]);

    // One address that fails must not cost the others their notice.
    for (const email of emails) {
      try {
        await mailService.send(template, email, {
          orderCode: order.code,
          companyName: order.companyName,
          orderUrl: this._orderUrl(order.id, seller?.id),
          ...data,
        });
      } catch (error) {
        this._logger.error(`Error sending ${template} to ${email} for order ${order.code}`, error);
      }
    }
  }

  /**
   * Emails the seller and the authors of the customizations the quotation of the back office: what was priced and
   * what was refused, with the reasons.
   * @param order the order.
   * @param customizations the customizations, as evaluated.
   */
  private async _noticeQuotation(order: Order, customizations: OrderCustomization[]): Promise<void> {
    await this._noticeSeller(MailTemplate.QuotationSaved, order, {
      customizations: customizations.map(customization => ({
        label: this._customizationLabel(order, customization),
        refused: customization.status === CustomizationStatus.Refused,
        reason: customization.refusalReason ?? "",
      })),
    }, customizations.flatMap(customization => customization.authorSub ? [customization.authorSub] : []));
  }

  /**
   * Reads the reseller that sells an order, the last of its lineage.
   * @param order the order.
   * @returns the reseller, or null on the direct channel.
   */
  private async _sellerOf(order: Order): Promise<{ id: string; code: string; companyName: string; email?: string } | null> {
    const code = order.resellerPath?.split("#").filter(Boolean).pop();
    if (!code) return null;
    const resellersService = await this._loadResellersService();
    return resellersService.getResellerByCode(code);
  }

  /**
   * Names a customization for its emails: the product of its line.
   * @param order the order.
   * @param customization the customization.
   * @returns the label.
   */
  private _customizationLabel(order: Order, customization: OrderCustomization): string {
    const productId = customization.productId ?? "";
    return order.productNames[order.productIds.indexOf(productId)] ?? productId;
  }

  /**
   * Emails who sells a confirmed order on the reseller channel, with its lines and the delivery date.
   * @param order the confirmed order, on the reseller channel.
   * @param lines the lines of the order.
   * @param deliveryDate the expected delivery date (ISO).
   */
  private async _noticeOrderConfirmed(order: Order, lines: OrderLine[], deliveryDate: string): Promise<void> {
    await this._noticeSeller(MailTemplate.OrderConfirmed, order, {
      deliveryDate: DELIVERY_DATE_FORMAT.format(new Date(deliveryDate)),
      lines: lines.map(line => ({ productName: line.productName, planName: line.planName ?? "", seats: line.seats ?? 0 })),
    });
  }

  /**
   * Tells who sells an order on the reseller channel that one of its lines has been provisioned, with the users the
   * product created.
   * @param order the order.
   * @param line the provisioned line.
   * @param users the users created on the tenant.
   */
  private async _noticeLineProvisioned(order: Order, line: OrderLine, users: { email: string; name?: string; surname?: string }[]): Promise<void> {
    await this._noticeSeller(MailTemplate.LineProvisioned, order, {
      productName: line.productName,
      users: users.map(user => ({ email: user.email, fullName: [user.name, user.surname].filter(Boolean).join(" ") })),
    });
  }

  /**
   * Builds the link to an order in Rocket: inside the reseller workspace when
   * the reader works at a reseller, in the global area for Keus staff.
   * @param orderId the identifier of the order.
   * @param resellerId the reseller the reader works at, if any.
   * @returns the absolute URL of the order page.
   */
  private _orderUrl(orderId: string, resellerId?: string): string {
    return rocketUrl(resellerId ? `/resellers/workspaces/${resellerId}/orders/${orderId}` : `/orders/${orderId}`);
  }

  /**
   * Reads the lines of an order, without any perimeter check.
   * @param orderId the identifier of the order.
   * @returns the lines of the order.
   */
  private async _getLines(orderId: string): Promise<OrderLine[]> {
    return await this._orderLineModel.query("orderId").eq(orderId).using("orderIndex").all().exec();
  }

  /**
   * Reads the customization requests of an order, without any perimeter check.
   * @param orderId the identifier of the order.
   * @returns the customization requests of the order.
   */
  private async _getCustomizations(orderId: string): Promise<OrderCustomization[]> {
    return await this._orderCustomizationModel.query("orderId").eq(orderId).exec();
  }

  /**
   * Asserts that the requester can act as the seller of an order: it sees the order, and is not a Keus salesperson on
   * the indirect channel, whose orders it reads but leaves to the reseller.
   * @param order the order.
   * @param scope the request scope.
   * @throws AuthorizationException if the order is outside the requester's perimeter, or of a reseller for a Keus salesperson.
   */
  private async _assertOrderSellable(order: Order, scope: RequestScope): Promise<void> {
    await this._assertOrderVisible(order, scope);

    if (!canSellOn(scope, order.resellerPath)) {
      throw new AuthorizationException(`Order ${order.code} is sold by a reseller: a Keus salesperson only reads it.`);
    }
  }

  /**
   * Asserts that the order is within the requester's perimeter: the reseller
   * subtree for a reseller, and the salesperson's own orders for a salesperson
   * (`_salesOwnership`).
   * @param order the order to check.
   * @param scope the request scope.
   * @throws AuthorizationException if the order is outside the perimeter.
   */
  private async _assertOrderVisible(order: Order, scope: RequestScope): Promise<void> {
    assertPathVisible(scope, await this._viewerPath(scope), order.resellerPath, `Order ${order.code}`);

    if (!this._isOwnedBySalesperson(order, await this._salesOwnership(scope))) {
      throw new AuthorizationException(`Order ${order.code} belongs to another salesperson.`);
    }
  }

  /**
   * Resolves the reseller path of a restricted requester.
   * @param scope the request scope.
   * @returns the requester's path, or undefined for collaborators and system paths.
   */
  private async _viewerPath(scope: RequestScope): Promise<string | undefined> {
    if (isUnrestricted(scope) || !scope.resellerCode) {
      return undefined;
    }
    const resellersService = await this._loadResellersService();
    return resellersService.getResellerPath(scope.resellerCode);
  }

  /**
   * Tells whether the requester provisions the order lines: the Keus admin and back office.
   * @param scope the request scope.
   * @returns true for who provisions.
   */
  private _provisions(scope: RequestScope): boolean {
    return scope.roles.includes(UserRole.KeusAdmin) || scope.roles.includes(UserRole.KeusBackoffice);
  }

  /**
   * Reads which orders a salesperson sees: the ones it opened for a reseller salesperson, and also the ones of the
   * resellers it is the reference salesperson of for a Keus salesperson (one read of the sales index).
   * @param scope the request scope.
   * @returns the bound, or null when the requester is not limited to its own orders.
   */
  private async _salesOwnership(scope: RequestScope): Promise<SalesOwnership | null> {
    if (isKeusSalespersonOnly(scope)) {
      const resellersService = await this._loadResellersService();
      const resellers = await resellersService.getAllResellers(scope);
      return { sub: scope.sub, resellerCodes: new Set(resellers.map(reseller => reseller.code)) };
    }

    return isSalespersonOnly(scope) ? { sub: scope.sub } : null;
  }

  /**
   * Tells whether an order is within what a salesperson sees: opened by it, or sold by one of its resellers.
   * @param order the order to check.
   * @param ownership the bound of the salesperson, null for anyone else.
   * @returns true when the requester may see the order.
   */
  private _isOwnedBySalesperson(order: Order, ownership: SalesOwnership | null): boolean {
    if (!ownership || order.assignedSalesId === ownership.sub) {
      return true;
    }

    // The network has one level: the last segment of the path is the selling reseller.
    const sellerCode = order.resellerPath?.split("#").filter(Boolean).pop();
    return !!sellerCode && !!ownership.resellerCodes?.has(sellerCode);
  }

  /**
   * Resolves who sells an order from the reseller path of its company.
   * @param resellerPath the reseller path of the company, absent on the direct channel.
   * @returns the channel, the perimeter and, on the indirect channel, the selling reseller and its margin.
   * @throws BusinessException if the selling reseller is missing, not active or without a contract in force.
   */
  private async _resolveSeller(resellerPath: string | undefined): Promise<OrderSeller> {
    if (!resellerPath) {
      return { channel: SalesChannel.Direct };
    }

    const segments = resellerPath.split("#").filter(Boolean);
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getResellerByCode(segments[segments.length - 1]);
    // A disabled reseller no longer operates: its companies are transferred, not sold to.
    if (!reseller || reseller.status !== ResellerStatus.Active) {
      throw new BusinessException(
        `The reseller of this company is not active and cannot place orders.`,
        "RESELLER_NOT_ACTIVE",
        { resellerPath },
      );
    }

    // The margin is read from the contract in force and copied onto the lines, which keep it.
    const resellerContractsService = await this._loadResellerContractsService();
    const contract = await resellerContractsService.getContractInForceOf(reseller);

    return {
      channel: SalesChannel.Reseller,
      resellerPath,
      rootResellerCode: segments[0],
      reseller,
      margin: contract.margin,
      productIds: contract.productIds,
    };
  }

  /**
   * Validates and prices the lines of an order.
   * @param order the identifier and the code of the order.
   * @param inputs the lines as they come in.
   * @param company the company the order is placed for.
   * @param seller who sells the order.
   * @returns the lines ready to be written.
   * @throws BusinessException if a product, a plan or a discount is not admitted on the channel.
   */
  private async _buildLines(
    order: Pick<Order, "id" | "code">,
    inputs: OrderLineInput[],
    company: ResponseCompanyDto,
    seller: OrderSeller,
  ): Promise<OrderLine[]> {
    const productsService = await this._loadProductsService();
    const lines: OrderLine[] = [];

    for (const input of inputs) {
      const product = await productsService.getProduct(input.productId);
      if (product.orderable === false) {
        throw new BusinessException(`Product ${product.name} cannot be sold through an order.`, "PRODUCT_NOT_ORDERABLE");
      }
      if (seller.reseller && !(seller.productIds ?? []).includes(product.id)) {
        throw new BusinessException(
          `Product ${product.name} is not enabled for reseller ${seller.reseller.code}.`,
          "PRODUCT_NOT_ENABLED_FOR_RESELLER",
        );
      }

      const plan = input.planId ? await this._getOrderablePlan(product.id, input.planId, seller.channel) : undefined;
      const activationDiscountPercent = input.activationDiscountPercent ?? 0;
      const recurringDiscountPercent = input.recurringDiscountPercent ?? 0;
      const resellerMargin = seller.margin
        ? { activationPercent: seller.margin.activationPercent, recurringPercent: seller.margin.recurringPercent }
        : undefined;

      // The reseller's discount comes out of its margin: past it, the reseller would sell at a loss.
      if (resellerMargin && (
        activationDiscountPercent > resellerMargin.activationPercent
        || recurringDiscountPercent > resellerMargin.recurringPercent
      )) {
        throw new BusinessException(
          `The discount on ${product.name} exceeds the reseller margin.`,
          "DISCOUNT_EXCEEDS_MARGIN",
          { productId: product.id, margin: resellerMargin },
        );
      }

      // Only volume plans are priced by seats: on the others the seats are ignored.
      const seats = !plan || plan.type === PlanType.TieredVolume ? input.seats : undefined;
      const listActivationCents = plan ? plan.activationFeeCents ?? 0 : undefined;
      const listRecurringCents = plan && (plan.type !== PlanType.TieredVolume || seats)
        ? this._listRecurringCents(plan, seats ?? 0)
        : undefined;
      const offerActivationCents = this._applyPercent(listActivationCents, activationDiscountPercent);
      const offerRecurringCents = this._applyPercent(listRecurringCents, recurringDiscountPercent);
      const billedActivationCents = resellerMargin
        ? this._applyPercent(listActivationCents, resellerMargin.activationPercent)
        : offerActivationCents;
      const billedRecurringCents = resellerMargin
        ? this._applyPercent(listRecurringCents, resellerMargin.recurringPercent)
        : offerRecurringCents;

      lines.push({
        productId: product.id,
        orderId: order.id,
        orderCode: order.code,
        productName: product.name,
        companyId: company.id,
        companyName: company.name,
        activationDiscountPercent,
        recurringDiscountPercent,
        ...(plan && { planId: plan.id, planName: plan.name }),
        ...(seats !== undefined && { seats }),
        ...(seller.resellerPath && { resellerPath: seller.resellerPath }),
        ...(listActivationCents !== undefined && { listActivationCents }),
        ...(listRecurringCents !== undefined && { listRecurringCents }),
        ...(offerActivationCents !== undefined && { offerActivationCents }),
        ...(offerRecurringCents !== undefined && { offerRecurringCents }),
        ...(resellerMargin && { resellerMargin }),
        ...(billedActivationCents !== undefined && { billedActivationCents }),
        ...(billedRecurringCents !== undefined && { billedRecurringCents }),
        ...(plan?.assistance && { assistance: { amountCents: plan.assistance.amountCents, ...(plan.assistance.label && { label: plan.assistance.label }) } }),
      });
    }

    return lines;
  }

  /**
   * Reads a plan and checks it can price a line of the given channel.
   * @param productId the identifier of the product of the line.
   * @param planId the identifier of the plan.
   * @param channel the channel of the order.
   * @returns the plan.
   * @throws BusinessException if the plan is not active, not a Keus plan, or meant for the other channel.
   */
  private async _getOrderablePlan(productId: string, planId: string, channel: SalesChannel): Promise<ResponsePlanDto> {
    const plansService = await this._loadPlansService();
    let plan: ResponsePlanDto;
    try {
      plan = await plansService.getPlan(productId, planId);
    } catch (error) {
      if (error instanceof EntityNotFoundException) {
        throw new BusinessException("The selected plan is not available for this product.", "PLAN_NOT_AVAILABLE", { planId });
      }
      throw error;
    }

    if (plan.status !== PlanStatus.Active) {
      throw new BusinessException("The selected plan is not available for this product.", "PLAN_NOT_AVAILABLE", { planId });
    }
    const audience = channel === SalesChannel.Reseller ? PlanAudience.Reseller : PlanAudience.Company;
    if (plan.audience !== audience) {
      throw new BusinessException("The selected plan is not available for this channel.", "PLAN_NOT_AVAILABLE_FOR_CHANNEL", { planId });
    }
    return plan;
  }

  /**
   * Computes the list recurring amount of a plan for a number of seats, per billing interval.
   * Volume plans are not progressive: the price of the tier the seats fall into
   * applies to every seat, plus the optional monthly base cost, and both are
   * monthly amounts scaled by twelve on annual plans (same rule as the Stripe
   * mirror). Flat and one-off plans charge their base cost whatever the seats.
   * @param plan the plan pricing the line.
   * @param seats the seats sold on the line.
   * @returns the amount in cents.
   * @throws BusinessException if no tier covers the seats.
   */
  private _listRecurringCents(plan: ResponsePlanDto, seats: number): number {
    if (plan.type !== PlanType.TieredVolume) {
      return Math.round((plan.baseCost ?? 0) * 100);
    }

    const monthly = this._tierFor(plan, seats).price * seats + (plan.baseCost ?? 0);
    const amount = plan.billingInterval === BillingInterval.Annual ? monthly * 12 : monthly;
    return Math.round(amount * 100);
  }

  /**
   * Finds the tier of a volume plan that covers a number of seats.
   * @param plan the volume plan.
   * @param seats the seats.
   * @returns the tier.
   * @throws BusinessException if no tier covers the seats.
   */
  private _tierFor(plan: ResponsePlanDto, seats: number): Tier {
    const tier = (plan.tiers ?? []).find(candidate =>
      seats >= (candidate.minValue ?? 0) && seats <= (candidate.maxValue ?? Number.MAX_SAFE_INTEGER),
    );
    if (!tier) {
      throw new BusinessException(`Plan ${plan.name} has no tier for ${seats} seats.`, "SEATS_OUT_OF_TIERS", { planId: plan.id, seats });
    }
    return tier;
  }

  /**
   * Takes a percentage off an amount.
   * @param cents the amount in cents, absent when not computable yet.
   * @param percent the percentage to take off.
   * @returns the reduced amount in cents, or undefined when the amount is absent.
   */
  private _applyPercent(cents: number | undefined, percent: number): number | undefined {
    return cents === undefined ? undefined : Math.round(cents * (100 - percent) / 100);
  }

  /**
   * Builds the customization requests of an order: at most one per line, on the product of the line. A request
   * already on the order keeps its identity.
   * @param order the identifier and the code of the order.
   * @param inputs the requests as they come in.
   * @param lines the lines of the order.
   * @param seller who sells the order.
   * @param scope the request scope, whose requester becomes the author of the new requests.
   * @param current the requests already on the order.
   * @returns the requests ready to be written.
   * @throws ValidationException if a request is empty, misses its line, repeats a line, or a file is outside the order's prefix.
   */
  private _buildCustomizations(
    order: Pick<Order, "id" | "code">,
    inputs: CustomizationInput[],
    lines: OrderLine[],
    seller: OrderSeller,
    scope: RequestScope,
    current: OrderCustomization[],
  ): OrderCustomization[] {
    const lineProducts = new Set(lines.map(line => line.productId));
    const customizedProducts = new Set<string>();
    for (const input of inputs) {
      if (!input.productId || !lineProducts.has(input.productId)) {
        throw new ValidationException("A customization of a product needs a line of that product in the order.", []);
      }
      if (customizedProducts.has(input.productId)) {
        throw new ValidationException(`There is already a customization for product ${input.productId}.`, []);
      }
      customizedProducts.add(input.productId);
    }
    const currentById = new Map(current.map(item => [item.id, item]));
    return inputs.map(input => {
      if (input.id && !currentById.has(input.id)) {
        throw new ValidationException(`Customization ${input.id} is not on order ${order.code}.`, []);
      }
      return this._buildCustomization(order, input, seller, scope, input.id ? currentById.get(input.id) : undefined);
    });
  }

  /**
   * Builds one customization request, keeping the identity of the one already on the order.
   * @param order the identifier and the code of the order.
   * @param input the request as it comes in.
   * @param seller who sells the order.
   * @param scope the request scope, whose requester becomes the author.
   * @param current the request already on the order, whose identity is kept.
   * @returns the request ready to be written.
   * @throws ValidationException if the request is empty or a file is outside the order's prefix or of the wrong kind.
   */
  private _buildCustomization(
    order: Pick<Order, "id" | "code">,
    input: CustomizationInput,
    seller: OrderSeller,
    scope: RequestScope,
    current?: OrderCustomization,
  ): OrderCustomization {
    const description = input.description?.trim();
    const attachments = input.attachments ?? [];
    if (!description && attachments.length === 0) {
      throw new ValidationException("Describe the customization as text, files or both.", []);
    }

    const prefix = `orders/${order.id}/customizations/`;
    for (const attachment of attachments) {
      if (!attachment.s3Key.startsWith(prefix)) {
        throw new ValidationException(`The customization files must be uploaded under ${prefix}.`, []);
      }
      if (attachment.type === CustomizationAttachmentType.Pdf && !attachment.s3Key.toLowerCase().endsWith(".pdf")) {
        throw new ValidationException("A customization document must be a PDF.", []);
      }
    }

    return {
      orderId: order.id,
      id: current?.id ?? uuidv4(),
      orderCode: order.code,
      kind: input.kind,
      status: CustomizationStatus.Requested,
      requestedAt: current?.requestedAt ?? new Date().toISOString(),
      discountPercent: current?.discountPercent ?? 0,
      ...(description && { description }),
      ...(attachments.length > 0 && { attachments: attachments.map(({ s3Key, type, name }) => ({ s3Key, type, name })) }),
      ...(input.kind === CustomizationKind.Product && input.productId && { productId: input.productId }),
      ...(seller.margin && { resellerMarginPercent: seller.margin.customizationPercent }),
      ...(seller.resellerPath && { resellerPath: seller.resellerPath }),
      ...((current?.authorSub ?? scope.sub) && { authorSub: current?.authorSub ?? scope.sub }),
    };
  }

  /**
   * Tells whether a customization input carries files.
   * @param input the customization input.
   * @returns true when at least one file is attached.
   */
  private _hasFiles(input: CustomizationInput): boolean {
    return (input.attachments ?? []).length > 0;
  }

  /**
   * Asserts that every line is ready for an offer: a priced line has its recurring amount, which a volume plan gets
   * only once the seats are set.
   * @param lines the lines of the order.
   * @throws BusinessException if a line is incomplete.
   */
  private _assertLinesComplete(lines: OrderLine[]): void {
    const incomplete = lines.filter(line => !line.planId || line.listRecurringCents === undefined).map(line => line.productName);
    if (incomplete.length > 0) {
      throw new BusinessException(
        `Every line needs a plan, and the seats on a volume plan, before the offer: ${incomplete.join(", ")}.`,
        "ORDER_LINES_INCOMPLETE",
        { products: incomplete },
      );
    }
  }

  /**
   * Asserts that no two lines share a product: a company holds one contract per
   * product, so a second line would have nowhere to land.
   * @param lines the lines as they come in.
   * @throws ValidationException if a product appears twice.
   */
  private _assertNoDuplicateProducts(lines: OrderLineInput[]): void {
    const productIds = lines.map(line => line.productId);
    const duplicated = productIds.filter((id, index) => productIds.indexOf(id) !== index);
    if (duplicated.length > 0) {
      throw new ValidationException(
        `There is already a line for this product: ${[...new Set(duplicated)].join(", ")}.`,
        [],
      );
    }
  }

  /**
   * Asserts that an order has something to supply: at least one line.
   * @param lines the lines of the order.
   * @throws ValidationException if the order would be empty.
   */
  private _assertHasContent(lines: OrderLine[]): void {
    if (lines.length === 0) {
      throw new ValidationException(
        "An order needs at least one line.",
        [],
      );
    }
  }

  /**
   * Deletes the customization files that no customization of the order cites any more.
   * Runs after the write and logs instead of failing: an orphan file is harmless,
   * a customization citing a missing file is not.
   * @param before the customizations before the write.
   * @param after the customizations after the write.
   */
  private async _deleteCustomizationFiles(before: OrderCustomization[], after: OrderCustomization[]): Promise<void> {
    // Compared across the whole order, so a file moved between customizations is kept.
    const kept = new Set(after.flatMap(item => item.attachments ?? []).map(file => file.s3Key));
    const dropped = before.flatMap(item => item.attachments ?? []).map(file => file.s3Key).filter(s3Key => !kept.has(s3Key));
    if (dropped.length === 0) {
      return;
    }

    const s3Service = await this._loadS3Service();
    await Promise.all(dropped.map(async s3Key => {
      try {
        await s3Service.deleteObject(s3Key);
      } catch (error) {
        if (!(error instanceof AppException)) {
          throw error;
        }
        this._logger.warn(`Customization file ${s3Key} could not be deleted and is left orphan.`);
      }
    }));
  }

  /**
   * Deletes the documents of a deleted order, the signed offer and the contract of the finance company; a file that
   * cannot be deleted is left orphan, as for the attachments.
   * @param order the order, as it was before the deletion.
   */
  private async _deleteOrderDocuments(order: Order): Promise<void> {
    const keys = [order.signedOfferS3Key, order.financingContractS3Key].filter((key): key is string => Boolean(key));
    if (keys.length === 0) {
      return;
    }

    const s3Service = await this._loadS3Service();
    await Promise.all(keys.map(async s3Key => {
      try {
        await s3Service.deleteObject(s3Key);
      } catch (error) {
        if (!(error instanceof AppException)) {
          throw error;
        }
        this._logger.warn(`Order file ${s3Key} could not be deleted and is left orphan.`);
      }
    }));
  }

  /**
   * Asserts that an order is still a draft.
   * @param order the order to check.
   * @throws BusinessException if the order is no longer a draft.
   */
  private _assertDraft(order: Order): void {
    // Once the offer has gone out, the order is a document someone has read:
    // it changes through its own transitions, not by editing it in place.
    if (order.status !== OrderStatus.Draft) {
      throw new BusinessException(
        `Order ${order.code} is ${order.status}: only a draft can be edited or deleted.`,
        "ORDER_NOT_DRAFT",
        { status: order.status },
      );
    }
  }

  /**
   * Asserts that a CRM deal has not opened an order already.
   * @param dealId the identifier of the deal.
   * @throws BusinessException if an order already carries the deal.
   */
  private async _assertDealNotOpened(dealId: string): Promise<void> {
    const existing = await this._orderModel.query("dealId").eq(dealId).using("dealIndex").exec();
    if (existing.length > 0) {
      throw new BusinessException(
        `Deal ${dealId} already opened order ${existing[0].code}.`,
        "ORDER_DEAL_ALREADY_OPENED",
        { code: existing[0].code },
      );
    }
  }

  /**
   * Computes the summary of lines and customizations kept on the order.
   * @param lines the lines of the order.
   * @param customizations the customization requests of the order.
   * @returns the summary attributes.
   */
  private _summary(lines: OrderLine[], customizations: OrderCustomization[]): OrderSummary {
    return {
      linesTotal: lines.length,
      linesProvisioned: 0,
      linesActivated: 0,
      productIds: lines.map(line => line.productId),
      productNames: lines.map(line => line.productName),
      hasCustomization: customizations.length > 0,
      pendingCustomizations: customizations.filter(item => item.status === CustomizationStatus.Requested).length,
    };
  }

  /**
   * Tells whether an order has a line in a status, from its counters: lines get a status at the confirmation, and each
   * one moves from TO_BE_PROVISIONED to PROVISIONED to ACTIVATED, so the counts say which statuses are present.
   * @param order the order.
   * @param lineStatus the status of the line.
   * @returns whether at least one line of the order is in that status.
   */
  private _hasLineIn(order: Order, lineStatus: OrderLineStatus): boolean {
    switch (lineStatus) {
      case OrderLineStatus.ToBeProvisioned:
        return order.status === OrderStatus.Confirmed && order.linesProvisioned < order.linesTotal;
      case OrderLineStatus.Provisioned:
        return order.linesProvisioned > order.linesActivated;
      case OrderLineStatus.Activated:
        return order.linesActivated > 0;
    }
  }

  /**
   * Adds to some lines where their tenant stands, read in one request: the detail of the order and the lines to
   * provision show whether a line waits for the product, failed, or was left behind with everything confirmed.
   * The status is secondary: when the tenants cannot be read, the lines go out without it.
   * @param lines the lines.
   * @returns the lines, with the status of their tenant when they have one and it could be read.
   */
  private async _withTenants(lines: OrderLine[]): Promise<OrderLine[]> {
    const keys = lines.flatMap(line => line.tenantId ? [{ productId: line.productId, id: line.tenantId }] : []);
    if (!keys.length) {
      return lines;
    }

    let tenants: Awaited<ReturnType<TenantsService["getTenantsByKeys"]>>;

    try {
      tenants = await (await this._loadTenantsService()).getTenantsByKeys(keys);
    } catch (error) {
      this._logger.warn(`Tenants of ${keys.length} order lines not read: the lines go out without their status.`, error);
      return lines;
    }

    const tenantByKey = new Map(tenants.map(tenant => [`${tenant.productId}/${tenant.id}`, tenant]));

    return lines.map(line => {
      const tenant = tenantByKey.get(`${line.productId}/${line.tenantId}`);
      return tenant
        ? {
          ...line,
          tenantStatus: tenant.status,
          tenantSyncState: tenant.syncState,
          tenantFailureReason: tenant.failureReason,
          tenantPendingUsers: tenant.pendingUsers ?? 0,
        } as OrderLine
        : line;
    });
  }

  /**
   * Maps an order to its response, leaving out the reseller's purchase terms
   * for a reseller salesperson.
   * @param order the order.
   * @param scope the request scope.
   * @param lines the lines, when a single order is read.
   * @param customizations the customization requests, when a single order is read.
   * @param blockedBy what keeps a single draft from going ahead, if anything.
   * @returns the response DTO.
   */
  private _toResponse(
    order: Order,
    scope: RequestScope,
    lines?: OrderLine[],
    customizations?: OrderCustomization[],
    blockedBy?: OrderBlocker | null,
  ): ResponseOrderDto {
    const hideTerms = isSalespersonOnly(scope);
    const shownLines = lines?.map(line => hideTerms
      ? { ...line, resellerMargin: undefined, billedActivationCents: undefined, billedRecurringCents: undefined }
      : line);
    const shownCustomizations = customizations?.map(item => hideTerms
      ? { ...item, resellerMarginPercent: undefined, billedOneOffCents: undefined, billedRecurringIncreaseCents: undefined }
      : item);

    return plainToInstance(
      ResponseOrderDto,
      {
        ...order,
        ...(shownLines && { lines: shownLines }),
        ...(shownCustomizations && { customizations: shownCustomizations }),
        ...(blockedBy && { blockedBy }),
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Narrows a query on an index ranged on the request date to a period.
   * @param query the query to narrow.
   * @param from the first instant of the period, optional.
   * @param to the last instant of the period, optional.
   * @returns the query, narrowed when a bound is given.
   */
  private _requestedIn<T, K>(query: Query<T, K>, from: string | undefined, to: string | undefined): Query<T, K> {
    if (from && to) {
      return query.where("requestedAt").between(from, to);
    }
    if (from) {
      return query.where("requestedAt").ge(from);
    }
    return to ? query.where("requestedAt").le(to) : query;
  }

  /**
   * Generates the next order code, in the form ORD-{year}-{sequence}: the last
   * code of the year plus one, as the contract codes are generated. The months
   * of the year are read backwards from the current one until one holds a code.
   * Codes changed by hand that do not follow the form are ignored.
   * @returns the generated code.
   */
  private async _generateOrderCode(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const prefix = `ORD-${year}-`;

    let lastSequence = 0;
    for (let month = now.getMonth() + 1; month >= 1 && lastSequence === 0; month--) {
      const orders = await this._orderModel
        .query("requestMonth").eq(`${year}-${String(month).padStart(2, "0")}`)
        .where("code").beginsWith(prefix)
        .using("monthIndex")
        .all()
        .exec();
      const sequences = orders
        .map(order => parseInt(order.code.slice(prefix.length), 10))
        .filter(sequence => !Number.isNaN(sequence));
      lastSequence = sequences.length ? Math.max(...sequences) : 0;
    }

    return `${prefix}${String(lastSequence + 1).padStart(5, "0")}`;
  }

  /**
   * Tells whether an error is one of the domain exceptions, to be rethrown as it is.
   * @param error the error to inspect.
   * @returns true for the domain exceptions.
   */
  private _isDomainError(error: unknown): boolean {
    return error instanceof ValidationException
      || error instanceof BusinessException
      || error instanceof EntityNotFoundException
      || error instanceof AuthorizationException;
  }

}
