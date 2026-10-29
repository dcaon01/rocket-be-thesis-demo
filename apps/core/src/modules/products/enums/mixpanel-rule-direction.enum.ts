import { MixpanelRuleShape } from './mixpanel-rule-shape.enum';

/**
 * Which side of the thresholds of a Mixpanel lever rule is the good one. It is chosen on the CADENCE and
 * PROPERTY_AVERAGE shapes (few errors are good, many timesheets are good), and implied by the others.
 */
export enum MixpanelRuleDirection {
  /** The value is good when it reaches the threshold. */
  AtLeast = 'AT_LEAST',
  /** The value is good when it stays within the threshold. */
  AtMost = 'AT_MOST',
}

/** Direction of the shapes that do not let it be chosen: a time is good when short, a coverage when high. */
export const IMPLIED_RULE_DIRECTION: Partial<Record<MixpanelRuleShape, MixpanelRuleDirection>> = {
  [MixpanelRuleShape.Milestone]: MixpanelRuleDirection.AtMost,
  [MixpanelRuleShape.Coverage]: MixpanelRuleDirection.AtLeast,
  [MixpanelRuleShape.Inactivity]: MixpanelRuleDirection.AtMost,
};
