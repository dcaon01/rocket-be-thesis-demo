/**
 * Lifecycle of an order line, the unit of provisioning.
 * Each line walks its own path: a single order can have one line provisioned
 * and another still waiting.
 *
 * A line has no status until its order is confirmed: before that it is part of
 * a request, not work to do, and it never enters the provisioning queue if the
 * order is refused or cancelled.
 *
 * Allowed transitions:
 *   TO_BE_PROVISIONED → PROVISIONED (tenant and users created, credentials delivered)
 *   PROVISIONED       → ACTIVATED   (first access with acceptance of the terms of use)
 */
export enum OrderLineStatus {
  /** The order is confirmed and the line is waiting to be provisioned. */
  ToBeProvisioned = 'TO_BE_PROVISIONED',
  /** Credentials have been delivered: the supply is considered performed. */
  Provisioned = 'PROVISIONED',
  /** A user signed in for the first time and accepted the terms of use. */
  Activated = 'ACTIVATED',
}
