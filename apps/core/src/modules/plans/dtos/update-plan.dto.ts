import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
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
import { PlanStatus } from "../enums/plan-status.enum";
import { PlanType } from "../enums/plan-type.enum";
import { TierType } from "../enums/tier-type.enum";

/**
 * DTO for updating an existing Plan.
 * Every field is optional; only provided fields are applied to the stored plan.
 * Changing `type` is supported but implies that the pricing fields of the
 * previous type become irrelevant and the new ones must be valid - this
 * cross-field consistency is enforced at the service layer.
 */
export class UpdatePlanDto {
  /** Human-readable name of the plan. */
  @ApiPropertyOptional({
    description: "Human-readable name of the plan.",
    example: "Professional - Annual",
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  /** Optional description of the plan. */
  @ApiPropertyOptional({
    description: "Optional description of the plan.",
    example: "Best for growing teams up to 200 seats.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  /** Discriminator controlling which pricing fields are relevant. */
  @ApiPropertyOptional({
    description: "Discriminator controlling which pricing fields are relevant.",
    enum: PlanType,
    required: false,
  })
  @IsOptional()
  @IsEnum(PlanType)
  type?: PlanType;

  /** Billing cadence. Required for recurring plans, omitted for one-time plans. */
  @ApiPropertyOptional({
    description: "Billing cadence. Required for recurring plans, omitted for one-time plans.",
    enum: BillingInterval,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval | null;

  /** ISO currency code used by the plan. */
  @ApiPropertyOptional({
    description: "ISO currency code used by the plan.",
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
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(TierType)
  tiersType?: TierType | null;

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
   *   - RECURRING_FLAT: per-interval amount (monthly when monthly, yearly when annual).
   *   - TIERED_VOLUME: optional monthly base fee billed alongside the tiered
   *     pricing; the backend scales it × 12 if `billingInterval` is annual.
   */
  @ApiPropertyOptional({
    description: "Flat price charged by the plan. ONE_TIME = one-shot. RECURRING_FLAT = per-interval. TIERED_VOLUME = optional monthly base fee (backend × 12 if annual).",
    example: 99,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseCost?: number | null;

  /** Lifecycle state of the plan. */
  @ApiPropertyOptional({
    description: "Lifecycle state of the plan.",
    enum: PlanStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(PlanStatus)
  status?: PlanStatus;

  /** Who the plan is intended for. */
  @ApiPropertyOptional({
    description: "Who the plan is intended for.",
    enum: PlanAudience,
    required: false,
  })
  @IsOptional()
  @IsEnum(PlanAudience)
  audience?: PlanAudience;

  /** Whether the plan is excluded from the Stripe sync. */
  @ApiPropertyOptional({
    description: "Whether the plan is excluded from the Stripe sync.",
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
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  termMonths?: number | null;

  /** Days before the renewal within which a cancellation takes effect only at the following one. */
  @ApiPropertyOptional({
    description: "Days before the renewal within which a cancellation takes effect only at the following one.",
    example: 30,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  noticeDays?: number | null;

  /** One-off activation fee in cents, charged when the line is delivered. */
  @ApiPropertyOptional({
    description: "One-off activation fee in cents, charged when the line is delivered. Separate from baseCost, which is the recurring part.",
    example: 50000,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  activationFeeCents?: number | null;

  /** Separately-priced assistance component, copied onto the orders and the contracts built on this plan. */
  @ApiPropertyOptional({
    description: "Separately-priced assistance component, copied onto the orders and the contracts built on this plan.",
    type: Assistance,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => Assistance)
  assistance?: Assistance | null;
}
