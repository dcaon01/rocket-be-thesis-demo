import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ResponseResellerRenewalDto } from "./response-reseller-renewal.dto";
import { ResponseCustomerFollowUpDto } from "./response-customer-follow-up.dto";
import { ResponseResellerOpportunityDto } from "./response-reseller-opportunity.dto";

/**
 * Today's work of a reseller on its dashboard (UR-RK-339), computed when read and never stored: the orders in
 * progress, the renewals coming, the customers at risk and the opportunities, of the whole reseller and its subtree or
 * of the orders a reseller salesperson opened. The risk read from the product metrics is `metrics/mixpanel/tenant-kpi`.
 */
export class ResponseResellerWorklistDto {
  /** Orders whose offer went to the customer, waiting for its acceptance. */
  @ApiProperty({
    example: 3,
    description: "Orders whose offer went to the customer, waiting for its acceptance.",
    required: true,
  })
  ordersSent: number;

  /** Orders whose signed offer was uploaded, waiting for the confirmation of Keus. */
  @ApiProperty({
    example: 1,
    description: "Orders whose signed offer was uploaded, waiting for the confirmation of Keus.",
    required: true,
  })
  ordersAccepted: number;

  /** Orders confirmed with some line still to provision. */
  @ApiProperty({
    example: 2,
    description: "Orders confirmed with some line still to provision.",
    required: true,
  })
  ordersConfirmed: number;

  /** Contracts renewing in the next 90 days, the nearest first. */
  @ApiProperty({
    type: [ResponseResellerRenewalDto],
    description: "Contracts renewing in the next 90 days, the nearest first.",
    required: true,
  })
  @Type(() => ResponseResellerRenewalDto)
  renewals: ResponseResellerRenewalDto[];

  /** Customers at risk: contracts cancelled and not ended yet, and access suspended, by date. */
  @ApiProperty({
    type: [ResponseCustomerFollowUpDto],
    description: "Customers at risk: contracts cancelled and not ended yet, and access suspended, by date.",
    required: true,
  })
  @Type(() => ResponseCustomerFollowUpDto)
  atRisk: ResponseCustomerFollowUpDto[];

  /** Customers with room to grow. */
  @ApiProperty({
    type: [ResponseResellerOpportunityDto],
    description: "Customers with room to grow.",
    required: true,
  })
  @Type(() => ResponseResellerOpportunityDto)
  opportunities: ResponseResellerOpportunityDto[];
}
