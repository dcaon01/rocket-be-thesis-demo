import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Min } from "class-validator";
import { AccountType } from "../../../commons/enums/account-type.enum";

/**
 * DTO for creating a new tenant.
 */
export class CreateTenantDto {
  /** Optional identifier of the tenant. If not provided, a UUID will be generated. */
  @ApiPropertyOptional({
    example: "tenant_123456",
    description: "Optional identifier of the tenant. If not provided, a UUID will be generated.",
    required: false,
  })
  @IsString()
  @IsOptional()
  id?: string;

  /** Identifier of the product. */
  @ApiProperty({
    example: "product_123456",
    description: "Identifier of the product.",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  productId: string;

  /** Name of the tenant. */
  @ApiProperty({
    example: "Tenant",
    description: "Name of the tenant.",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  /** Description of the tenant. */
  @ApiPropertyOptional({
    example: "This is an example tenant.",
    description: "Description of the tenant.",
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  /** Identifier of the trial associated with the tenant. One of trialId, issuerId or orderId is required. */
  @ApiPropertyOptional({
    example: "trial_123456",
    description: "Identifier of the trial associated with the tenant. One of trialId, issuerId or orderId is required.",
    required: false,
  })
  @IsString()
  @IsOptional()
  trialId?: string;

  /** Email associated with the trial. */
  @ApiPropertyOptional({
    example: "client@example.com",
    description: "Email associated with the trial.",
    required: false,
  })
  @IsString()
  @IsOptional()
  trialEmail?: string;

  /** Information of the tenant structured as indicated in the product's tenantStructure. */
  @ApiProperty({
    example: { key: "value" },
    description: "Information of the tenant structured as indicated in the product's tenantStructure.",
    required: true,
  })
  @IsObject()
  @IsNotEmpty()
  data: Record<string, any>;

  /** Maximum number of seats (users) allowed for this tenant. Defaults to 5 if not provided. */
  @ApiPropertyOptional({
    example: 10,
    description: "Maximum constraint value for this tenant (seats or revenue depending on product type). Defaults to 5 if not provided.",
    required: false,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxConstraintValue?: number;

  /**
   * Identifier of the professional that activated this tenant.
   * When set, trialId can be omitted.
   */
  @ApiPropertyOptional({
    example: "professional-id-123",
    description: "Identifier of the professional that activated this tenant.",
    required: false,
  })
  @IsString()
  @IsOptional()
  issuerId?: string;

  /** Identifier of the order whose line the tenant provisions; the line is the same product's. */
  @ApiPropertyOptional({
    example: "order-id-123",
    description: "Identifier of the order whose line the tenant provisions; the line is the same product's.",
    required: false,
  })
  @IsString()
  @IsOptional()
  orderId?: string;

  /** Account type of the tenant (defaults to CLIENT). Set by the product to flag a professional's workspace. */
  @ApiPropertyOptional({
    example: AccountType.Company,
    description: "Account type of the tenant (CLIENT or PROFESSIONAL). Defaults to CLIENT. Distinct from issuerId.",
    enum: AccountType,
  })
  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;

}