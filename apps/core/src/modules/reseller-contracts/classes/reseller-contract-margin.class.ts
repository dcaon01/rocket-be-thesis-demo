import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, Max, Min } from "class-validator";

/**
 * Margin of a reseller, written in its contract with Keus.
 * Keus invoices the reseller the list price less these percentages, and the
 * orders copy them onto their lines when they are raised, so a line keeps the
 * margin it was sold with. Percentages range from 0 to 100, like on the lines.
 */
export class ResellerContractMargin {
  /** Margin percentage on the activation amounts. */
  @ApiProperty({
    description: "Margin percentage on the activation amounts.",
    example: 40,
    required: true,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  activationPercent: number;

  /** Margin percentage on the recurring amounts of the products. */
  @ApiProperty({
    description: "Margin percentage on the recurring amounts of the products.",
    example: 40,
    required: true,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  recurringPercent: number;

  /** Margin percentage on the customizations. */
  @ApiProperty({
    description: "Margin percentage on the customizations.",
    example: 15,
    required: true,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  customizationPercent: number;
}
