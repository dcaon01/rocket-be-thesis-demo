import { Schema } from "dynamoose";
import { CustomizationAttachment } from "../classes/customization-attachment.class";
import { CustomizationAttachmentType } from "../enums/customization-attachment-type.enum";
import { CustomizationKind } from "../enums/customization-kind.enum";
import { CustomizationStatus } from "../enums/customization-status.enum";

/**
 * Order Customization Schema.
 * A customization is a need the listed product does not cover, described as
 * text and files. It blocks the offer until the back office has priced or
 * refused it. An order carries one per line, on the product of the line.
 *
 * The amounts follow the same model as the order lines: the back office prices
 * the list amounts, the seller may grant a discount printed on the offer, and on
 * the indirect channel Keus invoices the list amounts minus the reseller's
 * customization margin, whatever discount the reseller grants.
 *
 * Partitioned by order, so every request of an order comes back in one query,
 * with a global index on the status for the queue of whoever prices them.
 */
export const OrderCustomizationSchema = new Schema({
  /** Identifier of the owning order. */
  orderId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Identifier of the customization request. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** Code of the owning order, copied for the queue listing. */
  orderCode: {
    type: String,
    required: true,
  },
  /**
   * Lifecycle state. Global index sorted by request date, so the back office
   * opens its queue with a single query.
   */
  status: {
    type: String,
    enum: Object.values(CustomizationStatus),
    required: true,
    default: CustomizationStatus.Requested,
    index: {
      name: "statusIndex",
      type: "global",
      rangeKey: "requestedAt",
      project: true,
    },
  },
  /** ISO timestamp of the request. */
  requestedAt: {
    type: String,
    required: true,
  },
  /** What the customization is attached to: a line of the order. */
  kind: {
    type: String,
    enum: Object.values(CustomizationKind),
    required: true,
  },
  /** Product of the line the customization is attached to. */
  productId: {
    type: String,
    required: false,
  },
  /** The need, described in words. */
  description: {
    type: String,
    required: false,
  },
  /** Files describing the need: PDFs and voice notes. */
  attachments: {
    type: Array,
    required: false,
    schema: [{
      type: Object,
      schema: {
        /** S3 key of the file. */
        s3Key: { type: String, required: true },
        /** Kind of the file. */
        type: { type: String, enum: Object.values(CustomizationAttachmentType), required: true },
        /** Name of the file. */
        name: { type: String, required: true },
      },
    }],
  },
  /** One-off list amount priced by the back office, in cents. */
  listOneOffCents: {
    type: Number,
    required: false,
  },
  /** Increase of the recurring fee priced by the back office, in cents. */
  listRecurringIncreaseCents: {
    type: Number,
    required: false,
  },
  /** Discount granted to the customer on the customization, in percent. */
  discountPercent: {
    type: Number,
    required: true,
    default: 0,
  },
  /** One-off amount printed on the offer, in cents. */
  offerOneOffCents: {
    type: Number,
    required: false,
  },
  /** Increase of the recurring fee printed on the offer, in cents. */
  offerRecurringIncreaseCents: {
    type: Number,
    required: false,
  },
  /** Customization margin of the reseller, copied from its contract in force. Absent on direct orders. */
  resellerMarginPercent: {
    type: Number,
    required: false,
  },
  /** One-off amount Keus invoices, in cents. */
  billedOneOffCents: {
    type: Number,
    required: false,
  },
  /** Increase of the recurring fee Keus invoices, in cents. */
  billedRecurringIncreaseCents: {
    type: Number,
    required: false,
  },
  /** Reason the request was refused. Free text, mandatory on refusal. */
  refusalReason: {
    type: String,
    required: false,
  },
  /** Cognito sub of whoever priced or refused it. */
  evaluatedBySub: {
    type: String,
    required: false,
  },
  /** ISO timestamp of the evaluation. */
  evaluatedAt: {
    type: String,
    required: false,
  },
  /** Cognito sub of whoever wrote the request, recipient of the refusal. */
  authorSub: {
    type: String,
    required: false,
  },
  /** Materialized reseller lineage of the seller. Absent on direct orders. */
  resellerPath: {
    type: String,
    required: false,
  },
},
{
  timestamps: true,
});

/**
 * Order Customization Key Interface.
 */
export interface OrderCustomizationKey {
  /** Identifier of the owning order. */
  orderId: string;
  /** Identifier of the customization request. */
  id: string;
}

/**
 * Order Customization Interface.
 */
export interface OrderCustomization extends OrderCustomizationKey {
  /** Code of the owning order. */
  orderCode: string;
  /** Lifecycle state. */
  status: CustomizationStatus;
  /** ISO timestamp of the request. */
  requestedAt: string;
  /** What the customization is attached to: a line of the order. */
  kind: CustomizationKind;
  /** Product of the line the customization is attached to. */
  productId?: string;
  /** The need, described in words. */
  description?: string;
  /** Files describing the need: PDFs and voice notes. */
  attachments?: CustomizationAttachment[];
  /** One-off list amount priced, in cents. */
  listOneOffCents?: number;
  /** Increase of the recurring fee priced, in cents. */
  listRecurringIncreaseCents?: number;
  /** Discount granted to the customer, in percent. */
  discountPercent: number;
  /** One-off amount printed on the offer, in cents. */
  offerOneOffCents?: number;
  /** Increase of the recurring fee printed on the offer, in cents. */
  offerRecurringIncreaseCents?: number;
  /** Customization margin of the reseller, in percent. */
  resellerMarginPercent?: number;
  /** One-off amount Keus invoices, in cents. */
  billedOneOffCents?: number;
  /** Increase of the recurring fee Keus invoices, in cents. */
  billedRecurringIncreaseCents?: number;
  /** Reason the request was refused. */
  refusalReason?: string;
  /** Cognito sub of whoever evaluated it. */
  evaluatedBySub?: string;
  /** ISO timestamp of the evaluation. */
  evaluatedAt?: string;
  /** Cognito sub of whoever wrote the request. */
  authorSub?: string;
  /** Materialized reseller lineage of the seller. */
  resellerPath?: string;
}
