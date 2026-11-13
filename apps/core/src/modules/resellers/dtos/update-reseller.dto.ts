import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { SDI_PATTERN, VAT_NUMBER_PATTERN } from "../../../commons/constants/fiscal-identifiers.constant";
import { normalizeSdi, normalizeVatNumber } from "../../../commons/formatting/fiscal-identifiers.helper";
import { LegalAddress } from "../classes/legal-address.class";
import { IsEnum, IsOptional, IsString, Matches, ValidateNested } from "class-validator";
import { ResellerStatus } from "../enums/reseller-status.enum";

/**
 * UpdateResellerDto.
 * The createdBy field is intentionally absent: the parent pointer is immutable after creation.
 */
export class UpdateResellerDto {
  /** Code of the reseller: accepted only unchanged, since it is immutable after creation. */
  @ApiPropertyOptional({
    description: "Code of the reseller: accepted only unchanged, since it is immutable after creation.",
    example: "RVD-001",
    required: false,
  })
  @IsOptional()
  @IsString()
  code?: string;

  /** Company name of the reseller. */
  @ApiPropertyOptional({
    description: "Company name of the reseller.",
    example: "Acme Reselling S.r.l.",
    required: false,
  })
  @IsOptional()
  @IsString()
  companyName?: string;

  /** Email of the reseller. */
  @ApiPropertyOptional({
    description: "Email of the reseller.",
    example: "test@test.com",
    required: false,
  })
  @IsOptional()
  @IsString()
  email?: string;

  /** VAT number of the reseller: 11 digits. */
  @ApiPropertyOptional({
    description: "VAT number of the reseller: 11 digits.",
    example: "12345678901",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Transform(normalizeVatNumber)
  @Matches(VAT_NUMBER_PATTERN, { message: "vatNumber must be 11 digits" })
  vatNumber?: string | null;

  /** Certified electronic address of the reseller. */
  @ApiPropertyOptional({
    description: "Certified electronic address of the reseller.",
    example: "pec@example.com",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  pec?: string | null;

  /** SDI recipient code of the reseller, for electronic invoicing: 7 letters or digits. */
  @ApiPropertyOptional({
    description: "SDI recipient code of the reseller, for electronic invoicing: 7 letters or digits.",
    example: "ABC1234",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Transform(normalizeSdi)
  @Matches(SDI_PATTERN, { message: "sdi must be 7 letters or digits" })
  sdi?: string | null;

  /** Address of the reseller. */
  @ApiPropertyOptional({
    description: "Address of the reseller.",
    example: "123 Main St, Anytown, USA",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  address?: string | null;

  /** Phone number of the reseller. */
  @ApiPropertyOptional({
    description: "Phone number of the reseller.",
    example: "+1234567890",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string | null;

  /** Status of the reseller. */
  @ApiPropertyOptional({
    description: "Status of the reseller.",
    example: "ACTIVE",
    required: false,
  })
  @IsOptional()
  @IsEnum(ResellerStatus)
  status?: ResellerStatus;

  /** Cognito sub of the Keus salesperson responsible for the reseller. */
  @ApiPropertyOptional({
    description: "Cognito sub of the Keus salesperson responsible for the reseller.",
    example: "c01c191c-7091-700c-34c4-3771542553e2",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  assignedSalesId?: string | null;

  /** Display name of the Keus salesperson, denormalized for the listings. */
  @ApiPropertyOptional({
    description: "Display name of the Keus salesperson.",
    example: "Damiano Caon",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  assignedSalesName?: string | null;

  /** S3 key of the reseller logo, rendered on the offers it presents. */
  @ApiPropertyOptional({
    description: "S3 key of the reseller logo.",
    example: "resellers/123e4567-e89b-12d3-a456-426614174000/logo.png",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  logoS3Key?: string | null;

  /** Structured legal address, also used to place the reseller on the network map. */
  @ApiPropertyOptional({
    description: "Structured legal address.",
    type: LegalAddress,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LegalAddress)
  legalAddress?: LegalAddress | null;

  /** IBAN used for the SEPA direct debit. */
  @ApiPropertyOptional({
    description: "IBAN used for the SEPA direct debit.",
    example: "IT60X0542811101000000123456",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  iban?: string | null;

  /** Fiscal code, when different from the VAT number. */
  @ApiPropertyOptional({
    description: "Fiscal code, when different from the VAT number.",
    example: "CNADMN90A01H501X",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  fiscalCode?: string | null;
}
