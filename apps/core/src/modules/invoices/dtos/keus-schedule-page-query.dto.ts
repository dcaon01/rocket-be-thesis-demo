import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsDateString, IsEnum, IsOptional } from "class-validator";
import { ScheduleStatus } from "../enums/schedule-status.enum";
import { InvoiceFiltersPageQueryDto } from "./invoices-page-query.dto";

/**
 * Search of the schedule of Keus: the period of the due dates, the page and the filters. No status means every
 * status, expected payments included; a document status leaves the expected payments out, since they have none.
 */
export class KeusSchedulePageQueryDto extends InvoiceFiltersPageQueryDto {
  /** States of the payments to list, every state when absent. */
  @ApiPropertyOptional({
    description: "States of the payments to list, every state when absent.",
    enum: ScheduleStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ScheduleStatus, { each: true })
  status?: ScheduleStatus[];

  /** Start of the period of the due dates (ISO 8601). */
  @ApiProperty({
    description: "Start of the period of the due dates (ISO 8601).",
    example: "2026-09-30T22:00:00.000Z",
    required: true,
  })
  @IsDateString()
  from: string;

  /** End of the period (ISO 8601), at most 24 months after its start. */
  @ApiProperty({
    description: "End of the period (ISO 8601), at most 24 months after its start.",
    example: "2026-10-31T22:59:59.999Z",
    required: true,
  })
  @IsDateString()
  to: string;
}
