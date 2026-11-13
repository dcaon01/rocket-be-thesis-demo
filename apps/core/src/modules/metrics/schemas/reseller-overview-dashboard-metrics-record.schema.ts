import { Schema } from "dynamoose";

/**
 * Reseller Overview Dashboard Metrics Record Schema.
 * One record per product, month, reseller and salesperson with the contracts and the companies of the dashboard of a
 * reseller (UR-RK-339), as the other dashboard records: the current month is counted again at every read and every
 * evening, so a closed month keeps the figures it had at its end.
 *   - The record without `resellerPath` counts the direct channel, for the active companies of the global and product
 *     dashboards (UR-RK-001, UR-RK-235); the dashboard of a reseller never reads it.
 *   - A record without `salesId` counts the whole reseller; one with it, the contracts of the orders that salesperson
 *     opened, so that a reseller salesperson reads only its own and a company is never counted twice for the owner.
 *   - `productId` is `ALL_PRODUCTS` on the record that counts a company once across its products.
 */
export const ResellerOverviewDashboardMetricsRecordSchema = new Schema({
  /** Identifier of the product, or `ALL_PRODUCTS` for the counts across every product. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Unique identifier for the reseller overview dashboard metrics record. */
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
  /** Reseller lineage of the seller of the contracts; absent on the direct channel. */
  resellerPath: {
    type: String,
    required: false,
  },
  /** Salesperson who opened the orders of the contracts; absent on the record of the whole reseller. */
  salesId: {
    type: String,
    required: false,
  },
  /** Contracts in force at the end of the month, or now for the current one. */
  contractsInForce: {
    type: Number,
    required: true,
  },
  /** Contracts started in the month. */
  contractsStarted: {
    type: Number,
    required: true,
  },
  /** Companies with a contract in force at the end of the month, or now for the current one. */
  companiesInForce: {
    type: Number,
    required: true,
  },
  /** Companies whose first contract with the reseller started in the month. */
  companiesNew: {
    type: Number,
    required: true,
  },
}, { timestamps: true });

/**
 * Reseller Overview Dashboard Metrics Record Key Interface.
 */
export interface ResellerOverviewDashboardMetricsRecordKey {
  /** Identifier of the product, or `ALL_PRODUCTS` for the counts across every product. */
  productId: string;
  /** Unique identifier for the reseller overview dashboard metrics record. */
  id: string;
}

/**
 * Reseller Overview Dashboard Metrics Record Interface.
 */
export interface ResellerOverviewDashboardMetricsRecord extends ResellerOverviewDashboardMetricsRecordKey {
  /** The month index (format: YYYY-MM). */
  monthIndex: string;
  /** Reseller lineage of the seller of the contracts; absent on the direct channel. */
  resellerPath?: string;
  /** Salesperson who opened the orders of the contracts; absent on the record of the whole reseller. */
  salesId?: string;
  /** Contracts in force at the end of the month, or now for the current one. */
  contractsInForce: number;
  /** Contracts started in the month. */
  contractsStarted: number;
  /** Companies with a contract in force at the end of the month, or now for the current one. */
  companiesInForce: number;
  /** Companies whose first contract with the reseller started in the month. */
  companiesNew: number;
}
