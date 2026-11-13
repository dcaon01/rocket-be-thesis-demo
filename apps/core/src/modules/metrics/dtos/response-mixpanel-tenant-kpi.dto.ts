import { ApiExtraModels, ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ResponseLeverResultDto } from "../classes/response-lever-result.class";

/**
 * Per-tenant row returned by `GET /metrics/mixpanel/tenant-kpi`: how a customer tenant came out of the rules of
 * its product on the evaluation date (UR-RK-223). A lever is absent when its product has no rule for it, or when
 * the lever does not judge the tenant in the period (activation judges only the tenants whose first days ended in it).
 */
@ApiExtraModels(ResponseLeverResultDto)
export class ResponseMixpanelTenantKpiDto {
  /** Identifier of the tenant (matches the Mixpanel `tenant_id` super-property). */
  @ApiProperty({
    example: "tenant-123",
    description: "Identifier of the tenant (matches the Mixpanel tenant_id super-property).",
    required: true,
  })
  tenantId: string;

  /** Name of the tenant, from the rocket DB. */
  @ApiProperty({
    example: "Ossigeno S.r.l.",
    description: "Name of the tenant, from the rocket DB.",
    required: true,
  })
  tenantName: string;

  /** Identifier of the product the tenant belongs to. */
  @ApiProperty({
    example: "product-123",
    description: "Identifier of the product the tenant belongs to.",
    required: true,
  })
  productId: string;

  /** Code of the reseller that sold the tenant, absent on the direct channel. */
  @ApiPropertyOptional({
    example: "ACME",
    description: "Code of the reseller that sold the tenant, absent on the direct channel.",
    required: false,
  })
  resellerCode?: string;

  /** Outcome of the tenant on each lever that judges it. */
  @ApiProperty({
    description: "Outcome of the tenant on each lever that judges it.",
    type: [ResponseLeverResultDto],
    required: true,
  })
  levers: ResponseLeverResultDto[];
}
