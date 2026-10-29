/**
 * Enum describing the supported plan types.
 * Discriminates which pricing fields are relevant on a Plan entity
 * and how the plan is mapped to Stripe.
 */
export enum PlanType {
  /** Tiered volume pricing (seats or revenue). Maps to a Stripe Price with tiers_mode = 'volume'. */
  TieredVolume = 'TIERED_VOLUME',
  /** One-time charge (no recurring billing). Maps to a one-off Stripe Price. */
  OneTime = 'ONE_TIME',
  /** Flat recurring charge with a fixed unit amount. Maps to a recurring Stripe Price. */
  RecurringFlat = 'RECURRING_FLAT',
}
