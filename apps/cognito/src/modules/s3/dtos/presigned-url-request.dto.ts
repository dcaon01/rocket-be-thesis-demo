import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";
import { S3EntityType } from "../enums/s3-entity-type.enum";
import { PresignedUrlAction } from "../enums/presigned-url-action.enum";

/**
 * DTO for requesting a presigned URL for S3 upload or download.
 */
export class PresignedUrlRequestDto {
  /** The action type: upload or download. */
  @ApiProperty({
    example: PresignedUrlAction.UPLOAD,
    description: "The action type: upload to get a PUT URL, download to get a GET URL.",
    enum: PresignedUrlAction,
    required: true,
  })
  @IsEnum(PresignedUrlAction)
  @IsNotEmpty()
  action: PresignedUrlAction;

  /** The type of entity. */
  @ApiProperty({
    example: S3EntityType.USER_PROFILE_PHOTO,
    description: "The type of entity.",
    enum: S3EntityType,
    required: true,
  })
  @IsEnum(S3EntityType)
  @IsNotEmpty()
  entityType: S3EntityType;

  /** The ID of the user (Cognito sub). Required for upload. */
  @ApiPropertyOptional({
    example: "123e4567-e89b-12d3-a456-426614174000",
    description: "The ID of the user (Cognito sub). Required for upload.",
  })
  @ValidateIf((o: PresignedUrlRequestDto) => o.action === PresignedUrlAction.UPLOAD)
  @IsString()
  @IsNotEmpty()
  userId?: string;

  /** The filename with extension. Required for upload. */
  @ApiPropertyOptional({
    example: "profile.jpg",
    description: "The filename with extension. Required for upload.",
  })
  @ValidateIf((o: PresignedUrlRequestDto) => o.action === PresignedUrlAction.UPLOAD)
  @IsString()
  @IsNotEmpty()
  filename?: string;

  /** The content type of the file. Required for upload. */
  @ApiPropertyOptional({
    example: "image/jpeg",
    description: "The MIME content type of the file (image only). Required for upload.",
  })
  @ValidateIf((o: PresignedUrlRequestDto) => o.action === PresignedUrlAction.UPLOAD)
  @IsString()
  @IsNotEmpty()
  @Matches(/^image\/(jpeg|png|webp)$/, {
    message: "Content type must be image/jpeg, image/png, or image/webp",
  })
  contentType?: string;

  /** The S3 key of the file. Required for download. */
  @ApiPropertyOptional({
    example: "users/123e4567-e89b-12d3-a456-426614174000/profile-photo.jpg",
    description: "The S3 key of the file to download. Required for download.",
  })
  @ValidateIf((o: PresignedUrlRequestDto) => o.action === PresignedUrlAction.DOWNLOAD)
  @IsString()
  @IsNotEmpty()
  s3Key?: string;
}
