import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DynamooseModule } from "nestjs-dynamoose";
import { AppException } from "../../../errors/exception-types";
import { PlanSchema } from "../schemas/plan.schema";
import { PlansService } from "./services/plans.service";

/**
 * Lazy module for plan operations.
 * This module is lazy-loaded when plan services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "Plan",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: PlanSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_plans`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
    AppException,
  ],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansLazyModule { }
