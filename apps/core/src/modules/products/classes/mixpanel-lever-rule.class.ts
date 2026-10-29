import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateIf } from "class-validator";
import { MixpanelInactivityScope } from "../enums/mixpanel-inactivity-scope.enum";
import { MixpanelLever } from "../enums/mixpanel-lever.enum";
import { MixpanelRuleDirection } from "../enums/mixpanel-rule-direction.enum";
import { MixpanelRuleShape } from "../enums/mixpanel-rule-shape.enum";
import { MixpanelRuleUnit } from "../enums/mixpanel-rule-unit.enum";

/** Shapes that measure over a rolling window ending on the evaluation date. */
const WINDOWED_SHAPES = [MixpanelRuleShape.Cadence, MixpanelRuleShape.Coverage, MixpanelRuleShape.PropertyAverage];

/**
 * A rule of a lever on a product (UR-RK-223): the shape says what is measured, the events and the property
 * say on what, the thresholds say which value is good. Which fields count depends on the shape (see
 * `MixpanelRuleShape`); the ones a shape does not read are ignored. Each list of events counts any of its events, so
 * a measure can start from the first of two (a project or a quote) or count two actions as one. A lever has as many
 * rules as needed, and a tenant comes out of the lever as it comes out of the worst of them. The update of a product
 * replaces all its rules, so a client sends back the `id` of the ones it keeps: a rule without it is new.
 *
 * A tenant is judged compliant on the green side of `greenThreshold`, at risk up to `yellowThreshold`, failing
 * beyond it, and not assessable when it is too young for the lever or below `minSample`. A rule in observation is
 * measured but not judged, so that its thresholds can be set on the real distribution of the values.
 */
export class MixpanelLeverRule {
  /** Identifier of the rule, assigned by the backend when absent and kept on every update. */
  @ApiPropertyOptional({
    description: "Identifier of the rule, assigned by the backend when absent and kept on every update.",
    example: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    required: false,
    type: String,
  })
  @IsOptional()
  @IsUUID("4")
  id?: string;

  /** Lever this rule judges. */
  @ApiProperty({
    description: "Lever this rule judges.",
    enum: MixpanelLever,
    example: MixpanelLever.Activation,
    required: true,
  })
  @IsEnum(MixpanelLever)
  lever: MixpanelLever;

  /** Shape of the rule, that is what is measured. */
  @ApiProperty({
    description: "Shape of the rule, that is what is measured.",
    enum: MixpanelRuleShape,
    example: MixpanelRuleShape.Milestone,
    required: true,
  })
  @IsEnum(MixpanelRuleShape)
  shape: MixpanelRuleShape;

  /** Mixpanel events the rule measures, any of them counting. Optional on INACTIVITY only, where none means the common core. */
  @ApiPropertyOptional({
    description: "Mixpanel events the rule measures, any of them counting. Optional on INACTIVITY only, where none means the common core.",
    example: ["timesheet_created"],
    required: false,
    nullable: true,
    type: [String],
  })
  @ValidateIf((rule: MixpanelLeverRule) => rule.shape !== MixpanelRuleShape.Inactivity || !!rule.eventNames?.length)
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  eventNames?: string[] | null;

  /**
   * Events the measure starts from, the first of any of them: the start of a MILESTONE (the credentials when none) or
   * the base of a COVERAGE (any event when none). Ignored by the other shapes.
   */
  @ApiPropertyOptional({
    description: "Events the measure starts from, the first of any of them: the start of a MILESTONE (the credentials when none) or the base of a COVERAGE (any event when none). Ignored by the other shapes.",
    example: ["project_created", "quote_created"],
    required: false,
    nullable: true,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  anchorEventNames?: string[] | null;

  /**
   * Event property read by the rule: the id counted by a COVERAGE, the number averaged by a PROPERTY_AVERAGE, the id
   * of the objects of an INACTIVITY per object.
   */
  @ApiPropertyOptional({
    description: "Event property read by the rule: the id counted by a COVERAGE, the number averaged by a PROPERTY_AVERAGE, the id of the objects of an INACTIVITY per object.",
    example: "project_id",
    required: false,
    nullable: true,
    type: String,
  })
  @ValidateIf((rule: MixpanelLeverRule) =>
    rule.shape === MixpanelRuleShape.Coverage || rule.shape === MixpanelRuleShape.PropertyAverage
    || (rule.shape === MixpanelRuleShape.Inactivity && rule.inactivityScope === MixpanelInactivityScope.Object)
    || rule.property != null)
  @IsString()
  @IsNotEmpty()
  property?: string | null;

  /** Size of the rolling window, in `unit`, ending on the evaluation date. Required on CADENCE, COVERAGE and PROPERTY_AVERAGE. */
  @ApiPropertyOptional({
    description: "Size of the rolling window, in unit, ending on the evaluation date. Required on CADENCE, COVERAGE and PROPERTY_AVERAGE.",
    example: 4,
    required: false,
    nullable: true,
    type: Number,
  })
  @ValidateIf((rule: MixpanelLeverRule) => WINDOWED_SHAPES.includes(rule.shape) || rule.windowValue != null)
  @IsInt()
  @Min(1)
  windowValue?: number | null;

  /** Time unit of the window, and of the thresholds on MILESTONE and INACTIVITY. */
  @ApiProperty({
    description: "Time unit of the window, and of the thresholds on MILESTONE and INACTIVITY.",
    enum: MixpanelRuleUnit,
    example: MixpanelRuleUnit.WorkingDays,
    required: true,
  })
  @IsEnum(MixpanelRuleUnit)
  unit: MixpanelRuleUnit;

  /** Whether a CADENCE is divided by the active users of the tenant, for actions every user does. */
  @ApiPropertyOptional({
    description: "Whether a CADENCE is divided by the active users of the tenant, for actions every user does.",
    example: true,
    required: false,
    nullable: true,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  perActiveUser?: boolean | null;

  /** What an INACTIVITY looks at: the tenant, each of its users or each of its objects. Absent means the tenant. */
  @ApiPropertyOptional({
    description: "What an INACTIVITY looks at: the tenant, each of its users or each of its objects. Absent means the tenant.",
    enum: MixpanelInactivityScope,
    example: MixpanelInactivityScope.User,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(MixpanelInactivityScope)
  inactivityScope?: MixpanelInactivityScope | null;

  /** Events that close an object of an INACTIVITY per object, any of them taking it out of the ones measured. */
  @ApiPropertyOptional({
    description: "Events that close an object of an INACTIVITY per object, any of them taking it out of the ones measured.",
    example: ["project_completed"],
    required: false,
    nullable: true,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  closingEventNames?: string[] | null;

  /** Roles of the users an INACTIVITY per user looks at, from the roles of the user in Rocket. Absent or empty means all. */
  @ApiPropertyOptional({
    description: "Roles of the users an INACTIVITY per user looks at, from the roles of the user in Rocket. Absent or empty means all.",
    example: ["EMPLOYEE", "TEAM_LEAD"],
    required: false,
    nullable: true,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userRoles?: string[] | null;

  /** Which side of the thresholds is good. Required on CADENCE and PROPERTY_AVERAGE, implied by the other shapes. */
  @ApiPropertyOptional({
    description: "Which side of the thresholds is good. Required on CADENCE and PROPERTY_AVERAGE, implied by the other shapes.",
    enum: MixpanelRuleDirection,
    example: MixpanelRuleDirection.AtMost,
    required: false,
    nullable: true,
  })
  @ValidateIf((rule: MixpanelLeverRule) =>
    rule.shape === MixpanelRuleShape.Cadence || rule.shape === MixpanelRuleShape.PropertyAverage || rule.direction != null)
  @IsEnum(MixpanelRuleDirection)
  direction?: MixpanelRuleDirection | null;

  /** Value up to which, on the good side, the tenant is compliant. In percent on COVERAGE. */
  @ApiProperty({
    description: "Value up to which, on the good side, the tenant is compliant. In percent on COVERAGE.",
    example: 2,
    required: true,
  })
  @IsNumber()
  @Min(0)
  greenThreshold: number;

  /** Value up to which, past the green one, the tenant is at risk rather than failing. In percent on COVERAGE. */
  @ApiProperty({
    description: "Value up to which, past the green one, the tenant is at risk rather than failing. In percent on COVERAGE.",
    example: 5,
    required: true,
  })
  @IsNumber()
  @Min(0)
  yellowThreshold: number;

  /**
   * Smallest number of occurrences the measure needs: events of a PROPERTY_AVERAGE, distinct base values of a
   * COVERAGE. Below it the tenant is not assessable. Absent means one.
   */
  @ApiPropertyOptional({
    description: "Smallest number of occurrences the measure needs: events of a PROPERTY_AVERAGE, distinct base values of a COVERAGE. Below it the tenant is not assessable. Absent means one.",
    example: 3,
    required: false,
    nullable: true,
    type: Number,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  minSample?: number | null;

  /** Whether the rule is only measured, without judging the tenants, while its thresholds are being set. */
  @ApiProperty({
    description: "Whether the rule is only measured, without judging the tenants, while its thresholds are being set.",
    example: true,
    required: true,
  })
  @IsBoolean()
  observationOnly: boolean;
}
