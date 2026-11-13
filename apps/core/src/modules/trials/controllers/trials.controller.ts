import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Put, UseGuards, HttpCode } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { CreateTrialDto } from "../dtos/create-trial.dto";
import { TrialsPageQueryDto } from '../dtos/trials-page-query.dto';
import { ResponseTrialsPageDto } from '../dtos/response-trials-page.dto';
import { ResponseTrialDto } from "../dtos/response-trial.dto";
import { UpdateTrialDto } from "../dtos/update-trial.dto";
import { TrialsService } from "../lazy-trials/services/trials.service";

/**
 * Controller for managing trials.
 * Uses lazy loading to load TrialsService only when needed.
 */
@ApiTags("Trials")
@Controller("trials")
@UseGuards(ScopeGuard, RolesGuard)
export class TrialsController {
  /** Lazy-loaded trials service */
  private _trialsService: TrialsService | null = null;

  /**
   * Constructor for TrialsController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /**
   * Lazy loads the TrialsService from its module.
   * @returns A Promise resolving to the TrialsService instance.
   */
  private async _loadTrialsService(): Promise<TrialsService> {
    if (!this._trialsService) {
      const { TrialsLazyModule } = await import(
        "../lazy-trials/trials-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => TrialsLazyModule,
      );
      this._trialsService = moduleRef.get<TrialsService>(TrialsService);
    }
    return this._trialsService;
  }

  /**
   * Creates a new trial.
   * @param trialDto the DTO with the information to create a new trial.
   * @returns the created trial.
   */
  @Post()
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerSales)
  @ApiOperation({
    summary: "Create a new trial",
    description: "Creates a new trial in the system."
  })
  @ApiBody({
    type: CreateTrialDto
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "The trial has been successfully created.",
    type: ResponseTrialDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid input data."
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Internal server error."
  })
  async createTrial(
    @CurrentScope() scope: RequestScope,
    @Body() trialDto: CreateTrialDto
  ): Promise<ResponseTrialDto> {
    const trialsService = await this._loadTrialsService();
    return trialsService.createTrial(trialDto, scope);
  }

  /**
   * Lists one page of the trials of a product.
   * @param productId the product ID to filter trials by.
   * @param query the page and its filters.
   * @returns the page of trials of the product.
   */
  @Post('product/:productId/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the trials of a product',
    description: 'Lists one page of the trials of a product, filtered by status (every status when none), by the start of the associated email and by a period on the activation or expiry date.'
  })
  @ApiParam({
    name: 'productId',
    type: String,
    description: 'The ID of the product to filter trials by.'
  })
  @ApiBody({ type: TrialsPageQueryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of trials associated with the specified product.',
    type: ResponseTrialsPageDto
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async listTrials(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Body() query: TrialsPageQueryDto,
  ): Promise<ResponseTrialsPageDto> {
    const trialsService = await this._loadTrialsService();
    return trialsService.listTrials(productId, query, scope);
  }

  /**
   * Retrieves all trials.
   * @returns all trials.
   */
  @Get('all')
  @ApiOperation({
    summary: 'Get all trials',
    description: 'Retrieves a list of all trials in the system.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'A list of all trials.',
    isArray: true,
    type: ResponseTrialDto
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getAllTrials(
    @CurrentScope() scope: RequestScope,
  ): Promise<ResponseTrialDto[]> {
    const trialsService = await this._loadTrialsService();
    return trialsService.getAllTrials(scope);
  }

  /**
   * Retrieves a trial by its ID.
   * @param productId the product ID to filter trials by.
   * @param id the identifier of the trial.
   * @returns the trial with the specified ID.
   */
  @Get('product/:productId/trial/:id')
  @ApiOperation({
    summary: 'Get trial by ID',
    description: 'Retrieves a trial by its unique identifier.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the trial.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The trial has been successfully retrieved.',
    type: ResponseTrialDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Trial not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getTrial(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseTrialDto> {
    const trialsService = await this._loadTrialsService();
    return trialsService.getTrial(productId, id, scope);
  }

  /**
   * Updates the specified trial.
   * @param productId the product ID to filter trials by.
   * @param id the identifier of the trial.
   * @param trialDto the information to update the trial.
   * @returns the updated trial.
   */
  @Put('product/:productId/trial/:id')
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerSales)
  @ApiOperation({
    summary: 'Update trial by ID',
    description: 'Updates a trial by its unique identifier.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the trial.',
    type: String,
  })
  @ApiBody({
    type: UpdateTrialDto
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The trial has been successfully updated.',
    type: ResponseTrialDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Trial not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async updateTrial(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
    @Body() trialDto: UpdateTrialDto
  ): Promise<ResponseTrialDto> {
    const trialsService = await this._loadTrialsService();
    return trialsService.updateTrial(productId, id, trialDto, scope);
  }

  /**
   * Deletes a specified trial.
   * @param productId the product ID to filter trials by.
   * @param id the identifier of the trial.
   */
  @Delete('product/:productId/trial/:id')
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice)
  @ApiOperation({
    summary: 'Delete trial by ID',
    description: 'Deletes a trial by its unique identifier.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The product ID.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the trial.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'The trial has been successfully deleted.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Trial not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async deleteTrial(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string
  ): Promise<void> {
    const trialsService = await this._loadTrialsService();
    return trialsService.deleteTrial(productId, id, scope);
  }
}
