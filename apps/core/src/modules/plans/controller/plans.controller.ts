import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
  HttpCode,
} from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CreatePlanDto } from "../dtos/create-plan.dto";
import { PlansPageQueryDto } from "../dtos/plans-page-query.dto";
import { ResponsePlansPageDto } from "../dtos/response-plans-page.dto";
import { ResponsePlanDto } from "../dtos/response-plan.dto";
import { UpdatePlanDto } from "../dtos/update-plan.dto";
import { PlansService } from "../lazy-plans/services/plans.service";

/**
 * Controller for managing plans nested under their owning product.
 * Uses lazy loading to load PlansService only when needed.
 */
@ApiTags("Plans")
@UseGuards(ScopeGuard, RolesGuard)
@Controller("products/:productId/plans")
export class PlansController {
  /** Lazy-loaded plans service. */
  private _plansService: PlansService | null = null;

  /**
   * Constructor for PlansController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /**
   * Lazy loads the PlansService from its module.
   * @returns a Promise resolving to the PlansService instance.
   */
  private async _loadPlansService(): Promise<PlansService> {
    if (!this._plansService) {
      const { PlansLazyModule } = await import(
        "../lazy-plans/plans-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => PlansLazyModule,
      );
      this._plansService = moduleRef.get<PlansService>(PlansService);
    }
    return this._plansService;
  }

  /**
   * Creates a new plan for the given product.
   * @param productId the identifier of the product that owns the plan.
   * @param planDto the DTO with the information to create a new plan.
   * @returns the created plan.
   */
  @Post()
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: "Create a new plan",
    description: "Creates a new plan attached to the given product.",
  })
  @ApiParam({
    name: "productId",
    type: String,
    description: "The unique identifier of the owning product.",
  })
  @ApiBody({
    type: CreatePlanDto,
    description: "The plan data to create.",
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "The plan has been successfully created.",
    type: ResponsePlanDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid input data.",
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Internal server error.",
  })
  async createPlan(
    @Param("productId") productId: string,
    @Body() planDto: CreatePlanDto
  ): Promise<ResponsePlanDto> {
    const plansService = await this._loadPlansService();
    return plansService.createPlan(productId, planDto);
  }

  /**
   * Updates an existing plan.
   * @param productId the identifier of the product that owns the plan.
   * @param id the identifier of the plan to update.
   * @param planDto the data to update the plan with.
   * @returns the updated plan.
   */
  @Put(":id")
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: "Update an existing plan",
    description: "Updates the details of an existing plan by its ID.",
  })
  @ApiParam({
    name: "productId",
    type: String,
    description: "The unique identifier of the owning product.",
  })
  @ApiParam({
    name: "id",
    type: String,
    description: "The unique identifier of the plan to update.",
  })
  @ApiBody({
    type: UpdatePlanDto,
    description: "The plan data to update.",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "The plan has been successfully updated.",
    type: ResponsePlanDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Plan not found.",
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Internal server error.",
  })
  async updatePlan(
    @Param("productId") productId: string,
    @Param("id") id: string,
    @Body() planDto: UpdatePlanDto
  ): Promise<ResponsePlanDto> {
    const plansService = await this._loadPlansService();
    return plansService.updatePlan(productId, id, planDto);
  }

  /**
   * Lists one page of the plans attached to a given product.
   * @param productId the identifier of the product whose plans are listed.
   * @param query the page and its filters.
   * @returns the page of plans for the product.
   */
  @Post("search")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "List the plans of a product",
    description: "Lists one page of the plans attached to the given product, filtered by status (every status when none) and by the start of the name.",
  })
  @ApiParam({
    name: "productId",
    type: String,
    description: "The unique identifier of the owning product.",
  })
  @ApiBody({ type: PlansPageQueryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Page of plans retrieved successfully.",
    type: ResponsePlansPageDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid page size or cursor.",
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Internal server error.",
  })
  async listPlans(
    @CurrentScope() scope: RequestScope,
    @Param("productId") productId: string,
    @Body() query: PlansPageQueryDto,
  ): Promise<ResponsePlansPageDto> {
    const plansService = await this._loadPlansService();
    return plansService.listPlans(productId, query, scope);
  }

  /**
   * Retrieves a plan by its ID.
   * @param productId the identifier of the product that owns the plan.
   * @param id the identifier of the plan to retrieve.
   * @returns the retrieved plan.
   */
  @Get(":id")
  @ApiOperation({
    summary: "Get a plan by ID",
    description: "Retrieves a plan from the given product by its unique identifier.",
  })
  @ApiParam({
    name: "productId",
    type: String,
    description: "The unique identifier of the owning product.",
  })
  @ApiParam({
    name: "id",
    type: String,
    description: "The unique identifier of the plan to retrieve.",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "The plan has been successfully retrieved.",
    type: ResponsePlanDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Plan not found.",
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Internal server error.",
  })
  async getPlan(
    @CurrentScope() scope: RequestScope,
    @Param("productId") productId: string,
    @Param("id") id: string
  ): Promise<ResponsePlanDto> {
    const plansService = await this._loadPlansService();
    return plansService.getPlan(productId, id, scope);
  }

  /**
   * Deletes a plan by its ID.
   * @param productId the identifier of the product that owns the plan.
   * @param id the identifier of the plan to delete.
   */
  @Delete(":id")
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: "Delete a plan by ID",
    description: "Deletes a plan from the given product by its unique identifier.",
  })
  @ApiParam({
    name: "productId",
    type: String,
    description: "The unique identifier of the owning product.",
  })
  @ApiParam({
    name: "id",
    type: String,
    description: "The unique identifier of the plan to delete.",
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: "The plan has been successfully deleted.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Plan not found.",
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Internal server error.",
  })
  async deletePlan(
    @Param("productId") productId: string,
    @Param("id") id: string
  ): Promise<void> {
    const plansService = await this._loadPlansService();
    return plansService.deletePlan(productId, id);
  }
}
