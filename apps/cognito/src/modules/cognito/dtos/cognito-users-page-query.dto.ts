import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AccountType } from '../enums/account-type.enum';
import { Role } from '../enums/role.enum';

/**
 * Body of the user search: a page and its filters.
 * The cursor is the Cognito pagination token, opaque to the client.
 */
export class CognitoUsersPageQueryDto {
  /** Number of users per page, 20 when absent. */
  @ApiPropertyOptional({
    example: 20,
    description: 'Number of users per page: 10, 20, 50 or 100; 20 when absent.',
    type: Number,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([10, 20, 50, 100])
  limit: number = 20;

  /** Opaque cursor returned by the previous page, absent for the first one. */
  @ApiPropertyOptional({
    description: 'Opaque cursor returned by the previous page, absent for the first one.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cursor?: string;

  /** Start of the first or last name, case-insensitive. */
  @ApiPropertyOptional({
    description: 'Start of the first or last name, case-insensitive.',
    example: 'Mario',
  })
  @IsOptional()
  @IsString()
  name?: string;

  /** Start of the email, case-insensitive. */
  @ApiPropertyOptional({
    description: 'Start of the email, case-insensitive.',
    example: 'mario@',
  })
  @IsOptional()
  @IsString()
  email?: string;

  /** Whether to list the enabled users only (true) or the disabled ones only (false); both when absent. */
  @ApiPropertyOptional({
    description: 'Whether to list the enabled users only (true) or the disabled ones only (false); both when absent.',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Profile the users must have, every profile when absent. */
  @ApiPropertyOptional({
    description: 'Profile the users must have, every profile when absent.',
    enum: Role,
  })
  @IsOptional()
  @IsEnum(Role)
  group?: Role;

  /** Account type the users must have, every account type when absent. */
  @ApiPropertyOptional({
    description: 'Account type the users must have, every account type when absent.',
    enum: AccountType,
  })
  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;

  /** Code of the reseller the users belong to, every user when absent. */
  @ApiPropertyOptional({
    description: 'Code of the reseller the users belong to, every user when absent.',
    example: 'RVD-001',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  resellerCode?: string;
}
