import { Schema } from "dynamoose";
import { OrderLineStatus } from "../enums/order-line-status.enum";

/**
 * Order Line Schema.
 * A line is the combination of product, plan and seats inside an order, and it
 * is the unit of provisioning: it generates credentials, a contract and an
 * invoice independently of its siblings.
 *
 * Keyed by `productId` + `orderId`, and the pair is the identity of the line:
 * a product appears at most once per order, because a company has one contract
 * per product. A random id would lose that guarantee, since two concurrent
 * requests could both add the same product; with the pair as key, a
 * conditional write refuses the second one. Partitioned by product, so the
 * provisioning queue of a product reads its partition through the local
 * indexes; the lines of an order come from the `orderIndex`.
 *
 * The price is recorded as the facts of the day the order was raised, never as
 * a pointer to the plan, which is the list price and may be archived later:
 *   - `list*`: list price from plan and seats;
 *   - `*DiscountPercent`: discount granted to the customer of the order;
 *   - `offer*`: list price minus that discount, printed on the offer;
 *   - `resellerMargin`: on the indirect channel, the margin copied from the
 *     contract in force of the reseller;
 *   - `billed*`: what Keus invoices. On the direct channel it is the offer
 *     amount; on the indirect one it is the list price minus the margin, so the
 *     reseller's own discount comes out of its margin and never out of Keus's.
 * Amounts are in cents; the recurring ones are per billing interval of the plan,
 * and on a one-off plan they hold the single payment.
 */
export const OrderLineSchema = new Schema({
  /** Identifier of the product the line refers to. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Identifier of the owning order: with the product, the identity of the line. */
  orderId: {
    type: String,
    rangeKey: true,
    required: true,
    index: {
      name: "orderIndex",
      type: "global",
      rangeKey: "productId",
      project: true,
    },
  },
  /** Code of the owning order, copied for the listings. */
  orderCode: {
    type: String,
    required: true,
  },
  /** Name of the product, copied for the offer and the listings. */
  productName: {
    type: String,
    required: true,
  },
  /** Identifier of the plan pricing this line. Optional on a draft, required to generate the offer. */
  planId: {
    type: String,
    required: false,
  },
  /** Name of the plan, copied for the offer and the listings. */
  planName: {
    type: String,
    required: false,
  },
  /** Number of seats sold on this line. Optional on a draft, required to generate the offer. */
  seats: {
    type: Number,
    required: false,
  },
  /**
   * Provisioning state of the line. Absent until the order is confirmed, so the
   * local index holds the work actually released.
   */
  status: {
    type: String,
    enum: Object.values(OrderLineStatus),
    required: false,
    index: {
      name: "statusIndex",
      type: "local",
      project: true,
    },
  },
  /** Identifier of the company, copied from the order. */
  companyId: {
    type: String,
    required: true,
  },
  /** Legal name of the company, copied from the order. */
  companyName: {
    type: String,
    required: true,
  },
  /**
   * Materialized reseller lineage of the seller. Absent on direct orders, so
   * the index is sparse.
   */
  resellerPath: {
    type: String,
    required: false,
    index: {
      name: "resellerPathIndex",
      type: "local",
      project: true,
    },
  },
  /** List activation amount in cents, from the plan. */
  listActivationCents: {
    type: Number,
    required: false,
  },
  /** List recurring amount in cents, from plan and seats. */
  listRecurringCents: {
    type: Number,
    required: false,
  },
  /** Discount on the activation granted to the customer, in percent. */
  activationDiscountPercent: {
    type: Number,
    required: true,
    default: 0,
  },
  /** Discount on the recurring fee granted to the customer, in percent. */
  recurringDiscountPercent: {
    type: Number,
    required: true,
    default: 0,
  },
  /** Activation amount printed on the offer, in cents. */
  offerActivationCents: {
    type: Number,
    required: false,
  },
  /** Recurring amount printed on the offer, in cents. */
  offerRecurringCents: {
    type: Number,
    required: false,
  },
  /** Margin of the reseller, copied from its contract in force. Absent on direct orders. */
  resellerMargin: {
    type: Object,
    required: false,
    schema: {
      /** Margin on the activation, in percent. */
      activationPercent: { type: Number, required: true },
      /** Margin on the recurring fee, in percent. */
      recurringPercent: { type: Number, required: true },
    },
  },
  /** Activation amount Keus invoices, in cents. */
  billedActivationCents: {
    type: Number,
    required: false,
  },
  /** Recurring amount Keus invoices, in cents. */
  billedRecurringCents: {
    type: Number,
    required: false,
  },
  /** Separately-priced assistance component inherited from the plan, at full price. */
  assistance: {
    type: Object,
    required: false,
    schema: {
      /** Assistance amount in cents. */
      amountCents: { type: Number, required: true },
      /** Human-readable label rendered on the offer and on the contract. */
      label: { type: String, required: false },
    },
  },
  /** Identifier of the tenant created at provisioning. */
  tenantId: {
    type: String,
    required: false,
  },
  /** Contract born when the line was provisioned. */
  contractId: {
    type: String,
    required: false,
  },
  /** Code of the contract born when the line was provisioned. */
  contractCode: {
    type: String,
    required: false,
  },
  /** Indirect contract the line takes over, on the order that moves a company to Keus (UR-RK-105). */
  previousContractId: {
    type: String,
    required: false,
  },
  /** End of the period the reseller already paid on the contract taken over: the new one is charged from there. */
  paidUntil: {
    type: String,
    required: false,
  },
  /** ISO timestamp of the confirmation of the order, copied on the line: the provisioning time runs from here. */
  confirmedAt: {
    type: String,
    required: false,
  },
  /** ISO timestamp of the delivery of the credentials. */
  provisionedAt: {
    type: String,
    required: false,
  },
  /** ISO timestamp of the first access with acceptance of the terms. */
  activatedAt: {
    type: String,
    required: false,
  },
},
{
  timestamps: true,
});

/**
 * Order Line Key Interface.
 */
export interface OrderLineKey {
  /** Identifier of the product the line refers to. */
  productId: string;
  /** Identifier of the owning order. */
  orderId: string;
}

/**
 * Order Line Interface.
 */
export interface OrderLine extends OrderLineKey {
  /** Code of the owning order. */
  orderCode: string;
  /** Name of the product. */
  productName: string;
  /** Identifier of the plan pricing this line. */
  planId?: string;
  /** Name of the plan. */
  planName?: string;
  /** Number of seats sold on this line. */
  seats?: number;
  /** Provisioning state of the line. */
  status?: OrderLineStatus;
  /** Identifier of the company. */
  companyId: string;
  /** Legal name of the company. */
  companyName: string;
  /** Materialized reseller lineage of the seller. */
  resellerPath?: string;
  /** List activation amount in cents. */
  listActivationCents?: number;
  /** List recurring amount in cents. */
  listRecurringCents?: number;
  /** Discount on the activation granted to the customer, in percent. */
  activationDiscountPercent: number;
  /** Discount on the recurring fee granted to the customer, in percent. */
  recurringDiscountPercent: number;
  /** Activation amount printed on the offer, in cents. */
  offerActivationCents?: number;
  /** Recurring amount printed on the offer, in cents. */
  offerRecurringCents?: number;
  /** Margin of the reseller. */
  resellerMargin?: {
    /** Margin on the activation, in percent. */
    activationPercent: number;
    /** Margin on the recurring fee, in percent. */
    recurringPercent: number;
  };
  /** Activation amount Keus invoices, in cents. */
  billedActivationCents?: number;
  /** Recurring amount Keus invoices, in cents. */
  billedRecurringCents?: number;
  /** Separately-priced assistance component inherited from the plan. */
  assistance?: {
    /** Assistance amount in cents. */
    amountCents: number;
    /** Human-readable label. */
    label?: string;
  };
  /** Identifier of the tenant created at provisioning. */
  tenantId?: string;
  /** Contract born when the line was provisioned. */
  contractId?: string;
  /** Code of the contract born when the line was provisioned. */
  contractCode?: string;
  /** Indirect contract the line takes over, on the order that moves a company to Keus. */
  previousContractId?: string;
  /** End of the period the reseller already paid on the contract taken over. */
  paidUntil?: string;
  /** ISO timestamp of the confirmation of the order. */
  confirmedAt?: string;
  /** ISO timestamp of the delivery of the credentials. */
  provisionedAt?: string;
  /** ISO timestamp of the first access with acceptance of the terms. */
  activatedAt?: string;
}
