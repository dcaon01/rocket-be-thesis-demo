/**
 * Why a customer is on the follow-up list of the customer success metrics (UR-RK-221): what is wrong today, and the
 * date it refers to.
 */
export enum CustomerFollowUpReason {
  /** Credentials delivered and no first access yet: the date is the delivery. */
  NeverActivated = 'NEVER_ACTIVATED',
  /** Contract cancelled and not ended yet: the date is when it ends. */
  Terminating = 'TERMINATING',
  /** Contract in force with the tenant suspended for an unpaid invoice: the date is the suspension. */
  AccessSuspended = 'ACCESS_SUSPENDED',
}
