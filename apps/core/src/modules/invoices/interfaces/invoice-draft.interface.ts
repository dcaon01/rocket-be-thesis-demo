import { Invoice } from "../schemas/invoice.schema";

/**
 * An invoice before it is recorded: everything its biller knows. The amounts are left out on purpose:
 * `InvoicesService` computes them from the items and the VAT rate, as the electronic invoice checks them.
 */
export type InvoiceDraft = Omit<
  Invoice,
  | "id" | "number" | "sibillId" | "status" | "issuedAt" | "issueMonth" | "dueMonth" | "unpaidChannel"
  | "stripeInvoiceId" | "paidAt" | "paidMonth" | "createdAt" | "updatedAt" | "amountCents" | "taxableCents" | "vatCents"
  | "documentStatus" | "documentError" | "documentUpdatedAt" | "failedAttempts" | "lastFailedAt" | "dunningStep"
  | "proFormaS3Key"
>;
