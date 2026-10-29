/**
 * How a tenant comes out of the rules of a lever on the evaluation date (UR-RK-223).
 */
export enum LeverOutcome {
  /** On the good side of the green threshold. */
  Compliant = 'COMPLIANT',
  /** Past the green threshold, within the yellow one. */
  AtRisk = 'AT_RISK',
  /** Past the yellow threshold. */
  Failing = 'FAILING',
  /** Too young for the lever, below the minimum sample, or still within the time of a milestone: counted apart. */
  NotAssessable = 'NOT_ASSESSABLE',
  /** Measured by a rule still in observation, which does not judge. */
  Observed = 'OBSERVED',
}
