/**
 * Time unit of a Mixpanel lever rule: the unit of its window, and of its thresholds on the MILESTONE and INACTIVITY
 * shapes, whose value is a time. WORKING_DAYS skips Saturdays and Sundays, so that a milestone started on a Friday
 * does not fail over the weekend.
 */
export enum MixpanelRuleUnit {
  Days = 'DAYS',
  /** Skips weekends. Nquadro's KPI document asks its activation in 48 hours; Rocket measures it in 2 working days. */
  WorkingDays = 'WORKING_DAYS',
  Weeks = 'WEEKS',
}
