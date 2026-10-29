/**
 * Lifecycle of an order.
 * The order is the commercial wrapper; its lines are the units of delivery.
 *
 * Allowed transitions:
 *   DRAFT          → TO_BE_PRICED | TO_BE_APPROVED | SENT | CANCELLED
 *   TO_BE_PRICED   → PRICED | REFUSED | CANCELLED (on saving the quotation; REFUSED: nothing left after the refusals)
 *   PRICED         → PRICED | TO_BE_APPROVED | SENT | REFUSED | CANCELLED (PRICED: the quotation is saved again)
 *   TO_BE_APPROVED → APPROVED | DRAFT | PRICED | CANCELLED (DRAFT/PRICED: Keus refused the approval)
 *   APPROVED       → SENT | PRICED | REFUSED | CANCELLED (PRICED/REFUSED: the quotation is saved again)
 *   SENT           → ACCEPTED | REFUSED | CANCELLED
 *   ACCEPTED       → CONFIRMED | REFUSED | CANCELLED
 *   CONFIRMED    → CLOSED
 *   CLOSED, REFUSED, CANCELLED are final.
 * On the indirect channel the offer needs the approval of the Keus back office: SENT is reached from APPROVED only.
 * Once the offer goes out (SENT) its amounts are frozen: the quotation can no longer be saved again.
 */
export enum OrderStatus {
  /** The request has been created and is still being composed. */
  Draft = 'DRAFT',
  /** Carries a customization request waiting for the back office to price it. */
  ToBePriced = 'TO_BE_PRICED',
  /** The back office priced or refused the customization: the seller generates the offer. */
  Priced = 'PRICED',
  /** A reseller asked the Keus back office to approve its offer. */
  ToBeApproved = 'TO_BE_APPROVED',
  /** The Keus back office approved the offer of the reseller, which can now generate it. */
  Approved = 'APPROVED',
  /** The offer has been generated and sent to the customer. */
  Sent = 'SENT',
  /** The signed offer has been uploaded. */
  Accepted = 'ACCEPTED',
  /** The back office confirmed the order and set the delivery date. */
  Confirmed = 'CONFIRMED',
  /** Every line has been provisioned. Final. */
  Closed = 'CLOSED',
  /** The offer was turned down. Final. */
  Refused = 'REFUSED',
  /** Given up before confirmation. Final. */
  Cancelled = 'CANCELLED',
}
