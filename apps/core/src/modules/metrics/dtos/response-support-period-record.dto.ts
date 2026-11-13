import { ApiProperty } from "@nestjs/swagger";

/**
 * Counts of the support conversations of a product in a period. Times are kept as sums and counts, so the frontend
 * averages across products without averaging averages.
 */
export class ResponseSupportPeriodRecordDto {
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

  /** Conversations opened in the period. */
  @ApiProperty({
    example: 12,
    description: "Conversations opened in the period.",
    required: true,
  })
  opened: number;

  /** Conversations closed for the first time in the period. */
  @ApiProperty({
    example: 10,
    description: "Conversations closed for the first time in the period.",
    required: true,
  })
  closed: number;

  /** Seconds to the first reply, summed over the conversations opened in the period that got one. */
  @ApiProperty({
    example: 36000,
    description: "Seconds to the first reply, summed over the conversations opened in the period that got one.",
    required: true,
  })
  firstResponseSecondsTotal: number;

  /** Conversations opened in the period that got a first reply. */
  @ApiProperty({
    example: 11,
    description: "Conversations opened in the period that got a first reply.",
    required: true,
  })
  firstResponseCount: number;

  /** Seconds from the opening to the first close, summed over the conversations closed in the period. */
  @ApiProperty({
    example: 864000,
    description: "Seconds from the opening to the first close, summed over the conversations closed in the period.",
    required: true,
  })
  resolutionSecondsTotal: number;
}
