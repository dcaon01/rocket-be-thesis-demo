import { formatEuro } from "../../../commons/formatting/notice-format.helper";
import { formatDocumentDate } from "../../contracts/helpers/contract-document.helper";
import { Invoice } from "../schemas/invoice.schema";

/** What the pro forma prints of the contract an invoice bills, besides the invoice itself. */
export type ProFormaContext = {
  /** Code of the contract. */
  contractCode: string;
  /** Name of the customer of the reseller. */
  companyName: string;
  /** Name of the product. */
  productName: string;
};

/**
 * Builds the values of the PRO_FORMA template, formatted as the other documents: the reseller as the invoice froze
 * it, the lines and the amounts of the invoice, and the contract they bill.
 * @param invoice the invoice to the reseller.
 * @param context the contract the invoice bills.
 * @returns the placeholder values, keyed as in the catalogue.
 */
export function proFormaDocumentData(invoice: Invoice, context: ProFormaContext): object {
  const reseller = invoice.billedParty;

  return {
    today: formatDocumentDate(new Date().toISOString()),
    reseller: {
      name: reseller.name,
      vatNumber: reseller.vatNumber ?? "",
      fiscalCode: reseller.fiscalCode ?? "",
      address: reseller.address ?? "",
      pec: reseller.pec ?? "",
      sdi: reseller.sdi ?? "",
    },
    company: { name: context.companyName },
    product: { name: context.productName },
    contract: { code: context.contractCode },
    invoice: {
      date: formatDocumentDate(invoice.issuedAt),
      dueDate: formatDocumentDate(invoice.dueDate),
      taxable: formatEuro(invoice.taxableCents),
      vatRate: `${invoice.vatRatePercent}%`,
      vat: formatEuro(invoice.vatCents),
      total: formatEuro(invoice.amountCents),
    },
    items: invoice.items.map(item => ({ description: item.description, amount: formatEuro(item.amountCents) })),
  };
}
