import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Put, UseGuards, HttpCode } from "@nestjs/common";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CreateCompanyDto } from "../dtos/create-company.dto";
import { ResponseCompanyDto } from "../dtos/response-company.dto";
import { CompaniesPageQueryDto } from "../dtos/companies-page-query.dto";
import { ResponseCompaniesPageDto } from "../dtos/response-companies-page.dto";
import { UpdateCompanyDto } from "../dtos/update-company.dto";
import { TransferCompanyDto } from "../dtos/transfer-company.dto";
import { CompaniesService } from "../lazy-companies/services/companies.service";

/**
 * Controller for managing companies.
 * Uses lazy loading to load CompaniesService only when needed.
 */
@ApiTags("Companies")
@UseGuards(ScopeGuard, RolesGuard)
@Controller("companies")
export class CompaniesController {
  /** Lazy-loaded companies service */
  private _companiesService: CompaniesService | null = null;

  /**
   * Constructor for CompaniesController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /**
   * Lazy loads the CompaniesService from its module.
   * @returns A Promise resolving to the CompaniesService instance.
   */
  private async _loadCompaniesService(): Promise<CompaniesService> {
    if (!this._companiesService) {
      const { CompaniesLazyModule } = await import(
        "../lazy-companies/companies-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => CompaniesLazyModule,
      );
      this._companiesService = moduleRef.get<CompaniesService>(CompaniesService);
    }
    return this._companiesService;
  }

  /**
   * Creates a new Company.
   * @param companyDto the DTO with the information to create a new company.
   * @returns the created company.
   */
  @Post()
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({
    summary: "Create a new company",
    description: "Creates a new company in the system."
  })
  @ApiBody({
    type: CreateCompanyDto,
    description: "The company data to create."
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "The company has been successfully created.",
    type: ResponseCompanyDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid input data."
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Internal server error."
  })
  async createCompany(
    @CurrentScope() scope: RequestScope,
    @Body() companyDto: CreateCompanyDto
  ): Promise<ResponseCompanyDto> {
    const companiesService = await this._loadCompaniesService();
    return companiesService.createCompany(companyDto, scope);
  }

  /**
   * Updates an existing company.
   * @param id the identifier of the company
   * @param companyDto the data to update the company with.
   * @returns the updated company.
   */
  @Put(':id')
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({
    summary: 'Update an existing company',
    description: 'Updates the details of an existing company by its ID.'
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The unique identifier of the company to update.'
  })
  @ApiBody({
    type: UpdateCompanyDto,
    description: 'The company data to update.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The company has been successfully updated.',
    type: ResponseCompanyDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Company not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async updateCompany(
    @CurrentScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() companyDto: UpdateCompanyDto
  ): Promise<ResponseCompanyDto> {
    const companiesService = await this._loadCompaniesService();
    return companiesService.updateCompany(id, companyDto, scope);
  }

  /**
   * Transfers a company of an inactive reseller to another active reseller, or to Keus.
   * @param scope the request scope.
   * @param id the identifier of the company.
   * @param transferDto the reseller the company moves to, or the plans of the direct contracts towards Keus.
   * @returns the company on its new channel.
   */
  @Post(':id/transfer')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'Transfer a company to another reseller or to Keus',
    description: 'Moves a company of an inactive reseller, with its contracts in force, tenants, users and documents. Towards an active reseller that sells the products of those contracts, the contracts move as they are. Towards Keus (no resellerId), each contract is terminated and taken over on the same tenant by a direct contract with the plan and discount of its line, charged from the end of the period the reseller paid. The open orders of the old reseller are cancelled; issued invoices stay with it. A retry after a failure completes the transfer.'
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The unique identifier of the company to transfer.'
  })
  @ApiBody({ type: TransferCompanyDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The company has been transferred.',
    type: ResponseCompanyDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The company is not on an inactive reseller, the target is not active or does not sell a product of the contracts, a contract is terminating, an order is still being provisioned, or towards Keus the fiscal data, the IBAN, a plan or a referent are missing.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Company or reseller not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async transferCompany(
    @CurrentScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() transferDto: TransferCompanyDto
  ): Promise<ResponseCompanyDto> {
    const companiesService = await this._loadCompaniesService();
    return companiesService.transferCompany(id, transferDto, scope);
  }

  /**
   * Lists one page of the companies visible to the requester.
   * @param scope the request scope.
   * @param query the page and its filters.
   * @return the page of companies.
   */
  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the companies',
    description: 'Lists one page of the companies visible to the requester, filtered by status (every status when none) and by the start of name or VAT number and of email.'
  })
  @ApiBody({ type: CompaniesPageQueryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Page of companies retrieved successfully.',
    type: ResponseCompaniesPageDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid page size or cursor.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async listCompanies(@CurrentScope() scope: RequestScope, @Body() query: CompaniesPageQueryDto): Promise<ResponseCompaniesPageDto> {
    const companiesService = await this._loadCompaniesService();
    return companiesService.listCompanies(query, scope);
  }

  /**
   * Retrieves a company by its ID.
   * @param id the identifier of the company to retrieve.
   * @returns the retrieved company.
   */
  @Get('id/:id')
  @ApiOperation({
    summary: 'Get a company by ID',
    description: 'Retrieves a company from the system using its unique identifier.'
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The unique identifier of the company to retrieve.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The company has been successfully retrieved.',
    type: ResponseCompanyDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Company not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getCompany(
    @CurrentScope() scope: RequestScope,
    @Param('id') id: string
  ): Promise<ResponseCompanyDto> {
    const companiesService = await this._loadCompaniesService();
    return companiesService.getCompany(id, scope);
  }

  /**
   * Deletes a company by its ID.
   * @param id the identifier of the company to delete.
   * @returns void.
   */
  @Delete(':id')
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'Delete a company by ID',
    description: 'Deletes a company from the system using its unique identifier.'
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'The company has been successfully deleted.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async deleteCompany(
    @CurrentScope() scope: RequestScope,
    @Param('id') id: string
  ): Promise<void> {
    const companiesService = await this._loadCompaniesService();
    return companiesService.deleteCompany(id, scope);
  }
}
