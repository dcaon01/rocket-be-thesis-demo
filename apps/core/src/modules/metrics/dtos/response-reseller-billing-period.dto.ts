import { ApiProperty } from "@nestjs/swagger";

/**
 * What Keus invoiced a reseller in a period (UR-RK-339), void invoices left out.
 */
export class ResponseResellerBillingPeriodDto {
  /** The period label (format: "YYYY-MM" for monthly, "YYYY" for annual). */
  @ApiProperty({
    example: "2026-03",
    description: "The period label (YYYY-MM for monthly, YYYY for annual).",
    required: true,
  })
  period: string;

  /** Invoices issued in the period. */
  @ApiProperty({
    example: 4,
    description: "Invoices issued in the period.",
    required: true,
  })
  issuedCount: number;

  /** Total of the invoices issued in the period, in cents, taxes included. */
  @ApiProperty({
    example: 120000,
    description: "Total of the invoices issued in the period, in cents, taxes included.",
    required: true,
  })
  issuedCents: number;
}
