/**
 * Publication state of a commercial material.
 * Only a published material reaches the resale network; withdrawing removes it
 * from the resellers' view while keeping it in the global area.
 */
export enum MaterialStatus {
  /** Being prepared, not visible to the network. */
  Draft = 'DRAFT',
  /** Available to the resellers it is assigned to. */
  Published = 'PUBLISHED',
  /** Removed from the resellers' view, kept on the Keus side. */
  Withdrawn = 'WITHDRAWN',
}
