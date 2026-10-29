import { Schema } from "dynamoose";
import { PendingOperationKind } from "../enums/pending-operation-kind.enum";
import { PendingOperationState } from "../enums/pending-operation-state.enum";

/**
 * Pending Operation Schema.
 * A message Rocket sent to a product and is still waiting on, written in the same
 * transaction as the record it creates (a tenant or a user in REQUESTED), so that
 * either both exist or neither does.
 *
 * The table is partitioned by `productId`, since operations are sent and answered per
 * product. `retryIndex` lists the pending ones by next attempt: `nextAttemptAt` is
 * present only while the operation is pending, so the index is sparse and holds
 * nothing once the product has answered.
 *
 * Operations are never deleted: closed ones are the history of their record, read
 * through `targetIndex` by the record's id on the product.
 */
export const PendingOperationSchema = new Schema({
  /** Identifier of the product the operation is sent to. */
  productId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Identifier of the operation. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** What the operation asks the product to do. */
  kind: {
    type: String,
    enum: Object.values(PendingOperationKind),
    required: true,
  },
  /** Identifier of the record the operation targets: Rocket's while it waits, the product's once confirmed. */
  targetId: {
    type: String,
    required: true,
    index: {
      name: "targetIndex",
      type: "global",
    },
  },
  /** Notification sent to the product, sent again as it is on every attempt. */
  payload: {
    type: Object,
    required: true,
  },
  /** State of the operation. */
  state: {
    type: String,
    enum: Object.values(PendingOperationState),
    required: true,
    default: PendingOperationState.Pending,
    index: {
      name: "retryIndex",
      type: "global",
      rangeKey: "nextAttemptAt",
    },
  },
  /** Sendings made so far; zero while a deferred operation waits for its prerequisite. */
  attempts: {
    type: Number,
    required: true,
    default: 0,
  },
  /** When the operation is due to be sent again (ISO 8601), only while it is pending. */
  nextAttemptAt: {
    type: String,
    required: false,
  },
  /** Error of the last failed attempt or of the product's answer. */
  lastError: {
    type: String,
    required: false,
  },
  /** Cognito sub of the operator who asked for the operation; absent when Rocket itself did. */
  requestedBy: {
    type: String,
    required: false,
  },
  /** Set on a change the product made on its own and told Rocket about: recorded already DONE, for the history. */
  fromProduct: {
    type: Boolean,
    required: false,
  },
}, {
  timestamps: true,
  saveUnknown: ["payload.**"],
});

/** Pending Operation Key Interface. Composite key used by Dynamoose to address a single operation. */
export interface PendingOperationKey {
  /** Identifier of the product the operation is sent to. */
  productId: string;
  /** Identifier of the operation. */
  id: string;
}

/** Pending Operation Interface. Full shape of a pending operation as stored in DynamoDB. */
export interface PendingOperation extends PendingOperationKey {
  /** What the operation asks the product to do. */
  kind: PendingOperationKind;
  /** Identifier of the record the operation targets: Rocket's while it waits, the product's once confirmed. */
  targetId: string;
  /** Notification sent to the product, sent again as it is on every attempt. */
  payload: Record<string, unknown>;
  /** State of the operation. */
  state: PendingOperationState;
  /** Sendings made so far; zero while a deferred operation waits for its prerequisite. */
  attempts: number;
  /** When the operation is due to be sent again (ISO 8601), only while it is pending. */
  nextAttemptAt?: string;
  /** Error of the last failed attempt or of the product's answer. */
  lastError?: string;
  /** Cognito sub of the operator who asked for the operation; absent when Rocket itself did. */
  requestedBy?: string;
  /** Set on a change the product made on its own and told Rocket about: recorded already DONE, for the history. */
  fromProduct?: boolean;
  /** Creation timestamp. */
  createdAt?: Date;
  /** Last update timestamp. */
  updatedAt?: Date;
}
