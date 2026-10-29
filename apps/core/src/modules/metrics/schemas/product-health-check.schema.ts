import { Schema } from "dynamoose";

/**
 * Product Health Check Schema.
 * The state of the check of a product (UR-RK-225), one item per product, written every 15 minutes by the schedule
 * `health-check`: since when the product is checked, the last check, and the start of the outage still open, if any.
 * When the product answers again the outage moves to `product_outages` and `downSince` is removed.
 */
export const ProductHealthCheckSchema = new Schema({
  /** Identifier of the product. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** When the product was checked for the first time (ISO 8601): the time before it is not observed. */
  since: {
    type: String,
    required: true,
  },
  /** When the product was checked for the last time (ISO 8601). */
  lastCheckAt: {
    type: String,
    required: true,
  },
  /** Start of the outage still open (ISO 8601): the first check the product did not answer. */
  downSince: {
    type: String,
    required: false,
  },
  /** Why the last failed check failed, e.g. `HTTP 503` or `no answer`. */
  lastFailure: {
    type: String,
    required: false,
  },
}, { timestamps: true });

/**
 * Product Health Check Key Interface.
 */
export interface ProductHealthCheckKey {
  /** Identifier of the product. */
  productId: string;
}

/**
 * Product Health Check Interface.
 */
export interface ProductHealthCheck extends ProductHealthCheckKey {
  /** When the product was checked for the first time (ISO 8601): the time before it is not observed. */
  since: string;
  /** When the product was checked for the last time (ISO 8601). */
  lastCheckAt: string;
  /** Start of the outage still open (ISO 8601): the first check the product did not answer. */
  downSince?: string;
  /** Why the last failed check failed, e.g. `HTTP 503` or `no answer`. */
  lastFailure?: string;
}
