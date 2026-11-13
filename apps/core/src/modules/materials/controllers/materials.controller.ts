import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Put, UseGuards, HttpCode } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { CreateMaterialDto } from "../dtos/create-material.dto";
import { AvailableMaterialsPageQueryDto } from "../dtos/available-materials-page-query.dto";
import { MaterialsPageQueryDto } from "../dtos/materials-page-query.dto";
import { ResponseMaterialDto } from "../dtos/response-material.dto";
import { ResponseMaterialsPageDto } from "../dtos/response-materials-page.dto";
import { UpdateMaterialDto } from "../dtos/update-material.dto";
import { MaterialsService } from "../lazy-materials/services/materials.service";

/**
 * Controller for managing the commercial materials offered to the resale network.
 * Uses lazy loading to load MaterialsService only when needed.
 */
@ApiTags("Materials")
@UseGuards(ScopeGuard, RolesGuard)
@Controller("materials")
export class MaterialsController {
  /** Lazy-loaded materials service */
  private _materialsService: MaterialsService | null = null;

  /**
   * Constructor for MaterialsController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /**
   * Lazy loads the MaterialsService from its module.
   * @returns A Promise resolving to the MaterialsService instance.
   */
  private async _loadMaterialsService(): Promise<MaterialsService> {
    if (!this._materialsService) {
      const { MaterialsLazyModule } = await import(
        "../lazy-materials/materials-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => MaterialsLazyModule,
      );
      this._materialsService = moduleRef.get<MaterialsService>(MaterialsService);
    }
    return this._materialsService;
  }

  /**
   * Creates a material in DRAFT.
   * @param materialDto the material data.
   * @returns the created material.
   */
  @Post()
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({ summary: "Create a material", description: "Creates a material in DRAFT. The file is attached afterwards with an update; a link comes with the creation." })
  @ApiBody({ type: CreateMaterialDto, description: "The material data to create." })
  @ApiResponse({ status: HttpStatus.CREATED, description: "The material has been successfully created.", type: ResponseMaterialDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "A link was given to a material that is not a link." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async createMaterial(
    @Body() materialDto: CreateMaterialDto,
  ): Promise<ResponseMaterialDto> {
    const materialsService = await this._loadMaterialsService();
    return materialsService.createMaterial(materialDto);
  }

  /**
   * Lists one page of the catalogue.
   * @param query the page and its filters.
   * @returns the page of materials, newest first.
   */
  @Post("search")
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice)
  @ApiOperation({ summary: "List the materials", description: "Lists one page of the catalogue, newest first, filtered by status (every status when none), type, product, tier and the start of the title." })
  @ApiBody({ type: MaterialsPageQueryDto })
  @ApiResponse({ status: HttpStatus.OK, description: "Materials retrieved successfully.", type: ResponseMaterialsPageDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Invalid page size or cursor." })
  async listMaterials(@Body() query: MaterialsPageQueryDto): Promise<ResponseMaterialsPageDto> {
    const materialsService = await this._loadMaterialsService();
    return materialsService.listMaterials(query);
  }

  /**
   * Lists one page of the materials a reseller can see.
   * @param scope the request scope.
   * @param query the page and its filters, with the product, tier and reseller to preview.
   * @returns the page of published materials assigned to that product and tier.
   */
  @Post("available/search")
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({
    summary: "List the available materials",
    description: "Lists one page of the published materials assigned to the given product and reseller tier, filtered by type and the start of the title. A reseller only gets its own tier and the products it is enabled to sell."
  })
  @ApiBody({ type: AvailableMaterialsPageQueryDto })
  @ApiResponse({ status: HttpStatus.OK, description: "Materials retrieved successfully.", type: ResponseMaterialsPageDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Invalid page size or cursor." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "The reseller to preview does not exist." })
  async listAvailableMaterials(
    @CurrentScope() scope: RequestScope,
    @Body() query: AvailableMaterialsPageQueryDto,
  ): Promise<ResponseMaterialsPageDto> {
    const materialsService = await this._loadMaterialsService();
    return materialsService.listAvailableMaterials(query, scope);
  }

  /**
   * Retrieves a material by its identifier.
   * @param id the identifier of the material.
   * @returns the material.
   */
  @Get(":id")
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice)
  @ApiOperation({
    summary: "Get a material",
    description: "Retrieves a single material, whatever its state. Reserved to Keus: resellers read the published ones from /available."
  })
  @ApiParam({ name: "id", description: "Identifier of the material." })
  @ApiResponse({ status: HttpStatus.OK, description: "Material retrieved successfully.", type: ResponseMaterialDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Material not found." })
  async getMaterial(
    @Param("id") id: string,
  ): Promise<ResponseMaterialDto> {
    const materialsService = await this._loadMaterialsService();
    return materialsService.getMaterial(id);
  }

  /**
   * Updates a material.
   * @param id the identifier of the material.
   * @param materialDto the data to apply.
   * @returns the updated material.
   */
  @Put(":id")
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({ summary: "Update a material", description: "Updates a material in any state. Attaching a file reads its type and size from S3 and deletes the replaced one." })
  @ApiParam({ name: "id", description: "Identifier of the material." })
  @ApiBody({ type: UpdateMaterialDto, description: "The data to apply." })
  @ApiResponse({ status: HttpStatus.OK, description: "Material updated successfully.", type: ResponseMaterialDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The file does not belong to the material, or does not match its type." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Material or uploaded file not found." })
  async updateMaterial(
    @Param("id") id: string,
    @Body() materialDto: UpdateMaterialDto,
  ): Promise<ResponseMaterialDto> {
    const materialsService = await this._loadMaterialsService();
    return materialsService.updateMaterial(id, materialDto);
  }

  /**
   * Publishes a material.
   * @param id the identifier of the material.
   * @returns the published material.
   */
  @Patch(":id/publish")
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({ summary: "Publish a material", description: "Makes a draft or withdrawn material visible to the resellers it is assigned to." })
  @ApiParam({ name: "id", description: "Identifier of the material." })
  @ApiResponse({ status: HttpStatus.OK, description: "Material published successfully.", type: ResponseMaterialDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Already published, or missing its file or link." })
  async publishMaterial(
    @Param("id") id: string,
  ): Promise<ResponseMaterialDto> {
    const materialsService = await this._loadMaterialsService();
    return materialsService.publishMaterial(id);
  }

  /**
   * Withdraws a material from the resellers' view.
   * @param id the identifier of the material.
   * @returns the withdrawn material.
   */
  @Patch(":id/withdraw")
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({ summary: "Withdraw a material", description: "Removes a published material from the resellers' view, keeping it on the Keus side." })
  @ApiParam({ name: "id", description: "Identifier of the material." })
  @ApiResponse({ status: HttpStatus.OK, description: "Material withdrawn successfully.", type: ResponseMaterialDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The material is not published." })
  async withdrawMaterial(
    @Param("id") id: string,
  ): Promise<ResponseMaterialDto> {
    const materialsService = await this._loadMaterialsService();
    return materialsService.withdrawMaterial(id);
  }

  /**
   * Deletes a material.
   * @param id the identifier of the material.
   */
  @Delete(":id")
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({ summary: "Delete a material", description: "Deletes a material that is not published, together with its file." })
  @ApiParam({ name: "id", description: "Identifier of the material." })
  @ApiResponse({ status: HttpStatus.OK, description: "Material deleted successfully." })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The material is published." })
  async deleteMaterial(
    @Param("id") id: string,
  ): Promise<void> {
    const materialsService = await this._loadMaterialsService();
    return materialsService.deleteMaterial(id);
  }
}
