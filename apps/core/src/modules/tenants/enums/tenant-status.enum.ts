/**
 * Lifecycle of a tenant as Rocket mirrors it from the product.
 * Rocket writes the tenant when it asks the product to create it, in the same
 * transaction as the pending operation, and the product's answer moves it on.
 *
 * Allowed transitions:
 *   REQUESTED → ACTIVE    (the product confirmed the creation)
 *   REQUESTED → CANCELLED (the product answered with an error and the operator discarded the request)
 *   CANCELLED → ACTIVE    (a late confirmation still creates it, flagged as such)
 *   ACTIVE   ↔ INACTIVE   (suspension and reactivation)
 *   ACTIVE, INACTIVE → DELETED (the product confirmed the deletion; the record stays until it is purged)
 *
 * An error of the product leaves the tenant REQUESTED with `syncState` FAILED: it can be sent
 * again or discarded. A request without an answer is never discarded, only sent again.
 */
export enum TenantStatus {
  /** Asked to the product, not created yet. */
  Requested = 'REQUESTED',
  /** Confirmed by the product and in use. */
  Active = 'ACTIVE',
  /** Suspended: the product keeps it, its users cannot sign in. */
  Inactive = 'INACTIVE',
  /** Discarded by the operator after the product answered with an error. */
  Cancelled = 'CANCELLED',
  /** Deleted on the product: kept with its history until the operator purges it. */
  Deleted = 'DELETED',
}
