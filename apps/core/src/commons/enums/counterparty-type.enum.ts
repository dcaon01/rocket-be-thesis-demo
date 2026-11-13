/**
 * Who bought, as recorded on the volume ledger: always a company today.
 */
export enum CounterpartyType {
  // The stored value stays CLIENT: the contracts already written carry it.
  Company = 'CLIENT',
  /**
   * @deprecated The professional is out of scope: the resale network is
   * single-level. The value survives only so existing records keep being
   * readable, since the schema validates the enum on reads too.
   */
  Professional = 'PROFESSIONAL',
  /**
   * @deprecated Keus's contracts with a reseller live in the reseller contracts.
   * The value survives only so existing records keep being readable.
   */
  Reseller = 'RESELLER',
}
