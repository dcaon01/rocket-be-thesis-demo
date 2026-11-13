import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Counts of the Rocket half of the sales metrics (UR-RK-222) for a product, a period and a seller: the frontend sums
 * numerators and denominators across products and sellers, since a rate is not the mean of the rates. The record
 * without `productId` counts every product together, so an order on two products counts once in it.
 */
export class ResponseSalesOrdersPeriodRecordDto {
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

  /** Code of the reseller that sold, absent on the direct channel. */
  @ApiPropertyOptional({
    example: "ACME",
    description: "Code of the reseller that sold, absent on the direct channel.",
    required: false,
  })
  resellerCode?: string;

  /** Name of the reseller that sold, absent on the direct channel. */
  @ApiPropertyOptional({
    example: "Acme S.r.l.",
    description: "Name of the reseller that sold, absent on the direct channel.",
    required: false,
  })
  resellerName?: string;

  /** Orders requested in the period, drafts included and transfers between channels excluded. */
  @ApiProperty({
    example: 12,
    description: "Orders requested in the period, drafts included and transfers between channels excluded.",
    required: true,
  })
  ordersRequested: number;

  /** Orders requested in the period that are still open today: the backlog, over `ordersRequested`. */
  @ApiProperty({
    example: 3,
    description: "Orders requested in the period that are still open today: the backlog, over ordersRequested.",
    required: true,
  })
  ordersOpen: number;

  /** Trials closed in the period, expired, cancelled or converted: the denominator of the conversion rate. */
  @ApiProperty({
    example: 10,
    description: "Trials closed in the period, expired, cancelled or converted: the denominator of the conversion rate.",
    required: true,
  })
  trialsClosed: number;

  /** Trials converted in the period into an order line on their tenant. */
  @ApiProperty({
    example: 4,
    description: "Trials converted in the period into an order line on their tenant.",
    required: true,
  })
  trialsConverted: number;

  /** Contracts started in the period: the licenses activated, transfers between channels excluded. */
  @ApiProperty({
    example: 7,
    description: "Contracts started in the period: the licenses activated, transfers between channels excluded.",
    required: true,
  })
  contractsStarted: number;

  /** Order lines provisioned in the period whose order has a confirmation date: the denominator of the provisioning time. */
  @ApiProperty({
    example: 6,
    description: "Order lines provisioned in the period whose order has a confirmation date: the denominator of the provisioning time.",
    required: true,
  })
  provisionedTimed: number;

  /** Days from the confirmation of the order to the delivery of the credentials, summed over those lines. */
  @ApiProperty({
    example: 15.5,
    description: "Days from the confirmation of the order to the delivery of the credentials, summed over those lines.",
    required: true,
  })
  provisioningDaysTotal: number;
}
