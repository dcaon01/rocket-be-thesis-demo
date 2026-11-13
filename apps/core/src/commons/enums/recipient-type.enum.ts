/**
 * Type of recipient targeted by a MESSAGE notification.
 * Tells the receiving product whether `to` refers to a user or a tenant.
 */
export enum RecipientTypeEnum {
  User = "USER",
  Tenant = "TENANT",
}
