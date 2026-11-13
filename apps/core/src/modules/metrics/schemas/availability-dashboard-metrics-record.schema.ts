import { Schema } from "dynamoose";

/**
 * Availability Dashboard Metrics Record Schema.
 * One record per product and month with the time the product was observed and the time it was down (UR-RK-225), as
 * the other dashboard records: the current month is counted again at every read and every evening from the checks
 * and the outages, so a closed month keeps the figures it had at its end and a year is the sum of its months. The
 * availability is `1 - downtimeSeconds / observedSeconds`, computed by the frontend so a year does not average months.
 * Calls and latency come from the metrics API Gateway writes on CloudWatch, for the products whose health address is
 * an `execute-api` one; they are absent for the others, and kept as they were when CloudWatch cannot be read.
 */
export const AvailabilityDashboardMetricsRecordSchema = new Schema({
  /** Identifier of the product. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Unique identifier for the availability dashboard metrics record. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** The month index (format: YYYY-MM). */
  monthIndex: {
    type: String,
    required: true,
    index: {
      type: 'global',
      name: 'monthIndex',
    },
  },
  /** Seconds of the month the product was checked, from its first check or the start of the month. */
  observedSeconds: {
    type: Number,
    required: true,
  },
  /** Seconds of the month the product was down. */
  downtimeSeconds: {
    type: Number,
    required: true,
  },
  /** Outages that touched the month, the open one included. */
  outages: {
    type: Number,
    required: true,
  },
  /** Calls the API of the product received in the month. */
  requests: {
    type: Number,
    required: false,
  },
  /** Median latency of the calls of the month, in milliseconds. */
  latencyP50Ms: {
    type: Number,
    required: false,
  },
  /** 95th percentile of the latency of the calls of the month, in milliseconds. */
  latencyP95Ms: {
    type: Number,
    required: false,
  },
}, { timestamps: true });

/**
 * Availability Dashboard Metrics Record Key Interface.
 */
export interface AvailabilityDashboardMetricsRecordKey {
  /** Identifier of the product. */
  productId: string;
  /** Unique identifier for the availability dashboard metrics record. */
  id: string;
}

/**
 * Availability Dashboard Metrics Record Interface.
 */
export interface AvailabilityDashboardMetricsRecord extends AvailabilityDashboardMetricsRecordKey {
  /** The month index (format: YYYY-MM). */
  monthIndex: string;
  /** Seconds of the month the product was checked, from its first check or the start of the month. */
  observedSeconds: number;
  /** Seconds of the month the product was down. */
  downtimeSeconds: number;
  /** Outages that touched the month, the open one included. */
  outages: number;
  /** Calls the API of the product received in the month. */
  requests?: number;
  /** Median latency of the calls of the month, in milliseconds. */
  latencyP50Ms?: number;
  /** 95th percentile of the latency of the calls of the month, in milliseconds. */
  latencyP95Ms?: number;
}
