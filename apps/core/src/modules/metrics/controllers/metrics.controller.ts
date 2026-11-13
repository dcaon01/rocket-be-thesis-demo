import { Controller, Get, HttpStatus, Query, UseGuards } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { MetricsService } from "../lazy-metrics/services/metrics.service";
import { MetricsPeriod } from "../enums/metrics-period.enum";
import { MetricsLogic } from "../enums/metrics-logic.enum";
import { ResponseRevenueDashboardMetricsRecordDto } from "../dtos/response-revenue-dashboard-metrics-record.dto";
import { ResponseResellerRevenueDashboardMetricsRecordDto } from "../dtos/response-reseller-revenue-dashboard-metrics-record.dto";
import { ResponseResellerOverviewPeriodRecordDto } from "../dtos/response-reseller-overview-period-record.dto";
import { ResponseActiveCompaniesPeriodRecordDto } from "../dtos/response-active-companies-period-record.dto";
import { ResponseResellerNetworkEntryDto } from "../dtos/response-reseller-network-entry.dto";
import { ResponseResellerWorklistDto } from "../dtos/response-reseller-worklist.dto";
import { ResponseResellerBillingDto } from "../dtos/response-reseller-billing.dto";
import { ResponseUtilitiesDashboardMetricsRecordDto } from "../dtos/response-utilities-dashboard-metrics-record.dto";
import { ResponseSalesDashboardMetricsDto } from "../dtos/response-sales-dashboard-metrics.dto";
import { ResponseSalesOrdersDashboardMetricsDto } from "../dtos/response-sales-orders-dashboard-metrics.dto";
import { ResponseMixpanelTenantKpiDto } from "../dtos/response-mixpanel-tenant-kpi.dto";
import { ResponseCustomerSuccessDashboardMetricsDto } from "../dtos/response-customer-success-dashboard-metrics.dto";
import { ResponseSupportPeriodRecordDto } from "../dtos/response-support-period-record.dto";
import { ResponseIntercomBrandDto } from "../dtos/response-intercom-brand.dto";
import { ResponseTechnicalErrorsDashboardMetricsDto } from "../dtos/response-technical-errors-dashboard-metrics.dto";
import { ResponseTechnicalErrorsIssuesDto } from "../dtos/response-technical-errors-issues.dto";
import { ResponseSentryProjectDto } from "../dtos/response-sentry-project.dto";
import { ResponseAvailabilityPeriodRecordDto } from "../dtos/response-availability-period-record.dto";
import { ResponseProductAdoptionPeriodRecordDto } from "../dtos/response-product-adoption-period-record.dto";

/**
 * Controller for managing Metrics.
 * Uses lazy loading to load MetricsService only when needed.
 */
@ApiTags('Metrics')
@Controller('metrics')
@UseGuards(ScopeGuard, RolesGuard)
export class MetricsController {
  /** Lazy-loaded metrics service */
  private _metricsService: MetricsService | null = null;

  /**
   * Constructor for MetricsController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) {}

  /**
   * Lazy loads the MetricsService from its module.
   * @returns A Promise resolving to the MetricsService instance.
   */
  private async _loadMetricsService(): Promise<MetricsService> {
    if (!this._metricsService) {
      const { MetricsLazyModule } = await import(
        "../lazy-metrics/metrics-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => MetricsLazyModule,
      );
      this._metricsService = moduleRef.get<MetricsService>(MetricsService);
    }
    return this._metricsService;
  }

  /**
   * Retrieves revenue dashboard metrics filtered by period, of the whole of Keus or of what a Keus salesperson sold.
   * @param scope the request scope.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   */
  @Get('dashboard/revenue')
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Get revenue dashboard metrics',
    description: 'Retrieves revenue metrics for the dashboard filtered by period: of the whole of Keus, or, for a Keus salesperson, of the orders it opened and of the resellers it is the reference salesperson of.'
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Revenue dashboard metrics retrieved successfully.',
    type: [ResponseRevenueDashboardMetricsRecordDto],
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  async getRevenueDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('period') period: MetricsPeriod,
    @Query('intervals') intervals?: number,
  ): Promise<ResponseRevenueDashboardMetricsRecordDto[]> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    return await metricsService.getRevenueDashboardMetrics(period, effectiveIntervals, scope);
  }

  /**
   * Retrieves what a reseller bills its customers and what it margins, filtered by period and, optionally, salesperson.
   * @param scope the request scope.
   * @param resellerId the reseller.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   * @param salesId the salesperson whose sales are read, absent for the whole reseller.
   */
  @Get('dashboard/reseller-revenue')
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.ResellerOwner, UserRole.ResellerSales)
  @ApiOperation({
    summary: 'Get reseller revenue dashboard metrics',
    description: 'Retrieves what a reseller bills its customers and what it margins, per product and period, optionally for one of its salespeople. A reseller salesperson reads only what it sold, without the margin; a Keus salesperson reads only the resellers it is the reference salesperson of.'
  })
  @ApiQuery({
    name: 'resellerId',
    description: 'Reseller whose revenue is read.',
    required: true,
    type: String,
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'salesId',
    description: 'Salesperson of the reseller whose sales are read; absent for the whole reseller. Ignored for a reseller salesperson, who reads its own.',
    required: false,
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reseller revenue dashboard metrics retrieved successfully.',
    type: [ResponseResellerRevenueDashboardMetricsRecordDto],
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The reseller is outside the requester\'s scope.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  async getResellerRevenueDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('resellerId') resellerId: string,
    @Query('period') period: MetricsPeriod,
    @Query('intervals') intervals?: number,
    @Query('salesId') salesId?: string,
  ): Promise<ResponseResellerRevenueDashboardMetricsRecordDto[]> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    return await metricsService.getResellerRevenueDashboardMetrics(period, effectiveIntervals, resellerId, salesId, scope);
  }

  /**
   * Retrieves the active licenses, the new activations and the customers served of a reseller, filtered by period.
   * @param scope the request scope.
   * @param resellerId the reseller.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   */
  @Get('dashboard/reseller-overview')
  @Roles(
    UserRole.KeusAdmin,
    UserRole.KeusSales,
    UserRole.KeusBackoffice,
    UserRole.ResellerOwner,
    UserRole.ResellerBackoffice,
    UserRole.ResellerSales,
  )
  @ApiOperation({
    summary: 'Get reseller overview dashboard metrics',
    description: 'Retrieves the contracts in force and started, and the companies served and new, of a reseller and its subtree, per product and period, with one record per period for every product together (UR-RK-339). A reseller salesperson reads only the contracts of the orders it opened; a Keus salesperson reads only the resellers it is the reference salesperson of.'
  })
  @ApiQuery({
    name: 'resellerId',
    description: 'Reseller whose overview is read.',
    required: true,
    type: String,
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reseller overview dashboard metrics retrieved successfully.',
    type: [ResponseResellerOverviewPeriodRecordDto],
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The reseller is outside the requester\'s scope.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.',
  })
  async getResellerOverviewDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('resellerId') resellerId: string,
    @Query('period') period: MetricsPeriod,
    @Query('intervals') intervals?: number,
  ): Promise<ResponseResellerOverviewPeriodRecordDto[]> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    return await metricsService.getResellerOverviewDashboardMetrics(period, effectiveIntervals, resellerId, scope);
  }

  /**
   * Retrieves today's work of a reseller: orders in progress, renewals coming, customers at risk and opportunities.
   * @param scope the request scope.
   * @param resellerId the reseller.
   */
  @Get('dashboard/reseller-worklist')
  @Roles(
    UserRole.KeusAdmin,
    UserRole.KeusSales,
    UserRole.KeusBackoffice,
    UserRole.ResellerOwner,
    UserRole.ResellerBackoffice,
    UserRole.ResellerSales,
  )
  @ApiOperation({
    summary: 'Get the worklist of a reseller',
    description: 'Retrieves, computed when read, the orders in progress of a reseller and its subtree, the contracts renewing in the next 90 days, the customers at risk (contracts cancelled and not ended yet, access suspended) and the opportunities to grow (tenants close to their seats, companies on a single product) (UR-RK-339). A reseller salesperson reads only its orders and the contracts that come from them; a Keus salesperson reads only the resellers it is the reference salesperson of.'
  })
  @ApiQuery({
    name: 'resellerId',
    description: 'Reseller whose worklist is read.',
    required: true,
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Worklist of the reseller retrieved successfully.',
    type: ResponseResellerWorklistDto,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The reseller is outside the requester\'s scope.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.',
  })
  async getResellerWorklist(
    @CurrentScope() scope: RequestScope,
    @Query('resellerId') resellerId: string,
  ): Promise<ResponseResellerWorklistDto> {
    const metricsService = await this._loadMetricsService();
    return await metricsService.getResellerWorklist(resellerId, scope);
  }

  /**
   * Retrieves the economic position of a reseller towards Keus, filtered by period.
   * @param scope the request scope.
   * @param resellerId the reseller.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   */
  @Get('dashboard/reseller-billing')
  @Roles(
    UserRole.KeusAdmin,
    UserRole.KeusSales,
    UserRole.KeusAccounting,
    UserRole.ResellerOwner,
    UserRole.ResellerBackoffice,
  )
  @ApiOperation({
    summary: 'Get the economic position of a reseller',
    description: 'Retrieves, computed when read, the invoices Keus issued to a reseller per period and the ones still to pay, with their total and the part past due (UR-RK-339). A reseller salesperson and the Keus back office never read it; a Keus salesperson reads only the resellers it is the reference salesperson of.'
  })
  @ApiQuery({
    name: 'resellerId',
    description: 'Reseller whose economic position is read.',
    required: true,
    type: String,
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Economic position of the reseller retrieved successfully.',
    type: ResponseResellerBillingDto,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The reseller is outside the requester\'s scope.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.',
  })
  async getResellerBillingDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('resellerId') resellerId: string,
    @Query('period') period: MetricsPeriod,
    @Query('intervals') intervals?: number,
  ): Promise<ResponseResellerBillingDto> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    return await metricsService.getResellerBillingDashboardMetrics(period, effectiveIntervals, resellerId, scope);
  }

  /**
   * Retrieves utilities dashboard metrics filtered by period and logic, of the requester's perimeter or of one reseller.
   * @param scope the request scope.
   * @param period the period of the metrics (annual or monthly).
   * @param logic the logic type of the metrics (activated or active).
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   * @param resellerId the reseller whose utilities are read, absent for the requester's own perimeter.
   */
  @Get('dashboard/utilities')
  @Roles(
    UserRole.KeusAdmin,
    UserRole.KeusSales,
    UserRole.KeusBackoffice,
    UserRole.ResellerOwner,
    UserRole.ResellerBackoffice,
  )
  @ApiOperation({
    summary: 'Get utilities dashboard metrics',
    description: 'Retrieves utilities metrics for the dashboard filtered by period and logic: of the whole of Keus, of the requesting reseller, or of the reseller asked for. A Keus salesperson reads only the resellers it is the reference salesperson of, and must name one.'
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'logic',
    description: 'Logic type of the metrics.',
    required: true,
    enum: MetricsLogic,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'resellerId',
    description: 'Reseller whose utilities are read; absent for the requester\'s own perimeter.',
    required: false,
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Utilities dashboard metrics retrieved successfully.',
    type: [ResponseUtilitiesDashboardMetricsRecordDto],
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The reseller is outside the requester\'s scope.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  async getUtilitiesDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('period') period: MetricsPeriod,
    @Query('logic') logic: MetricsLogic,
    @Query('intervals') intervals?: number,
    @Query('resellerId') resellerId?: string,
  ): Promise<ResponseUtilitiesDashboardMetricsRecordDto[]> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    return await metricsService.getUtilitiesDashboardMetrics(period, logic, effectiveIntervals, scope, resellerId);
  }

  /**
   * Retrieves sales dashboard metrics of the HubSpot products pipeline: one record per period for
   * the whole pipeline, plus one per requested solution of interest.
   * @param period the period of the metrics (annual or monthly).
   * @param solutions comma-separated solutions of interest to break the metrics down by.
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   */
  @Get('dashboard/sales')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Get sales dashboard metrics',
    description: 'Retrieves sales metrics from the HubSpot products pipeline: one record per period for the whole pipeline, plus one per requested solution of interest.',
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'solutions',
    description: 'Comma-separated solutions of interest to break the metrics down by.',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Sales dashboard metrics retrieved successfully.',
    type: [ResponseSalesDashboardMetricsDto],
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  async getSalesDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('period') period: MetricsPeriod,
    @Query('solutions') solutions?: string,
    @Query('intervals') intervals?: number,
  ): Promise<ResponseSalesDashboardMetricsDto[]> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    const parsedSolutions = (solutions ?? '').split(',').map(solution => solution.trim()).filter(Boolean);
    return await metricsService.getSalesDashboardMetrics(period, effectiveIntervals, parsedSolutions, scope);
  }

  /**
   * Retrieves the Rocket half of the sales metrics (UR-RK-222), apart from HubSpot: orders, backlog, trials, licenses
   * by channel and reseller, and provisioning times, of the whole of Keus or of what a Keus salesperson sold.
   * @param scope the request scope.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   */
  @Get('dashboard/sales-orders')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting, UserRole.KeusSales)
  @ApiOperation({
    summary: 'Get sales orders dashboard metrics',
    description: 'Counts from the orders, trials, contracts and order lines the orders requested and still open, the trials closed and converted, the licenses activated per channel and reseller, and the provisioning times, per product, period and seller, plus the trials active today. A Keus salesperson reads only what it sold.',
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Sales orders dashboard metrics retrieved successfully.',
    type: ResponseSalesOrdersDashboardMetricsDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The requester is not a Keus collaborator allowed to read the sales metrics.',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.',
  })
  async getSalesOrdersDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('period') period: MetricsPeriod,
    @Query('intervals') intervals?: number,
  ): Promise<ResponseSalesOrdersDashboardMetricsDto> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    return await metricsService.getSalesOrdersDashboardMetrics(period, effectiveIntervals, scope);
  }

  /**
   * Retrieves the active companies of the global and product dashboards (UR-RK-001, UR-RK-235), per product and period.
   * @param scope the request scope.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   * @param productId the product read, absent for every product (required for the Keus back office).
   */
  @Get('dashboard/active-companies')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting, UserRole.KeusBackoffice)
  @ApiOperation({
    summary: 'Get active companies dashboard metrics',
    description: 'Counts the companies with at least one contract in force, on both channels, per product and period, plus the record of every product together where a company on two products counts once. The Keus back office reads one product at a time.',
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'productId',
    description: 'Product read; absent for every product, and never ALL. Required for the Keus back office.',
    required: false,
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Active companies dashboard metrics retrieved successfully.',
    type: [ResponseActiveCompaniesPeriodRecordDto],
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The requester may not read the active companies, or is the back office without a product.',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.',
  })
  async getActiveCompaniesDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('period') period: MetricsPeriod,
    @Query('intervals') intervals?: number,
    @Query('productId') productId?: string,
  ): Promise<ResponseActiveCompaniesPeriodRecordDto[]> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    return await metricsService.getActiveCompaniesDashboardMetrics(period, effectiveIntervals, productId, scope);
  }

  /**
   * Retrieves the reseller network of the global dashboard (UR-RK-001): the resellers with the fee in force, where
   * they are and the licenses they activated in the current period.
   * @param scope the request scope.
   * @param period the current period of the licenses (annual or monthly).
   */
  @Get('dashboard/reseller-network')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting, UserRole.KeusBackoffice)
  @ApiOperation({
    summary: 'Get reseller network dashboard metrics',
    description: 'Lists today the resellers with the fee in force, with the city and province of their legal address, the products they are enabled to sell and the licenses they sold themselves in the current month or year, transfers excluded.',
  })
  @ApiQuery({
    name: 'period',
    description: 'Current period of the licenses.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reseller network retrieved successfully.',
    type: [ResponseResellerNetworkEntryDto],
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The requester may not read the reseller network.',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.',
  })
  async getResellerNetworkDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('period') period: MetricsPeriod,
  ): Promise<ResponseResellerNetworkEntryDto[]> {
    const metricsService = await this._loadMetricsService();
    return await metricsService.getResellerNetworkDashboardMetrics(period, scope);
  }

  /**
   * Retrieves the customer success metrics of every product (UR-RK-221): churn and activation counts per product,
   * period and seller, and the customers to follow up today.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   */
  @Get('dashboard/customer-success')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting, UserRole.KeusBackoffice)
  @ApiOperation({
    summary: 'Get customer success dashboard metrics',
    description: 'Computes from the contracts and the order lines of every product the churn and activation counts per product, period and seller, and lists the customers to follow up today.',
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Customer success dashboard metrics retrieved successfully.',
    type: ResponseCustomerSuccessDashboardMetricsDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  async getCustomerSuccessDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('period') period: MetricsPeriod,
    @Query('intervals') intervals?: number,
  ): Promise<ResponseCustomerSuccessDashboardMetricsDto> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    return await metricsService.getCustomerSuccessDashboardMetrics(period, effectiveIntervals, scope);
  }

  /**
   * Retrieves the support metrics of the products from the Intercom conversations (UR-RK-221): conversations opened
   * and closed, and their reply and resolution times, per product and period.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   */
  @Get('dashboard/support')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting, UserRole.KeusBackoffice)
  @ApiOperation({
    summary: 'Get support dashboard metrics',
    description: 'Reads the Intercom conversations of the products with a brand and counts, per product and period, the conversations opened and closed and their reply and resolution times.',
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Support dashboard metrics retrieved successfully.',
    type: [ResponseSupportPeriodRecordDto],
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Intercom is not configured (INTERCOM_ACCESS_TOKEN), or a read of Rocket failed.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_GATEWAY,
    description: 'Intercom answered with an error.',
  })
  @ApiResponse({
    status: HttpStatus.GATEWAY_TIMEOUT,
    description: 'Intercom could not be reached, or took too long to list the conversations of the period.',
  })
  async getSupportDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('period') period: MetricsPeriod,
    @Query('intervals') intervals?: number,
  ): Promise<ResponseSupportPeriodRecordDto[]> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    return await metricsService.getSupportDashboardMetrics(period, effectiveIntervals, scope);
  }

  /**
   * Lists the brands of the Intercom workspace, for the choice of the brand of a product.
   */
  @Get('intercom/brands')
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'List the Intercom brands',
    description: 'Lists the brands of the Intercom workspace, for the choice of the brand whose conversations belong to a product.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Intercom brands retrieved successfully.',
    type: [ResponseIntercomBrandDto],
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Intercom is not configured (INTERCOM_ACCESS_TOKEN).',
  })
  @ApiResponse({
    status: HttpStatus.BAD_GATEWAY,
    description: 'Intercom answered with an error.',
  })
  @ApiResponse({
    status: HttpStatus.GATEWAY_TIMEOUT,
    description: 'Intercom could not be reached or did not answer in time.',
  })
  async getIntercomBrands(
    @CurrentScope() scope: RequestScope,
  ): Promise<ResponseIntercomBrandDto[]> {
    const metricsService = await this._loadMetricsService();
    return await metricsService.getIntercomBrands(scope);
  }

  /**
   * Retrieves the errors and the alerts of the products from their Sentry projects (UR-RK-225), in the environment of
   * this Rocket: errors and alerts fired per product and period, and the alerts open today.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   */
  @Get('dashboard/technical-errors')
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'Get technical errors dashboard metrics',
    description: 'Reads the Sentry projects of the products, in the environment of this Rocket, and counts per product and period the error events and the issues first seen, with the unresolved issues of today.',
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Technical errors dashboard metrics retrieved successfully.',
    type: ResponseTechnicalErrorsDashboardMetricsDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Sentry is not configured (SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_ENVIRONMENT), or a read of Rocket failed.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_GATEWAY,
    description: 'Sentry answered with an error, or refused the requests because of its rate limits.',
  })
  @ApiResponse({
    status: HttpStatus.GATEWAY_TIMEOUT,
    description: 'Sentry could not be reached, or took too long to count the issues.',
  })
  async getTechnicalErrorsDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('period') period: MetricsPeriod,
    @Query('intervals') intervals?: number,
  ): Promise<ResponseTechnicalErrorsDashboardMetricsDto> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    return await metricsService.getTechnicalErrorsDashboardMetrics(period, effectiveIntervals, scope);
  }

  /**
   * Retrieves the issues with most error events of the current month from the Sentry projects of the products
   * (UR-RK-225), in the environment of this Rocket, with the link to open each one and the one to their projects.
   * @param productId the product to read (default: every product with a Sentry project).
   */
  @Get('dashboard/technical-errors/issues')
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'Get the technical errors issues',
    description: 'Reads from Sentry, live, the issues with most error events of the current month for one product or for all of them. Titles are never stored in Rocket.',
  })
  @ApiQuery({
    name: 'productId',
    description: 'Product to read (default: every product with a Sentry project).',
    required: false,
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Technical errors issues retrieved successfully.',
    type: ResponseTechnicalErrorsIssuesDto,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Sentry is not configured (SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_ENVIRONMENT), or a read of Rocket failed.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_GATEWAY,
    description: 'Sentry answered with an error, or refused the requests because of its rate limits.',
  })
  @ApiResponse({
    status: HttpStatus.GATEWAY_TIMEOUT,
    description: 'Sentry could not be reached or did not answer in time.',
  })
  async getTechnicalErrorsIssues(
    @CurrentScope() scope: RequestScope,
    @Query('productId') productId?: string,
  ): Promise<ResponseTechnicalErrorsIssuesDto> {
    const metricsService = await this._loadMetricsService();
    return await metricsService.getTechnicalErrorsIssues(productId, scope);
  }

  /**
   * Lists the projects of the Sentry organization, for the choice of the project of a product.
   */
  @Get('sentry/projects')
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'List the Sentry projects',
    description: 'Lists the projects of the Sentry organization, for the choice of the project whose errors belong to a product.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Sentry projects retrieved successfully.',
    type: [ResponseSentryProjectDto],
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Sentry is not configured (SENTRY_AUTH_TOKEN, SENTRY_ORG).',
  })
  @ApiResponse({
    status: HttpStatus.BAD_GATEWAY,
    description: 'Sentry answered with an error.',
  })
  @ApiResponse({
    status: HttpStatus.GATEWAY_TIMEOUT,
    description: 'Sentry could not be reached or did not answer in time.',
  })
  async getSentryProjects(
    @CurrentScope() scope: RequestScope,
  ): Promise<ResponseSentryProjectDto[]> {
    const metricsService = await this._loadMetricsService();
    return await metricsService.getSentryProjects(scope);
  }

  /**
   * Retrieves the availability of the products from the checks of Rocket every 15 minutes (UR-RK-225): seconds
   * observed, seconds down and outages per product and period.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   */
  @Get('dashboard/availability')
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'Get availability dashboard metrics',
    description: 'Counts, per product and period, the seconds the product was checked, the seconds it was down and its outages, from the checks of its health address every 15 minutes: an outage shorter than that may not appear.',
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Availability dashboard metrics retrieved successfully.',
    type: [ResponseAvailabilityPeriodRecordDto],
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'A read or a write of Rocket failed.',
  })
  async getAvailabilityDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('period') period: MetricsPeriod,
    @Query('intervals') intervals?: number,
  ): Promise<ResponseAvailabilityPeriodRecordDto[]> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    return await metricsService.getAvailabilityDashboardMetrics(period, effectiveIntervals, scope);
  }

  /**
   * Retrieves the adoption counts of the products (UR-RK-223): per product, period, seller and lever, how many tenants
   * came out of the rules of the lever in each way.
   * @param period the period of the metrics (annual or monthly).
   * @param intervals the number of intervals to retrieve (default: 12 for monthly, 5 for annual).
   */
  @Get('dashboard/product-adoption')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting, UserRole.KeusBackoffice)
  @ApiOperation({
    summary: 'Get product adoption dashboard metrics',
    description: 'Evaluates from Mixpanel the customer tenants of the current month on the rules of their product, and reads the past months as they were at their end: per product, period, seller and lever, how many tenants are compliant, at risk, failing, not assessable or observed.',
  })
  @ApiQuery({
    name: 'period',
    description: 'Period of the metrics.',
    required: true,
    enum: MetricsPeriod,
  })
  @ApiQuery({
    name: 'intervals',
    description: 'Number of intervals to retrieve (default: 12 for monthly, 5 for annual).',
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Product adoption dashboard metrics retrieved successfully.',
    type: [ResponseProductAdoptionPeriodRecordDto],
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Mixpanel is not configured or did not answer, or a read of Rocket failed.',
  })
  async getProductAdoptionDashboardMetrics(
    @CurrentScope() scope: RequestScope,
    @Query('period') period: MetricsPeriod,
    @Query('intervals') intervals?: number,
  ): Promise<ResponseProductAdoptionPeriodRecordDto[]> {
    const metricsService = await this._loadMetricsService();
    const effectiveIntervals = intervals ?? (period === MetricsPeriod.Monthly ? 12 : 5);
    return await metricsService.getProductAdoptionDashboardMetrics(period, effectiveIntervals, scope);
  }

  /**
   * Retrieves how every customer tenant came out of the rules of its product, evaluated on the last day of the
   * period (UR-RK-223).
   * @param from start of the period (YYYY-MM-DD).
   * @param to end of the period (YYYY-MM-DD).
   * @param productId optional product filter; when omitted, the tenants of every product are returned.
   */
  @Get('mixpanel/tenant-kpi')
  @Roles(
    UserRole.KeusAdmin,
    UserRole.KeusSales,
    UserRole.KeusBackoffice,
    UserRole.KeusAccounting,
    UserRole.ResellerOwner,
    UserRole.ResellerBackoffice,
    UserRole.ResellerSales,
  )
  @ApiOperation({
    summary: 'Get the per-tenant outcomes on the levers',
    description:
      'Reads the events of the customer tenants from Mixpanel and evaluates them on the rules of their product, on the last day of the period ' +
      'or now when it is not over. Activation judges only the tenants whose first days ended in the period. A reseller reads its subtree, a ' +
      'reseller salesperson only the tenants of the orders it opened, a Keus salesperson only one of the resellers it is the reference salesperson of.',
  })
  @ApiQuery({
    name: 'from',
    description: 'Start of the period (YYYY-MM-DD, inclusive).',
    required: true,
    type: String,
  })
  @ApiQuery({
    name: 'to',
    description: 'End of the period and evaluation date (YYYY-MM-DD, inclusive).',
    required: true,
    type: String,
  })
  @ApiQuery({
    name: 'productId',
    description: 'Optional product filter; when omitted, the tenants of every product are returned.',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'resellerId',
    description: 'Reseller whose tenants are read; absent for the requester\'s own perimeter. Required for a Keus salesperson.',
    required: false,
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Per-tenant outcomes retrieved successfully.',
    type: [ResponseMixpanelTenantKpiDto],
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The reseller is outside the requester\'s scope, or a Keus salesperson named none.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.',
  })
  async getMixpanelTenantKpi(
    @CurrentScope() scope: RequestScope,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('productId') productId?: string,
    @Query('resellerId') resellerId?: string,
  ): Promise<ResponseMixpanelTenantKpiDto[]> {
    const metricsService = await this._loadMetricsService();
    return await metricsService.getMixpanelTenantKpi(from, to, productId, resellerId, scope);
  }
}
