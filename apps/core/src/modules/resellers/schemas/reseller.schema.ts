import { Schema } from "dynamoose";
import { ResellerStatus } from "../enums/reseller-status.enum";
import { ResellerTier } from "../enums/reseller-tier.enum";

/**
 * Reseller Schema.
 * A reseller is a partner that sells the company's products to its own
 * clients and professionals through downstream contracts.
 * Resellers can be organized in a hierarchy: a reseller created by another
 * reseller carries the parent's code in the createdBy field.
 */
export const ResellerSchema = new Schema({
  /** Identifier of the reseller. */
  id: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Unique human-readable code of the reseller (uniqueness enforced app-side). */
  code: {
    type: String,
    required: true,
    index: {
      name: "codeIndex",
      type: "global",
    },
  },
  /** Company name of the reseller. */
  companyName: {
    type: String,
    required: true,
  },
  /** Email of the reseller. */
  email: {
    type: String,
    required: true,
  },
  /** VAT number of the reseller. */
  vatNumber: {
    type: String,
    required: false,
  },
  /** Certified electronic address of the reseller. */
  pec: {
    type: String,
    required: false,
  },
  /** Interchange code of the reseller. */
  sdi: {
    type: String,
    required: false,
  },
  /** Address of the reseller. */
  address: {
    type: String,
    required: false,
  },
  /** Phone number of the reseller. */
  phoneNumber: {
    type: String,
    required: false,
  },
  /** Status of the reseller. */
  status: {
    type: String,
    enum: Object.values(ResellerStatus),
    required: true,
    default: ResellerStatus.Active,
  },
  /**
   * Partner tier of the contract in force, copied here for the materials, which
   * filter by tier. Written only when the contract in force changes.
   */
  tier: {
    type: String,
    enum: Object.values(ResellerTier),
    required: false,
  },
  /**
   * Identifier of the contract in force, in the reseller contracts: the fee and the
   * margins of the reseller. It is in force while its status is ACTIVE, SUSPENDED or
   * ENDED_AT_RENEWAL.
   */
  contractId: {
    type: String,
    required: false,
  },
  /** Cognito sub of the Keus salesperson responsible for the reseller; indexed to list the resellers of a salesperson. */
  assignedSalesId: {
    type: String,
    required: false,
    index: {
      name: "salesIndex",
      type: "global",
    },
  },
  /** Display name of the Keus salesperson, denormalized for the listings. */
  assignedSalesName: {
    type: String,
    required: false,
  },
  /** S3 key of the reseller logo, rendered on the offers it presents. */
  logoS3Key: {
    type: String,
    required: false,
  },
  /**
   * Whether the reseller has invoices past their due date. Recomputed from the
   * payment schedule: it is a mark telling who to call, and never changes the
   * reseller status by itself.
   */
  overdue: {
    type: Boolean,
    required: true,
    default: false,
  },
  /** ISO timestamp since when the reseller has been overdue. */
  overdueSince: {
    type: String,
    required: false,
  },
  /**
   * Invoices of the reseller that are unpaid, counted in the same transaction that moves each of them: `overdue`
   * goes down only when the count is back to zero, so two charges settled together cannot leave it wrong.
   */
  unpaidInvoices: {
    type: Number,
    required: false,
  },
  /**
   * ISO timestamp since when the users of the reseller are blocked in Rocket for an invoice still unpaid on the
   * fifteenth day of its dunning. Cleared when no invoice is left unpaid, or by hand by the administration.
   */
  accessSuspendedAt: {
    type: String,
    required: false,
  },
  /** Structured legal address, also used to place the reseller on the network map. */
  legalAddress: {
    type: Object,
    required: false,
    schema: {
      /** Street and number. */
      street: { type: String, required: true },
      /** City. */
      city: { type: String, required: true },
      /** Postal code. */
      zipCode: { type: String, required: true },
      /** Province code. */
      province: { type: String, required: false },
      /** ISO country code. */
      country: { type: String, required: false },
    },
  },
  /** IBAN used for the SEPA direct debit. */
  iban: {
    type: String,
    required: false,
  },
  /** Fiscal code, when different from the VAT number. */
  fiscalCode: {
    type: String,
    required: false,
  },
  /**
   * Code of the parent reseller that created this one.
   * Absent when the reseller was created by Keus.
   * Immutable after creation, so cycles in the hierarchy are impossible.
   */
  createdBy: {
    type: String,
    required: false,
    index: {
      name: "createdByIndex",
      type: "global",
    },
  },
  /**
   * Materialized lineage from the root reseller down to this one, every
   * segment terminated by '#' (e.g. "RVD-001#RVD-002#"). Built once at
   * creation from the parent's path; immutable because createdBy is. Lets
   * the whole subtree of a reseller be fetched with a single begins_with
   * query on the entities that denormalize it. Optional only to tolerate
   * un-backfilled legacy records: every reseller created from now on has it.
   * Sort key of pathIndex, which reads the descendants of a reseller.
   */
  path: {
    type: String,
    required: false,
  },
  /**
   * Code of the root reseller, the first segment of `path`: its own code for a
   * root one. Partition key of the pathIndex GSI.
   */
  rootResellerCode: {
    type: String,
    required: false,
    index: {
      name: "pathIndex",
      type: "global",
      rangeKey: "path",
    },
  },
},
{
  timestamps: true,
});

/**
 * Reseller Key Interface.
 */
export interface ResellerKey {
  /** Identifier of the reseller. */
  id: string;
}

/**
 * Reseller Interface.
 */
export interface Reseller extends ResellerKey {
  /** Unique human-readable code of the reseller. */
  code: string;
  /** Company name of the reseller. */
  companyName: string;
  /** Email of the reseller. */
  email: string;
  /** VAT number of the reseller. */
  vatNumber?: string;
  /** Certified electronic address of the reseller. */
  pec?: string;
  /** Interchange code of the reseller. */
  sdi?: string;
  /** Address of the reseller. */
  address?: string;
  /** Phone number of the reseller. */
  phoneNumber?: string;
  /** Status of the reseller. */
  status: ResellerStatus;
  /** Partner tier of the contract in force, copied here for the materials. */
  tier?: ResellerTier;
  /** Identifier of the contract in force. */
  contractId?: string;
  /** Cognito sub of the Keus salesperson responsible for the reseller. */
  assignedSalesId?: string;
  /** Display name of the Keus salesperson, denormalized for the listings. */
  assignedSalesName?: string;
  /** S3 key of the reseller logo. */
  logoS3Key?: string;
  /** Whether the reseller has invoices past their due date. */
  overdue?: boolean;
  /** ISO timestamp since when the reseller has been overdue. */
  overdueSince?: string;
  /** Invoices of the reseller that are unpaid, counted in the same transaction that moves each of them. */
  unpaidInvoices?: number;
  /** ISO timestamp since when the users of the reseller are blocked in Rocket for an unpaid invoice. */
  accessSuspendedAt?: string;
  /** Structured legal address. */
  legalAddress?: {
    /** Street and number. */
    street: string;
    /** City. */
    city: string;
    /** Postal code. */
    zipCode: string;
    /** Province code. */
    province?: string;
    /** ISO country code. */
    country?: string;
  };
  /** IBAN used for the SEPA direct debit. */
  iban?: string;
  /** Fiscal code, when different from the VAT number. */
  fiscalCode?: string;
  /** Code of the parent reseller that created this one. Absent when created by Keus. */
  createdBy?: string;
  /** Materialized lineage from the root down to this reseller ("RVD-001#RVD-002#"). */
  path?: string;
  /** Code of the root reseller, the first segment of `path`. */
  rootResellerCode?: string;
}
