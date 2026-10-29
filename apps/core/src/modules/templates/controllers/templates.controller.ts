import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Put, Query, UseGuards, HttpCode } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { CreateTemplateDto } from "../dtos/create-template.dto";
import { ResponsePlaceholderCatalogDto } from "../dtos/response-placeholder-catalog.dto";
import { ResponseTemplateDto } from "../dtos/response-template.dto";
import { ResponseTemplatesPageDto } from "../dtos/response-templates-page.dto";
import { TemplatesPageQueryDto } from "../dtos/templates-page-query.dto";
import { UpdateTemplateDto } from "../dtos/update-template.dto";
import { TemplateType } from "../enums/template-type.enum";
import { TemplatesService } from "../lazy-templates/services/templates.service";

/** Profiles that read the templates: the Keus ones, and the sellers of a reseller for the offer templates only (UR-RK-013). */
const TEMPLATE_READER_ROLES = [
  UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice,
  UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales,
];

/**
 * Controller for managing document templates: written by the Keus admin, read by Keus only.
 * Uses lazy loading to load TemplatesService only when needed.
 */
@ApiTags("Templates")
@UseGuards(ScopeGuard, RolesGuard)
@Controller("templates")
export class TemplatesController {
  /** Lazy-loaded templates service */
  private _templatesService: TemplatesService | null = null;

  /**
   * Constructor for TemplatesController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /**
   * Lazy loads the TemplatesService from its module.
   * @returns A Promise resolving to the TemplatesService instance.
   */
  private async _loadTemplatesService(): Promise<TemplatesService> {
    if (!this._templatesService) {
      const { TemplatesLazyModule } = await import(
        "../lazy-templates/templates-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => TemplatesLazyModule,
      );
      this._templatesService = moduleRef.get<TemplatesService>(TemplatesService);
    }
    return this._templatesService;
  }

  /**
   * Creates a template in DRAFT.
   * @param templateDto the template data.
   * @returns the created template.
   */
  @Post()
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({ summary: "Create a template", description: "Creates a template in DRAFT, bound to its channel or to the whole platform. The format follows from type and channel." })
  @ApiBody({ type: CreateTemplateDto, description: "The template data to create." })
  @ApiResponse({ status: HttpStatus.CREATED, description: "The template has been successfully created.", type: ResponseTemplateDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The scope does not match the type, or the content does not match the format." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async createTemplate(
    @Body() templateDto: CreateTemplateDto,
  ): Promise<ResponseTemplateDto> {
    const templatesService = await this._loadTemplatesService();
    return templatesService.createTemplate(templateDto);
  }

  /**
   * Resolves the template in force for a scope.
   * @param scope the request scope.
   * @param type the type of template to resolve.
   * @param channel the channel, for the offer templates.
   * @returns the published template, or null when none is in force.
   */
  @Get("resolve")
  @Roles(...TEMPLATE_READER_ROLES)
  @ApiOperation({
    summary: "Resolve the template in force",
    description: "Returns the published template for the given scope, or null when none is in force."
  })
  @ApiQuery({ name: "type", enum: TemplateType, required: true })
  @ApiQuery({ name: "channel", enum: SalesChannel, required: false })
  @ApiResponse({ status: HttpStatus.OK, description: "Template resolved successfully.", type: ResponseTemplateDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: "A reseller asked for another template than the offer of the indirect channel, or for a draft." })
  async resolveTemplate(
    @CurrentScope() scope: RequestScope,
    @Query("type") type: TemplateType,
    @Query("channel") channel?: SalesChannel,
  ): Promise<ResponseTemplateDto | null> {
    const templatesService = await this._loadTemplatesService();
    return templatesService.resolveTemplate(type, channel, scope);
  }

  /**
   * Retrieves the placeholders a template scope may use.
   * @param scope the request scope.
   * @param type the type of template.
   * @param channel the channel, for the offer templates.
   * @returns the placeholder catalog of the scope.
   */
  @Get("placeholders")
  @Roles(...TEMPLATE_READER_ROLES)
  @ApiOperation({
    summary: "Get the placeholder catalog",
    description: "Returns the placeholders and lists a template scope may use, with the format that decides the loop syntax."
  })
  @ApiQuery({ name: "type", enum: TemplateType, required: true })
  @ApiQuery({ name: "channel", enum: SalesChannel, required: false })
  @ApiResponse({ status: HttpStatus.OK, description: "Catalog retrieved successfully.", type: ResponsePlaceholderCatalogDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The scope does not match the type." })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: "A reseller asked for another template than the offer of the indirect channel, or for a draft." })
  async getPlaceholderCatalog(
    @CurrentScope() scope: RequestScope,
    @Query("type") type: TemplateType,
    @Query("channel") channel?: SalesChannel,
  ): Promise<ResponsePlaceholderCatalogDto> {
    const templatesService = await this._loadTemplatesService();
    return templatesService.getPlaceholderCatalog(type, channel, scope);
  }

  /**
   * Lists one page of the templates.
   * @param query the page and its filters.
   * @returns the page of templates.
   */
  @Post("search")
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice)
  @ApiOperation({ summary: "List the templates", description: "Lists one page of the templates, filtered by type (every type when none), status (every status when none) and the start of the name." })
  @ApiBody({ type: TemplatesPageQueryDto })
  @ApiResponse({ status: HttpStatus.OK, description: "Templates retrieved successfully.", type: ResponseTemplatesPageDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Invalid page size or cursor." })
  async listTemplates(@Body() query: TemplatesPageQueryDto): Promise<ResponseTemplatesPageDto> {
    const templatesService = await this._loadTemplatesService();
    return templatesService.listTemplates(query);
  }

  /**
   * Retrieves a template by its type and identifier.
   * @param scope the request scope.
   * @param type the type of the template.
   * @param id the identifier of the template.
   * @returns the template.
   */
  @Get(":type/:id")
  @Roles(...TEMPLATE_READER_ROLES)
  @ApiOperation({ summary: "Get a template", description: "Retrieves a single template." })
  @ApiParam({ name: "type", enum: TemplateType })
  @ApiParam({ name: "id", description: "Identifier of the template." })
  @ApiResponse({ status: HttpStatus.OK, description: "Template retrieved successfully.", type: ResponseTemplateDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Template not found." })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: "A reseller asked for another template than the offer of the indirect channel, or for a draft." })
  async getTemplate(
    @CurrentScope() scope: RequestScope,
    @Param("type") type: TemplateType,
    @Param("id") id: string,
  ): Promise<ResponseTemplateDto> {
    const templatesService = await this._loadTemplatesService();
    return templatesService.getTemplate(type, id, scope);
  }

  /**
   * Updates a draft template.
   * @param type the type of the template.
   * @param id the identifier of the template.
   * @param templateDto the data to apply.
   * @returns the updated template.
   */
  @Put(":type/:id")
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({ summary: "Update a template", description: "Updates a draft template. A DOCX source must be uploaded first under templates/{id}/source.docx." })
  @ApiParam({ name: "type", enum: TemplateType })
  @ApiParam({ name: "id", description: "Identifier of the template." })
  @ApiBody({ type: UpdateTemplateDto, description: "The data to apply." })
  @ApiResponse({ status: HttpStatus.OK, description: "Template updated successfully.", type: ResponseTemplateDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The template is not a draft, the content does not match its format, or it uses unknown placeholders." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Template or uploaded source not found." })
  async updateTemplate(
    @Param("type") type: TemplateType,
    @Param("id") id: string,
    @Body() templateDto: UpdateTemplateDto,
  ): Promise<ResponseTemplateDto> {
    const templatesService = await this._loadTemplatesService();
    return templatesService.updateTemplate(type, id, templateDto);
  }

  /**
   * Publishes a template, withdrawing the one in force for its scope.
   * @param type the type of the template.
   * @param id the identifier of the template.
   * @returns the published template.
   */
  @Patch(":type/:id/publish")
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: "Publish a template",
    description: "Publishes the template and withdraws the one currently in force for its scope."
  })
  @ApiParam({ name: "type", enum: TemplateType })
  @ApiParam({ name: "id", description: "Identifier of the template." })
  @ApiResponse({ status: HttpStatus.OK, description: "Template published successfully.", type: ResponseTemplateDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Already published, missing its content, using no placeholder, or published concurrently." })
  async publishTemplate(
    @Param("type") type: TemplateType,
    @Param("id") id: string,
  ): Promise<ResponseTemplateDto> {
    const templatesService = await this._loadTemplatesService();
    return templatesService.publishTemplate(type, id);
  }

  /**
   * Withdraws a published template.
   * @param type the type of the template.
   * @param id the identifier of the template.
   * @returns the withdrawn template.
   */
  @Patch(":type/:id/withdraw")
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({ summary: "Withdraw a template", description: "Withdraws a published template, leaving its scope without one in force. The contract in force is replaced, never withdrawn." })
  @ApiParam({ name: "type", enum: TemplateType })
  @ApiParam({ name: "id", description: "Identifier of the template." })
  @ApiResponse({ status: HttpStatus.OK, description: "Template withdrawn successfully.", type: ResponseTemplateDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The template is not published, or is the contract in force." })
  async withdrawTemplate(
    @Param("type") type: TemplateType,
    @Param("id") id: string,
  ): Promise<ResponseTemplateDto> {
    const templatesService = await this._loadTemplatesService();
    return templatesService.withdrawTemplate(type, id);
  }

  /**
   * Creates a draft copy of a template.
   * @param type the type of the template.
   * @param id the identifier of the template to copy.
   * @returns the new draft.
   */
  @Post(":type/:id/duplicate")
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({ summary: "Duplicate a template", description: "Creates a draft copy with the same scope, content and DOCX source: the way to change a published template." })
  @ApiParam({ name: "type", enum: TemplateType })
  @ApiParam({ name: "id", description: "Identifier of the template to copy." })
  @ApiResponse({ status: HttpStatus.CREATED, description: "Template duplicated successfully.", type: ResponseTemplateDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Template not found." })
  async duplicateTemplate(
    @Param("type") type: TemplateType,
    @Param("id") id: string,
  ): Promise<ResponseTemplateDto> {
    const templatesService = await this._loadTemplatesService();
    return templatesService.duplicateTemplate(type, id);
  }

  /**
   * Deletes a draft template.
   * @param type the type of the template.
   * @param id the identifier of the template.
   */
  @Delete(":type/:id")
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({ summary: "Delete a template", description: "Deletes a draft template and its DOCX source. A published or withdrawn one is part of the documents' history." })
  @ApiParam({ name: "type", enum: TemplateType })
  @ApiParam({ name: "id", description: "Identifier of the template." })
  @ApiResponse({ status: HttpStatus.OK, description: "Template deleted successfully." })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The template is not a draft." })
  async deleteTemplate(
    @Param("type") type: TemplateType,
    @Param("id") id: string,
  ): Promise<void> {
    const templatesService = await this._loadTemplatesService();
    return templatesService.deleteTemplate(type, id);
  }
}
