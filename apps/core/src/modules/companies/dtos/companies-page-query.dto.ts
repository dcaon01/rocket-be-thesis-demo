import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { CompanyStatus } from "../enums/company-status.enum";
import { SalesChannel } from "../enums/sales-channel.enum";

/**
 * Query of the company listing: a page and its filters.
 * No status means every status.
 */
export class CompaniesPageQueryDto extends PageQueryDto {
  /** Statuses to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Statuses to list, every status when absent.",
    enum: CompanyStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(CompanyStatus, { each: true })
  status?: CompanyStatus[];

  /** Reseller whose companies to list, for a collaborator previewing its workspace. Ignored for resellers, who always get their own. */
  @ApiPropertyOptional({
    description: "Reseller whose companies to list, for a collaborator previewing its workspace. Ignored for resellers, who always get their own.",
    example: "RVD-001",
  })
  @IsOptional()
  @IsString()
  resellerCode?: string;

  /** Channel of the companies to list, every channel when absent: the direct one for a Keus salesperson's orders. */
  @ApiPropertyOptional({
    description: "Channel of the companies to list, every channel when absent: the direct one for a Keus salesperson's orders.",
    enum: SalesChannel,
    example: SalesChannel.Direct,
  })
  @IsOptional()
  @IsEnum(SalesChannel)
  channel?: SalesChannel;

  /** Start of the company name or VAT number, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the company name or VAT number, case-insensitive.",
    example: "Acme",
  })
  @IsOptional()
  @IsString()
  name?: string;

  /** Start of the company email, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the company email, case-insensitive.",
    example: "info@",
  })
  @IsOptional()
  @IsString()
  email?: string;
}
