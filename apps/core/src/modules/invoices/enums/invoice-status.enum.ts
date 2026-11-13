/** States of an invoice, from its issue to its collection. */
export enum InvoiceStatus {
  /** Issued and waiting for the charge. */
  Open = "OPEN",
  /** Collected. */
  Paid = "PAID",
  /** The charge was attempted and failed. */
  Unpaid = "UNPAID",
  /** Cancelled after issue. */
  Void = "VOID",
}
