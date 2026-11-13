import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, Max, Min } from "class-validator";
import { ResellerTier } from "../enums/reseller-tier.enum";

/**
 * Default economic terms of a commercial tier.
 * They live in a table and are editable through the API because they are
 * commercial terms, not code: changing a percentage must not require a release.
 * The values are copied onto the reseller contract when it is opened, so editing
 * a tier never shifts the terms of a contract already signed.
 */
export class UpsertResellerTierConfigDto {
  /** Subscription fee in cents for the first year. */
  @ApiProperty({
    description: "Subscription fee in cents for the first year.",
    example: 150000,
    required: true,
  })
  @IsNumber()
  @Min(0)
  firstYearFeeCents: number;

  /** Subscription fee in cents for the second year. */
  @ApiProperty({
    description: "Subscription fee in cents for the second year.",
    example: 200000,
    required: true,
  })
  @IsNumber()
  @Min(0)
  secondYearFeeCents: number;

  /** Subscription fee in cents from the third year on. */
  @ApiProperty({
    description: "Subscription fee in cents from the third year on.",
    example: 250000,
    required: true,
  })
  @IsNumber()
  @Min(0)
  ongoingFeeCents: number;

  /** Discount percentage applied to activation amounts. */
  @ApiProperty({
    description: "Discount percentage applied to activation amounts.",
    example: 40,
    required: true,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  activationDiscountPercent: number;

  /** Discount percentage applied to recurring amounts. */
  @ApiProperty({
    description: "Discount percentage applied to recurring amounts.",
    example: 40,
    required: true,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  subscriptionDiscountPercent: number;

  /** Discount percentage applied to customization amounts. */
  @ApiProperty({
    description: "Discount percentage applied to customization amounts.",
    example: 15,
    required: true,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  customizationDiscountPercent: number;
}

/**
 * Data Transfer Object representing the configuration of a commercial tier.
 */
export class ResponseResellerTierConfigDto extends UpsertResellerTierConfigDto {
  /** Commercial tier the configuration belongs to. */
  @ApiProperty({
    description: "Commercial tier the configuration belongs to.",
    enum: ResellerTier,
    example: ResellerTier.Gold,
    required: true,
  })
  tier: ResellerTier;
}
