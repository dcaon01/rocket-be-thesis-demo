import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType } from '../enums/account-type.enum';
import { Role } from '../enums/role.enum';

/**
 * Response DTO for Cognito user operations.
 */
export class CognitoUserResponseDto {
  /**
   * The unique identifier of the user (sub).
   */
  @ApiProperty({
    description: 'The unique identifier of the user',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  sub: string;

  /**
   * The username of the user.
   */
  @ApiProperty({
    description: 'The username of the user',
    example: 'john.doe@example.com'
  })
  username: string;

  /**
   * The tenant associated with the user.
   */
  @ApiProperty({
    description: "The tenant associated with the user.",
    example: "tenant123",
  })
  tenant: string;

  /**
   * The email address of the user.
   */
  @ApiProperty({
    description: 'The email address of the user',
    example: 'john.doe@example.com'
  })
  email: string;

  /**
   * The first name of the user.
   */
  @ApiPropertyOptional({
    description: 'The first name of the user',
    example: 'John'
  })
  name?: string;

  /** 
   * The last name of the user.
   */
  @ApiPropertyOptional({
    description: 'The last name of the user',
    example: 'Doe'
  })
  familyName?: string;

  /**
   * The user's status in Cognito.
   */
  @ApiProperty({
    description: 'The user status in Cognito',
    example: 'FORCE_CHANGE_PASSWORD'
  })
  userStatus: string;

  /**
   * Whether the user is enabled.
   */
  @ApiProperty({
    description: 'Whether the user is enabled',
    example: true
  })
  enabled: boolean;

  /**
   * The groups the user belongs to.
   */
  @ApiProperty({
    description: 'The groups the user belongs to',
    example: [Role.KeusSales],
    type: [String],
    enum: Role,
    isArray: true
  })
  groups: Role[];

  /**
   * The account type of the user, derived from the Cognito groups.
   */
  @ApiProperty({
    description: 'The account type of the user (derived from Cognito groups)',
    enum: AccountType,
    example: AccountType.COLLABORATOR
  })
  accountType: AccountType;

  /**
   * The code of the reseller the user belongs to (custom:resellerCode attribute).
   */
  @ApiPropertyOptional({
    description: 'Code of the reseller the user belongs to',
    example: 'RVD-001'
  })
  resellerCode?: string;

  /**
   * The creation date of the user.
   */
  @ApiProperty({
    description: 'The creation date of the user',
    example: '2023-12-01T10:00:00Z'
  })
  createdAt: Date;

  /**
   * The last modification date of the user.
   */
  @ApiPropertyOptional({
    description: 'The last modification date of the user',
    example: '2023-12-01T10:00:00Z'
  })
  updatedAt?: Date;

  /**
   * S3 key for the user's profile picture.
   */
  @ApiPropertyOptional({
    description: 'S3 key for the user profile picture',
    example: 'users/123e4567-e89b-12d3-a456-426614174000/profile-photo.jpg'
  })
  profilePicS3Key?: string;
}