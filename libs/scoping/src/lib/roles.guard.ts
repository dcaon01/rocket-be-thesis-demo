import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountType } from './account-type.enum';
import { ROLES_METADATA_KEY } from './roles.decorator';
import { RequestScope } from './scope.types';
import { accountTypeOfRole, UserRole } from './user-role.enum';

/**
 * Guard enforcing the profile declared by @Roles on a route.
 * Reads `request.scope.roles`, already filled by ScopeGuard from the
 * `cognito:groups` claim, so the token is never decoded twice.
 *
 * Declaration order matters: `@UseGuards(ScopeGuard, RolesGuard)`, because the
 * scope must exist before this guard runs.
 *
 * Rules, in order:
 *   - no scope on the request        → denied (RolesGuard used without ScopeGuard)
 *   - internal system paths          → allowed (SQS, schedulers, webhooks have no profile)
 *   - route without @Roles           → allowed (the decorator is opt-in)
 *   - profile/account type mismatch  → denied (a keus_* profile on a reseller account, or vice versa)
 *   - no profile in common           → denied
 *
 * KeusAdmin has NO implicit shortcut: an administrative route lists it in its
 * own @Roles. An implicit "admin always passes" would make the permission
 * matrix unreadable from the code.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  /** Logger instance for RolesGuard. */
  private readonly _logger = new Logger(RolesGuard.name);

  /**
   * Constructor for RolesGuard.
   * @param _reflector the reflector used to read the @Roles metadata.
   */
  constructor(private readonly _reflector: Reflector) { }

  /**
   * Checks the requester's profiles against the ones the route allows.
   * @param context the execution context of the request.
   * @returns true when the requester holds one of the allowed profiles.
   * @throws ForbiddenException when the scope is missing, the profile does not match the account type, or no profile is shared with the route.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ scope?: RequestScope }>();
    const scope = request.scope;

    if (!scope) {
      throw new ForbiddenException(
        'Request scope is missing: RolesGuard requires ScopeGuard to run first.',
      );
    }

    // Internal non-HTTP paths carry no profile and are already trusted.
    if (scope.system === true) {
      return true;
    }

    const requiredRoles = this._reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    this._assertRolesMatchAccountType(scope);

    const hasRole = scope.roles.some(role => (requiredRoles as string[]).includes(role));
    if (!hasRole) {
      throw new ForbiddenException(
        `Operation "${context.getClass().name}.${context.getHandler().name}" is reserved to: ${requiredRoles.join(', ')}.`,
      );
    }
    return true;
  }

  /**
   * Asserts that every profile of the requester belongs to its account type.
   * Defends against a tampered token and against a misconfigured Cognito user,
   * where exclusivity cannot be enforced natively.
   * @param scope the request scope.
   * @throws ForbiddenException when a profile belongs to the other side of the relationship.
   */
  private _assertRolesMatchAccountType(scope: RequestScope): void {
    const mismatched = scope.roles.filter(role => {
      const owner = accountTypeOfRole(role);
      return owner !== undefined && owner !== scope.accountType;
    });

    if (mismatched.length > 0) {
      this._logger.warn(
        `User ${scope.sub} holds profiles that do not belong to its account type: ${mismatched.join(', ')}.`,
      );
      throw new ForbiddenException(
        `Profiles ${mismatched.join(', ')} are not allowed on a ${scope.accountType} account.`,
      );
    }
  }
}
