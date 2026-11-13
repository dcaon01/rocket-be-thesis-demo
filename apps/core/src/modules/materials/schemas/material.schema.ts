import { Schema } from "dynamoose";
import { ResellerTier } from "../../resellers/enums/reseller-tier.enum";
import { MaterialStatus } from "../enums/material-status.enum";
import { MaterialType } from "../enums/material-type.enum";

/**
 * Material Schema.
 * The commercial documentation Keus makes available to the resale network:
 * catalogues, price lists, presentations, external links.
 *
 * `productIds` and `resellerTiers` are lists, and DynamoDB does not index the
 * elements of a list. Filtering "what this reseller can see" therefore reads
 * the published materials and filters in memory: with a few tens of rows that
 * is the right trade, and an index here would buy nothing. An empty list means
 * "every product" or "every tier", so assigning nothing is the same as
 * assigning everything.
 */
export const MaterialSchema = new Schema({
  /** Identifier of the material. */
  id: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Title shown in the listing. */
  title: {
    type: String,
    required: true,
  },
  /** Short description of what the material is for. */
  description: {
    type: String,
    required: false,
  },
  /** Kind of material, fixed at creation. */
  type: {
    type: String,
    enum: Object.values(MaterialType),
    required: true,
  },
  /** Publication state. */
  status: {
    type: String,
    enum: Object.values(MaterialStatus),
    required: true,
    default: MaterialStatus.Draft,
    index: {
      name: "statusIndex",
      type: "global",
      rangeKey: "createdAtKey",
      project: true,
    },
  },
  /** Sortable creation key `${createdAt}#${id}`. */
  createdAtKey: {
    type: String,
    required: true,
  },
  /** Products the material is assigned to. Empty means every product. */
  productIds: {
    type: Array,
    schema: [String],
    required: false,
  },
  /** Reseller tiers the material is available to. Empty means every tier. */
  resellerTiers: {
    type: Array,
    schema: [{ type: String, enum: Object.values(ResellerTier) }],
    required: false,
  },
  /** S3 key of the file. Absent when the material is an external link. */
  fileS3Key: {
    type: String,
    required: false,
  },
  /** External address, for the materials that are a link rather than a file. */
  externalUrl: {
    type: String,
    required: false,
  },
  /** MIME type of the file, read from S3 when the file is attached. */
  contentType: {
    type: String,
    required: false,
  },
  /** Size of the file in bytes, read from S3 when the file is attached. */
  sizeBytes: {
    type: Number,
    required: false,
  },
  /** ISO timestamp of the publication. */
  publishedAt: {
    type: String,
    required: false,
  },
},
{
  timestamps: true,
});

/**
 * Material Key Interface.
 */
export interface MaterialKey {
  /** Identifier of the material. */
  id: string;
}

/**
 * Material Interface.
 */
export interface Material extends MaterialKey {
  /** Title shown in the listing. */
  title: string;
  /** Short description of what the material is for. */
  description?: string;
  /** Kind of material, fixed at creation. */
  type: MaterialType;
  /** Publication state. */
  status: MaterialStatus;
  /** Sortable creation key `${createdAt}#${id}`. */
  createdAtKey: string;
  /** Products the material is assigned to. Empty means every product. */
  productIds?: string[];
  /** Reseller tiers the material is available to. Empty means every tier. */
  resellerTiers?: ResellerTier[];
  /** S3 key of the file. */
  fileS3Key?: string;
  /** External address, for the materials that are a link. */
  externalUrl?: string;
  /** MIME type of the file. */
  contentType?: string;
  /** Size of the file in bytes. */
  sizeBytes?: number;
  /** ISO timestamp of the publication. */
  publishedAt?: string;
}
