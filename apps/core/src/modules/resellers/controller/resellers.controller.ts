import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Put, UseGuards, HttpCode } from "@nestjs/common";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { plainToInstance } from "class-transformer";
import { CreateResellerDto } from "../dtos/create-reseller.dto";
import { ResponseResellerDto } from "../dtos/response-reseller.dto";
import { ResellersPageQueryDto } from "../dtos/resellers-page-query.dto";
import { ResponseResellersPageDto } from "../dtos/response-resellers-page.dto";
import { UpdateResellerDto } from "../dtos/update-reseller.dto";
import { ResponseResellerTierConfigDto, UpsertResellerTierConfigDto } from "../dtos/reseller-tier-config.dto";
import { ResellerTier } from "../enums/reseller-tier.enum";
import { EntityNotFoundException } from "../../../errors/exception-types";
import { AllowBlockedReseller } from "../../../commons/scoping/allow-blocked-reseller.decorator";
import { ResellersService } from "../lazy-resellers/services/resellers.service";

/**
 * Controller for managing resellers.
 * Uses lazy loading to load ResellersService only when needed.
 */
@ApiTags("Resellers")
@UseGuards(ScopeGuard, RolesGuard)
@Controller("resellers")
export class ResellersController {
  /** Lazy-loaded resellers service */
  private _resellersService: ResellersService | null = null;

  /**
   * Constructor for ResellersController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /**
   * Lazy loads the ResellersService from its module.
   * @returns A Promise resolving to the ResellersService instance.
   */
  private async _loadResellersService(): Promise<ResellersService> {
    if (!this._resellersService) {
      const { ResellersLazyModule } = await import(
        "../lazy-resellers/resellers-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ResellersLazyModule,
      );
      this._resellersService = moduleRef.get<ResellersService>(ResellersService);
    }
    return this._resellersService;
  }

  /**
   * Creates a new reseller.
   * @param resellerDto the DTO with the information to create a new reseller.
   * @returns the created reseller.
   */
  @Post()
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales)
  @ApiOperation({
    summary: "Create a new reseller",
    description: "Creates a new reseller in the system. The createdBy field links the reseller to its parent reseller and is immutable."
  })
  @ApiBody({
    type: CreateResellerDto,
    description: "The reseller data to create."
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "The reseller has been successfully created.",
    type: ResponseResellerDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid input data or duplicate reseller code."
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Internal server error."
  })
  async createReseller(
    @CurrentScope() scope: RequestScope,
    @Body() resellerDto: CreateResellerDto
  ): Promise<ResponseResellerDto> {
    const resellersService = await this._loadResellersService();
    return resellersService.createReseller(resellerDto, scope);
  }

  /**
   * Updates an existing reseller.
   * @param id the identifier of the reseller.
   * @param resellerDto the data to update the reseller with.
   * @returns the updated reseller.
   */
  @Put(':id')
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.ResellerOwner)
  @ApiOperation({
    summary: 'Update an existing reseller',
    description: 'Updates the details of an existing reseller by its ID. The createdBy field cannot be changed. A Keus salesperson updates only the resellers it owns and cannot reassign them; a reseller owner updates only its own contacts, legal address and fiscal data.'
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The unique identifier of the reseller to update.'
  })
  @ApiBody({
    type: UpdateResellerDto,
    description: 'The reseller data to update.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The reseller has been successfully updated.',
    type: ResponseResellerDto
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The requester may not apply this update to the reseller.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async updateReseller(
    @CurrentScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() resellerDto: UpdateResellerDto
  ): Promise<ResponseResellerDto> {
    const resellersService = await this._loadResellersService();
    return resellersService.updateReseller(id, resellerDto, scope);
  }

  /**
   * Gives Rocket back to the users of a reseller blocked for an unpaid invoice, before the money arrives.
   * @param scope the scope of the requester.
   * @param id the identifier of the reseller.
   * @returns the reseller.
   */
  @Patch(':id/access/restore')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Restore the access of a reseller',
    description: 'Unblocks the users of a reseller blocked in Rocket for an unpaid invoice and stops the dunning of its unpaid invoices, so they do not block it again. The reseller and the administration are told.'
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The unique identifier of the reseller.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The reseller.',
    type: ResponseResellerDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async restoreAccess(
    @CurrentScope() scope: RequestScope,
    @Param('id') id: string
  ): Promise<ResponseResellerDto> {
    const resellersService = await this._loadResellersService();
    return resellersService.restoreAccess(id, true, scope);
  }

  /**
   * Retrieves the configuration of every commercial tier.
   * @param scope the scope of the requester.
   * @returns the list of tier configurations.
   */
  @Get('tiers')
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Get the commercial tier configurations',
    description: 'Retrieves the yearly fee (first year, second year, from the third on) and the three margins of each commercial tier. These are the values copied onto a reseller contract when it is opened.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tier configurations retrieved successfully.',
    isArray: true,
    type: ResponseResellerTierConfigDto
  })
  async getTierConfigs(@CurrentScope() scope: RequestScope): Promise<ResponseResellerTierConfigDto[]> {
    const resellersService = await this._loadResellersService();
    return resellersService.getTierConfigs(scope);
  }

  /**
   * Writes the configuration of a commercial tier.
   * @param tier the tier to configure.
   * @param config the terms to write.
   * @param scope the scope of the requester.
   * @returns the written configuration.
   */
  @Put('tiers/:tier')
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'Set the configuration of a commercial tier',
    description: 'Writes the yearly fee and the three margins of a commercial tier, creating the row if it is not there yet. A changed fee gets new yearly prices on the Stripe account of Keus. The contracts already opened keep the terms they were given: this changes what the next ones get.'
  })
  @ApiParam({
    name: 'tier',
    description: 'The commercial tier to configure.',
    enum: ResellerTier,
    example: ResellerTier.Gold
  })
  @ApiBody({
    type: UpsertResellerTierConfigDto,
    description: 'The terms to write.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tier configuration written successfully.',
    type: ResponseResellerTierConfigDto
  })
  async upsertTierConfig(
    @Param('tier') tier: ResellerTier,
    @Body() config: UpsertResellerTierConfigDto,
    @CurrentScope() scope: RequestScope
  ): Promise<ResponseResellerTierConfigDto> {
    const resellersService = await this._loadResellersService();
    return resellersService.upsertTierConfig(tier, config, scope);
  }

  /**
   * Lists one page of the resellers visible to the requester.
   * @param scope the request scope.
   * @param query the page and its filters.
   * @return the page of resellers.
   */
  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the resellers',
    description: 'Lists one page of the resellers visible to the requester, filtered by status (every status when none) and by the start of company name and email.'
  })
  @ApiBody({ type: ResellersPageQueryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Page of resellers retrieved successfully.',
    type: ResponseResellersPageDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid page size or cursor.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async listResellers(@CurrentScope() scope: RequestScope, @Body() query: ResellersPageQueryDto): Promise<ResponseResellersPageDto> {
    const resellersService = await this._loadResellersService();
    return resellersService.listResellers(query, scope);
  }

  /**
   * Retrieves a reseller by its ID.
   * @param id the identifier of the reseller to retrieve.
   * @returns the retrieved reseller.
   */
  @Get('id/:id')
  @ApiOperation({
    summary: 'Get a reseller by ID',
    description: 'Retrieves a reseller from the system using its unique identifier.'
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The unique identifier of the reseller to retrieve.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The reseller has been successfully retrieved.',
    type: ResponseResellerDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getReseller(
    @CurrentScope() scope: RequestScope,
    @Param('id') id: string
  ): Promise<ResponseResellerDto> {
    const resellersService = await this._loadResellersService();
    return resellersService.getReseller(id, scope);
  }

  /**
   * Retrieves the direct children (sub-resellers) of a reseller.
   * @param code the code of the parent reseller.
   * @returns the list of direct child resellers.
   */
  @Get('code/:code/children')
  @ApiOperation({
    summary: 'Get the direct sub-resellers of a reseller',
    description: 'Retrieves the resellers created by the reseller identified by the given code.'
  })
  @ApiParam({
    name: 'code',
    type: String,
    description: 'The code of the parent reseller.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of child resellers retrieved successfully.',
    isArray: true,
    type: ResponseResellerDto
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getChildResellers(
    @CurrentScope() scope: RequestScope,
    @Param('code') code: string
  ): Promise<ResponseResellerDto[]> {
    const resellersService = await this._loadResellersService();
    const children = await resellersService.getChildResellers(code, scope);
    return children.map(child => plainToInstance(ResponseResellerDto, child));
  }

  /**
   * Retrieves a reseller by its code.
   * @param code the code of the reseller to retrieve.
   * @returns the retrieved reseller.
   */
  @Get('code/:code')
  @AllowBlockedReseller()
  @ApiOperation({
    summary: 'Get a reseller by code',
    description: 'Retrieves a reseller from the system using its unique code.'
  })
  @ApiParam({
    name: 'code',
    type: String,
    description: 'The unique code of the reseller to retrieve.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The reseller has been successfully retrieved.',
    type: ResponseResellerDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getResellerByCode(
    @CurrentScope() scope: RequestScope,
    @Param('code') code: string
  ): Promise<ResponseResellerDto> {
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getResellerByCode(code, scope);
    if (!reseller) {
      throw new EntityNotFoundException("Reseller", code);
    }
    return plainToInstance(ResponseResellerDto, reseller);
  }

  /**
   * Deletes a reseller by its ID.
   * @param id the identifier of the reseller to delete.
   * @returns void.
   */
  @Delete(':id')
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'Delete a reseller by ID',
    description: 'Deletes a reseller from the system using its unique identifier. Fails if the reseller still has non-archived sub-resellers or a contract in force.'
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'The reseller has been successfully deleted.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The reseller still has non-archived sub-resellers or a contract in force.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async deleteReseller(
    @CurrentScope() scope: RequestScope,
    @Param('id') id: string
  ): Promise<void> {
    const resellersService = await this._loadResellersService();
    return resellersService.deleteReseller(id, scope);
  }
}
