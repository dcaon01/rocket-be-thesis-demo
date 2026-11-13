import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, IsUrl, ValidateNested } from "class-validator";
import { StructureField } from "../classes/structured-field.class";
import { MixpanelLeverRule } from "../classes/mixpanel-lever-rule.class";

/**
 * Data Transfer Object for creating a new product.
 */
export class CreateProductDto {
  /** The name of the product. */
  @ApiProperty({
    example: "My product",
    description: "The name of the product.",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  /** The description of the product. */
  @ApiPropertyOptional({
    example: "This is my product.",
    description: "The description of the product.",
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  /** Prefix used for generating contract codes. For example, Nquado it is 'NQ'. */
  @ApiProperty({
    example: "NQ",
    description: "Prefix used for generating contract codes. For example, Nquado it is 'NQ'.",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  prefix: string;

  /** Structure definition for tenants within the product. */
  @ApiProperty({
    example: [{ name: "tenantId", type: "string", required: true }],
    description: "Structure definition for tenants within the product.",
    required: true,
    isArray: true,
    type: StructureField,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @IsNotEmpty()
  @Type(() => StructureField)
  tenantStructure: StructureField[];

  /** Structure definition for users within the product. */
  @ApiProperty({
    example: [{ name: "userId", type: "string", required: true }],
    description: "Structure definition for users within the product.",
    required: true,
    isArray: true,
    type: StructureField,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @IsNotEmpty()
  @Type(() => StructureField)
  userStructure: StructureField[];

  /** Cognito custom attributes for the product. */
  @ApiProperty({
    example: ["custom:attribute1", "custom:attribute2"],
    description: "Cognito custom attributes for the product.",
    required: true,
    isArray: true,
    type: String,
  })
  @IsArray()
  @IsNotEmpty()
  customAttributes: string[];

  /** Cognito roles attributes for the product. */
  @ApiProperty({
    example: ["admin", "user", "manager"],
    description: "Cognito roles attributes for the product.",
    required: true,
    isArray: true,
    type: String,
  })
  @IsArray()
  @IsNotEmpty()
  roles: string[];

  /** Default trial duration in days. Used when creating a trial without an explicit expiresAt. */
  @ApiPropertyOptional({
    example: 14,
    description: "Default trial duration in days. Used when creating a trial without an explicit expiresAt.",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  defaultTrialDuration?: number;

  /** Whether the product has a trials users limit. */
  @ApiProperty({
    description: "Whether the product has a trials users limit.",
    example: false,
    required: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  hasTrialsUsersLimit: boolean;

  /** Maximum number of users allowed for the product's trials. */
  @ApiPropertyOptional({
    description: "Maximum number of users allowed for the product's trials.",
    example: 50,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  trialsUsersLimit?: number;

  /** Value of the HubSpot "Soluzione d'interesse" deal property that marks the deals of the product. */
  @ApiPropertyOptional({
    example: "Genio",
    description: "Value of the HubSpot \"Soluzione d'interesse\" deal property that marks the deals of the product.",
    required: false,
  })
  @IsOptional()
  @IsString()
  hubspotSolution?: string;

  /** Name of the Intercom brand the conversations of the product come through. */
  @ApiPropertyOptional({
    example: "Genio",
    description: "Name of the Intercom brand the conversations of the product come through.",
    required: false,
  })
  @IsOptional()
  @IsString()
  intercomBrand?: string;

  /** Identifier of the Sentry project the errors of the product are sent to. */
  @ApiPropertyOptional({
    example: "4511292228632656",
    description: "Identifier of the Sentry project the errors of the product are sent to.",
    required: false,
  })
  @IsOptional()
  @IsString()
  sentryProjectId?: string;

  /** Public address Rocket calls every 15 minutes to tell whether the product answers. */
  @ApiPropertyOptional({
    example: "https://k3u7rke8d3.execute-api.eu-west-1.amazonaws.com/genio-core/health",
    description: "Public address Rocket calls every 15 minutes to tell whether the product answers.",
    required: false,
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'], require_tld: true })
  healthCheckUrl?: string;

  /** Stripe secret API key for the Stripe account dedicated to this product. */
  @ApiPropertyOptional({
    example: "sk_live_xxx",
    description: "Stripe secret API key for the Stripe account dedicated to this product.",
    required: false,
  })
  @IsOptional()
  @IsString()
  stripeApiKey?: string;

  /** Stripe webhook signing secret for the Stripe account dedicated to this product. */
  @ApiPropertyOptional({
    example: "whsec_xxx",
    description: "Stripe webhook signing secret for the Stripe account dedicated to this product.",
    required: false,
  })
  @IsOptional()
  @IsString()
  stripeWebhookSecret?: string;

  /** Stripe Tax Rate id applied to every line item of checkout sessions for this product. */
  @ApiPropertyOptional({
    example: "txr_xxx",
    description: "Stripe Tax Rate id applied to every line item of checkout sessions for this product.",
    required: false,
  })
  @IsOptional()
  @IsString()
  stripeTaxRateId?: string;

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
  })
  @IsOptional()
  @IsString()
  mixpanelProjectId?: string;

  /** Rules of the levers on which Rocket judges the tenants of the product, as many per lever as needed. */
  @ApiPropertyOptional({
    description: "Rules of the levers on which Rocket judges the tenants of the product, as many per lever as needed.",
    required: false,
    isArray: true,
    type: MixpanelLeverRule,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MixpanelLeverRule)
  mixpanelRules?: MixpanelLeverRule[];

}