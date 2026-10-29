import { Injectable, Logger } from "@nestjs/common";
import { AppException } from "../../../../errors/exception-types";
import { SentryIssueLevel } from "../../enums/sentry-issue-level.enum";
import { SentryErrorCountRow, SentryIssue, SentryIssueRow, SentryProject } from "../../interfaces/sentry.interface";

/** Default Sentry API base URL: the organization of Keus is in the EU region. */
const DEFAULT_SENTRY_API_URL = "https://de.sentry.io";

/** Server-side cache TTL of the reads (~5 minutes), to stay within the rate limits. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Longest wait for a single Sentry request. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Longest time the requests of a read may take together, below the 29 seconds of API Gateway. */
const READ_DEADLINE_MS = 20_000;

/** Requests of a read sent at the same time, so a read does not hit the concurrent limit of Sentry. */
const MAX_CONCURRENT_REQUESTS = 4;

/** Most projects a page of the projects endpoint returns. */
const PROJECTS_PAGE_SIZE = 100;

/** Most issues a read of the issues of a window returns. */
const ISSUES_LIMIT = 25;

/** The answer of a Sentry request: status, headers and raw body. */
type SentryAnswer = { status: number; headers: Headers; body: string };

/**
 * Server-side reader of the Sentry REST API for the technical metrics (UR-RK-225). Every product has its own project,
 * and dev and prod are environments inside it: the reads filter on the environment of this Rocket, so rockettino
 * counts the errors of the products in dev and Rocket the ones in prod. The token of an internal integration
 * (`org:read`, `project:read`, `event:read`), the organization, the environment and the base URL are read from
 * `process.env` (SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_ENVIRONMENT, SENTRY_API_URL); nothing is ever written to Sentry.
 */
@Injectable()
export class SentryService {
  /** Logger instance for SentryService. */
  private readonly _logger = new Logger(SentryService.name);

  /** In-memory cache of the reads, keyed by the request, with a short TTL. */
  private readonly _cache = new Map<string, { data: unknown; expiresAt: number }>();

  /**
   * Counts the error events of each project in a window, in the environment of this Rocket, with one request for
   * all the projects. A project with no errors has no row, so it is counted as zero.
   * @param projectIds the identifiers of the projects.
   * @param start the start of the window.
   * @param end the end of the window.
   * @returns the error events per project identifier.
   * @throws AppException if Sentry is not configured or the request fails.
   */
  async countErrors(projectIds: string[], start: Date, end: Date): Promise<Map<string, number>> {
    const params = new URLSearchParams({ dataset: "errors", start: this._isoOf(start), end: this._isoOf(end), per_page: String(projectIds.length) });
    params.append("field", "project.id");
    params.append("field", "count()");
    projectIds.forEach(projectId => params.append("project", projectId));

    return this._cached(`errors#${params.toString()}`, async () => {
      const answer = await this._request(`/events/?${this._withEnvironment(params)}`);
      const rows = this._parse<{ data?: SentryErrorCountRow[] }>(answer, "events").data ?? [];
      const counts = new Map(projectIds.map(projectId => [projectId, 0]));
      rows.forEach(row => counts.set(String(row["project.id"]), Number(row["count()"]) || 0));

      this._logger.log(`Counted Sentry errors of ${projectIds.length} projects from ${start.toISOString()} to ${end.toISOString()}.`);
      return counts;
    });
  }

  /**
   * Counts the issues of each project first seen in a window, whatever their status today: the alerts fired in it.
   * @param projectIds the identifiers of the projects.
   * @param start the start of the window.
   * @param end the end of the window, excluded.
   * @returns the issues first seen per project identifier.
   * @throws AppException if Sentry is not configured, a request fails, or the requests do not fit the deadline.
   */
  async countIssuesFirstSeen(projectIds: string[], start: Date, end: Date): Promise<Map<string, number>> {
    return this._countIssues(projectIds, `firstSeen:>=${this._isoOf(start)} firstSeen:<${this._isoOf(end)}`, start, end);
  }

  /**
   * Counts the issues of each project still unresolved, among the ones with events in a window: the alerts open
   * today. Archived issues are not unresolved, so they stay out.
   * @param projectIds the identifiers of the projects.
   * @param start the start of the window.
   * @param end the end of the window.
   * @returns the unresolved issues per project identifier.
   * @throws AppException if Sentry is not configured, a request fails, or the requests do not fit the deadline.
   */
  async countUnresolvedIssues(projectIds: string[], start: Date, end: Date): Promise<Map<string, number>> {
    return this._countIssues(projectIds, "is:unresolved", start, end);
  }

  /**
   * Lists the issues with most error events in a window, in the environment of this Rocket, with one request for all
   * the projects: the events are counted inside the window, not over the whole life of the issue. The titles are
   * personal data at times: they are kept only in the short cache of this instance, never written or logged.
   * @param projectIds the identifiers of the projects.
   * @param start the start of the window.
   * @param end the end of the window.
   * @returns the issues, the ones with most events first, at most `ISSUES_LIMIT`.
   * @throws AppException if Sentry is not configured or the request fails.
   */
  async listIssues(projectIds: string[], start: Date, end: Date): Promise<SentryIssue[]> {
    const params = new URLSearchParams({ dataset: "errors", start: this._isoOf(start), end: this._isoOf(end), sort: "-count()", per_page: String(ISSUES_LIMIT) });
    ["issue.id", "project.id", "title", "level", "count()", "last_seen()"].forEach(field => params.append("field", field));
    projectIds.forEach(projectId => params.append("project", projectId));

    return this._cached(`issue-list#${params.toString()}`, async () => {
      const answer = await this._request(`/events/?${this._withEnvironment(params)}`);
      const rows = this._parse<{ data?: SentryIssueRow[] }>(answer, "events").data ?? [];

      this._logger.log(`Listed ${rows.length} Sentry issues of ${projectIds.length} projects from ${start.toISOString()} to ${end.toISOString()}.`);
      return rows.map(row => ({
        projectId: String(row["project.id"]),
        title: row.title,
        level: this._levelOf(row.level),
        events: Number(row["count()"]) || 0,
        lastSeen: row["last_seen()"],
        url: `${this._webUrl()}/issues/${row["issue.id"]}/`,
      }));
    });
  }

  /**
   * Builds the link to the issues of some projects on Sentry.
   * @param projectIds the identifiers of the projects.
   * @returns the link to the list of the issues of the projects.
   * @throws AppException if the organization is not configured.
   */
  issuesPageUrl(projectIds: string[]): string {
    const params = new URLSearchParams();
    projectIds.forEach(projectId => params.append("project", projectId));
    return `${this._webUrl()}/issues/?${params.toString()}`;
  }

  /**
   * Lists the projects of the organization, for the product form, following the pages of the endpoint.
   * @returns the projects, with identifier, slug and name.
   * @throws AppException if Sentry is not configured or a request fails.
   */
  async listProjects(): Promise<SentryProject[]> {
    const projects: SentryProject[] = [];
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ per_page: String(PROJECTS_PAGE_SIZE), ...(cursor && { cursor }) });
      const answer = await this._request(`/projects/?${params.toString()}`);
      projects.push(...this._parse<SentryProject[]>(answer, "projects").map(project => ({ id: String(project.id), slug: project.slug, name: project.name })));
      cursor = this._nextCursorOf(answer.headers.get("Link"));
    } while (cursor);

    return projects;
  }

  /**
   * Counts the issues of each project that match a search, in the environment of this Rocket and among the issues
   * with events in the window. The total comes from the `X-Hits` header of a one-issue page, so each project costs one
   * request; the requests go out a few at a time, all within `READ_DEADLINE_MS`.
   * @param projectIds the identifiers of the projects.
   * @param query the issue search, as written in Sentry; it replaces the default `is:unresolved`.
   * @param start the start of the window.
   * @param end the end of the window.
   * @returns the matching issues per project identifier.
   * @throws AppException if Sentry is not configured, a request fails, or the requests do not fit the deadline.
   */
  private async _countIssues(projectIds: string[], query: string, start: Date, end: Date): Promise<Map<string, number>> {
    const window = { start: this._isoOf(start), end: this._isoOf(end) };

    return this._cached(`issues#${query}#${window.start}#${window.end}#${projectIds.join(",")}`, async () => {
      const deadline = Date.now() + READ_DEADLINE_MS;
      const counts = new Map<string, number>();
      const pending = [...projectIds];

      const worker = async (): Promise<void> => {
        for (let projectId = pending.shift(); projectId; projectId = pending.shift()) {
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) {
            throw new AppException("Sentry took too long to count the issues of the products.", 504);
          }

          const params = new URLSearchParams({ project: projectId, query, ...window, limit: "1" });
          const answer = await this._request(`/issues/?${this._withEnvironment(params)}`, Math.min(REQUEST_TIMEOUT_MS, remainingMs));
          this._parse<unknown[]>(answer, "issues");
          counts.set(projectId, Number(answer.headers.get("X-Hits")) || 0);
        }
      };
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_REQUESTS, projectIds.length) }, worker));

      this._logger.log(`Counted Sentry issues "${query}" of ${projectIds.length} projects.`);
      return counts;
    });
  }

  /**
   * Returns a read from the cache, or runs it and keeps it for `CACHE_TTL_MS`. A failed read is not kept, and the
   * expired entries are dropped at every miss, so a warm Lambda does not keep the windows of past reads.
   * @param key the key of the read.
   * @param read the read to run when the cache has nothing fresh.
   * @returns the result of the read.
   */
  private async _cached<T>(key: string, read: () => Promise<T>): Promise<T> {
    const cached = this._cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      this._logger.log("Serving a Sentry read from cache.");
      return cached.data as T;
    }

    const now = Date.now();
    for (const [staleKey, entry] of this._cache) {
      if (entry.expiresAt <= now) {
        this._cache.delete(staleKey);
      }
    }

    const data = await read();
    this._cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  }

  /**
   * Reads the level of an issue, as Sentry writes it.
   * @param level the level of the row.
   * @returns the level, or an error for a level Sentry added after this code.
   */
  private _levelOf(level: string): SentryIssueLevel {
    return Object.values<string>(SentryIssueLevel).includes(level) ? level as SentryIssueLevel : SentryIssueLevel.Error;
  }

  /**
   * Builds the address of the organization on the web interface of Sentry, which the links of the issues start from.
   * @returns the address of the organization.
   * @throws AppException if the organization is not configured.
   */
  private _webUrl(): string {
    const organization = process.env.SENTRY_ORG;
    if (!organization) {
      throw new AppException("Missing Sentry configuration (SENTRY_ORG).", 500);
    }

    return `${process.env.SENTRY_API_URL || DEFAULT_SENTRY_API_URL}/organizations/${organization}`;
  }

  /**
   * Adds the environment of this Rocket to the parameters of a read.
   * @param params the parameters of the read.
   * @returns the query string.
   * @throws AppException if the environment is not configured: without it dev and prod would be counted together.
   */
  private _withEnvironment(params: URLSearchParams): string {
    const environment = process.env.SENTRY_ENVIRONMENT;
    if (!environment) {
      throw new AppException("Missing Sentry configuration (SENTRY_ENVIRONMENT).", 500);
    }

    params.set("environment", environment);
    return params.toString();
  }

  /**
   * Formats a moment as Sentry reads it in the parameters and in the searches: ISO 8601 in UTC, to the second.
   * @param date the moment.
   * @returns the formatted moment.
   */
  private _isoOf(date: Date): string {
    return date.toISOString().slice(0, 19);
  }

  /**
   * Reads the cursor of the next page from the `Link` header, when Sentry says it has results.
   * @param link the `Link` header.
   * @returns the cursor, or undefined on the last page.
   */
  private _nextCursorOf(link: string | null): string | undefined {
    const next = link?.split(",").find(part => part.includes('rel="next"') && part.includes('results="true"'));
    return next?.match(/cursor="([^"]+)"/)?.[1];
  }

  /**
   * Sends an authenticated GET to the endpoints of the organization.
   * @param path the path below the organization.
   * @param timeoutMs the longest wait for the answer.
   * @returns the answer, whatever its status.
   * @throws AppException if the token or the organization is missing, or Sentry does not answer in time.
   */
  private async _request(path: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<SentryAnswer> {
    const token = process.env.SENTRY_AUTH_TOKEN;
    const organization = process.env.SENTRY_ORG;
    const baseUrl = process.env.SENTRY_API_URL || DEFAULT_SENTRY_API_URL;
    if (!token || !organization) {
      throw new AppException("Missing Sentry configuration (SENTRY_AUTH_TOKEN, SENTRY_ORG).", 500);
    }

    // The timeout covers the body too, so the whole exchange stays in the try.
    try {
      const response = await fetch(`${baseUrl}/api/0/organizations/${organization}${path}`, {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      return { status: response.status, headers: response.headers, body: await response.text() };
    } catch (error) {
      this._logger.warn(`Sentry request GET ${path} got no answer`, error);
      throw new AppException("Sentry could not be reached or did not answer in time.", 504);
    }
  }

  /**
   * Checks the status of an answer and parses its JSON body.
   * @param answer the answer of Sentry.
   * @param what the endpoint, for the logs.
   * @returns the parsed body.
   * @throws AppException if Sentry answered with an error, a rate limit included, or with a body that is not JSON.
   */
  private _parse<T>(answer: SentryAnswer, what: string): T {
    if (answer.status === 429) {
      this._logger.warn(`Sentry rate limit on ${what}: ${answer.headers.get("X-Sentry-Rate-Limit-Remaining")} left, reset at ${answer.headers.get("X-Sentry-Rate-Limit-Reset")}.`);
      throw new AppException("Sentry refused the request because of its rate limits: try again in a minute.", 502);
    }
    if (answer.status < 200 || answer.status >= 300) {
      this._logger.warn(`Sentry request on ${what} failed: ${answer.status} - ${answer.body}`);
      throw new AppException(`Sentry request failed with status ${answer.status}.`, 502);
    }

    try {
      return JSON.parse(answer.body) as T;
    } catch {
      this._logger.warn(`Sentry request on ${what} answered with a body that is not JSON.`);
      throw new AppException("Sentry answered with an unreadable body.", 502);
    }
  }
}
