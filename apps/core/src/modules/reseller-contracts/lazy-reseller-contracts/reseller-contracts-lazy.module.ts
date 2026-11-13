import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { ResellerContractSchedulerService } from './services/reseller-contract-scheduler.service';
import { ResellerContractSchema } from '../schemas/reseller-contract.schema';
import { ResellerContractsService } from './services/reseller-contracts.service';

/**
 * Lazy module for the reseller contracts.
 * This module is lazy-loaded when the reseller contracts service is accessed via LazyModuleLoader.
 * Its scheduler sends the renewal and end events to the SQS inbound queue.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "ResellerContract",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: ResellerContractSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_reseller_contracts`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [ResellerContractsService, ResellerContractSchedulerService],
  exports: [ResellerContractsService],
})
export class ResellerContractsLazyModule {}
