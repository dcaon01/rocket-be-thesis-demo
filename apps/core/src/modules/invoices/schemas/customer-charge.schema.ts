import { Schema } from "dynamoose";
import { ChargeCadence } from "../enums/charge-cadence.enum";
import { CustomerChargeKind } from "../enums/customer-charge-kind.enum";

/**
 * Customer Charge Schema.
 * What a reseller bills one of its customers, keyed by `resellerId` (hashKey) + `id` (rangeKey). Rocket writes the
 * share of each period or proration of an indirect contract when it bills the reseller, with the id of the invoice
 * of Keus, so writing it again changes nothing; the reseller adds its own items, once or recurring. Rocket issues
 * nothing to the customer: the reseller marks what it collected.
 *
 * A single item has `dueDate`, read by the sparse local `dueIndex`; a recurring item has `ruleStart`, read by the
 * sparse local `ruleIndex`, and its due dates are counted from the rule when read, never stored one by one.
 */
export const CustomerChargeSchema = new Schema({
  /** Reseller that bills the customer. */
  resellerId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Identifier of the item: the invoice of Keus for the share of a contract, random for the others. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** Kind of the item. */
  kind: {
    type: String,
    enum: Object.values(CustomerChargeKind),
    required: true,
  },
  /** Company billed, a customer of the reseller. */
  companyId: {
    type: String,
    required: true,
  },
  /** Name of the company. */
  companyName: {
    type: String,
    required: true,
  },
  /** What the item bills. */
  description: {
    type: String,
    required: true,
  },
  /** Amount of each due date, net of VAT, in cents. */
  amountCents: {
    type: Number,
    required: true,
  },
  /** Due date of a single item (ISO string); absent on a recurring one, so the index is sparse. */
  dueDate: {
    type: String,
    required: false,
    index: {
      name: "dueIndex",
      type: "local",
      project: true,
    },
  },
  /** When a single item was collected (ISO string). */
  collectedAt: {
    type: String,
    required: false,
  },
  /** First due date of a recurring item (ISO string); present only on recurring ones, so the index is sparse. */
  ruleStart: {
    type: String,
    required: false,
    index: {
      name: "ruleIndex",
      type: "local",
      project: true,
    },
  },
  /** Cadence of a recurring item. */
  cadence: {
    type: String,
    enum: Object.values(ChargeCadence),
    required: false,
  },
  /** Last day a recurring item can fall due (ISO string); absent while it goes on. */
  ruleEnd: {
    type: String,
    required: false,
  },
  /** Due dates of a recurring item already collected: a set, so one is added or taken away on its own. */
  collectedDates: {
    type: Set,
    schema: [String],
    required: false,
  },
  /** Contract whose share the item is. */
  contractId: {
    type: String,
    required: false,
  },
  /** Product of the contract. */
  productId: {
    type: String,
    required: false,
  },
  /** Code of the contract. */
  contractCode: {
    type: String,
    required: false,
  },
  /** End of the period of the contract billed (ISO string); absent on a one-off plan. */
  periodEnd: {
    type: String,
    required: false,
  },
  /** What Keus bills the reseller for the same period, net of VAT, in cents; absent on the reseller's own items. */
  keusCents: {
    type: Number,
    required: false,
  },
  /** Salesperson who sold it: who opened the order of the contract. Absent on an own item, which is no salesperson's. */
  salesId: {
    type: String,
    required: false,
  },
}, {
  timestamps: true,
});

/** Customer Charge Key Interface. Composite key used by Dynamoose to address a single item. */
export interface CustomerChargeKey {
  /** Reseller that bills the customer. */
  resellerId: string;
  /** Identifier of the item. */
  id: string;
}

/** Customer Charge Interface. Full shape of an item as stored in DynamoDB. */
export interface CustomerCharge extends CustomerChargeKey {
  /** Kind of the item. */
  kind: CustomerChargeKind;
  /** Company billed, a customer of the reseller. */
  companyId: string;
  /** Name of the company. */
  companyName: string;
  /** What the item bills. */
  description: string;
  /** Amount of each due date, net of VAT, in cents. */
  amountCents: number;
  /** Due date of a single item (ISO string). */
  dueDate?: string;
  /** When a single item was collected (ISO string). */
  collectedAt?: string;
  /** First due date of a recurring item (ISO string). */
  ruleStart?: string;
  /** Cadence of a recurring item. */
  cadence?: ChargeCadence;
  /** Last day a recurring item can fall due (ISO string). */
  ruleEnd?: string;
  /** Due dates of a recurring item already collected. */
  collectedDates?: Set<string>;
  /** Contract whose share the item is. */
  contractId?: string;
  /** Product of the contract. */
  productId?: string;
  /** Code of the contract. */
  contractCode?: string;
  /** End of the period of the contract billed (ISO string). */
  periodEnd?: string;
  /** What Keus bills the reseller for the same period, net of VAT, in cents. */
  keusCents?: number;
  /** Salesperson who sold it; absent on an own item. */
  salesId?: string;
  /** Creation timestamp. */
  createdAt?: Date;
  /** Last update timestamp. */
  updatedAt?: Date;
}
