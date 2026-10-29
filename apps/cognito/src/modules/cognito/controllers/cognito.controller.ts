import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LazyModuleLoader } from '@nestjs/core';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentScope, Roles, RolesGuard, ScopeGuard, UserRole, isUnrestricted, RequestScope } from '@rocket-be/scoping';
import { plainToInstance } from 'class-transformer';
import { MessageResponseDto } from '../../../commons/dtos/message-response.dto';
import { CollaboratorResponseDto } from '../dtos/collaborator-response.dto';
import { CognitoUserCreateDto } from '../dtos/cognito-user-create.dto';
import { CognitoUserResponseDto } from '../dtos/cognito-user-response.dto';
import { CognitoUserUpdateDto } from '../dtos/cognito-user-update.dto';
import { CognitoUsersPageQueryDto } from '../dtos/cognito-users-page-query.dto';
import { CognitoUsersPageResponseDto } from '../dtos/cognito-users-page-response.dto';
import { CognitoManagementService } from '../lazy-cognito/services/cognito-management.service';
import { CollaboratorsService } from '../lazy-cognito/services/collaborators.service';

/**
 * Controller for managing AWS Cognito operations.
 * Provides endpoints for user management in AWS Cognito.
 */
@ApiTags('Cognito')
@UseGuards(ScopeGuard, RolesGuard)
@Controller('cognito')
export class CognitoController {
  /** Lazy-loaded cognito management service */
  private _cognitoManagementService: CognitoManagementService | null = null;

  /** Lazy-loaded collaborators service */
  private _collaboratorsService: CollaboratorsService | null = null;

  /**
   * Constructor for CognitoController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) {}

  /**
   * Lazy loads the CognitoManagementService from its module.
   * @returns A Promise resolving to the CognitoManagementService instance.
   */
  private async _loadCognitoManagementService(): Promise<CognitoManagementService> {
    if (!this._cognitoManagementService) {
      const { CognitoLazyModule } = await import(
        '../lazy-cognito/cognito-lazy.module'
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => CognitoLazyModule,
      );
      this._cognitoManagementService = moduleRef.get<CognitoManagementService>(CognitoManagementService);
    }
    return this._cognitoManagementService;
  }

  /**
   * Lazy loads the CollaboratorsService from its module.
   * @returns A Promise resolving to the CollaboratorsService instance.
   */
  private async _loadCollaboratorsService(): Promise<CollaboratorsService> {
    if (!this._collaboratorsService) {
      const { CognitoLazyModule } = await import(
        '../lazy-cognito/cognito-lazy.module'
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => CognitoLazyModule,
      );
      this._collaboratorsService = moduleRef.get<CollaboratorsService>(CollaboratorsService);
    }
    return this._collaboratorsService;
  }

  /**
   * Lists the collaborators of a reseller from the projection table, optionally only the ones with a profile.
   * @param code - The code of the reseller.
   * @param group - The profile the collaborators must have, every profile when absent.
   * @returns Array of collaborator records.
   */
  @ApiOperation({ summary: 'Get the collaborators of a reseller', description: 'Lists the collaborators of a reseller from the projection table, optionally only the ones with a profile, such as its salespeople.' })
  @ApiQuery({ name: 'group', description: 'Profile the collaborators must have, every profile when absent.', required: false, enum: UserRole })
  @ApiResponse({
    status: 200,
    description: 'Collaborators retrieved successfully.',
    type: [CollaboratorResponseDto]
  })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiParam({ name: 'code', description: 'The code of the reseller', type: String })
  @Get('collaborators/reseller/:code')
  async getCollaboratorsByReseller(
    @CurrentScope() scope: RequestScope,
    @Param('code') code: string,
    @Query('group') group?: UserRole
  ): Promise<CollaboratorResponseDto[]> {
    // Resellers can only list the collaborators of their own reseller.
    if (!isUnrestricted(scope) && code !== scope.resellerCode) {
      throw new ForbiddenException(`Reseller ${code} is outside the scope of reseller ${scope.resellerCode}.`);
    }
    const collaboratorsService = await this._loadCollaboratorsService();
    const collaborators = await collaboratorsService.getCollaboratorsByReseller(code, group);
    return collaborators.map(collaborator => plainToInstance(CollaboratorResponseDto, collaborator));
  }

  /**
   * Rebuilds the collaborators projection table from the User Pool.
   * The pool is the source of truth: any drift in the table is realigned.
   * @param tenant - The tenant identifier.
   * @returns Message response with the reconcile summary.
   */
  @ApiOperation({ summary: 'Reconcile the collaborators table from the User Pool' })
  @ApiResponse({
    status: 201,
    description: 'Collaborators table reconciled successfully.',
    type: MessageResponseDto
  })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiParam({ name: 'tenant', description: 'The tenant identifier', type: String })
  @Post('collaborators/:tenant/reconcile')
  async reconcileCollaborators(
    @CurrentScope() scope: RequestScope,
    @Param('tenant') tenant: string
  ): Promise<MessageResponseDto> {
    const cognitoManagementService = await this._loadCognitoManagementService();
    return cognitoManagementService.reconcileCollaborators(tenant, scope);
  }

  /**
   * Creates a new user in AWS Cognito and adds them to a group.
   * @param tenant - The tenant identifier.
   * @param dto - Data Transfer Object containing user creation details.
   * @returns The created user information.
   */
  @ApiOperation({ summary: 'Create a new user in AWS Cognito' })
  @ApiResponse({
    status: 201,
    description: 'User created successfully in Cognito.',
    type: CognitoUserResponseDto
  })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid input data.' })
  @ApiResponse({ status: 403, description: 'Only a Keus admin or a reseller owner creates collaborators.' })
  @ApiResponse({ status: 409, description: 'Conflict - User already exists.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiParam({ name: 'tenant', description: 'The tenant identifier', type: String })
  @ApiBody({ type: CognitoUserCreateDto })
  @Roles(UserRole.KeusAdmin, UserRole.ResellerOwner)
  @Put('users/:tenant')
  async createUser(
    @CurrentScope() scope: RequestScope,
    @Param('tenant') tenant: string,
    @Body() dto: CognitoUserCreateDto
  ): Promise<CognitoUserResponseDto> {
    const cognitoManagementService = await this._loadCognitoManagementService();
    return cognitoManagementService.createUserAndAddToGroup(tenant, dto, scope);
  }

  /**
   * Lists one page of the users of the AWS Cognito User Pool.
   * @param scope the request scope.
   * @param _tenant - The tenant identifier, kept for API consistency.
   * @param query the page and its filters.
   * @returns The page of users.
   */
  @ApiOperation({ summary: 'List the users of the AWS Cognito User Pool', description: 'Lists one page of the users, filtered by profile, account type, reseller, enabled state and the start of name and email. A reseller sees only the users of its own reseller.' })
  @ApiBody({ type: CognitoUsersPageQueryDto })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully.',
    type: CognitoUsersPageResponseDto
  })
  @ApiResponse({ status: 400, description: 'Invalid page size or cursor.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiParam({ name: 'tenant', description: 'The tenant identifier', type: String })
  @Post('users/:tenant/search')
  @HttpCode(HttpStatus.OK)
  async listUsers(
    @CurrentScope() scope: RequestScope,
    @Param('tenant') _tenant: string,
    @Body() query: CognitoUsersPageQueryDto,
  ): Promise<CognitoUsersPageResponseDto> {
    const cognitoManagementService = await this._loadCognitoManagementService();
    return cognitoManagementService.listUsersPage(query, scope);
  }

  /**
   * Retrieves a user from AWS Cognito by ID (sub).
   * @param id - The ID (sub) of the user to retrieve.
   * @returns The user information.
   */
  @ApiOperation({ summary: 'Get a user from AWS Cognito by ID (sub)' })
  @ApiResponse({
    status: 200,
    description: 'User retrieved successfully.',
    type: CognitoUserResponseDto
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiParam({ name: 'id', description: 'The ID (sub) of the user', type: String })
  @Get('users/:id')
  async getUser(
    @CurrentScope() scope: RequestScope,
    @Param('id') id: string
  ): Promise<CognitoUserResponseDto> {
    const cognitoManagementService = await this._loadCognitoManagementService();
    return cognitoManagementService.getUser(id, scope);
  }

  /**
   * Deletes a user from AWS Cognito.
   * @param tenant - The tenant identifier.
   * @param id - The ID (sub) of the user to delete.
   * @returns The deleted user information.
   */
  @ApiOperation({ summary: 'Delete a deactivated user from AWS Cognito and the collaborators table' })
  @ApiResponse({
    status: 200,
    description: 'User deleted successfully.',
    type: MessageResponseDto
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ApiResponse({ status: 403, description: 'Only a Keus admin or a reseller owner deletes collaborators, and never their own account.' })
  @ApiResponse({ status: 409, description: 'The user is still active: deactivate it first.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiParam({ name: 'tenant', description: 'The tenant identifier', type: String })
  @ApiParam({ name: 'id', description: 'The ID (sub) of the user to delete', type: String })
  @Roles(UserRole.KeusAdmin, UserRole.ResellerOwner)
  @Delete('users/:tenant/:id')
  async deleteUser(
    @CurrentScope() scope: RequestScope,
    @Param('tenant') tenant: string,
    @Param('id') id: string
  ): Promise<MessageResponseDto> {
    const cognitoManagementService = await this._loadCognitoManagementService();
    return cognitoManagementService.deleteUser(tenant, id, scope);
  }

  /**
   * Enables a user in AWS Cognito.
   * @param tenant - The tenant identifier.
   * @param id - The ID (sub) of the user to enable.
   */
  // @ApiOperation({ summary: 'Enable a user in AWS Cognito' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'User enabled successfully.',
  //   type: MessageResponseDto
  // })
  // @ApiResponse({ status: 404, description: 'User not found.' })
  // @ApiResponse({ status: 500, description: 'Internal server error.' })
  // @ApiParam({ name: 'tenant', description: 'The tenant identifier', type: String })
  // @ApiParam({ name: 'id', description: 'The ID (sub) of the user to enable', type: String })
  // @Patch('users/:tenant/:id/enable')
  // async enableUser(
  //   @Param('tenant') tenant: string,
  //   @Param('id') id: string
  // ): Promise<MessageResponseDto> {
  //   return this._cognitoManagementService.enableUser(tenant, id);
  // }

  /**
   * Disables a user in AWS Cognito.
   * @param tenant - The tenant identifier.
   * @param id - The ID (sub) of the user to disable.
   */
  // @ApiOperation({ summary: 'Disable a user in AWS Cognito' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'User disabled successfully.',
  //   type: MessageResponseDto
  // })
  // @ApiResponse({ status: 404, description: 'User not found.' })
  // @ApiResponse({ status: 500, description: 'Internal server error.' })
  // @ApiParam({ name: 'tenant', description: 'The tenant identifier', type: String })
  // @ApiParam({ name: 'id', description: 'The ID (sub) of the user to disable', type: String })
  // @Patch('users/:tenant/:id/disable')
  // async disableUser(
  //   @Param('tenant') tenant: string,
  //   @Param('id') id: string
  // ): Promise<MessageResponseDto> {
  //   return this._cognitoManagementService.disableUser(tenant, id);
  // }

  /**
   * Resets a user's password in AWS Cognito.
   * @param id - The ID (sub) of the user.
   * @returns The user information after password reset.
   */
  @ApiOperation({ summary: 'Reset user password in AWS Cognito' })
  @ApiResponse({
    status: 200,
    description: 'Password reset initiated successfully.',
    type: CognitoUserResponseDto
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiParam({ name: 'id', description: 'The ID (sub) of the user', type: String })
  @Post('users/:id/reset-password')
  async resetUserPassword(
    @CurrentScope() scope: RequestScope,
    @Param('id') id: string
  ): Promise<MessageResponseDto> {
    const cognitoManagementService = await this._loadCognitoManagementService();
    return cognitoManagementService.resetUserPassword(id, scope);
  }

  /**
   * Changes the Cognito group for a user.
   * @param tenant - The tenant identifier.
   * @param id - The ID of the user.
   * @param dto - Data Transfer Object containing the new Cognito group.
   * @returns The updated user.
   */
  // @ApiOperation({ summary: 'Change Cognito group for a user' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'User Cognito group changed successfully.',
  //   type: MessageResponseDto
  // })
  // @ApiResponse({ status: 404, description: 'User not found.' })
  // @ApiResponse({ status: 500, description: 'Internal server error.' })
  // @ApiParam({ name: 'tenant', description: 'The tenant identifier.', type: String })
  // @ApiParam({ name: 'id', description: 'The ID of the user to update.', type: String })
  // @ApiBody({ type: CognitoChangeGroupDto })
  // @Patch('users/:tenant/:id/change-group')
  // async changeCognitoGroup(
  //   @Param('tenant') tenant: string,
  //   @Param('id') id: string,
  //   @Body() dto: CognitoChangeGroupDto
  // ): Promise<MessageResponseDto> {
  //   return this._cognitoManagementService.changeCognitoGroup(tenant, id, dto);
  // }

  /**
   * Updates a user completely in AWS Cognito and MongoDB.
   * Handles status changes, group changes, and all user fields.
   * @param tenant - The tenant identifier.
   * @param id - The ID (sub) of the user to update.
   * @param dto - Data Transfer Object containing all update fields.
   * @returns The updated user information.
   */
  @ApiOperation({ summary: 'Complete update of a user in AWS Cognito and MongoDB' })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully.',
    type: MessageResponseDto
  })
  @ApiResponse({ status: 403, description: 'Only a Keus admin or a reseller owner updates collaborators, and never their own account.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiParam({ name: 'tenant', description: 'The tenant identifier', type: String })
  @ApiParam({ name: 'id', description: 'The ID (sub) of the user to update', type: String })
  @ApiBody({ type: CognitoUserUpdateDto })
  @Roles(UserRole.KeusAdmin, UserRole.ResellerOwner)
  @Patch('users/:tenant/:id')
  async updateUser(
    @CurrentScope() scope: RequestScope,
    @Param('tenant') tenant: string,
    @Param('id') id: string,
    @Body() dto: CognitoUserUpdateDto
  ): Promise<MessageResponseDto> {
    const cognitoManagementService = await this._loadCognitoManagementService();
    return cognitoManagementService.updateUser(tenant, id, dto, scope);
  }
}