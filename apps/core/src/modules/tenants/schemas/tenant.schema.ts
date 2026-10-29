import { Schema } from "dynamoose";
import { SyncState } from "../../../commons/enums/sync-state.enum";
import { AccountType } from "../../../commons/enums/account-type.enum";
import { TenantStatus } from "../enums/tenant-status.enum";

/**
 * Dynamoose schema for the Tenant entity.
 * COMMON marked fields are those every tenant in every product must have, as they are used for identification and querying.
 * ROCKET marked fields are those used strictly for Rocket functionalities.
 */
export const TenantSchema = new Schema({
  /** Identifier of the product. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** COMMON:Identifier of the tenant (can be a uuid or the lower case code of the company name). */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** COMMON: Name of the tenant, in human format. Can be a company name or the name of the customer. */
  name: {
    type: String,
    required: true,
  },
  /** ROCKET: Description of the tenant. */
  description: {
    type: String,
    required: false,
  },
  /** ROCKET: Contract governing the tenant, set when its order line is provisioned. */
  contractId: {
    type: String,
    required: false,
  },
  /** ROCKET: Code of the contract governing the tenant. */
  contractCode: {
    type: String,
    required: false,
  },
  /** ROCKET: Identifier of the trial associated with the tenant. */
  trialId: {
    type: String,
    required: false,
  },
  /** ROCKET: Email associated with the trial. */
  trialEmail: {
    type: String,
    required: false,
  },
  /** COMMON: The tenant status. */
  status: {
    type: String,
    enum: Object.values(TenantStatus),
    required: true,
    default: TenantStatus.Active,
    index: {
      type: 'local',
      name: 'statusIndex',
    },
  },
  /** 
   * Object containing the tenant information structured as indicated in the product's tenantStructure. 
   * These are dynamic fields dependent on the product's configuration. 
   */
  data: {
    type: Object,
    required: true,
  },
  /** ROCKET: Maximum constraint value for this tenant (seats or revenue depending on product type). */
  maxConstraintValue: {
    type: Number,
    required: true,
    default: 5,
  },
  /** ROCKET: Current number of active users for this tenant. */
  activeUsers: {
    type: Number,
    required: true,
    default: 0,
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
   * ROCKET: Account type of the tenant (CLIENT or PROFESSIONAL). Set by the
   * product on the TENANT event; defaults to CLIENT. Says WHAT the tenant IS
   * (a professional's workspace vs a client tenant) — DISTINCT from issuerId
   * (the lineage pointer: who activated it) and from resellerPath.
   */
  accountType: {
    type: String,
    enum: Object.values(AccountType),
    required: true,
    default: AccountType.Company,
  },
  /**
   * ROCKET: Identifier of the professional that activated this tenant.
   * Absent on tenants provisioned directly (contract/trial flows).
   * Local index (hash productId + range issuerId) used to count the tenants
   * of a professional for license metering and reseller invoicing.
   */
  issuerId: {
    type: String,
    required: false,
    index: {
      type: 'local',
      name: 'issuerIndex',
      project: true,
    },
  },
  /**
   * ROCKET: Materialized reseller lineage of the tenant's issuer
   * ("RVD-001#RVD-002#"), inherited from the controlling reseller's path so the
   * whole subtree of a reseller is listable with a single begins_with query.
   * Absent on Keus-direct tenants (sparse index).
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
  /** ROCKET: Order whose line the tenant provisions; with the product it addresses the line. */
  orderId: {
    type: String,
    required: false,
  },
  /** ROCKET: Users asked with the tenant at provisioning and not settled yet; the line is provisioned when it reaches zero. */
  pendingUsers: {
    type: Number,
    required: false,
  },
  /** ROCKET: Last pending operation sent to the product for the tenant; `syncState` tells whether it is answered. */
  pendingOperationId: {
    type: String,
    required: false,
  },
  /** ROCKET: Whether the tenant matches its copy on the product, written with the pending operation it depends on. */
  syncState: {
    type: String,
    enum: Object.values(SyncState),
    required: false,
  },
  /** ROCKET: When the tenant replaced a DELETED one with the same id (ISO 8601): its history starts there. */
  historySince: {
    type: String,
    required: false,
  },
  /** ROCKET: Error the product answered the open operation with, while `syncState` is FAILED. */
  failureReason: {
    type: String,
    required: false,
  },
  /** ROCKET: Set when the product confirmed the tenant after the operator had cancelled it. */
  confirmedAfterCancellation: {
    type: Boolean,
    required: false,
  },
},
  {
    timestamps: true,
    saveUnknown: ['data.**']
  }
);

/**
 * Key interface for the Tenant entity.
 */
export interface TenantKey {
  /** Identifier of the product. */
  productId: string;
  /** Identifier of the tenant. */
  id: string;
}

/**
 * Tenant entity interface.
 */
export interface Tenant extends TenantKey {
  /** Name of the tenant. */
  name: string;
  /** Description of the tenant. */
  description?: string;
  /** Contract governing the tenant, set when its order line is provisioned. */
  contractId?: string;
  /** Code of the contract governing the tenant. */
  contractCode?: string;
  /** Identifier of the trial associated with the tenant. */
  trialId?: string;
  /** Email associated with the trial. */
  trialEmail?: string;
  /** The tenant status. */
  status: TenantStatus;
  /** Object containing the tenant information structured as indicated in the product's tenantStructure. */
  data: Record<string, any>;
  /** Maximum constraint value for this tenant (seats or revenue depending on product type). */
  maxConstraintValue: number;
  /** Current number of active users for this tenant. */
  activeUsers: number;
  /** Month index for metrics queries (format: "YYYY-MM"). */
  monthIndex: string;
  /** Account type of the tenant (CLIENT or PROFESSIONAL). Distinct from issuerId/resellerPath. */
  accountType: AccountType;
  /** Identifier of the professional that activated this tenant. Absent on directly-provisioned tenants. */
  issuerId?: string;
  /** Materialized reseller lineage of the tenant's issuer ("RVD-001#RVD-002#"). Absent on Keus-direct tenants. */
  resellerPath?: string;
  /** Order whose line the tenant provisions; with the product it addresses the line. */
  orderId?: string;
  /** Users asked with the tenant at provisioning and not settled yet; the line is provisioned when it reaches zero. */
  pendingUsers?: number;
  /** Last pending operation sent to the product for the tenant; `syncState` tells whether it is answered. */
  pendingOperationId?: string;
  /** Whether the tenant matches its copy on the product, written with the pending operation it depends on. */
  syncState?: SyncState;
  /** When the tenant replaced a DELETED one with the same id (ISO 8601): its history starts there. */
  historySince?: string;
  /** Error the product answered the open operation with, while `syncState` is FAILED. */
  failureReason?: string;
  /** Set when the product confirmed the tenant after the operator had cancelled it. */
  confirmedAfterCancellation?: boolean;
}
