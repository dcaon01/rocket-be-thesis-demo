// Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
import { applyDecorators, CanActivate, Injectable, UseGuards } from "@nestjs/common";
import { BusinessException } from "../../errors/exception-types";
import { integrationsEnabled } from "./integrations.helper";

/**
 * Guard refusing a handler that only makes sense with the integrations on (a Stripe checkout, a Sibill document, a
 * webhook), so that a demo without them answers with a clear code instead of a failure deep in the call.
 */
@Injectable()
export class IntegrationsGuard implements CanActivate {
  /**
   * Lets the request through while the integrations are on.
   * @returns true when the integrations are on.
   * @throws BusinessException INTEGRATIONS_DISABLED when they are off.
   */
  canActivate(): boolean {
    if (!integrationsEnabled()) {
      throw new BusinessException("This operation needs the external integrations, which are off.", "INTEGRATIONS_DISABLED");
    }
    return true;
  }
}

/**
 * Marks a handler that needs the external integrations: with them off it is refused (`IntegrationsGuard`).
 * Usage: @RequiresIntegrations() on the handler.
 * @returns the decorator.
 */
export const RequiresIntegrations = (): MethodDecorator & ClassDecorator => applyDecorators(UseGuards(IntegrationsGuard));
