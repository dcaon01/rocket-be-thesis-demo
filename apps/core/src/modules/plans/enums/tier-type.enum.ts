/**
 * Enum describing the constraint dimension used by a tiered volume plan.
 * Determines what `minValue` / `maxValue` on each tier represent.
 */
export enum TierType {
  /** Tiers have user-count (seats) constraints. */
  Seats = 'SEATS',
}
