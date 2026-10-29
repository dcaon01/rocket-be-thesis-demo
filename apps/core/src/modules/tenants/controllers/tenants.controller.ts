import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Put, UseGuards, HttpCode } from "@nestjs/common";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CreateTenantDto } from "../dtos/create-tenant.dto";
import { TenantsPageQueryDto } from '../dtos/tenants-page-query.dto';
import { ResponseTenantsPageDto } from '../dtos/response-tenants-page.dto';
import { ResponseTenantDto } from "../dtos/response-tenant.dto";
import { UpdateTenantDto } from "../dtos/update-tenant.dto";
import { TenantsService } from "../lazy-tenants/services/tenants.service";
import { ResponsePendingOperationDto } from "../../pending-operations/dtos/response-pending-operation.dto";

/**
 * Controller for managing tenants.
 * Uses lazy loading to load TenantsService only when needed.
 */
@ApiTags('Tenants')
@UseGuards(ScopeGuard, RolesGuard)
@Controller('tenants')
export class TenantsController {
  /** Lazy-loaded tenants service */
  private _tenantsService: TenantsService | null = null;

  /**
   * Constructor for TenantsController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) {}

  /**
   * Lazy loads the TenantsService from its module.
   * @returns A Promise resolving to the TenantsService instance.
   */
  private async _loadTenantsService(): Promise<TenantsService> {
    if (!this._tenantsService) {
      const { TenantsLazyModule } = await import(
        "../lazy-tenants/tenants-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => TenantsLazyModule,
      );
      this._tenantsService = moduleRef.get<TenantsService>(TenantsService);
    }
    return this._tenantsService;
  }

  /**
   * Creates a new tenant.
   * @param tenant the DTO with the information to create a new tenant.
   * @returns the created tenant.
   */
  @Post()
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({
    summary: 'Request a new tenant',
    description: 'Writes the tenant in REQUESTED and asks the product to create it; the product\'s answer moves it to ACTIVE or FAILED.'
  })
  @ApiBody({
    type: CreateTenantDto
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The tenant has been requested to the product.',
    type: ResponseTenantDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Related entity not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async createTenant(
    @CurrentScope() scope: RequestScope,
    @Body() tenant: CreateTenantDto
  ): Promise<ResponseTenantDto> {
    const tenantsService = await this._loadTenantsService();
    return tenantsService.notifyCreateTenant(tenant, scope);
  }

  /**
   * Sends a tenant request to the product again.
   * @param productId the identifier of the product.
   * @param id the identifier of the tenant.
   * @returns the tenant, waiting for the product again.
   */
  @Patch('product/:productId/tenant/:id/resend')
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({
    summary: 'Send a tenant request again',
    description: 'Sends again the open operation of a tenant (creation, change or deletion), reopening it if the product answered with an error.'
  })
  @ApiParam({ name: 'productId', description: 'The product ID.' })
  @ApiParam({ name: 'id', description: 'The unique identifier of the tenant.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The request has been sent again.', type: ResponseTenantDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The tenant is not requested.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Tenant not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async resendTenantRequest(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseTenantDto> {
    const tenantsService = await this._loadTenantsService();
    return tenantsService.resendTenantRequest(productId, id, scope);
  }

  /**
   * Discards a tenant request the product answered with an error.
   * @param productId the identifier of the product.
   * @param id the identifier of the tenant.
   * @returns the cancelled tenant.
   */
  @Patch('product/:productId/tenant/:id/cancel')
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({
    summary: 'Discard a tenant request',
    description: 'Discards an operation of the tenant the product answered with an error: a discarded creation marks it CANCELLED, a discarded change or deletion leaves it as it is. An operation without an answer cannot be discarded, only sent again.'
  })
  @ApiParam({ name: 'productId', description: 'The product ID.' })
  @ApiParam({ name: 'id', description: 'The unique identifier of the tenant.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The request has been discarded.', type: ResponseTenantDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The product has not answered the request with an error, or the tenant changed meanwhile.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Tenant not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async cancelTenantRequest(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseTenantDto> {
    const tenantsService = await this._loadTenantsService();
    return tenantsService.cancelTenantRequest(productId, id, scope);
  }

  /**
   * Lists the operations sent to the product for a tenant: its history.
   * @param productId the identifier of the product.
   * @param id the identifier of the tenant.
   * @returns the operations, newest first.
   */
  @Get('product/:productId/tenant/:id/operations')
  @ApiOperation({
    summary: 'List the operations of a tenant',
    description: 'Lists, newest first, the operations Rocket sent to the product for the tenant, with their state, attempts and last error.'
  })
  @ApiParam({ name: 'productId', description: 'The product ID.' })
  @ApiParam({ name: 'id', description: 'The unique identifier of the tenant.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The operations of the tenant.', type: [ResponsePendingOperationDto] })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Tenant not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async listTenantOperations(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponsePendingOperationDto[]> {
    const tenantsService = await this._loadTenantsService();
    return tenantsService.listTenantOperations(productId, id, scope);
  }

  /**
   * Retrieves all tenants.
   * @returns a list of all tenants.
   */
  @Get('all')
  @ApiOperation({
    summary: 'Get all tenants',
    description: 'Retrieves a list of all tenants in the system.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'A list of tenants.',
    isArray: true,
    type: ResponseTenantDto
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getAllTenants(@CurrentScope() scope: RequestScope): Promise<ResponseTenantDto[]> {
    const tenantsService = await this._loadTenantsService();
    return tenantsService.getAllTenants(scope);
  }

  /**
   * Retrieves the tenants of a company on every product, those of terminated contracts included.
   * @param companyId the company of the tenants.
   * @returns the tenants of the company.
   */
  @Get('company/:companyId')
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({
    summary: 'Get tenants by company',
    description: 'Retrieves the tenants of a company on every product: those of its contracts, terminated ones included.'
  })
  @ApiParam({ name: 'companyId', type: String, description: 'The ID of the company.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The tenants of the company.', isArray: true, type: ResponseTenantDto })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async getTenantsByCompany(
    @CurrentScope() scope: RequestScope,
    @Param('companyId') companyId: string,
  ): Promise<ResponseTenantDto[]> {
    const tenantsService = await this._loadTenantsService();
    return tenantsService.getTenantsByCompany(companyId, scope);
  }

  /**
   * Lists one page of the tenants of a product.
   * @param productId the identifier of the product.
   * @param query the page and its filters.
   * @returns the page of tenants of the product.
   */
  @Post('product/:productId/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the tenants of a product',
    description: 'Lists one page of the tenants of a product, filtered by status (every status when none) and by the start of name, contract code or trial email.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID to filter tenants by.',
  })
  @ApiBody({ type: TenantsPageQueryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'A list of tenants associated with the specified product.',
    type: ResponseTenantsPageDto
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async listTenants(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Body() query: TenantsPageQueryDto,
  ): Promise<ResponseTenantsPageDto> {
    const tenantsService = await this._loadTenantsService();
    return tenantsService.listTenants(productId, query, scope);
  }

  /**
   * Retrieves a tenant by its ID.
   * @param productId the product ID.
   * @param id the identifier of the tenant.
   * @returns retrieves the tenant with the specified ID.
   */
  @Get('product/:productId/tenant/:id')
  @ApiOperation({
    summary: 'Get tenant by ID',
    description: 'Retrieves a tenant by its unique identifier.'
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the tenant.',
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The tenant has been successfully retrieved.',
    type: ResponseTenantDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Tenant not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getTenant(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string
  ): Promise<ResponseTenantDto> {
    const tenantsService = await this._loadTenantsService();
    return tenantsService.getTenant(productId, id, scope);
  }

  /**
   * Updates a tenant by its ID.
   * @param productId the identifier of the product.
   * @param id the identifier of the tenant.
   * @param tenant the information to update the tenant.
   * @returns the updated tenant.
   */
  @Put('product/:productId/tenant/:id')
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({
    summary: 'Update tenant by ID',
    description: 'Updates a tenant by its unique identifier.'
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the tenant.',
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
  })
  @ApiBody({
    type: UpdateTenantDto
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The change has been asked to the product; it lands when the product confirms it.',
    type: ResponseTenantDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Tenant not found.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async updateTenant(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
    @Body() tenant: UpdateTenantDto
  ): Promise<ResponseTenantDto> {
    const tenantsService = await this._loadTenantsService();
    await tenantsService.assertTenantOnProduct(productId, id, scope);

    // Separate the status, applied on Rocket, from fields that need product notification
    const { status, ...fieldsToNotify } = tenant;
    const hasDirectUpdates = status !== undefined;
    const hasFieldsToNotify = Object.keys(fieldsToNotify).length > 0;

    // Status changes are applied directly on Rocket (no need to notify the product)
    if (hasDirectUpdates) {
      await tenantsService.updateTenant(productId, id, { status } as UpdateTenantDto, scope);
    }

    // Other fields are asked to the product, and land on Rocket when it confirms them
    if (hasFieldsToNotify) {
      return tenantsService.requestTenantUpdate(productId, id, fieldsToNotify as UpdateTenantDto, scope);
    }

    return tenantsService.getTenant(productId, id, scope);
  }

  /**
   * Deletes a tenant by its ID.
   * @param productId the identifier of the product.
   * @param id the identifier of the tenant.
   */
  @Delete('product/:productId/tenant/:id')
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'Delete tenant by ID',
    description: 'Asks the product to delete the tenant: it becomes DELETED when the product confirms, and stays until it is removed for good.'
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the tenant.',
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The deletion has been asked to the product.',
    type: ResponseTenantDto
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async deleteTenant(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseTenantDto> {
    const tenantsService = await this._loadTenantsService();
    await tenantsService.assertTenantOnProduct(productId, id, scope);
    return tenantsService.requestTenantDelete(productId, id, scope);
  }

  /**
   * Removes for good a tenant deleted on the product, or a discarded request, with its users.
   * @param productId the identifier of the product.
   * @param id the identifier of the tenant.
   */
  @Delete('product/:productId/tenant/:id/purge')
  @Roles(UserRole.KeusAdmin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a tenant for good',
    description: 'Removes a DELETED tenant, or a CANCELLED request, together with its users. Its operations stay as history.'
  })
  @ApiParam({ name: 'productId', description: 'The product ID.' })
  @ApiParam({ name: 'id', description: 'The unique identifier of the tenant.' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'The tenant has been removed.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The tenant is neither DELETED nor CANCELLED.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Tenant not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async purgeTenant(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<void> {
    const tenantsService = await this._loadTenantsService();
    await tenantsService.purgeTenant(productId, id, scope);
  }
}
