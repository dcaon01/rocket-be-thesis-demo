import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";
import { TransferLine } from "../classes/transfer-line.class";

/**
 * Transfer of a company of an inactive reseller (UR-RK-105): to another active reseller, or to Keus when no reseller
 * is given, with the plan of the direct contract taking over each contract in force.
 */
export class TransferCompanyDto {
  /** Identifier of the reseller the company moves to; absent when it moves to Keus. */
  @ApiPropertyOptional({
    description: "Identifier of the reseller the company moves to; absent when it moves to Keus.",
    example: "b3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    required: false,
  })
  @IsOptional()
  @IsString()
  resellerId?: string;

  /** Plan and discount of the direct contract taking over each contract in force, by product; only towards Keus. */
  @ApiPropertyOptional({
    description: "Plan and discount of the direct contract taking over each contract in force, by product; only towards Keus.",
    type: [TransferLine],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferLine)
  lines?: TransferLine[];
}
