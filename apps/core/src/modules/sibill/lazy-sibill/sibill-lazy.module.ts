import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppException } from '../../../errors/exception-types';
import { SibillService } from './services/sibill.service';

/**
 * Lazy module for Sibill, which issues the electronic invoices of Keus.
 * Loaded on demand (via LazyModuleLoader) by InvoicesService; it has no controller of its own.
 */
@Module({
  imports: [
    ConfigModule,
    AppException,
  ],
  providers: [SibillService],
  exports: [SibillService],
})
export class SibillLazyModule {}
