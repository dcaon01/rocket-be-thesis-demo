import { MixpanelLeverRule } from "../../products/classes/mixpanel-lever-rule.class";
import { MixpanelInactivityScope } from "../../products/enums/mixpanel-inactivity-scope.enum";
import { MixpanelLever } from "../../products/enums/mixpanel-lever.enum";
import { IMPLIED_RULE_DIRECTION, MixpanelRuleDirection } from "../../products/enums/mixpanel-rule-direction.enum";
import { MixpanelRuleShape } from "../../products/enums/mixpanel-rule-shape.enum";
import { MixpanelRuleUnit } from "../../products/enums/mixpanel-rule-unit.enum";
import { MixpanelQueryUser, MixpanelRuleQuery, MixpanelRuleStats } from "../../mixpanel/interfaces/mixpanel-rule-stats.interface";
import { LeverOutcome } from "../enums/lever-outcome.enum";

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days after the credentials the activation of a tenant is judged on; its outcome stays as it was then (UR-RK-223). */
export const ACTIVATION_DAYS = 7;

/** Days after the credentials from which the operational and value levers judge a tenant: the third week (UR-RK-223). */
export const SETTLED_DAYS = 21;

/** Days an inactivity looks back: a tenant with no event in them is past any sensible threshold. */
export const INACTIVITY_LOOKBACK_DAYS = 90;

/** Events every product sends with the same names (UR-RK-224). */
export const MIXPANEL_CORE_EVENTS = ['login', 'session_started', 'session_ended', 'page_viewed', 'error_encountered', 'feature_abandoned'];

/** Shapes that measure over a rolling window ending on the evaluation date. */
const WINDOWED_SHAPES = [MixpanelRuleShape.Cadence, MixpanelRuleShape.Coverage, MixpanelRuleShape.PropertyAverage];

/** Stats of a tenant with no event in the read. */
const NO_EVENTS: MixpanelRuleStats = {
  firstAnchorAt: null,
  firstEventAt: null,
  lastEventAt: null,
  count: 0,
  sum: 0,
  samples: 0,
  baseValues: 0,
  coveredValues: 0,
};

/** An active user of a tenant, as an inactivity per user needs to know it. */
export interface AdoptionUser {
  /** Identifier of the user, the Cognito sub that products send as `distinct_id`. */
  id: string;
  /** Epoch milliseconds the user was created at. */
  createdAt: number;
  /** Roles of the user in Rocket. */
  roles: string[];
}

/** What the evaluation needs to know of a tenant besides its events. */
export interface AdoptionTenant {
  /** Epoch milliseconds its credentials were delivered at, or it was created at when no order line says so. */
  deliveredAt: number;
  /** Users of the tenant active on the product. */
  activeUsers: number;
  /** The active users themselves, read only when the product has an inactivity per user. */
  users?: AdoptionUser[];
}

/** Outcome of a tenant on a rule, with the measured value when there is one. */
export interface RuleResult {
  /** Identifier of the rule judged. */
  ruleId: string;
  /** How the tenant came out of the rule. */
  outcome: LeverOutcome;
  /** Measured value, in the unit of the rule, percent on a coverage; null when nothing could be measured. */
  value: number | null;
}

/** Outcome of a tenant on a lever: the one of its worst rule, with the outcome of each rule. */
export interface LeverResult {
  /** Lever judged. */
  lever: MixpanelLever;
  /** How the tenant came out of the lever. */
  outcome: LeverOutcome;
  /** Measured value of the rule that decided the outcome; null when nothing could be measured. */
  value: number | null;
  /** How the tenant came out of each rule of the lever. */
  rules: RuleResult[];
}

/** Outcomes from the worst to the best, among the ones that judge. */
const JUDGED_OUTCOMES = [LeverOutcome.Failing, LeverOutcome.AtRisk, LeverOutcome.Compliant];

/**
 * Moves a moment back by a number of units of a rule. Working days skip Saturdays and Sundays.
 * @param at the moment, in epoch milliseconds.
 * @param value the number of units.
 * @param unit the unit.
 * @returns the earlier moment, in epoch milliseconds.
 */
export function subtractUnits(at: number, value: number, unit: MixpanelRuleUnit): number {
  if (unit !== MixpanelRuleUnit.WorkingDays) {
    return at - value * (unit === MixpanelRuleUnit.Weeks ? 7 : 1) * DAY_MS;
  }

  const day = new Date(at);
  let left = value;
  while (left > 0) {
    day.setUTCDate(day.getUTCDate() - 1);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      left -= 1;
    }
  }
  return day.getTime();
}

/**
 * Measures the time between two moments in the unit of a rule. Days and weeks are fractional; working days count the
 * weekdays after the day of `from` up to the day of `to`, so that «within 2 working days» means by the end of the
 * second one.
 * @param from the earlier moment, in epoch milliseconds.
 * @param to the later moment, in epoch milliseconds.
 * @param unit the unit.
 * @returns the time between them, zero when `to` is not later.
 */
export function unitsBetween(from: number, to: number, unit: MixpanelRuleUnit): number {
  if (to <= from) {
    return 0;
  }
  if (unit !== MixpanelRuleUnit.WorkingDays) {
    return (to - from) / ((unit === MixpanelRuleUnit.Weeks ? 7 : 1) * DAY_MS);
  }

  const day = new Date(from);
  day.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  let count = 0;
  while (day < end) {
    day.setUTCDate(day.getUTCDate() + 1);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      count += 1;
    }
  }
  return count;
}

/**
 * Turns a rule into what the accumulation of the events reads for it, with its window opening on the evaluation date.
 * @param rule the rule.
 * @param asOf the evaluation moment, in epoch milliseconds.
 * @returns the query of the rule.
 */
export function toRuleQuery(rule: MixpanelLeverRule, asOf: number): MixpanelRuleQuery {
  let windowStart = 0;
  if (WINDOWED_SHAPES.includes(rule.shape)) {
    windowStart = subtractUnits(asOf, rule.windowValue ?? 1, rule.unit);
  } else if (rule.shape === MixpanelRuleShape.Inactivity) {
    windowStart = asOf - INACTIVITY_LOOKBACK_DAYS * DAY_MS;
  }

  return {
    key: rule.id,
    shape: rule.shape,
    eventNames: rule.eventNames ?? [],
    anchorEventNames: rule.anchorEventNames ?? [],
    property: rule.property ?? null,
    inactivityScope: rule.inactivityScope ?? null,
    closingEventNames: rule.closingEventNames ?? [],
    userRoles: rule.userRoles ?? null,
    windowStart,
  };
}

/**
 * Finds the first moment the rules of a product need to read: the earliest window, the start of the activation days
 * ending in the period, and the oldest delivery when a milestone judges another lever on every tenant.
 * @param rules the rules of the product.
 * @param asOf the evaluation moment, in epoch milliseconds.
 * @param periodStart the start of the period, in epoch milliseconds.
 * @param oldestDelivery the oldest delivery among the tenants, in epoch milliseconds.
 * @returns the first moment to read, in epoch milliseconds.
 */
export function readStart(rules: MixpanelLeverRule[], asOf: number, periodStart: number, oldestDelivery: number): number {
  return Math.min(asOf, ...rules.map(rule => {
    if (rule.shape !== MixpanelRuleShape.Milestone) {
      return toRuleQuery(rule, asOf).windowStart;
    }
    return rule.lever === MixpanelLever.Activation ? periodStart - ACTIVATION_DAYS * DAY_MS : oldestDelivery;
  }));
}

/**
 * Judges a tenant on the rules of a lever (UR-RK-223) and combines them: the lever comes out as its worst judged rule,
 * is not assessable only when every rule is, and shows the rules in observation without coloring.
 * @param lever the lever.
 * @param rules the rules of the lever.
 * @param stats what the events of the tenant gave, by rule identifier; absent when it had none.
 * @param tenant the delivery, the active users and the users of the tenant.
 * @param asOf the evaluation moment, in epoch milliseconds.
 * @param periodStart the start of the period, in epoch milliseconds.
 * @returns the outcome of the tenant, or null when the lever does not judge it in the period.
 */
export function evaluateLever(
  lever: MixpanelLever,
  rules: MixpanelLeverRule[],
  stats: Record<string, MixpanelRuleStats>,
  tenant: AdoptionTenant,
  asOf: number,
  periodStart: number,
): LeverResult | null {
  const results = rules
    .map(rule => evaluateRule(rule, stats[rule.id], tenant, asOf, periodStart))
    .filter((result): result is RuleResult => result !== null);
  if (results.length === 0) {
    return null;
  }

  const decisive = JUDGED_OUTCOMES
    .map(outcome => results.find(result => result.outcome === outcome))
    .find(result => result !== undefined);
  const lead = decisive
    ?? results.find(result => result.outcome === LeverOutcome.Observed)
    ?? results[0];
  return { lever, outcome: lead.outcome, value: lead.value, rules: results };
}

/**
 * Judges a tenant on one rule. Each lever judges its own tenants: activation the ones whose activation days ended
 * within the period (the others are left out, not counted apart), the operational and value levers the ones past
 * their third week, the risk lever all of them.
 * @param rule the rule.
 * @param stats what the events of the tenant gave for the rule, absent when it had none.
 * @param tenant the delivery, the active users and the users of the tenant.
 * @param asOf the evaluation moment, in epoch milliseconds.
 * @param periodStart the start of the period, in epoch milliseconds.
 * @returns the outcome of the tenant, or null when the lever does not judge it in the period.
 */
export function evaluateRule(
  rule: MixpanelLeverRule,
  stats: MixpanelRuleStats | undefined,
  tenant: AdoptionTenant,
  asOf: number,
  periodStart: number,
): RuleResult | null {
  const notAssessable: RuleResult = { ruleId: rule.id, outcome: LeverOutcome.NotAssessable, value: null };

  if (rule.lever === MixpanelLever.Activation) {
    const activationEnd = tenant.deliveredAt + ACTIVATION_DAYS * DAY_MS;
    if (activationEnd < periodStart || activationEnd > asOf) {
      return null;
    }
  } else if (rule.lever !== MixpanelLever.Risk && asOf - tenant.deliveredAt < SETTLED_DAYS * DAY_MS) {
    return notAssessable;
  }

  const measure = measureRule(rule, stats ?? NO_EVENTS, tenant, asOf);
  if (!measure) {
    return notAssessable;
  }

  const value = Math.round(measure.value * 100) / 100;
  const outcome = judge(rule, value);
  // A milestone not reached yet is pending while its time is not over: neither a success nor a failure.
  if (!measure.reached && outcome !== LeverOutcome.Failing) {
    return notAssessable;
  }
  return { ruleId: rule.id, outcome, value };
}

/**
 * Measures a rule on a tenant, as its shape says.
 * @param rule the rule.
 * @param stats what the events of the tenant gave for the rule.
 * @param tenant the delivery and the active users of the tenant.
 * @param asOf the evaluation moment, in epoch milliseconds.
 * @returns the value, and whether a milestone was reached; null when the sample is too small to measure.
 */
function measureRule(
  rule: MixpanelLeverRule,
  stats: MixpanelRuleStats,
  tenant: AdoptionTenant,
  asOf: number,
): { value: number; reached: boolean } | null {
  const minSample = rule.minSample ?? 1;

  switch (rule.shape) {
    case MixpanelRuleShape.Milestone: {
      const start = rule.anchorEventNames?.length ? stats.firstAnchorAt : tenant.deliveredAt;
      if (start === null) {
        // The start never came: the time from the credentials is a lower bound of the one asked.
        return { value: unitsBetween(tenant.deliveredAt, asOf, rule.unit), reached: false };
      }
      if (stats.firstEventAt === null) {
        return { value: unitsBetween(start, asOf, rule.unit), reached: false };
      }
      return { value: unitsBetween(start, stats.firstEventAt, rule.unit), reached: true };
    }
    case MixpanelRuleShape.Cadence:
      if (rule.perActiveUser && tenant.activeUsers === 0) {
        return null;
      }
      return { value: stats.count / (rule.perActiveUser ? tenant.activeUsers : 1), reached: true };
    case MixpanelRuleShape.Coverage:
      if (stats.baseValues < minSample) {
        return null;
      }
      return { value: (stats.coveredValues / stats.baseValues) * 100, reached: true };
    case MixpanelRuleShape.PropertyAverage:
      if (stats.samples < minSample) {
        return null;
      }
      return { value: stats.sum / stats.samples, reached: true };
    case MixpanelRuleShape.Inactivity:
      return measureInactivity(rule, stats, tenant, asOf);
  }
}

/**
 * Lists the users of a tenant that an inactivity per user can look at on a date, each with the moment its silence
 * counts from when it has no event: the latest of its creation, the delivery of the tenant and the start of the
 * lookback. The users are the active ones today, so for a past date the ones created after it are left out and the
 * ones deactivated since are missing.
 * @param tenant the delivery and the users of the tenant.
 * @param asOf the evaluation moment, in epoch milliseconds.
 * @returns the floor and the roles of each user, by user id.
 */
function usersAsOf(tenant: AdoptionTenant, asOf: number): Record<string, MixpanelQueryUser> {
  const lookbackStart = Math.max(tenant.deliveredAt, asOf - INACTIVITY_LOOKBACK_DAYS * DAY_MS);

  return Object.fromEntries((tenant.users ?? [])
    .filter(user => user.createdAt <= asOf)
    .map(user => [user.id, { floor: Math.max(user.createdAt, lookbackStart), roles: user.roles }]));
}

/**
 * Lists the users the inactivities per user of a product read, by tenant, to hand them once to the accumulation of the events.
 * @param tenants the tenants of the product with their users.
 * @param asOf the evaluation moment, in epoch milliseconds.
 * @returns the users of each tenant that has some.
 */
export function toQueryUsers(tenants: Map<string, AdoptionTenant>, asOf: number): Record<string, Record<string, MixpanelQueryUser>> {
  return Object.fromEntries([...tenants]
    .map(([tenantId, tenant]) => [tenantId, usersAsOf(tenant, asOf)] as const)
    .filter(([, users]) => Object.keys(users).length > 0));
}

/**
 * Measures an inactivity: the time since the last event of the tenant, or the longest silence among its users or
 * among its open objects.
 * @param rule the rule.
 * @param stats what the events of the tenant gave for the rule.
 * @param tenant the delivery and the users of the tenant.
 * @param asOf the evaluation moment, in epoch milliseconds.
 * @returns the value, always reached; null when there is no user or object to look at.
 */
function measureInactivity(
  rule: MixpanelLeverRule,
  stats: MixpanelRuleStats,
  tenant: AdoptionTenant,
  asOf: number,
): { value: number; reached: boolean } | null {
  if (rule.inactivityScope === MixpanelInactivityScope.User) {
    const roles = rule.userRoles ?? [];
    const floors = Object.values(usersAsOf(tenant, asOf))
      .filter(user => roles.length === 0 || user.roles.some(role => roles.includes(role)))
      .map(user => user.floor);
    // A tenant with no event at all is absent from the read, so its oldest silence is the oldest floor.
    const oldest = stats.oldestSubjectAt ?? floors.reduce((min, floor) => Math.min(min, floor), Infinity);
    return floors.length === 0 ? null : { value: unitsBetween(oldest, asOf, rule.unit), reached: true };
  }

  if (rule.inactivityScope === MixpanelInactivityScope.Object) {
    return stats.oldestSubjectAt == null ? null : { value: unitsBetween(stats.oldestSubjectAt, asOf, rule.unit), reached: true };
  }

  // With no event in the read, the time since the delivery or the start of the read is a lower bound.
  const lookbackStart = Math.max(tenant.deliveredAt, asOf - INACTIVITY_LOOKBACK_DAYS * DAY_MS);
  return { value: unitsBetween(stats.lastEventAt ?? lookbackStart, asOf, rule.unit), reached: true };
}

/**
 * Places a value against the thresholds of a rule, on the side its direction says is good. A rule in observation
 * measures without judging.
 * @param rule the rule.
 * @param value the measured value.
 * @returns the outcome.
 */
function judge(rule: MixpanelLeverRule, value: number): LeverOutcome {
  if (rule.observationOnly) {
    return LeverOutcome.Observed;
  }

  const atLeast = (rule.direction ?? IMPLIED_RULE_DIRECTION[rule.shape]) === MixpanelRuleDirection.AtLeast;
  const within = (threshold: number): boolean => atLeast ? value >= threshold : value <= threshold;
  if (within(rule.greenThreshold)) {
    return LeverOutcome.Compliant;
  }
  return within(rule.yellowThreshold) ? LeverOutcome.AtRisk : LeverOutcome.Failing;
}
