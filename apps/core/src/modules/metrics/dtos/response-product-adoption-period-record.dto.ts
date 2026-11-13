import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MixpanelLever } from "../../products/enums/mixpanel-lever.enum";

/**
 * How many tenants of a product and seller came out of the rules of a lever in each way in a period (UR-RK-223).
 * The share of compliant tenants is taken over the judged ones, with the not assessable ones counted apart; the risk
 * lever is read as the number of failing tenants (UR-RK-220).
 */
export class ResponseProductAdoptionPeriodRecordDto {
  /** Identifier of the product. */
  @ApiProperty({
    example: "product123",
    description: "Identifier of the product.",
    required: true,
  })
  productId: string;

  /** The period label (format: "YYYY-MM" for monthly, "YYYY" for annual). */
  @ApiProperty({
    example: "2026-03",
    description: "The period label (YYYY-MM for monthly, YYYY for annual).",
    required: true,
  })
  period: string;

  /** Code of the reseller that sold the tenants, absent on the direct channel. */
  @ApiPropertyOptional({
    example: "ACME",
    description: "Code of the reseller that sold the tenants, absent on the direct channel.",
    required: false,
  })
  resellerCode?: string;

  /** Lever the counts refer to. */
  @ApiProperty({
    example: MixpanelLever.Operational,
    description: "Lever the counts refer to.",
    enum: MixpanelLever,
    required: true,
  })
  lever: MixpanelLever;

  /** Tenants on the good side of the green threshold. */
  @ApiProperty({
    example: 12,
    description: "Tenants on the good side of the green threshold.",
    required: true,
  })
  compliant: number;

  /** Tenants past the green threshold, within the yellow one. */
  @ApiProperty({
    example: 3,
    description: "Tenants past the green threshold, within the yellow one.",
    required: true,
  })
  atRisk: number;

  /** Tenants past the yellow threshold. */
  @ApiProperty({
    example: 1,
    description: "Tenants past the yellow threshold.",
    required: true,
  })
  failing: number;

  /** Tenants the rule could not judge, counted apart from the share of compliant ones. */
  @ApiProperty({
    example: 2,
    description: "Tenants the rule could not judge, counted apart from the share of compliant ones.",
    required: true,
  })
  notAssessable: number;

  /** Tenants measured by a rule still in observation. */
  @ApiProperty({
    example: 0,
    description: "Tenants measured by a rule still in observation.",
    required: true,
  })
  observed: number;
}
