import { Module } from "@nestjs/common";
import { ResellersController } from "./controller/resellers.controller";

/**
 * Lightweight module for Resellers.
 * Only registers the controller - the actual ResellersService is lazy-loaded
 * via ResellersLazyModule when a request arrives.
 */
@Module({
  controllers: [ResellersController],
})
export class ResellersModule {}
