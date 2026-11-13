import { AuthorizationException } from '../../errors/exception-types';
import { isUnrestricted, RequestScope, UserRole } from '@rocket-be/scoping';

/**
 * Single enforcement point for reseller scoping: visibility follows the materialized reseller path.
 */

/**
 * Tells whether an entity's materialized reseller path is visible to a viewer
 * path: true when the entity belongs to the viewer's subtree (the viewer path
 * is a prefix of the entity path). The trailing '#' on every segment makes the
 * prefix check collision-safe ("RVD-1#" is not a prefix of "RVD-10#").
 * @param viewerPath the requester's reseller path (undefined = no subtree).
 * @param entityPath the entity's denormalized reseller path (undefined = Keus-owned).
 * @returns true when the entity is within the viewer's subtree.
 */
export function isPathVisible(
  viewerPath: string | undefined,
  entityPath: string | undefined,
): boolean {
  if (!viewerPath) {
    return false;
  }
  return entityPath !== undefined && entityPath.startsWith(viewerPath);
}

/**
 * Asserts that an entity is within the viewer's reseller subtree, by prefix
 * match on the materialized path. No-op for unrestricted (collaborator/system)
 * scopes. Used by get-one and mutation paths (zero DB: pure string check).
 * @param scope the request scope.
 * @param viewerPath the requester's reseller path (resolved from scope.resellerCode).
 * @param entityPath the entity's denormalized reseller path.
 * @param entityName the entity name for the error message.
 * @throws AuthorizationException when the entity is outside the subtree.
 */
export function assertPathVisible(
  scope: RequestScope,
  viewerPath: string | undefined,
  entityPath: string | undefined,
  entityName: string,
): void {
  if (isUnrestricted(scope)) {
    return;
  }
  if (!isPathVisible(viewerPath, entityPath)) {
    throw new AuthorizationException(
      `${entityName} is outside the scope of reseller ${scope.resellerCode}.`,
    );
  }
}

/**
 * Asserts that the requester is a collaborator (or an internal system path):
 * used by operations that resellers can never perform.
 * @param scope the request scope.
 * @param operation the operation name for the error message.
 * @throws AuthorizationException for reseller requesters.
 */
export function assertCollaborator(scope: RequestScope, operation: string): void {
  if (!isUnrestricted(scope)) {
    throw new AuthorizationException(`Operation "${operation}" is reserved to Keus collaborators.`);
  }
}

/**
 * Tells whether the requester is a reseller salesperson and nothing more:
 * without the owner or back office profile. It reads the whole subtree of its
 * reseller, but only the orders it opened and the performance of their sales,
 * changes only the contracts of those orders, and never sees the purchase terms.
 * @param scope the request scope.
 * @returns true when the orders and the performance are limited to the requester's own.
 */
export function isSalespersonOnly(scope: RequestScope): boolean {
  return scope.roles.includes(UserRole.ResellerSales)
    && !scope.roles.includes(UserRole.ResellerOwner)
    && !scope.roles.includes(UserRole.ResellerBackoffice);
}

/**
 * Tells whether the requester is a Keus salesperson and nothing more: without
 * the admin, back office or accounting profile. It reads only its own resellers,
 * and only the orders it opened or that belong to its resellers; it opens only
 * direct ones.
 * @param scope the request scope.
 * @returns true when the visibility is limited to the salesperson's own records.
 */
export function isKeusSalespersonOnly(scope: RequestScope): boolean {
  return scope.roles.includes(UserRole.KeusSales)
    && !scope.roles.includes(UserRole.KeusAdmin)
    && !scope.roles.includes(UserRole.KeusBackoffice)
    && !scope.roles.includes(UserRole.KeusAccounting);
}

/**
 * Tells whether the requester may act as the seller on a record of a channel: a Keus salesperson reads the orders of
 * its resellers but leaves selling on the indirect channel to them.
 * @param scope the request scope.
 * @param resellerPath the path of the record, absent on the direct channel.
 * @returns false for a Keus salesperson on the indirect channel.
 */
export function canSellOn(scope: RequestScope, resellerPath: string | undefined): boolean {
  return !(isKeusSalespersonOnly(scope) && resellerPath);
}

/**
 * Tells whether the requester is the Keus back office and nothing more: without
 * the admin or accounting profile. It reads the active companies of one product
 * at a time, since the global dashboard is not its own (UR-RK-001).
 * @param scope the request scope.
 * @returns true when the dashboards are limited to the product ones.
 */
export function isKeusBackofficeOnly(scope: RequestScope): boolean {
  return scope.roles.includes(UserRole.KeusBackoffice)
    && !scope.roles.includes(UserRole.KeusAdmin)
    && !scope.roles.includes(UserRole.KeusAccounting);
}
