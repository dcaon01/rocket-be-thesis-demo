import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventBridgeService } from './services/event-bridge.service';
import { DemoProductService } from './services/demo-product.service';

/**
 * Lazy module for EventBridge operations.
 * This module is lazy-loaded when EventBridge services are accessed via LazyModuleLoader.
 */
@Module({
  imports: [
    ConfigModule,
  ],
  providers: [
    EventBridgeService,
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    DemoProductService,
  ],
  exports: [
    EventBridgeService,
  ],
})
export class EventBridgeLazyModule {}
