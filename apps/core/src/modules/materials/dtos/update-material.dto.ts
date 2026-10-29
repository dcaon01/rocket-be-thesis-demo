import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl } from "class-validator";
import { ResellerTier } from "../../resellers/enums/reseller-tier.enum";

/** DTO used to update a material; type and state are not changed here. */
export class UpdateMaterialDto {
  /** Title shown in the listing. */
  @ApiPropertyOptional({
    description: "Title shown in the listing.",
    example: "Catalogo Nquadro 2026",
    required: false,
  })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  title?: string;

  /** Short description of what the material is for. */
  @ApiPropertyOptional({
    description: "Short description of what the material is for.",
    required: false,
  })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  description?: string;

  /** Products the material is assigned to. Empty means every product. */
  @ApiPropertyOptional({
    description: "Products the material is assigned to. Empty means every product.",
    example: ["product-id-123"],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];

  /** Reseller tiers the material is available to. Empty means every tier. */
  @ApiPropertyOptional({
    description: "Reseller tiers the material is available to. Empty means every tier.",
    enum: ResellerTier,
    isArray: true,
    example: [ResellerTier.Gold],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ResellerTier, { each: true })
  resellerTiers?: ResellerTier[];

  /** S3 key of the uploaded file, under `materials/{id}/`. Not for the EXTERNAL_LINK materials. */
  @ApiPropertyOptional({
    description: "S3 key of the uploaded file, under materials/{id}/. Not for the EXTERNAL_LINK materials.",
    example: "materials/material-id-123/catalogo.pdf",
    required: false,
  })
  @IsOptional()
  @IsString()
  fileS3Key?: string;

  /** External address. Only for the EXTERNAL_LINK materials. */
  @ApiPropertyOptional({
    description: "External address. Only for the EXTERNAL_LINK materials.",
    required: false,
  })
  @IsOptional()
  @IsUrl()
  externalUrl?: string;
}
