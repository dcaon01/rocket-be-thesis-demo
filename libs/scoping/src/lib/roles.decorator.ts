import { SetMetadata } from '@nestjs/common';
import { UserRole } from './user-role.enum';

/** Metadata key holding the profiles allowed on a route. */
export const ROLES_METADATA_KEY = 'rocket:roles';

/**
 * Restricts a route to the given profiles.
 * Usage: `@Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice)`.
 *
 * Only meaningful together with ScopeGuard and RolesGuard on the controller.
 * A route without @Roles stays open to every authenticated profile, so the
 * decorator is opt-in: absence means "no profile restriction", never "denied".
 * It can be applied on the controller and overridden on a single handler.
 *
 * Profiles restrict WHAT a user can do; the reseller scoping keeps deciding
 * WHICH records it sees. The two checks always apply together, never instead
 * of one another.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_METADATA_KEY, roles);
