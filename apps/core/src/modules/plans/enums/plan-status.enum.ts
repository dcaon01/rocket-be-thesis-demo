/**
 * Enum describing the lifecycle state of a Plan.
 * The lifecycle is strictly forward-only: Draft → Active → Archived.
 * Active plans are immutable except for the transition to Archived; this
 * guarantees that contracts referencing an active plan never see their
 * pricing shift under their feet.
 */
export enum PlanStatus {
  /** Plan is being defined and is not yet usable by contracts. Editable. */
  Draft = 'DRAFT',
  /** Plan is published, immutable, and available to be associated to new contracts. */
  Active = 'ACTIVE',
  /** Plan is retired: cannot be associated to new contracts, existing references remain valid. */
  Archived = 'ARCHIVED',
}
