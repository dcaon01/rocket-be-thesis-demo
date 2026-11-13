/**
 * Whether a tenant or user of Rocket matches its copy on the product, written in the same
 * transaction as the pending operation it depends on:
 *   PENDING ⇔ `pendingOperationId` points at an operation waiting for the product
 *   FAILED  ⇔ that operation was answered with an error (kept in `failureReason`)
 *   IN_SYNC ⇔ no operation is open
 */
export enum SyncState {
  /** Nothing is waiting for the product. */
  InSync = 'IN_SYNC',
  /** An operation was sent and the product has not answered yet. */
  Pending = 'PENDING',
  /** The product answered the open operation with an error. */
  Failed = 'FAILED',
}
