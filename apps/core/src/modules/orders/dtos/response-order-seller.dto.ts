import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { ResellerContractMargin } from "../../reseller-contracts/classes/reseller-contract-margin.class";

/**
 * DTO returned for who sells to a company: what the order form needs to offer
 * the right products and cap the discounts, without reading the whole reseller.
 * `margin` is the purchase term of the reseller: it is left out for a reseller
 * salesperson, and when the reseller has no contract in force.
 */
export class ResponseOrderSellerDto {
  /** Sales channel of the orders of the company. */
  @ApiProperty({
    description: "Sales channel of the orders of the company.",
    enum: SalesChannel,
    example: SalesChannel.Reseller,
    required: true,
  })
  channel: SalesChannel;

  /** Identifier of the selling reseller, on the indirect channel. */
  @ApiPropertyOptional({
    description: "Identifier of the selling reseller, on the indirect channel.",
    example: "reseller-id-123",
    required: false,
  })
  resellerId?: string;

  /** Code of the selling reseller, on the indirect channel. */
  @ApiPropertyOptional({
    description: "Code of the selling reseller, on the indirect channel.",
    example: "RIV1",
    required: false,
  })
  resellerCode?: string;

  /** Company name of the selling reseller, on the indirect channel. */
  @ApiPropertyOptional({
    description: "Company name of the selling reseller, on the indirect channel.",
    example: "Computer Systems",
    required: false,
  })
  resellerName?: string;

  /** Products the selling reseller is enabled to sell, on the indirect channel; empty when it is enabled to none. */
  @ApiPropertyOptional({
    description: "Products the selling reseller is enabled to sell, on the indirect channel; empty when it is enabled to none.",
    type: [String],
    required: false,
  })
  productIds?: string[];

  /** Margin written in the contract in force of the selling reseller. */
  @ApiPropertyOptional({
    description: "Margin written in the contract in force of the selling reseller.",
    type: ResellerContractMargin,
    required: false,
  })
  @Type(() => ResellerContractMargin)
  margin?: ResellerContractMargin;
}
