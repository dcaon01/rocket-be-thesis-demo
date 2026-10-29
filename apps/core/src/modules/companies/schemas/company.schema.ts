import { Schema } from "dynamoose";
import { StripeAccountLink } from "../../stripe/classes/stripe-account-link.class";
import { IssuerType } from "../../../commons/enums/issuer-type.enum";
import { CompanyStatus } from "../enums/company-status.enum";
import { SalesChannel } from "../enums/sales-channel.enum";

/**
 * Company Schema.
 * A companies is an entity whose only purpose is to 
 * memorize companies data for contact purposes in order
 * for them to be reused in contracts.
 * We won't integrate this entity with any external system,
 * in order to keep thing simple and avoid unnecessary complexity.
 */
export const CompanySchema = new Schema({
  /** Identifier of the company. */
  id: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Name of the company. */
  name: {
    type: String,
    required: true,
  },
  /** Name as `searchKeyOf` stores it, sort key of nameIndex: written with the name, never sent by a client. */
  normalizedName: {
    type: String,
    required: false,
  },
  /** `${status}#${normalizedName}`, sort key of statusNameIndex: rewritten when the status or the name changes. */
  statusName: {
    type: String,
    required: false,
  },
  /** Email as `searchKeyOf` stores it, sort key of emailSearchIndex: written with the email. */
  normalizedEmail: {
    type: String,
    required: false,
  },
  /** Email of the company. */
  email: {
    type: String,
    required: true,
    index: {
      name: "emailIndex",
      type: "global",
    },
  },
  /** Certified electronic address of the company. */
  pec: {
    type: String,
    required: false,
  },
  /** Phone number of the company. */
  phoneNumber: {
    type: String,
    required: false,
  },
  /** Address of the company. */
  address: {
    type: String,
    required: false,
  },
  /** VAT number of the company. Global index, to find a company by its VAT number. */
  vatNumber: {
    type: String,
    required: false,
    index: {
      name: "vatIndex",
      type: "global",
    },
  },
  /** Interchange code (codice destinatario) for the electronic invoice. */
  sdi: {
    type: String,
    required: false,
  },
  /** Person to talk to at the company, kept as part of its records. */
  referent: {
    type: Object,
    required: false,
    schema: {
      /** First name. */
      firstName: { type: String, required: false },
      /** Last name. */
      lastName: { type: String, required: false },
      /** Email. */
      email: { type: String, required: false },
      /** Phone number. */
      phoneNumber: { type: String, required: false },
    },
  },
  status: {
    type: String,
    enum: Object.values(CompanyStatus),
    required: true,
    default: CompanyStatus.Active,
  },
  /**
   * Structured legal address, needed on the fiscal documents.
   * Kept apart from `address`, which stays the free-text contact line.
   */
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
  /** IBAN used for the SEPA direct debit. Required on the direct channel. */
  iban: {
    type: String,
    required: false,
  },
  /** Fiscal code, when the company has no VAT number or they differ. */
  fiscalCode: {
    type: String,
    required: false,
  },
  /** Customer and SEPA mandate of the company on each Stripe account, written by Rocket only. */
  stripeAccounts: {
    type: Array,
    required: false,
    schema: [{
      type: Object,
      schema: {
        /** Stripe account: a product id, or `keus`. */
        accountKey: { type: String, required: true },
        /** Stripe customer on that account. */
        customerId: { type: String, required: true },
        /** SEPA payment method collected by the checkout. */
        paymentMethodId: { type: String, required: false },
        /** When the mandate was collected (ISO string). */
        mandateAt: { type: String, required: false },
      },
    }],
  },
  /**
   * Sales channel the company belongs to. Decides who gets invoiced and who
   * receives the communications: RESELLER while the company has a reseller
   * path, DIRECT otherwise. Partition key of the indexes of the collaborator
   * list: by name, by status and name, by email.
   */
  channel: {
    type: String,
    enum: Object.values(SalesChannel),
    required: false,
    default: SalesChannel.Direct,
    index: [
      { name: "nameIndex", type: "global", rangeKey: "normalizedName" },
      { name: "statusNameIndex", type: "global", rangeKey: "statusName" },
      { name: "emailSearchIndex", type: "global", rangeKey: "normalizedEmail" },
    ],
  },
  /** Code of the reseller managing the company. Absent on direct companies. */
  resellerCode: {
    type: String,
    required: false,
  },
  /** Cognito sub of the user who created the company; a record only, no perimeter follows it. */
  createdBySub: {
    type: String,
    required: false,
  },
  /** Who brought (created) the company. Records without the attribute are KEUS. */
  createdByType: {
    type: String,
    enum: Object.values(IssuerType),
    required: true,
    default: IssuerType.Keus,
  },
  /**
   * Identifier of the non-Keus creator: the reseller code for RESELLER creators,
   * the professional id for PROFESSIONAL creators. Absent on Keus companies.
   * Immutable after creation; used by the reseller scoping.
   */
  createdById: {
    type: String,
    required: false,
    index: {
      name: "createdByIndex",
      type: "global",
    },
  },
  /**
   * Top-level reseller code of the creator's lineage (first segment of
   * resellerPath). Partition key of the resellerPathIndex GSI: since the
   * companies table is not product-scoped, the subtree query partitions by the
   * root reseller and filters by path prefix. Absent on Keus companies.
   */
  rootResellerCode: {
    type: String,
    required: false,
    index: {
      name: "resellerPathIndex",
      type: "global",
      rangeKey: "resellerPath",
    },
  },
  /**
   * Materialized reseller lineage of the creator ("RVD-001#RVD-002#"), range
   * key of resellerPathIndex: a reseller lists the companies of its whole subtree
   * with query(rootResellerCode).beginsWith(ownPath). Absent on Keus companies.
   */
  resellerPath: {
    type: String,
    required: false,
  },
  /** When the company was last transferred from an inactive reseller (UR-RK-105). */
  transferredAt: {
    type: String,
    required: false,
  },
  /** Code of the reseller the company left with its last transfer. */
  previousResellerCode: {
    type: String,
    required: false,
  },
  /**
   * Other records of the same real company, linked by a transfer into a channel that already had one with the same
   * email: the rule of one contract in force per product holds across them.
   */
  sameAsCompanyIds: {
    type: Array,
    schema: [String],
    required: false,
  },
},
{
  timestamps: true,
});

/**
 * Company Key Interface.
 */
export interface CompanyKey {
  /** Identifier of the company. */
  id: string;
}

/**
 * Company Interface.
 */
export interface Company extends CompanyKey {
  /** Name of the company. */
  name: string;
  /** Name normalized for the search, sort key of nameIndex. */
  normalizedName?: string;
  /** `${status}#${normalizedName}`, sort key of statusNameIndex. */
  statusName?: string;
  /** Email normalized for the search, sort key of emailSearchIndex. */
  normalizedEmail?: string;
  /** Email of the company. */
  email: string;
  /** Certified electronic address of the company. */
  pec?: string;
  /** Phone number of the company. */
  phoneNumber?: string;
  /** Address of the company. */
  address?: string;
  /** VAT number of the company. */
  vatNumber?: string;
  /** Interchange code (codice destinatario) for the electronic invoice. */
  sdi?: string;
  /** Person to talk to at the company, kept as part of its records. */
  referent?: {
    /** First name. */
    firstName?: string;
    /** Last name. */
    lastName?: string;
    /** Email. */
    email?: string;
    /** Phone number. */
    phoneNumber?: string;
  };
  /** Status of the company. */
  status: CompanyStatus;
  /** Structured legal address, needed on the fiscal documents. */
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
  /** IBAN used for the SEPA direct debit. Required on the direct channel. */
  iban?: string;
  /** Fiscal code, when the company has no VAT number or they differ. */
  fiscalCode?: string;
  /** Customer and SEPA mandate of the company on each Stripe account, written by Rocket only. */
  stripeAccounts?: StripeAccountLink[];
  /** Sales channel the company belongs to: RESELLER while it has a reseller path, DIRECT otherwise. */
  channel?: SalesChannel;
  /** Code of the reseller managing the company. Absent on direct companies. */
  resellerCode?: string;
  /** Cognito sub of the user who created the company; a record only, no perimeter follows it. */
  createdBySub?: string;
  /** Who brought (created) the company. Records without the attribute are KEUS. */
  createdByType?: IssuerType;
  /** Identifier of the non-Keus creator (reseller code or professional id). */
  createdById?: string;
  /** Top-level reseller code of the creator's lineage (GSI partition). Absent on Keus companies. */
  rootResellerCode?: string;
  /** Materialized reseller lineage of the creator ("RVD-001#RVD-002#"). Absent on Keus companies. */
  resellerPath?: string;
  /** When the company was last transferred from an inactive reseller. */
  transferredAt?: string;
  /** Code of the reseller the company left with its last transfer. */
  previousResellerCode?: string;
  /** Other records of the same real company, across which one contract in force per product holds. */
  sameAsCompanyIds?: string[];
}