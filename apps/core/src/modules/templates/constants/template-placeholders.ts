import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { TemplatePlaceholderCollection } from "../classes/template-placeholder-collection.class";
import { TemplatePlaceholder } from "../classes/template-placeholder.class";
import { TemplateType } from "../enums/template-type.enum";

/** Placeholders and lists a template scope may use; values arrive already formatted. */
export type PlaceholderSet = {
  /** Single values. */
  placeholders: TemplatePlaceholder[];
  /** Repeated lists. */
  collections: TemplatePlaceholderCollection[];
};

/** Date the document is generated. */
const TODAY: TemplatePlaceholder[] = [
  { key: "today", label: "Data di generazione", example: "28/09/2026" },
];

/** Company data, as collected in its record (UR-RK-082). */
const COMPANY: TemplatePlaceholder[] = [
  { key: "company.name", label: "Ragione sociale dell'azienda", example: "ACME S.r.l." },
  { key: "company.vatNumber", label: "Partita IVA dell'azienda", example: "00000000000" },
  { key: "company.fiscalCode", label: "Codice fiscale dell'azienda", example: "00000000000" },
  { key: "company.address", label: "Sede legale dell'azienda", example: "Via dell'Esempio 1, 00100 Roma (RM)" },
  { key: "company.pec", label: "PEC dell'azienda", example: "acme@pec.example.it" },
  { key: "company.sdi", label: "Codice destinatario dell'azienda", example: "0000000" },
];

/** Reseller data, for the indirect channel. */
const RESELLER: TemplatePlaceholder[] = [
  { key: "reseller.name", label: "Ragione sociale del rivenditore", example: "Rivenditore Esempio S.r.l." },
  { key: "reseller.vatNumber", label: "Partita IVA del rivenditore", example: "11111111111" },
  { key: "reseller.address", label: "Sede legale del rivenditore", example: "Via del Rivenditore 2, 20100 Milano (MI)" },
  { key: "reseller.pec", label: "PEC del rivenditore", example: "rivenditore@pec.example.it" },
  { key: "reseller.email", label: "Email del rivenditore", example: "info@rivenditore.example.it" },
  { key: "reseller.logo", label: "Logo del rivenditore", example: "Logo caricato nella scheda del rivenditore", image: true },
];

/** Product the document is about. */
const PRODUCT: TemplatePlaceholder[] = [
  { key: "product.name", label: "Nome del prodotto", example: "Nquadro" },
];

/** Order header. */
const ORDER: TemplatePlaceholder[] = [
  { key: "order.code", label: "Codice dell'ordine", example: "ORD-2026-00118" },
  { key: "order.date", label: "Data della richiesta", example: "11/03/2026" },
];

/** Contract reference. */
const CONTRACT: TemplatePlaceholder[] = [
  { key: "contract.code", label: "Codice del contratto", example: "NQ-2026-00007" },
];

/**
 * Lines of the order, one per product. Activation and recurring fee stay apart, list price, discount
 * and quoted amount each, as the line stores them; the fee is per billing period of the plan, which
 * `billing` names. The assistance is always at full price.
 */
const ORDER_LINES: TemplatePlaceholderCollection = {
  key: "lines",
  label: "Righe dell'ordine",
  fields: [
    { key: "product.name", label: "Prodotto", example: "Nquadro" },
    { key: "plan.name", label: "Piano", example: "Tiers annuale" },
    { key: "seats", label: "Postazioni", example: "8" },
    { key: "billing", label: "Periodo di fatturazione (annuale, mensile o una tantum)", example: "annuale" },
    { key: "listActivation", label: "Attivazione di listino", example: "500,00 €" },
    { key: "activationDiscount", label: "Sconto sull'attivazione", example: "10%" },
    { key: "activation", label: "Attivazione offerta", example: "450,00 €" },
    { key: "listRecurring", label: "Canone di listino, per periodo di fatturazione", example: "1.248,00 €" },
    { key: "recurringDiscount", label: "Sconto sul canone", example: "5%" },
    { key: "recurring", label: "Canone offerto, per periodo di fatturazione", example: "1.185,60 €" },
    { key: "assistance", label: "Assistenza", example: "200,00 €" },
    { key: "assistanceLabel", label: "Descrizione dell'assistenza", example: "Assistenza prioritaria" },
  ],
};

/**
 * Customizations priced on the order: one per line at most, on its product.
 * Amounts as the offer prints them, with the discount granted on each.
 */
const ORDER_CUSTOMIZATIONS: TemplatePlaceholderCollection = {
  key: "customizations",
  label: "Personalizzazioni dell'ordine",
  fields: [
    { key: "product", label: "Prodotto personalizzato", example: "Nquadro" },
    { key: "description", label: "Descrizione della personalizzazione", example: "Integrazione con il gestionale di ACME" },
    { key: "oneOffAmount", label: "Importo una tantum", example: "2.500,00 €" },
    { key: "recurringAmount", label: "Incremento annuale del canone", example: "300,00 €" },
    { key: "discount", label: "Sconto", example: "10%" },
  ],
};

/**
 * Offer body: only what Rocket knows, i.e. order, lines, customizations and totals, plus whether
 * the financing section is shown. The rest of the offer is fixed text of the template.
 * One-off and yearly amounts are never summed into a single total.
 */
const OFFER: PlaceholderSet = {
  placeholders: [
    ...TODAY,
    ...ORDER,
    ...COMPANY,
    { key: "totals.oneOff", label: "Totale una tantum (attivazioni, piani una tantum e personalizzazioni)", example: "2.950,00 €" },
    { key: "totals.monthly", label: "Totale mensile (canoni annuali divisi per dodici)", example: "123,80 €" },
    { key: "totals.yearly", label: "Totale annuale (dodici volte il mensile)", example: "1.485,60 €" },
    { key: "totals.assistance", label: "Totale assistenza", example: "200,00 €" },
    { key: "financing", label: "Pagamento con finanziaria (sì o vuoto): mostra o nasconde la sezione", example: "sì" },
  ],
  collections: [ORDER_LINES, ORDER_CUSTOMIZATIONS],
};

/** Contract generated when the order line is provisioned; the acceptance fields stay empty until the first user accepts. */
const CONTRACT_SET: PlaceholderSet = {
  placeholders: [
    ...TODAY,
    ...COMPANY,
    ...PRODUCT,
    ...CONTRACT,
    { key: "contract.seats", label: "Postazioni", example: "8" },
    { key: "contract.startDate", label: "Data di decorrenza", example: "16/03/2026" },
    { key: "contract.renewalDate", label: "Data di rinnovo", example: "16/03/2027" },
    { key: "acceptance.date", label: "Data dell'accettazione", example: "16/03/2026" },
    { key: "acceptance.time", label: "Ora dell'accettazione", example: "10:42" },
    { key: "acceptance.userName", label: "Utente che ha accettato", example: "Mario Rossi" },
    { key: "acceptance.userEmail", label: "Email dell'utente che ha accettato", example: "mario.rossi@acme.example.it" },
  ],
  collections: [],
};

/** Reseller billed, as the invoice froze it at issue. */
const BILLED_RESELLER: TemplatePlaceholder[] = [
  { key: "reseller.name", label: "Ragione sociale del rivenditore", example: "Rivenditore Esempio S.r.l." },
  { key: "reseller.vatNumber", label: "Partita IVA del rivenditore", example: "11111111111" },
  { key: "reseller.fiscalCode", label: "Codice fiscale del rivenditore", example: "11111111111" },
  { key: "reseller.address", label: "Sede legale del rivenditore", example: "Via del Rivenditore 2, 20100 Milano (MI)" },
  { key: "reseller.pec", label: "PEC del rivenditore", example: "rivenditore@pec.example.it" },
  { key: "reseller.sdi", label: "Codice destinatario del rivenditore", example: "1111111" },
];

/** Lines of the invoice, taxable amounts. */
const INVOICE_ITEMS: TemplatePlaceholderCollection = {
  key: "items",
  label: "Righe della fattura",
  fields: [
    { key: "description", label: "Descrizione", example: "Canone Tiers annuale, un anno" },
    { key: "amount", label: "Imponibile", example: "1.185,60 €" },
  ],
};

/**
 * Pro forma of an invoice of Keus to a reseller, for a period or a proration of an indirect contract. The wording
 * on its fiscal value is fixed text of the template.
 */
const PRO_FORMA_SET: PlaceholderSet = {
  placeholders: [
    ...TODAY,
    ...BILLED_RESELLER,
    { key: "company.name", label: "Cliente del rivenditore", example: "ACME S.r.l." },
    ...PRODUCT,
    ...CONTRACT,
    { key: "invoice.date", label: "Data della pro forma", example: "16/10/2026" },
    { key: "invoice.dueDate", label: "Data dell'addebito", example: "04/11/2026" },
    { key: "invoice.taxable", label: "Imponibile", example: "1.185,60 €" },
    { key: "invoice.vatRate", label: "Aliquota IVA", example: "22%" },
    { key: "invoice.vat", label: "IVA", example: "260,83 €" },
    { key: "invoice.total", label: "Totale, IVA inclusa", example: "1.446,43 €" },
  ],
  collections: [INVOICE_ITEMS],
};

/** Products the reseller is enabled to sell under its contract, one per product. */
const RESELLER_CONTRACT_PRODUCTS: TemplatePlaceholderCollection = {
  key: "products",
  label: "Prodotti abilitati",
  fields: [
    { key: "name", label: "Nome del prodotto", example: "Nquadro" },
  ],
};

/**
 * Contract between Keus and a reseller, filled from its draft: the reseller as in its record, the tier, the
 * enabled products and the terms written in the contract. The wording of the agreement is fixed text of the template.
 */
const RESELLER_CONTRACT_SET: PlaceholderSet = {
  placeholders: [
    ...TODAY,
    ...BILLED_RESELLER,
    { key: "reseller.email", label: "Email del rivenditore", example: "info@rivenditore.example.it" },
    ...CONTRACT,
    { key: "contract.tier", label: "Tipologia del rivenditore", example: "Gold" },
    { key: "contract.startDate", label: "Data di decorrenza", example: "16/03/2026" },
    { key: "contract.fee.firstYear", label: "Canone del primo anno", example: "1.200,00 €" },
    { key: "contract.fee.secondYear", label: "Canone del secondo anno", example: "1.500,00 €" },
    { key: "contract.fee.ongoing", label: "Canone dal terzo anno", example: "1.800,00 €" },
    { key: "contract.discount.activation", label: "Sconto sull'attivazione", example: "40%" },
    { key: "contract.discount.recurring", label: "Sconto sul canone", example: "40%" },
    { key: "contract.discount.customization", label: "Sconto sulle personalizzazioni", example: "15%" },
  ],
  collections: [RESELLER_CONTRACT_PRODUCTS],
};

/**
 * Returns the placeholders a template scope may use.
 * @param type the type of the template.
 * @param channel the channel, for the offer templates.
 * @returns the placeholder set of the scope.
 */
export function placeholdersFor(
  type: TemplateType,
  channel?: SalesChannel,
): PlaceholderSet {
  switch (type) {
    case TemplateType.Offer:
      return channel === SalesChannel.Reseller
        ? { placeholders: [...OFFER.placeholders, ...RESELLER], collections: OFFER.collections }
        : OFFER;
    case TemplateType.Contract:
      return CONTRACT_SET;
    case TemplateType.ProForma:
      return PRO_FORMA_SET;
    case TemplateType.ResellerContract:
      return RESELLER_CONTRACT_SET;
  }
}
