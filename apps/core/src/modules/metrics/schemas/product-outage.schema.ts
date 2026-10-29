import { Schema } from "dynamoose";

/**
 * Product Outage Schema.
 * A closed outage of a product (UR-RK-225): from the first check it did not answer to the first one it answered
 * again. The checks run every 15 minutes, so an outage shorter than that may not appear, and the bounds are as
 * precise as the checks. The open outage of a product stays in `product_health_checks` until it closes.
 */
export const ProductOutageSchema = new Schema({
  /** Identifier of the product. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Unique identifier for the outage. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** First check the product did not answer (ISO 8601). */
  startedAt: {
    type: String,
    required: true,
  },
  /** First check the product answered again (ISO 8601). */
  endedAt: {
    type: String,
    required: true,
  },
  /** Why the last failed check of the outage failed, e.g. `HTTP 503` or `no answer`. */
  lastFailure: {
    type: String,
    required: false,
  },
}, { timestamps: true });

/**
 * Product Outage Key Interface.
 */
export interface ProductOutageKey {
  /** Identifier of the product. */
  productId: string;
  /** Unique identifier for the outage. */
  id: string;
}

/**
 * Product Outage Interface.
 */
export interface ProductOutage extends ProductOutageKey {
  /** First check the product did not answer (ISO 8601). */
  startedAt: string;
  /** First check the product answered again (ISO 8601). */
  endedAt: string;
  /** Why the last failed check of the outage failed, e.g. `HTTP 503` or `no answer`. */
  lastFailure?: string;
}
