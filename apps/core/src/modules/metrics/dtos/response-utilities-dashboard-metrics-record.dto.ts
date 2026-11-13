import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MetricsLogic } from "../enums/metrics-logic.enum";

/**
 * Response DTO for utilities dashboard metrics record.
 */
export class ResponseUtilitiesDashboardMetricsRecordDto {
  /** Identifier of the product. */
  @ApiProperty({
    example: "product123",
    description: "Identifier of the product.",
    required: true,
  })
  productId: string;

  /** Unique identifier for the utilities dashboard metrics record. */
  @ApiProperty({
    example: "record123",
    description: "Unique identifier for the utilities dashboard metrics record.",
    required: true,
  })
  id: string;

  /** Month index for metrics queries (format: "YYYY-MM"). */
  @ApiProperty({
    example: "2026-03",
    description: "The month index (format: YYYY-MM).",
    required: true,
  })
  monthIndex: string;

  /** Number of users. */
  @ApiProperty({
    example: 150,
    description: "Number of users.",
    required: true,
  })
  users: number;

  /** Number of trials. */
  @ApiProperty({
    example: 30,
    description: "Number of trials.",
    required: true,
  })
  trials: number;

  /** Number of contracts. */
  @ApiProperty({
    example: 45,
    description: "Number of contracts.",
    required: true,
  })
  contracts: number;

  /** Number of tenants. */
  @ApiProperty({
    example: 20,
    description: "Number of tenants.",
    required: true,
  })
  tenants: number;

  /** Logic type for the metric (activated or active). */
  @ApiProperty({
    example: "ACTIVATED",
    description: "Logic type for the metric (activated or active).",
    required: true,
    enum: MetricsLogic,
  })
  logic: MetricsLogic;

  /** Reseller lineage of this record. Absent = global Keus record; present = reseller subtree total. */
  @ApiPropertyOptional({
    example: "RVD-001#RVD-002#",
    description: "Reseller lineage of this record. Absent on the global Keus record; set to the reseller's path on a reseller-scoped result.",
    required: false,
  })
  resellerPath?: string;
}
