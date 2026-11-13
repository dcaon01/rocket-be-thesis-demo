/**
 * Steps of the dunning of an unpaid invoice, counted in days from its due date (UR-RK-156, UR-RK-157): the issue on
 * the direct channel, where Stripe charges at once, and the 4th of the month of the charge for a reseller.
 * They run in this order, each scheduled by the one before; an invoice records the last one done.
 * An invoice of Keus to a reseller runs the same steps: the last one blocks its users in Rocket.
 */
export enum DunningStep {
  /** Fifth day: first reminder to whoever pays and to the administration. */
  FirstReminder = "FIRST_REMINDER",
  /** Tenth day: second reminder. */
  SecondReminder = "SECOND_REMINDER",
  /** Fourteenth day: the company learns the date its accesses will be suspended. */
  SuspensionNotice = "SUSPENSION_NOTICE",
  /** Fifteenth day: the accesses of the company are suspended, unless the administration postponed it. */
  Suspension = "SUSPENSION",
}

/** Day of each step, from the due date of the invoice. */
export const DUNNING_DAYS: Record<DunningStep, number> = {
  [DunningStep.FirstReminder]: 5,
  [DunningStep.SecondReminder]: 10,
  [DunningStep.SuspensionNotice]: 14,
  [DunningStep.Suspension]: 15,
};
