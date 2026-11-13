import { Schema } from "dynamoose";
import { DocumentOwnerType } from "../enums/document-owner-type.enum";
import { DocumentType } from "../enums/document-type.enum";

/**
 * Document Schema.
 * The files kept alongside a company, a reseller or an order: offers, signed
 * contracts, SEPA mandates.
 *
 * One table for the three kinds of owner, partitioned by `ownerId`, because
 * documents are always listed per owner and never across owners: company and
 * order ids are UUIDs and reseller codes never look like one, so an owner id
 * alone names its owner. Keeping them as a list nested on the owner would make
 * the upload confirmation awkward: the file lands on S3 first and the record is
 * updated when the event comes back, which needs something to address.
 */
export const DocumentSchema = new Schema({
  /** Identifier of the owner: company id, reseller code or order id. */
  ownerId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Identifier of the document. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** Kind of entity the document is attached to. */
  ownerType: {
    type: String,
    enum: Object.values(DocumentOwnerType),
    required: true,
  },
  /** Business type of the document. */
  type: {
    type: String,
    enum: Object.values(DocumentType),
    required: true,
    index: {
      name: "typeIndex",
      type: "local",
      project: true,
    },
  },
  /** Display name of the document. */
  name: {
    type: String,
    required: true,
  },
  /** S3 key of the stored file. */
  fileS3Key: {
    type: String,
    required: true,
  },
  /** MIME type of the file. */
  contentType: {
    type: String,
    required: false,
  },
  /**
   * Whether the upload has been confirmed by the S3 event. A record exists from
   * the moment the presigned url is handed out, so a file that never arrives
   * stays visible as missing instead of disappearing.
   */
  uploaded: {
    type: Boolean,
    required: true,
    default: false,
  },
  /** Cognito sub of whoever uploaded it. */
  uploadedBySub: {
    type: String,
    required: false,
  },
  /** Reference to the entity the document belongs to, when it is not the owner. */
  refId: {
    type: String,
    required: false,
  },
  /** Materialized reseller lineage of the owner, for the reseller scoping. */
  resellerPath: {
    type: String,
    required: false,
  },
},
{
  timestamps: true,
});

/**
 * Document Key Interface.
 */
export interface DocumentKey {
  /** Identifier of the owner: company id, reseller code or order id. */
  ownerId: string;
  /** Identifier of the document. */
  id: string;
}

/**
 * Document Interface.
 */
export interface StoredDocument extends DocumentKey {
  /** Kind of entity the document is attached to. */
  ownerType: DocumentOwnerType;
  /** Business type of the document. */
  type: DocumentType;
  /** Display name of the document. */
  name: string;
  /** S3 key of the stored file. */
  fileS3Key: string;
  /** MIME type of the file. */
  contentType?: string;
  /** Whether the upload has been confirmed by the S3 event. */
  uploaded: boolean;
  /** Cognito sub of whoever uploaded it. */
  uploadedBySub?: string;
  /** Reference to the entity the document belongs to. */
  refId?: string;
  /** Materialized reseller lineage of the owner. */
  resellerPath?: string;
}
