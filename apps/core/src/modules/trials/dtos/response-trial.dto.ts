import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TrialStatus } from "../enums/trial-status.enum";
import { UsersLimitType } from "../enums/users-limit-type.enum";

/**
 * Response DTO for trial operations.
 */
export class ResponseTrialDto {
  /** Identifier of the product associated with the trial. */
  @ApiProperty({
    description: "Identifier of the product associated with the trial.",
    example: "product_12345",
    required: true,
  })
  productId: string;

  /** Identifier of the trial. */
  @ApiProperty({
    description: "Identifier of the trial.",
    example: "trial_67890",
    required: true,
  })
  id: string;

  /** Date when the trial was activated. Null if in DRAFT status. */
  @ApiProperty({
    description: "Date when the trial was activated. Null if in DRAFT status.",
    example: "2026-06-01T00:00:00Z",
    required: false,
  })
  activatedAt?: Date;

  /** Expires date of the trial period. Null if in DRAFT status. */
  @ApiProperty({
    description: "Expires date of the trial period. Null if in DRAFT status.",
    example: "2026-06-30T23:59:59.999Z",
    required: false,
  })
  expiresAt?: Date;

  /** Description of the trial. */
  @ApiPropertyOptional({
    description: "Description of the trial.",
    example: "Trial for testing the premium plan.",
    required: false,
  })
  description?: string;

  /** Email associated with the trial. */
  @ApiProperty({
    description: "Email associated with the trial. Can't open more trials with the same email.",
    example: "client@example.com",
    required: true,
  })
  associatedEmail: string;

  /** Status of the trial. */
  @ApiProperty({
    description: "Status of the trial.",
    example: "active",
    enum: TrialStatus,
    required: true,
  })
  status: TrialStatus;

  /** Indicates whether the trial has been redeemed (a tenant linked to the trial has been created). */
  @ApiProperty({
    description: "Indicates whether the trial has been redeemed.",
    example: false,
    required: true,
  })
  redeemed: boolean;

  /** When the trial's tenant was provisioned by an order line, which turned the trial into CONVERTED. */
  @ApiPropertyOptional({
    description: "When the trial's tenant was provisioned by an order line, which turned the trial into CONVERTED.",
    example: "2026-10-09T10:00:00Z",
    required: false,
  })
  convertedAt?: Date;

  /** Month ("YYYY-MM") in which the trial last closed: expired, cancelled or converted. Absent while open. */
  @ApiPropertyOptional({
    description: "Month (YYYY-MM) in which the trial last closed: expired, cancelled or converted. Absent while open.",
    example: "2026-10",
    required: false,
  })
  closedMonth?: string;

  /** The date and time when the trial was created. */
  @ApiProperty({
    description: "The date and time when the trial was created.",
    example: "2026-01-01T00:00:00Z",
    required: true,
  })
  createdAt: string;

  /** The date and time when the trial was last updated. */
  @ApiProperty({
    description: "The date and time when the trial was last updated.",
    example: "2026-01-02T00:00:00Z",
    required: true,
  })
  updatedAt: string;

  /** Whether the trial never expires (can only be cancelled manually). */
  @ApiProperty({
    description: "Whether the trial never expires (can only be cancelled manually).",
    example: false,
    required: false,
  })
  perpetual?: boolean;

  /** Type of users limit for the trial. */
  @ApiProperty({
    description: "Type of users limit for the trial. PRODUCT uses the product's default, INFINITE means no limit, CUSTOM requires usersLimit.",
    example: "PRODUCT",
    enum: UsersLimitType,
    required: true,
  })
  usersLimitType: UsersLimitType;

  /** Maximum number of users allowed for the trial. */
  @ApiPropertyOptional({
    description: "Maximum number of users allowed for the trial.",
    example: 10,
    required: false,
  })
  usersLimit?: number;

  /** Month index for metrics queries (format: "YYYY-MM"). */
  @ApiProperty({
    description: "Month index for metrics queries (format: \"YYYY-MM\").",
    example: "2026-03",
    required: true,
  })
  monthIndex: string;

  /** Materialized reseller lineage of the trial's creator (provenance flag for Keus collaborators). */
  @ApiPropertyOptional({
    description: "Materialized reseller lineage of the trial's creator. Absent on Keus trials; the immediate owner is the last segment.",
    example: "RVD-001#RVD-002#",
    required: false,
  })
  resellerPath?: string;

  /** Identifier of the CRM deal that opened the trial. */
  @ApiPropertyOptional({
    description: "Identifier of the CRM deal that opened the trial.",
    example: "1234567890",
    required: false,
  })
  dealId?: string;
}
