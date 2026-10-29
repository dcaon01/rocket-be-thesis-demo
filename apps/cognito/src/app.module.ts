import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppController } from './app.controller';
import { AwsDecodingService } from './commons/aws/aws-decode-uri.service';
import { AwsDecodeUriInterceptor } from './interceptors/aws-decode-uri.interceptor';
import { CognitoModule } from './modules/cognito/cognito.module';
import { S3Module } from './modules/s3/s3.module';
import { SqsEventsModule } from './modules/sqs-events/sqs-events.module';

/**
 * Main application module for cognito.
 * Configures global modules, services, and controllers in this app.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // DynamoDB configuration (collaborators projection table)
    DynamooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        // Configure AWS credentials only in development
        if (configService.get<string>("NODE_ENV") === "development") {
          return {
            aws: {
              accessKeyId: configService.get<string>("AWS_ACCESS_KEY_ID"),
              secretAccessKey: configService.get<string>(
                "AWS_SECRET_ACCESS_KEY",
              ),
              region: configService.get<string>("AWS_REGION"),
            },
            local: configService.get<string>("DATABASE_URL") || "http://localhost:8000",
            table: {
              create: true,
              update: true,
              waitForActive: true,
            },
          };
        }
        // In the cloud, the default configuration plus the cost-allocation tags. They are sent only inside
        // CreateTable: never add `tags` to `update`, reconciliation needs ListTags/UntagResource the role lacks.
        return {
          table: {
            tags: {
              Project: configService.getOrThrow<string>("PROJECT_NAME"),
              Environment: configService.getOrThrow<string>("NODE_ENV"),
              ManagedBy: "dynamoose",
            },
          },
        };
      },
      inject: [ConfigService],
    }),

    CognitoModule,
    S3Module,
    SqsEventsModule,
  ],
  providers: [
    AwsDecodingService,
    {
      provide: APP_INTERCEPTOR,
      useFactory: (awsDecodingService: AwsDecodingService) =>
        new AwsDecodeUriInterceptor(awsDecodingService),
      inject: [AwsDecodingService],
    },
  ],
  controllers: [AppController],
})
export class AppModule { }
