import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Assistance } from "../../plans/classes/assistance.class";
import { Tier } from "../../plans/classes/tier.class";
import { BillingInterval } from "../../plans/enums/billing-interval.enum";
import { PlanType } from "../../plans/enums/plan-type.enum";
import { TierType } from "../../plans/enums/tier-type.enum";

/**
 * DTO describing the Rocket Plan that must be mirrored on Stripe.
 * Fed into {@link StripeService.createStripePricingForPlan}.
 * The set of relevant fields depends on `type`:
 *   - TIERED_VOLUME  → `tiers`, `tiersType`, `billingInterval` are used. `baseCost` is
 *                      OPTIONAL: when > 0 it produces an extra flat-base Stripe Price
 *                      billed alongside the tiered per-seat price.
 *                      Both `tier.price` and `baseCost` are MONTHLY amounts; the service
 *                      multiplies them × 12 internally when `billingInterval` is annual.
 *   - ONE_TIME       → `baseCost` is used; `billingInterval` ignored. As-is value.
 *   - RECURRING_FLAT → `baseCost`, `billingInterval` are used. `baseCost` is the
 *                      per-interval amount (monthly value when monthly, yearly value
 *                      when annual) and is passed to Stripe as-is.
 * Cross-field consistency is enforced by the caller ({@link PlansService}).
 */
export class CreateStripePlanDto {
  /** Display name for the Stripe Product that mirrors the plan. */
  @ApiProperty({
    description: "Display name for the Stripe Product that mirrors the plan.",
    example: "Professional - Annual",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  planName: string;

  /** Optional description to apply to the Stripe Product. */
  @ApiPropertyOptional({
    description: "Optional description to apply to the Stripe Product.",
    example: "Best for growing teams up to 200 seats.",
    required: false,
  })
  @IsOptional()
  @IsString()
  planDescription?: string;

  /** Identifier of the Rocket Product that owns the plan (stored as Stripe metadata). */
  @ApiProperty({
    description: "Identifier of the Rocket Product that owns the plan (stored as Stripe metadata).",
    example: "60d21b4667d0d8992e610c85",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  productId: string;

  /** Stripe secret API key of the account that must host the Product/Price. Resolved by the caller from the owning Rocket Product. */
  @ApiProperty({
    description: "Stripe secret API key of the account that must host the Product/Price.",
    example: "sk_live_xxx",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  stripeApiKey: string;

  /** Discriminator that drives which pricing shape is created on Stripe. */
  @ApiProperty({
    description: "Discriminator that drives which pricing shape is created on Stripe.",
    enum: PlanType,
    example: PlanType.TieredVolume,
    required: true,
  })
  @IsNotEmpty()
  @IsEnum(PlanType)
  type: PlanType;

  /** ISO currency code used by the Stripe Price (lowercased before the API call). */
  @ApiProperty({
    description: "ISO currency code used by the Stripe Price (lowercased before the API call).",
    example: "EUR",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  currency: string;

  /** Billing cadence. Required for TIERED_VOLUME and RECURRING_FLAT, omitted for ONE_TIME. */
  @ApiPropertyOptional({
    description: "Billing cadence. Required for TIERED_VOLUME and RECURRING_FLAT, omitted for ONE_TIME.",
    enum: BillingInterval,
    example: BillingInterval.Annual,
    required: false,
  })
  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  /** Constraint dimension for TIERED_VOLUME plans (stored as Stripe metadata). */
  @ApiPropertyOptional({
    description: "Constraint dimension for TIERED_VOLUME plans (stored as Stripe metadata).",
    enum: TierType,
    required: false,
  })
  @IsOptional()
  @IsEnum(TierType)
  tiersType?: TierType;

  /** Tiers for TIERED_VOLUME plans, mapped to Stripe's volume-tiered pricing shape. */
  @ApiPropertyOptional({
    description: "Tiers for TIERED_VOLUME plans, mapped to Stripe's volume-tiered pricing shape.",
    example: [{ minValue: 1, maxValue: 50, price: 10 }],
    required: false,
    isArray: true,
    type: Tier,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Tier)
  tiers?: Tier[];

  /**
   * Flat price charged by the plan. Semantics depend on `type`:
   *   - ONE_TIME: one-shot amount paid at checkout (passed as-is).
   *   - RECURRING_FLAT: per-interval amount (monthly when monthly, yearly when annual);
   *     passed to Stripe as-is.
   *   - TIERED_VOLUME: optional monthly base fee billed alongside the tiered pricing;
   *     scaled × 12 internally when `billingInterval` is annual.
   */
  @ApiPropertyOptional({
    description: "Flat price charged by the plan. ONE_TIME = one-shot. RECURRING_FLAT = per-interval. TIERED_VOLUME = optional monthly base fee (× 12 if annual).",
    example: 99,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  baseCost?: number;

  /** One-off activation fee in cents: a one-time price on a Stripe product of its own, so its discount touches only it. */
  @ApiPropertyOptional({
    description: "One-off activation fee in cents, mirrored as a one-time price on a Stripe product of its own.",
    example: 50000,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  activationFeeCents?: number;

  /** Assistance component, paid once for the whole term of the order: a one-time price on a Stripe product of its own. */
  @ApiPropertyOptional({
    description: "Assistance component, paid once for the whole term of the order, mirrored as a one-time price on a Stripe product of its own.",
    type: () => Assistance,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => Assistance)
  assistance?: Assistance;
}
