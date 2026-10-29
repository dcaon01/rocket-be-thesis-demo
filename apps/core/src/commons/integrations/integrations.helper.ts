// Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
/**
 * Tells whether Rocket talks to the systems outside AWS: the products, Stripe, Sibill, HubSpot, Intercom, Mixpanel
 * and Sentry. On by default; `INTEGRATIONS_ENABLED=false` turns them off for a demo account, where Rocket answers
 * for the products itself and leaves out the payments and the external metrics.
 * @returns whether the integrations are on.
 */
export function integrationsEnabled(): boolean {
  return process.env.INTEGRATIONS_ENABLED !== "false";
}

/** VAT rate of the invoices while the integrations are off, in percent: the Italian rate the Stripe tax rates carry. */
export const DEMO_VAT_RATE_PERCENT = 22;
