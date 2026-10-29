import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";
import { S3EntityType } from "../enums/s3-entity-type.enum";
import { PresignedUrlAction } from "../enums/presigned-url-action.enum";

/** A single segment of an S3 key: an identifier with a slash would write under another prefix. */
const S3_KEY_SEGMENT = /^[^/\s]+$/;

/**
 * DTO for requesting a presigned URL for S3 upload or download.
 */
export class PresignedUrlRequestDto {
  /** The action type: upload or download. */
  @ApiProperty({
    example: PresignedUrlAction.Upload,
    description: "The action type: upload to get a PUT URL, download to get a GET URL.",
    enum: PresignedUrlAction,
    required: true,
  })
  @IsEnum(PresignedUrlAction)
  @IsNotEmpty()
  action: PresignedUrlAction;

  /** The type of entity. */
  @ApiProperty({
    example: S3EntityType.ProductLogo,
    description: "The type of entity.",
    enum: S3EntityType,
    required: true,
  })
  @IsEnum(S3EntityType)
  @IsNotEmpty()
  entityType: S3EntityType;

  /** The ID of the entity (productId, materialId, templateId, resellerId or orderId). Required for upload. */
  @ApiPropertyOptional({
    example: "123e4567-e89b-12d3-a456-426614174000",
    description: "The ID of the entity (productId for products, materialId for material files, templateId for template sources, resellerId for reseller logos, orderId for order documents). Required for upload.",
  })
  @ValidateIf((o: PresignedUrlRequestDto) => o.action === PresignedUrlAction.Upload)
  @IsString()
  @IsNotEmpty()
  @Matches(S3_KEY_SEGMENT, { message: "entityId must not contain slashes or spaces" })
  entityId?: string;

  /** The ID of the reseller (required for the signed agreement of a reseller contract, whose entityId is the contractId). */
  @ApiPropertyOptional({
    example: "5f0c8a2e-1b2c-4d3e-8f90-1a2b3c4d5e6f",
    description: "The ID of the reseller. Required for the signed agreement of a reseller contract (entityId is the contractId).",
  })
  @ValidateIf((o: PresignedUrlRequestDto) =>
    o.action === PresignedUrlAction.Upload && o.entityType === S3EntityType.ResellerContractSigned
  )
  @IsString()
  @IsNotEmpty()
  @Matches(S3_KEY_SEGMENT, { message: "resellerId must not contain slashes or spaces" })
  resellerId?: string;

  /** The filename with extension. Required for upload. */
  @ApiPropertyOptional({
    example: "signed-contract.pdf",
    description: "The filename with extension. Required for upload.",
  })
  @ValidateIf((o: PresignedUrlRequestDto) => o.action === PresignedUrlAction.Upload)
  @IsString()
  @IsNotEmpty()
  filename?: string;

  /** The content type of the file. Required for upload. */
  @ApiPropertyOptional({
    example: "application/pdf",
    description: "The MIME content type of the file. Required for upload.",
  })
  @ValidateIf((o: PresignedUrlRequestDto) => o.action === PresignedUrlAction.Upload)
  @IsString()
  @IsNotEmpty()
  @Matches(
    /^(application\/(pdf|zip|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|presentationml\.presentation|spreadsheetml\.sheet))|text\/html|image\/(jpeg|png|webp|svg\+xml)|audio\/(mpeg|mp4|x-m4a|aac|wav|x-wav|ogg|webm))$/,
    {
      message: "Content type must be a PDF, Word, PowerPoint, Excel, ZIP, HTML, image (jpeg, png, webp, svg) or audio (mp3, m4a, aac, wav, ogg, webm) file",
    },
  )
  contentType?: string;

  /** The S3 key of the file. Required for download. */
  @ApiPropertyOptional({
    example: "orders/order-456/signed-offer.pdf",
    description: "The S3 key of the file to download. Required for download.",
  })
  @ValidateIf((o: PresignedUrlRequestDto) => o.action === PresignedUrlAction.Download)
  @IsString()
  @IsNotEmpty()
  s3Key?: string;
}
