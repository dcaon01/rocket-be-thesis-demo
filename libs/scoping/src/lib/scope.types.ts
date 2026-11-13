import { AccountType } from './account-type.enum';

/**
 * Scope of the current request, extracted from the JWT by the ScopeGuard.
 * Scope-sensitive service methods take it as a REQUIRED parameter (decision:
 * forgetting it must be a compile error, not a security hole) and delegate the
 * filtering to the scoped-access helpers.
 */
export interface RequestScope {
  /** Cognito sub of the requester. */
  sub: string;
  /** Account type derived from the Cognito groups. */
  accountType: AccountType;
  /** Reseller the requester belongs to (custom:resellerCode claim). Only for reseller users. */
  resellerCode?: string;
  /** Role groups of the requester (account-type groups excluded). */
  roles: string[];
  /** True for internal non-HTTP paths (SQS, schedulers, webhooks): no filtering applies. */
  system?: boolean;
}

/**
 * Scope used by internal non-HTTP code paths (SQS handlers, EventBridge
 * schedules, Stripe/HubSpot webhooks): explicitly unrestricted.
 */
export const SYSTEM_SCOPE: RequestScope = {
  sub: 'system',
  accountType: AccountType.COLLABORATOR,
  roles: [],
  system: true,
};

/**
 * Whether the scope is exempt from reseller filtering: internal system paths
 * and Keus collaborators see everything.
 * @param scope the request scope.
 * @returns true when no filtering applies.
 */
export function isUnrestricted(scope: RequestScope): boolean {
  return scope.system === true || scope.accountType === AccountType.COLLABORATOR;
}
