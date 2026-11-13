/**
 * What an INACTIVITY rule of a Mixpanel lever looks at: the time since the last event is measured on one subject, and
 * the worst of them is the value of the tenant.
 */
export enum MixpanelInactivityScope {
  /** The tenant as a whole: time since its last event. */
  Tenant = 'TENANT',
  /** Each active user of the tenant, read by `distinct_id`: the longest silence among them. */
  User = 'USER',
  /** Each object of the tenant, read by an event property: the longest silence among the open ones. */
  Object = 'OBJECT',
}
