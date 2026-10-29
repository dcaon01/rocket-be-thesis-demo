import { ApiProperty } from "@nestjs/swagger";

/**
 * Errors and alerts of the Sentry project of a product in a period, in the environment of this Rocket.
 */
export class ResponseTechnicalErrorsPeriodRecordDto {
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

  /** Error events of the period. */
  @ApiProperty({
    example: 42,
    description: "Error events of the period.",
    required: true,
  })
  errors: number;

  /** Issues first seen in the period: every threshold crossed in Sentry opens one. */
  @ApiProperty({
    example: 3,
    description: "Issues first seen in the period: every threshold crossed in Sentry opens one.",
    required: true,
  })
  alertsFired: number;
}
