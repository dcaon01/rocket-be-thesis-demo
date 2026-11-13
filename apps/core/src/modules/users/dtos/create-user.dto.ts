import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested
} from "class-validator";
import { AccountType } from "../../../commons/enums/account-type.enum";
import { UserAttributeDto } from "../classes/user-attribute.class";

/**
 * DTO for creating a new user.
 */
export class CreateUserDto {
  @ApiPropertyOptional({
    example: "user_123456",
    description: "Optional identifier of the user. If not provided, a UUID will be generated.",
    required: false,
  })
  @IsString()
  @IsOptional()
  id?: string;

  /** The identifier of the product the user belongs to. */
  @ApiProperty({
    example: "product123",
    description: "The identifier of the product the user belongs to.",
  })
  @IsString()
  @IsNotEmpty()
  productId: string;

  /** The email address of the user. */
  @ApiProperty({
    example: "user@example.com",
    description: "The email address of the user.",
  })
  @IsString()
  @IsNotEmpty()
  email: string;

  /** Roles the user belongs to in Cognito. */
  @ApiProperty({
    example: ["admin", "users"],
    description: "Roles the user belongs to in Cognito.",
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  roles: string[];

  /** The first name of the user. */
  @ApiPropertyOptional({
    example: "John",
    description: "The first name of the user.",
  })
  @IsString()
  @IsOptional()
  name?: string;

  /** The surname of the user. */
  @ApiPropertyOptional({
    example: "Doe",
    description: "The surname of the user.",
  })
  @IsString()
  @IsOptional()
  surname?: string;

  /** The ID of the tenant associated with the user. */
  @ApiProperty({
    example: "tenant123",
    description: "The ID of the tenant associated with the user.",
  })
  @IsString()
  @IsNotEmpty()
  tenant: string;

  /** Name of the tenant the user belongs to. */
  @ApiProperty({
    example: "Acme Corp",
    description: "Name of the tenant the user belongs to.",
  })
  @IsString()
  @IsNotEmpty()
  tenantName: string;

  /** Materialized reseller lineage inherited from the tenant (set server-side). */
  @ApiPropertyOptional({
    example: "RVD-001#RVD-002#",
    description: "Materialized reseller lineage of the user's tenant. Resolved server-side from the tenant; absent for Keus-owned tenants.",
  })
  @IsString()
  @IsOptional()
  resellerPath?: string;

  /** The name of the product the user belongs to. */
  @ApiProperty({
    example: "My Product",
    description: "The name of the product the user belongs to.",
  })
  @IsString()
  @IsNotEmpty()
  productName: string;

  /** Account type of the end-user (defaults to CLIENT). Set by the product to flag professionals. */
  @ApiPropertyOptional({
    example: AccountType.Company,
    description: "Account type of the end-user (CLIENT or PROFESSIONAL). Defaults to CLIENT.",
    enum: AccountType,
  })
  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;

  /** Additional custom attributes for the user. */
  @ApiPropertyOptional({
    description: 'Additional custom attributes for the user',
    type: [UserAttributeDto]
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => UserAttributeDto)
  customAttributes?: UserAttributeDto[];

  /** Object containing the user information structured as indicated in the product's userStructure. */
  @ApiPropertyOptional({
    example: { name: "John", age: 30 },
    description: "Object containing the user information structured as indicated in the product's userStructure.",
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, any>;

  /** Whether the user is the referent of its tenant, who accepts the contract: the product keeps one per tenant. */
  @ApiPropertyOptional({
    example: true,
    description: "Whether the user is the referent of its tenant, who accepts the contract: the product keeps one per tenant.",
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  referent?: boolean;

}