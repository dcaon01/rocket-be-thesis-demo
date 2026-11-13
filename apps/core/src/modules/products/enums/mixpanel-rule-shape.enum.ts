/**
 * Shape of a Mixpanel lever rule, that is what Rocket measures on a tenant. The shapes are common to every product,
 * the events they read are not:
 *   - MILESTONE: time from the start (the credentials, or the first of `anchorEventNames`) to the first of `eventNames`;
 *   - CADENCE: occurrences of `eventNames` in the window, per active user when `perActiveUser` is set;
 *   - COVERAGE: share, in percent, of the distinct `property` values seen in the window (on `anchorEventNames`, or on
 *     any event) that also appear on `eventNames`;
 *   - PROPERTY_AVERAGE: average of the numeric `property` of `eventNames` in the window;
 *   - INACTIVITY: time since the last of `eventNames`, or since the last event of the common core when there are none.
 */
export enum MixpanelRuleShape {
  Milestone = 'MILESTONE',
  Cadence = 'CADENCE',
  Coverage = 'COVERAGE',
  PropertyAverage = 'PROPERTY_AVERAGE',
  Inactivity = 'INACTIVITY',
}
