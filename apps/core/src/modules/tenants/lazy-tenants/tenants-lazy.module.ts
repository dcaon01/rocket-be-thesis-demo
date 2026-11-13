import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppException } from '../../../errors/exception-types';
import { TenantSchema } from '../schemas/tenant.schema';
import { TenantsService } from './services/tenants.service';

/**
 * Lazy module for tenant operations.
 * This module is lazy-loaded when tenant services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "Tenant",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: TenantSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_tenants`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      }
    ]),
    AppException,
  ],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsLazyModule {}
