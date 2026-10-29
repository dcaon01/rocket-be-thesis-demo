import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsInt, IsObject, IsOptional, IsString, Min } from "class-validator";
import { TenantStatus } from "../enums/tenant-status.enum";

/**
 * Data Transfer Object for updating a tenant.
 * Contact can't be changed here.
 */
export class UpdateTenantDto {
  @ApiPropertyOptional({
    example: "Updated Tenant Name",
    description: "The new name of the tenant.",
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;

  /** Whether the tenant is active. */
  @ApiPropertyOptional({
    example: true,
    description: "Whether the tenant is active.",
    required: false,
    enum: TenantStatus,
  })
  @IsEnum(TenantStatus)
  @IsOptional()
  status?: TenantStatus;

  /** Description of the tenant. */
  @ApiPropertyOptional({
    example: "This is an example tenant.",
    description: "Description of the tenant.",
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  /** Object containing the tenant information structured as indicated in the product's tenantStructure */
  @ApiPropertyOptional({
    example: { key: "value" },
    description: "Object containing the tenant information structured as indicated in the product's tenantStructure.",
    required: false,
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, any>;

  /** Maximum number of seats (users) allowed for this tenant. */
  @ApiPropertyOptional({
    example: 10,
    description: "Maximum constraint value for this tenant (seats or revenue depending on product type).",
    required: false,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxConstraintValue?: number;
}