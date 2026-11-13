import { Schema } from "dynamoose";
import { ResellerContractStatus } from "../enums/reseller-contract-status.enum";
import { ResellerTier } from "../../resellers/enums/reseller-tier.enum";
import { FeePriceIds } from "../../resellers/schemas/reseller-tier-config.schema";
import { StripeAccountLink } from "../../stripe/classes/stripe-account-link.class";

/**
 * Reseller Contract Schema.
 * The contract between Keus and a reseller: the fee the reseller pays to be allowed
 * to sell, and the margins Keus leaves it on what it resells. It is opened by an
 * operator from a partner tier and signed with the framework agreement; the fee is
 * billed through a Stripe subscription on the account of Keus, at the yearly price
 * of the year of contract.
 *
 * The table partitions on the reseller and sorts on the identifier: the contracts of
 * a reseller are one query. A reseller has at most one contract in force, pointed at
 * by the reseller itself; changing tier opens a successor that starts at the renewal
 * of the contract in force.
 */
export const ResellerContractSchema = new Schema({
  /** Identifier of the reseller. */
  resellerId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Identifier of the contract. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** Human-readable code of the contract: the reseller code and a sequence ("RVD-001-001"). */
  code: {
    type: String,
    required: true,
  },
  /** Code of the reseller, copied for the listings and the payment metadata. */
  resellerCode: {
    type: String,
    required: true,
  },
  /** Company name of the reseller, copied for the listings, the Stripe customer and the invoices. */
  resellerName: {
    type: String,
    required: true,
  },
  /** Email of the reseller, copied for the Stripe customer and the invoices. */
  resellerEmail: {
    type: String,
    required: true,
  },
  /** Partner tier of the contract. Changing tier means a new contract. */
  tier: {
    type: String,
    enum: Object.values(ResellerTier),
    required: true,
  },
  /** Fee of the contract by year: first, second and from the third on. */
  fee: {
    type: Object,
    schema: {
      /** Fee in cents for the first year. */
      firstYearCents: { type: Number, required: true },
      /** Fee in cents for the second year. */
      secondYearCents: { type: Number, required: true },
      /** Fee in cents from the third year on. */
      ongoingCents: { type: Number, required: true },
    },
    required: true,
  },
  /** Yearly Stripe prices of the fee, on the account of Keus. Absent when the fee is zero. */
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
  /**
   * Products the reseller is enabled to sell under this contract. Frozen once the contract leaves DRAFT: when the
   * contract is in force the reseller takes them, and its mandates are collected for these products.
   */
  productIds: {
    type: Array,
    schema: [String],
    required: true,
  },
  /** Margin of the reseller, copied onto the order lines when an order is raised. */
  margin: {
    type: Object,
    schema: {
      /** Margin percentage on the activation amounts. */
      activationPercent: { type: Number, required: true },
      /** Margin percentage on the recurring amounts of the products. */
      recurringPercent: { type: Number, required: true },
      /** Margin percentage on the customizations. */
      customizationPercent: { type: Number, required: true },
    },
    required: true,
  },
  /** Status of the contract. */
  status: {
    type: String,
    enum: Object.values(ResellerContractStatus),
    required: true,
    default: ResellerContractStatus.Draft,
  },
  /** Start date of the contract (ISO string). */
  validityDate: {
    type: String,
    required: true,
  },
  /** Number of validity years since the start. Incremented at each annual renewal. */
  validityYears: {
    type: Number,
    required: true,
    default: 1,
  },
  /** End date of the contract (ISO string), once it has ended. */
  endDate: {
    type: String,
    required: false,
  },
  /** S3 key of the signed framework agreement. */
  signedContractS3Key: {
    type: String,
    required: false,
  },
  /** Stripe customer of the reseller. */
  stripeCustomerId: {
    type: String,
    required: false,
  },
  /** Stripe subscription billing the fee. */
  stripeSubscriptionId: {
    type: String,
    required: false,
  },
  /** Stripe checkout session URL for the SEPA mandate and the first payment. */
  checkoutSessionUrl: {
    type: String,
    required: false,
  },
  /** Stripe checkout session expiration date (ISO string). */
  checkoutSessionExpiresAt: {
    type: String,
    required: false,
  },
  /** Counter of the writes of `stripeAccounts`: a write holds only if nobody else wrote the links since they were read. */
  mandatesVersion: {
    type: Number,
    required: false,
  },
  /**
   * Customer and SEPA mandate of the reseller on the Stripe account of each product the reseller sells, written by
   * Rocket only. They live on the contract the reseller points at, and pass to its successor.
   */
  stripeAccounts: {
    type: Array,
    required: false,
    schema: [{
      type: Object,
      schema: {
        /** Stripe account: the id of a product. */
        accountKey: { type: String, required: true },
        /** Stripe customer on that account. */
        customerId: { type: String, required: true },
        /** SEPA payment method collected by the checkout. */
        paymentMethodId: { type: String, required: false },
        /** When the mandate was collected (ISO string). */
        mandateAt: { type: String, required: false },
        /** Link of the pending checkout of the mandate. */
        checkoutSessionUrl: { type: String, required: false },
        /** Expiry of the pending checkout (ISO string). */
        checkoutSessionExpiresAt: { type: String, required: false },
      },
    }],
  },
}, {
  timestamps: true,
});

/**
 * Reseller Contract Key Interface.
 */
export interface ResellerContractKey {
  /** Identifier of the reseller. */
  resellerId: string;
  /** Identifier of the contract. */
  id: string;
}

/**
 * Reseller Contract Interface.
 */
export interface ResellerContract extends ResellerContractKey {
  /** Human-readable code of the contract. */
  code: string;
  /** Code of the reseller. */
  resellerCode: string;
  /** Company name of the reseller. */
  resellerName: string;
  /** Email of the reseller. */
  resellerEmail: string;
  /** Partner tier of the contract. */
  tier: ResellerTier;
  /** Fee of the contract by year. */
  fee: { firstYearCents: number; secondYearCents: number; ongoingCents: number };
  /** Yearly Stripe prices of the fee. Absent when the fee is zero. */
  stripePriceIds?: FeePriceIds;
  /** Products the reseller is enabled to sell under this contract. */
  productIds: string[];
  /** Margin of the reseller, copied onto the order lines. */
  margin: { activationPercent: number; recurringPercent: number; customizationPercent: number };
  /** Status of the contract. */
  status: ResellerContractStatus;
  /** Start date of the contract (ISO string). */
  validityDate: string;
  /** Number of validity years since the start. */
  validityYears: number;
  /** End date of the contract (ISO string). */
  endDate?: string;
  /** S3 key of the signed framework agreement. */
  signedContractS3Key?: string;
  /** Stripe customer of the reseller. */
  stripeCustomerId?: string;
  /** Stripe subscription billing the fee. */
  stripeSubscriptionId?: string;
  /** Stripe checkout session URL. */
  checkoutSessionUrl?: string;
  /** Stripe checkout session expiration date (ISO string). */
  checkoutSessionExpiresAt?: string;
  /** Customer and SEPA mandate of the reseller on the Stripe account of each product, held by the contract it points at. */
  stripeAccounts?: StripeAccountLink[];
  /** Counter of the writes of `stripeAccounts`, for the conditional write of the links. */
  mandatesVersion?: number;
}
