import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Response DTO for a record of the revenue of a reseller: what it bills its customers for one product in a month or
 * a year, what it spends with Keus and what it margins on it. The record with no product carries the fee too.
 */
export class ResponseResellerRevenueDashboardMetricsRecordDto {
  /** Identifier of the record: product and month index. */
  @ApiProperty({
    example: "product123#2026-10",
    description: "Identifier of the record: product and month index.",
    required: true,
  })
  id: string;

  /** Product billed; absent on the reseller's own items and the fee, which belong to no product. */
  @ApiPropertyOptional({
    example: "product123",
    description: "Product billed; absent on the reseller's own items and the fee, which belong to no product.",
    required: false,
  })
  productId?: string;

  /** Month index (format: "YYYY-MM"), or the year ("YYYY") in annual mode. */
  @ApiProperty({
    example: "2026-10",
    description: "Month index (format: YYYY-MM), or the year (YYYY) in annual mode.",
    required: true,
  })
  monthIndex: string;

  /** What the reseller bills its customers in cents, net of VAT: every due date of the period, collected or not. */
  @ApiProperty({
    example: 15000,
    description: "What the reseller bills its customers in cents, net of VAT: every due date of the period, collected or not.",
    required: true,
  })
  revenue: number;

  /** What Keus bills the reseller in cents, net of VAT: the cost of the licenses and, with no product, the fee; absent for a reseller salesperson. */
  @ApiPropertyOptional({
    example: 10500,
    description: "What Keus bills the reseller in cents, net of VAT: the cost of the licenses and, with no product, the fee; absent for a reseller salesperson.",
    required: false,
  })
  expenses?: number;

  /** Revenue minus expenses in cents, negative when the reseller spends more than it bills; absent for a reseller salesperson. */
  @ApiPropertyOptional({
    example: 4500,
    description: "Revenue minus expenses in cents, negative when the reseller spends more than it bills; absent for a reseller salesperson.",
    required: false,
  })
  margin?: number;
}
