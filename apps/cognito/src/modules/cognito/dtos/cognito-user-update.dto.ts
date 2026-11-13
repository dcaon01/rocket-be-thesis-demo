import { Role } from '../enums/role.enum';
import { Type } from "@nestjs/class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, ValidateNested } from "@nestjs/class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { AddressDto } from "../../../commons/classes/address.class";
import { ContactDto } from "../../../commons/classes/contact.class";
import { CompanyRole } from '../enums/company-role.enum';
import { Gender } from '../enums/gender.enum';
import { UserStatus } from '../enums/user-status.enum';

/**
 * DTO for complete user update through Cognito controller.
 * Handles both Cognito and MongoDB updates.
 */
export class CognitoUserUpdateDto {
  /**
   * The first name of the user.
   */
  @ApiPropertyOptional({
    description: "The first name of the user.",
    example: "John"
  })
  @IsOptional()
  @IsString()
  name?: string;

  /**
   * The last name of the user.
   */
  @ApiPropertyOptional({
    description: "The last name of the user.",
    example: "Doe"
  })
  @IsOptional()
  @IsString()
  surname?: string;

  /**
   * The profile of the user, as a one-item list: profiles are not cumulative.
   */
  @ApiPropertyOptional({
    description: "The profile of the user, as a one-item list: profiles are not cumulative.",
    enum: Role,
    isArray: true,
    example: [Role.KeusAdmin]
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
  @IsEnum(Role, { each: true })
  roles?: Role[];

  /**
   * The status of the user in the system.
   */
  @ApiPropertyOptional({
    description: "The status of the user in the system.",
    enum: UserStatus,
    example: UserStatus.ACTIVE
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  /**
   * The contact associated with the user.
   */
  @ApiPropertyOptional({
    description: "The contact associated with the user.",
    type: ContactDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContactDto)
  contact?: ContactDto;

  /**
   * The address of the user.
   */
  @ApiPropertyOptional({
    description: "The address of the user.",
    type: AddressDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

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
   * Optional role of the user in the company.
   */
  @ApiPropertyOptional({
    description: "Optional role of the user in the company.",
    enum: CompanyRole,
    example: CompanyRole.EXECUTIVE
  })
  @IsOptional()
  @IsEnum(CompanyRole)
  companyRole?: CompanyRole;

  /**
   * Optional URL for the user's profile picture.
   */
  @ApiPropertyOptional({
    description: "Optional URL for the user's profile picture.",
    example: "https://example.com/profile.jpg"
  })
  @IsOptional()
  @IsString()
  profilePicUrl?: string;

  /**
   * Optional birthday of the user.
   */
  @ApiPropertyOptional({
    description: "Optional birthday of the user.",
    example: "1990-01-01"
  })
  @IsOptional()
  @IsString()
  birthday?: string;

  /**
   * Optional gender of the user.
   */
  @ApiPropertyOptional({
    description: "Optional gender of the user.",
    enum: Gender,
    example: Gender.MALE
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  /**
   * Optional timezone of the user.
   */
  @ApiPropertyOptional({
    description: "Optional timezone of the user.",
    example: "America/New_York"
  })
  @IsOptional()
  @IsString()
  timezone?: string;

  /**
   * Optional language preference of the user.
   */
  @ApiPropertyOptional({
    description: "Optional language preference of the user.",
    example: "en"
  })
  @IsOptional()
  @IsString()
  lang?: string;
}