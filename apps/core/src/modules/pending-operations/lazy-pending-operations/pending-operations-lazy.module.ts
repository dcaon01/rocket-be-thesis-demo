import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppException } from '../../../errors/exception-types';
import { PendingOperationSchema } from '../schemas/pending-operation.schema';
import { PendingOperationSchedulerService } from './services/pending-operation-scheduler.service';
import { PendingOperationsService } from './services/pending-operations.service';

/**
 * Lazy module for the operations Rocket sent to a product and is still waiting on.
 * Loaded on demand (via LazyModuleLoader) by the services that create records on the
 * products (tenants, users) and by the retry of the pending ones.
 * No controller: operations are only reached through the records they create.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "PendingOperation",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: PendingOperationSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_pending_operations`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
    AppException,
  ],
  providers: [PendingOperationsService, PendingOperationSchedulerService],
  exports: [PendingOperationsService],
})
export class PendingOperationsLazyModule {}
