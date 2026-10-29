/**
 * Kind of entity a document is attached to.
 * One table serves all three, because documents are always listed per owner
 * and never globally.
 */
export enum DocumentOwnerType {
  /** A company: its signed offers, its contracts. */
  Company = 'COMPANY',
  /** A reseller: its framework contract, its SEPA mandate. */
  Reseller = 'RESELLER',
  /** An order: the offer presented and the signed copy. */
  Order = 'ORDER',
}
