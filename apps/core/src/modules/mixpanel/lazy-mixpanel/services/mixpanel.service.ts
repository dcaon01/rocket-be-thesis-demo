import { createHash } from "crypto";
import { Injectable, Logger } from "@nestjs/common";
import { DatabaseException } from "../../../../errors/exception-types";
import { MixpanelEvent, MixpanelRuleStatsAccumulator } from "../../helpers/rule-stats.helper";
import { MixpanelRuleStats, MixpanelTenantRuleStatsQuery } from "../../interfaces/mixpanel-rule-stats.interface";
import { MixpanelInactivityScope } from "../../../products/enums/mixpanel-inactivity-scope.enum";
import { MixpanelRuleShape } from "../../../products/enums/mixpanel-rule-shape.enum";

/** Default base URL of the Mixpanel Export API (EU residency), the only raw data endpoint the Free plan allows. */
const DEFAULT_MIXPANEL_API_BASE_URL = "https://data-eu.mixpanel.com";

/** Server-side cache TTL for Mixpanel query results (~5 minutes), to respect the Export API rate limit (60 per hour). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Cached query result with its expiry. */
interface CacheEntry {
  data: Map<string, Record<string, MixpanelRuleStats>>;
  expiresAt: number;
}

/**
 * Server-side proxy for the Mixpanel Export API, which returns the raw events: the rules are accumulated here, because
 * the Query API (JQL) is not part of the Free plan. Keeps the read-only service-account secret on
 * the backend (never in the FE bundle), mirroring the HubSpot integration. The Mixpanel project is
 * configured per-product (passed in as `projectId`); the service-account credentials and the optional base URL are
 * read from `process.env` (MIXPANEL_SERVICE_ACCOUNT_USERNAME, MIXPANEL_SERVICE_ACCOUNT_SECRET,
 * MIXPANEL_API_BASE_URL, MIXPANEL_ENVIRONMENT) since one service account can access all projects. A project holds the dev and
 * prod events of a product, and when MIXPANEL_ENVIRONMENT is set the export keeps only those of this Rocket.
 */
@Injectable()
export class MixpanelService {
  /** Logger instance for MixpanelService. */
  private readonly _logger = new Logger(MixpanelService.name);

  /** In-memory cache of query results keyed by query parameters, with a short TTL (rate-limit guard). */
  private readonly _cache = new Map<string, CacheEntry>();

  /**
   * Reads the events of the days asked in one export and returns, per tenant, what they gave for each rule. Results are cached
   * in-memory for ~5 minutes per distinct set of parameters.
   * @param query the days to read, the tenants with their starts and the rules.
   * @returns a Map keyed by tenant id; each value maps the rule key to its stats. Tenants with no event are absent.
   * @throws DatabaseException if Mixpanel is not configured or the query fails.
   */
  async getTenantRuleStats(
    query: MixpanelTenantRuleStatsQuery,
  ): Promise<Map<string, Record<string, MixpanelRuleStats>>> {
    const cacheKey = this._buildCacheKey(query);
    const cached = this._cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      this._logger.log(`Serving Mixpanel rule stats from cache (project ${query.projectId}, ${query.from} to ${query.to}).`);
      return cached.data;
    }

    try {
      const accumulator = new MixpanelRuleStatsAccumulator(query);
      await this._exportEvents(query, event => accumulator.add(event));

      const statsByTenant = accumulator.result();
      this._cache.set(cacheKey, { data: statsByTenant, expiresAt: Date.now() + CACHE_TTL_MS });
      return statsByTenant;
    } catch (error) {
      this._logger.error(`Error retrieving rule stats from Mixpanel project ${query.projectId}`, error);
      throw new DatabaseException("An error occurred while querying Mixpanel.", error);
    }
  }

  /**
   * Lists the events the query has to read, so that Mixpanel scans only those. A coverage whose base is any event
   * needs them all.
   * @param query the query.
   * @returns the event names, or an empty list for every event.
   */
  private _eventSelectors(query: MixpanelTenantRuleStatsQuery): string[] {
    const names = new Set<string>();
    for (const rule of query.rules) {
      const everyEventOfObject = rule.shape === MixpanelRuleShape.Inactivity
        && rule.inactivityScope === MixpanelInactivityScope.Object && rule.eventNames.length === 0;
      if ((rule.shape === MixpanelRuleShape.Coverage && rule.anchorEventNames.length === 0) || everyEventOfObject) {
        return [];
      }
      if (rule.shape === MixpanelRuleShape.Inactivity && rule.eventNames.length === 0) {
        query.coreEventNames.forEach(name => names.add(name));
      }
      [...rule.eventNames, ...rule.anchorEventNames, ...rule.closingEventNames].forEach(name => names.add(name));
    }
    return [...names];
  }

  /**
   * Exports the events of the days of the query from Mixpanel and hands them over one by one. The response is read as
   * it arrives, one event per line, so the events are never all in memory.
   * @param query the days to read, the project and the events to export.
   * @param onEvent called with each event of the export.
   * @throws Error if Mixpanel is not configured or answers with an error status.
   */
  private async _exportEvents(query: MixpanelTenantRuleStatsQuery, onEvent: (event: MixpanelEvent) => void): Promise<void> {
    const username = process.env.MIXPANEL_SERVICE_ACCOUNT_USERNAME;
    const secret = process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET;
    const baseUrl = process.env.MIXPANEL_API_BASE_URL || DEFAULT_MIXPANEL_API_BASE_URL;
    const environment = process.env.MIXPANEL_ENVIRONMENT;

    if (!query.projectId) {
      throw new Error("Missing Mixpanel project id for the requested product.");
    }
    if (!username || !secret) {
      throw new Error(
        "Missing Mixpanel configuration (MIXPANEL_SERVICE_ACCOUNT_USERNAME / MIXPANEL_SERVICE_ACCOUNT_SECRET).",
      );
    }

    const params = new URLSearchParams({
      project_id: query.projectId,
      from_date: query.from,
      to_date: query.to,
      time_in_ms: "true",
    });
    const eventNames = this._eventSelectors(query);
    if (eventNames.length > 0) {
      params.set("event", JSON.stringify(eventNames));
    }
    if (environment) {
      params.set("where", `properties["environment"] == ${JSON.stringify(environment)}`);
    }

    const authToken = Buffer.from(`${username}:${secret}`).toString("base64");
    const response = await fetch(`${baseUrl}/api/2.0/export?${params.toString()}`, {
      headers: { Authorization: `Basic ${authToken}`, Accept: "text/plain" },
    });

    if (!response.ok || !response.body) {
      const errorBody = await response.text();
      this._logger.warn(`Mixpanel export failed: ${response.status} - ${errorBody}`);
      throw new Error(`Mixpanel export failed with status ${response.status}.`);
    }

    const decoder = new TextDecoder();
    let pending = "";
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      lines.filter(line => line.trim()).forEach(line => onEvent(this._toEvent(line)));
    }
    pending += decoder.decode();
    if (pending.trim()) {
      onEvent(this._toEvent(pending));
    }
  }

  /**
   * Reads a line of the export into the shape the rules read.
   * @param line a JSON line of the export, `{ event, properties }` with the time in milliseconds.
   * @returns the event.
   */
  private _toEvent(line: string): MixpanelEvent {
    const { event, properties } = JSON.parse(line) as { event: string; properties: Record<string, unknown> };
    const { time, distinct_id: distinctId, $insert_id: insertId } = properties;
    return {
      name: event,
      time: time as number,
      distinctId: typeof distinctId === "string" ? distinctId : undefined,
      insertId: typeof insertId === "string" ? insertId : undefined,
      properties,
    };
  }

  /**
   * Builds a stable cache key from the query parameters (tenants are sorted so order does not matter).
   * @param query the query parameters.
   * @returns the cache key.
   */
  private _buildCacheKey(query: MixpanelTenantRuleStatsQuery): string {
    const starts = Object.entries(query.starts).sort(([a], [b]) => a.localeCompare(b));
    return `${query.projectId}|${query.from}|${query.to}|${JSON.stringify(query.rules)}|${JSON.stringify(starts)}|${createHash("sha1").update(JSON.stringify(query.users ?? {})).digest("hex")}`;
  }
}
