import { Module } from '@nestjs/common';
import { TenantsController } from './controllers/tenants.controller';

/**
 * Lightweight module for Tenants.
 * Only registers the controller - the actual TenantsService is lazy-loaded
 * via TenantsLazyModule when a request arrives.
 */
@Module({
  controllers: [TenantsController],
})
export class TenantsModule {}
