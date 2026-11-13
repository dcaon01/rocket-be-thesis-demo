/**
 * Level of a Sentry issue, as Sentry writes it. The values mirror Sentry, so they are lowercase: a level Sentry
 * adds later is read as an error.
 */
export enum SentryIssueLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warning = 'warning',
  Info = 'info',
  Debug = 'debug',
}
