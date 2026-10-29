import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { ResellerStatus } from "../enums/reseller-status.enum";

/**
 * Query of the reseller listing: a page and its filters.
 * No status means every status.
 */
export class ResellersPageQueryDto extends PageQueryDto {
  /** Statuses to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Statuses to list, every status when absent.",
    enum: ResellerStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ResellerStatus, { each: true })
  status?: ResellerStatus[];

  /** Start of the reseller company name, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the reseller company name, case-insensitive.",
    example: "Acme",
  })
  @IsOptional()
  @IsString()
  companyName?: string;

  /** Start of the reseller email, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the reseller email, case-insensitive.",
    example: "info@",
  })
  @IsOptional()
  @IsString()
  email?: string;
}
