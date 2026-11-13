import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppException } from '../../../errors/exception-types';
import { OrderCustomizationSchema } from '../schemas/order-customization.schema';
import { OrderLineSchema } from '../schemas/order-line.schema';
import { OrderSchema } from '../schemas/order.schema';
import { OrdersService } from './services/orders.service';

/**
 * Lazy module for order operations.
 * This module is lazy-loaded when order services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "Order",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: OrderSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_orders`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
      {
        name: "OrderLine",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: OrderLineSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_order_lines`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
      {
        name: "OrderCustomization",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: OrderCustomizationSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_order_customizations`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
    AppException,
  ],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersLazyModule {}
