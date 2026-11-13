import { Controller, Get, HttpStatus, Param, UseGuards } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ResponseHubspotDealDto } from "../dtos/response-hubspot-deal.dto";
import { ResponseHubspotDealDetailedDto } from "../dtos/response-hubspot-deal-detailed.dto";
import { ResponseHubspotContactDto } from "../dtos/response-hubspot-contact.dto";
import { ResponseHubspotCompanyDto } from "../dtos/response-hubspot-company.dto";
import { ResponseHubspotLinkDto } from "../dtos/response-hubspot-link.dto";
import { HubspotService } from "../lazy-hubspot/services/hubspot.service";
import { RequiresIntegrations } from "../../../commons/integrations/requires-integrations.decorator";

/**
 * Controller for HubSpot operations.
 * Uses lazy loading to load HubspotService only when needed.
 */
@ApiTags("Hubspot")
@UseGuards(ScopeGuard, RolesGuard)
// Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
@RequiresIntegrations()
@Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice)
@Controller("hubspot")
export class HubspotController {
  /** Lazy-loaded hubspot service */
  private _hubspotService: HubspotService | null = null;

  /**
   * Constructor for HubspotController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /**
   * Lazy loads the HubspotService from its module.
   * @returns A Promise resolving to the HubspotService instance.
   */
  private async _loadHubspotService(): Promise<HubspotService> {
    if (!this._hubspotService) {
      const { HubspotLazyModule } = await import(
        "../lazy-hubspot/hubspot-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => HubspotLazyModule,
      );
      this._hubspotService = moduleRef.get<HubspotService>(HubspotService);
    }
    return this._hubspotService;
  }

  /**
   * Endpoint to get the link that opens the products pipeline on HubSpot.
   * @return the link to the pipeline.
   */
  @Get('deals-link')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting)
  @ApiOperation({
    summary: "Get the link to the products pipeline on HubSpot",
    description: "Builds the link that opens, on HubSpot, the pipeline that holds the deals of every product. Keus admin and accounting, who read the sales metrics."
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Successfully built the link.",
    type: ResponseHubspotLinkDto
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "HubSpot is not configured (HUBSPOT_KEY, HUBSPOT_PRODUCTS_PIPELINE_ID), or the portal could not be read."
  })
  async getDealsPipelineLink(): Promise<ResponseHubspotLinkDto> {
    const hubspotService = await this._loadHubspotService();
    return hubspotService.getDealsPipelineLink();
  }

  /**
   * Endpoint to get HubSpot 'closedwon' Deals.
   * @param productId the product ID, which will be used to retrieve the HubSpot key.
   * @return the 'closedwon' deals from HubSpot.
   */
  @Get('deals/:productId/closedwon')
  @ApiOperation({
    summary: "Get HubSpot 'closedwon' Deals",
    description: "Retrieves 'closedwon' deals from HubSpot."
  })
  @ApiParam({
    name: 'productId',
    type: String,
    description: 'The product ID to retrieve the HubSpot key.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Successfully retrieved 'closedwon' deals from HubSpot.",
    isArray: true,
    type: ResponseHubspotDealDto
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Internal server error."
  })
  async getHubspotClosedWonDeals(@Param('productId') productId: string): Promise<ResponseHubspotDealDto[]> {
    const hubspotService = await this._loadHubspotService();
    return hubspotService.getHubspotClosedWonDeals(productId);
  }

  /**
   * Endpoint to get a single HubSpot deal by ID with detailed information.
   * Includes associated contact and company data for populating contract beneficiary information.
   * @param productId the product ID, which will be used to retrieve the HubSpot key.
   * @param dealId the HubSpot deal ID to retrieve.
   * @return detailed deal information including associations.
   */
  @Get('deals/:productId/:dealId')
  @ApiOperation({
    summary: "Get HubSpot Deal by ID",
    description: "Retrieves a single HubSpot deal with associated contact and company information. Use this to populate contract beneficiary data."
  })
  @ApiParam({
    name: 'productId',
    type: String,
    description: 'The product ID to retrieve the HubSpot key.'
  })
  @ApiParam({
    name: 'dealId',
    type: String,
    description: 'The HubSpot deal ID to retrieve.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Successfully retrieved the HubSpot deal with detailed information.",
    type: ResponseHubspotDealDetailedDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Deal not found."
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Internal server error."
  })
  async getHubspotDealById(
    @Param('productId') productId: string,
    @Param('dealId') dealId: string
  ): Promise<ResponseHubspotDealDetailedDto> {
    const hubspotService = await this._loadHubspotService();
    return hubspotService.getHubspotDealById(productId, dealId);
  }

  /**
   * Endpoint to get a HubSpot contact by ID.
   * @param productId the product ID, which will be used to retrieve the HubSpot key.
   * @param contactId the HubSpot contact ID to retrieve.
   * @return contact information.
   */
  @Get('contacts/:productId/:contactId')
  @ApiOperation({
    summary: "Get HubSpot Contact by ID",
    description: "Retrieves a single HubSpot contact with all available properties."
  })
  @ApiParam({
    name: 'productId',
    type: String,
    description: 'The product ID to retrieve the HubSpot key.'
  })
  @ApiParam({
    name: 'contactId',
    type: String,
    description: 'The HubSpot contact ID to retrieve.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Successfully retrieved the HubSpot contact.",
    type: ResponseHubspotContactDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Contact not found."
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Internal server error."
  })
  async getHubspotContactById(
    @Param('productId') productId: string,
    @Param('contactId') contactId: string
  ): Promise<ResponseHubspotContactDto> {
    const hubspotService = await this._loadHubspotService();
    return hubspotService.getHubspotContactById(productId, contactId);
  }

  /**
   * Endpoint to get a HubSpot company by ID.
   * @param productId the product ID, which will be used to retrieve the HubSpot key.
   * @param companyId the HubSpot company ID to retrieve.
   * @return company information.
   */
  @Get('companies/:productId/:companyId')
  @ApiOperation({
    summary: "Get HubSpot Company by ID",
    description: "Retrieves a single HubSpot company with all available properties including custom fields (VAT, PEC, SDI)."
  })
  @ApiParam({
    name: 'productId',
    type: String,
    description: 'The product ID to retrieve the HubSpot key.'
  })
  @ApiParam({
    name: 'companyId',
    type: String,
    description: 'The HubSpot company ID to retrieve.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Successfully retrieved the HubSpot company.",
    type: ResponseHubspotCompanyDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Company not found."
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Internal server error."
  })
  async getHubspotCompanyById(
    @Param('productId') productId: string,
    @Param('companyId') companyId: string
  ): Promise<ResponseHubspotCompanyDto> {
    const hubspotService = await this._loadHubspotService();
    return hubspotService.getHubspotCompanyById(productId, companyId);
  }
}
