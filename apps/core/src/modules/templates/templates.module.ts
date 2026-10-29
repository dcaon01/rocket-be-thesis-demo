import { Module } from '@nestjs/common';
import { TemplatesController } from './controllers/templates.controller';

/**
 * Module for template management.
 * Only registers the controller: the service and the Dynamoose model live in
 * the lazy module, loaded on demand.
 */
@Module({
  controllers: [TemplatesController],
})
export class TemplatesModule {}
