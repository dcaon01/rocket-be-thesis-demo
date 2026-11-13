import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3EntityType } from "../../enums/s3-entity-type.enum";
import { PresignedUrlRequestDto } from "../../dtos/presigned-url-request.dto";
import { PresignedUrlResponseDto } from "../../dtos/presigned-url-response.dto";
import { BadRequestException, InternalServerErrorException } from "@nestjs/common";

/** Presigned URL expiration time in seconds (1 hour). */
const PRESIGNED_URL_EXPIRES_IN = 3600;

/**
 * Service for S3 operations in Cognito app.
 * Handles presigned URL generation for user profile photos.
 */
@Injectable()
export class S3Service {
  /** Logger instance for S3Service. */
  private readonly _logger = new Logger(S3Service.name);

  /** S3 Client instance. */
  private readonly _s3Client: S3Client;

  /** S3 Bucket name. */
  private readonly _bucketName: string;

  /**
   * Constructor for S3Service.
   * @param _configService NestJS config service.
   */
  constructor(private readonly _configService: ConfigService) {
    const region = this._configService.get<string>('AWS_REGION');
    const bucketName = this._configService.get<string>('S3_BUCKET');

    if (!bucketName) {
      this._logger.error('S3_BUCKET is not defined in environment variables');
      throw new Error('S3_BUCKET is required');
    }

    this._bucketName = bucketName;

    // Initialize S3 client
    if (this._configService.get<string>('NODE_ENV') === 'development') {
      this._s3Client = new S3Client({
        region: region || 'eu-west-1',
        requestChecksumCalculation: 'WHEN_REQUIRED',
        credentials: {
          accessKeyId: this._configService.get<string>('AWS_ACCESS_KEY_ID') || '',
          secretAccessKey: this._configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
        },
      });
    } else {
      // In production, use default credentials (IAM role)
      this._s3Client = new S3Client({
        region: region || 'eu-west-1',
        requestChecksumCalculation: 'WHEN_REQUIRED',
      });
    }

    this._logger.log('S3 service initialized successfully');
  }

  /**
   * Generates a presigned URL for uploading a file to S3.
   * @param dto the request DTO containing entity type, user ID, and file info.
   * @returns the presigned URL response with URL and S3 key.
   */
  async getPresignedUploadUrl(dto: PresignedUrlRequestDto): Promise<PresignedUrlResponseDto> {
    try {
      // Validate content type
      if (!dto.contentType.startsWith('image/')) {
        throw new BadRequestException('Profile photos must be image files');
      }

      // Generate S3 key based on entity type
      const s3Key = this._generateS3Key(dto);

      // Create the PutObject command
      const command = new PutObjectCommand({
        Bucket: this._bucketName,
        Key: s3Key,
        ContentType: dto.contentType,
      });

      // Generate presigned URL
      const url = await getSignedUrl(this._s3Client, command, {
        expiresIn: PRESIGNED_URL_EXPIRES_IN,
        signableHeaders: new Set(['content-type']),
      });

      this._logger.log(`Generated presigned URL for ${dto.entityType}: ${s3Key}`);

      return {
        url,
        s3Key,
        expiresIn: PRESIGNED_URL_EXPIRES_IN,
      };

    } catch (error) {
      this._logger.error('Error generating presigned URL', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Something went wrong trying to generate presigned URL'
      );
    }
  }

  /**
   * Generates a presigned URL for downloading a file from S3.
   * @param s3Key the S3 key of the file to download.
   * @returns the presigned URL response with URL and S3 key.
   */
  async getPresignedDownloadUrl(s3Key: string): Promise<PresignedUrlResponseDto> {
    try {
      const command = new GetObjectCommand({
        Bucket: this._bucketName,
        Key: s3Key,
      });

      const url = await getSignedUrl(this._s3Client, command, {
        expiresIn: PRESIGNED_URL_EXPIRES_IN,
      });

      this._logger.log(`Generated presigned download URL for: ${s3Key}`);

      return {
        url,
        s3Key,
        expiresIn: PRESIGNED_URL_EXPIRES_IN,
      };

    } catch (error) {
      this._logger.error('Error generating presigned download URL', error);
      throw new InternalServerErrorException(
        'Something went wrong trying to generate presigned download URL'
      );
    }
  }

  /**
   * Extracts user ID from an S3 key.
   * @param s3Key the S3 key.
   * @returns an object with entityType and userId.
   */
  parseS3Key(s3Key: string): {
    entityType: S3EntityType;
    userId: string;
  } {
    const parts = s3Key.split('/');

    if (parts[0] === 'users' && parts.length >= 3) {
      // users/{userId}/profile-photo.{ext}
      return {
        entityType: S3EntityType.USER_PROFILE_PHOTO,
        userId: parts[1],
      };
    }

    throw new BadRequestException('Invalid S3 key format');
  }

  /**
   * Generates the S3 key based on entity type and request data.
   * @param dto the request DTO.
   * @returns the S3 key string.
   */
  private _generateS3Key(dto: PresignedUrlRequestDto): string {
    const extension = this._getExtensionFromContentType(dto.contentType, dto.filename);

    switch (dto.entityType) {
      case S3EntityType.USER_PROFILE_PHOTO:
        // users/{userId}/profile-photo.{ext}
        return `users/${dto.userId}/profile-photo.${extension}`;

      default: {
        const exhaustiveCheck: never = dto.entityType;
        throw new BadRequestException(`Unsupported entity type: ${exhaustiveCheck as string}`);
      }
    }
  }

  /**
   * Extracts the file extension from content type or filename.
   * @param contentType the MIME content type.
   * @param filename the original filename.
   * @returns the file extension.
   */
  private _getExtensionFromContentType(contentType: string, filename: string): string {
    // Try to get extension from filename first
    const filenameExt = filename.split('.').pop()?.toLowerCase();
    if (filenameExt) {
      return filenameExt;
    }

    // Fall back to content type mapping
    const contentTypeMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };

    return contentTypeMap[contentType] || 'jpg';
  }
}
