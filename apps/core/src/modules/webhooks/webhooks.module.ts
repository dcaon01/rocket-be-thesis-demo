import { Module } from "@nestjs/common";
import { WebhooksController } from "./controllers/webhooks.controller";

/**
 * Lightweight module for Webhooks.
 * Only registers the controller - the actual webhook services are lazy-loaded
 * via WebhooksLazyModule when a request arrives.
 */
@Module({
  controllers: [WebhooksController],
})
export class WebhooksModule { }
