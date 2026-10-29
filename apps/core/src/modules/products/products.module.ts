import { Module } from '@nestjs/common';
import { ProductsController } from './controllers/products.controller';

/**
 * Lightweight module for Products.
 * Only registers the controller - the actual ProductsService is lazy-loaded
 * via ProductsLazyModule when a request arrives.
 */
@Module({
  controllers: [ProductsController],
})
export class ProductsModule {}
