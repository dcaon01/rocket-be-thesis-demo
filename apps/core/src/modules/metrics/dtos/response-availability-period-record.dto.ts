import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Availability of a product in a period, from the checks of Rocket every 15 minutes: an outage shorter than that may
 * not appear. Times are kept as seconds, so the frontend computes the availability across products and months
 * without averaging percentages. Calls and latency come from API Gateway on CloudWatch, and are absent for a product
 * whose health address is not an `execute-api` one.
 */
export class ResponseAvailabilityPeriodRecordDto {
  /** Identifier of the product. */
  @ApiProperty({
    example: "product123",
    description: "Identifier of the product.",
    required: true,
  })
  productId: string;

  /** The period label (format: "YYYY-MM" for monthly, "YYYY" for annual). */
  @ApiProperty({
    example: "2026-10",
    description: "The period label (YYYY-MM for monthly, YYYY for annual).",
    required: true,
  })
  period: string;

  /** Seconds of the period the product was checked. */
  @ApiProperty({
    example: 2592000,
    description: "Seconds of the period the product was checked.",
    required: true,
  })
  observedSeconds: number;

  /** Seconds of the period the product was down. */
  @ApiProperty({
    example: 1800,
    description: "Seconds of the period the product was down.",
    required: true,
  })
  downtimeSeconds: number;

  /** Outages that touched the period. */
  @ApiProperty({
    example: 1,
    description: "Outages that touched the period.",
    required: true,
  })
  outages: number;

  /** Calls the API of the product received in the period. */
  @ApiPropertyOptional({
    example: 120000,
    description: "Calls the API of the product received in the period.",
    required: false,
  })
  requests?: number;

  /** Median latency of the calls, in milliseconds; for a year, the months weighted by their calls. */
  @ApiPropertyOptional({
    example: 85,
    description: "Median latency of the calls, in milliseconds; for a year, the months weighted by their calls.",
    required: false,
  })
  latencyP50Ms?: number;

  /** 95th percentile of the latency of the calls, in milliseconds; for a year, the months weighted by their calls. */
  @ApiPropertyOptional({
    example: 420,
    description: "95th percentile of the latency of the calls, in milliseconds; for a year, the months weighted by their calls.",
    required: false,
  })
  latencyP95Ms?: number;
}
