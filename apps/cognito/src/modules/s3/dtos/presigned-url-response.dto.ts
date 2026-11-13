import { ApiProperty } from "@nestjs/swagger";

/**
 * DTO for the response containing the presigned URL.
 */
export class PresignedUrlResponseDto {
  /** The presigned URL for uploading the file. */
  @ApiProperty({
    example: "https://bucket.s3.amazonaws.com/...",
    description: "The presigned URL for uploading the file via PUT request.",
    required: true,
  })
  url: string;

  /** The S3 key where the file will be stored. */
  @ApiProperty({
    example: "users/123e4567-e89b-12d3-a456-426614174000/profile-photo.jpg",
    description: "The S3 key where the file will be stored.",
    required: true,
  })
  s3Key: string;

  /** The expiration time in seconds. */
  @ApiProperty({
    example: 3600,
    description: "The expiration time of the presigned URL in seconds.",
    required: true,
  })
  expiresIn: number;
}
