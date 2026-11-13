import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Counts of the customer success metrics for a product, a period and a seller: the frontend sums numerators and
 * denominators across products and sellers, since a churn rate is not the mean of the rates.
 */
export class ResponseCustomerSuccessPeriodRecordDto {
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

  /** Code of the reseller that sold the contracts, absent on the direct channel. */
  @ApiPropertyOptional({
    example: "ACME",
    description: "Code of the reseller that sold the contracts, absent on the direct channel.",
    required: false,
  })
  resellerCode?: string;

  /** Contracts in force on the first day of the period: the denominator of the churn rate. */
  @ApiProperty({
    example: 40,
    description: "Contracts in force on the first day of the period: the denominator of the churn rate.",
    required: true,
  })
  inForceAtStart: number;

  /**
   * Contracts terminated in the period that left their tenant with no contract: the numerator of the churn rate. A
   * transfer of channel, or a contract followed by a newer one on the same tenant, is no loss.
   */
  @ApiProperty({
    example: 2,
    description: "Contracts terminated in the period that left their tenant with no contract: the numerator of the churn rate. A transfer of channel, or a contract followed by a newer one on the same tenant, is no loss.",
    required: true,
  })
  terminated: number;

  /** Order lines whose credentials were delivered in the period. */
  @ApiProperty({
    example: 5,
    description: "Order lines whose credentials were delivered in the period.",
    required: true,
  })
  provisioned: number;

  /** Order lines whose first access happened in the period. */
  @ApiProperty({
    example: 4,
    description: "Order lines whose first access happened in the period.",
    required: true,
  })
  activated: number;

  /** Days from the credentials to the first access, summed over the lines activated in the period. */
  @ApiProperty({
    example: 9.5,
    description: "Days from the credentials to the first access, summed over the lines activated in the period.",
    required: true,
  })
  activationDaysTotal: number;
}
