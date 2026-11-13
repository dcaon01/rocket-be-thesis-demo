import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType } from '../enums/account-type.enum';
import { Role } from '../enums/role.enum';

/**
 * Response DTO for collaborator projection records.
 */
export class CollaboratorResponseDto {
  /**
   * The Cognito sub of the user.
   */
  @ApiProperty({
    description: 'The Cognito sub of the user',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  sub: string;

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
  surname?: string;

  /**
   * The account type of the user.
   */
  @ApiProperty({
    description: 'The account type of the user',
    enum: AccountType,
    example: AccountType.RESELLER
  })
  accountType: AccountType;

  /**
   * The code of the reseller the user belongs to.
   */
  @ApiPropertyOptional({
    description: 'Code of the reseller the user belongs to',
    example: 'RVD-001'
  })
  resellerCode?: string;

  /**
   * The profiles of the user, without the account-type group.
   */
  @ApiPropertyOptional({
    description: 'Profiles of the user, without the account-type group',
    enum: Role,
    isArray: true,
    example: [Role.ResellerSales]
  })
  groups?: Role[];

  /**
   * Whether the user can sign in.
   */
  @ApiProperty({
    description: 'Whether the user can sign in',
    example: true
  })
  enabled: boolean;

  /**
   * S3 key of the profile photo of the user.
   */
  @ApiPropertyOptional({
    description: 'S3 key of the profile photo of the user',
    example: 'users/123e4567-e89b-12d3-a456-426614174000/profile-photo.png'
  })
  profilePicS3Key?: string;

  /**
   * Creation timestamp.
   */
  @ApiProperty({
    description: 'Creation timestamp',
    example: '2026-10-19T08:00:00.000Z'
  })
  createdAt: string;

  /**
   * Last update timestamp.
   */
  @ApiProperty({
    description: 'Last update timestamp',
    example: '2026-10-19T08:00:00.000Z'
  })
  updatedAt: string;
}
