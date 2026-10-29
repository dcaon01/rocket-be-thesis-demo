import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { TenantStatus } from "../enums/tenant-status.enum";

/**
 * Query of the tenant listing of a product: a page and its filters.
 * No status means every status.
 */
export class TenantsPageQueryDto extends PageQueryDto {
  /** Statuses to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Statuses to list, every status when absent.",
    enum: TenantStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(TenantStatus, { each: true })
  status?: TenantStatus[];

  /** Start of the tenant name, contract code or trial email, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the tenant name, contract code or trial email, case-insensitive.",
    example: "Acme",
  })
  @IsOptional()
  @IsString()
  search?: string;
}
