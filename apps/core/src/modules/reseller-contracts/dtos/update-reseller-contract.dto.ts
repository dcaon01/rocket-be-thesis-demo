import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsString, ValidateNested } from "class-validator";
import { ResellerContractMargin } from "../classes/reseller-contract-margin.class";
import { ResellerFee } from "../classes/reseller-fee.class";
import { ResellerContractStatus } from "../enums/reseller-contract-status.enum";

/**
 * Data Transfer Object for updating a reseller contract.
 * A status change comes alone, except the signature, which brings the signed agreement.
 * The terms (products, fee, margin, start date) are editable only while the contract is a
 * DRAFT: past signing, new terms mean a new contract.
 */
export class UpdateResellerContractDto {
  /** New status of the contract. */
  @ApiPropertyOptional({
    description: "New status of the contract.",
    enum: ResellerContractStatus,
    example: ResellerContractStatus.EndedAtRenewal,
    required: false,
  })
  @IsOptional()
  @IsEnum(ResellerContractStatus)
  status?: ResellerContractStatus;

  /** Products the reseller is enabled to sell under the contract. Editable only on DRAFT contracts. */
  @ApiPropertyOptional({
    description: "Products the reseller is enabled to sell under the contract. Editable only on DRAFT contracts.",
    example: ["product-id-1", "product-id-2"],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  productIds?: string[];

  /** Margin of the reseller. Editable only on DRAFT contracts. */
  @ApiPropertyOptional({
    description: "Margin of the reseller. Editable only on DRAFT contracts.",
    type: ResellerContractMargin,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ResellerContractMargin)
  margin?: ResellerContractMargin;

  /** Fee of the contract by year. Editable only on DRAFT contracts. */
  @ApiPropertyOptional({
    description: "Fee of the contract by year. Editable only on DRAFT contracts.",
    type: ResellerFee,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ResellerFee)
  fee?: ResellerFee;

  /** Start date of the contract (ISO string). Editable only on a DRAFT that does not succeed another contract. */
  @ApiPropertyOptional({
    description: "Start date of the contract (ISO string). Editable only on a DRAFT that does not succeed another contract.",
    example: "2026-10-01T00:00:00.000Z",
    required: false,
  })
  @IsOptional()
  @IsString()
  validityDate?: string;

  /** S3 key of the signed framework agreement, uploaded through a presigned URL. Required with the SIGNED status, and only there. */
  @ApiPropertyOptional({
    description: "S3 key of the signed framework agreement, uploaded through a presigned URL. Required with the SIGNED status, and only there.",
    example: "resellers/5f0c/contracts/9a1b/signed-contract.pdf",
    required: false,
  })
  @IsOptional()
  @IsString()
  signedContractS3Key?: string;
}
