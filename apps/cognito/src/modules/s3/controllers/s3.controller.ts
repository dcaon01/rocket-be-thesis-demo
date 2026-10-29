import { Controller, Get, Query } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { S3Service } from "../lazy-s3/services/s3.service";
import { PresignedUrlRequestDto } from "../dtos/presigned-url-request.dto";
import { PresignedUrlResponseDto } from "../dtos/presigned-url-response.dto";
import { PresignedUrlAction } from "../enums/presigned-url-action.enum";

/**
 * Controller for S3 operations.
 * Handles presigned URL generation for user profile photo uploads and downloads.
 */
@ApiTags("S3")
@Controller("s3")
export class S3Controller {
  /**
   * Constructor for S3Controller.
   * @param _s3Service service for S3 operations.
   */
  /** Lazy-loaded S3 service */
  private _s3Service: S3Service | null = null;

  /**
   * Constructor for S3Controller.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(private readonly _lazyModuleLoader: LazyModuleLoader) {}

  /**
   * Lazy loads the S3Service from its module.
   * @returns A Promise resolving to the S3Service instance.
   */
  private async _loadS3Service(): Promise<S3Service> {
    if (!this._s3Service) {
      const { S3LazyModule } = await import("../lazy-s3/s3-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => S3LazyModule);
      this._s3Service = moduleRef.get<S3Service>(S3Service);
    }
    return this._s3Service;
  }

  /**
   * Generates a presigned URL for uploading or downloading a user profile photo.
   * @param query the query parameters for the presigned URL request.
   * @returns the presigned URL response.
   */
  @Get("presigned-url")
  @ApiOperation({
    summary: "Get presigned URL for profile photo upload or download",
    description: "Generates a presigned URL for uploading (PUT) or downloading (GET) from S3. The URL is valid for 1 hour.",
  })
  @ApiResponse({
    status: 200,
    description: "Presigned URL generated successfully.",
    type: PresignedUrlResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid request parameters.",
  })
  async getPresignedUrl(
    @Query() query: PresignedUrlRequestDto
  ): Promise<PresignedUrlResponseDto> {
    const s3Service = await this._loadS3Service();
    if (query.action === PresignedUrlAction.DOWNLOAD) {
      return s3Service.getPresignedDownloadUrl(query.s3Key);
    }
    return s3Service.getPresignedUploadUrl(query);
  }
}
