import { Role } from '../enums/role.enum';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { AccountType } from '../enums/account-type.enum';
import { UserAttributeDto } from '../classes/cognito-user-attribute.class';

/**
 * Data Transfer Object for creating a user in AWS Cognito.
 * Simplified for admin usage: just email and optional password.
 */
export class CognitoUserCreateDto {
  /**
   * The email address of the user.
   * This will be used as both username and email in Cognito.
   */
  @ApiProperty({
    description: 'Email address of the user (will be used as username)',
    example: 'john.doe@example.com'
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  /**
   * The profile to assign to the user, as a one-item list: profiles are not cumulative.
   */
  @ApiProperty({
    description: 'The profile to assign to the user, as a one-item list: profiles are not cumulative',
    type: [String],
    enum: Role,
    isArray: true,
    example: [Role.KeusSales]
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
  @IsEnum(Role, { each: true })
  groups: Role[];

  /**
   * The account type of the user (collaborator or reseller).
   * Mutually exclusive Cognito groups, managed separately from roles.
   */
  @ApiPropertyOptional({
    description: 'Account type of the user (mutually exclusive Cognito groups)',
    enum: AccountType,
    default: AccountType.COLLABORATOR,
    example: AccountType.COLLABORATOR
  })
  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType = AccountType.COLLABORATOR;

  /**
   * The code of the reseller the user belongs to.
   * Required when accountType is reseller; stored as the custom:resellerCode attribute.
   */
  @ApiPropertyOptional({
    description: 'Code of the reseller the user belongs to (required when accountType is reseller)',
    example: 'RVD-001'
  })
  @ValidateIf((dto: CognitoUserCreateDto) => dto.accountType === AccountType.RESELLER)
  @IsNotEmpty()
  @IsString()
  resellerCode?: string;

  /**
   * The user's first name.
   */
  @ApiPropertyOptional({
    description: 'First name of the user',
    example: 'John'
  })
  @IsOptional()
  @IsString()
  name?: string;

  /**
   * The user's last name.
   */
  @ApiPropertyOptional({
    description: 'Last name of the user',
    example: 'Doe'
  })
  @IsOptional()
  @IsString()
  surname?: string;

  /**
   * Temporary password for the user.
   * If not provided, a secure random password will be generated automatically.
   * The user will receive this password via email and must change it on first login.
   */
  @ApiPropertyOptional({
    description: 'Temporary password for the user (auto-generated if not provided)',
    example: 'TempPassword123!',
    default: 'Auto-generated'
  })
  @IsOptional()
  @IsString()
  temporaryPassword?: string;

  @ApiPropertyOptional({
    description: "Phone number of the contact",
    example: "+393454356789"
  })
  @IsOptional()
  @IsString()
  phoneNum?: string;

  /**
   * Whether to send a welcome email with the temporary password.
   * If true (default), the user receives an email with instructions to login and change password.
   * If false, no email is sent (useful for bulk imports or testing).
   */
  @ApiPropertyOptional({
    description: 'Send welcome email with temporary password to the user',
    example: true,
    default: true
  })
  @IsOptional()
  sendEmail?: boolean = true;

  /**
   * Optional company name associated with the user.
   */
  @ApiPropertyOptional({
    description: "Optional company name associated with the user.",
    example: "Kosmo Inc."
  })
  @IsOptional()
  @IsString()
  companyVatNumber?: string;

  /**
   * Additional custom attributes for the user.
   */
  @ApiPropertyOptional({
    description: 'Additional custom attributes for the user',
    type: [UserAttributeDto]
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => UserAttributeDto)
  customAttributes?: UserAttributeDto[];
}