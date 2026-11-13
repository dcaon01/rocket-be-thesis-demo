import { Schema } from "dynamoose";
import { MetricsLogic } from "../enums/metrics-logic.enum";

/**
 * This schema has this structure to be as flexible as possible.
 * With this configuration we can get metrics for a specific month, but we can also
 * get the total number of users, trials, contracts and tenants for a tenant by summing the values of all months, for all products
 * or by product. This way we can cover all the possible needs for utilities metrics without having to
 * change the schema in the future.
 * The values of users, trials, contracts and tenants have to
 * be considered as activated or active depending on the logic field, so we can have both metrics in the same table and we can easily filter by logic when we need to get one or the other.
 */
export const UtilitiesDashboardMetricsRecordSchema = new Schema({
  /** Identifier of the product */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Unique identifier for the utilities dashboard metrics record. */
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
  /** Number of users. */
  users: {
    type: Number,
    required: true,
  },
  /** Number of trials. */
  trials: {
    type: Number,
    required: true,
  },
  /** Number of contracts. */
  contracts: {
    type: Number,
    required: true,
  },
  /** NUmber of tenants. */
  tenants: {
    type: Number,
    required: true,
  },
  /** Logic type for the metric (activated or active). */
  logic: {
    type: String,
    enum: Object.values(MetricsLogic),
    required: true,
  },
  /**
   * Materialized reseller lineage this record belongs to ("RVD-001#RVD-002#").
   * Absent = global Keus record (counts of all entities, unchanged behaviour);
   * present = per-reseller leaf record (entities of that immediate reseller).
   * A reseller dashboard sums the leaf records whose path begins_with its own.
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
});

/**
 * Utilities Dashboard Metrics Record Key Interface.
 */
export interface UtilitiesDashboardMetricsRecordKey {
  /** Identifier of the product. */
  productId: string;
  /** Unique identifier for the utilities dashboard metrics record. */
  id: string;
}

/**
 * Utilities Dashboard Metrics Record Interface.
 */
export interface UtilitiesDashboardMetricsRecord extends UtilitiesDashboardMetricsRecordKey {
  /** The month index (format: YYYY-MM). */
  monthIndex: string;
  /** Number of users. */
  users: number;
  /** Number of trials. */
  trials: number;
  /** Number of contracts. */
  contracts: number;
  /** Number of tenants. */
  tenants: number;
  /** Logic type for the metric (activated or active). */
  logic: MetricsLogic;
  /** Reseller lineage of this record ("RVD-001#RVD-002#"). Absent = global Keus record. */
  resellerPath?: string;
}