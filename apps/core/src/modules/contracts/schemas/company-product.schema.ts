import { Schema } from "dynamoose";

/**
 * Company Product Schema.
 * The hold of a product by a company: a company has at most one contract in force per product, so the order whose
 * line is provisioned takes the pair first, in the same transaction that hands the line its tenant, and a second
 * order on the pair fails on the condition even when the two arrive together.
 *   provisioning → written with the order, or kept if the order already holds it
 *   contract terminated → deleted, and the pair is free for a new order
 * Keyed by `companyId` + `productId`, the identity of the pair.
 */
export const CompanyProductSchema = new Schema({
  /** Identifier of the company. */
  companyId: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Identifier of the product. */
  productId: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** Order whose line holds the product, and whose contract keeps it until it is terminated. */
  orderId: {
    type: String,
    required: true,
  },
}, {
  timestamps: true,
});

/** Company Product Key Interface. Composite key used by Dynamoose to address a single hold. */
export interface CompanyProductKey {
  /** Identifier of the company. */
  companyId: string;
  /** Identifier of the product. */
  productId: string;
}

/** Company Product Interface. Full shape of a hold as stored in DynamoDB. */
export interface CompanyProduct extends CompanyProductKey {
  /** Order whose line holds the product, and whose contract keeps it until it is terminated. */
  orderId: string;
  /** Creation timestamp. */
  createdAt?: Date;
  /** Last update timestamp. */
  updatedAt?: Date;
}
