/**
 * What a pending operation asks the product to do.
 * Each kind names the record it targets: the operation and the record point to each other.
 */
export enum PendingOperationKind {
  /** Create a tenant on the product; the target is the tenant. */
  CreateTenant = 'CREATE_TENANT',
  /** Change a tenant on the product; the target is the tenant. */
  UpdateTenant = 'UPDATE_TENANT',
  /** Delete a tenant on the product; the target is the tenant. */
  DeleteTenant = 'DELETE_TENANT',
  /** Create a user on the product; the target is the user. */
  CreateUser = 'CREATE_USER',
  /** Change a user on the product; the target is the user. */
  UpdateUser = 'UPDATE_USER',
  /** Delete a user on the product; the target is the user. */
  DeleteUser = 'DELETE_USER',
}

/** Kinds of the operations that target a tenant, for the tenant's history. */
export const TENANT_OPERATION_KINDS: PendingOperationKind[] = [
  PendingOperationKind.CreateTenant,
  PendingOperationKind.UpdateTenant,
  PendingOperationKind.DeleteTenant,
];

/** Kinds of the operations that target a user, for the user's history. */
export const USER_OPERATION_KINDS: PendingOperationKind[] = [
  PendingOperationKind.CreateUser,
  PendingOperationKind.UpdateUser,
  PendingOperationKind.DeleteUser,
];
