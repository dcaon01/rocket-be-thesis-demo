import { MixpanelInactivityScope } from "../../products/enums/mixpanel-inactivity-scope.enum";
import { MixpanelRuleShape } from "../../products/enums/mixpanel-rule-shape.enum";

/**
 * What a rule asks of the events, as the accumulation of the events reads it: the events, the property, and from when they count.
 */
export interface MixpanelRuleQuery {
  /** Key of the rule in the result, its identifier. */
  key: string;
  /** Shape of the rule, which says what to accumulate. */
  shape: MixpanelRuleShape;
  /** Events the rule measures, any of them; empty on an INACTIVITY that reads the common core. */
  eventNames: string[];
  /** Start of a MILESTONE or base of a COVERAGE, any of them; empty means the credentials or any event. */
  anchorEventNames: string[];
  /** Property counted by a COVERAGE, averaged by a PROPERTY_AVERAGE or identifying the objects of an INACTIVITY per object. */
  property?: string | null;
  /** What an INACTIVITY looks at; absent means the tenant. */
  inactivityScope?: MixpanelInactivityScope | null;
  /** Roles of the users an INACTIVITY per user looks at; absent or empty means all. */
  userRoles?: string[] | null;
  /** Events that close an object of an INACTIVITY per object, any of them. */
  closingEventNames: string[];
  /** Epoch milliseconds the window of the rule opens at; a MILESTONE counts from the start of each tenant instead. */
  windowStart: number;
}

/**
 * A user an INACTIVITY per user can look at: the moment its silence counts from when it has no event, and its roles.
 */
export interface MixpanelQueryUser {
  /** Epoch milliseconds the silence of the user counts from when it has no event. */
  floor: number;
  /** Roles of the user in Rocket. */
  roles: string[];
}

/**
 * Options for {@link MixpanelService.getTenantRuleStats}.
 */
export interface MixpanelTenantRuleStatsQuery {
  /** Mixpanel project id to query (one project per product). */
  projectId: string;
  /** First day read (YYYY-MM-DD, inclusive): the earliest window or start among the rules. */
  from: string;
  /** Evaluation day (YYYY-MM-DD, inclusive). */
  to: string;
  /** Tenants to read, with the epoch milliseconds their credentials were delivered at. */
  starts: Record<string, number>;
  /** Rules to accumulate. */
  rules: MixpanelRuleQuery[];
  /** Events of the common core, read by an INACTIVITY with no event. */
  coreEventNames: string[];
  /** Active users of the tenants, by tenant and user id, shared by every INACTIVITY per user. Absent when none needs them. */
  users?: Record<string, Record<string, MixpanelQueryUser>>;
}

/**
 * What the events of a tenant gave for a rule. Times are epoch milliseconds, null when the event never came.
 */
export interface MixpanelRuleStats {
  /** First of `anchorEventNames` from the start of the tenant (MILESTONE). */
  firstAnchorAt: number | null;
  /** First of `eventNames` from the start of the tenant (MILESTONE). */
  firstEventAt: number | null;
  /** Last of `eventNames`, or event of the common core (INACTIVITY). */
  lastEventAt: number | null;
  /** Occurrences of `eventNames` in the window (CADENCE). */
  count: number;
  /** Sum of the numeric `property` in the window (PROPERTY_AVERAGE). */
  sum: number;
  /** Occurrences with a numeric `property` in the window (PROPERTY_AVERAGE). */
  samples: number;
  /** Distinct `property` values of the base in the window (COVERAGE). */
  baseValues: number;
  /** Distinct `property` values of the base that also appear on `eventNames` (COVERAGE). */
  coveredValues: number;
  /**
   * Oldest last event among the users, or among the open objects (INACTIVITY per user or per object): the longest
   * silence. A user with no event counts from its floor. Null when there is no user or object to look at.
   */
  oldestSubjectAt?: number | null;
}
