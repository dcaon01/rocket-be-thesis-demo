import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsEnum, IsOptional, IsString, ValidateNested } from "class-validator";
import { CustomizationKind } from "../enums/customization-kind.enum";
import { CustomizationAttachment } from "./customization-attachment.class";

/**
 * A customization request as it comes in with an order: a need on the product of one of its lines, described as
 * text, files or both. The files are uploaded under the order's prefix, which exists only once
 * the order has an id: they are attached by editing the draft, not at creation.
 */
export class CustomizationInput {
  /** Identifier of a customization already on the order, to keep it; absent for a new one. */
  @ApiPropertyOptional({
    description: "Identifier of a customization already on the order, to keep it; absent for a new one.",
    example: "customization-id-123",
    required: false,
  })
  @IsOptional()
  @IsString()
  id?: string;

  /** What the customization is attached to: a line of the order. */
  @ApiProperty({
    description: "What the customization is attached to: a line of the order.",
    enum: CustomizationKind,
    example: CustomizationKind.Product,
    required: true,
  })
  @IsEnum(CustomizationKind)
  kind: CustomizationKind;

  /** Product of the line the customization is attached to; required with PRODUCT. */
  @ApiPropertyOptional({
    description: "Product of the line the customization is attached to; required with PRODUCT.",
    example: "product-id-123",
    required: false,
  })
  @IsOptional()
  @IsString()
  productId?: string;

  /** The need, described in words. */
  @ApiPropertyOptional({
    description: "The need, described in words.",
    example: "Integrazione con il gestionale interno",
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  /** Files describing the need. */
  @ApiPropertyOptional({
    description: "Files describing the need.",
    type: [CustomizationAttachment],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomizationAttachment)
  attachments?: CustomizationAttachment[];
}
