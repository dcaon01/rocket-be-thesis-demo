import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppException } from '../../../errors/exception-types';
import { MaterialSchema } from '../schemas/material.schema';
import { MaterialsService } from './services/materials.service';

/**
 * Lazy module for material operations.
 * This module is lazy-loaded when material services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "Material",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: MaterialSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_materials`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
    AppException,
  ],
  providers: [MaterialsService],
  exports: [MaterialsService],
})
export class MaterialsLazyModule {}
