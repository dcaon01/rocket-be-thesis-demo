import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { ProductSchema } from '../schemas/product.schema';
import { ProductsService } from './services/products.service';
import { AppException } from '../../../errors/exception-types';
import { StructureTypeCheckService } from './services/structure-type-check.service';
import { EncryptionService } from '../../../commons/encryption/encryption.service';
import { StripeModule } from '../../stripe/stripe.module';

/**
 * Lazy module for product operations.
 * This module is lazy-loaded when product services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: 'Product',
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: ProductSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_products`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      }
    ]),
    AppException,
    StripeModule
  ],
  providers: [ProductsService, StructureTypeCheckService, EncryptionService],
  exports: [ProductsService, StructureTypeCheckService]
})
export class ProductsLazyModule {}
