/**
 * Why a customer of a reseller is an opportunity to grow on its dashboard (UR-RK-339).
 */
export enum ResellerOpportunityReason {
  /** The active users of a tenant reached most of the seats sold: the next users raise the fee. */
  SeatsNearCap = 'SEATS_NEAR_CAP',
  /** The company is active on a single product, and the reseller sells others. */
  SingleProduct = 'SINGLE_PRODUCT',
}
