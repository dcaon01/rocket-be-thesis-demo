import { MixpanelInactivityScope } from "../../products/enums/mixpanel-inactivity-scope.enum";
import { MixpanelRuleShape } from "../../products/enums/mixpanel-rule-shape.enum";
import { MixpanelQueryUser, MixpanelRuleQuery, MixpanelRuleStats, MixpanelTenantRuleStatsQuery } from "../interfaces/mixpanel-rule-stats.interface";

/** An event as the rules read it: its name, its time in epoch milliseconds, who made it and what it carries. */
export interface MixpanelEvent {
  /** Name of the event. */
  name: string;
  /** When the event happened, in epoch milliseconds. */
  time: number;
  /** Identifier of who made it; for the users of a tenant it is the id of the user in Rocket. */
  distinctId: string | undefined;
  /** Identifier Mixpanel deduplicates on: the export repeats an event, the queries of Mixpanel count it once. */
  insertId: string | undefined;
  /** Properties the event carries, among them `tenant_id`. */
  properties: Record<string, unknown>;
}

/** What a rule has gathered on a tenant so far, before it is reduced to its `MixpanelRuleStats`. */
interface RuleAccumulator {
  /** First anchor event from the start of the tenant (MILESTONE). */
  firstAnchorAt: number | null;
  /** First measured event from the start of the tenant (MILESTONE). */
  firstEventAt: number | null;
  /** Last measured event, or event of the common core (INACTIVITY of the tenant). */
  lastEventAt: number | null;
  /** Occurrences of the measured event in the window (CADENCE). */
  count: number;
  /** Sum of the numeric property in the window (PROPERTY_AVERAGE). */
  sum: number;
  /** Occurrences with a numeric property in the window (PROPERTY_AVERAGE). */
  samples: number;
  /** Bit 1 marks a value of the base of a COVERAGE, bit 2 a value the measured event reached. */
  values: Map<string, number>;
  /** Last event of each user or object an INACTIVITY looks at. */
  lastBySubject: Map<string, number>;
  /** Objects an INACTIVITY per object has seen closed. */
  closed: Set<string>;
}

/** Bit of a COVERAGE value that belongs to the base. */
const IN_BASE = 1;

/** Bit of a COVERAGE value that the measured event reached. */
const IN_EVENT = 2;

/**
 * Smaller of two instants, ignoring the one that is missing.
 * @param a the first instant, or null.
 * @param b the second instant, or null.
 * @returns the earlier one, null when both are missing.
 */
function earliest(a: number | null, b: number | null): number | null {
  return a === null ? b : (b === null ? a : Math.min(a, b));
}

/**
 * Larger of two instants, ignoring the one that is missing.
 * @param a the first instant, or null.
 * @param b the second instant, or null.
 * @returns the later one, null when both are missing.
 */
function latest(a: number | null, b: number | null): number | null {
  return a === null ? b : (b === null ? a : Math.max(a, b));
}

/**
 * Turns the value of a property into the key it is counted under.
 * @param value the value of the property.
 * @returns the value itself when it is text, its JSON otherwise (so `5` and `"5"` count as one value).
 */
function keyOf(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Tells whether an INACTIVITY per user looks at a user, by its roles.
 * @param rule the rule.
 * @param user the user.
 * @returns true when the rule filters no role or the user has one of them.
 */
function hasRole(rule: MixpanelRuleQuery, user: MixpanelQueryUser): boolean {
  return !rule.userRoles?.length || user.roles.some(role => rule.userRoles?.includes(role));
}

/**
 * Accumulates, event by event, what the rules of a product ask of its tenants. It is the calculation the JQL script did
 * inside Mixpanel, now done on the events the Export API returns: the order the events come in does not matter, as
 * it only keeps minimums, maximums, counts and sets.
 */
export class MixpanelRuleStatsAccumulator {
  /** Start of each tenant read, in epoch milliseconds. */
  private readonly _starts: Map<string, number>;

  /** Active users an INACTIVITY per user looks at, by tenant and user id. */
  private readonly _users: Map<string, Map<string, MixpanelQueryUser>>;

  /** Events of the common core. */
  private readonly _core: Set<string>;

  /** Accumulators of each tenant that had an event, by rule key. */
  private readonly _byTenant = new Map<string, Map<string, RuleAccumulator>>();

  /** For each event a CADENCE or PROPERTY_AVERAGE counts, the earliest instant a rule counts it from. */
  private readonly _countedFrom = new Map<string, number>();

  /** Counted events already added, by name and `$insert_id`, so that a repeated one counts once. */
  private readonly _seen = new Set<string>();

  /**
   * @param _query the rules, the tenants and the users of the query.
   */
  constructor(private readonly _query: MixpanelTenantRuleStatsQuery) {
    this._starts = new Map(Object.entries(_query.starts));
    this._users = new Map(Object.entries(_query.users ?? {}).map(([tenantId, users]) => [tenantId, new Map(Object.entries(users))]));
    this._core = new Set(_query.coreEventNames);

    for (const rule of _query.rules) {
      const counts = rule.shape === MixpanelRuleShape.Cadence || rule.shape === MixpanelRuleShape.PropertyAverage;
      if (counts) {
        rule.eventNames.forEach(name => this._countedFrom.set(name, Math.min(this._countedFrom.get(name) ?? Infinity, rule.windowStart)));
      }
    }
  }

  /**
   * Adds an event to the tenant it belongs to. Events of tenants that are not read are ignored. The export repeats
   * events, and only the counts of a CADENCE or a PROPERTY_AVERAGE grow with a repeat: so an event they count is added
   * once per `$insert_id`, and the other events are not remembered, which keeps the memory to their windows.
   * @param event the event.
   */
  add(event: MixpanelEvent): void {
    const tenantId = event.properties.tenant_id;
    const start = typeof tenantId === "string" ? this._starts.get(tenantId) : undefined;
    if (typeof tenantId !== "string" || start === undefined) {
      return;
    }

    const countedFrom = this._countedFrom.get(event.name);
    if (event.insertId !== undefined && countedFrom !== undefined && event.time >= countedFrom) {
      const key = `${event.name}|${event.insertId}`;
      if (this._seen.has(key)) {
        return;
      }
      this._seen.add(key);
    }

    let accumulators = this._byTenant.get(tenantId);
    if (!accumulators) {
      accumulators = new Map(this._query.rules.map(rule => [rule.key, this._emptyAccumulator()]));
      this._byTenant.set(tenantId, accumulators);
    }

    for (const rule of this._query.rules) {
      this._accumulate(rule, event, tenantId, start, accumulators.get(rule.key));
    }
  }

  /**
   * Reduces what was gathered to the stats of each rule. The distinct values of a coverage leave as two counts, and an
   * inactivity per user or per object as the oldest of its subjects, so the answer does not grow with them.
   * @returns the stats of each rule by tenant; tenants with no event are absent.
   */
  result(): Map<string, Record<string, MixpanelRuleStats>> {
    const result = new Map<string, Record<string, MixpanelRuleStats>>();
    for (const [tenantId, accumulators] of this._byTenant) {
      const stats: Record<string, MixpanelRuleStats> = {};
      for (const rule of this._query.rules) {
        stats[rule.key] = this._toStats(rule, tenantId, accumulators.get(rule.key));
      }
      result.set(tenantId, stats);
    }
    return result;
  }

  /**
   * Creates the accumulator of a rule on a tenant, with nothing gathered yet.
   * @returns the empty accumulator.
   */
  private _emptyAccumulator(): RuleAccumulator {
    return {
      firstAnchorAt: null,
      firstEventAt: null,
      lastEventAt: null,
      count: 0,
      sum: 0,
      samples: 0,
      values: new Map(),
      lastBySubject: new Map(),
      closed: new Set(),
    };
  }

  /**
   * Applies an event to the accumulator of a rule, as its shape asks.
   * @param rule the rule.
   * @param event the event.
   * @param tenantId the tenant of the event.
   * @param start when the tenant starts, in epoch milliseconds.
   * @param acc the accumulator of the rule on the tenant.
   */
  private _accumulate(rule: MixpanelRuleQuery, event: MixpanelEvent, tenantId: string, start: number, acc: RuleAccumulator): void {
    const time = event.time;
    const isEvent = rule.eventNames.includes(event.name);
    const isAnchor = rule.anchorEventNames.includes(event.name);

    if (rule.shape === MixpanelRuleShape.Milestone) {
      if (time < start) {
        return;
      }
      if (isAnchor) {
        acc.firstAnchorAt = earliest(acc.firstAnchorAt, time);
      }
      if (isEvent) {
        acc.firstEventAt = earliest(acc.firstEventAt, time);
      }
      return;
    }

    if (rule.shape === MixpanelRuleShape.Inactivity) {
      if (time < rule.windowStart) {
        return;
      }
      const countsAsActivity = rule.eventNames.length > 0 ? isEvent : this._core.has(event.name);

      if (rule.inactivityScope === MixpanelInactivityScope.User) {
        const user = event.distinctId === undefined ? undefined : this._users.get(tenantId)?.get(event.distinctId);
        if (event.distinctId !== undefined && user && hasRole(rule, user) && countsAsActivity) {
          acc.lastBySubject.set(event.distinctId, Math.max(acc.lastBySubject.get(event.distinctId) ?? time, time));
        }
      } else if (rule.inactivityScope === MixpanelInactivityScope.Object) {
        const object = rule.property ? event.properties[rule.property] : undefined;
        if (object === undefined || object === null) {
          return;
        }
        if (rule.closingEventNames.includes(event.name)) {
          acc.closed.add(keyOf(object));
          return;
        }
        if (rule.eventNames.length === 0 || isEvent) {
          const subject = keyOf(object);
          acc.lastBySubject.set(subject, Math.max(acc.lastBySubject.get(subject) ?? time, time));
        }
      } else if (countsAsActivity) {
        acc.lastEventAt = latest(acc.lastEventAt, time);
      }
      return;
    }

    if (time < rule.windowStart) {
      return;
    }

    if (rule.shape === MixpanelRuleShape.Cadence) {
      if (isEvent) {
        acc.count += 1;
      }
      return;
    }

    const value = rule.property ? event.properties[rule.property] : undefined;
    if (rule.shape === MixpanelRuleShape.PropertyAverage) {
      if (isEvent && typeof value === "number") {
        acc.sum += value;
        acc.samples += 1;
      }
      return;
    }

    if (value === undefined || value === null) {
      return;
    }
    const key = keyOf(value);
    if (rule.anchorEventNames.length === 0 || isAnchor) {
      acc.values.set(key, (acc.values.get(key) ?? 0) | IN_BASE);
    }
    if (isEvent) {
      acc.values.set(key, (acc.values.get(key) ?? 0) | IN_EVENT);
    }
  }

  /**
   * Reduces the accumulator of a rule on a tenant to its stats.
   * @param rule the rule.
   * @param tenantId the tenant.
   * @param acc the accumulator of the rule on the tenant.
   * @returns the stats of the rule on the tenant.
   */
  private _toStats(rule: MixpanelRuleQuery, tenantId: string, acc: RuleAccumulator): MixpanelRuleStats {
    let baseValues = 0;
    let coveredValues = 0;
    for (const bits of acc.values.values()) {
      if (bits & IN_BASE) {
        baseValues += 1;
        if (bits & IN_EVENT) {
          coveredValues += 1;
        }
      }
    }

    return {
      firstAnchorAt: acc.firstAnchorAt,
      firstEventAt: acc.firstEventAt,
      lastEventAt: acc.lastEventAt,
      count: acc.count,
      sum: acc.sum,
      samples: acc.samples,
      baseValues,
      coveredValues,
      oldestSubjectAt: this._oldestSubjectAt(rule, tenantId, acc),
    };
  }

  /**
   * Finds the longest silence of an INACTIVITY per user or per object: the oldest last event among its subjects. A
   * user with no event counts from its floor, an object closed by its closing event does not count.
   * @param rule the rule.
   * @param tenantId the tenant.
   * @param acc the accumulator of the rule on the tenant.
   * @returns the oldest last event, null when the rule is not per user or per object or there is no subject.
   */
  private _oldestSubjectAt(rule: MixpanelRuleQuery, tenantId: string, acc: RuleAccumulator): number | null {
    let oldest: number | null = null;
    if (rule.shape !== MixpanelRuleShape.Inactivity) {
      return oldest;
    }

    if (rule.inactivityScope === MixpanelInactivityScope.User) {
      for (const [userId, user] of this._users.get(tenantId) ?? []) {
        if (hasRole(rule, user)) {
          oldest = earliest(oldest, acc.lastBySubject.get(userId) ?? user.floor);
        }
      }
    } else if (rule.inactivityScope === MixpanelInactivityScope.Object) {
      for (const [object, last] of acc.lastBySubject) {
        if (!acc.closed.has(object)) {
          oldest = earliest(oldest, last);
        }
      }
    }
    return oldest;
  }
}
