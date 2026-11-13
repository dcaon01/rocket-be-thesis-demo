import { Schema } from "dynamoose";
import { ResellerTier } from "../enums/reseller-tier.enum";

/**
 * Reseller Tier Config Schema.
 * Default economic terms of each commercial tier: the fee the reseller pays to be
 * allowed to sell, one amount for the first year, one for the second and one from
 * the third on (Gold: 1,500, 2,000 and 2,500 euro), and the three margins of the
 * reseller. The Silver fee is zero.
 *
 * Each amount above zero has a yearly price on the Stripe account of Keus, created
 * when the tier is saved; a new amount gets a new price, since Stripe prices never
 * change. The fee is not a plan: plans are the price lists of the products.
 *
 * It is a table and not a constant because these are commercial terms, not code:
 * changing a percentage must not require a release. The values are copied onto
 * the reseller contract when it is opened, so a signed contract never shifts
 * when the tier is edited.
 *
 * Three rows only, one per tier, so the partition key is the tier itself.
 */
export const ResellerTierConfigSchema = new Schema({
  /** Commercial tier the configuration belongs to. */
  tier: {
    type: String,
    hashKey: true,
    enum: Object.values(ResellerTier),
    required: true,
  },
  /** Subscription fee in cents for the first year. */
  firstYearFeeCents: {
    type: Number,
    required: true,
  },
  /** Subscription fee in cents for the second year. */
  secondYearFeeCents: {
    type: Number,
    required: true,
  },
  /** Subscription fee in cents from the third year on. */
  ongoingFeeCents: {
    type: Number,
    required: true,
  },
  /** Discount percentage applied to activation amounts. */
  activationDiscountPercent: {
    type: Number,
    required: true,
  },
  /** Discount percentage applied to recurring amounts. */
  subscriptionDiscountPercent: {
    type: Number,
    required: true,
  },
  /** Discount percentage applied to customization amounts. */
  customizationDiscountPercent: {
    type: Number,
    required: true,
  },
  /** Stripe product of the tier fee, on the account of Keus. Absent while the fee is zero. */
  stripeProductId: {
    type: String,
    required: false,
  },
  /** Yearly Stripe prices of the three amounts. Absent while the fee is zero. */
  stripePriceIds: {
    type: Object,
    schema: {
      /** Price of the first year. */
      firstYear: { type: String, required: true },
      /** Price of the second year. */
      secondYear: { type: String, required: true },
      /** Price from the third year on. */
      ongoing: { type: String, required: true },
    },
    required: false,
  },
},
{
  timestamps: true,
});

/**
 * Reseller Tier Config Key Interface.
 */
export interface ResellerTierConfigKey {
  /** Commercial tier the configuration belongs to. */
  tier: ResellerTier;
}

/** Yearly Stripe prices of a reseller fee, one per amount. */
export interface FeePriceIds {
  /** Price of the first year. */
  firstYear: string;
  /** Price of the second year. */
  secondYear: string;
  /** Price from the third year on. */
  ongoing: string;
}

/**
 * Reseller Tier Config Interface.
 */
export interface ResellerTierConfig extends ResellerTierConfigKey {
  /** Subscription fee in cents for the first year. */
  firstYearFeeCents: number;
  /** Subscription fee in cents for the second year. */
  secondYearFeeCents: number;
  /** Subscription fee in cents from the third year on. */
  ongoingFeeCents: number;
  /** Discount percentage applied to activation amounts. */
  activationDiscountPercent: number;
  /** Discount percentage applied to recurring amounts. */
  subscriptionDiscountPercent: number;
  /** Discount percentage applied to customization amounts. */
  customizationDiscountPercent: number;
  /** Stripe product of the tier fee, on the account of Keus. */
  stripeProductId?: string;
  /** Yearly Stripe prices of the three amounts. */
  stripePriceIds?: FeePriceIds;
}
