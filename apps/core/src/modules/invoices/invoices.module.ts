import { Module } from "@nestjs/common";
import { CustomerChargesController } from "./controllers/customer-charges.controller";
import { InvoicesController } from "./controllers/invoices.controller";

/**
 * Lightweight module for Invoices and for what the resellers bill their customers.
 * Only registers the controllers - the actual services are lazy-loaded
 * via InvoicesLazyModule when a request arrives.
 */
@Module({
  controllers: [InvoicesController, CustomerChargesController],
})
export class InvoicesModule {}
