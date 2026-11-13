import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { LeverOutcome } from "../enums/lever-outcome.enum";

/**
 * How a tenant came out of one rule of a lever on the evaluation date.
 */
export class ResponseRuleResultDto {
  /** Identifier of the rule judged. */
  @ApiProperty({
    example: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    description: "Identifier of the rule judged.",
    required: true,
  })
  ruleId: string;

  /** How the tenant came out of the rule. */
  @ApiProperty({
    example: LeverOutcome.Compliant,
    description: "How the tenant came out of the rule.",
    enum: LeverOutcome,
    required: true,
  })
  outcome: LeverOutcome;

  /** Measured value, in the unit of the rule and in percent on a coverage; null when nothing could be measured. */
  @ApiPropertyOptional({
    example: 2,
    description: "Measured value, in the unit of the rule and in percent on a coverage; null when nothing could be measured.",
    required: false,
    nullable: true,
    type: Number,
  })
  value?: number | null;
}
