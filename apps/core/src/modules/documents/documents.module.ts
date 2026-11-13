import { Module } from '@nestjs/common';
import { DocumentsController } from './controllers/documents.controller';

/**
 * Module for document management.
 * Only registers the controller: the service and the Dynamoose model live in
 * the lazy module, loaded on demand.
 */
@Module({
  controllers: [DocumentsController],
})
export class DocumentsModule {}
