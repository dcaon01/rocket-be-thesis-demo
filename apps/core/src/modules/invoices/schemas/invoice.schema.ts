import { Schema } from "dynamoose";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { BilledPartyType } from "../enums/billed-party-type.enum";
import { InvoiceDocumentStatus } from "../enums/invoice-document-status.enum";
import { InvoiceStatus } from "../enums/invoice-status.enum";
import { DunningStep } from "../enums/dunning-step.enum";

/**
 * Invoice Schema.
 * An invoice issued to a party: a company, a reseller or the finance company of a financed order.
 * It is partitioned by the billed party, so the invoices of a party are one query on `issuedIndex`.
 *
 * The fiscal document is Sibill's; the charge is always Stripe's, on the account of a product or on
 * the Keus one. Several invoices can share one Stripe invoice: a reseller gets an invoice per line
 * and a single monthly charge. Amounts follow the electronic invoice: the items and `taxableCents`
 * are net of VAT, `vatCents` is computed once on the taxable at `vatRatePercent`.
 *
 * `dueMonth` is written on every invoice with a due date and removed only when it is void, so
 * `scheduleIndex` holds the payments to collect and the collected ones; `unpaidChannel` is written only
 * while the charge has failed, so `unpaidIndex` is sparse and empties itself as invoices are paid.
 * `paidMonth` is written only at collection, so `paidMonthIndex` is sparse and holds what each month collected.
 */
export const InvoiceSchema = new Schema({
  /** Identifier of the billed party: company, reseller, or the financier (`Financier` value) of a financed order. */
  billedPartyId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Identifier of the invoice. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** Kind of the billed party. */
  billedPartyType: {
    type: String,
    enum: Object.values(BilledPartyType),
    required: true,
  },
  /** Details of the billed party as they were at issue, with the fiscal data the electronic invoice needs. */
  billedParty: {
    type: Object,
    required: true,
  },
  /** Channel of the sale the invoice belongs to. */
  channel: {
    type: String,
    enum: Object.values(SalesChannel),
    required: true,
  },
  /** Issue timestamp (ISO 8601). */
  issuedAt: {
    type: String,
    required: true,
    index: {
      name: "issuedIndex",
      type: "local",
      project: true,
    },
  },
  /** Month of issue (YYYY-MM), for the monthly views. */
  issueMonth: {
    type: String,
    required: true,
    index: {
      name: "monthIndex",
      type: "global",
      rangeKey: "issuedAt",
      project: true,
    },
  },
  /** Due date (YYYY-MM-DD). */
  dueDate: {
    type: String,
    required: false,
  },
  /** Month of the due date (YYYY-MM), until the invoice is void. */
  dueMonth: {
    type: String,
    required: false,
    index: {
      name: "scheduleIndex",
      type: "global",
      rangeKey: "dueDate",
      project: true,
    },
  },
  /** Channel of the invoice, only while it is unpaid. */
  unpaidChannel: {
    type: String,
    enum: Object.values(SalesChannel),
    required: false,
    index: {
      name: "unpaidIndex",
      type: "global",
      rangeKey: "issuedAt",
      project: true,
    },
  },
  /** State of the invoice. */
  status: {
    type: String,
    enum: Object.values(InvoiceStatus),
    required: true,
    default: InvoiceStatus.Open,
  },
  /** Total in cents, taxes included: `taxableCents` plus `vatCents`. */
  amountCents: {
    type: Number,
    required: true,
  },
  /** Taxable amount in cents: the sum of the items, net of VAT and of the discounts. */
  taxableCents: {
    type: Number,
    required: true,
  },
  /** VAT in cents, computed once on `taxableCents` and rounded half up, as the exchange system checks it. */
  vatCents: {
    type: Number,
    required: true,
  },
  /** VAT rate in percent. */
  vatRatePercent: {
    type: Number,
    required: true,
  },
  /** Lines of the invoice: description, taxable amount in cents and, for an order line, its order and product. */
  items: {
    type: Array,
    schema: [{
      type: Object,
      schema: {
        description: { type: String, required: true },
        amountCents: { type: Number, required: true },
        orderId: { type: String, required: false },
        productId: { type: String, required: false },
      },
    }],
    required: true,
  },
  /** Order the invoice arises from, when it bills a single order. */
  orderId: {
    type: String,
    required: false,
  },
  /** Product of the order line the invoice arises from, with `orderId`. */
  lineProductId: {
    type: String,
    required: false,
  },
  /** Contract of the company the invoice arises from. */
  contractId: {
    type: String,
    required: false,
    index: {
      name: "contractIndex",
      type: "global",
      rangeKey: "issuedAt",
      project: true,
    },
  },
  /** Reseller contract whose fee the invoice bills. */
  resellerContractId: {
    type: String,
    required: false,
  },
  /** First day of the period of fee an invoice bills, when it bills one; with the contract it identifies the invoice. */
  billingPeriodStart: {
    type: String,
    required: false,
  },
  /** Proration of seats the invoice bills, one per seats reached or per anniversary; with the contract it identifies the invoice. */
  prorationId: {
    type: String,
    required: false,
  },
  /** Month whose 4th day charges the invoice, present only until it is charged (sparse index). */
  toChargeMonth: {
    type: String,
    required: false,
    index: {
      name: "toChargeIndex",
      type: "global",
      rangeKey: "billedPartyId",
      project: true,
    },
  },
  /** Stripe account that collects: the product id, or `keus`. */
  stripeAccount: {
    type: String,
    required: true,
  },
  /** Stripe invoice that charges the amount. */
  stripeInvoiceId: {
    type: String,
    required: false,
    index: {
      name: "stripeInvoiceIndex",
      type: "global",
      project: true,
    },
  },
  /**
   * Where the electronic invoice stands: the steps of Rocket up to the draft at Sibill, then the states Sibill
   * reports. Absent on the invoices Rocket does not issue (finance company).
   */
  documentStatus: {
    type: String,
    enum: Object.values(InvoiceDocumentStatus),
    required: false,
  },
  /** Why the last issue failed or is uncertain, for the operator. */
  documentError: {
    type: String,
    required: false,
  },
  /** Number of the electronic invoice, assigned by Sibill: it may arrive only when the CEO issues the draft. */
  number: {
    type: String,
    required: false,
  },
  /** Identifier of the document at Sibill: its webhook finds the invoice through the sparse `sibillIndex`. */
  sibillId: {
    type: String,
    required: false,
    index: {
      name: "sibillIndex",
      type: "global",
      project: true,
    },
  },
  /** When Sibill last changed the document (ISO 8601): an event older than this one is discarded. */
  documentUpdatedAt: {
    type: String,
    required: false,
  },
  /** Collection timestamp (ISO 8601). */
  paidAt: {
    type: String,
    required: false,
  },
  /** Month of collection (YYYY-MM), written with `paidAt`: the revenue of a month is what was collected in it. */
  paidMonth: {
    type: String,
    required: false,
    index: {
      name: "paidMonthIndex",
      type: "global",
      rangeKey: "paidAt",
      project: true,
    },
  },
  /** Collection attempts that failed, as Stripe counts them on the charge. */
  failedAttempts: {
    type: Number,
    required: false,
  },
  /** When the last collection attempt failed (ISO 8601). */
  lastFailedAt: {
    type: String,
    required: false,
  },
  /** When the customer disputed the debit of the invoice with its bank (ISO 8601): the dunning counts from here. */
  disputedAt: {
    type: String,
    required: false,
  },
  /** Last step of the dunning done on the unpaid invoice. */
  dunningStep: {
    type: String,
    enum: Object.values(DunningStep),
    required: false,
  },
  /** S3 key of the pro forma PDF sent to the reseller, on the invoices charged on the 4th. */
  proFormaS3Key: {
    type: String,
    required: false,
  },
}, {
  timestamps: true,
  saveUnknown: ["billedParty.**"],
});

/** Invoice Key Interface. Composite key used by Dynamoose to address a single invoice. */
export interface InvoiceKey {
  /** Identifier of the billed party. */
  billedPartyId: string;
  /** Identifier of the invoice. */
  id: string;
}

/** Structured address of a billed party, as the electronic invoice wants it. */
export interface BilledPartyAddress {
  /** Street and number. */
  street: string;
  /** City. */
  city: string;
  /** Postal code. */
  zipCode: string;
  /** Province code. */
  province?: string;
  /** ISO country code; Italy when absent. */
  country?: string;
}

/** Details of the billed party as they were at issue. */
export interface BilledPartyDetails {
  /** Legal name. */
  name: string;
  /** VAT number. */
  vatNumber?: string;
  /** Fiscal code. */
  fiscalCode?: string;
  /** Email the invoice is sent to. */
  email?: string;
  /** Address, as one line. */
  address?: string;
  /** Structured legal address, for the electronic invoice. */
  legalAddress?: BilledPartyAddress;
  /** Interchange code (codice destinatario) of the electronic invoice. */
  sdi?: string;
  /** Certified email, where the exchange system delivers when there is no interchange code. */
  pec?: string;
}

/** A line of an invoice. */
export interface InvoiceItem {
  /** What the line bills. */
  description: string;
  /** Taxable amount in cents, net of VAT and of the discounts. */
  amountCents: number;
  /** Order of the order line billed. */
  orderId?: string;
  /** Product of the order line billed. */
  productId?: string;
}

/** Invoice Interface. Full shape of an invoice as stored in DynamoDB. */
export interface Invoice extends InvoiceKey {
  /** Kind of the billed party. */
  billedPartyType: BilledPartyType;
  /** Details of the billed party as they were at issue. */
  billedParty: BilledPartyDetails;
  /** Channel of the sale the invoice belongs to. */
  channel: SalesChannel;
  /** Issue timestamp (ISO 8601). */
  issuedAt: string;
  /** Month of issue (YYYY-MM). */
  issueMonth: string;
  /** Due date (YYYY-MM-DD). */
  dueDate?: string;
  /** Month of the due date, until the invoice is void. */
  dueMonth?: string;
  /** Channel of the invoice, only while it is unpaid. */
  unpaidChannel?: SalesChannel;
  /** State of the invoice. */
  status: InvoiceStatus;
  /** Total in cents, taxes included. */
  amountCents: number;
  /** Taxable amount in cents, net of VAT. */
  taxableCents: number;
  /** VAT in cents. */
  vatCents: number;
  /** VAT rate in percent. */
  vatRatePercent: number;
  /** Lines of the invoice. */
  items: InvoiceItem[];
  /** Order the invoice arises from, when it bills a single order. */
  orderId?: string;
  /** Product of the order line the invoice arises from. */
  lineProductId?: string;
  /** Contract of the company the invoice belongs to. */
  contractId?: string;
  /** Reseller contract whose fee the invoice bills. */
  resellerContractId?: string;
  /** First day of the period of fee an invoice bills, when it bills one; with the contract it identifies the invoice. */
  billingPeriodStart?: string;
  /** Proration of seats the invoice bills, one per seats reached or per anniversary; with the contract it identifies the invoice. */
  prorationId?: string;
  /** Month whose 4th day charges the invoice, present only until it is charged (sparse index). */
  toChargeMonth?: string;
  /** Stripe account that collects: the product id, or `keus`. */
  stripeAccount: string;
  /** Stripe invoice that charges the amount. */
  stripeInvoiceId?: string;
  /** Where the electronic invoice stands: the steps of Rocket, then the states Sibill reports; absent on the invoices Rocket does not issue. */
  documentStatus?: InvoiceDocumentStatus;
  /** Why the last issue failed or is uncertain. */
  documentError?: string;
  /** Number of the electronic invoice, assigned by Sibill. */
  number?: string;
  /** Identifier of the document at Sibill. */
  sibillId?: string;
  /** When Sibill last changed the document (ISO 8601). */
  documentUpdatedAt?: string;
  /** Collection timestamp (ISO 8601). */
  paidAt?: string;
  /** Month of collection (YYYY-MM). */
  paidMonth?: string;
  /** Collection attempts that failed, as Stripe counts them on the charge. */
  failedAttempts?: number;
  /** When the last collection attempt failed (ISO 8601). */
  lastFailedAt?: string;
  /** When the customer disputed the debit of the invoice with its bank (ISO 8601): the dunning counts from here. */
  disputedAt?: string;
  /** Last step of the dunning done on the unpaid invoice. */
  dunningStep?: DunningStep;
  /** S3 key of the pro forma PDF sent to the reseller, on the invoices charged on the 4th. */
  proFormaS3Key?: string;
  /** Creation timestamp. */
  createdAt?: Date;
  /** Last update timestamp. */
  updatedAt?: Date;
}
