import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayNotEmpty, IsArray, ValidateNested } from "class-validator";
import { CustomizationEvaluation } from "../classes/customization-evaluation.class";

/**
 * DTO used by the back office to save the quotation of an order: the outcome of its customizations, all at once.
 */
export class SaveQuotationDto {
  /** Outcome of each customization; together with those already evaluated, none may be left to price. */
  @ApiProperty({
    description: "Outcome of each customization; together with those already evaluated, none may be left to price.",
    type: [CustomizationEvaluation],
    required: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CustomizationEvaluation)
  evaluations: CustomizationEvaluation[];
}
