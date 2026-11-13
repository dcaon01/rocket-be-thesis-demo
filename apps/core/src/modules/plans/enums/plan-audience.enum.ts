/**
 * Enum representing who a plan is intended for.
 *   - CLIENT: the price list of the direct channel.
 *   - RESELLER: the price list of the indirect channel; Keus invoices the reseller
 *     this price minus the margin of its contract.
 */
export enum PlanAudience {
  // The stored value stays CLIENT: the plans already written carry it.
  Company = 'CLIENT',
  /**
   * @deprecated The professional is out of scope: the resale network is
   * single-level. The value survives only so existing plans keep being
   * readable, since the schema validates the enum on reads too. New plans with
   * this audience are rejected by the service.
   */
  Professional = 'PROFESSIONAL',
  Reseller = 'RESELLER',
}
