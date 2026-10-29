import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from "class-validator";
import { ChargeCadence } from "../enums/charge-cadence.enum";

/**
 * DTO for changing an item a reseller added by hand. Kind and company stay as they are: another customer is another
 * item. On a recurring item `ruleEnd` at `null` lets it go on.
 */
export class UpdateCustomerChargeDto {
  /** What the item bills. */
  @ApiPropertyOptional({
    description: "What the item bills.",
    example: "Formazione del personale",
    required: false,
  })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  description?: string;

  /** Amount of each due date, net of VAT, in cents. */
  @ApiPropertyOptional({
    description: "Amount of each due date, net of VAT, in cents.",
    example: 15000,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  /** Due date of a one-off item (ISO string). */
  @ApiPropertyOptional({
    description: "Due date of a one-off item (ISO string).",
    example: "2026-11-15T00:00:00.000Z",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  /** First due date of a recurring item (ISO string). */
  @ApiPropertyOptional({
    description: "First due date of a recurring item (ISO string).",
    example: "2026-11-01T00:00:00.000Z",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  ruleStart?: string;

  /** Cadence of a recurring item. */
  @ApiPropertyOptional({
    description: "Cadence of a recurring item.",
    enum: ChargeCadence,
    required: false,
  })
  @IsOptional()
  @IsIn(Object.values(ChargeCadence))
  cadence?: ChargeCadence;

  /** Last day a recurring item can fall due (ISO string); null lets it go on. */
  @ApiPropertyOptional({
    description: "Last day a recurring item can fall due (ISO string); null lets it go on.",
    example: "2027-10-31T00:00:00.000Z",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  ruleEnd?: string | null;
}
