import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { ResellerTier } from "../../resellers/enums/reseller-tier.enum";
import { MaterialStatus } from "../enums/material-status.enum";
import { MaterialType } from "../enums/material-type.enum";

/**
 * Query of the material catalogue: a page and its filters.
 * No status means every status; an empty list of products or tiers on a
 * material means every one.
 */
export class MaterialsPageQueryDto extends PageQueryDto {
  /** Statuses to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Statuses to list, every status when absent.",
    enum: MaterialStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(MaterialStatus, { each: true })
  status?: MaterialStatus[];

  /** Start of the title, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the title, case-insensitive.",
    example: "Brochure",
  })
  @IsOptional()
  @IsString()
  search?: string;

  /** Types of material to list, every type when absent. */
  @ApiPropertyOptional({
    description: "Types of material to list, every type when absent.",
    enum: MaterialType,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(MaterialType, { each: true })
  type?: MaterialType[];

  /** Product the material must be assigned to, any when absent. */
  @ApiPropertyOptional({
    description: "Product the material must be assigned to, any when absent.",
  })
  @IsOptional()
  @IsString()
  productId?: string;

  /** Reseller tiers the material must be assigned to, at least one of them; any when absent. */
  @ApiPropertyOptional({
    description: "Reseller tiers the material must be assigned to, at least one of them; any when absent.",
    enum: ResellerTier,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ResellerTier, { each: true })
  tier?: ResellerTier[];
}
