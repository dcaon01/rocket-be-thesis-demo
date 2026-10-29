import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, IsOptional, Min } from "class-validator";

/**
 * Represents a single pricing tier inside a tiered volume plan.
 * A tier defines a unit price that applies when the chosen constraint value
 * (e.g. number of seats) falls within `[minValue, maxValue]`.
 * The first tier may omit `minValue` (unbounded lower end) and the last tier
 * may omit `maxValue` (unbounded upper end).
 */
export class Tier {
  /** Minimum constraint value for this tier. */
  @ApiProperty({
    example: 1,
    description: "The minimum constraint value for this tier (seats or revenue, depending on TierType).",
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minValue: number | null;

  /** Maximum constraint value for this tier. */
  @ApiProperty({
    example: 50,
    description: "The maximum constraint value for this tier (seats or revenue, depending on TierType).",
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxValue: number | null;

  /**
   * Unit price for this tier, always expressed as the MONTHLY amount per unit
   * (e.g. per seat). When the plan billing interval is annual, the backend
   * multiplies this value by 12 before pushing it to Stripe so the resulting
   * yearly invoice charges the equivalent total.
   */
  @ApiProperty({
    example: 10,
    description: "The unit price applied for this tier, always expressed as a monthly amount per unit.",
  })
  @IsNumber()
  @Min(0)
  price: number;

  /**
   * Constructor for Tier.
   * @param minValue the minimum constraint value, or null if unbounded.
   * @param maxValue the maximum constraint value, or null if unbounded.
   * @param price the unit price for this tier.
   */
  constructor(minValue: number | null, maxValue: number | null, price: number) {
    this.minValue = minValue;
    this.maxValue = maxValue;
    this.price = price;
  }
}
