/**
 * Enum describing the billing cadence of a recurring plan.
 * Not applicable to one-time plans.
 */
export enum BillingInterval {
  /** Plan is billed every month. */
  Monthly = 'MONTHLY',
  /** Plan is billed every year. */
  Annual = 'ANNUAL',
}
