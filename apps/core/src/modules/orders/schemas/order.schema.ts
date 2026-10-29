import { Schema } from "dynamoose";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { Financier } from "../enums/financier.enum";
import { OrderRefusalReason } from "../enums/order-refusal-reason.enum";
import { OrderStatus } from "../enums/order-status.enum";

/**
 * Order Schema.
 * An order is the supply request for a single company. It is the commercial
 * wrapper, while its lines are the units of provisioning: each line generates
 * credentials, a contract and an invoice on its own.
 *
 * Keyed by a generated `id`: the code is a human-readable label, looked up
 * through its own index, and never identifies the order. Lines and
 * customization requests live in their own tables: the split is practical, not
 * conceptual, and leaves room for several customization requests per order and
 * for writes of their own on each line. The order keeps a summary
 * of both, rewritten in the same transaction that changes a line or a request,
 * so the queue filters on it without reading the lines.
 *
 * Indexes:
 *   - codeIndex: `code`, to find an order by its code;
 *   - statusIndex: `status` + `requestedAt`, the listing: one partition per
 *     status, merged newest first;
 *   - companyIndex: `companyId` + `requestedAt`;
 *   - resellerIndex: `rootResellerCode` + `requestedAt`, sparse, the listing of
 *     a reseller network, narrowed to the viewer's subtree by path prefix;
 *   - monthIndex: `requestMonth` + `code`, the history by month, also read to
 *     find the last code handed out;
 *   - dealIndex: `dealId`, sparse, so a won deal never opens two orders.
 */
export const OrderSchema = new Schema({
  /** Identifier of the order. */
  id: {
    type: String,
    hashKey: true,
    required: true,
  },
  /**
   * Human-readable order code (e.g. "ORD-2026-00001"), generated at creation as
   * the last code of the year plus one, and editable by hand.
   */
  code: {
    type: String,
    required: true,
    index: {
      name: "codeIndex",
      type: "global",
    },
  },
  /**
   * Identifier of the company the order is placed for. One company per order:
   * a second company means a second order.
   */
  companyId: {
    type: String,
    required: true,
    index: {
      name: "companyIndex",
      type: "global",
      rangeKey: "requestedAt",
      project: true,
    },
  },
  /** Legal name of the company, copied so the listings need no join. */
  companyName: {
    type: String,
    required: true,
  },
  /** VAT number of the company, copied for the search in the queue. */
  companyVatNumber: {
    type: String,
    required: false,
  },
  /** Lifecycle state of the order. */
  status: {
    type: String,
    enum: Object.values(OrderStatus),
    required: true,
    default: OrderStatus.Draft,
    index: {
      name: "statusIndex",
      type: "global",
      rangeKey: "requestedAt",
      project: true,
    },
  },
  /**
   * Sales channel, taken from the company: DIRECT when Keus sells, RESELLER when
   * a reseller does.
   */
  channel: {
    type: String,
    enum: Object.values(SalesChannel),
    required: true,
  },
  /** Code of the reseller at the root of the seller's network. Absent on direct orders. */
  rootResellerCode: {
    type: String,
    required: false,
    index: {
      name: "resellerIndex",
      type: "global",
      rangeKey: "requestedAt",
      project: true,
    },
  },
  /** Materialized reseller lineage of the seller ("RVD-001#"). Absent on direct orders. */
  resellerPath: {
    type: String,
    required: false,
  },
  /** Cognito sub of whoever opened the order. A reseller salesperson sees only their own. */
  assignedSalesId: {
    type: String,
    required: false,
  },
  /** ISO timestamp of the request. */
  requestedAt: {
    type: String,
    required: true,
  },
  /** Month of the request ("YYYY-MM"), partition of the history index. */
  requestMonth: {
    type: String,
    required: true,
    index: {
      name: "monthIndex",
      type: "global",
      rangeKey: "code",
      project: true,
    },
  },
  /** Identifier of the CRM deal that opened the order. */
  dealId: {
    type: String,
    required: false,
    index: {
      name: "dealIndex",
      type: "global",
    },
  },
  /** Number of lines of the order. */
  linesTotal: {
    type: Number,
    required: true,
    default: 0,
  },
  /** Number of lines provisioned. */
  linesProvisioned: {
    type: Number,
    required: true,
    default: 0,
  },
  /** Number of lines activated. */
  linesActivated: {
    type: Number,
    required: true,
    default: 0,
  },
  /** Identifiers of the products on the lines, for the product filter of the queue. */
  productIds: {
    type: Array,
    schema: [String],
    required: true,
    default: [],
  },
  /** Names of the products on the lines, for the queue listing. */
  productNames: {
    type: Array,
    schema: [String],
    required: true,
    default: [],
  },
  /** Whether the order carries a customization request, marked in the queue. */
  hasCustomization: {
    type: Boolean,
    required: true,
    default: false,
  },
  /** Customization requests still waiting for the back office: the offer cannot be generated until it is zero. */
  pendingCustomizations: {
    type: Number,
    required: true,
    default: 0,
  },
  /** Identifier of the template the offer was generated from, for traceability. */
  offerTemplateId: {
    type: String,
    required: false,
  },
  /** ISO timestamp of the offer generation. */
  offerGeneratedAt: {
    type: String,
    required: false,
  },
  /** S3 key of the signed offer uploaded on acceptance. */
  signedOfferS3Key: {
    type: String,
    required: false,
  },
  /** ISO timestamp of the acceptance. */
  acceptedAt: {
    type: String,
    required: false,
  },
  /** When the reseller asked the Keus back office to approve its offer. */
  approvalRequestedAt: {
    type: String,
    required: false,
  },
  /** When the Keus back office approved the offer of the reseller. */
  approvedAt: {
    type: String,
    required: false,
  },
  /** Cognito sub of who approved the offer. */
  approvedBySub: {
    type: String,
    required: false,
  },
  /** Reason the Keus back office refused the approval, for the reseller. */
  approvalRefusalReason: {
    type: String,
    required: false,
  },
  /** Reason the offer was turned down, from the closed list. */
  refusalReason: {
    type: String,
    enum: Object.values(OrderRefusalReason),
    required: false,
  },
  /** Free-text note accompanying the refusal. Mandatory when the reason is OTHER. */
  refusalNote: {
    type: String,
    required: false,
  },
  /** Finance company paying the order, on the direct channel only. */
  financier: {
    type: String,
    enum: Object.values(Financier),
    required: false,
  },
  /** Identifier of the financing application. */
  financierReference: {
    type: String,
    required: false,
  },
  /** S3 key of the contract signed with the finance company. */
  financingContractS3Key: {
    type: String,
    required: false,
  },
  /** Years of fee the finance company pays upfront, the duration of the order; required with a recurring line. */
  financedYears: {
    type: Number,
    required: false,
  },
  /** Expected delivery date (ISO), set at confirmation. */
  deliveryDate: {
    type: String,
    required: false,
  },
  /** ISO timestamp of the confirmation by Keus, where the provisioning time of the sales metrics starts. */
  confirmedAt: {
    type: String,
    required: false,
  },
  /** ISO timestamp of the notice to Keus that the order is past its delivery date, sent once. */
  overdueNoticedAt: {
    type: String,
    required: false,
  },
  /**
   * Code of the inactive reseller the company came from, on the order that moves its contracts to Keus (UR-RK-105).
   * That order is born confirmed, with no offer, and its lines are provisioned on the tenants the company has.
   */
  transferredFromResellerCode: {
    type: String,
    required: false,
  },
},
{
  timestamps: true,
});

/**
 * Order Key Interface.
 */
export interface OrderKey {
  /** Identifier of the order. */
  id: string;
}

/**
 * Order Interface.
 */
export interface Order extends OrderKey {
  /** Human-readable order code. */
  code: string;
  /** Identifier of the company the order is placed for. */
  companyId: string;
  /** Legal name of the company. */
  companyName: string;
  /** VAT number of the company. */
  companyVatNumber?: string;
  /** Lifecycle state of the order. */
  status: OrderStatus;
  /** Sales channel of the order. */
  channel: SalesChannel;
  /** Code of the reseller at the root of the seller's network. */
  rootResellerCode?: string;
  /** Materialized reseller lineage of the seller. */
  resellerPath?: string;
  /** Cognito sub of whoever opened the order. */
  assignedSalesId?: string;
  /** ISO timestamp of the request. */
  requestedAt: string;
  /** Month of the request ("YYYY-MM"). */
  requestMonth: string;
  /** Identifier of the CRM deal that opened the order. */
  dealId?: string;
  /** Number of lines of the order. */
  linesTotal: number;
  /** Number of lines provisioned. */
  linesProvisioned: number;
  /** Number of lines activated. */
  linesActivated: number;
  /** Identifiers of the products on the lines. */
  productIds: string[];
  /** Names of the products on the lines. */
  productNames: string[];
  /** Whether the order carries a customization request. */
  hasCustomization: boolean;
  /** Customization requests still waiting for the back office. */
  pendingCustomizations: number;
  /** Identifier of the template the offer was generated from. */
  offerTemplateId?: string;
  /** ISO timestamp of the offer generation. */
  offerGeneratedAt?: string;
  /** S3 key of the signed offer. */
  signedOfferS3Key?: string;
  /** ISO timestamp of the acceptance. */
  acceptedAt?: string;
  /** When the reseller asked the Keus back office to approve its offer. */
  approvalRequestedAt?: string;
  /** When the Keus back office approved the offer of the reseller. */
  approvedAt?: string;
  /** Cognito sub of who approved the offer. */
  approvedBySub?: string;
  /** Reason the Keus back office refused the approval, for the reseller. */
  approvalRefusalReason?: string;
  /** Reason the offer was turned down. */
  refusalReason?: OrderRefusalReason;
  /** Free-text note accompanying the refusal. */
  refusalNote?: string;
  /** Finance company paying the order. */
  financier?: Financier;
  /** Identifier of the financing application. */
  financierReference?: string;
  /** S3 key of the contract signed with the finance company. */
  financingContractS3Key?: string;
  /** Years of fee the finance company pays upfront, the duration of the order; required with a recurring line. */
  financedYears?: number;
  /** Expected delivery date (ISO). */
  deliveryDate?: string;
  /** ISO timestamp of the confirmation by Keus. */
  confirmedAt?: string;
  /** ISO timestamp of the notice to Keus that the order is past its delivery date, sent once. */
  overdueNoticedAt?: string;
  /** Code of the inactive reseller the company came from, on the order that moves its contracts to Keus. */
  transferredFromResellerCode?: string;
  /** ISO timestamp of the creation. */
  createdAt?: string;
  /** ISO timestamp of the last update. */
  updatedAt?: string;
}
