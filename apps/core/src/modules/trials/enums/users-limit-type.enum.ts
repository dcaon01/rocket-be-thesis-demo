/**
 * Enum representing the type of users limit for a trial.
 */
export enum UsersLimitType {
  /** Uses the product's default trial users limit. */
  Product = "PRODUCT",
  /** No users limit. */
  Infinite = "INFINITE",
  /** Custom users limit value. */
  Custom = "CUSTOM",
}
