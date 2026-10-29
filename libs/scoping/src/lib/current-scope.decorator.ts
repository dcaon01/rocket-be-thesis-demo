import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestScope } from './scope.types';

/**
 * Param decorator exposing the RequestScope populated by the ScopeGuard.
 * Usage: `myEndpoint(@CurrentScope() scope: RequestScope, ...)`.
 * Only meaningful on routes guarded by ScopeGuard.
 */
export const CurrentScope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestScope => {
    const request = context.switchToHttp().getRequest<{ scope: RequestScope }>();
    return request.scope;
  },
);
