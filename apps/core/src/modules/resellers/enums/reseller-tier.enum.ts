/**
 * Commercial tier of a reseller.
 * Each tier carries a yearly fee and three margins, applied respectively to the
 * activation, to the recurring fee and to customizations. The values live in the
 * tier configuration and are copied onto a reseller contract when it is opened,
 * where a deal negotiated apart from the standard terms can change them.
 */
export enum ResellerTier {
  Silver = 'SILVER',
  Gold = 'GOLD',
  Platinum = 'PLATINUM',
}
