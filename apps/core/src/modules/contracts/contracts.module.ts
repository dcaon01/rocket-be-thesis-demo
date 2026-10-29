import { Module } from "@nestjs/common";
import { ContractsController } from "./controllers/contracts.controller";

/**
 * Lightweight module for Contracts.
 * Only registers the controller - the actual ContractsService is lazy-loaded
 * via ContractsLazyModule when a request arrives.
 */
@Module({
  controllers: [ContractsController],
})
export class ContractsModule {}
