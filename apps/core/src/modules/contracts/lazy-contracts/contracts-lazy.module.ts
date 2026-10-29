import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppException } from '../../../errors/exception-types';
import { CompanyProductSchema } from '../schemas/company-product.schema';
import { ContractSchema } from '../schemas/contract.schema';
import { ContractNoticesService } from './services/contract-notices.service';
import { ContractSchedulerService } from './services/contract-scheduler.service';
import { ContractsService } from './services/contracts.service';

/**
 * Lazy module for contract operations.
 * This module is lazy-loaded when contract services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "Contract",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: ContractSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_contracts`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
      {
        name: "CompanyProduct",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: CompanyProductSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_company_products`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
    AppException,
  ],
  providers: [ContractsService, ContractSchedulerService, ContractNoticesService],
  exports: [ContractsService, ContractNoticesService],
})
export class ContractsLazyModule {}
