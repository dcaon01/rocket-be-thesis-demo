import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { ResellerTier } from "../../resellers/enums/reseller-tier.enum";
import { MaterialType } from "../enums/material-type.enum";

/** Query of the materials a reseller can see: a page and its filters. */
export class AvailableMaterialsPageQueryDto extends PageQueryDto {
  /** Product to filter on, any when absent. */
  @ApiPropertyOptional({
    description: "Product to filter on, any when absent.",
  })
  @IsOptional()
  @IsString()
  productId?: string;

  /** Tier to preview. Honoured for Keus collaborators only: a reseller always gets its own. */
  @ApiPropertyOptional({
    description: "Tier to preview. Honoured for Keus collaborators only: a reseller always gets its own.",
    enum: ResellerTier,
  })
  @IsOptional()
  @IsEnum(ResellerTier)
  tier?: ResellerTier;

  /** Reseller whose shelf to preview, with its tier and enabled products. Honoured for Keus collaborators only, and wins over the tier. */
  @ApiPropertyOptional({
    description: "Reseller whose shelf to preview, with its tier and enabled products. Honoured for Keus collaborators only, and wins over the tier.",
  })
  @IsOptional()
  @IsString()
  resellerId?: string;

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
}
