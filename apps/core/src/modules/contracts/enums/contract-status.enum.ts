/**
 * Lifecycle of a contract: ACTIVE ↔ TERMINATING, then TERMINATED; an unpaid invoice suspends the tenant, not the contract.
 */
export enum ContractStatus {
  /** In force since the provisioning of its order line. */
  Active = 'ACTIVE',
  /** Cancellation recorded: in force and billed until `terminationDate`. */
  Terminating = 'TERMINATING',
  /** Ended: the tenant has no access and nothing more is charged. */
  Terminated = 'TERMINATED',
}

/** Statuses in which a contract is in force. */
export const IN_FORCE_STATUSES: ContractStatus[] = [ContractStatus.Active, ContractStatus.Terminating];
