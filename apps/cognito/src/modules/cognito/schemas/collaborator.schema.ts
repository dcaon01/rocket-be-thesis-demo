import { Schema } from "dynamoose";
import { AccountType } from "../enums/account-type.enum";
import { Role } from "../enums/role.enum";

/**
 * Collaborator Schema.
 * Queryable projection of the back-office users living in the Cognito User Pool.
 * The pool is always the source of truth: this table serves the listings, which
 * read it instead of paging the pool ("collaborators of reseller X" via
 * resellerCodeIndex, the Keus or reseller accounts via accountTypeIndex), and
 * can be rebuilt from the pool at any time through the reconcile endpoint.
 * Authorization never reads this table: the scoping guard relies on the JWT claims
 * (groups + custom:resellerCode).
 */
export const CollaboratorSchema = new Schema({
  /** Cognito sub of the user. */
  sub: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Email of the user. */
  email: {
    type: String,
    required: true,
  },
  /** First name of the user. */
  name: {
    type: String,
    required: false,
  },
  /** Last name of the user. */
  surname: {
    type: String,
    required: false,
  },
  /** Account type of the user (collaborator or reseller). */
  accountType: {
    type: String,
    enum: Object.values(AccountType),
    required: true,
    default: AccountType.COLLABORATOR,
    index: {
      name: "accountTypeIndex",
      type: "global",
    },
  },
  /** Code of the reseller the user belongs to. Only set for reseller users. */
  resellerCode: {
    type: String,
    required: false,
    index: {
      name: "resellerCodeIndex",
      type: "global",
    },
  },
  /** Profiles of the user, without the account-type group: listings filter on them in memory. */
  groups: {
    type: Array,
    schema: [String],
    required: false,
  },
  /** Whether the user can sign in, as enabled or disabled in the pool. */
  enabled: {
    type: Boolean,
    required: true,
    default: true,
  },
  /** S3 key of the profile photo of the user. */
  profilePicS3Key: {
    type: String,
    required: false,
  },
},
{
  timestamps: true,
});

/**
 * Collaborator Key Interface.
 */
export interface CollaboratorKey {
  /** Cognito sub of the user. */
  sub: string;
}

/**
 * Collaborator Interface.
 */
export interface Collaborator extends CollaboratorKey {
  /** Email of the user. */
  email: string;
  /** First name of the user. */
  name?: string;
  /** Last name of the user. */
  surname?: string;
  /** Account type of the user. */
  accountType: AccountType;
  /** Code of the reseller the user belongs to. Only set for reseller users. */
  resellerCode?: string;
  /** Profiles of the user, without the account-type group. */
  groups?: Role[];
  /** Whether the user can sign in. */
  enabled?: boolean;
  /** S3 key of the profile photo of the user. */
  profilePicS3Key?: string;
  /** Creation timestamp. */
  createdAt?: Date;
  /** Last update timestamp. */
  updatedAt?: Date;
}
