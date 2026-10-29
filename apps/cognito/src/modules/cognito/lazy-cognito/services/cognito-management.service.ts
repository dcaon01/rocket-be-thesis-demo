import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminResetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  AttributeType,
  CognitoIdentityProviderClient,
  DeliveryMediumType,
  InvalidParameterException,
  ListUsersCommand,
  MessageActionType,
  UserNotFoundException,
  UsernameExistsException,
  UserType
} from '@aws-sdk/client-cognito-identity-provider';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { randomInt } from 'crypto';
import { accountTypeOfRole, isUnrestricted, RequestScope, SYSTEM_SCOPE } from '@rocket-be/scoping';
import { MessageResponseDto } from '../../../../commons/dtos/message-response.dto';
import { CognitoChangeGroupDto } from '../../dtos/cognito-change-group.dto';
import { CognitoUserCreateDto } from '../../dtos/cognito-user-create.dto';
import { CognitoUserResponseDto } from '../../dtos/cognito-user-response.dto';
import { CollaboratorResponseDto } from '../../dtos/collaborator-response.dto';
import { CognitoUserUpdateDto } from '../../dtos/cognito-user-update.dto';
import { CognitoUsersPageQueryDto } from '../../dtos/cognito-users-page-query.dto';
import { CognitoUsersPageResponseDto } from '../../dtos/cognito-users-page-response.dto';
import { AccountType } from '../../enums/account-type.enum';
import { Role } from '../../enums/role.enum';
import { UserStatus } from '../../enums/user-status.enum';
import { CognitoUserMapper, RESELLER_CODE_ATTRIBUTE } from '../../utils/cognito-user.mapper';
import { Collaborator } from '../../schemas/collaborator.schema';
import { CollaboratorsService } from './collaborators.service';

/** Cognito group names reserved for account types (mutually exclusive). */
const ACCOUNT_TYPE_GROUPS = Object.values(AccountType) as string[];

/** Character classes the pool's password policy requires, one each: uppercase, lowercase, digits, symbols. */
const PASSWORD_CHARSETS = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '@$!%*?'];

/** Length of the generated temporary passwords. */
const TEMPORARY_PASSWORD_LENGTH = 16;

/** Largest page Cognito returns in one listing call. */
const COGNITO_MAX_PAGE = 60;

/**
 * Service for managing AWS Cognito operations.
 * Handles user creation, deletion, and management in AWS Cognito.
 */
@Injectable()
export class CognitoManagementService {
  /**
   * Logger instance used for logging information and errors.
   * @private
   */
  private readonly logger = new Logger(CognitoManagementService.name);
  private readonly _cognitoClient: CognitoIdentityProviderClient;
  private readonly _userPoolId: string;

  constructor(
    private readonly _configService: ConfigService,
    private readonly _collaboratorsService: CollaboratorsService
  ) {
    const region = this._configService.getOrThrow<string>('AWS_REGION');
    const isDev = this._configService.get<string>('NODE_ENV') === 'development';
    const accessKeyId = this._configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this._configService.get<string>('AWS_SECRET_ACCESS_KEY');

    this._userPoolId = this._configService.getOrThrow<string>('COGNITO_USER_POOL_ID');

    const credentials = isDev && accessKeyId && secretAccessKey ? {
      accessKeyId,
      secretAccessKey
    } : undefined;

    this._cognitoClient = new CognitoIdentityProviderClient({
      region,
      credentials
    });

  }

  /**
   * Generates a temporary password that meets the pool policy: one character of
   * each class is guaranteed, the rest is drawn from all of them, then shuffled.
   * No `&`: the invite email is HTML, where `&lt` and the like would show as other characters.
   * @returns A string containing the temporary password.
   * @private
   */
  private _generateTemporaryPassword(): string {
    const pick = (chars: string): string => chars.charAt(randomInt(chars.length));
    const all = PASSWORD_CHARSETS.join('');
    const chars = [
      ...PASSWORD_CHARSETS.map(pick),
      ...Array.from({ length: TEMPORARY_PASSWORD_LENGTH - PASSWORD_CHARSETS.length }, () => pick(all)),
    ];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  /**
   * Maps custom attributes from a DTO to AWS Cognito attribute format.
   * @param customAttributes - Array of custom attributes.
   * @returns An array of AttributeType objects.
   * @private
   */
  private _mapCustomAttributes(customAttributes?: { name: string; value: string; }[]): AttributeType[] {
    if (!customAttributes || customAttributes.length === 0) {
      return [];
    }

    return customAttributes.map(attr => ({
      Name: attr.name.startsWith('custom:') ? attr.name : `custom:${attr.name}`,
      Value: attr.value
    }));
  }

  /**
   * Ensures the role groups do not contain account-type groups.
   * Account types (collaborator/reseller) are managed separately and are
   * mutually exclusive; they must never be passed as roles.
   * @param groups - The role groups to validate.
   * @private
   */
  private _assertNoAccountTypeInRoles(groups?: string[]): void {
    const invalid = (groups ?? []).filter(group => ACCOUNT_TYPE_GROUPS.includes(group));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Account-type groups (${invalid.join(', ')}) cannot be assigned as roles; use the accountType field instead`
      );
    }
  }

  /**
   * Ensures every role group belongs to the user's account type.
   * A `keus_*` profile on a reseller account (or the other way round) would
   * grant a perimeter the user must never have, and Cognito cannot enforce the
   * exclusivity natively, so it is enforced here at write time and again by
   * RolesGuard at read time.
   * @param groups - The role groups to validate.
   * @param accountType - The account type the groups are assigned to.
   * @private
   */
  private _assertRolesMatchAccountType(groups: string[] | undefined, accountType: AccountType): void {
    const mismatched = (groups ?? []).filter(group => {
      const owner = accountTypeOfRole(group);
      return owner !== undefined && owner !== accountType;
    });
    if (mismatched.length > 0) {
      throw new BadRequestException(
        `Profiles (${mismatched.join(', ')}) cannot be assigned to a ${accountType} account`
      );
    }
  }

  /**
   * Asserts that the target user belongs to the requester's reseller.
   * No-op for unrestricted scopes (collaborators / internal paths).
   * @param id - The target user's sub identifier.
   * @param scope - The request scope.
   * @private
   */
  private async _assertUserInScope(id: string, scope: RequestScope): Promise<void> {
    if (isUnrestricted(scope)) {
      return;
    }
    const targetUser = await this.getUser(id);
    if (targetUser.accountType !== AccountType.RESELLER || targetUser.resellerCode !== scope.resellerCode) {
      throw new ForbiddenException(`User ${id} is outside the scope of reseller ${scope.resellerCode}.`);
    }
  }

  /**
   * Asserts that the requester is not acting on their own account, so nobody
   * can deactivate, delete or change the profile of themselves.
   * @param id - The target user's sub identifier.
   * @param scope - The request scope.
   * @throws ForbiddenException if the target is the requester.
   * @private
   */
  private _assertNotSelf(id: string, scope: RequestScope): void {
    if (id === scope.sub) {
      throw new ForbiddenException('Users cannot manage their own account.');
    }
  }

  /**
   * Creates a new user in AWS Cognito and adds them to specified groups.
   * @param tenant - The tenant identifier.
   * @param dto - The user creation data.
   * @returns The created Cognito user.
   */
  async createUserAndAddToGroup(
    tenant: string,
    dto: CognitoUserCreateDto,
    scope: RequestScope
  ): Promise<CognitoUserResponseDto> {
    // Reseller requesters can only create reseller users of their own code.
    if (!isUnrestricted(scope) && scope.resellerCode) {
      dto = { ...dto, accountType: AccountType.RESELLER, resellerCode: scope.resellerCode };
    }
    const accountType = dto.accountType ?? AccountType.COLLABORATOR;
    let responseDto: CognitoUserResponseDto;

    try {
      // Account types are mutually exclusive groups, managed apart from roles.
      this._assertNoAccountTypeInRoles(dto.groups);
      this._assertRolesMatchAccountType(dto.groups, accountType);
      if (accountType === AccountType.RESELLER && !dto.resellerCode) {
        throw new BadRequestException('resellerCode is required when accountType is reseller');
      }

      // Create an array of user attributes
      const userAttributes: AttributeType[] = [
        { Name: 'email', Value: dto.email },
        { Name: 'email_verified', Value: 'true' },
      ];

      // Add optional attributes if provided
      if (dto.name) {
        userAttributes.push({ Name: 'name', Value: dto.name });
      }
      if (dto.surname) {
        userAttributes.push({ Name: 'family_name', Value: dto.surname });
      }
      if (dto.phoneNum) {
        userAttributes.push({ Name: 'phone_number', Value: dto.phoneNum });
      }
      if (accountType === AccountType.RESELLER) {
        userAttributes.push({ Name: RESELLER_CODE_ATTRIBUTE, Value: dto.resellerCode });
      }

      // Add any additional custom attributes
      if (dto.customAttributes) {
        userAttributes.push(...this._mapCustomAttributes(dto.customAttributes));
      }

      // Create the user in Cognito
      const createCommand = new AdminCreateUserCommand({
        UserPoolId: this._userPoolId,
        Username: dto.email,
        UserAttributes: userAttributes,
        TemporaryPassword: dto.temporaryPassword || this._generateTemporaryPassword(),
        MessageAction: dto.sendEmail === false ? MessageActionType.SUPPRESS : undefined,
        DesiredDeliveryMediums: [DeliveryMediumType.EMAIL]
      });

      const createResponse = await this._cognitoClient.send(createCommand);
      this.logger.log(`User created in Cognito: ${dto.email}`);

      // Add user to the role groups plus the account-type group
      const groupsToAssign = [...(dto.groups ?? []).map(String), accountType as string];
      await Promise.all(
        groupsToAssign.map(group =>
          this._cognitoClient.send(
            new AdminAddUserToGroupCommand({
              UserPoolId: this._userPoolId,
              Username: dto.email,
              GroupName: group
            })
          )
        )
      );
      this.logger.log(`User ${dto.email} added to groups: ${groupsToAssign.join(', ')}`);

      responseDto = CognitoUserMapper.fromAdminCreateUser(createResponse, tenant, groupsToAssign);
      responseDto.resellerCode = accountType === AccountType.RESELLER ? dto.resellerCode : undefined;
    } catch (error) {
      if (error instanceof UsernameExistsException) {
        throw new ConflictException('User with this email already exists');
      }
      if (error instanceof InvalidParameterException || error instanceof BadRequestException) {
        throw error instanceof BadRequestException ? error : new BadRequestException(error.message);
      }
      this.logger.error('Error creating user in Cognito', error);
      throw new InternalServerErrorException('Failed to create user in Cognito');
    }

    // Dual-write: project the pool user into the collaborators table (pool first, then table).
    try {
      await this._collaboratorsService.upsertCollaborator({
        sub: responseDto.sub,
        email: dto.email,
        name: dto.name,
        surname: dto.surname,
        accountType,
        resellerCode: accountType === AccountType.RESELLER ? dto.resellerCode : undefined,
        groups: dto.groups,
      });
    } catch (tableError) {
      this.logger.error(
        `User ${dto.email} created in Cognito but the collaborators table write failed - run the collaborators reconcile to realign`,
        tableError
      );
      throw new InternalServerErrorException(
        'User created in Cognito but the collaborator record write failed. Run the collaborators reconcile to realign the table.'
      );
    }

    return responseDto;
  }

  /**
   * Retrieves a user from AWS Cognito by their sub (user ID).
   * @param id - The user's sub identifier.
   * @returns The Cognito user information.
   */
  async getUser(id: string, scope: RequestScope = SYSTEM_SCOPE): Promise<CognitoUserResponseDto> {
    // _assertUserInScope fetches the target with an unrestricted internal getUser
    // call (scope defaults to SYSTEM_SCOPE), so there is no recursion here.
    await this._assertUserInScope(id, scope);
    try {
      const command = new AdminGetUserCommand({
        UserPoolId: this._userPoolId,
        Username: id
      });

      const response = await this._cognitoClient.send(command);

      // Get user groups
      const groupsCommand = new AdminListGroupsForUserCommand({
        UserPoolId: this._userPoolId,
        Username: id
      });
      const groupsResponse = await this._cognitoClient.send(groupsCommand);
      const groups = groupsResponse.Groups?.map(g => g.GroupName as Role) || [];

      return CognitoUserMapper.fromAdminGetUser(response, groups);
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        throw new NotFoundException('User not found in Cognito');
      }
      this.logger.error('Error getting user from Cognito', error);
      throw new InternalServerErrorException('Failed to get user from Cognito');
    }
  }

  /**
   * Lists all users from AWS Cognito User Pool.
   * Note: Cognito doesn't support tenant filtering natively, so we retrieve all users.
   * The tenant parameter is kept for API consistency but filtering should be done at application level.
   * @param tenant - The tenant identifier (for API consistency).
   * @returns Array of all Cognito users.
   */
  async listUsers(tenant: string, scope: RequestScope = SYSTEM_SCOPE): Promise<CognitoUserResponseDto[]> {
    try {
      this.logger.log(`Listing users for tenant: ${tenant}`);

      const users: CognitoUserResponseDto[] = [];
      let paginationToken: string | undefined;

      do {
        const command = new ListUsersCommand({
          UserPoolId: this._userPoolId,
          PaginationToken: paginationToken,
          Limit: COGNITO_MAX_PAGE
        });

        const response = await this._cognitoClient.send(command);

        for (const user of response.Users ?? []) {
          users.push(await this._withGroups(user));
        }

        paginationToken = response.PaginationToken;
      } while (paginationToken);

      // Resellers only see the users of their own reseller.
      const scoped = isUnrestricted(scope)
        ? users
        : users.filter(user => user.accountType === AccountType.RESELLER && user.resellerCode === scope.resellerCode);

      this.logger.log(`Retrieved ${scoped.length} users from Cognito`);
      return scoped;
    } catch (error) {
      this.logger.error('Error listing users from Cognito', error);
      throw new InternalServerErrorException('Failed to list users from Cognito');
    }
  }

  /**
   * Lists one page of the users, filtered by name, email, enabled state, profile, account type and reseller. The page
   * is read from the collaborators projection (`listCollaboratorsPage`), not from the pool, which can only be paged
   * through and filtered after reading. A reseller sees only the users of its own reseller.
   * @param query the page and its filters.
   * @param scope the request scope.
   * @returns the page of users.
   * @throws BadRequestException if the cursor is not valid.
   */
  async listUsersPage(query: CognitoUsersPageQueryDto, scope: RequestScope): Promise<CognitoUsersPageResponseDto> {
    const { limit, cursor, name, email, enabled, group, accountType } = query;

    // Resellers only see the users of their own reseller.
    const restricted = !isUnrestricted(scope);
    if (restricted && query.resellerCode && query.resellerCode !== scope.resellerCode) {
      return { items: [] };
    }
    const resellerCode = restricted ? scope.resellerCode : query.resellerCode;

    const page = await this._collaboratorsService.listCollaboratorsPage({ resellerCode, accountType, group, enabled, name, email }, limit, cursor);
    return {
      items: page.items.map(collaborator => plainToInstance(CollaboratorResponseDto, collaborator)),
      ...(page.nextCursor && { nextCursor: page.nextCursor }),
    };
  }

  /**
   * Maps a listed user together with its groups; a user whose groups cannot be read is kept without them.
   * @param user the user as listed by Cognito.
   * @returns the mapped user.
   */
  private async _withGroups(user: UserType): Promise<CognitoUserResponseDto> {
    try {
      const groupsResponse = await this._cognitoClient.send(new AdminListGroupsForUserCommand({
        UserPoolId: this._userPoolId,
        Username: user.Username
      }));
      return CognitoUserMapper.fromListUsers(user, groupsResponse.Groups?.map(g => g.GroupName as Role) || []);
    } catch (userError) {
      this.logger.warn(`Error getting groups for user ${user.Username}:`, userError);
      return CognitoUserMapper.fromListUsers(user, []);
    }
  }

  /**
   * Deletes a user from AWS Cognito and its collaborator record.
   * Only a deactivated user can be deleted.
   * @param tenant - The tenant identifier.
   * @param id - The user's sub identifier.
   * @returns Message response with deletion details.
   * @throws ForbiddenException if the user is the requester.
   * @throws ConflictException if the user is still active.
   */
  async deleteUser(tenant: string, id: string, scope: RequestScope = SYSTEM_SCOPE): Promise<MessageResponseDto> {
    this._assertNotSelf(id, scope);
    await this._assertUserInScope(id, scope);
    // Only a deactivated collaborator can be deleted: deactivation is the step that cuts access first.
    const target = await this.getUser(id);
    if (target.enabled) {
      throw new ConflictException('Deactivate the collaborator before deleting it.');
    }
    try {
      const command = new AdminDeleteUserCommand({
        UserPoolId: this._userPoolId,
        Username: id
      });

      await this._cognitoClient.send(command);
      this.logger.log(`User ${id} deleted from Cognito`);
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        throw new NotFoundException('User not found in Cognito');
      }
      this.logger.error('Error deleting user from Cognito', error);
      throw new InternalServerErrorException('Failed to delete user from Cognito');
    }

    // Dual-write: remove the projection record (pool first, then table).
    try {
      await this._collaboratorsService.deleteCollaborator(id);
    } catch (tableError) {
      this.logger.error(
        `User ${id} deleted from Cognito but the collaborators table delete failed - run the collaborators reconcile to realign`,
        tableError
      );
      throw new InternalServerErrorException(
        'User deleted from Cognito but the collaborator record delete failed. Run the collaborators reconcile to realign the table.'
      );
    }

    return new MessageResponseDto(
      'User deleted successfully from Cognito',
      { userId: id, tenant }
    );
  }

  /**
   * Enables a user in AWS Cognito, then in the collaborators projection.
   * @param tenant - The tenant identifier.
   * @param id - The user's sub identifier.
   * @returns Message response with operation details.
   */
  async enableUser(tenant: string, id: string): Promise<MessageResponseDto> {
    try {
      const command = new AdminEnableUserCommand({
        UserPoolId: this._userPoolId,
        Username: id
      });

      await this._cognitoClient.send(command);
      this.logger.log(`User ${id} enabled in Cognito`);
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        throw new NotFoundException('User not found in Cognito');
      }
      this.logger.error('Error enabling user in Cognito', error);
      throw new InternalServerErrorException('Failed to enable user in Cognito');
    }

    await this._projectCollaborator(id, { enabled: true });
    return new MessageResponseDto(
      'User enabled successfully in Cognito',
      { userId: id, tenant, enabled: true }
    );
  }

  /**
   * Disables a user in AWS Cognito, then in the collaborators projection.
   * @param tenant - The tenant identifier.
   * @param id - The user's sub identifier.
   * @returns Message response with operation details.
   */
  async disableUser(tenant: string, id: string): Promise<MessageResponseDto> {
    try {
      const command = new AdminDisableUserCommand({
        UserPoolId: this._userPoolId,
        Username: id
      });

      await this._cognitoClient.send(command);
      this.logger.log(`User ${id} disabled in Cognito`);
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        throw new NotFoundException('User not found in Cognito');
      }
      this.logger.error('Error disabling user in Cognito', error);
      throw new InternalServerErrorException('Failed to disable user in Cognito');
    }

    await this._projectCollaborator(id, { enabled: false });
    return new MessageResponseDto(
      'User disabled successfully in Cognito',
      { userId: id, tenant, enabled: false }
    );
  }

  /**
   * Resets a user's password in AWS Cognito.
   * @param id - The user's sub identifier.
   * @returns Message response with operation details.
   */
  async resetUserPassword(id: string, scope: RequestScope = SYSTEM_SCOPE): Promise<MessageResponseDto> {
    await this._assertUserInScope(id, scope);
    try {
      const command = new AdminResetUserPasswordCommand({
        UserPoolId: this._userPoolId,
        Username: id
      });

      await this._cognitoClient.send(command);
      this.logger.log(`Password reset initiated for user ${id}`);

      return new MessageResponseDto(
        'Password reset email sent successfully',
        { userId: id }
      );
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        throw new NotFoundException('User not found in Cognito');
      }
      this.logger.error('Error resetting user password in Cognito', error);
      throw new InternalServerErrorException('Failed to reset user password');
    }
  }

  /**
   * Changes a user's groups in AWS Cognito, then in the collaborators projection.
   * @param tenant - The tenant identifier.
   * @param id - The user's sub identifier.
   * @param dto - The group change data.
   * @returns Message response with operation details.
   */
  async changeCognitoGroup(
    tenant: string,
    id: string,
    dto: CognitoChangeGroupDto
  ): Promise<MessageResponseDto> {
    try {
      // Account types are mutually exclusive groups, managed apart from roles.
      this._assertNoAccountTypeInRoles(dto.groups);

      // Get current groups
      const groupsCommand = new AdminListGroupsForUserCommand({
        UserPoolId: this._userPoolId,
        Username: id
      });
      const groupsResponse = await this._cognitoClient.send(groupsCommand);
      const currentGroups = groupsResponse.Groups?.map(g => g.GroupName) || [];

      // The account type is immutable after creation, so it is never changed
      // here: the user's current account-type group is always preserved (only
      // role groups are added/removed). Defaults to collaborator if somehow absent.
      const currentAccountType = currentGroups.find(group => group && ACCOUNT_TYPE_GROUPS.includes(group));
      const accountType = currentAccountType ?? AccountType.COLLABORATOR;
      this._assertRolesMatchAccountType(dto.groups, accountType as AccountType);

      // Determine groups to add and remove
      const newGroups = [...dto.groups.map(group => group.toString()), accountType.toString()];
      const groupsToAdd = newGroups.filter(group => !currentGroups.includes(group));
      const groupsToRemove = currentGroups.filter(group => group && !newGroups.includes(group));

      // Remove user from old groups
      const removeCommands = groupsToRemove.map(group =>
        this._cognitoClient.send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: this._userPoolId,
            Username: id,
            GroupName: group
          })
        )
      );

      // Add user to new groups
      const addCommands = groupsToAdd.map(group =>
        this._cognitoClient.send(
          new AdminAddUserToGroupCommand({
            UserPoolId: this._userPoolId,
            Username: id,
            GroupName: group
          })
        )
      );

      await Promise.all([...removeCommands, ...addCommands]);
      this.logger.log(`User ${id} groups updated in Cognito`);
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        throw new NotFoundException('User not found in Cognito');
      }
      this.logger.error('Error changing user groups in Cognito', error);
      throw new InternalServerErrorException('Failed to change user groups in Cognito');
    }

    await this._projectCollaborator(id, { groups: dto.groups });
    return new MessageResponseDto(
      'User groups updated successfully in Cognito',
      {
        userId: id,
        tenant,
      }
    );
  }

  /**
   * Updates a user in AWS Cognito.
   * This is a placeholder for future complete user update implementation.
   * @param tenant - The tenant identifier.
   * @param id - The user's sub identifier.
   * @param dto - The user update data.
   * @returns Message response with operation details.
   * @throws ForbiddenException if the user is the requester.
   */
  async updateUser(
    tenant: string,
    id: string,
    dto: CognitoUserUpdateDto,
    scope: RequestScope = SYSTEM_SCOPE
  ): Promise<MessageResponseDto> {
    this._assertNotSelf(id, scope);
    await this._assertUserInScope(id, scope);
    // accountType and resellerCode are immutable after creation, so they are not
    // part of the update DTO: updateUser only touches name/surname/roles/status.
    try {
      // Handle status changes (enable/disable user)
      if (dto.status !== undefined) {
        if (dto.status === UserStatus.ACTIVE) {
          await this.enableUser(tenant, id);
        } else if (dto.status === UserStatus.INACTIVE) {
          await this.disableUser(tenant, id);
        }
      }

      // Handle role group changes (the account-type group is always preserved).
      if (dto.roles) {
        await this.changeCognitoGroup(tenant, id, { groups: dto.roles });
      }

      // We just update the user name and surname (for now)
      const userAttributes: AttributeType[] = []
      // Name of the user
      if (dto.name) {
        userAttributes.push({
          Name: 'name',
          Value: dto.name || ''
        });
      }
      // Surname of the user
      if (dto.surname) {
        userAttributes.push({
          Name: 'family_name',
          Value: dto.surname || ''
        });
      }
      if (userAttributes.length > 0) {
        const command = new AdminUpdateUserAttributesCommand({
          UserPoolId: this._userPoolId,
          Username: id,
          UserAttributes: userAttributes,
        });

        await this._cognitoClient.send(command);
        this.logger.log(`User attributes updated for ${id}`);
      }

      this.logger.log(`User ${id} updated in Cognito`);

      // Dual-write: keep the collaborators projection aligned (pool first, then table).
      await this._syncCollaboratorOnUpdate(id, dto);

      return new MessageResponseDto(
        'User updated successfully in Cognito',
        { userId: id, tenant }
      );
    } catch (error) {
      this.logger.error('Error updating user in Cognito', error);
      throw error;
    }
  }

  /**
   * Projects a user update into the collaborators table.
   * @param id - The user's sub identifier.
   * @param dto - The user update data.
   * @private
   */
  private async _syncCollaboratorOnUpdate(id: string, dto: CognitoUserUpdateDto): Promise<void> {
    // accountType and resellerCode are immutable, so only name/surname can change.
    const tableUpdates: { name?: string; surname?: string } = {};
    if (dto.name) {
      tableUpdates.name = dto.name;
    }
    if (dto.surname) {
      tableUpdates.surname = dto.surname;
    }

    if (Object.keys(tableUpdates).length === 0) {
      return;
    }

    await this._projectCollaborator(id, tableUpdates);
  }

  /**
   * Writes a change already made in the pool into the collaborators table (dual-write: pool first, then table).
   * @param id - The user's sub identifier.
   * @param updates - The fields changed.
   * @throws InternalServerErrorException if the table write fails: the reconcile realigns it.
   * @private
   */
  private async _projectCollaborator(id: string, updates: Partial<Omit<Collaborator, 'sub'>>): Promise<void> {
    try {
      await this._collaboratorsService.updateCollaborator(id, updates);
    } catch (tableError) {
      this.logger.error(
        `User ${id} changed in Cognito but the collaborators table write failed - run the collaborators reconcile to realign`,
        tableError
      );
      throw new InternalServerErrorException(
        'User changed in Cognito but the collaborator record write failed. Run the collaborators reconcile to realign the table.'
      );
    }
  }

  /**
   * Rebuilds the collaborators projection table from the User Pool (the source of truth).
   * @param tenant - The tenant identifier (for API consistency with listUsers).
   * @returns Message response with the reconcile summary.
   */
  async reconcileCollaborators(tenant: string, scope: RequestScope): Promise<MessageResponseDto> {
    if (!isUnrestricted(scope)) {
      throw new ForbiddenException('The collaborators reconcile is reserved to Keus collaborators.');
    }
    const users = await this.listUsers(tenant);
    const records = users
      .filter(user => user.sub)
      .map(user => ({
        sub: user.sub,
        email: user.email,
        name: user.name || undefined,
        surname: user.familyName || undefined,
        accountType: user.accountType,
        resellerCode: user.accountType === AccountType.RESELLER ? user.resellerCode : undefined,
        groups: user.groups,
        enabled: user.enabled,
        profilePicS3Key: user.profilePicS3Key,
      }));

    const result = await this._collaboratorsService.reconcile(records);

    return new MessageResponseDto(
      'Collaborators table reconciled successfully from the User Pool',
      { tenant, ...result }
    );
  }
}