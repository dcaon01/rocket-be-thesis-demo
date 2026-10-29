import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { StructureField } from "../classes/structured-field.class";
import { MixpanelLeverRule } from "../classes/mixpanel-lever-rule.class";
import { ProductStatus } from "../enums/product-status.enum";

/**
 * Data Transfer Object for responding with product details.
 */
export class ResponseProductDto {
  /** The unique identifier of the product. */
  @ApiProperty({
    example: "app123",
    description: "The unique identifier of the product.",
    required: true,
  })
  id: string;

  /** The name of the product. */
  @ApiProperty({
    example: "My product",
    description: "The name of the product.",
    required: true,
  })
  name: string;

  /** The description of the product. */
  @ApiPropertyOptional({
    example: "This is my product.",
    description: "The description of the product.",
    required: false,
  })
  description?: string;

  /** Status of the product. */
  @ApiProperty({
    example: "ACTIVE",
    description: "Status of the product.",
    required: true,
    enum: ProductStatus,
  })
  status: ProductStatus;

  /** Prefix used for generating contract codes. For example, Nquado it is 'NQ'. */
  @ApiProperty({
    example: "NQ",
    description: "Prefix used for generating contract codes. For example, Nquado it is 'NQ'.",
    required: true,
  })
  prefix: string;

  /** Structure definition for tenants within the product. */
  @ApiProperty({
    example: [{ name: "tenantId", type: "string", required: true }],
    description: "Structure definition for tenants within the product.",
    required: true,
    isArray: true,
    type: StructureField,
  })
  tenantStructure: StructureField[];

  /** Structure definition for users within the product. */
  @ApiProperty({
    example: [{ name: "userId", type: "string", required: true }],
    description: "Structure definition for users within the product.",
    required: true,
    isArray: true,
    type: StructureField,
  })
  userStructure: StructureField[];

  /** Cognito custom attributes for the product. */
  @ApiProperty({
    example: ["custom:attribute1", "custom:attribute2"],
    description: "Cognito custom attributes for the product.",
    required: true,
    isArray: true,
    type: String,
  })
  customAttributes: string[];

  /** Cognito roles attributes for the product. */
  @ApiProperty({
    example: ["admin", "user", "manager"],
    description: "Cognito roles attributes for the product.",
    required: true,
    isArray: true,
    type: String,
  })
  roles: string[];

  /** Default trial duration in days. Used when creating a trial without an explicit expiresAt. */
  @ApiPropertyOptional({
    example: 14,
    description: "Default trial duration in days. Used when creating a trial without an explicit expiresAt.",
    required: false,
  })
  defaultTrialDuration?: number;

  /** Whether the product has a trials users limit. */
  @ApiProperty({
    description: "Whether the product has a trials users limit.",
    example: false,
    required: true,
  })
  hasTrialsUsersLimit: boolean;

  /** Maximum number of users allowed for the product's trials. */
  @ApiPropertyOptional({
    description: "Maximum number of users allowed for the product's trials.",
    example: 50,
    required: false,
  })
  trialsUsersLimit?: number;

  /** Value of the HubSpot "Soluzione d'interesse" deal property that marks the deals of the product. */
  @ApiPropertyOptional({
    example: "Genio",
    description: "Value of the HubSpot \"Soluzione d'interesse\" deal property that marks the deals of the product.",
    required: false,
  })
  hubspotSolution?: string;

  /** Name of the Intercom brand the conversations of the product come through. */
  @ApiPropertyOptional({
    example: "Genio",
    description: "Name of the Intercom brand the conversations of the product come through.",
    required: false,
  })
  intercomBrand?: string;

  /** Identifier of the Sentry project the errors of the product are sent to. */
  @ApiPropertyOptional({
    example: "4511292228632656",
    description: "Identifier of the Sentry project the errors of the product are sent to.",
    required: false,
  })
  sentryProjectId?: string;

  /** Public address Rocket calls every 15 minutes to tell whether the product answers. */
  @ApiPropertyOptional({
    example: "https://k3u7rke8d3.execute-api.eu-west-1.amazonaws.com/genio-core/health",
    description: "Public address Rocket calls every 15 minutes to tell whether the product answers.",
    required: false,
  })
  healthCheckUrl?: string;


  /** S3 key for the product logo. */
  @ApiPropertyOptional({
    example: "products/prod-123/logo.png",
    description: "S3 key for the product logo.",
    required: false,
  })
  logoS3Key?: string;

  /** Public URL of the product logo, copied for the emails to the companies. */
  @ApiPropertyOptional({
    example: "https://rocket-dev-email-assets.s3.eu-north-1.amazonaws.com/products/nquadro/logo-1791796461472.png",
    description: "Public URL of the product logo, copied for the emails to the companies.",
    required: false,
  })
  emailLogoUrl?: string;

  /** Domain of the product, such as `next.getgenio.it`: Stripe sends its companies back to the `/payment-success`, `/payment-cancelled`, `/mandate-success` and `/mandate-cancelled` pages there. */
  @ApiPropertyOptional({
    example: "next.getgenio.it",
    description: "Domain of the product, such as next.getgenio.it: Stripe sends its companies back to the /payment-success, /payment-cancelled, /mandate-success and /mandate-cancelled pages there.",
    required: false,
  })
  domain?: string;

  /** Stripe secret API key for the Stripe account dedicated to this product. Returned decrypted. */
  @ApiPropertyOptional({
    example: "sk_live_xxx",
    description: "Stripe secret API key for the Stripe account dedicated to this product.",
    required: false,
  })
  stripeApiKey?: string;

  /** Stripe webhook signing secret for the Stripe account dedicated to this product. Returned decrypted. */
  @ApiPropertyOptional({
    example: "whsec_xxx",
    description: "Stripe webhook signing secret for the Stripe account dedicated to this product.",
    required: false,
  })
  stripeWebhookSecret?: string;

  /** Stripe Tax Rate id applied to every line item of checkout sessions for this product. */
  @ApiPropertyOptional({
    example: "txr_xxx",
    description: "Stripe Tax Rate id applied to every line item of checkout sessions for this product.",
    required: false,
  })
  stripeTaxRateId?: string;

  /** Whether plans with RESELLER audience can be created for this product. */
  @ApiProperty({
    description: "Whether plans with RESELLER audience can be created for this product.",
    example: false,
    required: true,
  })
  resellerPlansEnabled: boolean;

  /** Whether the product can be sold through an order. */
  @ApiPropertyOptional({
    description: "Whether the product can be sold through an order.",
    example: true,
    required: false,
  })
  orderable?: boolean;

  /** Whether plans with PROFESSIONAL audience can be created for this product. */
  @ApiProperty({
    description: "Whether plans with PROFESSIONAL audience can be created for this product.",
    example: false,
    required: true,
  })
  professionalPlansEnabled: boolean;

  /** Identifier of the Mixpanel project that tracks this product's events. */
  @ApiPropertyOptional({
    example: "1234567",
    description: "Identifier of the Mixpanel project that tracks this product's events.",
    required: false,
  })
  mixpanelProjectId?: string;

  /** Rules of the levers on which Rocket judges the tenants of the product, as many per lever as needed. */
  @ApiPropertyOptional({
    description: "Rules of the levers on which Rocket judges the tenants of the product, as many per lever as needed.",
    required: false,
    isArray: true,
    type: MixpanelLeverRule,
  })
  mixpanelRules?: MixpanelLeverRule[];

  /** The date and time when the product was created. */
  @ApiProperty({
    example: "2024-01-01T00:00:00Z",
    description: "The date and time when the product was created.",
    required: true,
  })
  createdAt: string;

  /** The date and time when the product was last updated. */
  @ApiProperty({
    example: "2024-01-02T00:00:00Z",
    description: "The date and time when the product was last updated.",
    required: true,
  })
  updatedAt: string;
}