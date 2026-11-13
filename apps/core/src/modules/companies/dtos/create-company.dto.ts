import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, ValidateNested } from "class-validator";
import { IssuerType } from "../../../commons/enums/issuer-type.enum";
import { CompanyReferent } from "../classes/company-referent.class";
import { LegalAddress } from "../../resellers/classes/legal-address.class";
import { SDI_PATTERN, VAT_NUMBER_PATTERN } from "../../../commons/constants/fiscal-identifiers.constant";
import { normalizeSdi, normalizeVatNumber } from "../../../commons/formatting/fiscal-identifiers.helper";

/**
 * CreateCompanyDto
 */
export class CreateCompanyDto {
  /** Name of the company. */
  @ApiProperty({
    description: "Name of the company.",
    example: "Acme Corporation",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  /** Email of the company. */
  @ApiProperty({
    description: "Email of the company.",
    example: "test@test.com",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  email: string;

  /** Certified electronic address of the company. */
  @ApiPropertyOptional({
    description: "Certified electronic address of the company.",
    example: "pec@example.com",
    required: false,
  })
  @IsOptional()
  @IsString()
  pec?: string;

  /** Phone number of the company. */
  @ApiPropertyOptional({
    description: "Phone number of the company.",
    example: "+1234567890",
    required: false,
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  /** Address of the company. */
  @ApiPropertyOptional({
    description: "Address of the company.",
    example: "123 Main St, Anytown, USA",
    required: false,
  })
  @IsOptional()
  @IsString()
  address?: string;

  /** VAT number of the company: 11 digits. */
  @ApiPropertyOptional({
    description: "VAT number of the company: 11 digits.",
    example: "12345678901",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(normalizeVatNumber)
  @Matches(VAT_NUMBER_PATTERN, { message: "vatNumber must be 11 digits" })
  vatNumber?: string;

  /** SDI recipient code of the company, for electronic invoicing: 7 letters or digits. */
  @ApiPropertyOptional({
    description: "SDI recipient code of the company, for electronic invoicing: 7 letters or digits.",
    example: "ABC1234",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(normalizeSdi)
  @Matches(SDI_PATTERN, { message: "sdi must be 7 letters or digits" })
  sdi?: string;

  /** Person to talk to at the company, kept as part of its records. */
  @ApiPropertyOptional({
    description: "Person to talk to at the company, kept as part of its records.",
    type: CompanyReferent,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyReferent)
  referent?: CompanyReferent;

  /** Who brought (created) the company (defaults to KEUS). */
  @ApiPropertyOptional({
    description: "Who brought (created) the company (defaults to KEUS).",
    enum: IssuerType,
    example: IssuerType.Keus,
    required: false,
  })
  @IsOptional()
  @IsEnum(IssuerType)
  createdByType?: IssuerType;

  /** Identifier of the non-Keus creator (reseller code or professional id). Immutable after creation. */
  @ApiPropertyOptional({
    description: "Identifier of the non-Keus creator (reseller code or professional id). Immutable after creation.",
    example: "RVD-001",
    required: false,
  })
  @IsOptional()
  @IsString()
  createdById?: string;

  /** Materialized reseller lineage of the creator (set server-side, e.g. inherited from the contract). */
  @ApiPropertyOptional({
    description: "Materialized reseller lineage of the creator. Resolved server-side; absent for Keus companies.",
    example: "RVD-001#RVD-002#",
    required: false,
  })
  @IsOptional()
  @IsString()
  resellerPath?: string;

  /** Structured legal address, needed on the fiscal documents and the contract. */
  @ApiPropertyOptional({
    description: "Structured legal address, needed on the fiscal documents and the contract.",
    type: LegalAddress,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LegalAddress)
  legalAddress?: LegalAddress;

  /** IBAN used for the SEPA direct debit. Required on the direct channel. */
  @ApiPropertyOptional({
    description: "IBAN used for the SEPA direct debit. Required on the direct channel.",
    example: "IT60X0542811101000000123456",
    required: false,
  })
  @IsOptional()
  @IsString()
  iban?: string;

  /** Fiscal code, when the company has no VAT number or they differ. */
  @ApiPropertyOptional({
    description: "Fiscal code, when the company has no VAT number or they differ.",
    example: "02542970443",
    required: false,
  })
  @IsOptional()
  @IsString()
  fiscalCode?: string;
}
