/**
 * Account type of a product end-user / tenant (the `users` and `tenants`
 * tables of core).
 *
 * NOTE: this is a DISTINCT concept from the Cognito back-office `AccountType`
 * (COLLABORATOR/RESELLER) and from resellers in general — a reseller is never a
 * product end-user account type. It is also orthogonal to `tenant.issuerId`
 * (lineage: who activated the tenant) and `resellerPath` (the reseller chain
 * above): `accountType` says WHAT the user/tenant IS.
 */
export enum AccountType {
  /**
   * Regular end-user account, the company being served.
   * The stored value stays CLIENT: products read it from the events Rocket sends.
   */
  Company = "CLIENT",
  /** Professional (installer/integrator) end-user / their workspace tenant. */
  Professional = "PROFESSIONAL",
}
