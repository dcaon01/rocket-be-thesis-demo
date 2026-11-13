import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppController } from './app.controller';
import { AwsDecodingService } from './commons/aws/aws-decode-uri.service';
import { AwsDecodeUriInterceptor } from './interceptors/aws-decode-uri.interceptor';
import { ResellerAccessInterceptor } from './interceptors/reseller-access.interceptor';
import { LoggingModule } from './logging/logging.module';
import { ErrorsModule } from './errors/errors.modules';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { OrdersModule } from './modules/orders/orders.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { PlansModule } from './modules/plans/plans.module';
import { ProductsModule } from './modules/products/products.module';
import { HubspotModule } from './modules/hubspot/hubspot.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { ResellersModule } from './modules/resellers/resellers.module';
import { ResellerContractsModule } from './modules/reseller-contracts/reseller-contracts.module';
import { S3Module } from './modules/s3/s3.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { SqsEventsModule } from './modules/sqs-events/sqs-events.module';
import { TrialsModule } from './modules/trials/trials.module';
import { MetricsModule } from './modules/metrics/metrics.module';

/**
 * Root module of the core application: global configuration, the DynamoDB connection and the feature modules.
 */
@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // DynamoDB configuration
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

    // Centralized logging system
    LoggingModule.forRoot({
      logRequestBody: process.env.NODE_ENV === "development",
      logResponseBody: process.env.NODE_ENV === "development",
      maxResponseSize: process.env.NODE_ENV === "development" ? 50000 : 10000,
      logPrefix: process.env.REPO_NAME || "RocketAPI",
      sensitiveFields: [
        "password",
        "token",
        "secret",
        "authorization",
        "apiKey",
      ],
    }),

    // Centralized error handling
    ErrorsModule.forRoot({
      detailedLogs: process.env.NODE_ENV === "development",
      errorNotifier:
        process.env.NODE_ENV === "production"
          ? (error, correlationId) => {
              // You can implement external error monitoring service integration here
              console.error(`[CRITICAL:${correlationId}] ${error.message}`);
            }
          : undefined,
    }),

    // Application-specific modules
    ProductsModule,
    PlansModule,
    UsersModule,
    TenantsModule,
    ContractsModule,
    InvoicesModule,
    OrdersModule,
    TemplatesModule,
    MaterialsModule,
    DocumentsModule,
    TrialsModule,
    CompaniesModule,
    ResellersModule,
    ResellerContractsModule,
    MetricsModule,

    // Integration modules
    HubspotModule,
    StripeModule,
    S3Module,
    WebhooksModule,
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
    // Refuses the requests of the users of a blocked reseller, after the guards set the scope.
    {
      provide: APP_INTERCEPTOR,
      useClass: ResellerAccessInterceptor,
    },
  ],
  controllers: [AppController],
})
export class AppModule { }
