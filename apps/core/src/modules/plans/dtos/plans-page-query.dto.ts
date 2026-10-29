import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { PlanAudience } from "../enums/plan-audience.enum";
import { PlanStatus } from "../enums/plan-status.enum";

/**
 * Query of the plan listing: a page and its filters.
 * No status means every status, and no audience every audience.
 */
export class PlansPageQueryDto extends PageQueryDto {
  /** Statuses to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Statuses to list, every status when absent.",
    enum: PlanStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(PlanStatus, { each: true })
  status?: PlanStatus[];

  /** Audience of the plans to list, every audience when absent. */
  @ApiPropertyOptional({
    description: "Audience of the plans to list, every audience when absent.",
    enum: PlanAudience,
  })
  @IsOptional()
  @IsEnum(PlanAudience)
  audience?: PlanAudience;

  /** Start of the plan name, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the plan name, case-insensitive.",
    example: "Pro",
  })
  @IsOptional()
  @IsString()
  name?: string;
}
