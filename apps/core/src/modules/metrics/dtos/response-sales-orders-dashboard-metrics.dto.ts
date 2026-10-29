import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ResponseSalesOrdersPeriodRecordDto } from "./response-sales-orders-period-record.dto";
import { ResponseSalesActiveTrialsDto } from "./response-sales-active-trials.dto";

/**
 * Response DTO for the Rocket half of the sales metrics (UR-RK-222), apart from the HubSpot one so that HubSpot does
 * not hold it back: the counts per period, and the trials active today.
 */
export class ResponseSalesOrdersDashboardMetricsDto {
  /** Counts per product, period and seller, most recent period first. */
  @ApiProperty({
    type: [ResponseSalesOrdersPeriodRecordDto],
    description: "Counts per product, period and seller, most recent period first.",
    required: true,
  })
  @Type(() => ResponseSalesOrdersPeriodRecordDto)
  records: ResponseSalesOrdersPeriodRecordDto[];

  /** Trials active today, per product and seller. */
  @ApiProperty({
    type: [ResponseSalesActiveTrialsDto],
    description: "Trials active today, per product and seller.",
    required: true,
  })
  @Type(() => ResponseSalesActiveTrialsDto)
  activeTrials: ResponseSalesActiveTrialsDto[];
}
