/**
 * Kinds of what a reseller bills its customers: the share of a contract, written by Rocket when Keus bills the
 * reseller and read-only, and the items the reseller adds by hand, once or on a recurring rule.
 */
export enum CustomerChargeKind {
  /** A period or a proration of an indirect contract, at the price the customer pays. */
  Contract = 'CONTRACT',
  /** An item added by hand, due once. */
  OneOff = 'ONE_OFF',
  /** An item added by hand, due at every step of its cadence from its start until its end. */
  Recurring = 'RECURRING',
}
