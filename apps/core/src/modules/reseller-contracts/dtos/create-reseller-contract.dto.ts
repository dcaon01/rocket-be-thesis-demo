import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayNotEmpty, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from "class-validator";
import { ResellerContractMargin } from "../classes/reseller-contract-margin.class";
import { ResellerFee } from "../classes/reseller-fee.class";
import { ResellerTier } from "../../resellers/enums/reseller-tier.enum";

/**
 * Data Transfer Object for opening a contract with a reseller.
 * The products come with the request. The service fills the rest from the partner tier: the fee of each year and the margins.
 * The fee and the margins sent here win over those of the tier, for terms agreed in a negotiation.
 * When the reseller has a contract in force, the new one starts at its renewal
 * date and `validityDate` is ignored.
 */
export class CreateResellerContractDto {
  /** Partner tier of the contract. */
  @ApiProperty({
    description: "Partner tier of the contract.",
    enum: ResellerTier,
    example: ResellerTier.Gold,
    required: true,
  })
  @IsNotEmpty()
  @IsEnum(ResellerTier)
  tier: ResellerTier;

  /** Start date of the contract (ISO string), used only when the reseller has no contract in force. Defaults to now. */
  @ApiPropertyOptional({
    description: "Start date of the contract (ISO string), used only when the reseller has no contract in force. Defaults to now.",
    example: "2026-10-01T00:00:00.000Z",
    required: false,
  })
  @IsOptional()
  @IsString()
  validityDate?: string;

  /** Margin of the reseller, when it differs from the one of the tier. */
  @ApiPropertyOptional({
    description: "Margin of the reseller, when it differs from the one of the tier.",
    type: ResellerContractMargin,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ResellerContractMargin)
  margin?: ResellerContractMargin;

  /** Products the reseller is enabled to sell under the contract: the reseller takes them when the contract is in force. */
  @ApiProperty({
    description: "Products the reseller is enabled to sell under the contract: the reseller takes them when the contract is in force.",
    example: ["product-id-1", "product-id-2"],
    required: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  productIds: string[];

  /** Fee of the contract, when it differs from the one of the tier. */
  @ApiPropertyOptional({
    description: "Fee of the contract, when it differs from the one of the tier.",
    type: ResellerFee,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ResellerFee)
  fee?: ResellerFee;
}
