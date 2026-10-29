import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppException } from '../../../errors/exception-types';
import { EncryptionService } from '../../../commons/encryption/encryption.service';
import { ResellerSchema } from '../schemas/reseller.schema';
import { ResellerTierConfigSchema } from '../schemas/reseller-tier-config.schema';
import { ResellersService } from './services/resellers.service';

/**
 * Lazy module for reseller operations.
 * This module is lazy-loaded when reseller services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "Reseller",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: ResellerSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_resellers`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
      {
        name: "ResellerTierConfig",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: ResellerTierConfigSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_reseller_tiers`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
    AppException,
  ],
  providers: [ResellersService, EncryptionService],
  exports: [ResellersService],
})
export class ResellersLazyModule {}
