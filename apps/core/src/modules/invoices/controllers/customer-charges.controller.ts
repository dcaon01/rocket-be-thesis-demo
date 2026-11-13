import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { CollectCustomerChargeDto } from "../dtos/collect-customer-charge.dto";
import { CreateCustomerChargeDto } from "../dtos/create-customer-charge.dto";
import { ResellerInvoicesPageQueryDto, ResellerSchedulePageQueryDto } from "../dtos/reseller-schedule-page-query.dto";
import { ResponseCustomerChargeDto } from "../dtos/response-customer-charge.dto";
import { ResponseSchedulePageDto } from "../dtos/response-schedule-page.dto";
import { UpdateCustomerChargeDto } from "../dtos/update-customer-charge.dto";
import type { CustomerChargesService } from "../lazy-invoices/services/customer-charges.service";

/**
 * Controller for what a reseller bills its customers, nested under the reseller: the shares of its contracts and the
 * items it adds by hand, and its schedule, which puts them with what it pays Keus.
 * Uses lazy loading to load CustomerChargesService only when needed.
 */
@ApiTags("Customer charges")
@UseGuards(ScopeGuard, RolesGuard)
@Controller("resellers/:resellerId")
export class CustomerChargesController {
  /** Lazy-loaded customer charges service. */
  private _customerChargesService: CustomerChargesService | null = null;

  /**
   * Constructor for CustomerChargesController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(private readonly _lazyModuleLoader: LazyModuleLoader) { }

  /**
   * Lazy loads the CustomerChargesService from the invoices module.
   * @returns a Promise resolving to the CustomerChargesService instance.
   */
  private async _loadCustomerChargesService(): Promise<CustomerChargesService> {
    if (!this._customerChargesService) {
      const { InvoicesLazyModule } = await import("../lazy-invoices/invoices-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => InvoicesLazyModule);
      const { CustomerChargesService } = await import("../lazy-invoices/services/customer-charges.service");
      this._customerChargesService = moduleRef.get<CustomerChargesService>(CustomerChargesService);
    }
    return this._customerChargesService;
  }

  /**
   * Lists one page of the schedule of the reseller in a period: what it pays Keus and what it collects from its customers.
   * @param scope the request scope.
   * @param resellerId the reseller.
   * @param query the period, the page and the filters.
   * @returns the page of the schedule, by due date.
   */
  @Post('schedule/search')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({ summary: 'List the schedule of a reseller', description: 'Returns the due dates of a period, by date: the invoices of Keus the reseller still has to pay, and what it collects from its customers, the shares of the contracts and its own items, a recurring one once per due date.' })
  @ApiParam({ name: 'resellerId', description: 'The reseller.', type: String })
  @ApiBody({ type: ResellerSchedulePageQueryDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'The page of the schedule.', type: ResponseSchedulePageDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The period is not valid or longer than 24 months, or invalid page size or cursor.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'The reseller is outside the scope of the requester.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Reseller not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async getSchedule(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Body() query: ResellerSchedulePageQueryDto,
  ): Promise<ResponseSchedulePageDto> {
    const customerChargesService = await this._loadCustomerChargesService();
    return customerChargesService.listSchedule(resellerId, query, scope);
  }

  /**
   * Lists one page of the invoices of the reseller in a period: what it pays Keus and what it bills its customers.
   * @param scope the request scope.
   * @param resellerId the reseller.
   * @param query the period, the page and the filters.
   * @returns the page of the invoices, by due date, latest first.
   */
  @Post('invoices/search')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({ summary: 'List the invoices of a reseller', description: 'Returns the due dates of a period, latest first: the invoices of Keus to the reseller once paid or due, and the due dates of its customers already reached and marked collected. A reseller sees only its own.' })
  @ApiParam({ name: 'resellerId', description: 'The reseller.', type: String })
  @ApiBody({ type: ResellerInvoicesPageQueryDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'The page of the invoices.', type: ResponseSchedulePageDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The period is not valid or longer than 24 months, or invalid page size or cursor.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'The reseller is outside the scope of the requester.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Reseller not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async getInvoices(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Body() query: ResellerInvoicesPageQueryDto,
  ): Promise<ResponseSchedulePageDto> {
    const customerChargesService = await this._loadCustomerChargesService();
    return customerChargesService.listInvoices(resellerId, query, scope);
  }

  /**
   * Adds an item the reseller bills one of its customers.
   * @param scope the request scope.
   * @param resellerId the reseller.
   * @param dto the item.
   * @returns the item.
   */
  @Post('customer-charges')
  @Roles(UserRole.KeusAdmin, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({ summary: 'Add an item for a customer', description: 'Adds an item the reseller bills one of its customers, once or on a recurring rule, beyond the shares of the contracts.' })
  @ApiParam({ name: 'resellerId', description: 'The reseller.', type: String })
  @ApiBody({ type: CreateCustomerChargeDto })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'The item.', type: ResponseCustomerChargeDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The dates do not fit the kind, or the company is not a customer of the reseller.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'The reseller is outside the scope of the requester.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Reseller or company not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async createCharge(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Body() dto: CreateCustomerChargeDto,
  ): Promise<ResponseCustomerChargeDto> {
    const customerChargesService = await this._loadCustomerChargesService();
    return customerChargesService.createCharge(resellerId, dto, scope);
  }

  /**
   * Reads an item of the reseller.
   * @param scope the request scope.
   * @param resellerId the reseller.
   * @param id the item.
   * @returns the item.
   */
  @Get('customer-charges/:id')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({ summary: 'Get an item for a customer', description: 'Returns an item the reseller bills one of its customers.' })
  @ApiParam({ name: 'resellerId', description: 'The reseller.', type: String })
  @ApiParam({ name: 'id', description: 'The item.', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'The item.', type: ResponseCustomerChargeDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'The reseller is outside the scope of the requester.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Reseller or item not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async getCharge(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Param('id') id: string,
  ): Promise<ResponseCustomerChargeDto> {
    const customerChargesService = await this._loadCustomerChargesService();
    return customerChargesService.getCharge(resellerId, id, scope);
  }

  /**
   * Changes an item the reseller added by hand.
   * @param scope the request scope.
   * @param resellerId the reseller.
   * @param id the item.
   * @param dto the fields to change.
   * @returns the item.
   */
  @Put('customer-charges/:id')
  @Roles(UserRole.KeusAdmin, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({ summary: 'Update an item for a customer', description: 'Changes an item the reseller added by hand; the shares of the contracts are read-only.' })
  @ApiParam({ name: 'resellerId', description: 'The reseller.', type: String })
  @ApiParam({ name: 'id', description: 'The item.', type: String })
  @ApiBody({ type: UpdateCustomerChargeDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'The item.', type: ResponseCustomerChargeDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The item is the share of a contract, or the dates do not fit its kind.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'The reseller is outside the scope of the requester.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Reseller or item not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async updateCharge(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerChargeDto,
  ): Promise<ResponseCustomerChargeDto> {
    const customerChargesService = await this._loadCustomerChargesService();
    return customerChargesService.updateCharge(resellerId, id, dto, scope);
  }

  /**
   * Deletes an item the reseller added by hand.
   * @param scope the request scope.
   * @param resellerId the reseller.
   * @param id the item.
   */
  @Delete('customer-charges/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.KeusAdmin, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({ summary: 'Delete an item for a customer', description: 'Deletes an item the reseller added by hand; the shares of the contracts stay.' })
  @ApiParam({ name: 'resellerId', description: 'The reseller.', type: String })
  @ApiParam({ name: 'id', description: 'The item.', type: String })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'The item is deleted.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The item is the share of a contract.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'The reseller is outside the scope of the requester.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Reseller or item not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async deleteCharge(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Param('id') id: string,
  ): Promise<void> {
    const customerChargesService = await this._loadCustomerChargesService();
    await customerChargesService.deleteCharge(resellerId, id, scope);
  }

  /**
   * Marks a due date of an item collected, or not collected.
   * @param scope the request scope.
   * @param resellerId the reseller.
   * @param id the item.
   * @param dto whether it is collected, and the due date of a recurring item.
   * @returns the item.
   */
  @Patch('customer-charges/:id/collected')
  @Roles(UserRole.KeusAdmin, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({ summary: 'Mark a customer due date collected', description: 'Marks a due date of an item collected, or not collected after a mistake; a recurring item names the due date.' })
  @ApiParam({ name: 'resellerId', description: 'The reseller.', type: String })
  @ApiParam({ name: 'id', description: 'The item.', type: String })
  @ApiBody({ type: CollectCustomerChargeDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'The item.', type: ResponseCustomerChargeDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The date is not a due date of the recurring item.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'The reseller is outside the scope of the requester.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Reseller or item not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async setCollected(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Param('id') id: string,
    @Body() dto: CollectCustomerChargeDto,
  ): Promise<ResponseCustomerChargeDto> {
    const customerChargesService = await this._loadCustomerChargesService();
    return customerChargesService.setCollected(resellerId, id, dto, scope);
  }
}
