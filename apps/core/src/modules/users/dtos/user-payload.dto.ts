import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested
} from "class-validator";
import { AccountType } from "../../../commons/enums/account-type.enum";
import { UserStatus } from "../enums/user-status.enum";
import { ProductError } from "../../../commons/classes/product-error.class";

/**
 * Unified DTO for user operations cross-product.
 * All fields are optional — the product determines which fields to include
 * based on the operation (create, update, etc.).
 */
export class UserPayloadDto {
  /** The unique identifier of the user. Necessary for cross-product operations. */
  @ApiPropertyOptional({
    example: "12345",
    description: "The unique identifier of the user. Necessary for cross-product operations.",
  })
  @IsString()
  @IsOptional()
  id?: string;

  /** The email address of the user. */
  @ApiPropertyOptional({
    example: "user@example.com",
    description: "The email address of the user.",
  })
  @IsString()
  @IsOptional()
  email?: string;

  /** Roles the user belongs to in Cognito. */
  @ApiPropertyOptional({
    example: ["admin", "users"],
    description: "Roles the user belongs to in Cognito.",
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  roles?: string[];

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
  @ApiPropertyOptional({
    example: "tenant123",
    description: "The ID of the tenant associated with the user.",
  })
  @IsString()
  @IsOptional()
  tenant?: string;

  /** The name of the tenant. */
  @ApiPropertyOptional({
    example: "tenant123",
    description: "The name of the tenant.",
  })
  @IsString()
  @IsOptional()
  tenantName?: string;

  /** The status of the user. */
  @ApiPropertyOptional({
    example: "ACTIVE",
    description: "The status of the user.",
    enum: UserStatus,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  /** The previous status of the user before tenant deactivation. */
  @ApiPropertyOptional({
    example: "ACTIVE",
    description: "The previous status of the user before tenant deactivation.",
    enum: UserStatus,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  prevStatus?: UserStatus;

  /** Account type of the end-user (CLIENT or PROFESSIONAL). */
  @ApiPropertyOptional({
    example: AccountType.Professional,
    description: "Account type of the end-user (CLIENT or PROFESSIONAL).",
    enum: AccountType,
  })
  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;

  /** Object containing the user information structured as indicated in the product's userStructure. */
  @ApiPropertyOptional({
    example: { name: "John", age: 30 },
    description: "Object containing the user information structured as indicated in the product's userStructure.",
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, any>;

  /** All the other fields which are not standard nor data but must be sent back. */
  @ApiPropertyOptional({
    example: { key: "value" },
    description: "All the other fields which are not standard nor data but must be sent back.",
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  /**
   * Error the product answers with when it could not carry out Rocket's request, next to the
   * `metadata` it received. Absent on success.
   */
  @ApiPropertyOptional({
    description: "Error the product answers with when it could not carry out Rocket's request. Absent on success.",
    type: ProductError,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductError)
  error?: ProductError;
}
