/**
 * Who brought an entity into Rocket: Keus or a reseller.
 */
export enum IssuerType {
  Keus = 'KEUS',
  Reseller = 'RESELLER',
  /**
   * @deprecated The professional is out of scope: the resale network is
   * single-level. The value survives only so existing records keep being
   * readable, since the schema validates the enum on reads too. New contracts
   * with this issuer are rejected by the service.
   */
  Professional = 'PROFESSIONAL',
}
