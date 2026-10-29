import { Module } from "@nestjs/common";
import { ResellerContractsController } from "./controllers/reseller-contracts.controller";

/**
 * Lightweight module for the reseller contracts.
 * Only registers the controller - the actual ResellerContractsService is lazy-loaded
 * via ResellerContractsLazyModule when a request arrives.
 */
@Module({
  controllers: [ResellerContractsController],
})
export class ResellerContractsModule {}
