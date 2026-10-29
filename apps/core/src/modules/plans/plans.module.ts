import { Module } from "@nestjs/common";
import { PlansController } from "./controller/plans.controller";

/**
 * Lightweight module for Plans.
 * Only registers the controller - the actual PlansService is lazy-loaded
 * via PlansLazyModule when a request arrives.
 */
@Module({
  controllers: [PlansController],
})
export class PlansModule { }
