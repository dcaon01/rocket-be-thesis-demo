import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl } from "class-validator";
import { ResellerTier } from "../../resellers/enums/reseller-tier.enum";
import { MaterialType } from "../enums/material-type.enum";

/** DTO used to create a material in DRAFT; the file is attached later with an update. */
export class CreateMaterialDto {
  /** Title shown in the listing. */
  @ApiProperty({
    description: "Title shown in the listing.",
    example: "Catalogo Nquadro 2026",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  title: string;

  /** Short description of what the material is for. */
  @ApiProperty({
    description: "Short description of what the material is for.",
    example: "Catalogo completo con i listini aggiornati.",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  description: string;

  /** Kind of material, fixed at creation. */
  @ApiProperty({
    description: "Kind of material, fixed at creation.",
    enum: MaterialType,
    example: MaterialType.Catalog,
    required: true,
  })
  @IsEnum(MaterialType)
  type: MaterialType;

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
    example: [ResellerTier.Gold, ResellerTier.Platinum],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ResellerTier, { each: true })
  resellerTiers?: ResellerTier[];

  /** External address. Only for the EXTERNAL_LINK materials. */
  @ApiPropertyOptional({
    description: "External address. Only for the EXTERNAL_LINK materials.",
    example: "https://keus.dev/catalogo",
    required: false,
  })
  @IsOptional()
  @IsUrl()
  externalUrl?: string;
}
