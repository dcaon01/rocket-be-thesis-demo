/**
 * Where the electronic invoice of an invoice stands: first the steps of Rocket, which creates it as a draft at Sibill,
 * then the states Sibill reports through its webhook once the CEO issues it to the exchange system. Creating it is
 * not idempotent at Sibill, so a call is repeated only when its failure was certain:
 *   TO_ISSUE  → ISSUING   (claimed by one caller, the only one allowed to call Sibill)
 *   ISSUING   → DRAFT     (Sibill returned the draft)
 *   ISSUING   → FAILED    (Sibill refused it: nothing was created, it can be created again once fixed)
 *   ISSUING   → UNCERTAIN (no answer or a server error: an operator checks Sibill before anything else)
 *   FAILED    → ISSUING   (created again by an operator)
 *   UNCERTAIN → DRAFT     (an operator links the document found at Sibill)
 *   UNCERTAIN → ISSUING   (an operator confirms Sibill has no document and creates it again)
 *   DRAFT     → SENT → DELIVERED, NOT_DELIVERED, DISCARDED or REFUSED (from Sibill, after the CEO issues it)
 */
export enum InvoiceDocumentStatus {
  ToIssue = "TO_ISSUE",
  /** A call to Sibill is running. */
  Issuing = "ISSUING",
  /** Sibill refused it: it is created again once fixed. */
  Failed = "FAILED",
  /** Sibill did not answer: it may exist, so it is checked on Sibill first. */
  Uncertain = "UNCERTAIN",
  /** Draft at Sibill: the work of Rocket is done, the CEO issues it from Sibill. */
  Draft = "DRAFT",
  /** Issued and sent to the exchange system. */
  Sent = "SENT",
  Delivered = "DELIVERED",
  /** The exchange system could not deliver it: the customer finds it in its tax drawer, it is valid anyway. */
  NotDelivered = "NOT_DELIVERED",
  /** Discarded by the exchange system: it is fixed and sent again from Sibill. */
  Discarded = "DISCARDED",
  /** Refused by the customer, possible only towards the public administration. */
  Refused = "REFUSED",
}

/** The states Sibill reports, which a document created by Rocket can take. */
export const SIBILL_DOCUMENT_STATUSES: InvoiceDocumentStatus[] = [
  InvoiceDocumentStatus.Draft,
  InvoiceDocumentStatus.Sent,
  InvoiceDocumentStatus.Delivered,
  InvoiceDocumentStatus.NotDelivered,
  InvoiceDocumentStatus.Discarded,
  InvoiceDocumentStatus.Refused,
];
