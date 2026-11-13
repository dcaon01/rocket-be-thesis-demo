import { Schema } from "dynamoose";
import { DunningStep } from "../../invoices/enums/dunning-step.enum";
import { ContractStatus } from "../enums/contract-status.enum";
import { ContractTerminationReason } from "../enums/contract-termination-reason.enum";
import { SeatEvent } from "../classes/seat-event.class";
import { SeatEventKind } from "../enums/seat-event-kind.enum";

/**
 * Contract Schema: born when an order line is provisioned, one per tenant, keyed by `productId` + `id`.
 */
export const ContractSchema = new Schema({
  /** Identifier of the product. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Identifier of the contract. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** Human-readable code ({product prefix}-{year}-{sequence}), a label and not a key. */
  code: {
    type: String,
    required: true,
    index: {
      type: 'local',
      name: 'codeIndex',
      project: true,
    },
  },
  /** Company of the tenant, copied here for the contracts of one company. */
  companyId: {
    type: String,
    required: true,
    index: {
      type: 'global',
      name: 'companyIndex',
      rangeKey: 'startDate',
      project: true,
    },
  },
  /** Name of the company, copied for the listings and realigned when the company changes it. */
  companyName: {
    type: String,
    required: true,
  },
  /** Tenant the contract governs. */
  tenantId: {
    type: String,
    required: true,
  },
  /** Plan of the order line. */
  planId: {
    type: String,
    required: true,
  },
  /** Order the contract comes from; with `productId` it identifies the order line. */
  orderId: {
    type: String,
    required: true,
  },
  /** Salesperson who opened the order, copied when the contract is born: who cancels it among the Keus salespeople. */
  assignedSalesId: {
    type: String,
    required: false,
  },
  /** Seats billed: the highest count of active users the tenant reached, which never goes down. */
  seats: {
    type: Number,
    required: true,
  },
  /** Seats already invoiced: below `seats` until the evening run bills the proration of the day (UR-RK-401). */
  invoicedSeats: {
    type: Number,
    required: true,
  },
  /** When the first seat increase not invoiced yet arrived: the proration runs from here; absent when none waits. */
  seatsChangedAt: {
    type: String,
    required: false,
  },
  /** Changes of the users of the tenant: the seats added and the users removed, with their date (UR-RK-401, UR-RK-403). */
  seatEvents: {
    type: Array,
    required: false,
    schema: [{
      type: Object,
      schema: {
        /** When the change arrived (ISO string). */
        at: { type: String, required: true },
        /** What changed. */
        kind: { type: String, enum: Object.values(SeatEventKind), required: true },
        /** Active users of the tenant after the change. */
        users: { type: Number, required: true },
        /** Seats billed after the change. */
        seats: { type: Number, required: true },
      },
    }],
  },
  /** Start date (ISO string). */
  startDate: {
    type: String,
    required: true,
  },
  /** Next renewal date (ISO string); absent on one-off plans, kept once terminated. */
  renewalDate: {
    type: String,
    required: false,
  },
  /** Month of the renewal, present only while the contract will renew (sparse index). */
  renewalMonth: {
    type: String,
    required: false,
    index: {
      type: 'global',
      name: 'renewalIndex',
      rangeKey: 'renewalDate',
      project: true,
    },
  },
  /** Next date the reseller is billed for a period of the fee, on indirect contracts of recurring plans. */
  nextBillingDate: {
    type: String,
    required: false,
  },
  /**
   * End of the period the company already paid through the reseller it came from (UR-RK-105): until then the payment
   * is not required and nothing is charged, then the checkout, the dunning and the subscription start from it.
   */
  paidUntil: {
    type: String,
    required: false,
  },
  /** End of the period the Stripe subscription of a direct contract has paid, from its last paid invoice: the next charge falls on it. */
  subscriptionPaidUntil: {
    type: String,
    required: false,
  },
  /** Amount charged at the next renewal, in cents. */
  renewalAmountCents: {
    type: Number,
    required: false,
  },
  /** Days before the renewal within which a cancellation takes effect only at the following one. */
  noticeDays: {
    type: Number,
    required: true,
    default: 0,
  },
  /** Status of the contract. */
  status: {
    type: String,
    enum: Object.values(ContractStatus),
    required: true,
    default: ContractStatus.Active,
    index: {
      type: 'local',
      name: 'statusIndex',
      project: true,
    },
  },
  /** Date the contract ends or ended (ISO string). */
  terminationDate: {
    type: String,
    required: false,
  },
  /** Why the contract was terminated, when it matters: a transfer of channel is not a loss. */
  terminationReason: {
    type: String,
    enum: Object.values(ContractTerminationReason),
    required: false,
  },
  /** When the customer cancelled the contract; absent on a contract that ends by itself, as a financed one. */
  cancelledAt: {
    type: String,
    required: false,
  },
  /** Month of the termination, present only while the contract is about to end (sparse index). */
  terminationMonth: {
    type: String,
    required: false,
    index: {
      type: 'global',
      name: 'terminatingIndex',
      rangeKey: 'terminationDate',
      project: true,
    },
  },
  /** When the access of the tenant was suspended for an unpaid invoice; absent while the access is regular. */
  accessSuspendedAt: {
    type: String,
    required: false,
  },
  /** Date until which the administration postponed the suspension of the access for an unpaid invoice (ISO string). */
  suspensionPostponedUntil: {
    type: String,
    required: false,
  },
  /** Materialized path of the selling reseller; absent on direct sales. */
  resellerPath: {
    type: String,
    required: false,
    index: {
      type: 'local',
      name: 'resellerPathIndex',
      project: true,
    },
  },
  /** Month of creation, for the code of the year and the metrics. */
  monthIndex: {
    type: String,
    required: true,
    index: {
      type: 'local',
      name: 'monthIndex',
      project: true,
    },
  },
  /** S3 key of the contract document. */
  documentS3Key: {
    type: String,
    required: true,
  },
  /** S3 key of the PDF of the accepted document, written at the acceptance. */
  documentPdfS3Key: {
    type: String,
    required: false,
  },
  /** Template the document was generated from. */
  templateId: {
    type: String,
    required: true,
  },
  /** When the first user accepted the document (ISO string). */
  acceptedAt: {
    type: String,
    required: false,
  },
  /** Product user who accepted the document. */
  acceptedByUserId: {
    type: String,
    required: false,
  },
  /** Stripe customer the contract is charged to. */
  stripeCustomerId: {
    type: String,
    required: false,
  },
  /** Stripe subscription of the recurring charge. */
  stripeSubscriptionId: {
    type: String,
    required: false,
  },
  /** URL of the checkout that starts charging the contract, sent by the backoffice or opened by the referent. */
  checkoutSessionUrl: {
    type: String,
    required: false,
  },
  /** Expiry of the checkout (ISO string). */
  checkoutSessionExpiresAt: {
    type: String,
    required: false,
  },
  /** Last step done of the dunning of a payment never set up, counted from the start of the contract. */
  paymentDunningStep: {
    type: String,
    enum: Object.values(DunningStep),
    required: false,
  },
}, {
  timestamps: true,
});

/** Contract Key Interface. */
export interface ContractKey {
  /** Identifier of the product. */
  productId: string;
  /** Identifier of the contract. */
  id: string;
}

/** Contract Interface. */
export interface Contract extends ContractKey {
  /** Human-readable code ({product prefix}-{year}-{sequence}), a label and not a key. */
  code: string;
  /** Company of the tenant, copied here for the contracts of one company. */
  companyId: string;
  /** Name of the company, copied for the listings and realigned when the company changes it. */
  companyName: string;
  /** Tenant the contract governs. */
  tenantId: string;
  /** Plan of the order line. */
  planId: string;
  /** Order the contract comes from; with `productId` it identifies the order line. */
  orderId: string;
  /** Salesperson who opened the order, copied when the contract is born: who cancels it among the Keus salespeople. */
  assignedSalesId?: string;
  /** Seats of the tenant. */
  seats: number;
  /** Seats already invoiced: below `seats` until the evening run bills the proration of the day. */
  invoicedSeats: number;
  /** When the first seat increase not invoiced yet arrived: the proration runs from here; absent when none waits. */
  seatsChangedAt?: string;
  /** Changes of the users of the tenant: the seats added and the users removed, with their date. */
  seatEvents?: SeatEvent[];
  /** Start date (ISO string). */
  startDate: string;
  /** Next renewal date (ISO string); absent on one-off plans, kept once terminated. */
  renewalDate?: string;
  /** Month of the renewal, present only while the contract will renew (sparse index). */
  renewalMonth?: string;
  /** Next date the reseller is billed for a period of the fee, on indirect contracts of recurring plans. */
  nextBillingDate?: string;
  /** End of the period the company already paid through the reseller it came from; nothing is charged before it. */
  paidUntil?: string;
  /** End of the period the Stripe subscription of a direct contract has paid, from its last paid invoice: the next charge falls on it. */
  subscriptionPaidUntil?: string;
  /** Amount charged at the next renewal, in cents. */
  renewalAmountCents?: number;
  /** Days before the renewal within which a cancellation takes effect only at the following one. */
  noticeDays: number;
  /** Status of the contract. */
  status: ContractStatus;
  /** Date the contract ends or ended (ISO string). */
  terminationDate?: string;
  /** Why the contract was terminated, when it matters: a transfer of channel is not a loss. */
  terminationReason?: ContractTerminationReason;
  /** When the customer cancelled the contract; absent on a contract that ends by itself, as a financed one. */
  cancelledAt?: string;
  /** Month of the termination, present only while the contract is about to end (sparse index). */
  terminationMonth?: string;
  /** When the access of the tenant was suspended for an unpaid invoice; absent while the access is regular. */
  accessSuspendedAt?: string;
  /** Date until which the administration postponed the suspension of the access for an unpaid invoice (ISO string). */
  suspensionPostponedUntil?: string;
  /** Materialized path of the selling reseller; absent on direct sales. */
  resellerPath?: string;
  /** Month of creation, for the code of the year and the metrics. */
  monthIndex: string;
  /** S3 key of the contract document. */
  documentS3Key: string;
  /** S3 key of the PDF of the accepted document, written at the acceptance. */
  documentPdfS3Key?: string;
  /** Template the document was generated from. */
  templateId: string;
  /** When the first user accepted the document (ISO string). */
  acceptedAt?: string;
  /** Product user who accepted the document. */
  acceptedByUserId?: string;
  /** Stripe customer the contract is charged to. */
  stripeCustomerId?: string;
  /** Stripe subscription of the recurring charge. */
  stripeSubscriptionId?: string;
  /** URL of the checkout that starts charging the contract, sent by the backoffice or opened by the referent. */
  checkoutSessionUrl?: string;
  /** Expiry of the checkout (ISO string). */
  checkoutSessionExpiresAt?: string;
  /** Last step done of the dunning of a payment never set up, counted from the start of the contract. */
  paymentDunningStep?: DunningStep;
  /** Creation timestamp. */
  createdAt: string;
  /** Last update timestamp. */
  updatedAt: string;
}
