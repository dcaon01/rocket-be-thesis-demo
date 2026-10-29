import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { Assistance } from "../classes/assistance.class";
import { Tier } from "../classes/tier.class";
import { BillingInterval } from "../enums/billing-interval.enum";
import { PlanAudience } from "../enums/plan-audience.enum";
import { PlanType } from "../enums/plan-type.enum";
import { TierType } from "../enums/tier-type.enum";

/**
 * DTO for creating a new Plan.
 * The set of pricing fields that must be provided depends on `type`:
 *   - TIERED_VOLUME: `tiersType` and `tiers` are required, `billingInterval` is required;
 *                    `baseCost` is OPTIONAL and represents a flat base fee billed alongside
 *                    the tiered pricing. Both `tier.price` and `baseCost` are MONTHLY
 *                    amounts — the backend scales them × 12 when the interval is annual.
 *   - ONE_TIME:      `baseCost` is required; `billingInterval` must be omitted.
 *                    `baseCost` is the one-shot amount paid at checkout.
 *   - RECURRING_FLAT:`baseCost` and `billingInterval` are required. `baseCost` is the
 *                    per-interval amount (monthly value if monthly, yearly value if annual).
 * Cross-field validation is enforced at the service layer at activation time;
 * Drafts may be created with partial pricing data.
 */
export class CreatePlanDto {
  /** Human-readable name of the plan. */
  @ApiProperty({
    description: "Human-readable name of the plan.",
    example: "Professional - Annual",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  /** Optional description of the plan. */
  @ApiPropertyOptional({
    description: "Optional description of the plan.",
    example: "Best for growing teams up to 200 seats.",
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  /** Discriminator controlling which pricing fields are relevant. */
  @ApiProperty({
    description: "Discriminator controlling which pricing fields are relevant.",
    enum: PlanType,
    example: PlanType.TieredVolume,
    required: true,
  })
  @IsNotEmpty()
  @IsEnum(PlanType)
  type: PlanType;

  /** Billing cadence. Required for recurring plans, omitted for one-time plans. */
  @ApiPropertyOptional({
    description: "Billing cadence. Required for recurring plans, omitted for one-time plans.",
    enum: BillingInterval,
    example: BillingInterval.Annual,
    required: false,
  })
  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  /** ISO currency code used by the plan (defaults to EUR). */
  @ApiPropertyOptional({
    description: "ISO currency code used by the plan (defaults to EUR).",
    example: "EUR",
    required: false,
  })
  @IsOptional()
  @IsString()
  currency?: string;

  /** Constraint dimension for tiered volume plans. */
  @ApiPropertyOptional({
    description: "Constraint dimension for tiered volume plans.",
    enum: TierType,
    example: TierType.Seats,
    required: false,
  })
  @IsOptional()
  @IsEnum(TierType)
  tiersType?: TierType;

  /** Tiers for tiered volume plans. */
  @ApiPropertyOptional({
    description: "Tiers for tiered volume plans.",
    type: [Tier],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Tier)
  tiers?: Tier[];

  /**
   * Flat price charged by the plan. Semantics depend on `type`:
   *   - ONE_TIME: one-shot amount paid at checkout.
   *   - RECURRING_FLAT: per-interval amount (monthly value when monthly, yearly
   *     when annual); passed to Stripe as-is.
   *   - TIERED_VOLUME: optional flat base fee billed alongside the tiered
   *     pricing. Always a MONTHLY amount; the backend scales it × 12 if annual.
   */
  @ApiPropertyOptional({
    description: "Flat price charged by the plan. ONE_TIME = one-shot. RECURRING_FLAT = per-interval. TIERED_VOLUME = optional monthly base fee (backend × 12 if annual).",
    example: 99,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseCost?: number;

  /** Who the plan is intended for (defaults to CLIENT). */
  @ApiPropertyOptional({
    description: "Who the plan is intended for (defaults to CLIENT).",
    enum: PlanAudience,
    example: PlanAudience.Company,
    required: false,
  })
  @IsOptional()
  @IsEnum(PlanAudience)
  audience?: PlanAudience;

  /** Whether the plan is excluded from the Stripe sync (defaults to false). */
  @ApiPropertyOptional({
    description: "Whether the plan is excluded from the Stripe sync (defaults to false).",
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  offStripe?: boolean;

  /** Default fixed term in months for ONE_TIME plans (una-tantum). Only valid for ONE_TIME. */
  @ApiPropertyOptional({
    description: "Default fixed term in months for ONE_TIME plans (una-tantum). Schedules a contract END at validityDate + termMonths. Only valid for ONE_TIME plans.",
    example: 60,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  termMonths?: number;

  /** Days before the renewal within which a cancellation takes effect only at the following one. */
  @ApiPropertyOptional({
    description: "Days before the renewal within which a cancellation takes effect only at the following one.",
    example: 30,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  noticeDays?: number;

  /** One-off activation fee in cents, charged when the line is delivered. */
  @ApiPropertyOptional({
    description: "One-off activation fee in cents, charged when the line is delivered. Separate from baseCost, which is the recurring part.",
    example: 50000,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  activationFeeCents?: number;

  /** Separately-priced assistance component, copied onto the orders and the contracts built on this plan. */
  @ApiPropertyOptional({
    description: "Separately-priced assistance component, copied onto the orders and the contracts built on this plan.",
    type: Assistance,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => Assistance)
  assistance?: Assistance;
}
