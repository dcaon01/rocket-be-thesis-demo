import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose } from "class-transformer";
import { ResellerTier } from "../../resellers/enums/reseller-tier.enum";
import { MaterialStatus } from "../enums/material-status.enum";
import { MaterialType } from "../enums/material-type.enum";

/**
 * DTO returned for a material.
 */
export class ResponseMaterialDto {
  /** Identifier of the material. */
  @ApiProperty({
    description: "Identifier of the material.",
    example: "material-id-123",
    required: true,
  })
  @Expose()
  id: string;

  /** Title shown in the listing. */
  @ApiProperty({
    description: "Title shown in the listing.",
    example: "Catalogo Nquadro 2026",
    required: true,
  })
  @Expose()
  title: string;

  /** Short description of what the material is for. */
  @ApiPropertyOptional({
    description: "Short description of what the material is for.",
    required: false,
  })
  @Expose()
  description?: string;

  /** Kind of material. */
  @ApiProperty({
    description: "Kind of material.",
    enum: MaterialType,
    required: true,
  })
  @Expose()
  type: MaterialType;

  /** Publication state. */
  @ApiProperty({
    description: "Publication state.",
    enum: MaterialStatus,
    required: true,
  })
  @Expose()
  status: MaterialStatus;

  /** Products the material is assigned to. Empty means every product. */
  @ApiPropertyOptional({
    description: "Products the material is assigned to.",
    example: ["product-id-123"],
    required: false,
  })
  @Expose()
  productIds?: string[];

  /** Reseller tiers the material is available to. Empty means every tier. */
  @ApiPropertyOptional({
    description: "Reseller tiers the material is available to.",
    enum: ResellerTier,
    isArray: true,
    example: [ResellerTier.Gold],
    required: false,
  })
  @Expose()
  resellerTiers?: ResellerTier[];

  /** S3 key of the file. */
  @ApiPropertyOptional({
    description: "S3 key of the file.",
    required: false,
  })
  @Expose()
  fileS3Key?: string;

  /** External address, for the materials that are a link. */
  @ApiPropertyOptional({
    description: "External address, for the materials that are a link.",
    required: false,
  })
  @Expose()
  externalUrl?: string;

  /** MIME type of the file. */
  @ApiPropertyOptional({
    description: "MIME type of the file.",
    example: "application/pdf",
    required: false,
  })
  @Expose()
  contentType?: string;

  /** Size of the file in bytes. */
  @ApiPropertyOptional({
    description: "Size of the file in bytes.",
    example: 2048576,
    required: false,
  })
  @Expose()
  sizeBytes?: number;

  /** ISO timestamp of the publication. */
  @ApiPropertyOptional({
    description: "ISO timestamp of the publication.",
    example: "2026-09-15T10:00:00.000Z",
    required: false,
  })
  @Expose()
  publishedAt?: string;

  /** ISO timestamp of the creation. */
  @ApiProperty({
    description: "ISO timestamp of the creation.",
    example: "2026-09-15T10:00:00.000Z",
    required: true,
  })
  @Expose()
  createdAt: string;

  /** ISO timestamp of the last update. */
  @ApiProperty({
    description: "ISO timestamp of the last update.",
    example: "2026-09-15T10:00:00.000Z",
    required: true,
  })
  @Expose()
  updatedAt: string;
}
