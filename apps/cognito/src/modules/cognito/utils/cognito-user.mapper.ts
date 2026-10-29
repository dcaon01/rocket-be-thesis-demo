import {
  AdminCreateUserCommandOutput,
  AdminGetUserCommandOutput,
  AttributeType,
  UserType
} from '@aws-sdk/client-cognito-identity-provider';
import { AccountType } from '../enums/account-type.enum';
import { Role } from '../enums/role.enum';
import { CognitoUserResponseDto } from '../dtos/cognito-user-response.dto';

/** Cognito attribute holding the reseller code of reseller users. */
export const RESELLER_CODE_ATTRIBUTE = 'custom:resellerCode';

/**
 * Mapper class for converting AWS Cognito user objects to DTOs.
 * Provides type-safe mapping without using 'any' types.
 */
export class CognitoUserMapper {
  /**
   * Maps the response from AdminCreateUser command to CognitoUserResponseDto.
   * @param createUserResponse - The response from AdminCreateUserCommand
   * @param groups - Array of group names the user belongs to
   * @returns A mapped CognitoUserResponseDto
   */
  static fromAdminCreateUser(
    createUserResponse: AdminCreateUserCommandOutput,
    tenant: string,
    groups: string[] = []
  ): CognitoUserResponseDto {
    const user = createUserResponse.User;

    if (!user) {
      throw new Error('User data is missing from Cognito response');
    }

    return this.mapUserTypeToCognitoUserResponseDto(user, tenant, groups);
  }

  /**
   * Maps the response from AdminGetUser command to CognitoUserResponseDto.
   * @param getUserResponse - The response from AdminGetUserCommand
   * @param groups - Array of group names the user belongs to
   * @returns A mapped CognitoUserResponseDto
   */
  static fromAdminGetUser(
    getUserResponse: AdminGetUserCommandOutput,
    groups: string[] = []
  ): CognitoUserResponseDto {
    const dto = new CognitoUserResponseDto();

    // Map attributes from UserAttributes array
    const attributes = getUserResponse.UserAttributes || [];

    dto.sub = this.getAttributeValue(attributes, 'sub') || '';
    dto.username = getUserResponse.Username || '';
    dto.email = this.getAttributeValue(attributes, 'email') || '';
    dto.name = this.getAttributeValue(attributes, 'name') || ''; // Name
    dto.familyName = this.getAttributeValue(attributes, 'family_name') || ''; // Surname
    dto.userStatus = getUserResponse.UserStatus || '';
    dto.enabled = getUserResponse.Enabled !== false;
    this.applyGroupsAndAccountType(dto, groups);
    dto.createdAt = getUserResponse.UserCreateDate || new Date();
    dto.updatedAt = getUserResponse.UserLastModifiedDate;
    dto.profilePicS3Key = this.getAttributeValue(attributes, 'custom:profilePicS3Key');
    dto.resellerCode = this.getAttributeValue(attributes, RESELLER_CODE_ATTRIBUTE) || undefined;

    return dto;
  }

  /**
   * Maps a UserType object (from ListUsers) to CognitoUserResponseDto.
   * @param user - The UserType object from ListUsers command
   * @param groups - Array of group names the user belongs to
   * @returns A mapped CognitoUserResponseDto
   */
  static fromListUsers(
    user: UserType,
    groups: string[] = []
  ): CognitoUserResponseDto {
    const dto = new CognitoUserResponseDto();

    // Map attributes from Attributes array
    const attributes = user.Attributes || [];

    dto.sub = this.getAttributeValue(attributes, 'sub') || '';
    dto.username = user.Username || '';
    dto.email = this.getAttributeValue(attributes, 'email') || '';
    dto.name = this.getAttributeValue(attributes, 'name') || ''; // Name
    dto.familyName = this.getAttributeValue(attributes, 'family_name') || ''; // Surname
    dto.userStatus = user.UserStatus || '';
    dto.enabled = user.Enabled !== false;
    this.applyGroupsAndAccountType(dto, groups);
    dto.createdAt = user.UserCreateDate || new Date();
    dto.updatedAt = user.UserLastModifiedDate;
    dto.profilePicS3Key = this.getAttributeValue(attributes, 'custom:profilePicS3Key');
    dto.resellerCode = this.getAttributeValue(attributes, RESELLER_CODE_ATTRIBUTE) || undefined;

    return dto;
  }

  /**
   * Maps a UserType object (from AdminCreateUser) to CognitoUserResponseDto.
   * @param user - The UserType object from Cognito
   * @param groups - Array of group names the user belongs to
   * @returns A mapped CognitoUserResponseDto
   */
  private static mapUserTypeToCognitoUserResponseDto(
    user: UserType,
    tenant: string,
    groups: string[] = []
  ): CognitoUserResponseDto {
    const dto = new CognitoUserResponseDto();

    // Map attributes from Attributes array
    const attributes = user.Attributes || [];

    dto.sub = this.getAttributeValue(attributes, 'sub') || '';
    dto.username = user.Username || '';
    dto.email = this.getAttributeValue(attributes, 'email') || '';
    dto.tenant = tenant;
    dto.userStatus = user.UserStatus || '';
    dto.enabled = user.Enabled !== false;
    this.applyGroupsAndAccountType(dto, groups);
    dto.createdAt = user.UserCreateDate || new Date();
    dto.updatedAt = user.UserLastModifiedDate;
    dto.profilePicS3Key = this.getAttributeValue(attributes, 'custom:profilePicS3Key');
    dto.resellerCode = this.getAttributeValue(attributes, RESELLER_CODE_ATTRIBUTE) || undefined;

    return dto;
  }

  /**
   * Derives the account type from the raw Cognito group list and keeps
   * only the role groups in dto.groups (account-type groups are excluded).
   * Users with no account-type group default to COLLABORATOR.
   * @param dto - The DTO being populated
   * @param groups - Raw Cognito group names (roles + account type)
   */
  private static applyGroupsAndAccountType(
    dto: CognitoUserResponseDto,
    groups: string[]
  ): void {
    const accountTypeValues = Object.values(AccountType) as string[];
    dto.accountType = groups.includes(AccountType.RESELLER)
      ? AccountType.RESELLER
      : AccountType.COLLABORATOR;
    dto.groups = groups.filter(group => !accountTypeValues.includes(group)) as Role[];
  }

  /**
   * Extracts an attribute value from an array of AttributeType.
   * @param attributes - Array of Cognito attributes
   * @param name - The name of the attribute to extract
   * @returns The attribute value or undefined if not found
   */
  private static getAttributeValue(
    attributes: AttributeType[],
    name: string
  ): string | undefined {
    const attribute = attributes.find(attr => attr.Name === name);
    return attribute?.Value;
  }

}