import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppException } from '../../../errors/exception-types';
import { CompanySchema } from '../schemas/company.schema';
import { CompaniesService } from './services/companies.service';

/**
 * Lazy module for company operations.
 * This module is lazy-loaded when company services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "Company",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: CompanySchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_companies`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
    AppException,
  ],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesLazyModule {}
