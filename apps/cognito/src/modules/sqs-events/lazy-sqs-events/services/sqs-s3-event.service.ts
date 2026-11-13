import { Injectable, Logger, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LazyModuleLoader } from "@nestjs/core";
import {
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { S3Service } from "../../../s3/lazy-s3/services/s3.service";
import { S3EntityType } from "../../../s3/enums/s3-entity-type.enum";
import type { S3Event } from "aws-lambda";
import type { CollaboratorsService } from "../../../cognito/lazy-cognito/services/collaborators.service";

/**
 * Service for handling S3 events received via SQS.
 * Processes S3 event notifications and updates user profile photos in Cognito and in the collaborators projection.
 */
@Injectable()
export class SqsS3EventService {
  /** Logger instance for SqsS3EventService. */
  private readonly _logger = new Logger(SqsS3EventService.name);

  /** Cognito client instance. */
  private readonly _cognitoClient: CognitoIdentityProviderClient;

  /** Cognito User Pool ID. */
  private readonly _userPoolId: string;

  /** Lazy-loaded collaborators service. */
  private _collaboratorsService: CollaboratorsService | null = null;

  /**
   * Constructor for SqsS3EventService.
   * @param _s3Service service for S3 operations.
   * @param _configService NestJS config service.
   * @param _lazyModuleLoader the lazy module loader used to resolve the collaborators service on demand.
   */
  constructor(
    private readonly _s3Service: S3Service,
    private readonly _configService: ConfigService,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) {
    const region = this._configService.get<string>('AWS_REGION');
    const isDev = this._configService.get<string>('NODE_ENV') === 'development';
    const accessKeyId = this._configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this._configService.get<string>('AWS_SECRET_ACCESS_KEY');

    this._userPoolId = this._configService.getOrThrow<string>('COGNITO_USER_POOL_ID');

    const credentials = isDev && accessKeyId && secretAccessKey ? {
      accessKeyId,
      secretAccessKey
    } : undefined;

    this._cognitoClient = new CognitoIdentityProviderClient({
      region,
      credentials
    });
  }

  /**
   * Handles an S3 event notification received from SQS.
   * @param s3Event the S3 event notification.
   * @returns confirmation message.
   */
  async handleS3Event(s3Event: S3Event): Promise<{ message: string }> {
    this._logger.log(`Received S3 event: ${JSON.stringify(s3Event)}`);
    try {
      if (s3Event.Records && s3Event.Records.length > 0) {
        for (const record of s3Event.Records) {
          if (record.eventSource === 'aws:s3' && record.eventName.startsWith('ObjectCreated')) {
            const decodedKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
            await this._handleS3ObjectCreated(decodedKey);
          }
        }
      }

      return { message: 'S3 event processed' };

    } catch (error) {
      this._logger.error('Error handling S3 event', error);
      throw new InternalServerErrorException(
        'Something went wrong while processing S3 event'
      );
    }
  }

  /**
   * Handles S3 object created event.
   * Updates the user's profile photo attribute in Cognito.
   * @param s3Key the S3 key of the uploaded object.
   */
  private async _handleS3ObjectCreated(s3Key: string): Promise<void> {
    this._logger.log(`Processing S3 object created: ${s3Key}`);

    try {
      const entityInfo = this._s3Service.parseS3Key(s3Key);

      if (entityInfo.entityType === S3EntityType.USER_PROFILE_PHOTO) {
        await this._updateUserProfilePhotoS3Key(entityInfo.userId, s3Key);
      } else {
        this._logger.warn(`Unknown entity type for S3 key: ${s3Key}`);
      }
    } catch (error) {
      this._logger.error(`Error processing S3 object: ${s3Key}`, error);
    }
  }

  /**
   * Lazy loads the CollaboratorsService from the cognito module.
   * @returns a Promise resolving to the CollaboratorsService instance.
   */
  private async _loadCollaboratorsService(): Promise<CollaboratorsService> {
    if (!this._collaboratorsService) {
      const { CognitoLazyModule } = await import("../../../cognito/lazy-cognito/cognito-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => CognitoLazyModule);
      const { CollaboratorsService } = await import("../../../cognito/lazy-cognito/services/collaborators.service");
      this._collaboratorsService = moduleRef.get<CollaboratorsService>(CollaboratorsService);
    }
    return this._collaboratorsService;
  }

  /**
   * Updates the user's profile photo S3 key as a custom attribute in Cognito, then in the collaborators projection,
   * which the listings read.
   * @param userId the Cognito user sub.
   * @param s3Key the S3 key.
   */
  private async _updateUserProfilePhotoS3Key(
    userId: string,
    s3Key: string
  ): Promise<void> {
    try {
      const command = new AdminUpdateUserAttributesCommand({
        UserPoolId: this._userPoolId,
        Username: userId,
        UserAttributes: [
          {
            Name: 'custom:profilePicS3Key',
            Value: s3Key,
          },
        ],
      });

      await this._cognitoClient.send(command);
      this._logger.log(`Updated user ${userId} with profilePicS3Key: ${s3Key}`);

      const collaboratorsService = await this._loadCollaboratorsService();
      await collaboratorsService.updateCollaborator(userId, { profilePicS3Key: s3Key });
    } catch (error) {
      this._logger.error(`Failed to update user ${userId} profile photo`, error);
      throw error;
    }
  }
}
