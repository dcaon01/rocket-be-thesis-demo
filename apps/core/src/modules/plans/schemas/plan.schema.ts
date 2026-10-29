import { Schema } from "dynamoose";
import { Tier } from "../classes/tier.class";
import { BillingInterval } from "../enums/billing-interval.enum";
import { PlanAudience } from "../enums/plan-audience.enum";
import { PlanStatus } from "../enums/plan-status.enum";
import { PlanType } from "../enums/plan-type.enum";
import { TierType } from "../enums/tier-type.enum";

/**
 * Plan Schema.
 * A Plan represents a pricing configuration attached to a Product.
 * Plans supersede the fixed tiers array on Product, allowing a Product to
 * expose multiple, freely-shaped pricing options (tiered volume, one-time,
 * flat recurring). Each Plan is mirrored on Stripe through one or more
 * Stripe Price objects referenced via `stripePriceIds` / `stripeVolumePriceId`.
 * The table uses a composite key of `productId` (hashKey) + `id` (rangeKey)
 * so every plan belonging to a product can be retrieved with a single query.
 */
export const PlanSchema = new Schema({
  /** Identifier of the product this plan belongs to. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Identifier of the plan. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** Human-readable name of the plan. */
  name: {
    type: String,
    required: true,
  },
  /** Name as `searchKeyOf` stores it, sort key of the local nameIndex: written with the name. */
  normalizedName: {
    type: String,
    required: false,
    index: {
      name: "nameIndex",
      type: "local",
      project: true,
    },
  },
  /** Optional description of the plan. */
  description: {
    type: String,
    required: false,
    default: "",
  },
  /** Discriminator controlling which pricing fields are relevant. */
  type: {
    type: String,
    enum: Object.values(PlanType),
    required: true,
  },
  /** Billing cadence. Required for recurring plans, omitted for one-time plans. */
  billingInterval: {
    type: String,
    enum: Object.values(BillingInterval),
    required: false,
  },
  /** ISO currency code used by the plan (defaults to EUR). */
  currency: {
    type: String,
    required: true,
    default: "EUR",
  },
  /** Constraint dimension for tiered volume plans. */
  tiersType: {
    type: String,
    enum: Object.values(TierType),
    required: false,
  },
  /** Tiers for tiered volume plans. Empty for non-tiered plans. */
  tiers: {
    type: Array,
    schema: [{
      type: Object,
      schema: {
        minValue: { type: Number, required: false },
        maxValue: { type: Number, required: false },
        price: { type: Number, required: true },
      },
    }],
    required: true,
    default: [],
  },
  /**
   * Flat amount charged by the plan. Semantics depend on `type`:
   *   - ONE_TIME: one-shot amount paid at checkout. Required.
   *   - RECURRING_FLAT: amount billed every `billingInterval`, expressed in the
   *     currency of that interval (i.e. monthly value when monthly, yearly value
   *     when annual). The backend passes it to Stripe as-is. Required.
   *   - TIERED_VOLUME: optional flat base fee billed alongside the per-seat
   *     tiered pricing. Always expressed as a MONTHLY amount; the backend
   *     multiplies it by 12 when `billingInterval` is annual.
   */
  baseCost: {
    type: Number,
    required: false,
  },
  /** Stripe Product id mirroring this plan. Populated after Stripe sync. */
  stripeProductId: {
    type: String,
    required: false,
  },
  /** Stripe Price ids mirroring this plan's pricing. Populated after Stripe sync. */
  stripePriceIds: {
    type: Array,
    schema: [String],
    required: true,
    default: [],
  },
  /** Stripe Price id for the native volume-tiered price, when applicable. */
  stripeVolumePriceId: {
    type: String,
    required: false,
  },
  /**
   * Stripe Price id for the flat base-fee component, when applicable.
   * Populated only for TIERED_VOLUME plans whose baseCost is > 0: in that
   * case the subscription bills both the tiered per-seat price and a fixed
   * recurring base fee on the same interval.
   */
  stripeBasePriceId: {
    type: String,
    required: false,
  },
  /** Stripe Product of the activation fee, kept apart so the activation discount touches only it. */
  stripeActivationProductId: {
    type: String,
    required: false,
  },
  /** Stripe one-time Price of the activation fee. */
  stripeActivationPriceId: {
    type: String,
    required: false,
  },
  /** Stripe Product of the assistance component, kept apart because discounts never touch it. */
  stripeAssistanceProductId: {
    type: String,
    required: false,
  },
  /** Stripe one-time Price of the assistance component. */
  stripeAssistancePriceId: {
    type: String,
    required: false,
  },
  /**
   * One-off activation fee in cents, charged when the line is delivered.
   * Separate from `baseCost`, which is the recurring part: the reseller
   * discounts apply to the two with different percentages.
   */
  activationFeeCents: {
    type: Number,
    required: false,
  },
  /**
   * Separately-priced assistance component inherited by the orders and the
   * contracts built on this plan. Same shape as `contract.assistance`, so
   * carrying it over is a copy.
   */
  assistance: {
    type: Object,
    required: false,
    schema: {
      /** Assistance amount in cents. */
      amountCents: { type: Number, required: true },
      /** Human-readable label rendered on the offer and on the contract. */
      label: { type: String, required: false },
    },
  },
  /** Lifecycle state of the plan. */
  status: {
    type: String,
    enum: Object.values(PlanStatus),
    required: true,
    default: PlanStatus.Draft,
  },
  /** Who the plan is intended for (client, professional or reseller). */
  audience: {
    type: String,
    enum: Object.values(PlanAudience),
    required: true,
    default: PlanAudience.Company,
  },
  /** `${audience}#${status}`, sort key of the local audienceIndex: rewritten whenever either part changes. */
  audienceStatus: {
    type: String,
    required: false,
    index: {
      name: "audienceIndex",
      type: "local",
      project: true,
    },
  },
  /**
   * Whether the plan is excluded from the Stripe sync. Off-Stripe plans
   * activate locally without creating any Stripe Product/Price: they price
   * downstream contracts that never go through a Stripe checkout.
   */
  offStripe: {
    type: Boolean,
    required: true,
    default: false,
  },
  /**
   * Default fixed term in months for ONE_TIME plans (una-tantum). A contract on
   * this plan schedules an END at validityDate + termMonths (overridable per
   * contract). Meaningful only for ONE_TIME plans; rejected on recurring plans.
   */
  termMonths: {
    type: Number,
    required: false,
  },
  /** Days before the renewal within which a cancellation takes effect only at the following one. */
  noticeDays: {
    type: Number,
    required: false,
  },
}, {
  timestamps: true,
});

/**
 * Plan Key Interface.
 * Composite key used by Dynamoose to address a single plan.
 */
export interface PlanKey {
  /** Identifier of the product this plan belongs to. */
  productId: string;
  /** Identifier of the plan. */
  id: string;
}

/**
 * Plan Interface.
 * Full shape of a plan entity as stored in DynamoDB.
 */
export interface Plan extends PlanKey {
  /** Human-readable name of the plan. */
  name: string;
  /** Name normalized for the search, sort key of nameIndex. */
  normalizedName?: string;
  /** Optional description of the plan. */
  description?: string;
  /** Discriminator controlling which pricing fields are relevant. */
  type: PlanType;
  /** Billing cadence. Required for recurring plans, omitted for one-time plans. */
  billingInterval?: BillingInterval;
  /** ISO currency code used by the plan. */
  currency: string;
  /** Constraint dimension for tiered volume plans. */
  tiersType?: TierType;
  /** Tiers for tiered volume plans. Empty for non-tiered plans. */
  tiers: Tier[];
  /**
   * Flat amount charged by the plan. Semantics depend on `type`:
   *   - ONE_TIME: one-shot amount paid at checkout.
   *   - RECURRING_FLAT: amount billed every `billingInterval`, expressed in the
   *     currency of that interval.
   *   - TIERED_VOLUME: optional flat base fee billed alongside the tiered
   *     pricing. Always a MONTHLY amount; the backend scales it × 12 when
   *     `billingInterval` is annual.
   */
  baseCost?: number;
  /** Stripe Product id mirroring this plan. */
  stripeProductId?: string;
  /** Stripe Price ids mirroring this plan's pricing. */
  stripePriceIds: string[];
  /** Stripe Price id for the native volume-tiered price, when applicable. */
  stripeVolumePriceId?: string;
  /** Stripe Price id for the flat base-fee component on TIERED_VOLUME plans with baseCost > 0. */
  stripeBasePriceId?: string;
  /** Stripe Product of the activation fee. */
  stripeActivationProductId?: string;
  /** Stripe one-time Price of the activation fee. */
  stripeActivationPriceId?: string;
  /** Stripe Product of the assistance component. */
  stripeAssistanceProductId?: string;
  /** Stripe one-time Price of the assistance component. */
  stripeAssistancePriceId?: string;
  /** One-off activation fee in cents, charged when the line is delivered. */
  activationFeeCents?: number;
  /** Separately-priced assistance component inherited by orders and contracts. */
  assistance?: {
    /** Assistance amount in cents. */
    amountCents: number;
    /** Human-readable label rendered on the offer and on the contract. */
    label?: string;
  };
  /** Lifecycle state of the plan. */
  status: PlanStatus;
  /** Who the plan is intended for (client, professional or reseller). */
  audience: PlanAudience;
  /** `${audience}#${status}`, sort key of audienceIndex. */
  audienceStatus?: string;
  /** Whether the plan is excluded from the Stripe sync. */
  offStripe: boolean;
  /** Default fixed term in months for ONE_TIME plans (una-tantum). */
  termMonths?: number;
  /** Days before the renewal within which a cancellation takes effect only at the following one. */
  noticeDays?: number;
}
