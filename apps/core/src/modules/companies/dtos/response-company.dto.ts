import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum } from "class-validator";
import { IssuerType } from "../../../commons/enums/issuer-type.enum";
import { CompanyStatus } from "../enums/company-status.enum";
import { CompanyReferent } from "../classes/company-referent.class";
import { LegalAddress } from "../../resellers/classes/legal-address.class";
import { StripeAccountLink } from "../../stripe/classes/stripe-account-link.class";

/**
 * Data Transfer Object representing a company response.
 */
export class ResponseCompanyDto {
  /** Identifier of the company. */
  @ApiProperty({
    description: "Identifier of the company.",
    example: "60d21b4667d0d8992e610c85",
    required: true,
  })
  id: string;

  /** Name of the company. */
  @ApiProperty({
    description: "Name of the company.",
    example: "Acme Corporation",
    required: true,
  })
  name: string;

  /** Email of the company. */
  @ApiProperty({
    description: "Email of the company.",
    example: "test@test.com",
    required: true,
  })
  email: string;

  /** Certified electronic address of the company. */
  @ApiPropertyOptional({
    description: "Certified electronic address of the company.",
    example: "pec@example.com",
    required: false,
  })
  pec?: string;

  /** Phone number of the company. */
  @ApiPropertyOptional({
    description: "Phone number of the company.",
    example: "+1234567890",
    required: false,
  })
  phoneNumber?: string;

  /** Address of the company. */
  @ApiPropertyOptional({
    description: "Address of the company.",
    example: "123 Main St, Anytown, USA",
    required: false,
  })
  address?: string;

  /** VAT number of the company: 11 digits. */
  @ApiPropertyOptional({
    description: "VAT number of the company: 11 digits.",
    example: "12345678901",
    required: false,
  })
  vatNumber?: string;

  /** SDI recipient code of the company, for electronic invoicing: 7 letters or digits. */
  @ApiPropertyOptional({
    description: "SDI recipient code of the company, for electronic invoicing: 7 letters or digits.",
    example: "ABC1234",
    required: false,
  })
  sdi?: string;

  /** Person to talk to at the company, kept as part of its records. */
  @ApiPropertyOptional({
    description: "Person to talk to at the company, kept as part of its records.",
    type: CompanyReferent,
    required: false,
  })
  referent?: CompanyReferent;

  /** Status of the company. */
  @ApiProperty({
    description: "Status of the company.",
    example: "active",
    required: false,
    enum: CompanyStatus
  })
  @IsEnum(CompanyStatus)
  status?: string;

  /** Who brought (created) the company. Absent on legacy records (treated as KEUS). */
  @ApiPropertyOptional({
    description: "Who brought (created) the company. Absent on legacy records (treated as KEUS).",
    enum: IssuerType,
    example: IssuerType.Keus,
    required: false,
  })
  createdByType?: IssuerType;

  /** Identifier of the non-Keus creator (reseller code or professional id). */
  @ApiPropertyOptional({
    description: "Identifier of the non-Keus creator (reseller code or professional id).",
    example: "RVD-001",
    required: false,
  })
  createdById?: string;

  /** Cognito sub of the user who created the company; a record only, no perimeter follows it. */
  @ApiPropertyOptional({
    description: "Cognito sub of the user who created the company; a record only, no perimeter follows it.",
    example: "a1b2c3d4-5678-90ab-cdef-1234567890ab",
    required: false,
  })
  createdBySub?: string;

  /** Materialized reseller lineage of the creator (provenance flag for Keus collaborators). */
  @ApiPropertyOptional({
    description: "Materialized reseller lineage of the creator. Absent on Keus companies; the immediate owner is the last segment.",
    example: "RVD-001#RVD-002#",
    required: false,
  })
  resellerPath?: string;

  /** When the company was last transferred from an inactive reseller. */
  @ApiPropertyOptional({
    description: "When the company was last transferred from an inactive reseller.",
    example: "2026-10-15T00:00:00.000Z",
    required: false,
  })
  transferredAt?: string;

  /** Code of the reseller the company left with its last transfer. */
  @ApiPropertyOptional({
    description: "Code of the reseller the company left with its last transfer.",
    example: "RVD-001",
    required: false,
  })
  previousResellerCode?: string;

  /** Other records of the same real company, linked by a transfer; one contract in force per product holds across them. */
  @ApiPropertyOptional({
    description: "Other records of the same real company, linked by a transfer; one contract in force per product holds across them.",
    type: [String],
    example: ["company-id-456"],
    required: false,
  })
  sameAsCompanyIds?: string[];

  /** The date and time when the product was created. */
  @ApiProperty({
    example: "2024-01-01T00:00:00Z",
    description: "The date and time when the product was created.",
    required: true,
  })
  createdAt: string;

  /** The date and time when the product was last updated. */
  @ApiProperty({
    example: "2024-01-02T00:00:00Z",
    description: "The date and time when the product was last updated.",
    required: true,
  })
  updatedAt: string;

  /** Structured legal address, needed on the fiscal documents and the contract. */
  @ApiPropertyOptional({
    description: "Structured legal address, needed on the fiscal documents and the contract.",
    type: LegalAddress,
    required: false,
  })
  legalAddress?: LegalAddress;

  /** IBAN used for the SEPA direct debit. Required on the direct channel. */
  @ApiPropertyOptional({
    description: "IBAN used for the SEPA direct debit. Required on the direct channel.",
    example: "IT60X0542811101000000123456",
    required: false,
  })
  iban?: string;

  /** Fiscal code, when the company has no VAT number or they differ. */
  @ApiPropertyOptional({
    description: "Fiscal code, when the company has no VAT number or they differ.",
    example: "02542970443",
    required: false,
  })
  fiscalCode?: string;

  /** Customer and SEPA mandate of the company on each Stripe account, written by Rocket only. */
  @ApiPropertyOptional({
    description: "Customer and SEPA mandate of the company on each Stripe account, written by Rocket only.",
    type: StripeAccountLink,
    isArray: true,
    required: false,
  })
  stripeAccounts?: StripeAccountLink[];
}
