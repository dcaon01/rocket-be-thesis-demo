import { Controller, Get, HttpStatus, Param, Patch, Post, UseGuards, Body, HttpCode } from "@nestjs/common";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PresignedUrlResponseDto } from "../../s3/dtos/presigned-url-response.dto";
import { ContractsPageQueryDto } from '../dtos/contracts-page-query.dto';
import { ResponseContractsPageDto } from '../dtos/response-contracts-page.dto';
import { ResponseContractDto } from "../dtos/response-contract.dto";
import { PostponeSuspensionDto } from "../dtos/postpone-suspension.dto";
import { ContractsService } from "../lazy-contracts/services/contracts.service";
import { RequiresIntegrations } from "../../../commons/integrations/requires-integrations.decorator";

/**
 * Controller for managing contracts.
 * Uses lazy loading to load ContractsService only when needed.
 */
@ApiTags("Contracts")
@UseGuards(ScopeGuard, RolesGuard)
@Controller("contracts")
export class ContractsController {
  /** Lazy-loaded contracts service */
  private _contractsService: ContractsService | null = null;

  /**
   * Constructor for ContractsController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /**
   * Lazy loads the ContractsService from its module.
   * @returns A Promise resolving to the ContractsService instance.
   */
  private async _loadContractsService(): Promise<ContractsService> {
    if (!this._contractsService) {
      const { ContractsLazyModule } = await import(
        "../lazy-contracts/contracts-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ContractsLazyModule,
      );
      this._contractsService = moduleRef.get<ContractsService>(ContractsService);
    }
    return this._contractsService;
  }

  /**
   * Lists one page of the contracts of a product.
   * @param productId the product ID to filter contracts by.
   * @param query the page and its filters.
   * @returns the page of contracts of the product.
   */
  @Post('product/:productId/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the contracts of a product',
    description: 'Lists one page of the contracts of a product, filtered by status (every status when none), by the start of code or company name and by a period on the start, renewal or termination date.'
  })
  @ApiParam({
    name: 'productId',
    type: String,
    description: 'The ID of the product to filter contracts by.'
  })
  @ApiBody({ type: ContractsPageQueryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of contracts associated with the specified product.',
    type: ResponseContractsPageDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No contracts found for the specified product.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async listContracts(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Body() query: ContractsPageQueryDto,
  ): Promise<ResponseContractsPageDto> {
    const contractsService = await this._loadContractsService();
    return contractsService.listContracts(productId, query, scope);
  }

  /**
   * Retrieves all contracts.
   * @returns all contracts.
   */
  @Get('all')
  @ApiOperation({
    summary: 'Get all contracts',
    description: 'Retrieves a list of all contracts in the system.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'A list of all contracts.',
    isArray: true,
    type: ResponseContractDto
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getAllContracts(@CurrentScope() scope: RequestScope): Promise<ResponseContractDto[]> {
    const contractsService = await this._loadContractsService();
    return contractsService.getAllContracts(scope);
  }

  /**
   * Retrieves a contract by its ID.
   * @param productId the product ID to filter contracts by.
   * @param id the identifier of the contract.
   * @returns the contract with the specified ID.
   */
  @Get('product/:productId/contract/:id')
  @ApiOperation({
    summary: 'Get contract by ID',
    description: 'Retrieves a contract by its unique identifier.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the contract.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The contract has been successfully retrieved.',
    type: ResponseContractDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getContract(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseContractDto> {
    const contractsService = await this._loadContractsService();
    return contractsService.getContractDetail(productId, id, scope);
  }

  /**
   * Signs a link to the document of a contract.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @returns the signed URL of the document.
   */
  @Get('product/:productId/contract/:id/document')
  @ApiOperation({
    summary: 'Get the document of a contract',
    description: 'Signs a short-lived link to the document generated when the contract was created.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the contract.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The signed URL of the document.',
    type: PresignedUrlResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getDocumentUrl(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<PresignedUrlResponseDto> {
    const contractsService = await this._loadContractsService();
    return contractsService.getDocumentUrl(productId, id, scope);
  }

  /**
   * Generates the checkout that collects the SEPA mandate and starts the subscription, or keeps the one still valid.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @returns the contract with the checkout link.
   */
  @Post('product/:productId/contract/:id/checkout')
  // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
  @RequiresIntegrations()
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Generate the checkout of a contract',
    description: 'Creates the hosted Stripe checkout that collects the SEPA mandate of the company and starts the subscription of the contract; one still valid is kept.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the contract.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The contract with the checkout link.',
    type: ResponseContractDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The contract is terminated, not charged to the company, or the company already has a mandate.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async createMandateCheckout(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseContractDto> {
    const contractsService = await this._loadContractsService();
    return contractsService.createMandateCheckout(productId, id, scope);
  }

  /**
   * Retrieves the contracts of a company, terminated ones included.
   * @param companyId the company of the contracts.
   * @returns the contracts of the company.
   */
  @Get('company/:companyId')
  @ApiOperation({
    summary: 'Get contracts by company',
    description: 'Retrieves the contracts of a company on every product, terminated ones included.'
  })
  @ApiParam({
    name: 'companyId',
    type: String,
    description: 'The ID of the company.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The contracts of the company.',
    isArray: true,
    type: ResponseContractDto
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getContractsByCompany(
    @CurrentScope() scope: RequestScope,
    @Param('companyId') companyId: string
  ): Promise<ResponseContractDto[]> {
    const contractsService = await this._loadContractsService();
    return contractsService.getContractsByCompany(companyId, scope);
  }

  /**
   * Records the cancellation of a contract.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @returns the updated contract.
   */
  @Patch('product/:productId/contract/:id/terminate')
  @Roles(
    UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.KeusAccounting,
    UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales,
  )
  @ApiOperation({
    summary: 'Cancel a contract',
    description: 'Records the cancellation: the contract ends at its renewal, or at the following one within the notice period. A reseller cancels the contracts of its own customers, a reseller salesperson those of the orders it opened, a Keus salesperson only those of the direct orders it opened.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the contract.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The updated contract.',
    type: ResponseContractDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The contract is not in a status that allows the operation.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async terminateAtRenewal(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseContractDto> {
    const contractsService = await this._loadContractsService();
    return contractsService.terminateAtRenewal(productId, id, scope);
  }

  /**
   * Withdraws the cancellation of a contract.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @returns the updated contract.
   */
  @Patch('product/:productId/contract/:id/withdraw-termination')
  @Roles(
    UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.KeusAccounting,
    UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales,
  )
  @ApiOperation({
    summary: 'Withdraw a cancellation',
    description: 'Withdraws the cancellation: the contract renews as usual. A reseller withdraws on the contracts of its own customers, a reseller salesperson on those of the orders it opened, a Keus salesperson only on the direct orders it opened.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the contract.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The updated contract.',
    type: ResponseContractDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The contract is not in a status that allows the operation.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async withdrawTermination(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseContractDto> {
    const contractsService = await this._loadContractsService();
    return contractsService.withdrawTermination(productId, id, scope);
  }

  /**
   * Terminates a contract at once.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @returns the updated contract.
   */
  @Patch('product/:productId/contract/:id/terminate-now')
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'Terminate a contract now',
    description: 'Ends the contract at once: the charge stops and the tenant loses access.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the contract.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The updated contract.',
    type: ResponseContractDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The contract is not in a status that allows the operation.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async terminateNow(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseContractDto> {
    const contractsService = await this._loadContractsService();
    return contractsService.terminateNow(productId, id, scope);
  }

  /**
   * Suspends the access of a contract by hand, before the fifteenth day of an unpaid invoice.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @returns the contract.
   */
  @Patch('product/:productId/contract/:id/access/suspend')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Suspend the access of a contract',
    description: 'Deactivates the users of the tenant; the contract stays in force. The company and the administration are told. A tenant already inactive is left as it is.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the contract.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The contract.',
    type: ResponseContractDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async suspendAccess(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseContractDto> {
    const contractsService = await this._loadContractsService();
    return contractsService.suspendAccess(productId, id, undefined, scope);
  }

  /**
   * Restores by hand the access of a contract suspended for an unpaid invoice, as for an agreed payment.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @returns the contract.
   */
  @Patch('product/:productId/contract/:id/access/restore')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Restore the access of a contract',
    description: 'Reactivates the users of a tenant suspended for an unpaid invoice and stops the dunning of the unpaid invoices of the contract. The company and the administration are told.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the contract.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The contract.',
    type: ResponseContractDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async restoreAccess(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseContractDto> {
    const contractsService = await this._loadContractsService();
    return contractsService.restoreAccess(productId, id, true, scope);
  }

  /**
   * Postpones the suspension of the access of a contract to a date.
   * @param productId the product of the contract.
   * @param id the contract ID.
   * @param body the date the suspension waits for.
   * @returns the updated contract.
   */
  @Patch('product/:productId/contract/:id/access/postpone')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Postpone the suspension of a contract',
    description: 'The fifteenth day of the dunning of an unpaid invoice waits for the date given, on this contract only.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the contract.',
    type: String,
  })
  @ApiBody({ type: PostponeSuspensionDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The updated contract.',
    type: ResponseContractDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The date is not valid, or the contract is no longer in force.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contract not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async postponeSuspension(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
    @Body() body: PostponeSuspensionDto,
  ): Promise<ResponseContractDto> {
    const contractsService = await this._loadContractsService();
    return contractsService.postponeSuspension(productId, id, body.until, scope);
  }
}
