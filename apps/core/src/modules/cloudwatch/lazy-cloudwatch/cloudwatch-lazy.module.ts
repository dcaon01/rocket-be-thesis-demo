import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CloudwatchService } from './services/cloudwatch.service';

/**
 * Lazy module for the reads of the CloudWatch metrics.
 * It has no controller: MetricsService lazy-loads it for the latency of the products.
 */
@Module({
  imports: [
    ConfigModule,
  ],
  providers: [
    CloudwatchService,
  ],
  exports: [
    CloudwatchService,
  ],
})
export class CloudwatchLazyModule {}
