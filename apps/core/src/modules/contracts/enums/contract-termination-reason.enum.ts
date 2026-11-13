/**
 * Why a contract was terminated, when it matters to who reads it: the churn rate leaves out the contracts ended by a
 * transfer of channel, which are no loss (UR-RK-221). A contract terminated otherwise carries no reason.
 */
export enum ContractTerminationReason {
  /** The company moved from its inactive reseller to Keus, and a direct contract took over on the same tenant (UR-RK-105). */
  Transfer = 'TRANSFER',
}
