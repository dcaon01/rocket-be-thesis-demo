import { ApiExtraModels, ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MixpanelLever } from "../../products/enums/mixpanel-lever.enum";
import { LeverOutcome } from "../enums/lever-outcome.enum";
import { ResponseRuleResultDto } from "./response-rule-result.class";

/**
 * How a tenant came out of a lever on the evaluation date: the outcome of its worst rule.
 */
@ApiExtraModels(ResponseRuleResultDto)
export class ResponseLeverResultDto {
  /** Lever judged. */
  @ApiProperty({
    example: MixpanelLever.Risk,
    description: "Lever judged.",
    enum: MixpanelLever,
    required: true,
  })
  lever: MixpanelLever;

  /** How the tenant came out of the lever: its worst judged rule, or observation when none is judged. */
  @ApiProperty({
    example: LeverOutcome.Compliant,
    description: "How the tenant came out of the lever: its worst judged rule, or observation when none is judged.",
    enum: LeverOutcome,
    required: true,
  })
  outcome: LeverOutcome;

  /** Measured value of the rule that decided the outcome; null when nothing could be measured. */
  @ApiPropertyOptional({
    example: 2,
    description: "Measured value of the rule that decided the outcome; null when nothing could be measured.",
    required: false,
    nullable: true,
    type: Number,
  })
  value?: number | null;

  /** How the tenant came out of each rule of the lever. */
  @ApiProperty({
    description: "How the tenant came out of each rule of the lever.",
    type: [ResponseRuleResultDto],
    required: true,
  })
  rules: ResponseRuleResultDto[];
}
