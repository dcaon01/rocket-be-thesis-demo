/**
 * Business type of a stored document.
 * Tells what the file is, so the company record can group the offers and the
 * contracts instead of showing an undifferentiated list.
 */
export enum DocumentType {
  /** The offer as presented to the customer. */
  Offer = 'OFFER',
  /** The offer signed by the customer or by the reseller. */
  SignedOffer = 'SIGNED_OFFER',
  /** The terms of use accepted at first access. */
  SignedContract = 'SIGNED_CONTRACT',
  /** The framework agreement signed with a reseller. */
  FrameworkContract = 'FRAMEWORK_CONTRACT',
  /** The SEPA direct debit mandate. */
  SepaMandate = 'SEPA_MANDATE',
  /** The agreement with the financing company. */
  FinancingContract = 'FINANCING_CONTRACT',
  /** Anything else worth keeping with the owner. */
  Other = 'OTHER',
}
