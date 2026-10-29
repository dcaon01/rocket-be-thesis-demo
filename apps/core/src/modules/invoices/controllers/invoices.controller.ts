import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, UseGuards, Post } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { LinkDocumentDto } from "../dtos/link-document.dto";
import { PeriodInvoicesPageQueryDto } from "../dtos/invoices-page-query.dto";
import { KeusSchedulePageQueryDto } from "../dtos/keus-schedule-page-query.dto";
import { ResponseInvoicesPageDto } from "../dtos/response-invoices-page.dto";
import { ResponseSchedulePageDto } from "../dtos/response-schedule-page.dto";
import { ReissueDocumentDto } from "../dtos/reissue-document.dto";
import { PresignedUrlResponseDto } from "../../s3/dtos/presigned-url-response.dto";
import type { InvoicesService } from "../lazy-invoices/services/invoices.service";
import type { ProFormaService } from "../lazy-invoices/services/pro-forma.service";
import { RequiresIntegrations } from "../../../commons/integrations/requires-integrations.decorator";

/**
 * Controller for the invoices.
 * Uses lazy loading to load InvoicesService only when needed.
 */
@ApiTags("Invoices")
@UseGuards(ScopeGuard, RolesGuard)
@Controller("invoices")
export class InvoicesController {
  /** Lazy-loaded invoices service. */
  private _invoicesService: InvoicesService | null = null;

  /** Lazy-loaded pro forma service. */
  private _proFormaService: ProFormaService | null = null;

  /**
   * Constructor for InvoicesController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(private readonly _lazyModuleLoader: LazyModuleLoader) { }

  /**
   * Lazy loads the InvoicesService from its module.
   * @returns a Promise resolving to the InvoicesService instance.
   */
  private async _loadInvoicesService(): Promise<InvoicesService> {
    if (!this._invoicesService) {
      const { InvoicesLazyModule } = await import("../lazy-invoices/invoices-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => InvoicesLazyModule);
      const { InvoicesService } = await import("../lazy-invoices/services/invoices.service");
      this._invoicesService = moduleRef.get<InvoicesService>(InvoicesService);
    }
    return this._invoicesService;
  }

  /**
   * Lazy loads the ProFormaService from the invoices module.
   * @returns a Promise resolving to the ProFormaService instance.
   */
  private async _loadProFormaService(): Promise<ProFormaService> {
    if (!this._proFormaService) {
      const { InvoicesLazyModule } = await import("../lazy-invoices/invoices-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => InvoicesLazyModule);
      const { ProFormaService } = await import("../lazy-invoices/services/pro-forma.service");
      this._proFormaService = moduleRef.get<ProFormaService>(ProFormaService);
    }
    return this._proFormaService;
  }

  /**
   * Lists one page of the invoices issued in a period.
   * @param query the page, the period of issue and the filters.
   * @returns the page of invoices, newest first.
   */
  @Post('search')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting)
  @ApiOperation({ summary: 'List the invoices of a period', description: 'Returns the invoices issued in a period, to companies, resellers and finance companies, newest first, once paid or due: before, they are in the schedule only.' })
  @ApiBody({ type: PeriodInvoicesPageQueryDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'The page of invoices of the period.', type: ResponseInvoicesPageDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The period is not valid or longer than 24 months, or invalid page size or cursor.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async getInvoicesOfPeriod(@Body() query: PeriodInvoicesPageQueryDto): Promise<ResponseInvoicesPageDto> {
    const invoicesService = await this._loadInvoicesService();
    return invoicesService.listInvoicesOfPeriod(query);
  }

  /**
   * Lists one page of the payment schedule of Keus in a period: the payments recorded and the ones expected.
   * @param query the page, the period of the due date and the filters.
   * @returns the page of the schedule, by due date.
   */
  @Post('schedule/search')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting)
  @ApiOperation({ summary: 'List the payment schedule of a period', description: 'Returns the payments that fall due in a period, by due date: the invoices to collect, failed or collected, and the payments expected from the contracts in force that no invoice records yet.' })
  @ApiBody({ type: KeusSchedulePageQueryDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'The page of the schedule in the period.', type: ResponseSchedulePageDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The period is not valid or longer than 24 months, or invalid page size or cursor.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async getScheduleOfPeriod(@Body() query: KeusSchedulePageQueryDto): Promise<ResponseSchedulePageDto> {
    const invoicesService = await this._loadInvoicesService();
    return invoicesService.listScheduleOfPeriod(query);
  }

  /**
   * Signs the download URL of the pro forma of an invoice to a reseller.
   * @param scope the request scope.
   * @param billedPartyId the reseller billed.
   * @param id the invoice ID.
   * @returns the signed URL of the PDF.
   */
  @Get(':billedPartyId/:id/pro-forma')
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({ summary: 'Download the pro forma of an invoice', description: 'Returns a signed URL of the pro forma PDF sent to the reseller with an invoice charged on the 4th. A reseller reaches only its own.' })
  @ApiParam({ name: 'billedPartyId', description: 'The reseller billed.', type: String })
  @ApiParam({ name: 'id', description: 'The unique identifier of the invoice.', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'The signed URL of the pro forma.', type: PresignedUrlResponseDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'The reseller is outside the scope of the requester.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Invoice not found, or without a pro forma.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async getProFormaUrl(
    @CurrentScope() scope: RequestScope,
    @Param('billedPartyId') billedPartyId: string,
    @Param('id') id: string,
  ): Promise<PresignedUrlResponseDto> {
    const proFormaService = await this._loadProFormaService();
    return proFormaService.getProFormaUrl(billedPartyId, id, scope);
  }

  /**
   * Records by hand the payment of an invoice that no Stripe charge collects, such as a bank transfer of a finance company.
   * @param billedPartyId the billed party of the invoice.
   * @param id the invoice ID.
   */
  @Patch(':billedPartyId/:id/paid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Mark an invoice paid',
    description: 'Records the payment of an invoice collected outside Stripe, such as the bank transfer of a finance company, and creates its electronic invoice as a draft at Sibill when it has one.'
  })
  @ApiParam({
    name: 'billedPartyId',
    description: 'The billed party of the invoice.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the invoice.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'The invoice is paid.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The invoice is collected by Stripe or is not open.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Invoice not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async markPaid(
    @Param('billedPartyId') billedPartyId: string,
    @Param('id') id: string,
  ): Promise<void> {
    const invoicesService = await this._loadInvoicesService();
    await invoicesService.markPaid({ billedPartyId, id });
  }

  /**
   * Creates again the draft of the electronic invoice of a paid invoice that Sibill refused, or whose creation was
   * uncertain once the operator checked that Sibill has no document for it.
   * @param billedPartyId the billed party of the invoice.
   * @param id the invoice ID.
   * @param reissueDto whether the operator checked Sibill.
   */
  @Patch(':billedPartyId/:id/document/reissue')
  // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
  @RequiresIntegrations()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Create the electronic invoice again',
    description: 'Creates again as a draft at Sibill the electronic invoice of a paid invoice that was refused (FAILED), or an uncertain one (UNCERTAIN) once Sibill is checked. The outcome is recorded on the invoice.'
  })
  @ApiParam({
    name: 'billedPartyId',
    description: 'The billed party of the invoice.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the invoice.',
    type: String,
  })
  @ApiBody({ type: ReissueDocumentDto })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'The creation was attempted; its outcome is on the invoice.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The invoice is not paid, or its electronic invoice cannot be created again.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Invoice not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async reissueDocument(
    @Param('billedPartyId') billedPartyId: string,
    @Param('id') id: string,
    @Body() reissueDto: ReissueDocumentDto,
  ): Promise<void> {
    const invoicesService = await this._loadInvoicesService();
    await invoicesService.reissueDocument({ billedPartyId, id }, reissueDto.confirmedNotAtSibill === true);
  }

  /**
   * Links to an invoice the document an operator found at Sibill after an uncertain issue.
   * @param billedPartyId the billed party of the invoice.
   * @param id the invoice ID.
   * @param linkDto the document at Sibill.
   */
  @Patch(':billedPartyId/:id/document/link')
  // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
  @RequiresIntegrations()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.KeusAdmin, UserRole.KeusAccounting)
  @ApiOperation({
    summary: 'Link the electronic invoice found at Sibill',
    description: 'Records on an uncertain invoice the document found at Sibill, with its number and state.'
  })
  @ApiParam({
    name: 'billedPartyId',
    description: 'The billed party of the invoice.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the invoice.',
    type: String,
  })
  @ApiBody({ type: LinkDocumentDto })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'The document is linked.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The invoice is not uncertain.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Invoice not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async linkDocument(
    @Param('billedPartyId') billedPartyId: string,
    @Param('id') id: string,
    @Body() linkDto: LinkDocumentDto,
  ): Promise<void> {
    const invoicesService = await this._loadInvoicesService();
    await invoicesService.linkDocument({ billedPartyId, id }, linkDto.sibillId);
  }
}
