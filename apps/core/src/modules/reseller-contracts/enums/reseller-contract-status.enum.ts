
export enum ResellerContractStatus {
  /* The contract is in draft status and not yet active. */
  Draft = "DRAFT",
  /* The contract is signed. */
  Signed = "SIGNED",
  /* The contract is active and in effect (the payments are regular). */
  Active = "ACTIVE",
  /* Kept for the shared labels: an unpaid fee suspends nothing (UR-RK-101). */
  Suspended = "SUSPENDED",
  /** The contract should end at renewal. */
  EndedAtRenewal = "ENDED_AT_RENEWAL",
  /* The contract has been terminated. */
  Ended = "ENDED",
  /* The contract was refused before signature. */
  Refused = "REFUSED",
}
/**
 * Statuses in which a reseller contract is in force: it is valid and its terms apply,
 * including one ending at renewal, until its end date.
 */
export const RESELLER_IN_FORCE_STATUSES: ResellerContractStatus[] = [
  ResellerContractStatus.Active,
  ResellerContractStatus.Suspended,
  ResellerContractStatus.EndedAtRenewal,
];
