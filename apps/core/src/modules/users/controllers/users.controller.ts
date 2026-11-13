import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Put, UseGuards, HttpCode } from "@nestjs/common";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CreateUserDto } from "../dtos/create-user.dto";
import { UsersPageQueryDto } from '../dtos/users-page-query.dto';
import { ResponseUsersPageDto } from '../dtos/response-users-page.dto';
import { ResponseUserDto } from "../dtos/response-user.dto";
import { UpdateUserDto } from "../dtos/update-user.dto";
import { UsersService } from "../lazy-users/services/users.service";
import { ResponsePendingOperationDto } from "../../pending-operations/dtos/response-pending-operation.dto";

/**
 * Controller for managing users.
 * Uses lazy loading to load UsersService only when needed.
 */
@ApiTags('Users')
@UseGuards(ScopeGuard, RolesGuard)
@Controller('users')
export class UsersController {
  /** Lazy-loaded users service */
  private _usersService: UsersService | null = null;

  /**
   * Constructor for UsersController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /**
   * Lazy loads the UsersService from its module.
   * @returns A Promise resolving to the UsersService instance.
   */
  private async _loadUsersService(): Promise<UsersService> {
    if (!this._usersService) {
      const { UsersLazyModule } = await import(
        "../lazy-users/users-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => UsersLazyModule,
      );
      this._usersService = moduleRef.get<UsersService>(UsersService);
    }
    return this._usersService;
  }

  /**
   * Creates a new user.
   * @param user the DTO with the information to create a new user.
   * @returns the created user.
   */
  @Post()
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({
    summary: 'Request a new user',
    description: 'Writes the user in REQUESTED on an active tenant and asks the product to create it; the product\'s answer moves it to ACTIVE or FAILED.'
  })
  @ApiBody({
    type: CreateUserDto
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The user has been requested to the product.',
    type: ResponseUserDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Related entity not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async createUser(
    @CurrentScope() scope: RequestScope,
    @Body() user: CreateUserDto
  ): Promise<ResponseUserDto> {
    const usersService = await this._loadUsersService();
    return usersService.notifyCreateUser(user, scope);
  }

  /**
   * Sends a user request to the product again.
   * @param productId the identifier of the product.
   * @param id the identifier of the user.
   * @returns the user, waiting for the product again.
   */
  @Patch('product/:productId/user/:id/resend')
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice)
  @ApiOperation({
    summary: 'Send a user request again',
    description: 'Sends again the open operation of a user (creation, change or deletion), reopening it if the product answered with an error.'
  })
  @ApiParam({ name: 'productId', description: 'The product ID.' })
  @ApiParam({ name: 'id', description: 'The unique identifier of the user.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The request has been sent again.', type: ResponseUserDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The user is not requested, or its tenant is not confirmed yet.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async resendUserRequest(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseUserDto> {
    const usersService = await this._loadUsersService();
    return usersService.resendUserRequest(productId, id, scope);
  }

  /**
   * Discards a user request the product answered with an error.
   * @param productId the identifier of the product.
   * @param id the identifier of the user.
   * @returns the cancelled user.
   */
  @Patch('product/:productId/user/:id/cancel')
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice)
  @ApiOperation({
    summary: 'Discard a user request',
    description: 'Discards an operation of the user the product answered with an error: a discarded creation marks it CANCELLED, a discarded change or deletion leaves it as it is. An operation without an answer cannot be discarded, only sent again.'
  })
  @ApiParam({ name: 'productId', description: 'The product ID.' })
  @ApiParam({ name: 'id', description: 'The unique identifier of the user.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The request has been discarded.', type: ResponseUserDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The product has not answered the request with an error, or the user changed meanwhile.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async cancelUserRequest(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponseUserDto> {
    const usersService = await this._loadUsersService();
    return usersService.cancelUserRequest(productId, id, scope);
  }

  /**
   * Lists the operations sent to the product for a user: its history.
   * @param productId the identifier of the product.
   * @param id the identifier of the user.
   * @returns the operations, newest first.
   */
  @Get('product/:productId/user/:id/operations')
  @ApiOperation({
    summary: 'List the operations of a user',
    description: 'Lists, newest first, the operations Rocket sent to the product for the user, with their state, attempts and last error.'
  })
  @ApiParam({ name: 'productId', description: 'The product ID.' })
  @ApiParam({ name: 'id', description: 'The unique identifier of the user.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The operations of the user.', type: [ResponsePendingOperationDto] })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async listUserOperations(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<ResponsePendingOperationDto[]> {
    const usersService = await this._loadUsersService();
    return usersService.listUserOperations(productId, id, scope);
  }

  /**
   * Gets a user by its ID.
   * @param productId the identifier of the product the user belongs to.
   * @param id the identifier of the user to get.
   * @returns the user with the specified ID.
   */
  @Get('product/:productId/user/:id')
  @ApiOperation({
    summary: 'Get user by ID',
    description: 'Retrieves a user by its unique identifier.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The identifier of the product the user belongs to.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the user.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The user has been successfully retrieved.',
    type: ResponseUserDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getUser(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string
  ): Promise<ResponseUserDto> {
    const usersService = await this._loadUsersService();
    return usersService.getUser(productId, id, scope);
  }

  /**
   * Retrieves the users of a company: those of its tenants on every product.
   * @param companyId the company of the users.
   * @returns the users of the company.
   */
  @Get('company/:companyId')
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({
    summary: 'Get users by company',
    description: 'Retrieves the users of the tenants of a company on every product.'
  })
  @ApiParam({ name: 'companyId', type: String, description: 'The ID of the company.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The users of the company.', isArray: true, type: ResponseUserDto })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async getUsersByCompany(
    @CurrentScope() scope: RequestScope,
    @Param('companyId') companyId: string,
  ): Promise<ResponseUserDto[]> {
    const usersService = await this._loadUsersService();
    return usersService.getUsersByCompany(companyId, scope);
  }

  /**
   * Lists one page of the users of a product.
   * @param productId identifier of the product.
   * @param query the page and its filters.
   * @returns the page of users of the product.
   */
  @Post('product/:productId/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the users of a product',
    description: 'Lists one page of the users of a product, filtered by status (every status when none), by the start of name, surname or email and by the start of the tenant name.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The identifier of the product to filter users by.',
    type: String,
  })
  @ApiBody({ type: UsersPageQueryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The users have been successfully retrieved.',
    type: ResponseUsersPageDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Product not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async listUsers(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Body() query: UsersPageQueryDto,
  ): Promise<ResponseUsersPageDto> {
    const usersService = await this._loadUsersService();
    return usersService.listUsers(productId, query, scope);
  }


  /**
   * Updates a user by its ID.
   * @param productId the identifier of the product the user belongs to.
   * @param id the identifier of the user to update.
   * @param user the DTO with the information to update the user.
   * @returns the updated user.
   */
  @Put('product/:productId/user/:id')
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice)
  @ApiOperation({
    summary: 'Update user',
    description: 'Updates a user by its unique identifier and product he\'s user.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The identifier of the product the user belongs to.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the user.',
    type: String,
  })
  @ApiBody({
    type: UpdateUserDto
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The change has been asked to the product; it lands when the product confirms it.',
    type: ResponseUserDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async updateUser(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
    @Body() user: UpdateUserDto
  ): Promise<ResponseUserDto> {
    const usersService = await this._loadUsersService();
    await usersService.assertUserOnProduct(productId, id, scope);
    return usersService.requestUserUpdate(productId, id, user, scope);
  }

  /**
   * Deletes a user by its ID.
   * @param productId identifier of the product of the user.
   * @param id the identifier of the user to delete.
   */
  @Delete('product/:productId/user/:id')
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice)
  @ApiOperation({
    summary: 'Delete user',
    description: 'Deletes a user by its unique identifier and product he\'s user.'
  })
  @ApiParam({
    name: 'productId',
    description: 'The identifier of the product the user belongs to.',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the user.',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The deletion has been asked to the product.',
    type: ResponseUserDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async deleteUser(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string
  ): Promise<ResponseUserDto> {
    const usersService = await this._loadUsersService();
    await usersService.assertUserOnProduct(productId, id, scope);
    return usersService.requestUserDelete(productId, id, scope);
  }

  /**
   * Removes for good a user deleted on the product, or a discarded request.
   * @param productId the identifier of the product.
   * @param id the identifier of the user.
   */
  @Delete('product/:productId/user/:id/purge')
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a user for good',
    description: 'Removes a DELETED user, or a CANCELLED request. Its operations stay as history.'
  })
  @ApiParam({ name: 'productId', description: 'The product ID.' })
  @ApiParam({ name: 'id', description: 'The unique identifier of the user.' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'The user has been removed.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The user is neither DELETED nor CANCELLED.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async purgeUser(
    @CurrentScope() scope: RequestScope,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ): Promise<void> {
    const usersService = await this._loadUsersService();
    await usersService.purgeUser(productId, id, scope);
  }
}
