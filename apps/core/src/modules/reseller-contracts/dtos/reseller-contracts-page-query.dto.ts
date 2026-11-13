import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { ResellerTier } from "../../resellers/enums/reseller-tier.enum";
import { ResellerContractStatus } from "../enums/reseller-contract-status.enum";

/**
 * Query of the reseller contract listing: a page and its filters.
 * No status means every status.
 */
export class ResellerContractsPageQueryDto extends PageQueryDto {
  /** Statuses to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Statuses to list, every status when absent.",
    enum: ResellerContractStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ResellerContractStatus, { each: true })
  status?: ResellerContractStatus[];

  /** Tiers to list, every tier when absent. */
  @ApiPropertyOptional({
    description: "Tiers to list, every tier when absent.",
    enum: ResellerTier,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ResellerTier, { each: true })
  tier?: ResellerTier[];

  /** Start of the contract code, reseller name or reseller code, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the contract code, reseller name or reseller code, case-insensitive.",
    example: "RVD-",
  })
  @IsOptional()
  @IsString()
  search?: string;
}
