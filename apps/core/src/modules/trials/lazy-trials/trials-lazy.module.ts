import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppException } from '../../../errors/exception-types';
import { TrialSchema } from '../schemas/trial.schema';
import { TrialsService } from './services/trials.service';
import { TrialSchedulerService } from './services/trial-scheduler.service';

/**
 * Lazy module for trial operations.
 * This module is lazy-loaded when trial services are accessed via LazyModuleLoader.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "Trial",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: TrialSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_trials`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      }
    ]),
    AppException,
  ],
  providers: [TrialsService, TrialSchedulerService],
  exports: [TrialsService, TrialSchedulerService],
})
export class TrialsLazyModule {}
