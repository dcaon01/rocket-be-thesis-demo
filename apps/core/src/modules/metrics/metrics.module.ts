import { Module } from '@nestjs/common';
import { MetricsController } from './controllers/metrics.controller';

/**
 * Lightweight module for Metrics.
 * Only registers the controller - the actual MetricsService is lazy-loaded
 * via MetricsLazyModule when a request arrives.
 */
@Module({
  controllers: [MetricsController],
})
export class MetricsModule {}
