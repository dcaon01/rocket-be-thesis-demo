/**
 * Enum representing the account type of a back-office user.
 * Modeled as Cognito groups (like Role), but mutually exclusive:
 * a user is either a Keus collaborator or a reseller collaborator, never both.
 * Exclusivity is enforced app-side (Cognito does not guarantee it natively).
 */
export enum AccountType {
  COLLABORATOR = 'collaborator',
  RESELLER = 'reseller'
}
