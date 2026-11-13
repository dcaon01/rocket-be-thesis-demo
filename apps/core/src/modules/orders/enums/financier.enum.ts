/**
 * Who finances (pays upfront) an order.
 * NONE = paid directly by the company;
 * GRENKE = financed by Grenke, which pays Keus the full amount upfront via a
 * Stripe bank-transfer invoice, while the end customer pays installments to
 * Grenke (pro-soluto: the credit risk is Grenke's).
 */
export enum Financier {
  None = 'NONE',
  Grenke = 'GRENKE',
}
