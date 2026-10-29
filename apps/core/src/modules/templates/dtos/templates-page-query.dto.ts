import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { TemplateStatus } from "../enums/template-status.enum";
import { TemplateType } from "../enums/template-type.enum";

/**
 * Query of the templates: a page and its filters.
 * No type means every type, no status every status.
 */
export class TemplatesPageQueryDto extends PageQueryDto {
  /** Types to list, every type when absent. */
  @ApiPropertyOptional({
    description: "Types to list, every type when absent.",
    enum: TemplateType,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(TemplateType, { each: true })
  type?: TemplateType[];

  /** Statuses to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Statuses to list, every status when absent.",
    enum: TemplateStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(TemplateStatus, { each: true })
  status?: TemplateStatus[];

  /** Start of the template name, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the template name, case-insensitive.",
    example: "Offerta",
  })
  @IsOptional()
  @IsString()
  name?: string;
}
