import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { SDI_PATTERN, VAT_NUMBER_PATTERN } from "../../../commons/constants/fiscal-identifiers.constant";
import { normalizeSdi, normalizeVatNumber } from "../../../commons/formatting/fiscal-identifiers.helper";
import { LegalAddress } from "../classes/legal-address.class";
import { IsNotEmpty, IsOptional, IsString, Matches, ValidateNested } from "class-validator";

/**
 * CreateResellerDto
 */
export class CreateResellerDto {
  /** Unique human-readable code of the reseller. */
  @ApiProperty({
    description: "Unique human-readable code of the reseller.",
    example: "RVD-001",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  code: string;

  /** Company name of the reseller. */
  @ApiProperty({
    description: "Company name of the reseller.",
    example: "Acme Reselling S.r.l.",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  companyName: string;

  /** Email of the reseller. */
  @ApiProperty({
    description: "Email of the reseller.",
    example: "test@test.com",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  email: string;

  /** VAT number of the reseller: 11 digits. */
  @ApiPropertyOptional({
    description: "VAT number of the reseller: 11 digits.",
    example: "12345678901",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(normalizeVatNumber)
  @Matches(VAT_NUMBER_PATTERN, { message: "vatNumber must be 11 digits" })
  vatNumber?: string;

  /** Certified electronic address of the reseller. */
  @ApiPropertyOptional({
    description: "Certified electronic address of the reseller.",
    example: "pec@example.com",
    required: false,
  })
  @IsOptional()
  @IsString()
  pec?: string;

  /** SDI recipient code of the reseller, for electronic invoicing: 7 letters or digits. */
  @ApiPropertyOptional({
    description: "SDI recipient code of the reseller, for electronic invoicing: 7 letters or digits.",
    example: "ABC1234",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(normalizeSdi)
  @Matches(SDI_PATTERN, { message: "sdi must be 7 letters or digits" })
  sdi?: string;

  /** Address of the reseller. */
  @ApiPropertyOptional({
    description: "Address of the reseller.",
    example: "123 Main St, Anytown, USA",
    required: false,
  })
  @IsOptional()
  @IsString()
  address?: string;

  /** Phone number of the reseller. */
  @ApiPropertyOptional({
    description: "Phone number of the reseller.",
    example: "+1234567890",
    required: false,
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  /** Code of the parent reseller that created this one. Absent when created by Keus. */
  @ApiPropertyOptional({
    description: "Code of the parent reseller that created this one. Absent when created by Keus. Immutable after creation.",
    example: "RVD-000",
    required: false,
  })
  @IsOptional()
  @IsString()
  createdBy?: string;

  /** Cognito sub of the Keus salesperson responsible for the reseller. */
  @ApiPropertyOptional({
    description: "Cognito sub of the Keus salesperson responsible for the reseller.",
    example: "c01c191c-7091-700c-34c4-3771542553e2",
    required: false,
  })
  @IsOptional()
  @IsString()
  assignedSalesId?: string;

  /** Display name of the Keus salesperson, denormalized for the listings. */
  @ApiPropertyOptional({
    description: "Display name of the Keus salesperson.",
    example: "Damiano Caon",
    required: false,
  })
  @IsOptional()
  @IsString()
  assignedSalesName?: string;

  /** S3 key of the reseller logo, rendered on the offers it presents. */
  @ApiPropertyOptional({
    description: "S3 key of the reseller logo.",
    example: "resellers/123e4567-e89b-12d3-a456-426614174000/logo.png",
    required: false,
  })
  @IsOptional()
  @IsString()
  logoS3Key?: string;

  /** Structured legal address, also used to place the reseller on the network map. */
  @ApiPropertyOptional({
    description: "Structured legal address.",
    type: LegalAddress,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LegalAddress)
  legalAddress?: LegalAddress;

  /** IBAN used for the SEPA direct debit. */
  @ApiPropertyOptional({
    description: "IBAN used for the SEPA direct debit.",
    example: "IT60X0542811101000000123456",
    required: false,
  })
  @IsOptional()
  @IsString()
  iban?: string;

  /** Fiscal code, when different from the VAT number. */
  @ApiPropertyOptional({
    description: "Fiscal code, when different from the VAT number.",
    example: "CNADMN90A01H501X",
    required: false,
  })
  @IsOptional()
  @IsString()
  fiscalCode?: string;
}
