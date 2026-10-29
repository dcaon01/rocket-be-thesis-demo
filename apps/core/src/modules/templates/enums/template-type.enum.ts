/**
 * Type of document a template produces.
 * The type decides what the template is bound to: the offer to a channel, while
 * the contract, the pro forma and the reseller contract are single for the whole platform.
 */
export enum TemplateType {
  /** Commercial offer presented to the customer: HTML on the direct channel, DOCX on the indirect one. */
  Offer = 'OFFER',
  /**
   * Terms of use, filled when the order line is provisioned and accepted at first access.
   * Single for every product, because it rules how the product is used, not what it costs.
   */
  Contract = 'CONTRACT',
  /**
   * Pro forma sent to a reseller with every invoice of Keus charged on the 4th: no fiscal value, the electronic
   * invoice is issued at the payment.
   */
  ProForma = 'PRO_FORMA',
  /**
   * Agreement between Keus and a reseller, filled from the draft of its contract: single for the whole platform,
   * and it can be withdrawn by hand, since no flow needs it to exist.
   */
  ResellerContract = 'RESELLER_CONTRACT',
}
