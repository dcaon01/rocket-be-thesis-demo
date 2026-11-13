import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { ScheduleDirection } from "../enums/schedule-direction.enum";

/**
 * Filters every listing of the due dates of a reseller shares: a period of due dates, at most 24 months, the page, the
 * direction and the search. No direction means both.
 */
export class ResellerDuesPageQueryDto extends PageQueryDto {
  /** Start of the period of the due dates (ISO 8601). */
  @ApiProperty({
    description: "Start of the period of the due dates (ISO 8601).",
    example: "2026-09-30T22:00:00.000Z",
    required: true,
  })
  @IsDateString()
  from: string;

  /** End of the period of the due dates (ISO 8601), at most 24 months after its start. */
  @ApiProperty({
    description: "End of the period of the due dates (ISO 8601), at most 24 months after its start.",
    example: "2026-10-31T22:59:59.999Z",
    required: true,
  })
  @IsDateString()
  to: string;

  /** Which way the money goes, both when absent. */
  @ApiPropertyOptional({
    description: "Which way the money goes, both when absent.",
    enum: ScheduleDirection,
    required: false,
  })
  @IsOptional()
  @IsIn(Object.values(ScheduleDirection))
  direction?: ScheduleDirection;

  /** Start of the name of the customer, of the code of the contract or of the description, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the name of the customer, of the code of the contract or of the description, case-insensitive.",
    example: "ACME",
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;
}

/** Query of the schedule of a reseller: the shared filters and whether the entries are settled. */
export class ResellerSchedulePageQueryDto extends ResellerDuesPageQueryDto {
  /** False for the entries still open, the expected ones included, true for the settled ones (invoices of Keus paid, due dates of the customers collected), all when absent. */
  @ApiPropertyOptional({
    description: "False for the entries still open, the expected ones included, true for the settled ones (invoices of Keus paid, due dates of the customers collected), all when absent.",
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  settled?: boolean;
}

/** Query of the invoices of a reseller: the shared filters and whether the entries are settled. */
export class ResellerInvoicesPageQueryDto extends ResellerDuesPageQueryDto {
  /** False for the invoices of Keus still open, true for the settled entries (invoices of Keus paid, due dates of the customers collected), all when absent. */
  @ApiPropertyOptional({
    description: "False for the invoices of Keus still open, true for the settled entries (invoices of Keus paid, due dates of the customers collected), all when absent.",
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  settled?: boolean;
}
