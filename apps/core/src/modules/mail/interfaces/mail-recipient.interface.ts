/**
 * Rocket collaborator an email is addressed to, as read from Cognito.
 */
export interface MailRecipient {
  /** Email address of the collaborator. */
  email: string;
  /** Reseller the collaborator works at; absent for Keus staff. */
  resellerCode?: string;
  /** Name and surname of the collaborator, when Cognito has them. */
  fullName?: string;
}
