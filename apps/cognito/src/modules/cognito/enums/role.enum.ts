/**
 * Re-exported from the shared scoping lib so the enum has a single source of
 * truth across the apps; existing imports of this path keep working.
 * `Role` is kept as an alias of `UserRole` to avoid touching every DTO.
 */
export { UserRole as Role, UserRole } from '@rocket-be/scoping';
