import { Module } from "@nestjs/common";
import { HubspotController } from "./controller/hubsport.controller";

/**
 * Lightweight module for Hubspot.
 * Only registers the controller - the actual HubspotService is lazy-loaded
 * via HubspotLazyModule when a request arrives.
 */
@Module({
  controllers: [HubspotController],
})
export class HubspotModule {}
