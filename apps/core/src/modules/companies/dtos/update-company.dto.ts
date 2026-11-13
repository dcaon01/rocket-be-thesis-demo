import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsEnum, IsOptional, IsString, Matches, ValidateNested } from "class-validator";
import { CompanyStatus } from "../enums/company-status.enum";
import { CompanyReferent } from "../classes/company-referent.class";
import { LegalAddress } from "../../resellers/classes/legal-address.class";
import { SDI_PATTERN, VAT_NUMBER_PATTERN } from "../../../commons/constants/fiscal-identifiers.constant";
import { normalizeSdi, normalizeVatNumber } from "../../../commons/formatting/fiscal-identifiers.helper";

export class UpdateCompanyDto {
  /** Name of the company. */
  @ApiPropertyOptional({
    description: "Name of the company.",
    example: "Acme Corporation",
    required: false,
  })
  @IsOptional()
  @IsString()
  name: string;

  /** Email of the company. */
  @ApiPropertyOptional({
    description: "Email of the company.",
    example: "test@test.com",
    required: false,
  })
  @IsOptional()
  @IsString()
  email: string;

  /** Certified electronic address of the company. */
  @ApiPropertyOptional({
    description: "Certified electronic address of the company.",
    example: "pec@example.com",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  pec?: string | null;

  /** Phone number of the company. */
  @ApiPropertyOptional({
    description: "Phone number of the company.",
    example: "+1234567890",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string | null;

  /** Address of the company. */
  @ApiPropertyOptional({
    description: "Address of the company.",
    example: "123 Main St, Anytown, USA",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  address?: string | null;

  /** VAT number of the company: 11 digits. */
  @ApiPropertyOptional({
    description: "VAT number of the company: 11 digits.",
    example: "12345678901",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Transform(normalizeVatNumber)
  @Matches(VAT_NUMBER_PATTERN, { message: "vatNumber must be 11 digits" })
  vatNumber?: string | null;

  /** SDI recipient code of the company, for electronic invoicing: 7 letters or digits. */
  @ApiPropertyOptional({
    description: "SDI recipient code of the company, for electronic invoicing: 7 letters or digits.",
    example: "ABC1234",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Transform(normalizeSdi)
  @Matches(SDI_PATTERN, { message: "sdi must be 7 letters or digits" })
  sdi?: string | null;

  /** Person to talk to at the company, kept as part of its records. */
  @ApiPropertyOptional({
    description: "Person to talk to at the company, kept as part of its records.",
    type: CompanyReferent,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyReferent)
  referent?: CompanyReferent | null;

  /** Status of the company. */
  @ApiPropertyOptional({
    description: "Status of the company.",
    example: "active",
    required: false,
  })
  @IsOptional()
  @IsEnum(CompanyStatus)
  status?: string;

  /** Structured legal address, needed on the fiscal documents and the contract. */
  @ApiPropertyOptional({
    description: "Structured legal address, needed on the fiscal documents and the contract.",
    type: LegalAddress,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LegalAddress)
  legalAddress?: LegalAddress | null;

  /** IBAN used for the SEPA direct debit. Required on the direct channel. */
  @ApiPropertyOptional({
    description: "IBAN used for the SEPA direct debit. Required on the direct channel.",
    example: "IT60X0542811101000000123456",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  iban?: string | null;

  /** Fiscal code, when the company has no VAT number or they differ. */
  @ApiPropertyOptional({
    description: "Fiscal code, when the company has no VAT number or they differ.",
    example: "02542970443",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  fiscalCode?: string | null;
}
