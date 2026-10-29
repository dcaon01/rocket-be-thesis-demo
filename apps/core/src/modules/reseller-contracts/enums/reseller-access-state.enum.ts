/**
 * Whether the users of a reseller can work in Rocket, read from its contracts.
 * Every state but ACTIVE covers Rocket with a blocking screen for the reseller users:
 *   NO_CONTRACT → ACTIVATING (a contract is signed) → ACTIVE (fee paid and every mandate given) → ENDED
 *   ACTIVE ⇄ SUSPENDED (an invoice still unpaid on the fifteenth day of its dunning, until nothing is left unpaid)
 * A reseller with a contract in force is ACTIVE even while a successor waits to be activated.
 */
export enum ResellerAccessState {
  /** No contract signed yet: only drafts, refused ones, or none at all. */
  NoContract = "NO_CONTRACT",
  /** The newest contract is signed and waits for the payment of its fee or for the mandates of its products. */
  Activating = "ACTIVATING",
  /** A contract is in force: Rocket works. */
  Active = "ACTIVE",
  /** A contract is in force, but an invoice is still unpaid on the fifteenth day of its dunning. */
  Suspended = "SUSPENDED",
  /** The last contract ended and no other took over. */
  Ended = "ENDED",
}
