import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsIn, IsISO8601, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { TrialStatus } from "../enums/trial-status.enum";

/**
 * Query of the trial listing of a product: a page and its filters.
 * No status means every status.
 */
export class TrialsPageQueryDto extends PageQueryDto {
  /** Statuses to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Statuses to list, every status when absent.",
    enum: TrialStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(TrialStatus, { each: true })
  status?: TrialStatus[];

  /** Start of the associated email, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the associated email, case-insensitive.",
    example: "mario",
  })
  @IsOptional()
  @IsString()
  search?: string;

  /** Date the period applies to. */
  @ApiPropertyOptional({
    description: "Date the period applies to.",
    enum: ["activatedAt", "expiresAt"],
  })
  @IsOptional()
  @IsIn(["activatedAt", "expiresAt"])
  dateField?: "activatedAt" | "expiresAt";

  /** First instant of the period (ISO 8601). */
  @ApiPropertyOptional({
    description: "First instant of the period (ISO 8601).",
    example: "2026-10-01T00:00:00.000Z",
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Last instant of the period (ISO 8601). */
  @ApiPropertyOptional({
    description: "Last instant of the period (ISO 8601).",
    example: "2026-10-31T23:59:59.999Z",
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
