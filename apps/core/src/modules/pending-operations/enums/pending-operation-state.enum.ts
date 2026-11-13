/**
 * Lifecycle of a pending operation towards a product.
 * The operation stays pending until the product answers: an operation without an answer
 * is never given up, and how long to wait is a retry parameter, not a state.
 *
 * Allowed transitions:
 *   PENDING → DONE      (the product confirmed)
 *   PENDING → FAILED    (the product answered with an error)
 *   FAILED  → PENDING   (the operation is sent again)
 *   FAILED  → ABANDONED (the operator discarded it after the product's error)
 *   PENDING → ABANDONED (a user waiting for a tenant the operator discarded: it was never sent)
 */
export enum PendingOperationState {
  /** Sent, or waiting to be sent again, with no answer yet. */
  Pending = 'PENDING',
  /** Confirmed by the product, or done by the product on its own (`fromProduct`). */
  Done = 'DONE',
  /** The product answered with an error. */
  Failed = 'FAILED',
  /** Discarded by the operator; a late answer still lands on the target. */
  Abandoned = 'ABANDONED',
}
