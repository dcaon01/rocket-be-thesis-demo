import { AppException } from "../../../errors/exception-types";

/**
 * Stripe account of Keus itself. It bills the reseller subscription fees, which belong
 * to no product: every other Stripe account is the one of a product.
 */
export interface KeusStripeAccount {
  /** Secret API key of the account. */
  apiKey: string;
  /** Secret that signs the webhooks of the account. */
  webhookSecret: string;
  /** Tax rate applied to the fees, when configured. */
  taxRateId?: string;
}

/**
 * Reads the Stripe account of Keus from the environment.
 * @returns the account.
 * @throws AppException if the API key or the webhook secret is not configured.
 */
export function keusStripeAccount(): KeusStripeAccount {
  const apiKey = process.env.KEUS_STRIPE_API_KEY;
  const webhookSecret = process.env.KEUS_STRIPE_WEBHOOK_SECRET;
  if (!apiKey || !webhookSecret) {
    throw new AppException('The Stripe account of Keus is not configured: set KEUS_STRIPE_API_KEY and KEUS_STRIPE_WEBHOOK_SECRET.', 500);
  }
  return {
    apiKey,
    webhookSecret,
    ...(process.env.KEUS_STRIPE_TAX_RATE_ID && { taxRateId: process.env.KEUS_STRIPE_TAX_RATE_ID }),
  };
}

/**
 * Stand-in for the product in the Stripe metadata and schedule payloads of the fees Keus
 * bills in its own name, which belong to no product.
 */
export const KEUS_FEE_PRODUCT_ID = "keus";
