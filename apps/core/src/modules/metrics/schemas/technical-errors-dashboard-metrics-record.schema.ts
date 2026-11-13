import { Schema } from "dynamoose";

/**
 * Technical Errors Dashboard Metrics Record Schema.
 * One record per product and month with the errors and the alerts of the Sentry project of the product (UR-RK-225),
 * in the environment of this Rocket, as the other dashboard records: the current month is counted again at every read
 * and every evening, so a closed month keeps the figures it had at its end, also after Sentry dropped its events, and
 * a year is the sum of its months.
 */
export const TechnicalErrorsDashboardMetricsRecordSchema = new Schema({
  /** Identifier of the product. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Unique identifier for the technical errors dashboard metrics record. */
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
  /** Error events of the month. */
  errors: {
    type: Number,
    required: true,
  },
  /** Issues first seen in the month: every threshold crossed in Sentry opens one. */
  alertsFired: {
    type: Number,
    required: true,
  },
}, { timestamps: true });

/**
 * Technical Errors Dashboard Metrics Record Key Interface.
 */
export interface TechnicalErrorsDashboardMetricsRecordKey {
  /** Identifier of the product. */
  productId: string;
  /** Unique identifier for the technical errors dashboard metrics record. */
  id: string;
}

/**
 * Technical Errors Dashboard Metrics Record Interface.
 */
export interface TechnicalErrorsDashboardMetricsRecord extends TechnicalErrorsDashboardMetricsRecordKey {
  /** The month index (format: YYYY-MM). */
  monthIndex: string;
  /** Error events of the month. */
  errors: number;
  /** Issues first seen in the month: every threshold crossed in Sentry opens one. */
  alertsFired: number;
}
