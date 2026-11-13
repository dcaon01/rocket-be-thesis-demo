import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppException } from '../../../errors/exception-types';
import { CustomerChargeSchema } from '../schemas/customer-charge.schema';
import { InvoiceSchema } from '../schemas/invoice.schema';
import { ChargeSchedulerService } from './services/charge-scheduler.service';
import { CustomerChargesService } from './services/customer-charges.service';
import { InvoicesService } from './services/invoices.service';
import { MonthlyChargeService } from './services/monthly-charge.service';
import { ProFormaService } from './services/pro-forma.service';

/**
 * Lazy module for the invoices.
 * Loaded on demand (via LazyModuleLoader) by the Stripe webhooks and by the services that bill.
 * It also holds what the resellers bill their customers: the shares of the contracts and their own items.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "Invoice",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: InvoiceSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_invoices`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
      {
        name: "CustomerCharge",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: CustomerChargeSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_customer_charges`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
    AppException,
  ],
  providers: [
    InvoicesService,
    MonthlyChargeService,
    ChargeSchedulerService,
    CustomerChargesService,
    ProFormaService,
  ],
  exports: [InvoicesService, MonthlyChargeService, CustomerChargesService, ProFormaService],
})
export class InvoicesLazyModule {}
