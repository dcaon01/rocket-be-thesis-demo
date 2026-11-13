import { Schema } from "dynamoose";

/**
 * Sales Orders Dashboard Metrics Record Schema.
 * One record per product, month, seller and Keus salesperson with the Rocket half of the sales metrics (UR-RK-222):
 * orders, trials, licenses and provisioning times. As the other dashboard records, the current month is counted again
 * at every read and every evening, so a closed month keeps the figures it had at its end.
 *   - The records are leaves that never overlap: the whole of Keus is their sum. `resellerPath` is the seller on the
 *     reseller channel; without it the record is direct, split by `salesId`, the Keus salesperson who opened the order,
 *     so that a salesperson reads only what it sold.
 *   - `productId` is `ALL_PRODUCTS` on the record that counts an order once across its products.
 */
export const SalesOrdersDashboardMetricsRecordSchema = new Schema({
  /** Identifier of the product, or `ALL_PRODUCTS` for the counts across every product. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Unique identifier for the sales orders dashboard metrics record. */
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
  /** Reseller lineage of the seller; absent on the direct channel. */
  resellerPath: {
    type: String,
    required: false,
  },
  /** Keus salesperson who opened the direct orders counted; absent on the reseller channel and on what nobody opened. */
  salesId: {
    type: String,
    required: false,
  },
  /** Orders requested in the month, the transfers between channels excluded. */
  ordersRequested: {
    type: Number,
    required: true,
  },
  /** Trials closed in the month: expired, cancelled or converted. */
  trialsClosed: {
    type: Number,
    required: true,
  },
  /** Trials converted in the month, turned into an order line on their tenant. */
  trialsConverted: {
    type: Number,
    required: true,
  },
  /** Contracts started in the month: the licenses activated, the transfers between channels excluded. */
  contractsStarted: {
    type: Number,
    required: true,
  },
  /** Order lines provisioned in the month whose order has a confirmation date. */
  provisionedTimed: {
    type: Number,
    required: true,
  },
  /** Days from the confirmation of the order to the delivery of the credentials, summed over those lines. */
  provisioningDaysTotal: {
    type: Number,
    required: true,
  },
}, { timestamps: true });

/**
 * Sales Orders Dashboard Metrics Record Key Interface.
 */
export interface SalesOrdersDashboardMetricsRecordKey {
  /** Identifier of the product, or `ALL_PRODUCTS` for the counts across every product. */
  productId: string;
  /** Unique identifier for the sales orders dashboard metrics record. */
  id: string;
}

/**
 * Sales Orders Dashboard Metrics Record Interface.
 */
export interface SalesOrdersDashboardMetricsRecord extends SalesOrdersDashboardMetricsRecordKey {
  /** The month index (format: YYYY-MM). */
  monthIndex: string;
  /** Reseller lineage of the seller; absent on the direct channel. */
  resellerPath?: string;
  /** Keus salesperson who opened the direct orders counted; absent on the reseller channel and on what nobody opened. */
  salesId?: string;
  /** Orders requested in the month, the transfers between channels excluded. */
  ordersRequested: number;
  /** Trials closed in the month: expired, cancelled or converted. */
  trialsClosed: number;
  /** Trials converted in the month, turned into an order line on their tenant. */
  trialsConverted: number;
  /** Contracts started in the month: the licenses activated, the transfers between channels excluded. */
  contractsStarted: number;
  /** Order lines provisioned in the month whose order has a confirmation date. */
  provisionedTimed: number;
  /** Days from the confirmation of the order to the delivery of the credentials, summed over those lines. */
  provisioningDaysTotal: number;
}
