import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { LegalAddress } from "../classes/legal-address.class";
import { ResellerStatus } from "../enums/reseller-status.enum";
import { ResellerTier } from "../enums/reseller-tier.enum";

/**
 * Data Transfer Object representing a reseller response.
 */
export class ResponseResellerDto {
  /** Identifier of the reseller. */
  @ApiProperty({
    description: "Identifier of the reseller.",
    example: "60d21b4667d0d8992e610c85",
    required: true,
  })
  id: string;

  /** Unique human-readable code of the reseller. */
  @ApiProperty({
    description: "Unique human-readable code of the reseller.",
    example: "RVD-001",
    required: true,
  })
  code: string;

  /** Company name of the reseller. */
  @ApiProperty({
    description: "Company name of the reseller.",
    example: "Acme Reselling S.r.l.",
    required: true,
  })
  companyName: string;

  /** Email of the reseller. */
  @ApiProperty({
    description: "Email of the reseller.",
    example: "test@test.com",
    required: true,
  })
  email: string;

  /** VAT number of the reseller: 11 digits. */
  @ApiPropertyOptional({
    description: "VAT number of the reseller: 11 digits.",
    example: "12345678901",
    required: false,
  })
  vatNumber?: string;

  /** Certified electronic address of the reseller. */
  @ApiPropertyOptional({
    description: "Certified electronic address of the reseller.",
    example: "pec@example.com",
    required: false,
  })
  pec?: string;

  /** SDI recipient code of the reseller, for electronic invoicing: 7 letters or digits. */
  @ApiPropertyOptional({
    description: "SDI recipient code of the reseller, for electronic invoicing: 7 letters or digits.",
    example: "ABC1234",
    required: false,
  })
  sdi?: string;

  /** Address of the reseller. */
  @ApiPropertyOptional({
    description: "Address of the reseller.",
    example: "123 Main St, Anytown, USA",
    required: false,
  })
  address?: string;

  /** Phone number of the reseller. */
  @ApiPropertyOptional({
    description: "Phone number of the reseller.",
    example: "+1234567890",
    required: false,
  })
  phoneNumber?: string;

  /** Status of the reseller. */
  @ApiProperty({
    description: "Status of the reseller.",
    example: "ACTIVE",
    required: true,
    enum: ResellerStatus,
  })
  status: ResellerStatus;

  /** Products the reseller is enabled to sell: those of its contract in force, empty without one. Read from the contract at every response, never stored. */
  @ApiPropertyOptional({
    description: "Products the reseller is enabled to sell: those of its contract in force, empty without one. Read from the contract at every response, never stored.",
    example: ["product-id-1", "product-id-2"],
    required: false,
  })
  productIds?: string[];

  /** Partner tier of the contract in force, copied here for the materials. */
  @ApiPropertyOptional({
    description: "Partner tier of the contract in force, copied here for the materials.",
    enum: ResellerTier,
    example: ResellerTier.Gold,
    required: false,
  })
  tier?: ResellerTier;

  /** Identifier of the contract in force, carrying the fee and the margins of the reseller. */
  @ApiPropertyOptional({
    description: "Identifier of the contract in force, carrying the fee and the margins of the reseller.",
    example: "60d21b4667d0d8992e610c86",
    required: false,
  })
  contractId?: string;

  /** Cognito sub of the Keus salesperson responsible for the reseller. */
  @ApiPropertyOptional({
    description: "Cognito sub of the Keus salesperson responsible for the reseller.",
    example: "c01c191c-7091-700c-34c4-3771542553e2",
    required: false,
  })
  assignedSalesId?: string;

  /** Display name of the Keus salesperson, denormalized for the listings. */
  @ApiPropertyOptional({
    description: "Display name of the Keus salesperson.",
    example: "Damiano Caon",
    required: false,
  })
  assignedSalesName?: string;

  /** S3 key of the reseller logo, rendered on the offers it presents. */
  @ApiPropertyOptional({
    description: "S3 key of the reseller logo.",
    example: "resellers/123e4567-e89b-12d3-a456-426614174000/logo.png",
    required: false,
  })
  logoS3Key?: string;

  /** Whether the reseller has invoices past their due date. */
  @ApiPropertyOptional({
    description: "Whether the reseller has invoices past their due date. Recomputed from the payment schedule, never set by hand.",
    example: false,
    required: false,
  })
  overdue?: boolean;

  /** ISO timestamp since when the reseller has been overdue. */
  @ApiPropertyOptional({
    description: "ISO timestamp since when the reseller has been overdue.",
    example: "2024-01-01T00:00:00Z",
    required: false,
  })
  overdueSince?: string;

  /** ISO timestamp since when the users of the reseller are blocked in Rocket for an unpaid invoice. */
  @ApiPropertyOptional({
    description: "ISO timestamp since when the users of the reseller are blocked in Rocket for an unpaid invoice.",
    example: "2026-11-19T00:00:00Z",
    required: false,
  })
  accessSuspendedAt?: string;

  /** Structured legal address, also used to place the reseller on the network map. */
  @ApiPropertyOptional({
    description: "Structured legal address.",
    type: LegalAddress,
    required: false,
  })
  legalAddress?: LegalAddress;

  /** IBAN used for the SEPA direct debit, decrypted on the way out. */
  @ApiPropertyOptional({
    description: "IBAN used for the SEPA direct debit. Stored encrypted, returned in clear to the collaborators allowed to read it.",
    example: "IT60X0542811101000000123456",
    required: false,
  })
  iban?: string;

  /** Fiscal code, when different from the VAT number. */
  @ApiPropertyOptional({
    description: "Fiscal code, when different from the VAT number.",
    example: "CNADMN90A01H501X",
    required: false,
  })
  fiscalCode?: string;

  /** Code of the parent reseller that created this one. Absent when created by Keus. */
  @ApiPropertyOptional({
    description: "Code of the parent reseller that created this one. Absent when created by Keus.",
    example: "RVD-000",
    required: false,
  })
  createdBy?: string;

  /** The date and time when the reseller was created. */
  @ApiProperty({
    example: "2024-01-01T00:00:00Z",
    description: "The date and time when the reseller was created.",
    required: true,
  })
  createdAt: string;

  /** The date and time when the reseller was last updated. */
  @ApiProperty({
    example: "2024-01-02T00:00:00Z",
    description: "The date and time when the reseller was last updated.",
    required: true,
  })
  updatedAt: string;
}
