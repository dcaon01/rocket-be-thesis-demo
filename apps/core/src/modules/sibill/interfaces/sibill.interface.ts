/**
 * Shapes of the Sibill integration API that Rocket uses (https://docs.sibill.com/api-reference/).
 * The invoice body mirrors the FatturaPA format in snake case: amounts are strings with a dot and two decimals,
 * dates are YYYY-MM-DD. Only the elements Rocket fills are typed.
 */

/** Fiscal identifier: country and code, without the country inside the code. */
export interface SibillIdFiscaleIva {
  /** ISO 3166-1 alpha-2 country. */
  id_paese: string;
  /** VAT number without the country prefix. */
  id_codice: string;
}

/** Registered office of a party. */
export interface SibillSede {
  /** Street and number, up to 60 characters. */
  indirizzo: string;
  /** Postal code, five digits. */
  cap: string;
  /** City, up to 60 characters. */
  comune: string;
  /** Province code, two letters, for Italy. */
  provincia?: string;
  /** ISO 3166-1 alpha-2 country. */
  nazione: string;
}

/** Electronic invoice as Sibill receives it (FatturaPA, ordinary invoice between private parties). */
export interface SibillInvoiceBody {
  /** Format version: always FPR12, between private parties. */
  versione: "FPR12";
  /** Header: transmission, issuer and customer. */
  fattura_elettronica_header: {
    /** Transmission data; the transmitter and the progressive are Sibill's. */
    dati_trasmissione: {
      /** Interchange code of the customer, `0000000` when it has none. */
      codice_destinatario: string;
      /** Certified email of the customer, when it has no interchange code. */
      pec_destinatario?: string;
      /** Transmission format, the same as the version. */
      formato_trasmissione: "FPR12";
    };
    /** Issuer: Keus. */
    cedente_prestatore: {
      /** Fiscal data of Keus. */
      dati_anagrafici: {
        /** VAT number of Keus. */
        id_fiscale_iva: SibillIdFiscaleIva;
        /** Legal name of Keus. */
        anagrafica: { denominazione: string };
        /** Tax regime code (RFxx). */
        regime_fiscale: string;
      };
      /** Registered office of Keus. */
      sede: SibillSede;
    };
    /** Customer: the billed party. */
    cessionario_committente: {
      /** Fiscal data of the customer. */
      dati_anagrafici: {
        /** VAT number of the customer. */
        id_fiscale_iva: SibillIdFiscaleIva;
        /** Fiscal code of the customer, when known. */
        codice_fiscale?: string;
        /** Legal name of the customer. */
        anagrafica: { denominazione: string };
      };
      /** Registered office of the customer. */
      sede: SibillSede;
    };
  };
  /** Body: one invoice. */
  fattura_elettronica_body: Array<{
    /** General data of the document. */
    dati_generali: {
      /** Type, currency, date and total; the number is assigned by Sibill. */
      dati_generali_documento: {
        /** Document type: TD01, invoice. */
        tipo_documento: "TD01";
        /** Currency. */
        divisa: "EUR";
        /** Date of the document (YYYY-MM-DD). */
        data: string;
        /** Total, VAT included. */
        importo_totale_documento: string;
      };
    };
    /** Lines and VAT summary. */
    dati_beni_servizi: {
      /** One line per item, quantity one. */
      dettaglio_linee: Array<{
        /** Progressive of the line, from 1. */
        numero_linea: string;
        /** What the line bills, up to 1000 characters. */
        descrizione: string;
        /** Unit price, net of VAT. */
        prezzo_unitario: string;
        /** Total of the line, net of VAT: the unit price, the quantity being one. */
        prezzo_totale: string;
        /** VAT rate, in percent with two decimals. */
        aliquota_iva: string;
      }>;
      /** VAT summary, one per rate. */
      dati_riepilogo: Array<{
        /** VAT rate, in percent with two decimals. */
        aliquota_iva: string;
        /** Taxable amount. */
        imponibile_importo: string;
        /** VAT on the taxable amount. */
        imposta: string;
        /** VAT due immediately. */
        esigibilita_iva: "I";
      }>;
    };
    /** Payment: full payment by SEPA direct debit. */
    dati_pagamento: Array<{
      /** TP02, full payment. */
      condizioni_pagamento: "TP02";
      /** The payment. */
      dettaglio_pagamento: Array<{
        /** MP19, SEPA direct debit. */
        modalita_pagamento: "MP19";
        /** Due date (YYYY-MM-DD). */
        data_scadenza_pagamento: string;
        /** Amount, VAT included. */
        importo_pagamento: string;
      }>;
    }>;
  }>;
}

/** Company of the Sibill account, as `GET /api/v1/companies` returns it. */
export interface SibillCompany {
  /** Identifier of the company. */
  id: string;
  /** Legal name. */
  name: string;
  /** VAT number. */
  vat_number: string;
  /** Tax regime code (RFxx). */
  fiscal_regime: string;
  /** ISO country. */
  country: string;
  /** Registered office. */
  company_identity: {
    /** Street and number. */
    address: string;
    /** City. */
    city: string;
    /** Postal code. */
    postal_code: string;
    /** Province code. */
    province_code: string;
    /** ISO country. */
    country: string;
  } | null;
}

/** States of a document at Sibill, from the draft to the outcome at the exchange system. */
export type SibillDocumentStatus =
  | "DRAFT" | "CREATED" | "SENT" | "DISCARDED" | "DELIVERED" | "NOT_DELIVERED" | "REFUSED" | "PENDING_ISSUE";

/** Document created at Sibill, as the invoice endpoints return it. */
export interface SibillDocument {
  /** Identifier of the document. */
  id: string;
  /** Number of the invoice; a draft may have none until it is issued. */
  number?: string;
  /** State of the document. */
  status: SibillDocumentStatus;
}

/** Error body of the Sibill API. */
export interface SibillErrorBody {
  /** The errors, with the field that caused each one when known. */
  errors?: Array<{ code?: string; title?: string; detail?: string | null; source?: { pointer?: string } | null }>;
}

/** Event Sibill sends to the webhook when a document changes, `document.updated`. */
export interface SibillDocumentUpdatedEvent {
  /** Identifier of the event. */
  id: string;
  /** Type of the event. */
  event: string;
  /** Company the document belongs to. */
  company_id: string;
  /** The document as it is now. */
  data: {
    /** Identifier of the document. */
    id: string;
    /** Number of the document. */
    number?: string;
    /** State of the document. */
    status: SibillDocumentStatus;
    /** Total of the document, VAT included, as a decimal string. */
    gross_amount?: { amount: string };
    /** Whether Keus issued the document or received it. */
    direction?: "ISSUED" | "RECEIVED";
    /** When the document last changed (ISO 8601), to discard events that arrive out of order. */
    updated_at: string;
  };
}
