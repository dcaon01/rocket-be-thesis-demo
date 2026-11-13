import { Module } from '@nestjs/common';
import { OrdersController } from './controllers/orders.controller';

/**
 * Module for order management.
 * Only registers the controller: the service and the Dynamoose models live in
 * the lazy module, loaded on demand.
 */
@Module({
  controllers: [OrdersController],
})
export class OrdersModule {}
