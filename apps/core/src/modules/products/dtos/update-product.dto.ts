import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, IsUrl, ValidateNested } from "class-validator";
import { StructureField } from "../classes/structured-field.class";
import { MixpanelLeverRule } from "../classes/mixpanel-lever-rule.class";
import { ProductStatus } from "../enums/product-status.enum";

/**
 * Data Transfer Object for updating an product.
 */
export class UpdateProductDto {
  /** Name of the product (to be displayed). */
  @ApiPropertyOptional({
    example: "My Updated product",
    description: "The updated name of the product.",
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  /** Description of the product. */
  @ApiPropertyOptional({
    example: "This is my updated product.",
    description: "The updated description of the product.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  /** Status of the product. */
  @ApiPropertyOptional({
    example: "INACTIVE",
    description: "The updated status of the product.",
    required: false,
  })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  /** Prefix used for generating contract codes. For example, Nquado it is 'NQ'. */
  @ApiPropertyOptional({
    example: "NQ",
    description: "The updated prefix used for generating contract codes. For example, Nquado it is 'NQ'.",
    required: false,
  })
  @IsOptional()
  @IsString()
  prefix?: string;

  /** Structure definition for tenants within the product. */
  @ApiPropertyOptional({
    example: [{ name: "tenantId", type: "string", required: true }],
    description: "The updated structure definition for tenants within the product.",
    required: false,
    isArray: true,
    type: StructureField,
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => StructureField)
  tenantStructure?: StructureField[];

  /** Structure definition for users within the product. */
  @ApiPropertyOptional({
    example: [{ name: "userId", type: "string", required: true }],
    description: "The updated structure definition for users within the product.",
    required: false,
    isArray: true,
    type: StructureField,
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => StructureField)
  userStructure?: StructureField[];

  /** Cognito custom attributes for the product. */
  @ApiPropertyOptional({
    example: ["custom:attribute1", "custom:attribute2"],
    description: "Cognito custom attributes for the product.",
    required: false,
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsArray()
  customAttributes?: string[];

  /** Cognito roles attributes for the product. */
  @ApiPropertyOptional({
    example: ["admin", "user", "manager"],
    description: "Cognito roles attributes for the product.",
    required: false,
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsArray()
  roles?: string[];

  /** Default trial duration in days. Used when creating a trial without an explicit expiresAt. */
  @ApiPropertyOptional({
    example: 14,
    description: "Default trial duration in days. Used when creating a trial without an explicit expiresAt.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  defaultTrialDuration?: number | null;

  /** Value of the HubSpot "Soluzione d'interesse" deal property that marks the deals of the product; null removes it. */
  @ApiPropertyOptional({
    example: "Genio",
    description: "Value of the HubSpot \"Soluzione d'interesse\" deal property that marks the deals of the product; null removes it.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  hubspotSolution?: string | null;

  /** Name of the Intercom brand the conversations of the product come through; null removes it. */
  @ApiPropertyOptional({
    example: "Genio",
    description: "Name of the Intercom brand the conversations of the product come through; null removes it.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  intercomBrand?: string | null;

  /** Identifier of the Sentry project the errors of the product are sent to; null removes it. */
  @ApiPropertyOptional({
    example: "4511292228632656",
    description: "Identifier of the Sentry project the errors of the product are sent to; null removes it.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  sentryProjectId?: string | null;

  /** Public address Rocket calls every 15 minutes to tell whether the product answers; null removes it. */
  @ApiPropertyOptional({
    example: "https://k3u7rke8d3.execute-api.eu-west-1.amazonaws.com/genio-core/health",
    description: "Public address Rocket calls every 15 minutes to tell whether the product answers; null removes it.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'], require_tld: true })
  healthCheckUrl?: string | null;


  /** Whether the product has a trials users limit. */
  @ApiPropertyOptional({
    description: "Whether the product has a trials users limit.",
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  hasTrialsUsersLimit?: boolean;

  /** Maximum number of users allowed for the product's trials. */
  @ApiPropertyOptional({
    description: "Maximum number of users allowed for the product's trials.",
    example: 50,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  trialsUsersLimit?: number | null;

  /** S3 key for the product logo. */
  @ApiPropertyOptional({
    example: "products/prod-123/logo.png",
    description: "S3 key for the product logo.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  logoS3Key?: string | null;

  /** Domain of the product, such as `next.getgenio.it`: Stripe sends its companies back to the `/payment-success`, `/payment-cancelled`, `/mandate-success` and `/mandate-cancelled` pages there. */
  @ApiPropertyOptional({
    example: "next.getgenio.it",
    description: "Domain of the product, such as next.getgenio.it: Stripe sends its companies back to the /payment-success, /payment-cancelled, /mandate-success and /mandate-cancelled pages there.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  domain?: string | null;

  /** Stripe secret API key for the Stripe account dedicated to this product. */
  @ApiPropertyOptional({
    example: "sk_live_xxx",
    description: "Stripe secret API key for the Stripe account dedicated to this product.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  stripeApiKey?: string | null;

  /** Stripe webhook signing secret for the Stripe account dedicated to this product. */
  @ApiPropertyOptional({
    example: "whsec_xxx",
    description: "Stripe webhook signing secret for the Stripe account dedicated to this product.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  stripeWebhookSecret?: string | null;

  /** Stripe Tax Rate id applied to every line item of checkout sessions for this product. */
  @ApiPropertyOptional({
    example: "txr_xxx",
    description: "Stripe Tax Rate id applied to every line item of checkout sessions for this product.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  stripeTaxRateId?: string | null;

  /** Whether plans with RESELLER audience can be created for this product. */
  @ApiPropertyOptional({
    description: "Whether plans with RESELLER audience can be created for this product.",
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  resellerPlansEnabled?: boolean;

  /** Identifier of the Mixpanel project that tracks this product's events. */
  @ApiPropertyOptional({
    example: "1234567",
    description: "Identifier of the Mixpanel project that tracks this product's events.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  mixpanelProjectId?: string | null;

  /** Rules of the levers, as many per lever as needed (full desired state of the array). */
  @ApiPropertyOptional({
    description: "The updated rules of the levers (full desired state of the array).",
    required: false,
    nullable: true,
    isArray: true,
    type: MixpanelLeverRule,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MixpanelLeverRule)
  mixpanelRules?: MixpanelLeverRule[] | null;
}