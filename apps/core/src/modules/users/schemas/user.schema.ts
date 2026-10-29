import { Schema } from "dynamoose";
import { SyncState } from "../../../commons/enums/sync-state.enum";
import { AccountType } from "../../../commons/enums/account-type.enum";
import { UserAttributeDto } from "../classes/user-attribute.class";
import { UserStatus } from "../enums/user-status.enum";


/**
 * Dynamoose schema for the User entity.
 * COMMON marked fields are those every user in every product must have, as they are used for identification and querying.
 * ROCKET marked fields are those used strictly for Rocket functionalities.
 */
export const UserSchema = new Schema({
  /** Identifier of the product the user belongs to. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** COMMON: The identifier of the user. Mainly the Cognito sub. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** COMMON: Email of the user. */
  email: {
    type: String,
    required: true,
    index: {
      name: 'emailIndex',
      type: 'local',
    }
  },
  /** COMMON: Roles the user belongs to in Cognito. */
  roles: {
    type: Array,
    schema: [String],
    required: true,
  },
  /** COMMON: Name of the user as in Cognito. */
  name: {
    type: String,
    required: false,
  },
  /** COMMON: Surname of the user as in Cognito. */
  surname: {
    type: String,
    required: false,
  },
  /** COMMON: Status of the user. It is a standard, with ACTIVE and INACTIVE as base values. */
  status: {
    type: String,
    enum: Object.values(UserStatus),
    required: true,
    default: UserStatus.Active,
    index: {
      type: 'local',
      name: 'statusIndex',
    },
  },
  /** COMMON: Previous status of the user before the last update. */
  prevStatus: {
    type: String,
    enum: Object.values(UserStatus),
    required: false,
  },
  /** COMMON: Identifier of the tenant the user belongs to. */
  tenant: {
    type: String,
    required: true,
    index: {
      name: 'tenantIndex',
      type: 'local',
    }
  },
  /**
   * ROCKET: Materialized reseller lineage of the user's tenant
   * ("RVD-001#RVD-002#"), inherited from the tenant at creation so a reseller
   * lists the users of its whole subtree with a single begins_with query.
   * Absent for Keus-owned tenants (sparse index).
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
  /** ROCKET: Name of the tenant the user belongs to. */
  tenantName: {
    type: String,
    required: true,
  },
  /** ROCKET: Name of the product the user belongs to. */
  productName: {
    type: String,
    required: true,
  },
  /**
   * ROCKET: Account type of the end-user (CLIENT or PROFESSIONAL). Set by the
   * product on the USER event; defaults to CLIENT. Distinct from the Cognito
   * back-office AccountType and from resellers.
   */
  accountType: {
    type: String,
    enum: Object.values(AccountType),
    required: true,
    default: AccountType.Company,
  },
  /** COMMON: Custom attributes for the user if used for Cognito. */
  customAttributes: {
    type: Array,
    schema: [Object],
    required: false,
  },
  /**
   * Object containing the user information structured as indicated in the product's userStructure.
   * These are dynamic fields dependent on the product's configuration.
   */
  data: {
    type: Object,
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
  /** ROCKET: Last pending operation sent to the product for the user; `syncState` tells whether it is answered. */
  pendingOperationId: {
    type: String,
    required: false,
  },
  /** ROCKET: Operations waiting behind the open one, oldest first: each is sent when the one before it is answered. */
  queuedOperationIds: {
    type: Array,
    schema: [String],
    required: false,
  },
  /** ROCKET: The queue as one string, written with it: Dynamoose cannot build a condition on a list attribute. */
  queueKey: {
    type: String,
    required: false,
  },
  /** ROCKET: Whether the user matches its copy on the product, written with the pending operation it depends on. */
  syncState: {
    type: String,
    enum: Object.values(SyncState),
    required: false,
  },
  /** ROCKET: When the user replaced a DELETED one with the same id (ISO 8601): its history starts there. */
  historySince: {
    type: String,
    required: false,
  },
  /** ROCKET: Error the product answered the open operation with, while `syncState` is FAILED. */
  failureReason: {
    type: String,
    required: false,
  },
  /** ROCKET: Set when the product confirmed the user after the operator had cancelled it. */
  confirmedAfterCancellation: {
    type: Boolean,
    required: false,
  },
  /** ROCKET: Marks the referent of the tenant, who accepts the contract at first access: one per tenant. */
  referent: {
    type: Boolean,
    required: false,
  },
},
  {
    timestamps: true,
    saveUnknown: ['data.**', 'customAttributes.**']
  }
);

/**
 * Key interface for identifying a User.
 */
export interface UserKey {
  /** Identifier of the product the user belongs to. */
  productId: string;
  /** Identifier of the user. */
  id: string;
}

/**
 * User interface extending UserKey.
 */
export interface User extends UserKey {
  /** Email of the user. */
  email: string;
  /** Roles the user belongs to in Cognito. */
  roles: string[];
  /** Name of the user as in Cognito. */
  name?: string;
  /** Surname of the user as in Cognito. */
  surname?: string;
  /** Status of the user. */
  status: UserStatus;
  /** Previous status of the user before the last update. */
  prevStatus?: UserStatus;
  /** Identifier of the tenant the user belongs to. */
  tenant: string;
  /** Materialized reseller lineage of the user's tenant ("RVD-001#RVD-002#"). Absent for Keus-owned tenants. */
  resellerPath?: string;
  /** Name of the tenant the user belongs to. */
  tenantName: string;
  /** Name of the product the user belongs to. */
  productName: string;
  /** Account type of the end-user (CLIENT or PROFESSIONAL). */
  accountType: AccountType;
  /** Custom attributes for the user if used for Cognito. */
  customAttributes?: UserAttributeDto[];
  /** Object containing the user information structured as indicated in the product's userStructure. */
  data?: Record<string, any>;
  /** Month index for metrics queries (format: "YYYY-MM"). */
  monthIndex: string;
  /** Last pending operation sent to the product for the user; `syncState` tells whether it is answered. */
  pendingOperationId?: string;
  /** Operations waiting behind the open one, oldest first: each is sent when the one before it is answered. */
  queuedOperationIds?: string[];
  /** The queue as one string, written with it: Dynamoose cannot build a condition on a list attribute. */
  queueKey?: string;
  /** Whether the user matches its copy on the product, written with the pending operation it depends on. */
  syncState?: SyncState;
  /** When the user replaced a DELETED one with the same id (ISO 8601): its history starts there. */
  historySince?: string;
  /** Error the product answered the open operation with, while `syncState` is FAILED. */
  failureReason?: string;
  /** Set when the product confirmed the user after the operator had cancelled it. */
  confirmedAfterCancellation?: boolean;
  /** Marks the referent of the tenant, who accepts the contract at first access: one per tenant. */
  referent?: boolean;
}
