import { Module } from '@nestjs/common';
import { MaterialsController } from './controllers/materials.controller';

/**
 * Module for material management.
 * Only registers the controller: the service and the Dynamoose model live in
 * the lazy module, loaded on demand.
 */
@Module({
  controllers: [MaterialsController],
})
export class MaterialsModule {}
