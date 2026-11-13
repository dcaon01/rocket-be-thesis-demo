import { ApiProperty } from "@nestjs/swagger";

/**
 * Response DTO for revenue dashboard metrics record.
 */
export class ResponseRevenueDashboardMetricsRecordDto {
  /** Identifier of the product, or `RESELLER_FEES` for the fees of the resellers. */
  @ApiProperty({
    example: "product123",
    description: "Identifier of the product, or RESELLER_FEES for the fees of the resellers.",
    required: true,
  })
  productId: string;

  /** Unique identifier for the revenue dashboard metrics record. */
  @ApiProperty({
    example: "record123",
    description: "Unique identifier for the revenue dashboard metrics record.",
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

  /** Revenue value in cents: the items of the paid invoices of the month, net of taxes. */
  @ApiProperty({
    example: 15000,
    description: "Revenue value in cents: the items of the paid invoices of the month, net of taxes.",
    required: true,
  })
  revenue: number;
}
