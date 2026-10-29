import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppException } from '../../../errors/exception-types';
import { DocumentSchema } from '../schemas/document.schema';
import { DocumentsService } from './services/documents.service';

/**
 * Lazy module for document operations.
 * This module is lazy-loaded when document services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "Document",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: DocumentSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_documents`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
    AppException,
  ],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsLazyModule {}
