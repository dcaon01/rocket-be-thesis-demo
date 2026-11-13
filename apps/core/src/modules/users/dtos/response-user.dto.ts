import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AccountType } from "../../../commons/enums/account-type.enum";
import { SyncState } from "../../../commons/enums/sync-state.enum";
import { UserStatus } from "../enums/user-status.enum";
import { UserAttributeDto } from "../classes/user-attribute.class";

/**
 * Response DTO for user operations.
 */
export class ResponseUserDto {
  /** The identifier of the product the user belongs to. */
  @ApiProperty({
    example: "product123",
    description: "The identifier of the product the user belongs to.",
    required: true,
  })
  productId: string;

  /** The unique identifier of the user. */
  @ApiProperty({
    example: "user123",
    description: "The unique identifier of the user.",
    required: true,
  })
  id: string;

  /** The email address of the user. */
  @ApiProperty({
    example: "user@example.com",
    description: "The email address of the user.",
    required: true,
  })
  email: string;

  /** Roles the user belongs to in Cognito. */
  @ApiProperty({
    example: ["admin", "users"],
    description: "Roles the user belongs to in Cognito.",
    type: [String],
  })
  roles: string[];

  /** The first name of the user. */
  @ApiPropertyOptional({
    example: "John",
    description: "The first name of the user.",
    required: false,
  })
  name?: string;

  /** The surname of the user. */
  @ApiPropertyOptional({
    example: "Doe",
    description: "The surname of the user.",
    required: false,
  })
  surname?: string;

  /** The status of the user. */
  @ApiProperty({
    example: "ACTIVE",
    description: "The status of the user.",
    required: true,
    enum: UserStatus,
  })
  status: UserStatus;

  /** The previous status of the user before tenant deactivation. */
  @ApiPropertyOptional({
    example: "ACTIVE",
    description: "The previous status of the user before tenant deactivation.",
    required: false,
    enum: UserStatus,
  })
  prevStatus?: UserStatus;

  /** The ID of the tenant associated with the user. */
  @ApiProperty({
    example: "tenant123",
    description: "The ID of the tenant associated with the user.",
    required: true,
  })
  tenant: string;

  /** The name of the tenant associated with the user. */
  @ApiPropertyOptional({
    example: "Acme Corp",
    description: "The name of the tenant associated with the user.",
    required: false,
  })
  tenantName?: string;

  /** Materialized reseller lineage of the user's tenant (provenance flag for Keus collaborators). */
  @ApiPropertyOptional({
    example: "RVD-001#RVD-002#",
    description: "Materialized reseller lineage of the user's tenant. Absent for Keus-owned tenants; the immediate owner is the last segment.",
    required: false,
  })
  resellerPath?: string;

  /** The name of the product the user belongs to. */
  @ApiPropertyOptional({
    example: "My Product",
    description: "The name of the product the user belongs to.",
    required: false,
  })
  productName?: string;

  /** Account type of the end-user (CLIENT or PROFESSIONAL). */
  @ApiProperty({
    example: AccountType.Company,
    description: "Account type of the end-user (CLIENT or PROFESSIONAL).",
    required: true,
    enum: AccountType,
  })
  accountType: AccountType;

  /** Additional custom attributes for the user. */
  @ApiPropertyOptional({
    description: 'Additional custom attributes for the user',
    type: [UserAttributeDto]
  })
  customAttributes?: UserAttributeDto[];

  /** Object containing the user information structured as indicated in the product's userStructure. */
  @ApiPropertyOptional({
    example: { name: "John", age: 30 },
    description: "Object containing the user information structured as indicated in the product's userStructure.",
  })
  data?: Record<string, any>;

  /** Month index for metrics queries (format: "YYYY-MM"). */
  @ApiProperty({
    description: "Month index for metrics queries (format: \"YYYY-MM\").",
    example: "2026-03",
    required: true,
  })
  monthIndex: string;

  /** The date and time when the user was created.*/
  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'The date and time when the user was created.',
    required: true,
    type: Date,
  })
  createdAt: Date;

  /** The date and time when the user was last updated. */
  @ApiProperty({
    example: '2024-01-02T00:00:00.000Z',
    description: 'The date and time when the user was last updated.',
    required: true,
    type: Date,
  })
  updatedAt: Date;

  /** Pending operation that asked the product to create the user, while it waits or failed. */
  @ApiPropertyOptional({
    example: '5f0c1c6e-2b7a-4a7e-9a55-3a2f1f0c9d11',
    description: 'Pending operation that asked the product to create the user, while it waits or failed.',
    required: false,
  })
  pendingOperationId?: string;

  /** Whether the user matches its copy on the product. */
  @ApiPropertyOptional({
    example: SyncState.Pending,
    description: 'Whether the user matches its copy on the product.',
    enum: SyncState,
    required: false,
  })
  syncState?: SyncState;

  /** Error the product answered the open operation with, while `syncState` is FAILED. */
  @ApiPropertyOptional({
    example: 'Duplicate email on the product.',
    description: 'Error the product answered the open operation with, while syncState is FAILED.',
    required: false,
  })
  failureReason?: string;

  /** Set when the product confirmed the user after the operator had cancelled it. */
  @ApiPropertyOptional({
    example: true,
    description: 'Set when the product confirmed the user after the operator had cancelled it.',
    required: false,
  })
  confirmedAfterCancellation?: boolean;

  /** Marks the referent of the tenant, who accepts the contract at first access: one per tenant. */
  @ApiPropertyOptional({
    example: true,
    description: 'Marks the referent of the tenant, who accepts the contract at first access: one per tenant.',
    required: false,
  })
  referent?: boolean;
}
