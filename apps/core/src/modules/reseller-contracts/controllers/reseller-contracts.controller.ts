import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Put, UseGuards, HttpCode } from "@nestjs/common";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CreateResellerContractDto } from "../dtos/create-reseller-contract.dto";
import { ResponseResellerContractDto } from "../dtos/response-reseller-contract.dto";
import { AllowBlockedReseller } from "../../../commons/scoping/allow-blocked-reseller.decorator";
import { ResponseResellerAccessDto } from "../dtos/response-reseller-access.dto";
import { ResellerContractsPageQueryDto } from "../dtos/reseller-contracts-page-query.dto";
import { ResponseResellerContractsPageDto } from "../dtos/response-reseller-contracts-page.dto";
import { UpdateResellerContractDto } from "../dtos/update-reseller-contract.dto";
import { PresignedUrlResponseDto } from "../../s3/dtos/presigned-url-response.dto";
import { ResellerContractsService } from "../lazy-reseller-contracts/services/reseller-contracts.service";
import { RequiresIntegrations } from "../../../commons/integrations/requires-integrations.decorator";

/**
 * Controller for the contracts between Keus and its resellers, nested under the reseller.
 * Uses lazy loading to load ResellerContractsService only when needed.
 */
@ApiTags("Reseller contracts")
@UseGuards(ScopeGuard, RolesGuard)
@Controller("reseller-contracts")
export class ResellerContractsController {
  /** Lazy-loaded reseller contracts service. */
  private _resellerContractsService: ResellerContractsService | null = null;

  /**
   * Constructor for ResellerContractsController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /**
   * Lazy loads the ResellerContractsService from its module.
   * @returns a Promise resolving to the ResellerContractsService instance.
   */
  private async _loadResellerContractsService(): Promise<ResellerContractsService> {
    if (!this._resellerContractsService) {
      const { ResellerContractsLazyModule } = await import(
        "../lazy-reseller-contracts/reseller-contracts-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ResellerContractsLazyModule,
      );
      this._resellerContractsService = moduleRef.get<ResellerContractsService>(ResellerContractsService);
    }
    return this._resellerContractsService;
  }

  /**
   * Lists one page of the contracts of every reseller.
   * @param scope the scope of the requester.
   * @param query the page and its filters.
   * @returns the page of reseller contracts.
   */
  @Post('search')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'List the contracts of every reseller',
    description: 'Lists one page of the contracts Keus has opened with a reseller, filtered by status (every status when none), tier and the start of contract code, reseller name or reseller code.'
  })
  @ApiBody({ type: ResellerContractsPageQueryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The page of reseller contracts.',
    type: ResponseResellerContractsPageDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid page size or cursor.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async listContracts(@CurrentScope() scope: RequestScope, @Body() query: ResellerContractsPageQueryDto): Promise<ResponseResellerContractsPageDto> {
    const resellerContractsService = await this._loadResellerContractsService();
    return resellerContractsService.listContracts(query, scope);
  }

  /**
   * Retrieves the contracts of a reseller.
   * @param scope the scope of the requester.
   * @param resellerId the identifier of the reseller.
   * @returns the contracts, the newest start date first.
   */
  @Get('reseller/:resellerId')
  @ApiOperation({
    summary: 'Get the contracts of a reseller',
    description: 'Retrieves the contracts Keus has opened with the reseller, the newest start date first.'
  })
  @ApiParam({
    name: 'resellerId',
    type: String,
    description: 'The identifier of the reseller.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The contracts have been successfully retrieved.',
    isArray: true,
    type: ResponseResellerContractDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getContracts(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string
  ): Promise<ResponseResellerContractDto[]> {
    const resellerContractsService = await this._loadResellerContractsService();
    return resellerContractsService.getContracts(resellerId, scope);
  }

  /**
   * Retrieves the contract in force of a reseller.
   * @param scope the scope of the requester.
   * @param resellerId the identifier of the reseller.
   * @returns the contract in force.
   */
  @Get('reseller/:resellerId/in-force')
  // The Keus back office does not read the economic terms of a reseller.
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusAccounting, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({
    summary: 'Get the contract in force of a reseller',
    description: 'Retrieves the contract whose fee and margins currently apply to the reseller.'
  })
  @ApiParam({
    name: 'resellerId',
    type: String,
    description: 'The identifier of the reseller.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The contract in force has been successfully retrieved.',
    type: ResponseResellerContractDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The reseller has no contract in force.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getContractInForce(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string
  ): Promise<ResponseResellerContractDto> {
    const resellerContractsService = await this._loadResellerContractsService();
    return resellerContractsService.getContractInForce(resellerId, scope);
  }

  /**
   * Tells whether the users of a reseller can work in Rocket, and what the activation of its contract waits for.
   * @param scope the scope of the requester.
   * @param resellerId the identifier of the reseller.
   * @returns the access state, with the fee and the mandates of the contract being activated.
   */
  @Get('reseller/:resellerId/access')
  @AllowBlockedReseller()
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.KeusAccounting, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({
    summary: 'Get the access state of a reseller',
    description: 'Tells whether the users of the reseller can work in Rocket: no contract, a contract being activated, active, or ended. While a contract is being activated it lists its first fee and the mandate of each product, with the checkout links for the admin of the reseller.'
  })
  @ApiParam({
    name: 'resellerId',
    type: String,
    description: 'The identifier of the reseller.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The access state has been successfully retrieved.',
    type: ResponseResellerAccessDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getAccess(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string
  ): Promise<ResponseResellerAccessDto> {
    const resellerContractsService = await this._loadResellerContractsService();
    return resellerContractsService.getAccess(resellerId, scope);
  }

  /**
   * Opens a contract with a reseller from its partner tier.
   * @param scope the scope of the requester.
   * @param resellerId the identifier of the reseller.
   * @param contractDto the tier and the terms negotiated apart from it.
   * @returns the contract created, as a DRAFT.
   */
  @Post('reseller/:resellerId')
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales)
  @ApiOperation({
    summary: 'Open a contract with a reseller',
    description: 'Creates a DRAFT contract from the partner tier: the yearly fee, its Stripe prices and the margins. With a contract in force the new one starts at its renewal.'
  })
  @ApiParam({
    name: 'resellerId',
    type: String,
    description: 'The identifier of the reseller.'
  })
  @ApiBody({
    type: CreateResellerContractDto,
    description: 'The tier and the terms negotiated apart from it.'
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The contract has been successfully created.',
    type: ResponseResellerContractDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The tier is not configured, or another contract is waiting to start.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async createContract(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Body() contractDto: CreateResellerContractDto
  ): Promise<ResponseResellerContractDto> {
    const resellerContractsService = await this._loadResellerContractsService();
    return resellerContractsService.createContract(resellerId, contractDto, scope);
  }

  /**
   * Retrieves a contract of a reseller.
   * @param scope the scope of the requester.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @returns the contract.
   */
  @Get('reseller/:resellerId/contract/:id')
  @ApiOperation({
    summary: 'Get a reseller contract',
    description: 'Retrieves a contract of the reseller by its identifier.'
  })
  @ApiParam({
    name: 'resellerId',
    type: String,
    description: 'The identifier of the reseller.'
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The identifier of the contract.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The contract has been successfully retrieved.',
    type: ResponseResellerContractDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller or contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getContract(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Param('id') id: string
  ): Promise<ResponseResellerContractDto> {
    const resellerContractsService = await this._loadResellerContractsService();
    return resellerContractsService.getContract(resellerId, id, scope);
  }

  /**
   * Generates the document of a draft contract from the RESELLER_CONTRACT template.
   * @param scope the scope of the requester.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @returns the signed URL of the PDF.
   */
  @Get('reseller/:resellerId/contract/:id/document')
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Generate the document of a draft contract',
    description: 'Fills the reseller contract template in force with the data of the DRAFT contract, renders it to PDF and returns a signed download URL. Keus admin, sales (own resellers) and accounting only.'
  })
  @ApiParam({
    name: 'resellerId',
    type: String,
    description: 'The identifier of the reseller.'
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The identifier of the contract.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The document has been generated.',
    type: PresignedUrlResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The contract is not a draft, or no reseller contract template is published.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reseller or contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getContractDocument(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Param('id') id: string
  ): Promise<PresignedUrlResponseDto> {
    const resellerContractsService = await this._loadResellerContractsService();
    return resellerContractsService.getContractDocumentUrl(resellerId, id, scope);
  }

  /**
   * Generates the checkout that collects the SEPA mandate of a reseller on the account of a product of its contract.
   * @param scope the scope of the requester.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract, the one in force.
   * @param accountKey the product whose Stripe account collects.
   * @returns the contract with the checkout link.
   */
  @Post('reseller/:resellerId/contract/:id/mandate-checkout/:accountKey')
  // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
  @RequiresIntegrations()
  @AllowBlockedReseller()
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting, UserRole.ResellerOwner)
  @ApiOperation({
    summary: 'Generate the mandate checkout of a reseller contract',
    description: 'Creates a Stripe checkout that only collects the SEPA mandate of the reseller on the account of a product its contract enables, from its signing; an unexpired one is kept. The mandate belongs to the contract and ends with it. The admin of the reseller opens it on its own contract.'
  })
  @ApiParam({ name: 'resellerId', type: String, description: 'The identifier of the reseller.' })
  @ApiParam({ name: 'id', type: String, description: 'The identifier of the contract, the one in force.' })
  @ApiParam({ name: 'accountKey', type: String, description: 'The product whose Stripe account collects.' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'The contract with the checkout link.', type: ResponseResellerContractDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The contract is not the one in force, does not enable the product, or already has the mandate.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Reseller or contract not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async createMandateCheckout(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Param('id') id: string,
    @Param('accountKey') accountKey: string
  ): Promise<ResponseResellerContractDto> {
    const resellerContractsService = await this._loadResellerContractsService();
    return resellerContractsService.createMandateCheckout(resellerId, id, accountKey, scope);
  }

  /**
   * Updates a reseller contract: a status change, or the terms of a DRAFT.
   * @param scope the scope of the requester.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @param contractDto the change to apply.
   * @returns the updated contract.
   */
  @Put('reseller/:resellerId/contract/:id')
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Update a reseller contract',
    description: 'Changes the status of the contract (sign, end at renewal, reactivate, end), or the terms and the signed agreement of a DRAFT.'
  })
  @ApiParam({
    name: 'resellerId',
    type: String,
    description: 'The identifier of the reseller.'
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The identifier of the contract.'
  })
  @ApiBody({
    type: UpdateResellerContractDto,
    description: 'The change to apply.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The contract has been successfully updated.',
    type: ResponseResellerContractDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The transition is not allowed, or the terms are frozen.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async updateContract(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Param('id') id: string,
    @Body() contractDto: UpdateResellerContractDto
  ): Promise<ResponseResellerContractDto> {
    const resellerContractsService = await this._loadResellerContractsService();
    return resellerContractsService.updateContract(resellerId, id, contractDto, scope);
  }

  /**
   * Refreshes the expired checkout session of a signed reseller contract.
   * @param scope the scope of the requester.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @returns the contract with the new checkout session.
   */
  @Patch('reseller/:resellerId/contract/:id/refresh-checkout')
  // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
  @RequiresIntegrations()
  @AllowBlockedReseller()
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting, UserRole.ResellerOwner)
  @ApiOperation({
    summary: 'Refresh the checkout of a reseller contract',
    description: 'Creates a new Stripe checkout session for a SIGNED contract whose session has expired. The admin of the reseller refreshes it on its own contract.'
  })
  @ApiParam({
    name: 'resellerId',
    type: String,
    description: 'The identifier of the reseller.'
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The identifier of the contract.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The checkout session has been refreshed.',
    type: ResponseResellerContractDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The contract is not SIGNED, or its session is still valid.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async refreshCheckoutSession(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Param('id') id: string
  ): Promise<ResponseResellerContractDto> {
    const resellerContractsService = await this._loadResellerContractsService();
    return resellerContractsService.refreshCheckoutSession(resellerId, id, scope);
  }

  /**
   * Deletes a DRAFT reseller contract.
   * @param scope the scope of the requester.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   */
  @Delete('reseller/:resellerId/contract/:id')
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales)
  @ApiOperation({
    summary: 'Delete a reseller contract',
    description: 'Deletes a DRAFT contract. A signed contract ends instead.'
  })
  @ApiParam({
    name: 'resellerId',
    type: String,
    description: 'The identifier of the reseller.'
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The identifier of the contract.'
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'The contract has been successfully deleted.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The contract is past DRAFT.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async deleteContract(
    @CurrentScope() scope: RequestScope,
    @Param('resellerId') resellerId: string,
    @Param('id') id: string
  ): Promise<void> {
    const resellerContractsService = await this._loadResellerContractsService();
    return resellerContractsService.deleteContract(resellerId, id, scope);
  }
}
