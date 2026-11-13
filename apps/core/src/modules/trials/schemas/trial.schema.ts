import { Schema } from "dynamoose";
import { TrialStatus } from "../enums/trial-status.enum";
import { UsersLimitType } from "../enums/users-limit-type.enum";

/**
 * Dynamoose schema for the Trial entity.
 */
export const TrialSchema = new Schema({
  /** Identifier of the product associated with the trial. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Identifier of the trial. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** Date when the trial was activated. Null if in DRAFT status. */
  activatedAt: {
    type: Date,
    required: false,
  },
  /** Expires date of the trial period. Null if in DRAFT status. */
  expiresAt: {
    type: Date,
    required: false,
  },
  /** Description of the trial. */
  description: {
    type: String,
    required: false,
  },
  /** Email associated with the trial. Can't open more trials with the same email for the same product. */
  associatedEmail: {
    type: String,
    required: true,
    index: {
      name: "associatedEmailIndex",
      type: "local",
    },
  },
  status: {
    type: String,
    enum: Object.values(TrialStatus),
    required: true,
    default: TrialStatus.Active,
    index: {
      type: 'local',
      name: 'statusIndex',
    },
  },
  /** When the trial's tenant was provisioned by an order line, which turned the trial into CONVERTED. */
  convertedAt: {
    type: Date,
    required: false,
  },
  /**
   * Month ("YYYY-MM") in which the trial last closed: expired, cancelled or converted. Partition of the index the
   * sales metrics read the closed trials of a month from; a reactivation removes it (sparse).
   */
  closedMonth: {
    type: String,
    required: false,
    index: {
      name: "closedMonthIndex",
      type: "global",
      project: true,
    },
  },
  /** Indicates whether the trial has been redeemed, so a tenant linked to the trial has been created. */
  redeemed: {
    type: Boolean,
    required: true,
    default: false,
  },
  /** Whether the trial never expires (can only be cancelled manually). */
  perpetual: {
    type: Boolean,
    required: false,
    default: false,
  },
  /** Type of users limit for the trial. */
  usersLimitType: {
    type: String,
    enum: Object.values(UsersLimitType),
    required: true,
    default: UsersLimitType.Product,
  },
  /** Maximum number of users allowed for the trial. */
  usersLimit: {
    type: Number,
    required: false,
  },
  /** Month index for metrics queries (format: "YYYY-MM"). */
  monthIndex: {
    type: String,
    required: true,
    index: {
      type: 'local',
      name: 'monthIndex',
    },
  },
  /**
   * Materialized reseller lineage of the reseller-collaborator that created the
   * trial ("RVD-001#RVD-002#"). Lets a reseller list the trials of its whole
   * subtree with a single begins_with query. Absent on Keus trials (sparse).
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
  /** Identifier of the CRM deal that opened the trial, when it came from one. */
  dealId: {
    type: String,
    required: false,
  },
}, {
  timestamps: true,
});

/**
 * Trial key interface for Dynamoose operations.
 */
export interface TrialKey {
  /** The product identifier. */
  productId: string;
  /** The trial identifier. */
  id: string;
}

/**
 * Trial interface for Dynamoose model.
 */
export interface Trial extends TrialKey {
  /** Date when the trial was activated. Null if in DRAFT status. */
  activatedAt?: Date;
  /** Expires date of the trial period. Null if in DRAFT status. */
  expiresAt?: Date;
  /** Description of the trial. */
  description?: string;
  /** Email associated with the trial. Can't open more trials with the same email. */
  associatedEmail: string;
  /** Status of the trial. */
  status: TrialStatus;
  /** When the trial's tenant was provisioned by an order line, which turned the trial into CONVERTED. */
  convertedAt?: Date;
  /** Month ("YYYY-MM") in which the trial last closed: expired, cancelled or converted. Absent while open. */
  closedMonth?: string;
  /** Indicates whether the trial has been redeemed, so a tenant linked to the trial has been created. */
  redeemed: boolean;
  /** Whether the trial never expires (can only be cancelled manually). */
  perpetual?: boolean;
  /** Type of users limit for the trial. */
  usersLimitType: UsersLimitType;
  /** Maximum number of users allowed for the trial. */
  usersLimit?: number;
  /** Month index for metrics queries (format: "YYYY-MM"). */
  monthIndex: string;
  /** Materialized reseller lineage of the trial's creator ("RVD-001#RVD-002#"). Absent on Keus trials. */
  resellerPath?: string;
  /** Identifier of the CRM deal that opened the trial. */
  dealId?: string;
}
