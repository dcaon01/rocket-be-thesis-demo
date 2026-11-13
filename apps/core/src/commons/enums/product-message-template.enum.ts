/**
 * Templates of the MESSAGE notifications Rocket asks a product to email.
 * Only the trials go through the products, branded as theirs: Rocket writes to the companies about orders and
 * contracts itself (`MailTemplate`). Rocket names the template and passes its data (`MessagePayloadDto`), the
 * product owns copy and layout.
 */
export enum ProductMessageTemplate {
  /** To the trial's user: the days left of the trial. */
  TrialResidue = "TRIAL_RESIDUE",
  /** To the trial's user: the trial is over. */
  TrialEnd = "TRIAL_END",
}
