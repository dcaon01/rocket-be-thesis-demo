import { Schema } from "dynamoose";

/**
 * This schema has this structure to be as flexible as possible. 
 * With this configuration we can get metrics for a specific month, but we can also 
 * get the total revenue for a tenant by summing the revenue of all months, for all products
 * or by product. This way we can cover all the possible needs for revenue metrics without having to
 * change the schema in the future. 
 */
export const RevenueDashboardMetricsRecordSchema = new Schema({
  /** Identifier of the product, or `RESELLER_FEES` for the fees of the resellers. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Unique identifier for the revenue dashboard metrics record. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** The month index, a string with format aaaa-mm */
  monthIndex: {
    type: String,
    required: true,
    index: {
      type: 'global',
      name: 'monthIndex',
    }
  },
  /** Revenue value in cents: the items of the paid invoices of the month, net of taxes. */
  revenue: {
    type: Number,
    required: true,
  },
  /**
   * Materialized reseller lineage this record belongs to ("RVD-001#RVD-002#").
   * Absent = global Keus record (every paid invoice) or per-salesperson leaf
   * record; present = per-reseller leaf record (paid invoices billed to that reseller). A reseller dashboard
   * sums the leaf records whose path begins_with its own path.
   */
  resellerPath: {
    type: String,
    required: false,
    index: {
      type: 'local',
      name: 'resellerPathIndex',
      project: true,
    },
  },
  /**
   * Salesperson who sold the orders of this record, the one who opened them (`assignedSalesId`). Present only on a
   * per-salesperson leaf record (paid invoices of the direct channel), which the dashboard of a Keus salesperson sums.
   */
  salesId: {
    type: String,
    required: false,
  },
});

/**
 * Revenue Dashboard Metrics Record Key Interface.
 */
export interface RevenueDashboardMetricsRecordKey {
  /** Identifier of the product, or `RESELLER_FEES` for the fees of the resellers. */
  productId: string;
  /** Unique identifier for the revenue dashboard metrics record. */
  id: string;
}

/**
 * Revenue Dashboard Metrics Record Interface.
 */
export interface RevenueDashboardMetricsRecord extends RevenueDashboardMetricsRecordKey {
  /** The month index (format: YYYY-MM). */
  monthIndex: string;
  /** Revenue value in cents: the items of the paid invoices of the month, net of taxes. */
  revenue: number;
  /** Reseller lineage of this record ("RVD-001#RVD-002#"). Absent = global Keus record. */
  resellerPath?: string;
  /** Salesperson who sold the orders of this record. Present only on a per-salesperson leaf record. */
  salesId?: string;
}