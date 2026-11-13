import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppException } from '../../../errors/exception-types';
import { TemplateSchema } from '../schemas/template.schema';
import { DocxRendererService } from './services/docx-renderer.service';
import { TemplateRendererService } from './services/template-renderer.service';
import { TemplatesService } from './services/templates.service';

/**
 * Lazy module for template operations.
 * This module is lazy-loaded when template services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "Template",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: TemplateSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_templates`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
    AppException,
  ],
  providers: [TemplatesService, TemplateRendererService, DocxRendererService],
  exports: [TemplatesService],
})
export class TemplatesLazyModule {}
