import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AccountType } from "../../../commons/enums/account-type.enum";
import { SyncState } from "../../../commons/enums/sync-state.enum";
import { TenantStatus } from "../enums/tenant-status.enum";

/**
 * Response DTO for tenant operations.
 */
export class ResponseTenantDto {
  /** Identifier of the product. */
  @ApiProperty({
    example: "product_123456",
    description: "Identifier of the product.",
    required: true,
  })
  productId: string;

  /** Identifier of the tenant. */
  @ApiProperty({
    example: "tenant_123456",
    description: "Identifier of the tenant.",
    required: true,
  })
  id: string;

  /** Name of the tenant. */
  @ApiProperty({
    example: "Example Tenant",
    description: "Name of the tenant.",
    required: true,
  })
  name: string;

  /** Description of the tenant. */
  @ApiPropertyOptional({
    example: "This is an example tenant.",
    description: "Description of the tenant.",
    required: false,
  })
  description?: string;

  /** Contract governing the tenant, set when its order line is provisioned. */
  @ApiPropertyOptional({
    example: "contract_123456",
    description: "Contract governing the tenant, set when its order line is provisioned.",
    required: false,
  })
  contractId?: string;

  /** Code of the contract governing the tenant. */
  @ApiPropertyOptional({
    example: "NQ-2026-00001",
    description: "Code of the contract governing the tenant.",
    required: false,
  })
  contractCode?: string;

  /** Identifier of the trial associated with the tenant. */
  @ApiPropertyOptional({
    example: "trial_123456",
    description: "Identifier of the trial associated with the tenant.",
    required: false,
  })
  trialId?: string;

  /** Email associated with the trial. */
  @ApiPropertyOptional({
    example: "client@example.com",
    description: "Email associated with the trial.",
    required: false,
  })
  trialEmail?: string;

  /** Whether the tenant is active. */
  @ApiProperty({
    example: true,
    description: "Whether the tenant is active.",
    required: true,
    enum: TenantStatus,
  })
  status: TenantStatus;

  /** Object containing the tenant information structured as indicated in the product's tenantStructure */
  @ApiProperty({
    example: { key: "value" },
    description: "Object containing the tenant information structured as indicated in the product's tenantStructure.",
    required: true,
  })
  data: Record<string, any>;

  /** Maximum constraint value for this tenant (seats or revenue depending on product type). */
  @ApiProperty({
    example: 10,
    description: "Maximum constraint value for this tenant (seats or revenue depending on product type).",
    required: true,
  })
  maxConstraintValue: number;

  /** Current number of active users for this tenant. */
  @ApiProperty({
    example: 5,
    description: "Current number of active users for this tenant.",
    required: true,
  })
  activeUsers: number;

  /** The date and time when the tenant was created. */
  @ApiProperty({
    example: "2024-01-01T00:00:00Z",
    description: "The date and time when the tenant was created.",
    required: true,
  })
  createdAt: string;

  /** The date and time when the tenant was last updated. */
  @ApiProperty({
    example: "2024-01-02T00:00:00Z",
    description: "The date and time when the tenant was last updated.",
    required: true,
  })
  updatedAt: string;

  /** Month index for metrics queries (format: "YYYY-MM"). */
  @ApiProperty({
    description: "Month index for metrics queries (format: \"YYYY-MM\").",
    example: "2026-03",
    required: true,
  })
  monthIndex: string;

  /** Account type of the tenant (CLIENT or PROFESSIONAL). */
  @ApiProperty({
    example: AccountType.Company,
    description: "Account type of the tenant (CLIENT or PROFESSIONAL). Distinct from issuerId (lineage).",
    required: true,
    enum: AccountType,
  })
  accountType: AccountType;

  /** Identifier of the professional that activated this tenant. */
  @ApiPropertyOptional({
    example: "professional-id-123",
    description: "Identifier of the professional that activated this tenant.",
    required: false,
  })
  issuerId?: string;

  /** Materialized reseller lineage of the tenant's issuer (provenance flag for Keus collaborators). */
  @ApiPropertyOptional({
    example: "RVD-001#RVD-002#",
    description: "Materialized reseller lineage of the tenant's issuer. Absent on Keus-direct tenants; the immediate owner is the last segment.",
    required: false,
  })
  resellerPath?: string;

  /** Order whose line the tenant provisions; with the product it addresses the line. */
  @ApiPropertyOptional({
    example: "order-id-123",
    description: "Order whose line the tenant provisions; with the product it addresses the line.",
    required: false,
  })
  orderId?: string;

  /** Pending operation that asked the product to create the tenant, while it waits or failed. */
  @ApiPropertyOptional({
    example: "5f0c1c6e-2b7a-4a7e-9a55-3a2f1f0c9d11",
    description: "Pending operation that asked the product to create the tenant, while it waits or failed.",
    required: false,
  })
  pendingOperationId?: string;

  /** Whether the tenant matches its copy on the product. */
  @ApiPropertyOptional({
    example: SyncState.Pending,
    description: "Whether the tenant matches its copy on the product.",
    enum: SyncState,
    required: false,
  })
  syncState?: SyncState;

  /** Error the product answered the open operation with, while `syncState` is FAILED. */
  @ApiPropertyOptional({
    example: "Duplicate email on the product.",
    description: "Error the product answered the open operation with, while syncState is FAILED.",
    required: false,
  })
  failureReason?: string;

  /** Set when the product confirmed the tenant after the operator had cancelled it. */
  @ApiPropertyOptional({
    example: true,
    description: "Set when the product confirmed the tenant after the operator had cancelled it.",
    required: false,
  })
  confirmedAfterCancellation?: boolean;
}
