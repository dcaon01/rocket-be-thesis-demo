import { SentryIssueLevel } from "../enums/sentry-issue-level.enum";

/** A project of the Sentry organization, as the projects endpoint returns it. */
export interface SentryProject {
  /** Identifier of the project, the one the other endpoints filter on. */
  id: string;
  /** Short name of the project, as the URLs of Sentry carry it. */
  slug: string;
  /** Name of the project. */
  name: string;
}

/**
 * A row of the events table of Sentry, grouped by project: the number of error events of the project in the window.
 * The keys are the fields asked for, so they are not identifiers.
 */
export interface SentryErrorCountRow {
  /** Identifier of the project. */
  'project.id': number | string;
  /** Error events of the project in the window. */
  'count()': number;
}

/**
 * A row of the events table of Sentry, grouped by issue: the error events of the issue in the window.
 * The keys are the fields asked for, so they are not identifiers.
 */
export interface SentryIssueRow {
  /** Identifier of the issue, the one the URLs of Sentry carry. */
  'issue.id': number | string;
  /** Identifier of the project of the issue. */
  'project.id': number | string;
  /** Title of the issue. */
  title: string;
  /** Level of the issue, as Sentry writes it. */
  level: string;
  /** Error events of the issue in the window. */
  'count()': number;
  /** Moment of the last error event of the issue in the window (ISO string). */
  'last_seen()': string;
}

/** An issue of a Sentry project with its events in a window, ready to be shown with the link to open it. */
export interface SentryIssue {
  /** Identifier of the project of the issue. */
  projectId: string;
  /** Title of the issue. */
  title: string;
  /** Level of the issue. */
  level: SentryIssueLevel;
  /** Error events of the issue in the window. */
  events: number;
  /** Moment of the last error event of the issue in the window (ISO string). */
  lastSeen: string;
  /** Link that opens the issue on Sentry. */
  url: string;
}
