import { SDI_PATTERN } from "../../../commons/constants/fiscal-identifiers.constant";
import { calendarDayOf } from "../../../commons/dates/calendar-day.helper";
import { BusinessException } from "../../../errors/exception-types";
import { BilledPartyAddress, Invoice } from "../../invoices/schemas/invoice.schema";
import { SibillCompany, SibillIdFiscaleIva, SibillInvoiceBody, SibillSede } from "../interfaces/sibill.interface";

/** Longest line description the format accepts. */
const MAX_DESCRIPTION_LENGTH = 1000;

/** Interchange code of a customer with no channel registered at the exchange system. */
const NO_INTERCHANGE_CODE = "0000000";

/**
 * Builds the electronic invoice of an invoice issued by Keus, as Sibill receives it. Every value is checked against
 * the FatturaPA format (tabular representation 1.2.2) before anything is sent: a document the exchange system
 * discards keeps its number busy, so bad data must stop here.
 * Supported case: an Italian customer with a VAT number, one VAT rate, payment by SEPA direct debit.
 * @param invoice the invoice, with its amounts computed by `invoiceAmounts`.
 * @param issuer the company of Keus at Sibill.
 * @param issueDate when the document is issued.
 * @returns the invoice body.
 * @throws BusinessException naming the data to fix, when a value does not fit the format.
 */
export function fatturaPaOf(invoice: Invoice, issuer: SibillCompany, issueDate: Date): SibillInvoiceBody {
  const party = invoice.billedParty;
  const taxableCents = invoice.items.reduce((total, item) => total + item.amountCents, 0);
  if (taxableCents !== invoice.taxableCents || invoice.taxableCents + invoice.vatCents !== invoice.amountCents) {
    fail(invoice, "its amounts do not add up");
  }
  const rate = invoice.vatRatePercent.toFixed(2);
  const dueDate = invoice.dueDate ? calendarDayOf(new Date(invoice.dueDate)) : calendarDayOf(issueDate);

  return {
    versione: "FPR12",
    fattura_elettronica_header: {
      dati_trasmissione: {
        ...transmissionOf(invoice),
        formato_trasmissione: "FPR12",
      },
      cedente_prestatore: {
        dati_anagrafici: {
          id_fiscale_iva: vatIdOf(invoice, issuer.vat_number, "the VAT number of Keus at Sibill"),
          anagrafica: { denominazione: nameOf(invoice, issuer.name, "the name of Keus at Sibill") },
          regime_fiscale: issuer.fiscal_regime?.match(/^RF\d{2}$/) ? issuer.fiscal_regime : fail(invoice, "the tax regime of Keus at Sibill is not an RFxx code"),
        },
        sede: sedeOf(invoice, issuer.company_identity && {
          street: issuer.company_identity.address,
          city: issuer.company_identity.city,
          zipCode: issuer.company_identity.postal_code,
          province: issuer.company_identity.province_code,
          country: issuer.company_identity.country,
        }, "the address of Keus at Sibill"),
      },
      cessionario_committente: {
        dati_anagrafici: {
          id_fiscale_iva: vatIdOf(invoice, party.vatNumber, "the VAT number of the customer"),
          ...(party.fiscalCode && { codice_fiscale: fiscalCodeOf(invoice, party.fiscalCode) }),
          anagrafica: { denominazione: nameOf(invoice, party.name, "the legal name of the customer") },
        },
        sede: sedeOf(invoice, party.legalAddress, "the legal address of the customer"),
      },
    },
    fattura_elettronica_body: [{
      dati_generali: {
        dati_generali_documento: {
          tipo_documento: "TD01",
          divisa: "EUR",
          data: calendarDayOf(issueDate),
          importo_totale_documento: amountOf(invoice.amountCents),
        },
      },
      dati_beni_servizi: {
        dettaglio_linee: invoice.items.map((item, index) => ({
          numero_linea: String(index + 1),
          descrizione: descriptionOf(item.description),
          prezzo_unitario: amountOf(item.amountCents),
          prezzo_totale: amountOf(item.amountCents),
          aliquota_iva: rate,
        })),
        dati_riepilogo: [{
          aliquota_iva: rate,
          imponibile_importo: amountOf(invoice.taxableCents),
          imposta: amountOf(invoice.vatCents),
          esigibilita_iva: "I",
        }],
      },
      dati_pagamento: [{
        condizioni_pagamento: "TP02",
        dettaglio_pagamento: [{
          modalita_pagamento: "MP19",
          data_scadenza_pagamento: dueDate,
          importo_pagamento: amountOf(invoice.amountCents),
        }],
      }],
    }],
  };
}

/**
 * Stops the invoice with the reason, for the operator.
 * @param invoice the invoice.
 * @param reason what to fix.
 * @throws BusinessException always.
 */
function fail(invoice: Invoice, reason: string): never {
  throw new BusinessException(`Invoice ${invoice.id} cannot be issued: ${reason}.`, "INVOICE_DATA_INVALID", { invoiceId: invoice.id });
}

/**
 * Returns where the exchange system delivers: the interchange code, or zeros with the certified email.
 * @param invoice the invoice.
 * @returns the transmission fields.
 */
function transmissionOf(invoice: Invoice): { codice_destinatario: string; pec_destinatario?: string } {
  const sdi = invoice.billedParty.sdi?.trim().toUpperCase();
  if (!sdi) {
    const pec = invoice.billedParty.pec?.trim();
    return { codice_destinatario: NO_INTERCHANGE_CODE, ...(pec && { pec_destinatario: pec }) };
  }
  if (!SDI_PATTERN.test(sdi)) {
    fail(invoice, `the interchange code of the customer (${sdi}) is not seven letters or digits`);
  }
  return { codice_destinatario: sdi };
}

/**
 * Splits a VAT number into country and code, as the format wants them.
 * @param invoice the invoice.
 * @param vatNumber the VAT number, with or without the country prefix.
 * @param what which VAT number, for the error.
 * @returns the fiscal identifier.
 */
function vatIdOf(invoice: Invoice, vatNumber: string | undefined, what: string): SibillIdFiscaleIva {
  const vat = (vatNumber ?? "").replace(/\s+/g, "").toUpperCase();
  const prefixed = vat.match(/^([A-Z]{2})(.+)$/);
  const country = prefixed ? prefixed[1] : "IT";
  const code = prefixed ? prefixed[2] : vat;
  if (country !== "IT" || !/^\d{11}$/.test(code)) {
    fail(invoice, `${what} (${vatNumber ?? "missing"}) is not an Italian VAT number of eleven digits`);
  }
  return { id_paese: country, id_codice: code };
}

/**
 * Checks a fiscal code.
 * @param invoice the invoice.
 * @param fiscalCode the fiscal code.
 * @returns the fiscal code, upper case.
 */
function fiscalCodeOf(invoice: Invoice, fiscalCode: string): string {
  const code = fiscalCode.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{11,16}$/.test(code)) {
    fail(invoice, `the fiscal code of the customer (${fiscalCode}) is not 11 to 16 letters or digits`);
  }
  return code;
}

/**
 * Checks a legal name: one line, up to 80 characters.
 * @param invoice the invoice.
 * @param name the name.
 * @param what which name, for the error.
 * @returns the name on one line.
 */
function nameOf(invoice: Invoice, name: string | undefined, what: string): string {
  const value = (name ?? "").replace(/\s+/g, " ").trim();
  if (!value || value.length > 80) {
    fail(invoice, `${what} must be 1 to 80 characters`);
  }
  return value;
}

/**
 * Checks an Italian registered office against the format.
 * @param invoice the invoice.
 * @param address the structured address.
 * @param what which address, for the error.
 * @returns the office.
 */
function sedeOf(invoice: Invoice, address: BilledPartyAddress | null | undefined, what: string): SibillSede {
  if (!address) {
    return fail(invoice, `${what} is missing`);
  }
  const street = address.street?.replace(/\s+/g, " ").trim() ?? "";
  const city = address.city?.replace(/\s+/g, " ").trim() ?? "";
  const zipCode = address.zipCode?.trim() ?? "";
  const province = address.province?.trim().toUpperCase() ?? "";
  const country = (address.country?.trim() || "IT").toUpperCase();
  if (country !== "IT") {
    fail(invoice, `${what} is outside Italy (${country}), which Rocket does not invoice yet`);
  }
  if (!street || street.length > 60) fail(invoice, `the street of ${what} must be 1 to 60 characters`);
  if (!city || city.length > 60) fail(invoice, `the city of ${what} must be 1 to 60 characters`);
  if (!/^\d{5}$/.test(zipCode)) fail(invoice, `the postal code of ${what} (${zipCode}) is not five digits`);
  if (!/^[A-Z]{2}$/.test(province)) fail(invoice, `the province of ${what} (${province || "missing"}) is not a two-letter code`);
  return { indirizzo: street, cap: zipCode, comune: city, provincia: province, nazione: country };
}

/**
 * Puts a line description on one line, within the length the format accepts.
 * @param description the description of the item.
 * @returns the description, never empty.
 */
function descriptionOf(description: string): string {
  const value = description.replace(/\s+/g, " ").trim() || "Servizio";
  return value.length > MAX_DESCRIPTION_LENGTH ? value.slice(0, MAX_DESCRIPTION_LENGTH) : value;
}

/**
 * Formats cents as the format wants an amount: a dot and two decimals, computed on integers.
 * @param cents the amount in cents.
 * @returns the amount, e.g. `1234.50`.
 */
function amountOf(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
