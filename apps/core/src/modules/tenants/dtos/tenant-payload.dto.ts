import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsObject, IsOptional, IsString, ValidateNested } from "class-validator";
import { AccountType } from "../../../commons/enums/account-type.enum";
import { ProductError } from "../../../commons/classes/product-error.class";

/**
 * Unified DTO for tenant operations cross-product.
 * All fields are optional — the product determines which fields to include
 * based on the operation (create, update, etc.).
 */
export class TenantPayloadDto {
  /** The unique identifier of the tenant. Necessary for cross-product operations. */
  @ApiPropertyOptional({
    example: "12345",
    description: "The unique identifier of the tenant. Necessary for cross-product operations.",
  })
  @IsString()
  @IsOptional()
  id?: string;

  /** Name of the tenant (human readable). */
  @ApiPropertyOptional({
    example: "Tenant",
    description: "Name of the tenant (human readable).",
  })
  @IsString()
  @IsOptional()
  name?: string;

  /** Account type of the tenant (CLIENT or PROFESSIONAL). */
  @ApiPropertyOptional({
    example: AccountType.Professional,
    description: "Account type of the tenant (CLIENT or PROFESSIONAL).",
    enum: AccountType,
  })
  @IsEnum(AccountType)
  @IsOptional()
  accountType?: AccountType;

  /** Information of the tenant structured as indicated in the product's tenantStructure. */
  @ApiPropertyOptional({
    example: { key: "value" },
    description: "Information of the tenant structured as indicated in the product's tenantStructure.",
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
