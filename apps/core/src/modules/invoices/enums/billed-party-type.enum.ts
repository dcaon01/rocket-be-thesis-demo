/** Kinds of party an invoice is addressed to. */
export enum BilledPartyType {
  /** A company, on the direct channel. */
  Company = "COMPANY",
  /** A reseller, on the indirect channel and for its own fee. */
  Reseller = "RESELLER",
  /** The finance company of a financed order: not an entity, its details live on the order. */
  Financier = "FINANCIER",
}
