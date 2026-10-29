import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Response DTO for sales dashboard metrics.
 * Contains all sales-related metrics computed from HubSpot deal data.
 */
export class ResponseSalesDashboardMetricsDto {
  /** The solution of interest these metrics refer to, absent for the whole products pipeline. */
  @ApiPropertyOptional({
    example: "Genio",
    description: "The solution of interest these metrics refer to, absent for the whole products pipeline.",
    required: false,
  })
  solution?: string;

  /** The period label (format: "YYYY-MM" for monthly, "YYYY" for annual). */
  @ApiProperty({
    example: "2026-03",
    description: "The period label (YYYY-MM for monthly, YYYY for annual).",
    required: true,
  })
  period: string;

  /** Number of deals created in this period. */
  @ApiProperty({
    example: 15,
    description: "Number of deals created in this period.",
    required: true,
  })
  dealsCreated: number;

  /** Number of deals won (closed-won) in this period. */
  @ApiProperty({
    example: 8,
    description: "Number of deals won (closed-won) in this period.",
    required: true,
  })
  dealsWon: number;

  /** Win rate: percentage of closed deals that were won (won / (won + lost) * 100). */
  @ApiProperty({
    example: 66.7,
    description: "Win rate as a percentage (won / total closed * 100). Null if no deals were closed.",
    required: false,
  })
  winRate: number | null;

  /** Average deal age in days (from creation to close, for closed-won deals). */
  @ApiProperty({
    example: 23.5,
    description: "Average deal age in days from creation to close for won deals. Null if no won deals in this period.",
    required: false,
  })
  averageDealAgeDays: number | null;

  /** Total value of deals currently in trial stage, in cents. */
  @ApiProperty({
    example: 50000,
    description: "Total value of active trial deals in cents.",
    required: true,
  })
  activeTrialsValue: number;

  /** Sum of `amount` (in cents) of deals closed-won within this period. The frontend uses this to compute MRR (monthly period) or ARR (annual period). */
  @ApiProperty({
    example: 120000,
    description: "Sum of amounts (in cents) of deals closed-won within this period. Used by the frontend to compute MRR/ARR.",
    required: true,
  })
  closedWonRevenue: number;

  /** Number of deals won broken down by quarter. */
  @ApiProperty({
    example: { Q1: 5, Q2: 3, Q3: 0, Q4: 0 },
    description: "Number of deals won per quarter within this period.",
    required: true,
  })
  dealsWonByQuarter: Record<string, number>;
}
