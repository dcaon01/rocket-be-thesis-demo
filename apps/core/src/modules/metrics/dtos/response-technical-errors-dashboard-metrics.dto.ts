import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ResponseTechnicalErrorsPeriodRecordDto } from "./response-technical-errors-period-record.dto";
import { ResponseOpenAlertsDto } from "./response-open-alerts.dto";

/**
 * Response DTO for the errors and the alerts of the products (UR-RK-225), read from their Sentry projects: the counts
 * per period, and the alerts still open today.
 */
export class ResponseTechnicalErrorsDashboardMetricsDto {
  /** Errors and alerts fired per product and period. */
  @ApiProperty({
    type: [ResponseTechnicalErrorsPeriodRecordDto],
    description: "Errors and alerts fired per product and period.",
    required: true,
  })
  @Type(() => ResponseTechnicalErrorsPeriodRecordDto)
  records: ResponseTechnicalErrorsPeriodRecordDto[];

  /** Alerts still open today, per product. */
  @ApiProperty({
    type: [ResponseOpenAlertsDto],
    description: "Alerts still open today, per product.",
    required: true,
  })
  @Type(() => ResponseOpenAlertsDto)
  openAlerts: ResponseOpenAlertsDto[];
}
