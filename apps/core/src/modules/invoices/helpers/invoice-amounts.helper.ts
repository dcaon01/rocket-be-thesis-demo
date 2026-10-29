import { InvoiceItem } from "../schemas/invoice.schema";

/** Amounts of an invoice, in cents. */
export type InvoiceAmounts = {
  /** Sum of the items, net of VAT. */
  taxableCents: number;
  /** VAT on the taxable. */
  vatCents: number;
  /** Taxable plus VAT. */
  amountCents: number;
};

/**
 * Computes the amounts of an invoice as the exchange system checks them (control 00421): the VAT is computed once
 * on the whole taxable, not line by line, and rounded half up to the cent.
 * @param items the items of the invoice, net of VAT.
 * @param vatRatePercent the VAT rate, in percent.
 * @returns the taxable, the VAT and the total.
 */
export function invoiceAmounts(items: Pick<InvoiceItem, "amountCents">[], vatRatePercent: number): InvoiceAmounts {
  const taxableCents = items.reduce((total, item) => total + item.amountCents, 0);
  // Cents times a rate with at most two decimals: the product is exact, and Math.round rounds .5 up on positives.
  const vatCents = Math.round((taxableCents * Math.round(vatRatePercent * 100)) / 10000);
  return { taxableCents, vatCents, amountCents: taxableCents + vatCents };
}
