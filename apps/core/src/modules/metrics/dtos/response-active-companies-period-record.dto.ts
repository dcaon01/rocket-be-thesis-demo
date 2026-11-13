import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Active companies of a product and a period (UR-RK-001, UR-RK-235): the companies with at least one contract in force,
 * on both channels. The record without `productId` counts every product together, so a company on two products
 * counts once in it.
 */
export class ResponseActiveCompaniesPeriodRecordDto {
  /** Identifier of the product, absent on the record of every product together. */
  @ApiPropertyOptional({
    example: "product123",
    description: "Identifier of the product, absent on the record of every product together.",
    required: false,
  })
  productId?: string;

  /** The period label (format: "YYYY-MM" for monthly, "YYYY" for annual). */
  @ApiProperty({
    example: "2026-03",
    description: "The period label (YYYY-MM for monthly, YYYY for annual).",
    required: true,
  })
  period: string;

  /** Companies with a contract in force at the end of the period, or now for the current one. */
  @ApiProperty({
    example: 120,
    description: "Companies with a contract in force at the end of the period, or now for the current one.",
    required: true,
  })
  companiesInForce: number;
}
