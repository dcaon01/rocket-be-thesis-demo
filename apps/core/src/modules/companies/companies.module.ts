import { Module } from "@nestjs/common";
import { CompaniesController } from "./controller/companies.controller";

/**
 * Lightweight module for Companies.
 * Only registers the controller - the actual CompaniesService is lazy-loaded
 * via CompaniesLazyModule when a request arrives.
 */
@Module({
  controllers: [CompaniesController],
})
export class CompaniesModule {}
