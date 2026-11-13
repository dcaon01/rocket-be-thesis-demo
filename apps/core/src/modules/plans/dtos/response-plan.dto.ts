import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Assistance } from "../classes/assistance.class";
import { Tier } from "../classes/tier.class";
import { BillingInterval } from "../enums/billing-interval.enum";
import { PlanAudience } from "../enums/plan-audience.enum";
import { PlanStatus } from "../enums/plan-status.enum";
import { PlanType } from "../enums/plan-type.enum";
import { TierType } from "../enums/tier-type.enum";

/**
 * Data Transfer Object representing a plan response.
 */
export class ResponsePlanDto {
  /** Identifier of the product this plan belongs to. */
  @ApiProperty({
    description: "Identifier of the product this plan belongs to.",
    example: "60d21b4667d0d8992e610c85",
    required: true,
  })
  productId: string;

  /** Identifier of the plan. */
  @ApiProperty({
    description: "Identifier of the plan.",
    example: "60d21b4667d0d8992e610c90",
    required: true,
  })
  id: string;

  /** Human-readable name of the plan. */
  @ApiProperty({
    description: "Human-readable name of the plan.",
    example: "Professional - Annual",
    required: true,
  })
  name: string;

  /** Optional description of the plan. */
  @ApiPropertyOptional({
    description: "Optional description of the plan.",
    example: "Best for growing teams up to 200 seats.",
    required: false,
  })
  description?: string;

  /** Discriminator controlling which pricing fields are relevant. */
  @ApiProperty({
    description: "Discriminator controlling which pricing fields are relevant.",
    enum: PlanType,
    example: PlanType.TieredVolume,
    required: true,
  })
  type: PlanType;

  /** Billing cadence. Absent for one-time plans. */
  @ApiPropertyOptional({
    description: "Billing cadence. Absent for one-time plans.",
    enum: BillingInterval,
    required: false,
  })
  billingInterval?: BillingInterval;

  /** ISO currency code used by the plan. */
  @ApiProperty({
    description: "ISO currency code used by the plan.",
    example: "EUR",
    required: true,
  })
  currency: string;

  /** Constraint dimension for tiered volume plans. */
  @ApiPropertyOptional({
    description: "Constraint dimension for tiered volume plans.",
    enum: TierType,
    required: false,
  })
  tiersType?: TierType;

  /** Tiers for tiered volume plans. Empty for non-tiered plans. */
  @ApiProperty({
    description: "Tiers for tiered volume plans. Empty for non-tiered plans.",
    type: [Tier],
    required: true,
  })
  tiers: Tier[];

  /**
   * Flat price charged by the plan, as stored. Semantics depend on `type`:
   *   - ONE_TIME: one-shot amount paid at checkout.
   *   - RECURRING_FLAT: per-interval amount (monthly when monthly, yearly when annual).
   *   - TIERED_VOLUME: optional monthly base fee billed alongside the tiered pricing
   *     (the backend scales it × 12 internally when pushing to Stripe with annual interval).
   */
  @ApiPropertyOptional({
    description: "Flat price charged by the plan. ONE_TIME = one-shot. RECURRING_FLAT = per-interval. TIERED_VOLUME = optional monthly base fee.",
    example: 99,
    required: false,
  })
  baseCost?: number;

  /** Stripe Product id mirroring this plan. */
  @ApiPropertyOptional({
    description: "Stripe Product id mirroring this plan.",
    example: "prod_QwErTyUiOp",
    required: false,
  })
  stripeProductId?: string;

  /** Stripe Price ids mirroring this plan's pricing. */
  @ApiProperty({
    description: "Stripe Price ids mirroring this plan's pricing.",
    example: ["price_1OaBcDeFgHiJ"],
    required: true,
    type: [String],
  })
  stripePriceIds: string[];

  /** Stripe Price id for the native volume-tiered price, when applicable. */
  @ApiPropertyOptional({
    description: "Stripe Price id for the native volume-tiered price, when applicable.",
    example: "price_1OaBcDeFgHiJ",
    required: false,
  })
  stripeVolumePriceId?: string;

  /** Stripe Price id for the flat base-fee component on TIERED_VOLUME plans with baseCost > 0. */
  @ApiPropertyOptional({
    description: "Stripe Price id for the flat base-fee component on TIERED_VOLUME plans with baseCost > 0.",
    example: "price_1OaBcDeFgHiJ",
    required: false,
  })
  stripeBasePriceId?: string;

  /** Stripe Product of the activation fee, kept apart so the activation discount touches only it. */
  @ApiPropertyOptional({
    description: "Stripe Product of the activation fee, kept apart so the activation discount touches only it.",
    example: "prod_1OaBcDeFgHiJ",
    required: false,
  })
  stripeActivationProductId?: string;

  /** Stripe one-time Price of the activation fee, on a Stripe product of its own. */
  @ApiPropertyOptional({
    description: "Stripe one-time Price of the activation fee, on a Stripe product of its own.",
    example: "price_1OaBcDeFgHiJ",
    required: false,
  })
  stripeActivationPriceId?: string;

  /** Stripe one-time Price of the assistance component, on a Stripe product of its own. */
  @ApiPropertyOptional({
    description: "Stripe one-time Price of the assistance component, on a Stripe product of its own.",
    example: "price_1OaBcDeFgHiJ",
    required: false,
  })
  stripeAssistancePriceId?: string;

  /** Lifecycle state of the plan. */
  @ApiProperty({
    description: "Lifecycle state of the plan.",
    enum: PlanStatus,
    example: PlanStatus.Active,
    required: true,
  })
  status: PlanStatus;

  /** Who the plan is intended for. */
  @ApiProperty({
    description: "Who the plan is intended for.",
    enum: PlanAudience,
    example: PlanAudience.Company,
    required: true,
  })
  audience: PlanAudience;

  /** Whether the plan is excluded from the Stripe sync. */
  @ApiProperty({
    description: "Whether the plan is excluded from the Stripe sync.",
    example: false,
    required: true,
  })
  offStripe: boolean;

  /** Default fixed term in months for ONE_TIME plans (una-tantum). */
  @ApiPropertyOptional({
    description: "Default fixed term in months for ONE_TIME plans (una-tantum).",
    example: 60,
    required: false,
  })
  termMonths?: number;

  /** Days before the renewal within which a cancellation takes effect only at the following one. */
  @ApiPropertyOptional({
    description: "Days before the renewal within which a cancellation takes effect only at the following one.",
    example: 30,
    required: false,
  })
  noticeDays?: number;

  /** The date and time when the plan was created. */
  @ApiProperty({
    description: "The date and time when the plan was created.",
    example: "2024-01-01T00:00:00Z",
    required: true,
  })
  createdAt: string;

  /** The date and time when the plan was last updated. */
  @ApiProperty({
    description: "The date and time when the plan was last updated.",
    example: "2024-01-02T00:00:00Z",
    required: true,
  })
  updatedAt: string;

  /** One-off activation fee in cents, charged when the line is delivered. */
  @ApiPropertyOptional({
    description: "One-off activation fee in cents, charged when the line is delivered.",
    example: 50000,
    required: false,
  })
  activationFeeCents?: number;

  /** Separately-priced assistance component, copied onto the orders and the contracts built on this plan. */
  @ApiPropertyOptional({
    description: "Separately-priced assistance component, copied onto the orders and the contracts built on this plan.",
    type: Assistance,
    required: false,
  })
  assistance?: Assistance;
}
