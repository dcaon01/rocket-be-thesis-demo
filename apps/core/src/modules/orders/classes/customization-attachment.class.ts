import { Expose } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsNotEmpty, IsString } from "class-validator";
import { CustomizationAttachmentType } from "../enums/customization-attachment-type.enum";

/** A file attached to a customization, uploaded under the order's prefix. */
export class CustomizationAttachment {
  /** S3 key of the file, under `orders/{orderId}/customizations/`. */
  @ApiProperty({
    description: "S3 key of the file, under `orders/{orderId}/customizations/`.",
    example: "orders/order-id-123/customizations/3f1c.pdf",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @Expose()
  s3Key: string;

  /** Kind of the file. */
  @ApiProperty({
    description: "Kind of the file.",
    enum: CustomizationAttachmentType,
    example: CustomizationAttachmentType.Pdf,
    required: true,
  })
  @IsEnum(CustomizationAttachmentType)
  @Expose()
  type: CustomizationAttachmentType;

  /** Name of the file, as the user chose it. */
  @ApiProperty({
    description: "Name of the file, as the user chose it.",
    example: "requisiti.pdf",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @Expose()
  name: string;
}
