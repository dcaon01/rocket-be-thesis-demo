import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { MetricsService } from './services/metrics.service';
import { AppException } from '../../../errors/exception-types';
import { RevenueDashboardMetricsRecordSchema } from '../schemas/revenue-dashboard-metrics-record.schema';
import { UtilitiesDashboardMetricsRecordSchema } from '../schemas/utilities-dashboard-metrics-record.schema';
import { CustomerSuccessDashboardMetricsRecordSchema } from '../schemas/customer-success-dashboard-metrics-record.schema';
import { SupportDashboardMetricsRecordSchema } from '../schemas/support-dashboard-metrics-record.schema';
import { ProductAdoptionDashboardMetricsRecordSchema } from '../schemas/product-adoption-dashboard-metrics-record.schema';
import { ResellerOverviewDashboardMetricsRecordSchema } from '../schemas/reseller-overview-dashboard-metrics-record.schema';
import { SalesOrdersDashboardMetricsRecordSchema } from '../schemas/sales-orders-dashboard-metrics-record.schema';
import { TechnicalErrorsDashboardMetricsRecordSchema } from '../schemas/technical-errors-dashboard-metrics-record.schema';
import { AvailabilityDashboardMetricsRecordSchema } from '../schemas/availability-dashboard-metrics-record.schema';
import { ProductHealthCheckSchema } from '../schemas/product-health-check.schema';
import { ProductOutageSchema } from '../schemas/product-outage.schema';

/**
 * Lazy module for metrics operations.
 * This module is lazy-loaded when metrics services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: 'RevenueDashboardMetricsRecord',
        useFactory: (_, configService: ConfigService) => ({
          schema: RevenueDashboardMetricsRecordSchema,
          options: {
            tableName: `${configService.get<string>('APP_NAME')}_${configService.get<string>('NODE_ENV')}_revenue_dashboard_metrics_records`,
            create: true,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'UtilitiesDashboardMetricsRecord',
        useFactory: (_, configService: ConfigService) => ({
          schema: UtilitiesDashboardMetricsRecordSchema,
          options: {
            tableName: `${configService.get<string>('APP_NAME')}_${configService.get<string>('NODE_ENV')}_utilities_dashboard_metrics_records`,
            create: true,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'CustomerSuccessDashboardMetricsRecord',
        useFactory: (_, configService: ConfigService) => ({
          schema: CustomerSuccessDashboardMetricsRecordSchema,
          options: {
            tableName: `${configService.get<string>('APP_NAME')}_${configService.get<string>('NODE_ENV')}_customer_success_dashboard_metrics_records`,
            create: true,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'SupportDashboardMetricsRecord',
        useFactory: (_, configService: ConfigService) => ({
          schema: SupportDashboardMetricsRecordSchema,
          options: {
            tableName: `${configService.get<string>('APP_NAME')}_${configService.get<string>('NODE_ENV')}_support_dashboard_metrics_records`,
            create: true,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'ProductAdoptionDashboardMetricsRecord',
        useFactory: (_, configService: ConfigService) => ({
          schema: ProductAdoptionDashboardMetricsRecordSchema,
          options: {
            tableName: `${configService.get<string>('APP_NAME')}_${configService.get<string>('NODE_ENV')}_product_adoption_dashboard_metrics_records`,
            create: true,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'ResellerOverviewDashboardMetricsRecord',
        useFactory: (_, configService: ConfigService) => ({
          schema: ResellerOverviewDashboardMetricsRecordSchema,
          options: {
            tableName: `${configService.get<string>('APP_NAME')}_${configService.get<string>('NODE_ENV')}_reseller_overview_dashboard_metrics_records`,
            create: true,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'SalesOrdersDashboardMetricsRecord',
        useFactory: (_, configService: ConfigService) => ({
          schema: SalesOrdersDashboardMetricsRecordSchema,
          options: {
            tableName: `${configService.get<string>('APP_NAME')}_${configService.get<string>('NODE_ENV')}_sales_orders_dashboard_metrics_records`,
            create: true,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'TechnicalErrorsDashboardMetricsRecord',
        useFactory: (_, configService: ConfigService) => ({
          schema: TechnicalErrorsDashboardMetricsRecordSchema,
          options: {
            tableName: `${configService.get<string>('APP_NAME')}_${configService.get<string>('NODE_ENV')}_technical_errors_dashboard_metrics_records`,
            create: true,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'AvailabilityDashboardMetricsRecord',
        useFactory: (_, configService: ConfigService) => ({
          schema: AvailabilityDashboardMetricsRecordSchema,
          options: {
            tableName: `${configService.get<string>('APP_NAME')}_${configService.get<string>('NODE_ENV')}_availability_dashboard_metrics_records`,
            create: true,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'ProductHealthCheck',
        useFactory: (_, configService: ConfigService) => ({
          schema: ProductHealthCheckSchema,
          options: {
            tableName: `${configService.get<string>('APP_NAME')}_${configService.get<string>('NODE_ENV')}_product_health_checks`,
            create: true,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'ProductOutage',
        useFactory: (_, configService: ConfigService) => ({
          schema: ProductOutageSchema,
          options: {
            tableName: `${configService.get<string>('APP_NAME')}_${configService.get<string>('NODE_ENV')}_product_outages`,
            create: true,
          },
        }),
        inject: [ConfigService],
      },
    ]),
    AppException,
  ],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsLazyModule {}
