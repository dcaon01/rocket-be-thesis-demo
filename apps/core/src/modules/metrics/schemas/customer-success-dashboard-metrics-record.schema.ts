import { Schema } from "dynamoose";

/**
 * Customer Success Dashboard Metrics Record Schema.
 * One record per product, month and seller with the counts of the customer success metrics (UR-RK-221), as the
 * revenue and utilities records: the current month is counted again at every read and every evening, so a closed
 * month keeps the figures it had at its end. A year is read from its months: the contracts in force on its first
 * month, the sum of the others.
 */
export const CustomerSuccessDashboardMetricsRecordSchema = new Schema({
  /** Identifier of the product. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Unique identifier for the customer success dashboard metrics record. */
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
  /** Reseller lineage of the seller of the contracts and lines; absent on the direct channel. */
  resellerPath: {
    type: String,
    required: false,
  },
  /** Contracts in force on the first day of the month: the denominator of the churn rate. */
  inForceAtStart: {
    type: Number,
    required: true,
  },
  /** Contracts terminated in the month that left their tenant with no contract: the numerator of the churn rate. */
  terminated: {
    type: Number,
    required: true,
  },
  /** Order lines whose credentials were delivered in the month. */
  provisioned: {
    type: Number,
    required: true,
  },
  /** Order lines whose first access happened in the month. */
  activated: {
    type: Number,
    required: true,
  },
  /** Days from the credentials to the first access, summed over the lines activated in the month. */
  activationDaysTotal: {
    type: Number,
    required: true,
  },
}, { timestamps: true });

/**
 * Customer Success Dashboard Metrics Record Key Interface.
 */
export interface CustomerSuccessDashboardMetricsRecordKey {
  /** Identifier of the product. */
  productId: string;
  /** Unique identifier for the customer success dashboard metrics record. */
  id: string;
}

/**
 * Customer Success Dashboard Metrics Record Interface.
 */
export interface CustomerSuccessDashboardMetricsRecord extends CustomerSuccessDashboardMetricsRecordKey {
  /** The month index (format: YYYY-MM). */
  monthIndex: string;
  /** Reseller lineage of the seller of the contracts and lines; absent on the direct channel. */
  resellerPath?: string;
  /** Contracts in force on the first day of the month: the denominator of the churn rate. */
  inForceAtStart: number;
  /** Contracts terminated in the month that left their tenant with no contract: the numerator of the churn rate. */
  terminated: number;
  /** Order lines whose credentials were delivered in the month. */
  provisioned: number;
  /** Order lines whose first access happened in the month. */
  activated: number;
  /** Days from the credentials to the first access, summed over the lines activated in the month. */
  activationDaysTotal: number;
}
