import { Schema } from "dynamoose";

/**
 * Support Dashboard Metrics Record Schema.
 * One record per product and month with the counts of the Intercom conversations of the product (UR-RK-221), as the
 * other dashboard records: the current month is counted again at every read and every evening, so a closed month
 * keeps the figures it had at its end and a year is the sum of its months. Times are kept as sums and counts, so the
 * averages of a year come from the sums.
 */
export const SupportDashboardMetricsRecordSchema = new Schema({
  /** Identifier of the product. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Unique identifier for the support dashboard metrics record. */
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
  /** Conversations opened in the month. */
  opened: {
    type: Number,
    required: true,
  },
  /** Conversations closed for the first time in the month. */
  closed: {
    type: Number,
    required: true,
  },
  /** Seconds to the first reply, summed over the conversations opened in the month that got one. */
  firstResponseSecondsTotal: {
    type: Number,
    required: true,
  },
  /** Conversations opened in the month that got a first reply. */
  firstResponseCount: {
    type: Number,
    required: true,
  },
  /** Seconds from the opening to the first close, summed over the conversations closed in the month. */
  resolutionSecondsTotal: {
    type: Number,
    required: true,
  },
}, { timestamps: true });

/**
 * Support Dashboard Metrics Record Key Interface.
 */
export interface SupportDashboardMetricsRecordKey {
  /** Identifier of the product. */
  productId: string;
  /** Unique identifier for the support dashboard metrics record. */
  id: string;
}

/**
 * Support Dashboard Metrics Record Interface.
 */
export interface SupportDashboardMetricsRecord extends SupportDashboardMetricsRecordKey {
  /** The month index (format: YYYY-MM). */
  monthIndex: string;
  /** Conversations opened in the month. */
  opened: number;
  /** Conversations closed for the first time in the month. */
  closed: number;
  /** Seconds to the first reply, summed over the conversations opened in the month that got one. */
  firstResponseSecondsTotal: number;
  /** Conversations opened in the month that got a first reply. */
  firstResponseCount: number;
  /** Seconds from the opening to the first close, summed over the conversations closed in the month. */
  resolutionSecondsTotal: number;
}
