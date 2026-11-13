import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Contracts and companies of a reseller for a product and a period (UR-RK-339): of the whole reseller and its subtree,
 * or of the orders a reseller salesperson opened. The record without `productId` counts every product together, so a
 * company on two products counts once in it; its contracts are the sum of the products.
 */
export class ResponseResellerOverviewPeriodRecordDto {
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

  /** Contracts in force at the end of the period, or now for the current one: the active licenses. */
  @ApiProperty({
    example: 40,
    description: "Contracts in force at the end of the period, or now for the current one: the active licenses.",
    required: true,
  })
  contractsInForce: number;

  /** Contracts started in the period: the new activations. */
  @ApiProperty({
    example: 3,
    description: "Contracts started in the period: the new activations.",
    required: true,
  })
  contractsStarted: number;

  /** Companies with a contract in force at the end of the period, or now for the current one: the customers served. */
  @ApiProperty({
    example: 25,
    description: "Companies with a contract in force at the end of the period, or now for the current one: the customers served.",
    required: true,
  })
  companiesInForce: number;

  /** Companies whose first contract with the reseller started in the period. */
  @ApiProperty({
    example: 2,
    description: "Companies whose first contract with the reseller started in the period.",
    required: true,
  })
  companiesNew: number;
}
