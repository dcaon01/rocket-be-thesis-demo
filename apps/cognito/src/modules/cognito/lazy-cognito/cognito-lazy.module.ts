import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { CollaboratorSchema } from '../schemas/collaborator.schema';
import { CognitoManagementService } from './services/cognito-management.service';
import { CollaboratorsService } from './services/collaborators.service';

/**
 * Lazy module for AWS Cognito management ops.
 * Loaded on demand (via LazyModuleLoader) when a request hits the Cognito
 * controller: the services read required env vars (AWS_REGION,
 * COGNITO_USER_POOL_ID) in their constructors and the Dynamoose model
 * initializes the collaborators table, so keeping them out of the bootstrap
 * lets the app start without any environment configured.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "Collaborator",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: CollaboratorSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_collaborators`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [CognitoManagementService, CollaboratorsService],
  exports: [CognitoManagementService, CollaboratorsService],
})
export class CognitoLazyModule {}
