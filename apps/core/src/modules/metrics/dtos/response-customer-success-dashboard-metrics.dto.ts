import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ResponseCustomerSuccessPeriodRecordDto } from "./response-customer-success-period-record.dto";
import { ResponseCustomerFollowUpDto } from "./response-customer-follow-up.dto";

/**
 * Response DTO for the customer success metrics (UR-RK-221), computed from the contracts and the order lines of every
 * product: the counts per period, and the customers to follow up today.
 */
export class ResponseCustomerSuccessDashboardMetricsDto {
  /** Counts per product, period and seller, most recent period first. */
  @ApiProperty({
    type: [ResponseCustomerSuccessPeriodRecordDto],
    description: "Counts per product, period and seller, most recent period first.",
    required: true,
  })
  @Type(() => ResponseCustomerSuccessPeriodRecordDto)
  records: ResponseCustomerSuccessPeriodRecordDto[];

  /** Customers to follow up today, by date. */
  @ApiProperty({
    type: [ResponseCustomerFollowUpDto],
    description: "Customers to follow up today, by date.",
    required: true,
  })
  @Type(() => ResponseCustomerFollowUpDto)
  followUps: ResponseCustomerFollowUpDto[];
}
