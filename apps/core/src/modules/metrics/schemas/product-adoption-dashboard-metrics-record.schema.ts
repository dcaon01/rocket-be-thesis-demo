import { Schema } from "dynamoose";
import { MixpanelLever } from "../../products/enums/mixpanel-lever.enum";

/**
 * Product Adoption Dashboard Metrics Record Schema.
 * One record per product, month, seller and lever with how many tenants came out of the rules of the lever in each
 * way (UR-RK-223), read from Mixpanel. As the other dashboard records, the current month is counted again at every
 * read and every evening, so a closed month keeps the figures it had at its end:
 *   - activation counts the tenants whose activation days ended in the month, so a year is the sum of its months;
 *   - the other levers count every tenant at the end of the month, so a year is its last month.
 */
export const ProductAdoptionDashboardMetricsRecordSchema = new Schema({
  /** Identifier of the product. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Unique identifier for the product adoption dashboard metrics record. */
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
  /** Reseller lineage of the seller of the tenants; absent on the direct channel. */
  resellerPath: {
    type: String,
    required: false,
  },
  /** Lever the counts refer to. */
  lever: {
    type: String,
    enum: Object.values(MixpanelLever),
    required: true,
  },
  /** Tenants on the good side of the green threshold. */
  compliant: {
    type: Number,
    required: true,
  },
  /** Tenants past the green threshold, within the yellow one. */
  atRisk: {
    type: Number,
    required: true,
  },
  /** Tenants past the yellow threshold. */
  failing: {
    type: Number,
    required: true,
  },
  /** Tenants the rule could not judge, counted apart from the share of compliant ones. */
  notAssessable: {
    type: Number,
    required: true,
  },
  /** Tenants measured by a rule still in observation. */
  observed: {
    type: Number,
    required: true,
  },
}, { timestamps: true });

/**
 * Product Adoption Dashboard Metrics Record Key Interface.
 */
export interface ProductAdoptionDashboardMetricsRecordKey {
  /** Identifier of the product. */
  productId: string;
  /** Unique identifier for the product adoption dashboard metrics record. */
  id: string;
}

/**
 * Product Adoption Dashboard Metrics Record Interface.
 */
export interface ProductAdoptionDashboardMetricsRecord extends ProductAdoptionDashboardMetricsRecordKey {
  /** The month index (format: YYYY-MM). */
  monthIndex: string;
  /** Reseller lineage of the seller of the tenants; absent on the direct channel. */
  resellerPath?: string;
  /** Lever the counts refer to. */
  lever: MixpanelLever;
  /** Tenants on the good side of the green threshold. */
  compliant: number;
  /** Tenants past the green threshold, within the yellow one. */
  atRisk: number;
  /** Tenants past the yellow threshold. */
  failing: number;
  /** Tenants the rule could not judge, counted apart from the share of compliant ones. */
  notAssessable: number;
  /** Tenants measured by a rule still in observation. */
  observed: number;
}
