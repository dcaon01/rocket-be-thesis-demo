import { Injectable, Logger } from '@nestjs/common';
import { LazyModuleLoader } from '@nestjs/core';
import { isUnrestricted, RequestScope, SYSTEM_SCOPE } from '@rocket-be/scoping';
import { assertCollaborator, isKeusBackofficeOnly, isKeusSalespersonOnly, isPathVisible, isSalespersonOnly } from '../../../../commons/scoping/scoped-access.helper';
import { todayInItaly } from '../../../../commons/dates/calendar-day.helper';
import { toDynamooseUpdate } from '../../../../commons/persistence/removable-update.helper';
import { integrationsEnabled } from "../../../../commons/integrations/integrations.helper";
import { InjectModel, Model } from 'nestjs-dynamoose';
import { MetricsPeriod } from '../../enums/metrics-period.enum';
import { MetricsLogic } from '../../enums/metrics-logic.enum';
import { BilledPartyType } from '../../../invoices/enums/billed-party-type.enum';
import { InvoiceStatus } from '../../../invoices/enums/invoice-status.enum';
import type { Invoice } from '../../../invoices/schemas/invoice.schema';
import type { InvoicesService } from '../../../invoices/lazy-invoices/services/invoices.service';
import type { CustomerChargesService } from '../../../invoices/lazy-invoices/services/customer-charges.service';
import type { OrdersService } from '../../../orders/lazy-orders/services/orders.service';
import { ProductsService } from '../../../products/lazy-products/services/products.service';
import { TenantsService } from '../../../tenants/lazy-tenants/services/tenants.service';
import { TrialsService } from '../../../trials/lazy-trials/services/trials.service';
import { ContractsService } from '../../../contracts/lazy-contracts/services/contracts.service';
import { ResellersService } from '../../../resellers/lazy-resellers/services/resellers.service';
import type { ResellerContractsService } from '../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service';
import { UsersService } from '../../../users/lazy-users/services/users.service';
import { HubspotService } from '../../../hubspot/lazy-hubspot/services/hubspot.service';
import { MixpanelService } from '../../../mixpanel/lazy-mixpanel/services/mixpanel.service';
import { MixpanelRuleStats } from '../../../mixpanel/interfaces/mixpanel-rule-stats.interface';
import { IntercomService } from '../../../intercom/lazy-intercom/services/intercom.service';
import { IntercomConversation } from '../../../intercom/interfaces/intercom-conversation.interface';
import { SentryService } from '../../../sentry/lazy-sentry/services/sentry.service';
import { CloudwatchService } from '../../../cloudwatch/lazy-cloudwatch/services/cloudwatch.service';
import { ApiGatewayRef, ApiLatency } from '../../../cloudwatch/interfaces/api-latency.interface';
import { TenantStatus } from '../../../tenants/enums/tenant-status.enum';
import { TrialStatus } from '../../../trials/enums/trial-status.enum';
import { UserStatus } from '../../../users/enums/user-status.enum';
import { RevenueDashboardMetricsRecord, RevenueDashboardMetricsRecordKey } from '../../schemas/revenue-dashboard-metrics-record.schema';
import { UtilitiesDashboardMetricsRecord, UtilitiesDashboardMetricsRecordKey } from '../../schemas/utilities-dashboard-metrics-record.schema';
import { CustomerSuccessDashboardMetricsRecord, CustomerSuccessDashboardMetricsRecordKey } from '../../schemas/customer-success-dashboard-metrics-record.schema';
import { SupportDashboardMetricsRecord, SupportDashboardMetricsRecordKey } from '../../schemas/support-dashboard-metrics-record.schema';
import { ProductAdoptionDashboardMetricsRecord, ProductAdoptionDashboardMetricsRecordKey } from '../../schemas/product-adoption-dashboard-metrics-record.schema';
import { ResellerOverviewDashboardMetricsRecord, ResellerOverviewDashboardMetricsRecordKey } from '../../schemas/reseller-overview-dashboard-metrics-record.schema';
import { SalesOrdersDashboardMetricsRecord, SalesOrdersDashboardMetricsRecordKey } from '../../schemas/sales-orders-dashboard-metrics-record.schema';
import { TechnicalErrorsDashboardMetricsRecord, TechnicalErrorsDashboardMetricsRecordKey } from '../../schemas/technical-errors-dashboard-metrics-record.schema';
import { AvailabilityDashboardMetricsRecord, AvailabilityDashboardMetricsRecordKey } from '../../schemas/availability-dashboard-metrics-record.schema';
import { ProductHealthCheck, ProductHealthCheckKey } from '../../schemas/product-health-check.schema';
import { ProductOutage, ProductOutageKey } from '../../schemas/product-outage.schema';
import { ResponseRevenueDashboardMetricsRecordDto } from '../../dtos/response-revenue-dashboard-metrics-record.dto';
import { ResponseResellerRevenueDashboardMetricsRecordDto } from '../../dtos/response-reseller-revenue-dashboard-metrics-record.dto';
import { ResponseResellerOverviewPeriodRecordDto } from '../../dtos/response-reseller-overview-period-record.dto';
import { ResponseActiveCompaniesPeriodRecordDto } from '../../dtos/response-active-companies-period-record.dto';
import { ResponseResellerNetworkEntryDto } from '../../dtos/response-reseller-network-entry.dto';
import { ResponseResellerWorklistDto } from '../../dtos/response-reseller-worklist.dto';
import { ResponseResellerRenewalDto } from '../../dtos/response-reseller-renewal.dto';
import { ResponseResellerOpportunityDto } from '../../dtos/response-reseller-opportunity.dto';
import { ResponseResellerBillingDto } from '../../dtos/response-reseller-billing.dto';
import { ResponseResellerBillingPeriodDto } from '../../dtos/response-reseller-billing-period.dto';
import { ResponseInvoiceDto } from '../../../invoices/dtos/response-invoice.dto';
import { ResponseUtilitiesDashboardMetricsRecordDto } from '../../dtos/response-utilities-dashboard-metrics-record.dto';
import { ResponseSalesDashboardMetricsDto } from '../../dtos/response-sales-dashboard-metrics.dto';
import { ResponseSalesOrdersDashboardMetricsDto } from '../../dtos/response-sales-orders-dashboard-metrics.dto';
import { ResponseSalesOrdersPeriodRecordDto } from '../../dtos/response-sales-orders-period-record.dto';
import { ResponseSalesActiveTrialsDto } from '../../dtos/response-sales-active-trials.dto';
import { ResponseMixpanelTenantKpiDto } from '../../dtos/response-mixpanel-tenant-kpi.dto';
import { ResponseCustomerSuccessDashboardMetricsDto } from '../../dtos/response-customer-success-dashboard-metrics.dto';
import { ResponseCustomerSuccessPeriodRecordDto } from '../../dtos/response-customer-success-period-record.dto';
import { ResponseCustomerFollowUpDto } from '../../dtos/response-customer-follow-up.dto';
import { CustomerFollowUpReason } from '../../enums/customer-follow-up-reason.enum';
import { ContractStatus, IN_FORCE_STATUSES } from '../../../contracts/enums/contract-status.enum';
import { ContractTerminationReason } from '../../../contracts/enums/contract-termination-reason.enum';
import type { ResponseContractDto } from '../../../contracts/dtos/response-contract.dto';
import { OrderLineStatus } from '../../../orders/enums/order-line-status.enum';
import { OrderStatus } from '../../../orders/enums/order-status.enum';
import type { ResponseOrderLineDto } from '../../../orders/dtos/response-order-line.dto';
import type { ResponseOrderDto } from '../../../orders/dtos/response-order.dto';
import { ResponseSupportPeriodRecordDto } from '../../dtos/response-support-period-record.dto';
import { ResponseIntercomBrandDto } from '../../dtos/response-intercom-brand.dto';
import { ResponseTechnicalErrorsDashboardMetricsDto } from '../../dtos/response-technical-errors-dashboard-metrics.dto';
import { ResponseTechnicalErrorsIssuesDto } from '../../dtos/response-technical-errors-issues.dto';
import { ResponseTechnicalErrorsPeriodRecordDto } from '../../dtos/response-technical-errors-period-record.dto';
import { ResponseOpenAlertsDto } from '../../dtos/response-open-alerts.dto';
import { ResponseSentryProjectDto } from '../../dtos/response-sentry-project.dto';
import { ResponseAvailabilityPeriodRecordDto } from '../../dtos/response-availability-period-record.dto';
import { ResponseProductAdoptionPeriodRecordDto } from '../../dtos/response-product-adoption-period-record.dto';
import { LeverOutcome } from '../../enums/lever-outcome.enum';
import { AdoptionTenant, AdoptionUser, LeverResult, MIXPANEL_CORE_EVENTS, evaluateLever, readStart, toQueryUsers, toRuleQuery } from '../../helpers/product-adoption.helper';
import { ALL_PRODUCTS, countResellerOverview, overviewKeyOf } from '../../helpers/reseller-overview.helper';
import { countSalesOrders, salesOrdersKeyOf } from '../../helpers/sales-orders.helper';
import { RENEWAL_HORIZON_DAYS, TenantSeats, findOpportunities, tenantKeyOf } from '../../helpers/reseller-worklist.helper';
import { MixpanelLever } from '../../../products/enums/mixpanel-lever.enum';
import { MixpanelInactivityScope } from '../../../products/enums/mixpanel-inactivity-scope.enum';
import { MixpanelRuleShape } from '../../../products/enums/mixpanel-rule-shape.enum';
import type { MixpanelLeverRule } from '../../../products/classes/mixpanel-lever-rule.class';
import type { ResponseProductDto } from '../../../products/dtos/response-product.dto';
import type { ResponseTenantDto } from '../../../tenants/dtos/response-tenant.dto';
import { HubspotDeal, HubspotSearchFilterGroup } from '../../../hubspot/interfaces/hubspot-deal.interface';
import { HUBSPOT_SOLUTION_PROPERTY, dealSolutions, productsPipelineId } from '../../../hubspot/helpers/hubspot-products.helper';
import { AppException, AuthorizationException, DatabaseException, ValidationException } from '../../../../errors/exception-types';
import { plainToInstance } from 'class-transformer';
import { v5 as uuidv5 } from 'uuid';

/** Namespace of the identifiers of the dashboard records, derived from the leaf and the month they count. */
const RECORD_ID_NAMESPACE = '3f6c1d2e-8a4b-4c7e-9b1a-5d2f0e7c6a91';

/**
 * Builds the identifier of the record of a leaf in a month: the same leaf and month always get the same one, so two
 * refreshes running together write one record instead of creating it twice and doubling the counts.
 * @param monthIndex the month (YYYY-MM).
 * @param key the leaf, as the refresh of its table keys it.
 * @returns the identifier.
 */
function recordIdOf(monthIndex: string, key: string): string {
  return uuidv5(`${monthIndex}#${key}`, RECORD_ID_NAMESPACE);
}

/** States of a tenant or user that is not on the product: not created yet, discarded, or deleted. */
const NOT_ON_PRODUCT: string[] = [TenantStatus.Requested, TenantStatus.Cancelled, TenantStatus.Deleted];

/** Most months a monthly dashboard reads back, as the schedules of the invoices allow. */
const MAX_MONTHLY_INTERVALS = 24;

/** Most years an annual dashboard reads back. */
const MAX_ANNUAL_INTERVALS = 10;

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Conversation attribute that names the Intercom brand a conversation came through. */
const INTERCOM_BRAND_ATTRIBUTE = 'Brand';

/** How Intercom marks a conversation the customer started. */
const CUSTOMER_INITIATED = 'customer_initiated';

/** How long the contracts and order lines read for the customer success metrics are reused, as for the schedule. */
const CUSTOMER_BASE_CACHE_MS = 60 * 1000;

/** A read of the customer base slower than this is logged, well before the 29 seconds of API Gateway. */
const SLOW_READ_MS = 10 * 1000;

/** Step the adoption is evaluated at: reads within it share the query, and the cache, of the Mixpanel service. */
const ADOPTION_CLOCK_MS = 5 * 60 * 1000;

/** Step the Sentry windows end at: reads within it share the requests, and the cache, of the Sentry service. */
const SENTRY_CLOCK_MS = 5 * 60 * 1000;

/** How far back the open alerts are looked for: the events Sentry keeps on the plan of Keus. */
const OPEN_ALERTS_LOOKBACK_DAYS = 90;

/** Longest wait for the answer of the health address of a product. */
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

/** Wait before the second try of a failed check, so a single lost request does not open an outage. */
const HEALTH_CHECK_RETRY_MS = 5_000;

/** Key the fees of the resellers take in the revenue records in place of a product, since they belong to none. */
export const RESELLER_FEES_KEY = 'RESELLER_FEES';

/** Host of the default address of an HTTP API of API Gateway: identifier and region of the API. */
const EXECUTE_API_HOST = /^([a-z0-9]+)\.execute-api\.([a-z0-9-]+)\.amazonaws\.com$/;

/** What the customer success metrics are counted from: every product, its contracts and its delivered lines. */
type CustomerBase = { productIds: string[]; contracts: ResponseContractDto[]; lines: ResponseOrderLineDto[] };

/** Counts of a product and seller lineage in a month, as its customer success record stores them. */
type CustomerSuccessCounts = Omit<CustomerSuccessDashboardMetricsRecord, 'id' | 'monthIndex'>;

/** Counts of a product, seller lineage and lever in a month, as its product adoption record stores them. */
type AdoptionCounts = Omit<ProductAdoptionDashboardMetricsRecord, 'id' | 'monthIndex'>;

/** A customer tenant with its outcomes on the levers of its product. */
type TenantAdoption = { tenant: ResponseTenantDto; results: LeverResult[] };

/**
 * What a Keus salesperson sold, as `_salesOwnership` of the orders reads it: the orders it opened, whose direct
 * invoices feed its own leaf records, and the ones of the resellers it is the reference salesperson of.
 */
type SalesOwnership = { salesId: string; resellerCodes: Set<string> };

/** Which leaf a revenue record is: of a reseller, of a salesperson, or neither for the global record. */
type RevenueLeaf = Pick<RevenueDashboardMetricsRecord, 'resellerPath' | 'salesId'>;

/**
 * Service for metrics operations.
 */
@Injectable()
export class MetricsService {
  /** Logger instance for MetricsService. */
  private readonly _logger = new Logger(MetricsService.name);

  /** Lazy-loaded invoices service */
  private _invoicesService: InvoicesService | null = null;
  /** Lazy-loaded customer charges service */
  private _customerChargesService: CustomerChargesService | null = null;
  /** Lazy-loaded orders service */
  private _ordersService: OrdersService | null = null;
  /** Lazy-loaded products service */
  private _productsService: ProductsService | null = null;
  /** Lazy-loaded tenants service */
  private _tenantsService: TenantsService | null = null;
  /** Lazy-loaded trials service */
  private _trialsService: TrialsService | null = null;
  /** Lazy-loaded contracts service */
  private _contractsService: ContractsService | null = null;
  /** Lazy-loaded resellers service */
  private _resellersService: ResellersService | null = null;
  /** Lazy-loaded reseller contracts service */
  private _resellerContractsService: ResellerContractsService | null = null;
  /** Lazy-loaded users service */
  private _usersService: UsersService | null = null;
  /** Lazy-loaded HubSpot service */
  private _hubspotService: HubspotService | null = null;
  /** Lazy-loaded Mixpanel service */
  private _mixpanelService: MixpanelService | null = null;
  /** Lazy-loaded Intercom service */
  private _intercomService: IntercomService | null = null;
  /** Lazy-loaded Sentry service */
  private _sentryService: SentryService | null = null;
  /** Lazy-loaded CloudWatch service */
  private _cloudwatchService: CloudwatchService | null = null;
  /** Customer base last read for the customer success metrics, shared by periods and reads in flight. */
  private _customerBase: { read: Promise<CustomerBase>; readAt: number } | null = null;

  /**
   * Constructor for MetricsService.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   * @param _revenueRecordModel the model to manage revenue dashboard metrics records.
   * @param _utilitiesRecordModel the model to manage utilities dashboard metrics records.
   * @param _customerSuccessRecordModel the model to manage customer success dashboard metrics records.
   * @param _supportRecordModel the model to manage support dashboard metrics records.
   * @param _adoptionRecordModel the model to manage product adoption dashboard metrics records.
   * @param _resellerOverviewRecordModel the model to manage reseller overview dashboard metrics records.
   * @param _salesOrdersRecordModel the model to manage sales orders dashboard metrics records.
   * @param _technicalErrorsRecordModel the model to manage technical errors dashboard metrics records.
   * @param _availabilityRecordModel the model to manage availability dashboard metrics records.
   * @param _healthCheckModel the model to manage the state of the health check of each product.
   * @param _outageModel the model to manage the closed outages of the products.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader,
    @InjectModel('RevenueDashboardMetricsRecord')
    private readonly _revenueRecordModel: Model<RevenueDashboardMetricsRecord, RevenueDashboardMetricsRecordKey>,
    @InjectModel('UtilitiesDashboardMetricsRecord')
    private readonly _utilitiesRecordModel: Model<UtilitiesDashboardMetricsRecord, UtilitiesDashboardMetricsRecordKey>,
    @InjectModel('CustomerSuccessDashboardMetricsRecord')
    private readonly _customerSuccessRecordModel: Model<CustomerSuccessDashboardMetricsRecord, CustomerSuccessDashboardMetricsRecordKey>,
    @InjectModel('SupportDashboardMetricsRecord')
    private readonly _supportRecordModel: Model<SupportDashboardMetricsRecord, SupportDashboardMetricsRecordKey>,
    @InjectModel('ProductAdoptionDashboardMetricsRecord')
    private readonly _adoptionRecordModel: Model<ProductAdoptionDashboardMetricsRecord, ProductAdoptionDashboardMetricsRecordKey>,
    @InjectModel('ResellerOverviewDashboardMetricsRecord')
    private readonly _resellerOverviewRecordModel: Model<ResellerOverviewDashboardMetricsRecord, ResellerOverviewDashboardMetricsRecordKey>,
    @InjectModel('SalesOrdersDashboardMetricsRecord')
    private readonly _salesOrdersRecordModel: Model<SalesOrdersDashboardMetricsRecord, SalesOrdersDashboardMetricsRecordKey>,
    @InjectModel('TechnicalErrorsDashboardMetricsRecord')
    private readonly _technicalErrorsRecordModel: Model<TechnicalErrorsDashboardMetricsRecord, TechnicalErrorsDashboardMetricsRecordKey>,
    @InjectModel('AvailabilityDashboardMetricsRecord')
    private readonly _availabilityRecordModel: Model<AvailabilityDashboardMetricsRecord, AvailabilityDashboardMetricsRecordKey>,
    @InjectModel('ProductHealthCheck')
    private readonly _healthCheckModel: Model<ProductHealthCheck, ProductHealthCheckKey>,
    @InjectModel('ProductOutage')
    private readonly _outageModel: Model<ProductOutage, ProductOutageKey>,
  ) {}

  /**
   * Lazy loads the InvoicesService from its module.
   * @returns A Promise resolving to the InvoicesService instance.
   */
  private async _loadInvoicesService(): Promise<InvoicesService> {
    if (!this._invoicesService) {
      const { InvoicesLazyModule } = await import('../../../invoices/lazy-invoices/invoices-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => InvoicesLazyModule);
      const { InvoicesService } = await import('../../../invoices/lazy-invoices/services/invoices.service');
      this._invoicesService = moduleRef.get<InvoicesService>(InvoicesService);
    }
    return this._invoicesService;
  }

  /**
   * Lazy loads the CustomerChargesService from the invoices module.
   * @returns A Promise resolving to the CustomerChargesService instance.
   */
  private async _loadCustomerChargesService(): Promise<CustomerChargesService> {
    if (!this._customerChargesService) {
      const { InvoicesLazyModule } = await import('../../../invoices/lazy-invoices/invoices-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => InvoicesLazyModule);
      const { CustomerChargesService } = await import('../../../invoices/lazy-invoices/services/customer-charges.service');
      this._customerChargesService = moduleRef.get<CustomerChargesService>(CustomerChargesService);
    }
    return this._customerChargesService;
  }

  /**
   * Lazy loads the OrdersService from its module.
   * @returns A Promise resolving to the OrdersService instance.
   */
  private async _loadOrdersService(): Promise<OrdersService> {
    if (!this._ordersService) {
      const { OrdersLazyModule } = await import('../../../orders/lazy-orders/orders-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => OrdersLazyModule);
      const { OrdersService } = await import('../../../orders/lazy-orders/services/orders.service');
      this._ordersService = moduleRef.get<OrdersService>(OrdersService);
    }
    return this._ordersService;
  }

  /**
   * Lazy loads the ProductsService from its module.
   * @returns A Promise resolving to the ProductsService instance.
   */
  private async _loadProductsService(): Promise<ProductsService> {
    if (!this._productsService) {
      const { ProductsLazyModule } = await import('../../../products/lazy-products/products-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => ProductsLazyModule);
      this._productsService = moduleRef.get<ProductsService>(ProductsService);
    }
    return this._productsService;
  }

  /**
   * Lazy loads the TenantsService from its module.
   * @returns A Promise resolving to the TenantsService instance.
   */
  private async _loadTenantsService(): Promise<TenantsService> {
    if (!this._tenantsService) {
      const { TenantsLazyModule } = await import('../../../tenants/lazy-tenants/tenants-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => TenantsLazyModule);
      this._tenantsService = moduleRef.get<TenantsService>(TenantsService);
    }
    return this._tenantsService;
  }

  /**
   * Lazy loads the TrialsService from its module.
   * @returns A Promise resolving to the TrialsService instance.
   */
  private async _loadTrialsService(): Promise<TrialsService> {
    if (!this._trialsService) {
      const { TrialsLazyModule } = await import('../../../trials/lazy-trials/trials-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => TrialsLazyModule);
      this._trialsService = moduleRef.get<TrialsService>(TrialsService);
    }
    return this._trialsService;
  }

  /**
   * Lazy loads the ContractsService from its module.
   * @returns A Promise resolving to the ContractsService instance.
   */
  private async _loadContractsService(): Promise<ContractsService> {
    if (!this._contractsService) {
      const { ContractsLazyModule } = await import('../../../contracts/lazy-contracts/contracts-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => ContractsLazyModule);
      this._contractsService = moduleRef.get<ContractsService>(ContractsService);
    }
    return this._contractsService;
  }

  /**
   * Lazy loads the ResellersService from its module.
   * @returns A Promise resolving to the ResellersService instance.
   */
  private async _loadResellersService(): Promise<ResellersService> {
    if (!this._resellersService) {
      const { ResellersLazyModule } = await import(
        '../../../resellers/lazy-resellers/resellers-lazy.module'
      );
      const moduleRef = await this._lazyModuleLoader.load(() => ResellersLazyModule);
      this._resellersService = moduleRef.get<ResellersService>(ResellersService);
    }
    return this._resellersService;
  }

  /**
   * Lazy loads the ResellerContractsService from its module.
   * @returns A Promise resolving to the ResellerContractsService instance.
   */
  private async _loadResellerContractsService(): Promise<ResellerContractsService> {
    if (!this._resellerContractsService) {
      const { ResellerContractsLazyModule } = await import(
        '../../../reseller-contracts/lazy-reseller-contracts/reseller-contracts-lazy.module'
      );
      const { ResellerContractsService } = await import(
        '../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service'
      );
      const moduleRef = await this._lazyModuleLoader.load(() => ResellerContractsLazyModule);
      this._resellerContractsService = moduleRef.get<ResellerContractsService>(ResellerContractsService);
    }
    return this._resellerContractsService;
  }

  /**
   * Lazy loads the UsersService from its module.
   * @returns A Promise resolving to the UsersService instance.
   */
  private async _loadUsersService(): Promise<UsersService> {
    if (!this._usersService) {
      const { UsersLazyModule } = await import('../../../users/lazy-users/users-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => UsersLazyModule);
      this._usersService = moduleRef.get<UsersService>(UsersService);
    }
    return this._usersService;
  }

  /**
   * Lazy loads the HubspotService from its module.
   * @returns A Promise resolving to the HubspotService instance.
   */
  private async _loadHubspotService(): Promise<HubspotService> {
    if (!this._hubspotService) {
      const { HubspotLazyModule } = await import('../../../hubspot/lazy-hubspot/hubspot-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => HubspotLazyModule);
      this._hubspotService = moduleRef.get<HubspotService>(HubspotService);
    }
    return this._hubspotService;
  }

  /**
   * Lazy loads the MixpanelService from its module.
   * @returns A Promise resolving to the MixpanelService instance.
   */
  private async _loadMixpanelService(): Promise<MixpanelService> {
    if (!this._mixpanelService) {
      const { MixpanelLazyModule } = await import('../../../mixpanel/lazy-mixpanel/mixpanel-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => MixpanelLazyModule);
      this._mixpanelService = moduleRef.get<MixpanelService>(MixpanelService);
    }
    return this._mixpanelService;
  }

  /**
   * Lazy loads the IntercomService from its module.
   * @returns A Promise resolving to the IntercomService instance.
   */
  private async _loadIntercomService(): Promise<IntercomService> {
    if (!this._intercomService) {
      const { IntercomLazyModule } = await import('../../../intercom/lazy-intercom/intercom-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => IntercomLazyModule);
      this._intercomService = moduleRef.get<IntercomService>(IntercomService);
    }
    return this._intercomService;
  }

  /**
   * Lazy loads the SentryService from its module.
   * @returns A Promise resolving to the SentryService instance.
   */
  private async _loadSentryService(): Promise<SentryService> {
    if (!this._sentryService) {
      const { SentryLazyModule } = await import('../../../sentry/lazy-sentry/sentry-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => SentryLazyModule);
      this._sentryService = moduleRef.get<SentryService>(SentryService);
    }
    return this._sentryService;
  }

  /**
   * Lazy loads the CloudwatchService from its module.
   * @returns A Promise resolving to the CloudwatchService instance.
   */
  private async _loadCloudwatchService(): Promise<CloudwatchService> {
    if (!this._cloudwatchService) {
      const { CloudwatchLazyModule } = await import('../../../cloudwatch/lazy-cloudwatch/cloudwatch-lazy.module');
      const moduleRef = await this._lazyModuleLoader.load(() => CloudwatchLazyModule);
      this._cloudwatchService = moduleRef.get<CloudwatchService>(CloudwatchService);
    }
    return this._cloudwatchService;
  }

  // #endregion

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
   * Resolves the path of a reseller read with the scope of the requester: a Keus salesperson reads only its own
   * resellers, a reseller only itself or its subtree.
   * @param resellerId the reseller.
   * @param scope the request scope.
   * @returns the reseller path.
   * @throws AuthorizationException if the reseller is outside the requester's scope.
   * @throws EntityNotFoundException if the reseller does not exist.
   */
  private async _resellerPathOf(resellerId: string, scope: RequestScope): Promise<string | undefined> {
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(resellerId, scope);

    return resellersService.getResellerPath(reseller.code);
  }

  /**
   * Reads what a Keus salesperson sold (`SalesOwnership`), with one read of the sales index of the resellers.
   * @param scope the request scope.
   * @returns the bound, or null when the requester reads the whole of Keus.
   */
  private async _salesOwnership(scope: RequestScope): Promise<SalesOwnership | null> {
    if (!isKeusSalespersonOnly(scope)) {
      return null;
    }

    const resellersService = await this._loadResellersService();
    const resellers = await resellersService.getAllResellers(scope);
    return { salesId: scope.sub, resellerCodes: new Set(resellers.map(reseller => reseller.code)) };
  }

  /**
   * Reduces the raw revenue records of the relevant months to the set the request may see: the global records for
   * the whole of Keus; for a Keus salesperson, the sum of its own leaf records and of the leaf records of its
   * resellers, collapsed to one record per (product, month).
   * @param records the raw revenue records.
   * @param ownership what the Keus salesperson sold, null for the whole of Keus.
   * @returns the scoped revenue records.
   */
  private _scopeRevenueRecords(records: RevenueDashboardMetricsRecord[], ownership: SalesOwnership | null): RevenueDashboardMetricsRecord[] {
    if (!ownership) {
      return records.filter(record => !record.resellerPath && !record.salesId);
    }

    const byKey = new Map<string, RevenueDashboardMetricsRecord>();
    for (const record of records) {
      // The network has one level: the last segment of the path is the selling reseller.
      const sellerCode = record.resellerPath?.split('#').filter(Boolean).pop();
      if (record.salesId !== ownership.salesId && !(sellerCode && ownership.resellerCodes.has(sellerCode))) {
        continue;
      }

      const key = `${record.productId}#${record.monthIndex}`;
      const acc = byKey.get(key);
      if (acc) {
        acc.revenue += record.revenue;
      } else {
        byKey.set(key, { productId: record.productId, id: key, monthIndex: record.monthIndex, revenue: record.revenue });
      }
    }
    return [...byKey.values()];
  }

  /**
   * Reduces the raw utilities records (already filtered by logic) to the set the
   * request may see: the global records (no resellerPath) for the whole of Keus;
   * for a reseller, its own or the one a collaborator asks for, the sum of the
   * leaf records of its whole subtree, collapsed to one record per (product, month).
   * @param records the raw utilities records (single logic).
   * @param global whether the request reads the whole of Keus.
   * @param viewerPath the reseller path read, undefined for the whole of Keus.
   * @returns the scoped utilities records.
   */
  private _scopeUtilitiesRecords(
    records: UtilitiesDashboardMetricsRecord[],
    global: boolean,
    viewerPath: string | undefined,
  ): UtilitiesDashboardMetricsRecord[] {
    if (global) {
      return records.filter(record => !record.resellerPath);
    }
    if (!viewerPath) {
      return [];
    }
    const byKey = new Map<string, UtilitiesDashboardMetricsRecord>();
    for (const record of records) {
      if (!record.resellerPath || !record.resellerPath.startsWith(viewerPath)) {
        continue;
      }
      const key = `${record.productId}#${record.monthIndex}`;
      const acc = byKey.get(key);
      if (acc) {
        acc.users += record.users;
        acc.trials += record.trials;
        acc.contracts += record.contracts;
        acc.tenants += record.tenants;
      } else {
        byKey.set(key, {
          productId: record.productId,
          id: key,
          monthIndex: record.monthIndex,
          users: record.users,
          trials: record.trials,
          contracts: record.contracts,
          tenants: record.tenants,
          logic: record.logic,
          resellerPath: viewerPath,
        });
      }
    }
    return [...byKey.values()];
  }

  /**
   * Retrieves how every customer tenant came out of the rules of its product (UR-RK-223), evaluated on the last
   * day of the period, or now when the period is not over. The events are read from Mixpanel at every call and never
   * stored: the monthly counts are `getProductAdoptionDashboardMetrics`.
   * @param from start of the period (YYYY-MM-DD, inclusive): activation judges the tenants whose first days ended in it.
   * @param to end of the period (YYYY-MM-DD, inclusive): the evaluation date.
   * The tenants are the ones of the requester's perimeter (UR-RK-339): every customer for Keus, the subtree of a
   * reseller, its own or the one asked for, and for a reseller salesperson only the tenants of the orders it opened.
   * A Keus salesperson reads only one of the resellers it is the reference salesperson of.
   * @param from start of the period (YYYY-MM-DD, inclusive): activation judges the tenants whose first days ended in it.
   * @param to end of the period (YYYY-MM-DD, inclusive): the evaluation date.
   * @param productId optional product filter; when omitted, the tenants of every product are returned.
   * @param resellerId the reseller whose tenants are read; absent for the requester's own perimeter.
   * @param scope the request scope.
   * @returns one row per customer tenant, with its outcome on each lever that judges it; none without Mixpanel.
   * @throws ValidationException if the dates are missing or malformed.
   * @throws AuthorizationException if a Keus salesperson names no reseller, or the reseller is outside the scope.
   * @throws EntityNotFoundException if the reseller does not exist.
   * @throws DatabaseException if a read fails.
   */
  async getMixpanelTenantKpi(
    from: string,
    to: string,
    productId: string | undefined,
    resellerId: string | undefined,
    scope: RequestScope,
  ): Promise<ResponseMixpanelTenantKpiDto[]> {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !datePattern.test(from) || !datePattern.test(to) || from > to) {
      throw new ValidationException("Query params 'from' and 'to' are required, in YYYY-MM-DD format, with 'from' not after 'to'.", []);
    }
    if (isKeusSalespersonOnly(scope) && !resellerId) {
      throw new AuthorizationException('A Keus salesperson reads the tenants of one of its resellers.');
    }

    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      return [];
    }

    this._logger.log(`Retrieving Mixpanel tenant KPI from ${from} to ${to}${productId ? ` for product ${productId}` : ''}${resellerId ? ` of reseller ${resellerId}` : ''}.`);
    const viewerPath = resellerId ? await this._resellerPathOf(resellerId, scope) : await this._resolveScopePath(scope);
    const global = isUnrestricted(scope) && !resellerId;
    if (!global && !viewerPath) {
      return [];
    }

    try {
      const ownContracts = isSalespersonOnly(scope) ? await this._contractsSoldBy(scope.sub, viewerPath) : null;
      const keep = (tenant: ResponseTenantDto): boolean => global
        || (isPathVisible(viewerPath, tenant.resellerPath) && (!ownContracts || ownContracts.has(tenant.contractId)));
      const periodStart = new Date(`${from}T00:00:00.000Z`).getTime();
      const asOf = Math.min(new Date(`${to}T23:59:59.999Z`).getTime(), this._adoptionNow());
      const adoptions = await this._evaluateAdoption(periodStart, asOf, productId, keep);

      return adoptions.map(({ tenant, results }) => {
        const resellerCode = this._resellerCodeOf(tenant.resellerPath);
        return plainToInstance(ResponseMixpanelTenantKpiDto, {
          tenantId: tenant.id,
          tenantName: tenant.name,
          productId: tenant.productId,
          ...(resellerCode && { resellerCode }),
          levers: results,
        });
      });
    } catch (error) {
      this._logger.error('Error retrieving Mixpanel tenant KPI', error);
      throw new DatabaseException('An error occurred while retrieving Mixpanel tenant KPI.', error);
    }
  }

  /**
   * Retrieves the adoption counts of the products (UR-RK-223): per product, period, seller and lever, how many
   * tenants came out of the rules in each way. As the other dashboards, the current month is evaluated again from
   * Mixpanel and written, the others are read as they were at their end. A year sums the activation of its months
   * and takes the other levers from its last month, since they count every tenant at the end of the month.
   * Products with no Mixpanel project or no rule get no record: they are not counted as zero (UR-RK-220).
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve.
   * @param scope the scope of the caller.
   * @returns the counts per product, period, seller and lever.
   * @throws ValidationException if the number of intervals is out of bounds.
   * @throws DatabaseException if a read fails.
   */
  async getProductAdoptionDashboardMetrics(
    period: MetricsPeriod,
    intervals: number,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<ResponseProductAdoptionPeriodRecordDto[]> {
    // The adoption of every customer of Keus, with no reseller filter: reserved to Keus collaborators.
    assertCollaborator(scope, 'getProductAdoptionDashboardMetrics');
    this._logger.log(`Retrieving product adoption dashboard metrics, period: ${period}, intervals: ${intervals}`);
    this._assertIntervals(period, intervals);

    try {
      await this._refreshCurrentMonthAdoptionRecords();

      const stored = (await Promise.all(this._generateMonthIndexes(intervals, period).map(monthIndex =>
        this._adoptionRecordModel.query('monthIndex').eq(monthIndex).using('monthIndex').exec(),
      ))).flat();
      const records = period === MetricsPeriod.Annual
        ? this._foldAdoptionYears(stored)
        : stored.map(record => this._toAdoptionPeriodRecord(record, record.monthIndex));

      this._logger.log(`Product adoption metrics (${period}): ${records.length} records.`);
      return records;
    } catch (error) {
      this._logger.error('Error retrieving product adoption dashboard metrics', error);
      throw new DatabaseException('An error occurred while retrieving the product adoption metrics.', error);
    }
  }

  /**
   * Evaluates every customer tenant on the rules of its product. A customer is a tenant on the product with a
   * contract: trials are prospects, not judged. Its start is the first delivery of credentials among its order lines,
   * or its creation when no line says so. One export per product reads, from the first moment any rule needs,
   * what every rule asks of its tenants.
   * @param periodStart the start of the period, in epoch milliseconds.
   * @param asOf the evaluation moment, in epoch milliseconds.
   * @param productId optional product filter.
   * @param keep which customer tenants to evaluate, all of them when absent.
   * @returns the customer tenants of the products with a Mixpanel project and some rule, with their outcomes.
   */
  private async _evaluateAdoption(
    periodStart: number,
    asOf: number,
    productId?: string,
    keep?: (tenant: ResponseTenantDto) => boolean,
  ): Promise<TenantAdoption[]> {
    const productsService = await this._loadProductsService();
    const products = (productId ? [await productsService.getProduct(productId)] : await productsService.getAllProducts())
      .filter(product => product.mixpanelProjectId && product.mixpanelRules?.length);

    const tenantsService = await this._loadTenantsService();
    const ordersService = await this._loadOrdersService();
    const mixpanelService = await this._loadMixpanelService();

    const perProduct = await Promise.all(products.map(async (product: ResponseProductDto): Promise<TenantAdoption[]> => {
      const [tenants, lines] = await Promise.all([
        tenantsService.getTenantsByProduct(product.id, SYSTEM_SCOPE),
        Promise.all([OrderLineStatus.Provisioned, OrderLineStatus.Activated].map(status => ordersService.getLinesByStatus(product.id, status)))
          .then(lists => lists.flat()),
      ]);
      const customers = tenants.filter(tenant => !NOT_ON_PRODUCT.includes(tenant.status) && tenant.contractId && (!keep || keep(tenant)));
      if (customers.length === 0) {
        return [];
      }

      const deliveredAt = new Map<string, number>();
      for (const line of lines) {
        const at = line.provisionedAt ? new Date(line.provisionedAt).getTime() : undefined;
        if (line.tenantId && at !== undefined && at < (deliveredAt.get(line.tenantId) ?? Infinity)) {
          deliveredAt.set(line.tenantId, at);
        }
      }
      const starts: Record<string, number> = {};
      for (const tenant of customers) {
        starts[tenant.id] = deliveredAt.get(tenant.id) ?? new Date(tenant.createdAt).getTime();
      }

      const rules = product.mixpanelRules ?? [];
      const rulesByLever = new Map<MixpanelLever, MixpanelLeverRule[]>();
      for (const rule of rules) {
        rulesByLever.set(rule.lever, [...(rulesByLever.get(rule.lever) ?? []), rule]);
      }
      const userRules = rules.filter(rule => rule.shape === MixpanelRuleShape.Inactivity && rule.inactivityScope === MixpanelInactivityScope.User);
      const usersByTenant = userRules.length > 0
        ? await this._activeUsersByTenant(product.id, userRules, new Set(customers.map(tenant => tenant.id)))
        : new Map<string, AdoptionUser[]>();

      const factsByTenant = new Map<string, AdoptionTenant>(customers.map(tenant => [tenant.id, {
        deliveredAt: starts[tenant.id],
        activeUsers: tenant.activeUsers ?? 0,
        users: usersByTenant.get(tenant.id),
      }]));

      const from = readStart(rules, asOf, periodStart, Math.min(...Object.values(starts)));
      const stats = await mixpanelService.getTenantRuleStats({
        projectId: product.mixpanelProjectId,
        from: new Date(from).toISOString().slice(0, 10),
        to: new Date(asOf).toISOString().slice(0, 10),
        starts,
        rules: rules.map(rule => toRuleQuery(rule, asOf)),
        ...(usersByTenant.size > 0 && { users: toQueryUsers(factsByTenant, asOf) }),
        coreEventNames: MIXPANEL_CORE_EVENTS,
      });

      return customers.map(tenant => {
        const tenantStats: Record<string, MixpanelRuleStats> = stats.get(tenant.id) ?? {};
        const results = [...rulesByLever].map(([lever, leverRules]) => evaluateLever(lever, leverRules, tenantStats, factsByTenant.get(tenant.id), asOf, periodStart))
          .filter((result): result is LeverResult => result !== null);
        return { tenant, results };
      });
    }));

    return perProduct.flat();
  }

  /**
   * Reads the active users of a product that its inactivities per user look at, grouped by tenant, with one query on
   * the status of the users. Only the roles the rules filter on are kept: a rule with no roles takes every user.
   * @param productId the identifier of the product.
   * @param userRules the inactivity rules per user of the product.
   * @param tenantIds the tenants that are judged: the users of the others are left out.
   * @returns the active users of each tenant, by tenant id.
   */
  private async _activeUsersByTenant(productId: string, userRules: MixpanelLeverRule[], tenantIds: Set<string>): Promise<Map<string, AdoptionUser[]>> {
    const usersService = await this._loadUsersService();
    const wantedRoles = userRules.some(rule => !rule.userRoles?.length)
      ? null
      : new Set(userRules.flatMap(rule => rule.userRoles ?? []));
    const users = (await usersService.getByStatus(productId, UserStatus.Active))
      .filter(user => tenantIds.has(user.tenant) && (!wantedRoles || user.roles.some(role => wantedRoles.has(role))));

    const byTenant = new Map<string, AdoptionUser[]>();
    for (const user of users) {
      const adoptionUser: AdoptionUser = { id: user.id, createdAt: new Date(user.createdAt).getTime(), roles: user.roles };
      const tenantUsers = byTenant.get(user.tenant);
      if (tenantUsers) {
        tenantUsers.push(adoptionUser);
      } else {
        byTenant.set(user.tenant, [adoptionUser]);
      }
    }
    return byTenant;
  }

  /**
   * Evaluates the tenants at this moment and writes the counts of the current month into its records, one per
   * product, seller and lever: a known record is updated, a new one is created, and one left with nothing in the
   * month goes back to zero. Every product with rules has its direct record for each of its levers.
   */
  private async _refreshCurrentMonthAdoptionRecords(): Promise<void> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    // Without Mixpanel the records of the month stay as they were written.
    if (!integrationsEnabled()) {
      return;
    }

    const range = this._generatePeriodRanges(MetricsPeriod.Monthly, 1)[0];
    const now = this._adoptionNow();
    const adoptions = await this._evaluateAdoption(range.start.getTime(), now);
    const products = (await (await this._loadProductsService()).getAllProducts())
      .filter(product => product.mixpanelProjectId && product.mixpanelRules?.length);

    const counts = new Map<string, AdoptionCounts>();
    const countOf = (productId: string, resellerPath: string | undefined, lever: MixpanelLever): AdoptionCounts => {
      const key = `${productId}#${resellerPath ?? ''}#${lever}`;
      let count = counts.get(key);
      if (!count) {
        count = { productId, ...(resellerPath && { resellerPath }), lever, compliant: 0, atRisk: 0, failing: 0, notAssessable: 0, observed: 0 };
        counts.set(key, count);
      }
      return count;
    };
    const field: Record<LeverOutcome, 'compliant' | 'atRisk' | 'failing' | 'notAssessable' | 'observed'> = {
      [LeverOutcome.Compliant]: 'compliant',
      [LeverOutcome.AtRisk]: 'atRisk',
      [LeverOutcome.Failing]: 'failing',
      [LeverOutcome.NotAssessable]: 'notAssessable',
      [LeverOutcome.Observed]: 'observed',
    };

    for (const product of products) {
      for (const rule of product.mixpanelRules ?? []) {
        countOf(product.id, undefined, rule.lever);
      }
    }
    for (const { tenant, results } of adoptions) {
      for (const result of results) {
        countOf(tenant.productId, tenant.resellerPath, result.lever)[field[result.outcome]] += 1;
      }
    }

    const existing = await this._adoptionRecordModel.query('monthIndex').eq(range.label).using('monthIndex').exec();
    const existingByKey = new Map(existing.map(record => [`${record.productId}#${record.resellerPath ?? ''}#${record.lever}`, record]));

    const writes: Promise<unknown>[] = [];
    for (const [key, count] of counts) {
      const known = existingByKey.get(key);
      existingByKey.delete(key);
      const values = { compliant: count.compliant, atRisk: count.atRisk, failing: count.failing, notAssessable: count.notAssessable, observed: count.observed };
      writes.push(known
        ? this._adoptionRecordModel.update({ productId: known.productId, id: known.id }, values)
        : this._adoptionRecordModel.create({
          productId: count.productId,
          id: recordIdOf(range.label, key),
          monthIndex: range.label,
          ...(count.resellerPath && { resellerPath: count.resellerPath }),
          lever: count.lever,
          ...values,
        }, { overwrite: true, return: 'item' }));
    }
    for (const stale of existingByKey.values()) {
      writes.push(this._adoptionRecordModel.update(
        { productId: stale.productId, id: stale.id },
        { compliant: 0, atRisk: 0, failing: 0, notAssessable: 0, observed: 0 },
      ));
    }
    await Promise.all(writes);

    this._logger.log(`Refreshed product adoption records for month ${range.label}: ${counts.size} written, ${existingByKey.size} reset.`);
  }

  /**
   * Reads the moment the adoption is evaluated at now, rounded down to `ADOPTION_CLOCK_MS`: the windows of the rules
   * open from it, so a moment that moved every millisecond would give every read a new query and miss the cache.
   * @returns the evaluation moment, in epoch milliseconds.
   */
  private _adoptionNow(): number {
    return Math.floor(Date.now() / ADOPTION_CLOCK_MS) * ADOPTION_CLOCK_MS;
  }

  /**
   * Folds the monthly adoption records into years, one per product, seller, lever and year: activation sums its
   * months, since each counts the tenants whose first days ended in it; the other levers take the last month.
   * @param records the monthly records of the years.
   * @returns the yearly records.
   */
  private _foldAdoptionYears(records: ProductAdoptionDashboardMetricsRecord[]): ResponseProductAdoptionPeriodRecordDto[] {
    const byYear = new Map<string, ProductAdoptionDashboardMetricsRecord[]>();
    for (const record of records) {
      const key = `${record.productId}#${record.resellerPath ?? ''}#${record.lever}#${record.monthIndex.slice(0, 4)}`;
      byYear.set(key, [...(byYear.get(key) ?? []), record]);
    }

    return [...byYear.values()].map(months => {
      const year = months[0].monthIndex.slice(0, 4);
      if (months[0].lever !== MixpanelLever.Activation) {
        const last = months.reduce((latest, month) => month.monthIndex > latest.monthIndex ? month : latest);
        return this._toAdoptionPeriodRecord(last, year);
      }
      const sum = (pick: (month: ProductAdoptionDashboardMetricsRecord) => number): number =>
        months.reduce((total, month) => total + pick(month), 0);
      return this._toAdoptionPeriodRecord({
        ...months[0],
        compliant: sum(month => month.compliant),
        atRisk: sum(month => month.atRisk),
        failing: sum(month => month.failing),
        notAssessable: sum(month => month.notAssessable),
        observed: sum(month => month.observed),
      }, year);
    });
  }

  /**
   * Builds the record of a period from a stored, or folded, adoption record.
   * @param record the record with the counts.
   * @param period the label of the period (format: "YYYY-MM" or "YYYY").
   * @returns the record of the period.
   */
  private _toAdoptionPeriodRecord(record: ProductAdoptionDashboardMetricsRecord, period: string): ResponseProductAdoptionPeriodRecordDto {
    const resellerCode = this._resellerCodeOf(record.resellerPath);
    return plainToInstance(ResponseProductAdoptionPeriodRecordDto, {
      productId: record.productId,
      period,
      ...(resellerCode && { resellerCode }),
      lever: record.lever,
      compliant: record.compliant,
      atRisk: record.atRisk,
      failing: record.failing,
      notAssessable: record.notAssessable,
      observed: record.observed,
    });
  }

  /**
   * Retrieves revenue dashboard metrics: of the whole of Keus, or of what a Keus salesperson sold (decision of
   * Damiano, 18/10/2026).
   * - Current month: recalculates from the invoices collected in it and upserts records in the metrics table.
   * - Past months: reads directly from stored records.
   * - Annual mode: aggregates monthly records by year.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve.
   * @param scope the request scope.
   * @returns aggregated revenue metrics records.
   */
  async getRevenueDashboardMetrics(
    period: MetricsPeriod,
    intervals: number,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<ResponseRevenueDashboardMetricsRecordDto[]> {
    this._logger.log(`Retrieving revenue dashboard metrics, period: ${period}, intervals: ${intervals}`);
    this._assertIntervals(period, intervals);
    const ownership = await this._salesOwnership(scope);

    try {
      const currentMonthIndex = new Date().toISOString().slice(0, 7);
      const monthIndexes = this._generateMonthIndexes(intervals, period);

      // 1. Refresh current month records from the invoices
      await this._refreshCurrentMonthRevenueRecords(currentMonthIndex);

      // 2. Read all stored records for the relevant months
      const recordResults = await Promise.all(
        monthIndexes.map(monthIndex =>
          this._revenueRecordModel.query('monthIndex').eq(monthIndex).using('monthIndex').exec(),
        ),
      );
      // Scope to the request: the whole of Keus sees the global records, a Keus salesperson
      // its own leaf records and the ones of its resellers, summed to one record per (product, month).
      const allRecords = this._scopeRevenueRecords(recordResults.flat(), ownership);

      // 3. If annual, aggregate monthly records by product + year
      if (period === MetricsPeriod.Annual) {
        const years = this._getYearsFromMonthIndexes(monthIndexes);
        const aggregated: ResponseRevenueDashboardMetricsRecordDto[] = [];

        const productIds = new Set(allRecords.map(r => r.productId));
        for (const productId of productIds) {
          for (const year of years) {
            const revenue = allRecords
              .filter(r => r.productId === productId && r.monthIndex.startsWith(year))
              .reduce((sum, r) => sum + r.revenue, 0);

            aggregated.push(plainToInstance(ResponseRevenueDashboardMetricsRecordDto, {
              productId,
              id: `${productId}_${year}`,
              monthIndex: year,
              revenue,
            }));
          }
        }

        this._logger.log(`Revenue metrics (annual): ${aggregated.length} aggregated records.`);
        return aggregated;
      }

      // Monthly: return stored records as-is
      this._logger.log(`Revenue metrics (monthly): ${allRecords.length} records.`);
      return allRecords.map(r => plainToInstance(ResponseRevenueDashboardMetricsRecordDto, r));

    } catch (error) {
      this._logger.error('Error retrieving revenue dashboard metrics', error);
      throw new DatabaseException('An error occurred while retrieving revenue dashboard metrics.', error);
    }
  }

  /**
   * Retrieves utilities dashboard metrics.
   * - Current month: recalculates counts from raw data and upserts records in the metrics table.
   * - Past months: reads directly from stored records.
   * - Annual mode: aggregates monthly records by year, summing the activated ones and taking the latest month of the active ones.
   * @param period the period of the metrics (annual or monthly).
   * @param logic the logic type (activated = by monthIndex, active = by status).
   * @param intervals the number of intervals to retrieve.
   * @param scope the request scope.
   * @param resellerId the reseller whose utilities are read; absent for the requester's own perimeter.
   * @returns aggregated utilities metrics records.
   * @throws AuthorizationException if the reseller is outside the requester's scope.
   * @throws EntityNotFoundException if the reseller does not exist.
   */
  async getUtilitiesDashboardMetrics(
    period: MetricsPeriod,
    logic: MetricsLogic,
    intervals: number,
    scope: RequestScope = SYSTEM_SCOPE,
    resellerId?: string,
  ): Promise<ResponseUtilitiesDashboardMetricsRecordDto[]> {
    this._logger.log(`Retrieving utilities dashboard metrics, period: ${period}, logic: ${logic}, intervals: ${intervals}${resellerId ? `, reseller: ${resellerId}` : ''}`);
    this._assertIntervals(period, intervals);
    if (isKeusSalespersonOnly(scope) && !resellerId) {
      throw new AuthorizationException('A Keus salesperson reads the utilities of one of its resellers.');
    }
    const viewerPath = resellerId ? await this._resellerPathOf(resellerId, scope) : await this._resolveScopePath(scope);

    try {
      const currentMonthIndex = new Date().toISOString().slice(0, 7);
      const monthIndexes = this._generateMonthIndexes(intervals, period);

      // 1. Refresh current month records
      await this._refreshCurrentMonthUtilitiesRecords(currentMonthIndex, logic);

      // 2. Read all stored records for the relevant months, filtered by logic
      const recordResults = await Promise.all(
        monthIndexes.map(monthIndex =>
          this._utilitiesRecordModel.query('monthIndex').eq(monthIndex).using('monthIndex').exec(),
        ),
      );
      // Scope to the request: the whole of Keus sees the global records, a reseller, its own
      // or the one asked for, its subtree summed to one record per (product, month).
      const global = isUnrestricted(scope) && !resellerId;
      const allRecords = this._scopeUtilitiesRecords(recordResults.flat().filter(r => r.logic === logic), global, viewerPath);

      // 3. If annual, aggregate monthly records by product + year
      if (period === MetricsPeriod.Annual) {
        const years = this._getYearsFromMonthIndexes(monthIndexes);
        const aggregated: ResponseUtilitiesDashboardMetricsRecordDto[] = [];

        const productIds = new Set(allRecords.map(r => r.productId));
        for (const productId of productIds) {
          for (const year of years) {
            const monthRecords = allRecords.filter(
              r => r.productId === productId && r.monthIndex.startsWith(year),
            );
            // Active counts are a snapshot of each month: the year is its latest month, not their sum.
            const latestMonth = monthRecords.reduce((latest, r) => r.monthIndex > latest ? r.monthIndex : latest, '');
            const yearRecords = logic === MetricsLogic.Active
              ? monthRecords.filter(r => r.monthIndex === latestMonth)
              : monthRecords;

            const users = yearRecords.reduce((sum, r) => sum + r.users, 0);
            const trials = yearRecords.reduce((sum, r) => sum + r.trials, 0);
            const contracts = yearRecords.reduce((sum, r) => sum + r.contracts, 0);
            const tenants = yearRecords.reduce((sum, r) => sum + r.tenants, 0);

            aggregated.push(plainToInstance(ResponseUtilitiesDashboardMetricsRecordDto, {
              productId,
              id: `${productId}_${logic}_${year}`,
              monthIndex: year,
              users,
              trials,
              contracts,
              tenants,
              logic,
            }));
          }
        }

        this._logger.log(`Utilities metrics (annual, ${logic}): ${aggregated.length} aggregated records.`);
        return aggregated;
      }

      // Monthly: return stored records as-is
      this._logger.log(`Utilities metrics (monthly, ${logic}): ${allRecords.length} records.`);
      return allRecords.map(r => plainToInstance(ResponseUtilitiesDashboardMetricsRecordDto, r));

    } catch (error) {
      this._logger.error('Error retrieving utilities dashboard metrics', error);
      throw new DatabaseException('An error occurred while retrieving utilities dashboard metrics.', error);
    }
  }

  /**
   * Retrieves what a reseller bills its customers, what it spends with Keus and what it margins, for its dashboard
   * (decisions of Damiano, 18/10/2026 and 23/10/2026). Computed when read from its items (`customer_charges`), every
   * due date of the period whether collected or not: the share of a contract at the price of the customer, with what
   * Keus bills the reseller for the same period, and the reseller's own items, which cost nothing in Rocket. The fee
   * is an expense too, in the month Keus issues its invoice, on the record with no product. The margin is the revenue
   * minus the expenses, so it can be negative.
   *   - A reseller salesperson reads only what it sold, and never expenses or margin.
   *   - The fee belongs to no salesperson of the reseller: narrowed to one, the expenses are only the cost of its sales.
   *   - Anyone else may narrow the result to one salesperson of the reseller.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve.
   * @param resellerId the reseller.
   * @param salesId the salesperson whose sales are read; absent for the whole reseller.
   * @param scope the request scope.
   * @returns one record per product and month, or year: the own items have no product.
   * @throws AuthorizationException if the reseller is outside the requester's scope.
   * @throws EntityNotFoundException if the reseller does not exist.
   */
  async getResellerRevenueDashboardMetrics(
    period: MetricsPeriod,
    intervals: number,
    resellerId: string,
    salesId: string | undefined,
    scope: RequestScope,
  ): Promise<ResponseResellerRevenueDashboardMetricsRecordDto[]> {
    this._logger.log(`Retrieving reseller revenue dashboard metrics, reseller: ${resellerId}, period: ${period}, intervals: ${intervals}${salesId ? `, salesperson: ${salesId}` : ''}`);
    this._assertIntervals(period, intervals);
    const resellersService = await this._loadResellersService();
    await resellersService.getReseller(resellerId, scope);
    const sellerOnly = isSalespersonOnly(scope);
    const seller = sellerOnly ? scope.sub : salesId;

    const monthIndexes = this._generateMonthIndexes(intervals, period).sort();
    const [lastYear, lastMonth] = monthIndexes[monthIndexes.length - 1].split('-').map(Number);
    const from = `${monthIndexes[0]}-01T00:00:00.000Z`;
    const to = new Date(Date.UTC(lastYear, lastMonth, 0, 23, 59, 59, 999)).toISOString();
    const customerChargesService = await this._loadCustomerChargesService();
    const dues = await customerChargesService.getDuesOfPeriod(resellerId, from, to);

    const byKey = new Map<string, { productId?: string; monthIndex: string; revenue: number; expenses: number }>();
    const accOf = (productId: string | undefined, monthIndex: string) => {
      const key = `${productId ?? ''}#${monthIndex}`;
      const acc = byKey.get(key) ?? { ...(productId && { productId }), monthIndex, revenue: 0, expenses: 0 };
      byKey.set(key, acc);
      return acc;
    };

    for (const { dueDate, charge } of dues) {
      if (seller && charge.salesId !== seller) {
        continue;
      }

      const acc = accOf(charge.productId, period === MetricsPeriod.Annual ? dueDate.slice(0, 4) : dueDate.slice(0, 7));
      acc.revenue += charge.amountCents;
      acc.expenses += charge.keusCents ?? 0;
    }

    if (!seller) {
      const invoicesService = await this._loadInvoicesService();
      const fees = (await invoicesService.getInvoicesIssuedTo(resellerId, from, to))
        .filter(invoice => invoice.resellerContractId && invoice.status !== InvoiceStatus.Void);
      for (const invoice of fees) {
        const acc = accOf(undefined, period === MetricsPeriod.Annual ? invoice.issuedAt.slice(0, 4) : invoice.issuedAt.slice(0, 7));
        acc.expenses += invoice.items.reduce((sum, item) => sum + item.amountCents, 0);
      }
    }

    this._logger.log(`Reseller revenue metrics (${period}) of reseller ${resellerId}: ${byKey.size} records.`);
    return [...byKey.entries()].map(([id, { expenses, ...record }]) => plainToInstance(ResponseResellerRevenueDashboardMetricsRecordDto, {
      id,
      ...record,
      ...(!sellerOnly && { expenses, margin: record.revenue - expenses }),
    }));
  }

  /**
   * Retrieves the active licenses, the new activations and the customers served of a reseller (UR-RK-339), per product
   * and period, with the record of every product together. As the other dashboards, the current month is counted
   * again and written, the others are read as they were at their end; a year takes what is in force from its last
   * month and sums the rest.
   *   - The owner, the back office and Keus read the whole reseller and its subtree.
   *   - A reseller salesperson reads only the contracts of the orders it opened.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve.
   * @param resellerId the reseller.
   * @param scope the request scope.
   * @returns one record per product and period, and one per period for every product together.
   * @throws ValidationException if the number of intervals is out of bounds.
   * @throws AuthorizationException if the reseller is outside the requester's scope.
   * @throws EntityNotFoundException if the reseller does not exist.
   * @throws DatabaseException if a read fails.
   */
  async getResellerOverviewDashboardMetrics(
    period: MetricsPeriod,
    intervals: number,
    resellerId: string,
    scope: RequestScope,
  ): Promise<ResponseResellerOverviewPeriodRecordDto[]> {
    this._logger.log(`Retrieving reseller overview dashboard metrics, reseller: ${resellerId}, period: ${period}, intervals: ${intervals}`);
    this._assertIntervals(period, intervals);
    const viewerPath = await this._resellerPathOf(resellerId, scope);
    const salesId = isSalespersonOnly(scope) ? scope.sub : undefined;
    if (!viewerPath) {
      return [];
    }

    try {
      await this._refreshCurrentMonthResellerOverviewRecords(await this._readCustomerBase());

      const stored = (await Promise.all(this._generateMonthIndexes(intervals, period).map(monthIndex =>
        this._resellerOverviewRecordModel.query('monthIndex').eq(monthIndex).using('monthIndex').exec(),
      ))).flat();
      const records = this._scopeResellerOverviewRecords(stored, period, viewerPath, salesId);

      this._logger.log(`Reseller overview metrics (${period}) of reseller ${resellerId}: ${records.length} records.`);
      return records;
    } catch (error) {
      this._logger.error(`Error retrieving reseller overview dashboard metrics of reseller ${resellerId}`, error);
      throw new DatabaseException('An error occurred while retrieving the reseller overview metrics.', error);
    }
  }

  /**
   * Counts the contracts and companies of the resellers and of the direct channel in the current month and writes them
   * into its records, one per product, seller and salesperson: a known record is updated, a new one is created, and one
   * left with nothing in the month goes back to zero.
   * @param base the products with their contracts and delivered lines.
   */
  private async _refreshCurrentMonthResellerOverviewRecords(base: CustomerBase): Promise<void> {
    const range = this._generatePeriodRanges(MetricsPeriod.Monthly, 1)[0];
    const orderIds = base.contracts.filter(contract => contract.resellerPath).map(contract => contract.orderId);
    const salesIds = orderIds.length > 0 ? await (await this._loadOrdersService()).getSalesIds(orderIds) : new Map<string, string>();
    const counts = countResellerOverview(range, base.contracts, salesIds);

    const existing = await this._resellerOverviewRecordModel.query('monthIndex').eq(range.label).using('monthIndex').exec();
    const existingByKey = new Map(existing.map(record => [overviewKeyOf(record.productId, record.resellerPath, record.salesId), record]));

    const writes: Promise<unknown>[] = [];
    for (const count of counts) {
      const key = overviewKeyOf(count.productId, count.resellerPath, count.salesId);
      const known = existingByKey.get(key);
      existingByKey.delete(key);
      const values = {
        contractsInForce: count.contractsInForce,
        contractsStarted: count.contractsStarted,
        companiesInForce: count.companiesInForce,
        companiesNew: count.companiesNew,
      };
      writes.push(known
        ? this._resellerOverviewRecordModel.update({ productId: known.productId, id: known.id }, values)
        : this._resellerOverviewRecordModel.create({
          productId: count.productId,
          id: recordIdOf(range.label, key),
          monthIndex: range.label,
          ...(count.resellerPath && { resellerPath: count.resellerPath }),
          ...(count.salesId && { salesId: count.salesId }),
          ...values,
        }, { overwrite: true, return: 'item' }));
    }
    for (const stale of existingByKey.values()) {
      writes.push(this._resellerOverviewRecordModel.update(
        { productId: stale.productId, id: stale.id },
        { contractsInForce: 0, contractsStarted: 0, companiesInForce: 0, companiesNew: 0 },
      ));
    }
    await Promise.all(writes);

    this._logger.log(`Refreshed reseller overview records for month ${range.label}: ${counts.length} written, ${existingByKey.size} reset.`);
  }

  /**
   * Reduces the reseller overview records to what the request may see, summed per product and period: the records of
   * the whole reseller across its subtree, or the ones of a salesperson; the direct channel stays out. A year takes the
   * contracts and companies in force from its last month and sums the started contracts and the new companies of its
   * months.
   * @param records the raw monthly records.
   * @param period the period of the metrics (annual or monthly).
   * @param viewerPath the lineage of the reseller read.
   * @param salesId the salesperson whose records are read, absent for the whole reseller.
   * @returns one record per product and period.
   */
  private _scopeResellerOverviewRecords(
    records: ResellerOverviewDashboardMetricsRecord[],
    period: MetricsPeriod,
    viewerPath: string,
    salesId: string | undefined,
  ): ResponseResellerOverviewPeriodRecordDto[] {
    type Sum = { productId: string; monthIndex: string; contractsInForce: number; contractsStarted: number; companiesInForce: number; companiesNew: number };
    const months = new Map<string, Sum>();
    for (const record of records) {
      if (!isPathVisible(viewerPath, record.resellerPath) || record.salesId !== salesId) {
        continue;
      }

      const key = `${record.productId}#${record.monthIndex}`;
      const acc = months.get(key) ?? { productId: record.productId, monthIndex: record.monthIndex, contractsInForce: 0, contractsStarted: 0, companiesInForce: 0, companiesNew: 0 };
      acc.contractsInForce += record.contractsInForce;
      acc.contractsStarted += record.contractsStarted;
      acc.companiesInForce += record.companiesInForce;
      acc.companiesNew += record.companiesNew;
      months.set(key, acc);
    }

    const periods = new Map<string, Sum & { lastMonth: string }>();
    for (const month of months.values()) {
      const label = period === MetricsPeriod.Annual ? month.monthIndex.slice(0, 4) : month.monthIndex;
      const key = `${month.productId}#${label}`;
      const acc = periods.get(key);
      if (!acc) {
        periods.set(key, { ...month, monthIndex: label, lastMonth: month.monthIndex });
        continue;
      }

      acc.contractsStarted += month.contractsStarted;
      acc.companiesNew += month.companiesNew;
      if (month.monthIndex > acc.lastMonth) {
        acc.lastMonth = month.monthIndex;
        acc.contractsInForce = month.contractsInForce;
        acc.companiesInForce = month.companiesInForce;
      }
    }

    return [...periods.values()].map(sum => plainToInstance(ResponseResellerOverviewPeriodRecordDto, {
      ...(sum.productId !== ALL_PRODUCTS && { productId: sum.productId }),
      period: sum.monthIndex,
      contractsInForce: sum.contractsInForce,
      contractsStarted: sum.contractsStarted,
      companiesInForce: sum.companiesInForce,
      companiesNew: sum.companiesNew,
    }));
  }

  /**
   * Retrieves the active companies of the global and product dashboards (UR-RK-001, UR-RK-235): the companies with at
   * least one contract in force, on both channels, per product and period, with the record of every product together
   * where a company on two products counts once. They are the companies of the reseller overview records with the
   * direct leaf added: the current month is counted again and written, the others are read as they were at their end,
   * and a year takes its last month.
   *   - Admin and accounting read every product and every product together.
   *   - The Keus back office reads one product at a time, since the global dashboard is not its own.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve.
   * @param productId the product read, absent for every product.
   * @param scope the request scope.
   * @returns one record per product and period, and one per period for every product together when no product is read.
   * @throws AuthorizationException if the caller is not a Keus collaborator, or is the back office without a product.
   * @throws ValidationException if the number of intervals is out of bounds, or the product is `ALL_PRODUCTS`.
   * @throws DatabaseException if a read fails.
   */
  async getActiveCompaniesDashboardMetrics(
    period: MetricsPeriod,
    intervals: number,
    productId: string | undefined,
    scope: RequestScope,
  ): Promise<ResponseActiveCompaniesPeriodRecordDto[]> {
    assertCollaborator(scope, 'getActiveCompaniesDashboardMetrics');
    this._logger.log(`Retrieving active companies dashboard metrics, period: ${period}, intervals: ${intervals}${productId ? `, product: ${productId}` : ''}`);
    this._assertIntervals(period, intervals);
    // `ALL_PRODUCTS` marks the records of every product together: as a product it would hand them to the back office.
    if (productId === ALL_PRODUCTS) {
      throw new ValidationException(`Query param 'productId' must be a product, not ${ALL_PRODUCTS}.`, []);
    }
    if (isKeusBackofficeOnly(scope) && !productId) {
      throw new AuthorizationException('The Keus back office reads the active companies of one product.');
    }

    try {
      await this._refreshCurrentMonthResellerOverviewRecords(await this._readCustomerBase());

      const stored = (await Promise.all(this._generateMonthIndexes(intervals, period).map(monthIndex =>
        this._resellerOverviewRecordModel.query('monthIndex').eq(monthIndex).using('monthIndex').exec(),
      ))).flat();
      const records = this._sumActiveCompanies(stored, period, productId);

      this._logger.log(`Active companies metrics (${period}): ${records.length} records.`);
      return records;
    } catch (error) {
      this._logger.error('Error retrieving active companies dashboard metrics', error);
      throw new DatabaseException('An error occurred while retrieving the active companies metrics.', error);
    }
  }

  /**
   * Sums the companies in force of the records of whole sellers, the direct leaf and every reseller, per product and
   * month: a company sits on one channel, so the sum counts it once. A year takes the companies of its last month.
   * @param records the raw monthly records.
   * @param period the period of the metrics (annual or monthly).
   * @param productId the product read, absent for every product.
   * @returns one record per product and period.
   */
  private _sumActiveCompanies(
    records: ResellerOverviewDashboardMetricsRecord[],
    period: MetricsPeriod,
    productId: string | undefined,
  ): ResponseActiveCompaniesPeriodRecordDto[] {
    const months = new Map<string, { productId: string; monthIndex: string; companiesInForce: number }>();
    for (const record of records) {
      if (record.salesId || (productId && record.productId !== productId)) {
        continue;
      }

      const key = `${record.productId}#${record.monthIndex}`;
      const acc = months.get(key) ?? { productId: record.productId, monthIndex: record.monthIndex, companiesInForce: 0 };
      acc.companiesInForce += record.companiesInForce;
      months.set(key, acc);
    }

    const periods = new Map<string, { productId: string; period: string; lastMonth: string; companiesInForce: number }>();
    for (const month of months.values()) {
      const label = period === MetricsPeriod.Annual ? month.monthIndex.slice(0, 4) : month.monthIndex;
      const key = `${month.productId}#${label}`;
      const acc = periods.get(key);
      if (!acc || month.monthIndex > acc.lastMonth) {
        periods.set(key, { productId: month.productId, period: label, lastMonth: month.monthIndex, companiesInForce: month.companiesInForce });
      }
    }

    return [...periods.values()].map(sum => plainToInstance(ResponseActiveCompaniesPeriodRecordDto, {
      ...(sum.productId !== ALL_PRODUCTS && { productId: sum.productId }),
      period: sum.period,
      companiesInForce: sum.companiesInForce,
    }));
  }

  /**
   * Retrieves the reseller network of the global dashboard (UR-RK-001), today's snapshot never stored: the resellers
   * with the fee in force, with the city and province of their legal address and the licenses they activated in the
   * current period. The product dashboard counts from it the resellers active on its product, the ones enabled to sell
   * it (UR-RK-235).
   *   - The fee is in force when the contract the reseller points at is, read by key: the history is never read.
   *   - The licenses are the ones of the ranking of the sales metrics, from `_countLicensesBySeller`.
   * @param period the current period of the licenses (annual or monthly).
   * @param scope the request scope.
   * @returns one entry per reseller with the fee in force.
   * @throws AuthorizationException if the caller is not a Keus collaborator.
   * @throws DatabaseException if a read fails.
   */
  async getResellerNetworkDashboardMetrics(period: MetricsPeriod, scope: RequestScope): Promise<ResponseResellerNetworkEntryDto[]> {
    assertCollaborator(scope, 'getResellerNetworkDashboardMetrics');
    this._logger.log(`Retrieving reseller network dashboard metrics, period: ${period}`);

    try {
      const resellersService = await this._loadResellersService();
      const resellerContractsService = await this._loadResellerContractsService();
      const resellers = await resellersService.getAllResellers(scope);
      const [inForce, licenses] = await Promise.all([
        resellerContractsService.getContractsInForce(resellers),
        this._countLicensesBySeller(period),
      ]);

      const entries = resellers.filter(reseller => inForce.has(reseller.id)).map(reseller => plainToInstance(ResponseResellerNetworkEntryDto, {
        id: reseller.id,
        code: reseller.code,
        companyName: reseller.companyName,
        ...(reseller.legalAddress?.city && { city: reseller.legalAddress.city }),
        ...(reseller.legalAddress?.province && { province: reseller.legalAddress.province.toUpperCase() }),
        productIds: inForce.get(reseller.id)?.productIds ?? [],
        licensesActivated: licenses.get(reseller.code) ?? 0,
      }));

      this._logger.log(`Reseller network: ${entries.length} resellers with the fee in force of ${resellers.length}.`);
      return entries;
    } catch (error) {
      this._logger.error('Error retrieving reseller network dashboard metrics', error);
      throw new DatabaseException('An error occurred while retrieving the reseller network.', error);
    }
  }

  /**
   * Counts the licenses each reseller sold itself in the current period, as the ranking of the sales metrics: the
   * contracts started on every product together, transfers excluded. The closed months come from the sales orders
   * records; the current one is counted from the customer base and not written, so that it never races with the
   * refresh of `getSalesOrdersDashboardMetrics`, which the same page calls at the same time.
   * @param period the current period (annual or monthly).
   * @returns the licenses activated, by reseller code.
   */
  private async _countLicensesBySeller(period: MetricsPeriod): Promise<Map<string, number>> {
    const range = this._generatePeriodRanges(MetricsPeriod.Monthly, 1)[0];
    const closedMonths = this._generateMonthIndexes(1, period).filter(monthIndex => monthIndex !== range.label);
    const [base, stored] = await Promise.all([
      this._readCustomerBase(),
      Promise.all(closedMonths.map(monthIndex =>
        this._salesOrdersRecordModel.query('monthIndex').eq(monthIndex).using('monthIndex').exec(),
      )).then(lists => lists.flat()),
    ]);
    // Only the licenses are read, which need neither orders, trials nor salespeople.
    const current = countSalesOrders(range, { orders: [], closedTrials: [], contracts: base.contracts, lines: base.lines, salesIds: new Map() });

    const licenses = new Map<string, number>();
    for (const leaf of [...stored, ...current]) {
      const code = this._resellerCodeOf(leaf.resellerPath);
      if (leaf.productId !== ALL_PRODUCTS || !code) {
        continue;
      }

      licenses.set(code, (licenses.get(code) ?? 0) + leaf.contractsStarted);
    }

    return licenses;
  }

  /**
   * Retrieves today's work of a reseller (UR-RK-339), computed when read and never stored, like the follow-ups of the
   * customer success metrics: the orders in progress, the contracts renewing in the next `RENEWAL_HORIZON_DAYS` days,
   * the customers at risk (contracts cancelled and not ended yet, access suspended) and the opportunities to grow.
   *   - The owner, the back office and Keus read the whole reseller and its subtree.
   *   - A reseller salesperson reads only its orders and the contracts that come from them.
   * The risk read from the product metrics is `getMixpanelTenantKpi`, apart, so that Mixpanel does not hold this back.
   * @param resellerId the reseller.
   * @param scope the request scope.
   * @returns the work of the reseller.
   * @throws AuthorizationException if the reseller is outside the requester's scope.
   * @throws EntityNotFoundException if the reseller does not exist.
   * @throws DatabaseException if a read fails.
   */
  async getResellerWorklist(resellerId: string, scope: RequestScope): Promise<ResponseResellerWorklistDto> {
    this._logger.log(`Retrieving the worklist of reseller ${resellerId}.`);
    const viewerPath = await this._resellerPathOf(resellerId, scope);
    const salesId = isSalespersonOnly(scope) ? scope.sub : undefined;
    if (!viewerPath) {
      return plainToInstance(ResponseResellerWorklistDto, { ordersSent: 0, ordersAccepted: 0, ordersConfirmed: 0, renewals: [], atRisk: [], opportunities: [] });
    }

    try {
      const today = todayInItaly();
      const horizon = new Date(new Date(today).getTime() + RENEWAL_HORIZON_DAYS * DAY_MS).toISOString();
      const ordersService = await this._loadOrdersService();
      const contractsService = await this._loadContractsService();
      const [base, orders, renewing] = await Promise.all([
        this._readCustomerBase(),
        Promise.all([OrderStatus.Sent, OrderStatus.Accepted, OrderStatus.Confirmed].map(status => ordersService.getByStatus(status)))
          .then(lists => lists.flat()),
        Promise.all(this._monthsBetween(today, horizon).map(monthIndex => contractsService.getRenewingIn(monthIndex)))
          .then(lists => lists.flat()),
      ]);

      const visible = (entity: { resellerPath?: string }): boolean => isPathVisible(viewerPath, entity.resellerPath);
      const inForce = base.contracts.filter(contract => visible(contract) && IN_FORCE_STATUSES.includes(contract.status));
      const renewals = renewing.filter(contract => visible(contract) && contract.renewalDate >= today && contract.renewalDate <= horizon);
      const salesIds = salesId
        ? await ordersService.getSalesIds([...inForce, ...renewals].map(contract => contract.orderId))
        : new Map<string, string>();
      const isOwned = (contract: ResponseContractDto): boolean => !salesId || salesIds.get(contract.orderId) === salesId;

      const ownOrders = orders.filter(order => visible(order) && (!salesId || order.assignedSalesId === salesId));
      const countOf = (status: OrderStatus): number => ownOrders.filter(order => order.status === status).length;
      const worklist = {
        ordersSent: countOf(OrderStatus.Sent),
        ordersAccepted: countOf(OrderStatus.Accepted),
        ordersConfirmed: countOf(OrderStatus.Confirmed),
        renewals: renewals
          .filter(isOwned)
          .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))
          .map(contract => plainToInstance(ResponseResellerRenewalDto, {
            productId: contract.productId,
            contractId: contract.id,
            companyId: contract.companyId,
            companyName: contract.companyName,
            renewalDate: contract.renewalDate,
          })),
        atRisk: this._customerFollowUps(inForce.filter(isOwned), []),
        opportunities: await this._resellerOpportunities(inForce, isOwned),
      };

      this._logger.log(`Worklist of reseller ${resellerId}: ${ownOrders.length} orders, ${worklist.renewals.length} renewals, ${worklist.atRisk.length} at risk, ${worklist.opportunities.length} opportunities.`);
      return plainToInstance(ResponseResellerWorklistDto, worklist);
    } catch (error) {
      this._logger.error(`Error retrieving the worklist of reseller ${resellerId}`, error);
      throw new DatabaseException('An error occurred while retrieving the worklist of the reseller.', error);
    }
  }

  /**
   * Retrieves the economic position of a reseller towards Keus (UR-RK-339), computed when read from the invoices billed
   * to the reseller itself, as its schedule: per period, the invoices Keus issued and their total, void ones left out;
   * and the invoices still to pay, with their total and the part past due or whose charge failed. A reseller
   * salesperson never reads it: it is what the reseller pays Keus, the terms of purchase it does not see.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve.
   * @param resellerId the reseller.
   * @param scope the request scope.
   * @returns the economic position of the reseller.
   * @throws ValidationException if the number of intervals is out of bounds.
   * @throws AuthorizationException if the reseller is outside the requester's scope.
   * @throws EntityNotFoundException if the reseller does not exist.
   * @throws DatabaseException if a read fails.
   */
  async getResellerBillingDashboardMetrics(
    period: MetricsPeriod,
    intervals: number,
    resellerId: string,
    scope: RequestScope,
  ): Promise<ResponseResellerBillingDto> {
    this._logger.log(`Retrieving reseller billing dashboard metrics, reseller: ${resellerId}, period: ${period}, intervals: ${intervals}`);
    this._assertIntervals(period, intervals);
    await (await this._loadResellersService()).getReseller(resellerId, scope);

    const monthIndexes = this._generateMonthIndexes(intervals, period).sort();
    const [lastYear, lastMonth] = monthIndexes[monthIndexes.length - 1].split('-').map(Number);
    const from = `${monthIndexes[0]}-01T00:00:00.000Z`;
    const to = new Date(Date.UTC(lastYear, lastMonth, 0, 23, 59, 59, 999)).toISOString();
    const invoicesService = await this._loadInvoicesService();
    const [issued, toPay] = await Promise.all([
      invoicesService.getInvoicesIssuedTo(resellerId, from, to),
      invoicesService.getInvoicesToPayOf(resellerId),
    ]);

    const byPeriod = new Map<string, { period: string; issuedCount: number; issuedCents: number }>();
    for (const invoice of issued.filter(invoice => invoice.status !== InvoiceStatus.Void)) {
      const label = period === MetricsPeriod.Annual ? invoice.issuedAt.slice(0, 4) : invoice.issuedAt.slice(0, 7);
      const acc = byPeriod.get(label) ?? { period: label, issuedCount: 0, issuedCents: 0 };
      acc.issuedCount += 1;
      acc.issuedCents += invoice.amountCents;
      byPeriod.set(label, acc);
    }

    const today = todayInItaly().slice(0, 10);
    const dues = [...toPay].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    const isOverdue = (invoice: Invoice): boolean => invoice.status === InvoiceStatus.Unpaid || (!!invoice.dueDate && invoice.dueDate.slice(0, 10) < today);

    this._logger.log(`Reseller billing metrics (${period}) of reseller ${resellerId}: ${byPeriod.size} periods, ${dues.length} invoices to pay.`);
    return plainToInstance(ResponseResellerBillingDto, {
      records: [...byPeriod.values()]
        .sort((a, b) => b.period.localeCompare(a.period))
        .map(record => plainToInstance(ResponseResellerBillingPeriodDto, record)),
      dueCents: dues.reduce((sum, invoice) => sum + invoice.amountCents, 0),
      overdueCents: dues.filter(isOverdue).reduce((sum, invoice) => sum + invoice.amountCents, 0),
      dues: dues.map(invoice => plainToInstance(ResponseInvoiceDto, invoice)),
    });
  }

  /**
   * Finds the opportunities of a reseller (`findOpportunities`), reading the seats of the tenants of its contracts in
   * force and the products each of its resellers sells.
   * @param contracts the contracts in force of the reseller and its subtree.
   * @param isOwned whether a contract is one of the requester's.
   * @returns the opportunities.
   */
  private async _resellerOpportunities(
    contracts: ResponseContractDto[],
    isOwned: (contract: ResponseContractDto) => boolean,
  ): Promise<ResponseResellerOpportunityDto[]> {
    const tenantsService = await this._loadTenantsService();
    const resellersService = await this._loadResellersService();
    const keys = contracts.filter(isOwned).map(contract => ({ productId: contract.productId, id: contract.tenantId }));
    const sellerCodes = [...new Set(contracts.map(contract => this._resellerCodeOf(contract.resellerPath)))];

    // A batch read takes at most 100 keys.
    const batches: (typeof keys)[] = [];
    for (let start = 0; start < keys.length; start += 100) {
      batches.push(keys.slice(start, start + 100));
    }
    const [tenants, resellers] = await Promise.all([
      Promise.all(batches.map(batch => tenantsService.getTenantsByKeys(batch))).then(lists => lists.flat()),
      Promise.all(sellerCodes.map(code => resellersService.getResellerByCode(code))),
    ]);

    const seats: TenantSeats = new Map(tenants.map(tenant => [
      tenantKeyOf(tenant.productId, tenant.id),
      { activeUsers: tenant.activeUsers ?? 0, seats: tenant.maxConstraintValue ?? 0 },
    ]));
    const inForce = await (await this._loadResellerContractsService()).getContractsInForce(resellers.filter(Boolean));
    const productsOf = new Map(resellers.filter(Boolean).map(reseller => [reseller.code, inForce.get(reseller.id)?.productIds ?? []]));

    return findOpportunities(contracts, isOwned, seats, productsOf)
      .map(opportunity => plainToInstance(ResponseResellerOpportunityDto, opportunity));
  }

  /**
   * Lists the months from the one of a day to the one of another, both included.
   * @param from the first day (ISO string).
   * @param to the last day (ISO string).
   * @returns the months (format: "YYYY-MM").
   */
  private _monthsBetween(from: string, to: string): string[] {
    const months: string[] = [];
    const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00.000Z`);
    while (cursor.toISOString().slice(0, 7) <= to.slice(0, 7)) {
      months.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return months;
  }

  /**
   * Recalculates the records of the current month, revenue, utilities of both logics, customer success, reseller
   * overview, sales orders, availability, support, product adoption and technical errors, once a day from EventBridge Scheduler: a month nobody opens a dashboard in still gets its
   * figures, and the last run of the month closes it. The revenue of a reseller is computed when read, so it has
   * nothing to refresh.
   * @throws DatabaseException if a read or a write fails.
   */
  async refreshCurrentMonth(): Promise<void> {
    const currentMonthIndex = new Date().toISOString().slice(0, 7);
    this._logger.log(`Refreshing the metrics of month ${currentMonthIndex}.`);

    try {
      await this._refreshCurrentMonthRevenueRecords(currentMonthIndex);
      await this._refreshCurrentMonthUtilitiesRecords(currentMonthIndex, MetricsLogic.Activated);
      await this._refreshCurrentMonthUtilitiesRecords(currentMonthIndex, MetricsLogic.Active);
      const base = await this._readCustomerBase();
      await this._refreshCurrentMonthCustomerSuccessRecords(base);
      await this._refreshCurrentMonthResellerOverviewRecords(base);
      await this._refreshCurrentMonthSalesOrdersRecords(base);
      await this._refreshCurrentMonthAvailabilityRecords();

      // Intercom, Mixpanel and Sentry go last and on their own: one that does not answer must not hold back the others.
      const external = await Promise.allSettled([
        this._refreshCurrentMonthSupportRecords(),
        this._refreshCurrentMonthAdoptionRecords(),
        this._refreshCurrentMonthTechnicalErrorsRecords(),
      ]);
      const failed = external.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) {
        throw failed.reason;
      }
    } catch (error) {
      this._logger.error(`Error refreshing the metrics of month ${currentMonthIndex}`, error);
      throw new DatabaseException('An error occurred while refreshing the metrics of the month.', error);
    }
    this._logger.log(`Metrics of month ${currentMonthIndex} refreshed.`);
  }

  /**
   * Refreshes revenue metrics records for the current month from the invoices collected in it, whenever they were
   * issued, each item counted on its product, net of taxes. The global record of a product sums every invoice; an invoice
   * billed to a reseller also feeds the leaf record of that reseller, and any other one the leaf record of the
   * salesperson who opened its order, which the dashboard of a Keus salesperson sums.
   * The fees of the resellers count under `RESELLER_FEES_KEY` (decision of Damiano, 23/10/2026), in the leaf record
   * of the reseller too: its Keus salesperson opens the reseller contracts, so they are its sales. Any other item with
   * no product is left out.
   * @param currentMonthIndex the current month index (format: "YYYY-MM").
   */
  private async _refreshCurrentMonthRevenueRecords(currentMonthIndex: string): Promise<void> {
    const invoicesService = await this._loadInvoicesService();
    const productsService = await this._loadProductsService();
    const [invoices, products] = await Promise.all([
      invoicesService.getInvoicesPaidInMonth(currentMonthIndex),
      productsService.getAllProducts(),
    ]);
    const paid = invoices.filter(invoice => invoice.status === InvoiceStatus.Paid);

    // Get existing revenue records for the current month, keyed by product + reseller path + salesperson.
    const existingRecords = await this._revenueRecordModel
      .query('monthIndex')
      .eq(currentMonthIndex)
      .using('monthIndex')
      .exec();
    const keyOf = (productId: string, leaf: RevenueLeaf): string => `${productId}#${leaf.resellerPath ?? ''}#${leaf.salesId ?? ''}`;
    const existingByKey = new Map<string, RevenueDashboardMetricsRecord>();
    for (const record of existingRecords) {
      existingByKey.set(keyOf(record.productId, record), record);
    }

    const upsertRevenue = async (productId: string, leaf: RevenueLeaf, revenue: number): Promise<void> => {
      const existing = existingByKey.get(keyOf(productId, leaf));
      if (existing) {
        await this._revenueRecordModel.update({ productId: existing.productId, id: existing.id }, { revenue });
      } else {
        await this._revenueRecordModel.create({
          productId,
          id: recordIdOf(currentMonthIndex, keyOf(productId, leaf)),
          monthIndex: currentMonthIndex,
          revenue,
          ...(leaf.resellerPath && { resellerPath: leaf.resellerPath }),
          ...(leaf.salesId && { salesId: leaf.salesId }),
        }, { overwrite: true, return: 'item' });
      }
    };

    const [resellerPaths, salesIds] = await Promise.all([this._resellerPathsOf(paid), this._salesIdsOf(paid)]);
    const globalRevenue = new Map<string, number>();
    const leafRevenue = new Map<string, { productId: string; leaf: RevenueLeaf; revenue: number }>();
    for (const invoice of paid) {
      const resellerPath = invoice.billedPartyType === BilledPartyType.Reseller ? resellerPaths.get(invoice.billedPartyId) : undefined;
      for (const item of invoice.items) {
        const productId = item.productId ?? (invoice.resellerContractId ? RESELLER_FEES_KEY : undefined);
        if (!productId) {
          continue;
        }

        globalRevenue.set(productId, (globalRevenue.get(productId) ?? 0) + item.amountCents);
        const salesId = invoice.billedPartyType === BilledPartyType.Reseller ? undefined : salesIds.get(item.orderId ?? invoice.orderId ?? '');
        const leaf: RevenueLeaf | null = resellerPath ? { resellerPath } : salesId ? { salesId } : null;
        if (leaf) {
          const key = keyOf(productId, leaf);
          const acc = leafRevenue.get(key) ?? { productId, leaf, revenue: 0 };
          acc.revenue += item.amountCents;
          leafRevenue.set(key, acc);
        }
      }
    }

    for (const productId of [...products.map(product => product.id), RESELLER_FEES_KEY]) {
      await upsertRevenue(productId, {}, globalRevenue.get(productId) ?? 0);
    }
    for (const entry of leafRevenue.values()) {
      await upsertRevenue(entry.productId, entry.leaf, entry.revenue);
    }
    this._logger.log(`Refreshed revenue records for month ${currentMonthIndex}: ${products.length} global + ${leafRevenue.size} reseller or salesperson.`);
  }

  /**
   * Resolves who sold the orders of the invoices not billed to a reseller: the salesperson who opened each order.
   * @param invoices the invoices.
   * @returns the salesperson of each order, by identifier.
   */
  private async _salesIdsOf(invoices: Invoice[]): Promise<Map<string, string>> {
    const orderIds = invoices
      .filter(invoice => invoice.billedPartyType !== BilledPartyType.Reseller)
      .flatMap(invoice => invoice.items.map(item => item.orderId ?? invoice.orderId))
      .filter((orderId): orderId is string => !!orderId);
    if (orderIds.length === 0) {
      return new Map();
    }

    const ordersService = await this._loadOrdersService();
    return ordersService.getSalesIds(orderIds);
  }

  /**
   * Resolves the reseller paths of the resellers billed by some invoices.
   * @param invoices the invoices.
   * @returns the path of each billed reseller, by identifier.
   */
  private async _resellerPathsOf(invoices: { billedPartyId: string; billedPartyType: BilledPartyType }[]): Promise<Map<string, string>> {
    const resellerIds = new Set(invoices
      .filter(invoice => invoice.billedPartyType === BilledPartyType.Reseller)
      .map(invoice => invoice.billedPartyId));
    const resellersService = await this._loadResellersService();
    const paths = new Map<string, string>();
    for (const resellerId of resellerIds) {
      const reseller = await resellersService.getReseller(resellerId, SYSTEM_SCOPE);
      const path = await resellersService.getResellerPath(reseller.code);
      if (path) {
        paths.set(resellerId, path);
      }
    }

    return paths;
  }

  /**
   * Refreshes utilities metrics records for the current month.
   * - ACTIVATED: counts entities by monthIndex (activated this month).
   * - ACTIVE: counts entities by status = ACTIVE (currently active snapshot).
   * Creates or updates UtilitiesDashboardMetricsRecord for each product.
   * @param currentMonthIndex the current month index (format: "YYYY-MM").
   * @param logic the logic type to refresh.
   */
  private async _refreshCurrentMonthUtilitiesRecords(
    currentMonthIndex: string,
    logic: MetricsLogic,
  ): Promise<void> {
    const productsService = await this._loadProductsService();
    const tenantsService = await this._loadTenantsService();
    const trialsService = await this._loadTrialsService();
    const contractsService = await this._loadContractsService();
    const usersService = await this._loadUsersService();

    // Get all products
    const products = await productsService.getAllProducts();

    // Get existing utilities records for the current month + logic, keyed by product + reseller path.
    const existingRecords = await this._utilitiesRecordModel
      .query('monthIndex')
      .eq(currentMonthIndex)
      .using('monthIndex')
      .exec();
    const existingForLogic = existingRecords.filter(r => r.logic === logic);
    const existingByKey = new Map<string, UtilitiesDashboardMetricsRecord>();
    for (const record of existingForLogic) {
      existingByKey.set(`${record.productId}#${record.resellerPath ?? ''}`, record);
    }

    const upsertUtilities = async (
      productId: string,
      resellerPath: string | undefined,
      counts: { users: number; trials: number; contracts: number; tenants: number },
    ): Promise<void> => {
      const existing = existingByKey.get(`${productId}#${resellerPath ?? ''}`);
      if (existing) {
        await this._utilitiesRecordModel.update({ productId: existing.productId, id: existing.id }, counts);
      } else {
        await this._utilitiesRecordModel.create({
          productId,
          id: recordIdOf(currentMonthIndex, `${productId}#${resellerPath ?? ''}#${logic}`),
          monthIndex: currentMonthIndex,
          ...counts,
          logic,
          ...(resellerPath && { resellerPath }),
        }, { overwrite: true, return: 'item' });
      }
    };

    // Count entities based on logic (resellerPath is denormalized on each entity).
    let allTenants: { productId: string; resellerPath?: string }[];
    let allTrials: { productId: string; resellerPath?: string }[];
    let allContracts: { productId: string; resellerPath?: string }[];
    let allUsers: { productId: string; resellerPath?: string }[];

    // The indexes are local to the product: each entity is read product by product.
    const perProduct = <T>(read: (productId: string) => Promise<T[]>): Promise<T[]> =>
      Promise.all(products.map(product => read(product.id))).then(lists => lists.flat());

    if (logic === MetricsLogic.Activated) {
      // Activated: entities created this month (query by monthIndex)
      // Requested, failed and cancelled records were never created on the product.
      [allTenants, allTrials, allContracts, allUsers] = await Promise.all([
        perProduct(productId => tenantsService.getByMonthIndex(productId, currentMonthIndex)).then(tenants => tenants.filter(tenant => !NOT_ON_PRODUCT.includes(tenant.status))),
        perProduct(productId => trialsService.getByMonthIndex(productId, currentMonthIndex)),
        perProduct(productId => contractsService.getByMonthIndex(productId, currentMonthIndex)),
        perProduct(productId => usersService.getByMonthIndex(productId, currentMonthIndex)).then(users => users.filter(user => !NOT_ON_PRODUCT.includes(user.status))),
      ]);
    } else {
      // Active: entities currently active (query by status)
      [allTenants, allTrials, allContracts, allUsers] = await Promise.all([
        perProduct(productId => tenantsService.getByStatus(productId, TenantStatus.Active)),
        perProduct(productId => trialsService.getByStatus(productId, TrialStatus.Active)),
        perProduct(productId => contractsService.getInForceByProduct(productId)),
        perProduct(productId => usersService.getByStatus(productId, UserStatus.Active)),
      ]);
    }

    // Global Keus record per product: counts of ALL entities (unchanged).
    for (const product of products) {
      await upsertUtilities(product.id, undefined, {
        users: allUsers.filter(u => u.productId === product.id).length,
        trials: allTrials.filter(t => t.productId === product.id).length,
        contracts: allContracts.filter(c => c.productId === product.id).length,
        tenants: allTenants.filter(t => t.productId === product.id).length,
      });
    }

    // Per-reseller leaf records: count entities (which carry resellerPath)
    // grouped by (product, resellerPath). A reseller dashboard sums the subtree.
    const resellerCounts = new Map<string, { productId: string; resellerPath: string; users: number; trials: number; contracts: number; tenants: number }>();
    const bump = (productId: string, resellerPath: string | undefined, field: 'users' | 'trials' | 'contracts' | 'tenants'): void => {
      if (!resellerPath) {
        return;
      }
      const key = `${productId}#${resellerPath}`;
      let acc = resellerCounts.get(key);
      if (!acc) {
        acc = { productId, resellerPath, users: 0, trials: 0, contracts: 0, tenants: 0 };
        resellerCounts.set(key, acc);
      }
      acc[field] += 1;
    };
    for (const tenant of allTenants) { bump(tenant.productId, tenant.resellerPath, 'tenants'); }
    for (const trial of allTrials) { bump(trial.productId, trial.resellerPath, 'trials'); }
    for (const contract of allContracts) { bump(contract.productId, contract.resellerPath, 'contracts'); }
    for (const user of allUsers) { bump(user.productId, user.resellerPath, 'users'); }
    for (const entry of resellerCounts.values()) {
      // Only the counts: productId is part of the key, and an update that sets it is refused by DynamoDB.
      const { users, trials, contracts, tenants } = entry;
      await upsertUtilities(entry.productId, entry.resellerPath, { users, trials, contracts, tenants });
    }
    this._logger.log(`Refreshed utilities records (${logic}) for month ${currentMonthIndex}: ${products.length} global + ${resellerCounts.size} reseller.`);
  }

  /**
   * Validates how far back a dashboard reads: a whole number of months up to `MAX_MONTHLY_INTERVALS`, or of years up
   * to `MAX_ANNUAL_INTERVALS`, so that a request cannot read the history of centuries.
   * @param period the period type.
   * @param intervals the number of intervals asked.
   * @throws ValidationException if the number is not a whole number within the bound.
   */
  private _assertIntervals(period: MetricsPeriod, intervals: number): void {
    const max = period === MetricsPeriod.Monthly ? MAX_MONTHLY_INTERVALS : MAX_ANNUAL_INTERVALS;
    if (!Number.isInteger(intervals) || intervals < 1 || intervals > max) {
      throw new ValidationException(`Query param 'intervals' must be a whole number from 1 to ${max} for the ${period} period.`, []);
    }
  }

  /**
   * Generates an array of monthIndex strings (format "YYYY-MM") for the given period configuration.
   * For MONTHLY: returns the last N months.
   * For ANNUAL: returns all months within the last N years.
   * @param intervals the number of intervals.
   * @param period the period type.
   * @returns array of monthIndex strings.
   */
  private _generateMonthIndexes(intervals: number, period: MetricsPeriod): string[] {
    const now = new Date();
    const months: string[] = [];

    if (period === MetricsPeriod.Monthly) {
      for (let i = 0; i < intervals; i++) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(date.toISOString().slice(0, 7));
      }
    } else {
      const currentYear = now.getFullYear();
      for (let yearOffset = 0; yearOffset < intervals; yearOffset++) {
        const year = currentYear - yearOffset;
        const maxMonth = year === currentYear ? now.getMonth() : 11;
        for (let month = 0; month <= maxMonth; month++) {
          months.push(`${year}-${String(month + 1).padStart(2, '0')}`);
        }
      }
    }

    return months;
  }

  /**
   * Extracts unique years from a month index array, sorted descending.
   * @param monthIndexes array of monthIndex strings.
   * @returns array of year strings.
   */
  private _getYearsFromMonthIndexes(monthIndexes: string[]): string[] {
    const years = new Set(monthIndexes.map(m => m.slice(0, 4)));
    return Array.from(years).sort().reverse();
  }

  /**
   * Retrieves sales dashboard metrics from the deals of the products pipeline.
   * For every period it returns one record over the whole pipeline, without `solution`, and one
   * per requested solution of interest, all computed from the same deals: a deal with several
   * solutions counts in each of them, but once in the pipeline record.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve.
   * @param solutions the solutions of interest to break the metrics down by.
   * @returns Array of sales metrics, one per period for the pipeline and for each solution; none without HubSpot.
   */
  async getSalesDashboardMetrics(
    period: MetricsPeriod,
    intervals: number,
    solutions: string[],
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<ResponseSalesDashboardMetricsDto[]> {
    // Sales metrics come from HubSpot pipelines, which have no reseller dimension:
    // reserved to Keus collaborators.
    assertCollaborator(scope, 'getSalesDashboardMetrics');
    this._logger.log(`Retrieving sales dashboard metrics, period: ${period}, intervals: ${intervals}, solutions: ${solutions.length}`);
    this._assertIntervals(period, intervals);

    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      return [];
    }

    try {
      const hubspotService = await this._loadHubspotService();
      const pipelineId = productsPipelineId();
      const periodRanges = this._generatePeriodRanges(period, intervals);
      const earliestStart = periodRanges[periodRanges.length - 1].start;
      const latestEnd = periodRanges[0].end;

      const properties = ['dealname', 'amount', 'createdate', 'closedate', 'dealstage', 'pipeline', 'hs_is_closed_won', HUBSPOT_SOLUTION_PROPERTY];
      const trialStageIds = await this._getTrialStageIds(hubspotService, pipelineId);
      const pipelineFilter = { propertyName: 'pipeline', operator: 'EQ', value: pipelineId };

      const createdFilters: HubspotSearchFilterGroup[] = [{
        filters: [
          { propertyName: 'createdate', operator: 'GTE', value: String(earliestStart.getTime()) },
          { propertyName: 'createdate', operator: 'LTE', value: String(latestEnd.getTime()) },
          pipelineFilter,
        ],
      }];

      // Won deals bounded to the period window: closedWonRevenue is now per-period (not cumulative).
      const wonFilters: HubspotSearchFilterGroup[] = [{
        filters: [
          { propertyName: 'hs_is_closed_won', operator: 'EQ', value: 'true' },
          { propertyName: 'closedate', operator: 'GTE', value: String(earliestStart.getTime()) },
          { propertyName: 'closedate', operator: 'LTE', value: String(latestEnd.getTime()) },
          pipelineFilter,
        ],
      }];

      const lostFilters: HubspotSearchFilterGroup[] = [{
        filters: [
          { propertyName: 'hs_is_closed', operator: 'EQ', value: 'true' },
          { propertyName: 'hs_is_closed_won', operator: 'EQ', value: 'false' },
          { propertyName: 'closedate', operator: 'GTE', value: String(earliestStart.getTime()) },
          { propertyName: 'closedate', operator: 'LTE', value: String(latestEnd.getTime()) },
          pipelineFilter,
        ],
      }];

      const trialFilters: HubspotSearchFilterGroup[] = trialStageIds.length
        ? [{
          filters: [
            { propertyName: 'dealstage', operator: 'IN', values: trialStageIds },
            pipelineFilter,
          ],
        }]
        : [];

      // Fetch all data in parallel (only 4 API calls total, regardless of solution count)
      const [createdDeals, wonDeals, lostDeals, trialDeals] = await Promise.all([
        hubspotService.searchDeals(createdFilters, properties),
        hubspotService.searchDeals(wonFilters, properties),
        hubspotService.searchDeals(lostFilters, properties),
        trialFilters.length ? hubspotService.searchDeals(trialFilters, properties) : Promise.resolve([] as HubspotDeal[]),
      ]);

      const pipelineDeals: SalesDeals = { createdDeals, wonDeals, lostDeals, trialDeals };
      const solutionDeals: SalesDeals[] = solutions.map(solution => {
        const hasSolution = (deal: HubspotDeal) => dealSolutions(deal.properties).includes(solution);
        return {
          solution,
          createdDeals: createdDeals.filter(hasSolution),
          wonDeals: wonDeals.filter(hasSolution),
          lostDeals: lostDeals.filter(hasSolution),
          trialDeals: trialDeals.filter(hasSolution),
        };
      });

      const results = [pipelineDeals, ...solutionDeals].flatMap(deals => this._computeSalesMetrics(deals, periodRanges, period));

      this._logger.log(`Sales metrics: ${results.length} records computed (pipeline and ${solutions.length} solutions × ${periodRanges.length} periods).`);
      return results;
    } catch (error) {
      this._logger.error('Error retrieving sales dashboard metrics', error);
      throw new DatabaseException('An error occurred while retrieving sales dashboard metrics.', error);
    }
  }

  /**
   * Computes the sales metrics of a set of deals, one record per period.
   * @param deals the deals of the pipeline or of one solution of interest.
   * @param periodRanges the period ranges, most recent first.
   * @param period the period type.
   * @returns the sales metrics of each period, carrying the solution when there is one.
   */
  private _computeSalesMetrics(
    deals: SalesDeals,
    periodRanges: PeriodRange[],
    period: MetricsPeriod,
  ): ResponseSalesDashboardMetricsDto[] {
    const activeTrialsValue = deals.trialDeals.reduce((sum, d) => sum + (parseFloat(d.properties.amount ?? '0') * 100), 0);

    return periodRanges.map(range => {
      const periodCreated = deals.createdDeals.filter(d => {
        if (!d.properties.createdate) return false;
        const date = new Date(d.properties.createdate);
        return date >= range.start && date <= range.end;
      });

      const periodWon = deals.wonDeals.filter(d => {
        if (!d.properties.closedate) return false;
        const date = new Date(d.properties.closedate);
        return date >= range.start && date <= range.end;
      });

      const periodLost = deals.lostDeals.filter(d => {
        if (!d.properties.closedate) return false;
        const date = new Date(d.properties.closedate);
        return date >= range.start && date <= range.end;
      });

      const totalClosed = periodWon.length + periodLost.length;
      const winRate = totalClosed > 0
        ? Math.round((periodWon.length / totalClosed) * 1000) / 10
        : null;

      const averageDealAgeDays = this._computeAverageDealAge(periodWon);
      const dealsWonByQuarter = this._computeDealsWonByQuarter(periodWon, range, period);

      // Sum of amounts (in cents) of deals closed-won within this period. Frontend derives MRR/ARR from this.
      const closedWonRevenue = periodWon.reduce((sum, d) => sum + (parseFloat(d.properties.amount ?? '0') * 100), 0);

      return plainToInstance(ResponseSalesDashboardMetricsDto, {
        ...(deals.solution && { solution: deals.solution }),
        period: range.label,
        dealsCreated: periodCreated.length,
        dealsWon: periodWon.length,
        winRate,
        averageDealAgeDays,
        activeTrialsValue,
        closedWonRevenue,
        dealsWonByQuarter,
      });
    });
  }

  /**
   * Computes the average deal age in days for a set of won deals.
   * Deal age = closedate - createdate.
   * @param wonDeals the won deals to compute the average for.
   * @returns The average age in days, or null if no deals.
   */
  private _computeAverageDealAge(wonDeals: HubspotDeal[]): number | null {
    const ages: number[] = [];

    for (const deal of wonDeals) {
      const createDate = deal.properties.createdate ? new Date(deal.properties.createdate) : null;
      const closeDate = deal.properties.closedate ? new Date(deal.properties.closedate) : null;

      if (createDate && closeDate) {
        const diffMs = closeDate.getTime() - createDate.getTime();
        ages.push(diffMs / (1000 * 60 * 60 * 24));
      }
    }

    if (ages.length === 0) return null;
    return Math.round((ages.reduce((sum, a) => sum + a, 0) / ages.length) * 10) / 10;
  }

  /**
   * Computes deals won broken down by quarter.
   * For monthly period, returns only the relevant quarter.
   * For annual period, returns Q1-Q4 breakdown.
   * @param wonDeals the won deals in the period.
   * @param range the period range.
   * @param period the period type.
   * @returns Object with quarter keys and count values.
   */
  private _computeDealsWonByQuarter(
    wonDeals: HubspotDeal[],
    range: PeriodRange,
    period: MetricsPeriod,
  ): Record<string, number> {
    const result: Record<string, number> = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };

    for (const deal of wonDeals) {
      const closeDate = deal.properties.closedate ? new Date(deal.properties.closedate) : null;
      if (!closeDate) continue;

      const month = closeDate.getMonth(); // 0-based
      if (month <= 2) result.Q1++;
      else if (month <= 5) result.Q2++;
      else if (month <= 8) result.Q3++;
      else result.Q4++;
    }

    // For monthly period, only return the quarter that the month belongs to
    if (period === MetricsPeriod.Monthly) {
      const startMonth = range.start.getMonth();
      let quarterKey: string;
      if (startMonth <= 2) quarterKey = 'Q1';
      else if (startMonth <= 5) quarterKey = 'Q2';
      else if (startMonth <= 8) quarterKey = 'Q3';
      else quarterKey = 'Q4';

      return { [quarterKey]: result[quarterKey] };
    }

    return result;
  }

  /**
   * Retrieves the "trial" stage IDs of the products pipeline by matching the stage label.
   * @param hubspotService the HubSpot service instance.
   * @param pipelineId the identifier of the products pipeline.
   * @returns Array of stage IDs whose label contains "trial" (case-insensitive).
   */
  private async _getTrialStageIds(hubspotService: HubspotService, pipelineId: string): Promise<string[]> {
    const pipelines = await hubspotService.getDealPipelines();
    const trialStageIds: string[] = [];
    for (const pipeline of pipelines.filter(p => p.id === pipelineId)) {
      for (const stage of pipeline.stages) {
        if (stage.label.toLowerCase().includes('trial')) {
          trialStageIds.push(stage.id);
        }
      }
    }

    return trialStageIds;
  }

  /**
   * Retrieves the Rocket half of the sales metrics (UR-RK-222), apart from the HubSpot one so that HubSpot does not
   * hold it back. As the other dashboards, the current month is counted again and written, the others are read as they
   * were at their end, and a year sums its months. Two figures are today's snapshots, counted when read and never
   * stored: the trials active, and the orders of each period still open (the backlog).
   *   - Admin and accounting read the whole of Keus, with the ranking of the resellers.
   *   - A Keus salesperson reads what it sold, as `_salesOwnership` bounds it: the direct orders it opened and what its
   *     resellers sold. A trial has no salesperson, so it reads only the trials of its resellers.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve.
   * @param scope the scope of the caller.
   * @returns the counts per product, period and seller, and the trials active today.
   * @throws AuthorizationException if the caller is not a Keus collaborator.
   * @throws ValidationException if the number of intervals is out of bounds.
   * @throws DatabaseException if a read fails.
   */
  async getSalesOrdersDashboardMetrics(
    period: MetricsPeriod,
    intervals: number,
    scope: RequestScope,
  ): Promise<ResponseSalesOrdersDashboardMetricsDto> {
    assertCollaborator(scope, 'getSalesOrdersDashboardMetrics');
    this._logger.log(`Retrieving sales orders dashboard metrics, period: ${period}, intervals: ${intervals}`);
    this._assertIntervals(period, intervals);
    const ownership = await this._salesOwnership(scope);

    try {
      await this._refreshCurrentMonthSalesOrdersRecords(await this._readCustomerBase());

      const monthIndexes = this._generateMonthIndexes(intervals, period);
      const since = `${[...monthIndexes].sort()[0]}-01`;
      const ordersService = await this._loadOrdersService();
      const resellersService = await this._loadResellersService();
      const [stored, openOrders, activeTrials, resellers] = await Promise.all([
        Promise.all(monthIndexes.map(monthIndex =>
          this._salesOrdersRecordModel.query('monthIndex').eq(monthIndex).using('monthIndex').exec(),
        )).then(lists => lists.flat()),
        ordersService.getOpenRequestedSince(since),
        this._countActiveTrials(ownership),
        resellersService.getAllResellers(scope),
      ]);
      const names = new Map(resellers.map(reseller => [reseller.code, reseller.companyName]));
      const records = this._scopeSalesOrdersRecords(stored, openOrders, period, ownership, names);

      this._logger.log(`Sales orders metrics (${period}): ${records.length} records and ${activeTrials.length} active trial counts.`);
      return plainToInstance(ResponseSalesOrdersDashboardMetricsDto, { records, activeTrials });
    } catch (error) {
      this._logger.error('Error retrieving sales orders dashboard metrics', error);
      throw new DatabaseException('An error occurred while retrieving the sales orders metrics.', error);
    }
  }

  /**
   * Counts the Rocket half of the sales metrics in the current month and writes it into its records, one per product,
   * seller and salesperson: a known record is updated, a new one is created, and one left with nothing in the month
   * goes back to zero. Contracts and lines come from the customer base; the orders and the closed trials of the month
   * are read on their own month indexes, one query each.
   * @param base the products with their contracts and delivered lines.
   */
  private async _refreshCurrentMonthSalesOrdersRecords(base: CustomerBase): Promise<void> {
    const range = this._generatePeriodRanges(MetricsPeriod.Monthly, 1)[0];
    const inMonth = (date: string | undefined): boolean => !!date && new Date(date) >= range.start && new Date(date) <= range.end;
    const ordersService = await this._loadOrdersService();
    const trialsService = await this._loadTrialsService();
    const [orders, closedTrials] = await Promise.all([ordersService.getRequestedIn(range.label), trialsService.getClosedIn(range.label)]);

    // Only the direct contracts and lines of the month need the salesperson of their order.
    const orderIds = [
      ...base.contracts.filter(contract => !contract.resellerPath && inMonth(contract.startDate)).map(contract => contract.orderId),
      ...base.lines.filter(line => !line.resellerPath && inMonth(line.provisionedAt)).map(line => line.orderId),
    ];
    const salesIds = orderIds.length > 0 ? await ordersService.getSalesIds(orderIds) : new Map<string, string>();
    const counts = countSalesOrders(range, { orders, closedTrials, contracts: base.contracts, lines: base.lines, salesIds });

    const existing = await this._salesOrdersRecordModel.query('monthIndex').eq(range.label).using('monthIndex').exec();
    const existingByKey = new Map(existing.map(record => [salesOrdersKeyOf(record.productId, record.resellerPath, record.salesId), record]));

    const writes: Promise<unknown>[] = [];
    for (const count of counts) {
      const key = salesOrdersKeyOf(count.productId, count.resellerPath, count.salesId);
      const known = existingByKey.get(key);
      existingByKey.delete(key);
      const values = {
        ordersRequested: count.ordersRequested,
        trialsClosed: count.trialsClosed,
        trialsConverted: count.trialsConverted,
        contractsStarted: count.contractsStarted,
        provisionedTimed: count.provisionedTimed,
        provisioningDaysTotal: count.provisioningDaysTotal,
      };
      writes.push(known
        ? this._salesOrdersRecordModel.update({ productId: known.productId, id: known.id }, values)
        : this._salesOrdersRecordModel.create({
          productId: count.productId,
          id: recordIdOf(range.label, key),
          monthIndex: range.label,
          ...(count.resellerPath && { resellerPath: count.resellerPath }),
          ...(count.salesId && { salesId: count.salesId }),
          ...values,
        }, { overwrite: true, return: 'item' }));
    }
    for (const stale of existingByKey.values()) {
      writes.push(this._salesOrdersRecordModel.update(
        { productId: stale.productId, id: stale.id },
        { ordersRequested: 0, trialsClosed: 0, trialsConverted: 0, contractsStarted: 0, provisionedTimed: 0, provisioningDaysTotal: 0 },
      ));
    }
    await Promise.all(writes);

    this._logger.log(`Refreshed sales orders records for month ${range.label}: ${counts.length} written, ${existingByKey.size} reset.`);
  }

  /**
   * Reduces the sales orders records to what the request may see, summed per product, period and seller, and adds to
   * each the orders of that period still open today. The direct leaves of the Keus salespeople fold into one direct
   * record. A year sums its months, and its open orders are the ones requested in it.
   * @param records the raw monthly records.
   * @param openOrders the orders open today, requested since the first month read.
   * @param period the period of the metrics (annual or monthly).
   * @param ownership what the Keus salesperson sold, null for the whole of Keus.
   * @param names the name of each reseller, by code.
   * @returns one record per product, period and seller.
   */
  private _scopeSalesOrdersRecords(
    records: SalesOrdersDashboardMetricsRecord[],
    openOrders: ResponseOrderDto[],
    period: MetricsPeriod,
    ownership: SalesOwnership | null,
    names: Map<string, string>,
  ): ResponseSalesOrdersPeriodRecordDto[] {
    const labelOf = (monthIndex: string): string => period === MetricsPeriod.Annual ? monthIndex.slice(0, 4) : monthIndex;
    const sums = new Map<string, Omit<ResponseSalesOrdersPeriodRecordDto, 'resellerName'>>();
    const sumOf = (productId: string, label: string, resellerCode: string | undefined): Omit<ResponseSalesOrdersPeriodRecordDto, 'resellerName'> => {
      const key = `${productId}#${label}#${resellerCode ?? ''}`;
      let sum = sums.get(key);
      if (!sum) {
        sum = {
          productId,
          period: label,
          ...(resellerCode && { resellerCode }),
          ordersRequested: 0,
          ordersOpen: 0,
          trialsClosed: 0,
          trialsConverted: 0,
          contractsStarted: 0,
          provisionedTimed: 0,
          provisioningDaysTotal: 0,
        };
        sums.set(key, sum);
      }
      return sum;
    };

    for (const record of records) {
      if (!this._isSoldBy(record.resellerPath, record.salesId, ownership)) {
        continue;
      }

      const sum = sumOf(record.productId, labelOf(record.monthIndex), this._resellerCodeOf(record.resellerPath));
      sum.ordersRequested += record.ordersRequested;
      sum.trialsClosed += record.trialsClosed;
      sum.trialsConverted += record.trialsConverted;
      sum.contractsStarted += record.contractsStarted;
      sum.provisionedTimed += record.provisionedTimed;
      sum.provisioningDaysTotal += record.provisioningDaysTotal;
    }

    for (const order of openOrders) {
      const salesId = !order.resellerPath ? order.assignedSalesId : undefined;
      if (order.transferredFromResellerCode || !this._isSoldBy(order.resellerPath, salesId, ownership)) {
        continue;
      }

      for (const productId of [...new Set(order.productIds), ALL_PRODUCTS]) {
        sumOf(productId, labelOf(order.requestMonth), this._resellerCodeOf(order.resellerPath)).ordersOpen += 1;
      }
    }

    return [...sums.values()].map(sum => plainToInstance(ResponseSalesOrdersPeriodRecordDto, {
      ...sum,
      productId: sum.productId !== ALL_PRODUCTS ? sum.productId : undefined,
      provisioningDaysTotal: Math.round(sum.provisioningDaysTotal * 100) / 100,
      ...(sum.resellerCode && names.has(sum.resellerCode) && { resellerName: names.get(sum.resellerCode) }),
    }));
  }

  /**
   * Counts the trials active today per product and seller, one query per product on its status index. A Keus
   * salesperson counts only the trials of its resellers, since a trial has no salesperson.
   * @param ownership what the Keus salesperson sold, null for the whole of Keus.
   * @returns the active trials per product and seller.
   */
  private async _countActiveTrials(ownership: SalesOwnership | null): Promise<ResponseSalesActiveTrialsDto[]> {
    const trialsService = await this._loadTrialsService();
    const products = await (await this._loadProductsService()).getAllProducts();
    const trials = (await Promise.all(products.map(product => trialsService.getByStatus(product.id, TrialStatus.Active)))).flat();

    const counts = new Map<string, ResponseSalesActiveTrialsDto>();
    for (const trial of trials) {
      if (!this._isSoldBy(trial.resellerPath, undefined, ownership)) {
        continue;
      }

      const resellerCode = this._resellerCodeOf(trial.resellerPath);
      const key = `${trial.productId}#${resellerCode ?? ''}`;
      const count = counts.get(key) ?? { productId: trial.productId, ...(resellerCode && { resellerCode }), trials: 0 };
      count.trials += 1;
      counts.set(key, count);
    }
    return [...counts.values()].map(count => plainToInstance(ResponseSalesActiveTrialsDto, count));
  }

  /**
   * Tells whether something sold belongs to what the request may see: everything for the whole of Keus; for a Keus
   * salesperson, what its resellers sold or the direct orders it opened.
   * @param resellerPath the lineage of the seller, absent on the direct channel.
   * @param salesId the Keus salesperson of the direct order, if any.
   * @param ownership what the Keus salesperson sold, null for the whole of Keus.
   * @returns whether the request may see it.
   */
  private _isSoldBy(resellerPath: string | undefined, salesId: string | undefined, ownership: SalesOwnership | null): boolean {
    if (!ownership) {
      return true;
    }

    const sellerCode = this._resellerCodeOf(resellerPath);
    return sellerCode ? ownership.resellerCodes.has(sellerCode) : salesId === ownership.salesId;
  }

  /**
   * Retrieves the customer success metrics (UR-RK-221), from monthly records as the revenue and the utilities: the
   * current month is counted again from the contracts and the order lines of every product, the others are read as
   * they were at their end. A year takes the contracts in force from its first month and sums the rest.
   *   - churn: contracts terminated in the period over the ones in force on its first day, by number. A loss is a
   *     tenant left with no contract: one ended by a transfer of channel, or followed by a newer contract on the same
   *     tenant (a financed one renewed with a new order), stays in the denominator and out of the numerator;
   *   - activation: lines whose credentials were delivered and whose first access happened in the period, and the days
   *     between the two (the stretch from the confirmation of the order is the delivery time of the sales metrics);
   *   - follow-ups, counted from today's data and never stored: companies that never logged in on a contract still in
   *     force, contracts cancelled by the customer and not ended yet, access suspended for an unpaid invoice.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve.
   * @param scope the scope of the caller.
   * @returns the counts per product, period and seller, and the customers to follow up.
   * @throws ValidationException if the number of intervals is out of bounds.
   * @throws DatabaseException if a read fails.
   */
  async getCustomerSuccessDashboardMetrics(
    period: MetricsPeriod,
    intervals: number,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<ResponseCustomerSuccessDashboardMetricsDto> {
    // The whole customer base of Keus, with no reseller dimension: reserved to Keus collaborators.
    assertCollaborator(scope, 'getCustomerSuccessDashboardMetrics');
    this._logger.log(`Retrieving customer success dashboard metrics, period: ${period}, intervals: ${intervals}`);
    this._assertIntervals(period, intervals);

    try {
      const base = await this._readCustomerBase();
      await this._refreshCurrentMonthCustomerSuccessRecords(base);

      const stored = (await Promise.all(this._generateMonthIndexes(intervals, period).map(monthIndex =>
        this._customerSuccessRecordModel.query('monthIndex').eq(monthIndex).using('monthIndex').exec(),
      ))).flat();
      const records = period === MetricsPeriod.Annual
        ? this._foldCustomerSuccessYears(stored)
        : stored.map(record => this._toCustomerSuccessPeriodRecord(record, record.monthIndex, record.inForceAtStart, [record]));
      const followUps = this._customerFollowUps(base.contracts, base.lines);

      this._logger.log(`Customer success metrics (${period}): ${records.length} records and ${followUps.length} follow-ups.`);
      return plainToInstance(ResponseCustomerSuccessDashboardMetricsDto, { records, followUps });
    } catch (error) {
      this._logger.error('Error retrieving customer success dashboard metrics', error);
      throw new DatabaseException('An error occurred while retrieving the customer success metrics.', error);
    }
  }

  /**
   * Retrieves the support metrics of the products (UR-RK-221) from the Intercom conversations: a conversation belongs
   * to the product whose `intercomBrand` is its brand. As the other dashboards, the current month is counted again
   * from Intercom and written, the others are read as they were at their end, and a year sums its months. Conversations
   * of other brands (Keus, collaborators and resellers) stay out, and so do the products with no brand, which get no
   * record at all: they are not counted as zero (UR-RK-220).
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve.
   * @param scope the scope of the caller.
   * @returns the counts per product and period, for every product with a brand.
   * @throws ValidationException if the number of intervals is out of bounds.
   * @throws AppException if Intercom is not configured or does not answer.
   * @throws DatabaseException if a read fails.
   */
  async getSupportDashboardMetrics(
    period: MetricsPeriod,
    intervals: number,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<ResponseSupportPeriodRecordDto[]> {
    // The support of every customer of Keus, with no reseller dimension: reserved to Keus collaborators.
    assertCollaborator(scope, 'getSupportDashboardMetrics');
    this._logger.log(`Retrieving support dashboard metrics, period: ${period}, intervals: ${intervals}`);
    this._assertIntervals(period, intervals);

    try {
      await this._refreshCurrentMonthSupportRecords();

      const stored = (await Promise.all(this._generateMonthIndexes(intervals, period).map(monthIndex =>
        this._supportRecordModel.query('monthIndex').eq(monthIndex).using('monthIndex').exec(),
      ))).flat();
      const records = period === MetricsPeriod.Annual
        ? this._foldSupportYears(stored)
        : stored.map(record => this._toSupportPeriodRecord(record.productId, record.monthIndex, [record]));

      this._logger.log(`Support metrics (${period}): ${records.length} records.`);
      return records;
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this._logger.error('Error retrieving support dashboard metrics', error);
      throw new DatabaseException('An error occurred while retrieving the support metrics.', error);
    }
  }

  /**
   * Counts the conversations of the current month and writes them into its records, one per product with a brand: a
   * known record is updated, a new product gets one, and a product that lost its brand goes back to zero. Only the
   * conversations updated in the month are read: the ones opened or closed in it are among them.
   * @throws AppException if Intercom is not configured or does not answer.
   */
  private async _refreshCurrentMonthSupportRecords(): Promise<void> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    // Without Intercom the records of the month stay as they were written.
    if (!integrationsEnabled()) {
      return;
    }

    const range = this._generatePeriodRanges(MetricsPeriod.Monthly, 1)[0];
    const products = await (await this._loadProductsService()).getAllProducts();
    const branded = products.filter(product => product.intercomBrand);
    const productByBrand = new Map(branded.map(product => [product.intercomBrand, product.id]));
    if (productByBrand.size < branded.length) {
      // Nothing stops two products from naming the same brand: the conversations go to the last one.
      this._logger.warn(`Some products share an Intercom brand: ${branded.map(product => `${product.name}=${product.intercomBrand}`).join(', ')}.`);
    }

    const existing = await this._supportRecordModel.query('monthIndex').eq(range.label).using('monthIndex').exec();
    const existingByProduct = new Map(existing.map(record => [record.productId, record]));
    const counts = productByBrand.size === 0
      ? []
      : this._countSupport([range], productByBrand, await (await this._loadIntercomService()).getConversationsUpdatedSince(range.start));

    const writes: Promise<unknown>[] = [];
    for (const count of counts) {
      const known = existingByProduct.get(count.productId);
      existingByProduct.delete(count.productId);
      const values = {
        opened: count.opened,
        closed: count.closed,
        firstResponseSecondsTotal: count.firstResponseSecondsTotal,
        firstResponseCount: count.firstResponseCount,
        resolutionSecondsTotal: count.resolutionSecondsTotal,
      };
      writes.push(known
        ? this._supportRecordModel.update({ productId: known.productId, id: known.id }, values)
        : this._supportRecordModel.create({ productId: count.productId, id: recordIdOf(range.label, count.productId), monthIndex: range.label, ...values }, { overwrite: true, return: 'item' }));
    }
    for (const stale of existingByProduct.values()) {
      writes.push(this._supportRecordModel.update(
        { productId: stale.productId, id: stale.id },
        { opened: 0, closed: 0, firstResponseSecondsTotal: 0, firstResponseCount: 0, resolutionSecondsTotal: 0 },
      ));
    }
    await Promise.all(writes);

    this._logger.log(`Refreshed support records for month ${range.label}: ${counts.length} written, ${existingByProduct.size} reset.`);
  }

  /**
   * Folds the monthly support records into years, one per product and year, summing the counts and the times.
   * @param records the monthly records of the years.
   * @returns the yearly records.
   */
  private _foldSupportYears(records: SupportDashboardMetricsRecord[]): ResponseSupportPeriodRecordDto[] {
    const byYear = new Map<string, SupportDashboardMetricsRecord[]>();
    for (const record of records) {
      const key = `${record.productId}#${record.monthIndex.slice(0, 4)}`;
      byYear.set(key, [...(byYear.get(key) ?? []), record]);
    }

    return [...byYear.values()].map(months => this._toSupportPeriodRecord(months[0].productId, months[0].monthIndex.slice(0, 4), months));
  }

  /**
   * Builds the support record of a period from the stored months it covers.
   * @param productId the identifier of the product.
   * @param period the label of the period (format: "YYYY-MM" or "YYYY").
   * @param months the stored months of the period, whose counts are summed.
   * @returns the record of the period.
   */
  private _toSupportPeriodRecord(productId: string, period: string, months: SupportDashboardMetricsRecord[]): ResponseSupportPeriodRecordDto {
    const sum = (pick: (month: SupportDashboardMetricsRecord) => number): number =>
      months.reduce((total, month) => total + pick(month), 0);

    return plainToInstance(ResponseSupportPeriodRecordDto, {
      productId,
      period,
      opened: sum(month => month.opened),
      closed: sum(month => month.closed),
      firstResponseSecondsTotal: sum(month => month.firstResponseSecondsTotal),
      firstResponseCount: sum(month => month.firstResponseCount),
      resolutionSecondsTotal: sum(month => month.resolutionSecondsTotal),
    });
  }

  /**
   * Lists the brands of the Intercom workspace, for the choice of the brand of a product.
   * @param scope the scope of the caller.
   * @returns the brands; none without Intercom.
   * @throws AppException if Intercom is not configured or does not answer.
   */
  async getIntercomBrands(scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseIntercomBrandDto[]> {
    assertCollaborator(scope, 'getIntercomBrands');

    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      return [];
    }

    const brands = await (await this._loadIntercomService()).listBrands();
    return brands.map(brand => plainToInstance(ResponseIntercomBrandDto, brand));
  }

  /**
   * Retrieves the errors and the alerts of the products (UR-RK-225) from their Sentry projects, in the environment of
   * this Rocket: rockettino counts the products in dev, Rocket the ones in prod. As the other dashboards, the current
   * month is counted again from Sentry and written, the others are read as they were at their end, and a year sums
   * its months. The alerts still open are a picture of today, counted at every read and never written. Products with
   * no project get no record at all: they are not counted as zero (UR-RK-220).
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve.
   * @param scope the scope of the caller.
   * @returns the counts per product and period, and the alerts open today per product.
   * @throws ValidationException if the number of intervals is out of bounds.
   * @throws AppException if Sentry is not configured or does not answer.
   * @throws DatabaseException if a read fails.
   */
  async getTechnicalErrorsDashboardMetrics(
    period: MetricsPeriod,
    intervals: number,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<ResponseTechnicalErrorsDashboardMetricsDto> {
    // The health of every product of Keus, with no reseller dimension: reserved to Keus collaborators.
    assertCollaborator(scope, 'getTechnicalErrorsDashboardMetrics');
    this._logger.log(`Retrieving technical errors dashboard metrics, period: ${period}, intervals: ${intervals}`);
    this._assertIntervals(period, intervals);

    try {
      const projectToProduct = await this._sentryProjectsOfProducts();
      const [, openAlerts] = await Promise.all([
        this._refreshCurrentMonthTechnicalErrorsRecords(projectToProduct),
        this._countOpenAlerts(projectToProduct),
      ]);

      const stored = (await Promise.all(this._generateMonthIndexes(intervals, period).map(monthIndex =>
        this._technicalErrorsRecordModel.query('monthIndex').eq(monthIndex).using('monthIndex').exec(),
      ))).flat();
      const records = period === MetricsPeriod.Annual
        ? this._foldTechnicalErrorsYears(stored)
        : stored.map(record => this._toTechnicalErrorsPeriodRecord(record.productId, record.monthIndex, [record]));

      this._logger.log(`Technical errors metrics (${period}): ${records.length} records and ${openAlerts.length} products with open alerts.`);
      return plainToInstance(ResponseTechnicalErrorsDashboardMetricsDto, { records, openAlerts });
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this._logger.error('Error retrieving technical errors dashboard metrics', error);
      throw new DatabaseException('An error occurred while retrieving the technical errors metrics.', error);
    }
  }

  /**
   * Retrieves the issues with most error events of the current month from the Sentry projects of the products (UR-RK-225),
   * for one product or for all of them. Always read live, through the cache of the Sentry service: the titles of the
   * issues are never written to Rocket, and the months already closed keep only their counts. The window ends at the
   * current step of `SENTRY_CLOCK_MS`, like the counts.
   * @param productId the product to read, or every product with a Sentry project when not given.
   * @param scope the scope of the caller.
   * @returns the issues and the link to their projects on Sentry; no issue without Sentry.
   * @throws AppException if Sentry is not configured or does not answer.
   * @throws DatabaseException if the read of the products fails.
   */
  async getTechnicalErrorsIssues(productId?: string, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseTechnicalErrorsIssuesDto> {
    // The health of every product of Keus, with no reseller dimension: reserved to Keus collaborators.
    assertCollaborator(scope, 'getTechnicalErrorsIssues');

    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      return plainToInstance(ResponseTechnicalErrorsIssuesDto, { issues: [] });
    }

    this._logger.log(`Retrieving the technical errors issues, product: ${productId ?? 'all'}`);

    try {
      const projectToProduct = new Map([...await this._sentryProjectsOfProducts()].filter(([, id]) => !productId || id === productId));
      if (projectToProduct.size === 0) {
        return plainToInstance(ResponseTechnicalErrorsIssuesDto, { issues: [] });
      }

      const projectIds = [...projectToProduct.keys()];
      const start = this._generatePeriodRanges(MetricsPeriod.Monthly, 1)[0].start;
      const end = new Date(Math.floor(Date.now() / SENTRY_CLOCK_MS) * SENTRY_CLOCK_MS);
      const sentryService = await this._loadSentryService();
      const issues = await sentryService.listIssues(projectIds, start, end);

      return plainToInstance(ResponseTechnicalErrorsIssuesDto, {
        issues: issues.map(({ projectId, ...issue }) => ({ productId: projectToProduct.get(projectId), ...issue })),
        sentryUrl: sentryService.issuesPageUrl(projectIds),
      });
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this._logger.error('Error retrieving the technical errors issues', error);
      throw new DatabaseException('An error occurred while retrieving the technical errors issues.', error);
    }
  }

  /**
   * Maps the Sentry project of every product that has one to the product.
   * @returns the identifier of the product per identifier of its Sentry project.
   * @throws DatabaseException if the read of the products fails.
   */
  private async _sentryProjectsOfProducts(): Promise<Map<string, string>> {
    const products = (await (await this._loadProductsService()).getAllProducts()).filter(product => product.sentryProjectId);
    const projectToProduct = new Map(products.map(product => [product.sentryProjectId, product.id]));
    if (projectToProduct.size < products.length) {
      // Nothing stops two products from naming the same project: its errors go to the last one.
      this._logger.warn(`Some products share a Sentry project: ${products.map(product => `${product.name}=${product.sentryProjectId}`).join(', ')}.`);
    }

    return projectToProduct;
  }

  /**
   * Counts the errors and the alerts fired of the current month and writes them into its records, one per product with
   * a project: a known record is updated, a new product gets one, and a product that lost its project goes back to
   * zero. The window ends at the current step of `SENTRY_CLOCK_MS`, so reads close in time share the requests.
   * @param projectToProduct the product of each Sentry project, read when not given.
   * @throws AppException if Sentry is not configured or does not answer.
   */
  private async _refreshCurrentMonthTechnicalErrorsRecords(projectToProduct?: Map<string, string>): Promise<void> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    // Without Sentry the records of the month stay as they were written.
    if (!integrationsEnabled()) {
      return;
    }

    const range = this._generatePeriodRanges(MetricsPeriod.Monthly, 1)[0];
    const projects = projectToProduct ?? await this._sentryProjectsOfProducts();
    const projectIds = [...projects.keys()];
    const end = new Date(Math.floor(Date.now() / SENTRY_CLOCK_MS) * SENTRY_CLOCK_MS);

    const existing = await this._technicalErrorsRecordModel.query('monthIndex').eq(range.label).using('monthIndex').exec();
    const existingByProduct = new Map(existing.map(record => [record.productId, record]));
    let errors = new Map<string, number>();
    let alertsFired = new Map<string, number>();
    if (projectIds.length > 0) {
      const sentryService = await this._loadSentryService();
      [errors, alertsFired] = await Promise.all([
        sentryService.countErrors(projectIds, range.start, end),
        sentryService.countIssuesFirstSeen(projectIds, range.start, end),
      ]);
    }

    const writes: Promise<unknown>[] = [];
    for (const [projectId, productId] of projects) {
      const known = existingByProduct.get(productId);
      existingByProduct.delete(productId);
      const values = { errors: errors.get(projectId) ?? 0, alertsFired: alertsFired.get(projectId) ?? 0 };
      writes.push(known
        ? this._technicalErrorsRecordModel.update({ productId: known.productId, id: known.id }, values)
        : this._technicalErrorsRecordModel.create({ productId, id: recordIdOf(range.label, productId), monthIndex: range.label, ...values }, { overwrite: true, return: 'item' }));
    }
    for (const stale of existingByProduct.values()) {
      writes.push(this._technicalErrorsRecordModel.update({ productId: stale.productId, id: stale.id }, { errors: 0, alertsFired: 0 }));
    }
    await Promise.all(writes);

    this._logger.log(`Refreshed technical errors records for month ${range.label}: ${projects.size} written, ${existingByProduct.size} reset.`);
  }

  /**
   * Counts the alerts open today of every product with a project, among the issues seen in the last
   * `OPEN_ALERTS_LOOKBACK_DAYS`. A picture of today: it is never written.
   * @param projectToProduct the product of each Sentry project.
   * @returns the open alerts per product.
   * @throws AppException if Sentry is not configured or does not answer.
   */
  private async _countOpenAlerts(projectToProduct: Map<string, string>): Promise<ResponseOpenAlertsDto[]> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      return [];
    }

    if (projectToProduct.size === 0) {
      return [];
    }

    const end = new Date(Math.floor(Date.now() / SENTRY_CLOCK_MS) * SENTRY_CLOCK_MS);
    const start = new Date(end.getTime() - OPEN_ALERTS_LOOKBACK_DAYS * DAY_MS);
    const counts = await (await this._loadSentryService()).countUnresolvedIssues([...projectToProduct.keys()], start, end);

    return [...projectToProduct].map(([projectId, productId]) =>
      plainToInstance(ResponseOpenAlertsDto, { productId, openAlerts: counts.get(projectId) ?? 0 }),
    );
  }

  /**
   * Folds the monthly technical errors records into years, one per product and year, summing the counts.
   * @param records the monthly records of the years.
   * @returns the yearly records.
   */
  private _foldTechnicalErrorsYears(records: TechnicalErrorsDashboardMetricsRecord[]): ResponseTechnicalErrorsPeriodRecordDto[] {
    const byYear = new Map<string, TechnicalErrorsDashboardMetricsRecord[]>();
    for (const record of records) {
      const key = `${record.productId}#${record.monthIndex.slice(0, 4)}`;
      byYear.set(key, [...(byYear.get(key) ?? []), record]);
    }

    return [...byYear.values()].map(months => this._toTechnicalErrorsPeriodRecord(months[0].productId, months[0].monthIndex.slice(0, 4), months));
  }

  /**
   * Builds the technical errors record of a period from the stored months it covers.
   * @param productId the identifier of the product.
   * @param period the label of the period (format: "YYYY-MM" or "YYYY").
   * @param months the stored months of the period, whose counts are summed.
   * @returns the record of the period.
   */
  private _toTechnicalErrorsPeriodRecord(productId: string, period: string, months: TechnicalErrorsDashboardMetricsRecord[]): ResponseTechnicalErrorsPeriodRecordDto {
    return plainToInstance(ResponseTechnicalErrorsPeriodRecordDto, {
      productId,
      period,
      errors: months.reduce((total, month) => total + month.errors, 0),
      alertsFired: months.reduce((total, month) => total + month.alertsFired, 0),
    });
  }

  /**
   * Lists the projects of the Sentry organization, for the choice of the project of a product.
   * @param scope the scope of the caller.
   * @returns the projects; none without Sentry.
   * @throws AppException if Sentry is not configured or does not answer.
   */
  async getSentryProjects(scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseSentryProjectDto[]> {
    assertCollaborator(scope, 'getSentryProjects');

    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      return [];
    }

    const projects = await (await this._loadSentryService()).listProjects();
    return projects.map(project => plainToInstance(ResponseSentryProjectDto, project));
  }

  /**
   * Checks every product with a `healthCheckUrl`, every 15 minutes from EventBridge Scheduler (UR-RK-225). A product
   * answers when its address returns a 2xx within `HEALTH_CHECK_TIMEOUT_MS`; a failed check is tried once more after
   * `HEALTH_CHECK_RETRY_MS` before it counts. The first failed check opens the outage of the product, the first
   * answered one closes it into `product_outages`: an outage shorter than the 15 minutes may not appear. Without the
   * products there is nothing to check.
   * @throws DatabaseException if the state of a product cannot be read or written; the other products are checked anyway.
   */
  async checkProductsHealth(): Promise<void> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      return;
    }

    const products = (await (await this._loadProductsService()).getAllProducts()).filter(product => product.healthCheckUrl);
    this._logger.log(`Checking the health of ${products.length} products.`);

    const results = await Promise.allSettled(products.map(product => this._checkProductHealth(product.id, product.healthCheckUrl)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) {
      this._logger.error('Error recording the health of the products', failed.reason);
      throw new DatabaseException('An error occurred while recording the health of the products.', failed.reason);
    }

    this._logger.log(`Health of ${products.length} products checked.`);
  }

  /**
   * Checks a product and updates its state: the first check creates it, a failure opens the outage if none is open,
   * and an answer closes the open one. The closed outage takes an identifier derived from the product and its start,
   * so a write repeated after a failure does not record it twice.
   * @param productId the identifier of the product.
   * @param url the health address of the product.
   */
  private async _checkProductHealth(productId: string, url: string): Promise<void> {
    let failure = await this._probe(url);
    if (failure) {
      await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_RETRY_MS));
      failure = await this._probe(url);
    }

    const now = new Date().toISOString();
    const state = await this._healthCheckModel.get({ productId });
    if (!state) {
      await this._healthCheckModel.create({ productId, since: now, lastCheckAt: now, ...(failure && { downSince: now, lastFailure: failure }) });
      this._logger.log(`First health check of product ${productId}: ${failure ?? 'up'}.`);
      return;
    }

    if (failure) {
      await this._healthCheckModel.update({ productId }, { lastCheckAt: now, lastFailure: failure, ...(!state.downSince && { downSince: now }) });
      this._logger.warn(`Product ${productId} did not answer its health check (${failure}), down since ${state.downSince ?? now}.`);
      return;
    }

    if (state.downSince) {
      await this._outageModel.create({
        productId,
        id: uuidv5(`${productId}#${state.downSince}`, RECORD_ID_NAMESPACE),
        startedAt: state.downSince,
        endedAt: now,
        ...(state.lastFailure && { lastFailure: state.lastFailure }),
      }, { overwrite: true, return: 'item' });
      await this._healthCheckModel.update({ productId }, toDynamooseUpdate<ProductHealthCheck>({ lastCheckAt: now }, ['downSince', 'lastFailure']));
      this._logger.log(`Product ${productId} answers again: outage from ${state.downSince} to ${now} closed.`);
      return;
    }

    await this._healthCheckModel.update({ productId }, { lastCheckAt: now });
  }

  /**
   * Calls the health address of a product once. A redirect is not followed and counts as a failure, so the check never
   * reaches an address other than the one set on the product.
   * @param url the health address.
   * @returns why the check failed, or undefined when the product answered with a 2xx.
   */
  private async _probe(url: string): Promise<string | undefined> {
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
      await response.body?.cancel();
      return response.ok ? undefined : `HTTP ${response.status}`;
    } catch {
      return 'no answer';
    }
  }

  /**
   * Retrieves the availability of the products (UR-RK-225) from the checks of Rocket: seconds observed, seconds down
   * and outages per product and period. As the other dashboards, the current month is counted again and written, the
   * others are read as they were at their end, and a year sums its months. Products never checked get no record at
   * all: they are not counted as zero (UR-RK-220).
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve.
   * @param scope the scope of the caller.
   * @returns the availability per product and period.
   * @throws ValidationException if the number of intervals is out of bounds.
   * @throws DatabaseException if a read or a write fails.
   */
  async getAvailabilityDashboardMetrics(
    period: MetricsPeriod,
    intervals: number,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<ResponseAvailabilityPeriodRecordDto[]> {
    // The health of every product of Keus, with no reseller dimension: reserved to Keus collaborators.
    assertCollaborator(scope, 'getAvailabilityDashboardMetrics');
    this._logger.log(`Retrieving availability dashboard metrics, period: ${period}, intervals: ${intervals}`);
    this._assertIntervals(period, intervals);

    try {
      await this._refreshCurrentMonthAvailabilityRecords();

      const stored = (await Promise.all(this._generateMonthIndexes(intervals, period).map(monthIndex =>
        this._availabilityRecordModel.query('monthIndex').eq(monthIndex).using('monthIndex').exec(),
      ))).flat();
      const records = period === MetricsPeriod.Annual
        ? this._foldAvailabilityYears(stored)
        : stored.map(record => this._toAvailabilityPeriodRecord(record.productId, record.monthIndex, [record]));

      this._logger.log(`Availability metrics (${period}): ${records.length} records.`);
      return records;
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this._logger.error('Error retrieving availability dashboard metrics', error);
      throw new DatabaseException('An error occurred while retrieving the availability metrics.', error);
    }
  }

  /**
   * Counts the availability of the current month from the checks and the outages, and writes it into its records,
   * one per product checked in the month. The observation of a product runs from its first check, or the start of the
   * month, to its last check: a product whose address was removed stops being observed there. The open outage counts
   * up to the last check too. Calls and latency are read from CloudWatch for the health addresses on `execute-api`; if
   * CloudWatch cannot be read, the availability is written anyway and the latency stays as it was.
   */
  private async _refreshCurrentMonthAvailabilityRecords(): Promise<void> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    // Without the products and their checks the records of the month stay as they were written.
    if (!integrationsEnabled()) {
      return;
    }

    const range = this._generatePeriodRanges(MetricsPeriod.Monthly, 1)[0];
    const urlByProduct = new Map((await (await this._loadProductsService()).getAllProducts()).map(product => [product.id, product.healthCheckUrl]));
    // One item per product ever checked: the table is as small as the products, so a scan is the simplest read.
    const states = (await this._healthCheckModel.scan().exec()).filter(state => urlByProduct.has(state.productId));

    const existing = await this._availabilityRecordModel.query('monthIndex').eq(range.label).using('monthIndex').exec();
    const existingByProduct = new Map(existing.map(record => [record.productId, record]));
    const apiByProduct = new Map(states.map(state => [state.productId, this._apiGatewayOf(urlByProduct.get(state.productId))]));
    const latencies = await this._readLatencies([...apiByProduct.values()].filter(Boolean), range.start, new Date(Math.min(Date.now(), range.end.getTime())));

    const writes = await Promise.all(states.map(async state => {
      const from = Math.max(range.start.getTime(), Date.parse(state.since));
      const to = Math.min(range.end.getTime(), Date.parse(state.lastCheckAt));
      if (to <= from) {
        return null;
      }

      const outages: { startedAt: string; endedAt: string }[] = await this._outageModel.query('productId').eq(state.productId).exec();
      if (state.downSince) {
        outages.push({ startedAt: state.downSince, endedAt: state.lastCheckAt });
      }
      const overlapping = outages
        .map(outage => [Math.max(from, Date.parse(outage.startedAt)), Math.min(to, Date.parse(outage.endedAt))])
        .filter(([start, end]) => end > start);

      const api = apiByProduct.get(state.productId);
      const latency = api && latencies?.get(`${api.region}#${api.apiId}`);
      const values = {
        observedSeconds: Math.round((to - from) / 1000),
        downtimeSeconds: Math.round(overlapping.reduce((total, [start, end]) => total + end - start, 0) / 1000),
        outages: overlapping.length,
        ...(latency && { requests: latency.requests }),
        ...(latency?.p50Ms !== undefined && { latencyP50Ms: Math.round(latency.p50Ms) }),
        ...(latency?.p95Ms !== undefined && { latencyP95Ms: Math.round(latency.p95Ms) }),
      };
      const known = existingByProduct.get(state.productId);
      return known
        ? this._availabilityRecordModel.update({ productId: known.productId, id: known.id }, values)
        : this._availabilityRecordModel.create({ productId: state.productId, id: recordIdOf(range.label, state.productId), monthIndex: range.label, ...values }, { overwrite: true, return: 'item' });
    }));

    this._logger.log(`Refreshed availability records for month ${range.label}: ${writes.filter(Boolean).length} written.`);
  }

  /**
   * Reads the calls and the latency of the APIs of the products from CloudWatch, without failing the availability.
   * @param apis the APIs of the products.
   * @param start the start of the window.
   * @param end the end of the window.
   * @returns the calls and the latency per API, or undefined if CloudWatch cannot be read.
   */
  private async _readLatencies(apis: ApiGatewayRef[], start: Date, end: Date): Promise<Map<string, ApiLatency> | undefined> {
    if (apis.length === 0) {
      return new Map();
    }

    try {
      return await (await this._loadCloudwatchService()).getApiLatency(apis, start, end);
    } catch (error) {
      this._logger.warn('The latency of the products could not be read: the availability is written without it.', error);
      return undefined;
    }
  }

  /**
   * Reads identifier and region of the HTTP API from a health address on the default `execute-api` host.
   * @param url the health address of the product.
   * @returns the API, or undefined for a custom domain or a missing address.
   */
  private _apiGatewayOf(url?: string): ApiGatewayRef | undefined {
    const match = url ? EXECUTE_API_HOST.exec(new URL(url).hostname) : null;
    return match ? { apiId: match[1], region: match[2] } : undefined;
  }

  /**
   * Folds the monthly availability records into years, one per product and year, summing the seconds and the outages.
   * An outage across two months counts in both.
   * @param records the monthly records of the years.
   * @returns the yearly records.
   */
  private _foldAvailabilityYears(records: AvailabilityDashboardMetricsRecord[]): ResponseAvailabilityPeriodRecordDto[] {
    const byYear = new Map<string, AvailabilityDashboardMetricsRecord[]>();
    for (const record of records) {
      const key = `${record.productId}#${record.monthIndex.slice(0, 4)}`;
      byYear.set(key, [...(byYear.get(key) ?? []), record]);
    }

    return [...byYear.values()].map(months => this._toAvailabilityPeriodRecord(months[0].productId, months[0].monthIndex.slice(0, 4), months));
  }

  /**
   * Builds the availability record of a period from the stored months it covers.
   * @param productId the identifier of the product.
   * @param period the label of the period (format: "YYYY-MM" or "YYYY").
   * @param months the stored months of the period, whose seconds, outages and calls are summed.
   * @returns the record of the period.
   */
  private _toAvailabilityPeriodRecord(productId: string, period: string, months: AvailabilityDashboardMetricsRecord[]): ResponseAvailabilityPeriodRecordDto {
    const sum = (pick: (month: AvailabilityDashboardMetricsRecord) => number): number =>
      months.reduce((total, month) => total + pick(month), 0);

    // A year has no percentile of its own: each month weighs as many calls as it had.
    const measured = months.filter(month => month.requests !== undefined);
    const weighted = (pick: (month: AvailabilityDashboardMetricsRecord) => number | undefined): number | undefined => {
      const withValue = measured.filter(month => pick(month) !== undefined && month.requests > 0);
      const calls = withValue.reduce((total, month) => total + month.requests, 0);
      return calls > 0 ? Math.round(withValue.reduce((total, month) => total + pick(month) * month.requests, 0) / calls) : undefined;
    };

    return plainToInstance(ResponseAvailabilityPeriodRecordDto, {
      productId,
      period,
      observedSeconds: sum(month => month.observedSeconds),
      downtimeSeconds: sum(month => month.downtimeSeconds),
      outages: sum(month => month.outages),
      ...(measured.length > 0 && { requests: measured.reduce((total, month) => total + month.requests, 0) }),
      latencyP50Ms: weighted(month => month.latencyP50Ms),
      latencyP95Ms: weighted(month => month.latencyP95Ms),
    });
  }

  /**
   * Counts the conversations of every period, one record per product. A conversation counts as opened in
   * the period of its opening, and as closed with its resolution time in the period of its first close.
   * @param ranges the periods, most recent first.
   * @param productByBrand the product of each Intercom brand.
   * @param conversations the conversations updated since the start of the oldest period.
   * @returns the records of every period.
   */
  private _countSupport(
    ranges: PeriodRange[],
    productByBrand: Map<string, string>,
    conversations: IntercomConversation[],
  ): ResponseSupportPeriodRecordDto[] {
    const records = new Map<string, ResponseSupportPeriodRecordDto>();
    const recordOf = (range: PeriodRange, productId: string): ResponseSupportPeriodRecordDto => {
      const key = `${range.label}#${productId}`;
      let record = records.get(key);
      if (!record) {
        record = {
          productId,
          period: range.label,
          opened: 0,
          closed: 0,
          firstResponseSecondsTotal: 0,
          firstResponseCount: 0,
          resolutionSecondsTotal: 0,
        };
        records.set(key, record);
      }
      return record;
    };
    const rangeOf = (seconds: number | null | undefined): PeriodRange | undefined => {
      if (seconds === null || seconds === undefined) {
        return undefined;
      }
      const date = new Date(seconds * 1000);
      return ranges.find(range => date >= range.start && date <= range.end);
    };

    for (const range of ranges) {
      for (const productId of productByBrand.values()) {
        recordOf(range, productId);
      }
    }

    for (const conversation of conversations) {
      const brand = conversation.custom_attributes?.[INTERCOM_BRAND_ATTRIBUTE];
      const productId = typeof brand === 'string' ? productByBrand.get(brand) : undefined;
      // Outbound messages are no request for support; a ticket opened by a teammate for the customer is one.
      const isRequest = conversation.source?.delivered_as === CUSTOMER_INITIATED || !!conversation.ticket;
      if (!productId || !isRequest) {
        continue;
      }
      const statistics = conversation.statistics;

      const openedIn = rangeOf(conversation.created_at);
      if (openedIn) {
        const record = recordOf(openedIn, productId);
        record.opened += 1;
        if (statistics?.time_to_admin_reply !== null && statistics?.time_to_admin_reply !== undefined) {
          record.firstResponseSecondsTotal += statistics.time_to_admin_reply;
          record.firstResponseCount += 1;
        }
      }

      const closedIn = rangeOf(statistics?.first_close_at);
      if (closedIn) {
        const record = recordOf(closedIn, productId);
        record.closed += 1;
        record.resolutionSecondsTotal += statistics?.time_to_first_close ?? 0;
      }
    }

    return [...records.values()].map(record => plainToInstance(ResponseSupportPeriodRecordDto, record));
  }

  /**
   * Reads every product with its contracts and its delivered order lines, or reuses the read of the last
   * `CUSTOMER_BASE_CACHE_MS`: a change of period, or two dashboards opened together, count on the same data. A failed
   * read is not kept.
   * @returns the customer base.
   * @throws DatabaseException if a read fails.
   */
  private async _readCustomerBase(): Promise<CustomerBase> {
    if (this._customerBase && Date.now() - this._customerBase.readAt < CUSTOMER_BASE_CACHE_MS) {
      return this._customerBase.read;
    }

    const read = (async (): Promise<CustomerBase> => {
      const startedAt = Date.now();
      const contractsService = await this._loadContractsService();
      const ordersService = await this._loadOrdersService();
      const products = await (await this._loadProductsService()).getAllProducts();

      // The status indexes are local to the product: each product is read on its own.
      const perProduct = <T>(readOne: (productId: string) => Promise<T[]>): Promise<T[]> =>
        Promise.all(products.map(product => readOne(product.id))).then(lists => lists.flat());
      const [contracts, lines] = await Promise.all([
        perProduct(productId => Promise.all(
          [ContractStatus.Active, ContractStatus.Terminating, ContractStatus.Terminated].map(status => contractsService.getByStatus(productId, status)),
        ).then(lists => lists.flat())),
        perProduct(productId => Promise.all(
          [OrderLineStatus.Provisioned, OrderLineStatus.Activated].map(status => ordersService.getLinesByStatus(productId, status)),
        ).then(lists => lists.flat())),
      ]);

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > SLOW_READ_MS) {
        this._logger.warn(`Customer base read in ${elapsedMs} ms (${contracts.length} contracts, ${lines.length} lines): it scans the whole history, so the current month is better left to the evening schedule.`);
      }
      return { productIds: products.map(product => product.id), contracts, lines };
    })();

    this._customerBase = { read, readAt: Date.now() };
    read.catch(() => {
      if (this._customerBase?.read === read) {
        this._customerBase = null;
      }
    });
    return read;
  }

  /**
   * Counts the customer success metrics of the current month from the customer base and writes them into its records,
   * one per product and seller: a known record is updated, a new seller gets one, and a seller left with nothing in
   * the month (its contracts moved by a transfer) goes back to zero. Every product has its direct record.
   * @param base the products with their contracts and delivered lines.
   */
  private async _refreshCurrentMonthCustomerSuccessRecords(base: CustomerBase): Promise<void> {
    const range = this._generatePeriodRanges(MetricsPeriod.Monthly, 1)[0];
    const counts = this._countCustomerSuccess(range, base.productIds, base.contracts, this._supersededContractIds(base.contracts), base.lines);

    const existing = await this._customerSuccessRecordModel.query('monthIndex').eq(range.label).using('monthIndex').exec();
    const existingByKey = new Map(existing.map(record => [`${record.productId}#${record.resellerPath ?? ''}`, record]));

    const writes: Promise<unknown>[] = [];
    for (const count of counts) {
      const key = `${count.productId}#${count.resellerPath ?? ''}`;
      const known = existingByKey.get(key);
      existingByKey.delete(key);
      const values = {
        inForceAtStart: count.inForceAtStart,
        terminated: count.terminated,
        provisioned: count.provisioned,
        activated: count.activated,
        activationDaysTotal: count.activationDaysTotal,
      };
      writes.push(known
        ? this._customerSuccessRecordModel.update({ productId: known.productId, id: known.id }, values)
        : this._customerSuccessRecordModel.create({
          productId: count.productId,
          id: recordIdOf(range.label, key),
          monthIndex: range.label,
          ...(count.resellerPath && { resellerPath: count.resellerPath }),
          ...values,
        }, { overwrite: true, return: 'item' }));
    }
    for (const stale of existingByKey.values()) {
      writes.push(this._customerSuccessRecordModel.update(
        { productId: stale.productId, id: stale.id },
        { inForceAtStart: 0, terminated: 0, provisioned: 0, activated: 0, activationDaysTotal: 0 },
      ));
    }
    await Promise.all(writes);

    this._logger.log(`Refreshed customer success records for month ${range.label}: ${counts.length} written, ${existingByKey.size} reset.`);
  }

  /**
   * Folds the monthly records into years, one per product, seller and year. The contracts in force come from the
   * first month of the year that has records, the same for every seller: a seller with no record in that month had
   * nothing in force on its first day, so it starts from zero. The other counts are summed.
   * @param records the monthly records of the years.
   * @returns the yearly records.
   */
  private _foldCustomerSuccessYears(records: CustomerSuccessDashboardMetricsRecord[]): ResponseCustomerSuccessPeriodRecordDto[] {
    const firstMonthOfYear = new Map<string, string>();
    const byYear = new Map<string, CustomerSuccessDashboardMetricsRecord[]>();
    for (const record of records) {
      const year = record.monthIndex.slice(0, 4);
      const known = firstMonthOfYear.get(year);
      if (!known || record.monthIndex < known) {
        firstMonthOfYear.set(year, record.monthIndex);
      }
      const key = `${record.productId}#${record.resellerPath ?? ''}#${year}`;
      byYear.set(key, [...(byYear.get(key) ?? []), record]);
    }

    return [...byYear.values()].map(months => {
      const year = months[0].monthIndex.slice(0, 4);
      const opening = months.find(month => month.monthIndex === firstMonthOfYear.get(year));
      return this._toCustomerSuccessPeriodRecord(months[0], year, opening?.inForceAtStart ?? 0, months);
    });
  }

  /**
   * Builds the record of a period from the stored months it covers.
   * @param source the record that names product and seller.
   * @param period the label of the period (format: "YYYY-MM" or "YYYY").
   * @param inForceAtStart the contracts in force on the first day of the period.
   * @param months the stored months of the period, whose counts are summed.
   * @returns the record of the period.
   */
  private _toCustomerSuccessPeriodRecord(
    source: CustomerSuccessDashboardMetricsRecord,
    period: string,
    inForceAtStart: number,
    months: CustomerSuccessDashboardMetricsRecord[],
  ): ResponseCustomerSuccessPeriodRecordDto {
    const resellerCode = this._resellerCodeOf(source.resellerPath);
    const sum = (pick: (month: CustomerSuccessDashboardMetricsRecord) => number): number =>
      months.reduce((total, month) => total + pick(month), 0);

    return plainToInstance(ResponseCustomerSuccessPeriodRecordDto, {
      productId: source.productId,
      period,
      ...(resellerCode && { resellerCode }),
      inForceAtStart,
      terminated: sum(month => month.terminated),
      provisioned: sum(month => month.provisioned),
      activated: sum(month => month.activated),
      activationDaysTotal: Math.round(sum(month => month.activationDaysTotal) * 100) / 100,
    });
  }

  /**
   * Counts the customer success metrics of a period, one count per product and seller lineage. Every product has its
   * direct count even when empty.
   * @param range the period.
   * @param productIds the identifiers of every product.
   * @param contracts the contracts of every product, terminated ones included.
   * @param supersededIds the contracts followed by a newer one on the same tenant, which end with no loss.
   * @param lines the provisioned and activated order lines of every product.
   * @returns the counts of the period.
   */
  private _countCustomerSuccess(
    range: PeriodRange,
    productIds: string[],
    contracts: ResponseContractDto[],
    supersededIds: Set<string>,
    lines: ResponseOrderLineDto[],
  ): CustomerSuccessCounts[] {
    const counts = new Map<string, CustomerSuccessCounts>();
    const countOf = (productId: string, resellerPath: string | undefined): CustomerSuccessCounts => {
      const key = `${productId}#${resellerPath ?? ''}`;
      let count = counts.get(key);
      if (!count) {
        count = { productId, ...(resellerPath && { resellerPath }), inForceAtStart: 0, terminated: 0, provisioned: 0, activated: 0, activationDaysTotal: 0 };
        counts.set(key, count);
      }
      return count;
    };
    const inRange = (date: Date): boolean => date >= range.start && date <= range.end;

    for (const productId of productIds) {
      countOf(productId, undefined);
    }

    for (const contract of contracts) {
      const endedAt = contract.status === ContractStatus.Terminated && contract.terminationDate
        ? new Date(contract.terminationDate)
        : undefined;
      if (new Date(contract.startDate) < range.start && (!endedAt || endedAt >= range.start)) {
        countOf(contract.productId, contract.resellerPath).inForceAtStart += 1;
      }
      const lost = contract.terminationReason !== ContractTerminationReason.Transfer && !supersededIds.has(contract.id);
      if (endedAt && inRange(endedAt) && lost) {
        countOf(contract.productId, contract.resellerPath).terminated += 1;
      }
    }

    for (const line of lines) {
      const provisionedAt = line.provisionedAt ? new Date(line.provisionedAt) : undefined;
      const activatedAt = line.activatedAt ? new Date(line.activatedAt) : undefined;
      if (provisionedAt && inRange(provisionedAt)) {
        countOf(line.productId, line.resellerPath).provisioned += 1;
      }
      if (provisionedAt && activatedAt && inRange(activatedAt)) {
        const count = countOf(line.productId, line.resellerPath);
        count.activated += 1;
        count.activationDaysTotal += (activatedAt.getTime() - provisionedAt.getTime()) / DAY_MS;
      }
    }

    return [...counts.values()].map(count => ({ ...count, activationDaysTotal: Math.round(count.activationDaysTotal * 100) / 100 }));
  }

  /**
   * Finds the contracts followed by a newer one on the same tenant: the customer stayed, so their end is no loss.
   * @param contracts the contracts of every product.
   * @returns the identifiers of the contracts with a newer one on their tenant.
   */
  private _supersededContractIds(contracts: ResponseContractDto[]): Set<string> {
    const latestStart = new Map<string, string>();
    for (const contract of contracts) {
      const key = `${contract.productId}#${contract.tenantId}`;
      const known = latestStart.get(key);
      if (!known || known < contract.startDate) {
        latestStart.set(key, contract.startDate);
      }
    }

    return new Set(contracts
      .filter(contract => contract.startDate < (latestStart.get(`${contract.productId}#${contract.tenantId}`) ?? ''))
      .map(contract => contract.id));
  }

  /**
   * Lists the customers to follow up today, by date: the lines whose credentials were delivered with no first access
   * on a contract still in force, the contracts cancelled by the customer and not ended yet (a financed contract ends
   * by itself, with no cancellation), and the contracts in force whose access is suspended for an unpaid invoice.
   * @param contracts the contracts of every product.
   * @param lines the provisioned and activated order lines of every product.
   * @returns the follow-ups, the oldest date first.
   */
  private _customerFollowUps(contracts: ResponseContractDto[], lines: ResponseOrderLineDto[]): ResponseCustomerFollowUpDto[] {
    const followUps: ResponseCustomerFollowUpDto[] = [];
    const inForceIds = new Set(contracts.filter(contract => IN_FORCE_STATUSES.includes(contract.status)).map(contract => contract.id));
    const add = (
      source: { productId: string; companyId: string; companyName: string; resellerPath?: string },
      reason: CustomerFollowUpReason,
      date: string,
    ): void => {
      const resellerCode = this._resellerCodeOf(source.resellerPath);
      followUps.push(plainToInstance(ResponseCustomerFollowUpDto, {
        productId: source.productId,
        companyId: source.companyId,
        companyName: source.companyName,
        ...(resellerCode && { resellerCode }),
        reason,
        date,
      }));
    };

    for (const line of lines) {
      if (line.status === OrderLineStatus.Provisioned && line.provisionedAt && line.contractId && inForceIds.has(line.contractId)) {
        add(line, CustomerFollowUpReason.NeverActivated, line.provisionedAt);
      }
    }

    for (const contract of contracts) {
      if (contract.status === ContractStatus.Terminating && contract.cancelledAt && contract.terminationDate) {
        add(contract, CustomerFollowUpReason.Terminating, contract.terminationDate);
      }
      if (IN_FORCE_STATUSES.includes(contract.status) && contract.accessSuspendedAt) {
        add(contract, CustomerFollowUpReason.AccessSuspended, contract.accessSuspendedAt);
      }
    }

    return followUps.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Finds the contracts of a reseller that come from the orders a salesperson opened.
   * @param salesId the salesperson.
   * @param viewerPath the lineage of the reseller.
   * @returns the identifiers of the contracts.
   */
  private async _contractsSoldBy(salesId: string, viewerPath: string): Promise<Set<string>> {
    const contracts = (await this._readCustomerBase()).contracts.filter(contract => isPathVisible(viewerPath, contract.resellerPath));
    const salesIds = contracts.length > 0
      ? await (await this._loadOrdersService()).getSalesIds(contracts.map(contract => contract.orderId))
      : new Map<string, string>();

    return new Set(contracts.filter(contract => salesIds.get(contract.orderId) === salesId).map(contract => contract.id));
  }

  /**
   * Reads the code of the reseller that sold something from its lineage: the last segment of the path.
   * @param resellerPath the reseller lineage, absent on the direct channel.
   * @returns the code of the reseller, or undefined on the direct channel.
   */
  private _resellerCodeOf(resellerPath: string | undefined): string | undefined {
    return resellerPath?.split('#').filter(Boolean).pop();
  }

  /**
   * Generates period ranges (start/end dates + label) for the given period configuration.
   * @param period the period type (monthly or annual).
   * @param intervals the number of intervals.
   * @returns Array of period ranges, most recent first.
   */
  private _generatePeriodRanges(period: MetricsPeriod, intervals: number): PeriodRange[] {
    const now = new Date();
    const ranges: PeriodRange[] = [];

    if (period === MetricsPeriod.Monthly) {
      for (let i = 0; i < intervals; i++) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = new Date(date.getFullYear(), date.getMonth(), 1);
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
        const label = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
        ranges.push({ start, end, label });
      }
    } else {
      for (let i = 0; i < intervals; i++) {
        const year = now.getFullYear() - i;
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31, 23, 59, 59, 999);
        ranges.push({ start, end, label: String(year) });
      }
    }

    return ranges;
  }

  // #endregion
}

/**
 * Internal interface for a period of the dashboards: its date range and its label.
 */
interface PeriodRange {
  start: Date;
  end: Date;
  label: string;
}

/**
 * Internal interface for the deals the sales metrics are computed from: the ones of the whole
 * products pipeline, or the ones of a single solution of interest.
 */
interface SalesDeals {
  /** Solution of interest the deals include, absent for the whole pipeline. */
  solution?: string;
  /** Deals created within the period window. */
  createdDeals: HubspotDeal[];
  /** Deals closed won within the period window. */
  wonDeals: HubspotDeal[];
  /** Deals closed lost within the period window. */
  lostDeals: HubspotDeal[];
  /** Deals currently in a trial stage. */
  trialDeals: HubspotDeal[];
}
