import { Schema } from 'dynamoose';
import { ProductStatus } from '../enums/product-status.enum';
import { StructureField } from '../classes/structured-field.class';
import { MixpanelLeverRule } from '../classes/mixpanel-lever-rule.class';

/**
 * Dynamoose schema for the product entity.
 */
export const ProductSchema = new Schema({
  /** Identifier of the product. */
  id: {
    type: String,
    hashKey: true,
    required: true,
  },
  /** Name of the product (to be displayed). */
  name: {
    type: String,
    required: true,
  },
  /** Display name for the product. */
  description: {
    type: String,
    required: false,
    default: '',
  },
  /** Prefix used for generating contract codes. For example, Nquado it is 'NQ'. */
  prefix: {
    type: String,
    required: true,
  },
  /** Status of the product. */
  status: {
    type: String,
    enum: Object.values(ProductStatus),
    required: true,
    default: ProductStatus.Active,
  },
  /** Dynamic structure defining product dependand fields for tenants other than common ones (defined in tenant schema). */
  tenantStructure: {
    type: Array,
    schema: [{
      type: Object,
      schema: {
        name: { type: String, required: true },
        type: { type: String, required: true },
        required: { type: Boolean, required: true, default: false },
        array: { type: Boolean, required: true, default: false },
        generated: { type: Boolean, required: true, default: false },
        notModifiable: { type: Boolean, required: true, default: false }
      }
    }],
    required: true,
    default: []
  },
  /** Dynamic structure defining product dependand fields for users other than common ones (defined in user schema). */
  userStructure: {
    type: Array,
    schema: [{
      type: Object,
      schema: {
        name: { type: String, required: true },
        type: { type: String, required: true },
        required: { type: Boolean, required: true, default: false },
        array: { type: Boolean, required: true, default: false },
        generated: { type: Boolean, required: true, default: false },
        notModifiable: { type: Boolean, required: true, default: false }
      }
    }],
    required: true,
    default: []
  },
  /** Cognito custom attributes for the product. */
  customAttributes: {
    type: Array,
    required: true,
    schema: [String]
  },
  /** Cognito roles attributes for the product. */
  roles: {
    type: Array,
    required: true,
    schema: [String]
  },
  /** Value of the HubSpot "Soluzione d'interesse" deal property that marks the deals of the product. */
  hubspotSolution: {
    type: String,
    required: false,
  },
  /** Name of the Intercom brand the conversations of the product come through. */
  intercomBrand: {
    type: String,
    required: false,
  },
  /** Identifier of the Sentry project the errors of the product are sent to. */
  sentryProjectId: {
    type: String,
    required: false,
  },
  /** Public address Rocket calls every 15 minutes to tell whether the product answers. */
  healthCheckUrl: {
    type: String,
    required: false,
  },
  /** S3 key for the product logo. */
  logoS3Key: {
    type: String,
    required: false,
  },
  /** Public URL of the product logo, copied for the emails to the companies. */
  emailLogoUrl: {
    type: String,
    required: false,
  },
  /** Domain of the product, such as `next.getgenio.it`: Stripe sends its companies back to the `/payment-success`, `/payment-cancelled`, `/mandate-success` and `/mandate-cancelled` pages there. */
  domain: {
    type: String,
    required: false,
  },
  /** Default trial duration in days. Used when creating a trial without an explicit expiresAt. */
  defaultTrialDuration: {
    type: Number,
    required: false,
    default: 14,
  },
  /** Whether the product has a trials users limit. */
  hasTrialsUsersLimit: {
    type: Boolean,
    required: true,
    default: false,
  },
  /** Maximum number of users allowed for the product's trials. */
  trialsUsersLimit: {
    type: Number,
    required: false,
  },
  /** Stripe secret API key for the Stripe account dedicated to this product. */
  stripeApiKey: {
    type: String,
    required: false,
  },
  /** Stripe webhook signing secret for the Stripe account dedicated to this product. */
  stripeWebhookSecret: {
    type: String,
    required: false,
  },
  /** Stripe Tax Rate id applied to every line item of checkout sessions for this product. */
  stripeTaxRateId: {
    type: String,
    required: false,
  },
  /** Whether plans with RESELLER audience can be created for this product. */
  resellerPlansEnabled: {
    type: Boolean,
    required: true,
    default: false,
  },
  /** Whether the product can be sold through an order. */
  orderable: {
    type: Boolean,
    required: false,
    default: true,
  },
  /** Number of seats proposed by default on a new order line. */
  defaultSeats: {
    type: Number,
    required: false,
  },
  /** Days between order confirmation and delivery, used to propose the delivery date. */
  deliveryLeadDays: {
    type: Number,
    required: false,
  },
  /** Whether plans with PROFESSIONAL audience can be created for this product. */
  professionalPlansEnabled: {
    type: Boolean,
    required: true,
    default: false,
  }, 
  
  /** Identifier of the Mixpanel project that tracks this product's events (one project per product). Nullable. */
  mixpanelProjectId: {
    type: String,
    required: false,
  },
  /**
   * Rules of the levers, as many per lever as needed. Stored loosely (object without nested schema +
   * `saveUnknown` below) because their fields depend on the shape and may be null; the shape is
   * validated at the API boundary by the MixpanelLeverRule class.
   */
  mixpanelRules: {
    type: Array,
    schema: [{ type: Object }],
    required: false,
  },
},
  {
    timestamps: true,
    saveUnknown: ['mixpanelRules.**'],
  }
)

/**
 * productKey interface.
 */
export interface ProductKey {
  /** Identifier of the product. */
  id: string;
}

/**
 * Product interface extending ProductKey.
 */
export interface Product extends ProductKey {
  /** Name of the product (to be displayed). */
  name: string;
  /** Description of the product. */
  description?: string;
  /** Status of the product. */
  status: ProductStatus;
  /** Prefix used for generating contract codes. For example, Nquado it is 'NQ'. */
  prefix: string;
  /** Structure definition for tenants within the product. */
  tenantStructure: StructureField[];
  /** Structure definition for users within the product. */
  userStructure: StructureField[];
  /** Custom attributes for the product. */
  customAttributes: string[];
  /** Cognito roles attributes for the product. */
  roles: string[];
  /** Value of the HubSpot "Soluzione d'interesse" deal property that marks the deals of the product. */
  hubspotSolution?: string;
  /** Name of the Intercom brand the conversations of the product come through. */
  intercomBrand?: string;
  /** Identifier of the Sentry project the errors of the product are sent to. */
  sentryProjectId?: string;
  /** Public address Rocket calls every 15 minutes to tell whether the product answers. */
  healthCheckUrl?: string;
  /** S3 key for the product logo. */
  logoS3Key?: string;
  /** Public URL of the product logo, copied for the emails to the companies. */
  emailLogoUrl?: string;
  /** Domain of the product, such as `next.getgenio.it`: Stripe sends its companies back to the `/payment-success`, `/payment-cancelled`, `/mandate-success` and `/mandate-cancelled` pages there. */
  domain?: string;
  /** Default trial duration in days. Used when creating a trial without an explicit expiresAt. */
  defaultTrialDuration?: number;
  /** Whether the product has a trials users limit. */
  hasTrialsUsersLimit: boolean;
  /** Maximum number of users allowed for the product's trials. */
  trialsUsersLimit?: number;
  /** Stripe secret API key for the Stripe account dedicated to this product. */
  stripeApiKey?: string;
  /** Stripe webhook signing secret for the Stripe account dedicated to this product. */
  stripeWebhookSecret?: string;
  /** Stripe Tax Rate id applied to every line item of checkout sessions for this product. */
  stripeTaxRateId?: string;
  /** Whether plans with RESELLER audience can be created for this product. */
  resellerPlansEnabled: boolean;
  /** Whether the product can be sold through an order. */
  orderable?: boolean;
  /** Number of seats proposed by default on a new order line. */
  defaultSeats?: number;
  /** Days between order confirmation and delivery, used to propose the delivery date. */
  deliveryLeadDays?: number;
  /** Whether plans with PROFESSIONAL audience can be created for this product. */
  professionalPlansEnabled: boolean;
  /** Identifier of the Mixpanel project that tracks this product's events (one project per product). */
  mixpanelProjectId?: string;
  /** Rules of the levers, as many per lever as needed. */
  mixpanelRules?: MixpanelLeverRule[];
}