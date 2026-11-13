import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, Min } from "class-validator";

/**
 * Subscription fee of a reseller, by year of contract: the first year, the second,
 * and every year from the third on. Copied from the partner tier and negotiable
 * while the contract is a draft.
 */
export class ResellerFee {
  /** Fee in cents for the first year. */
  @ApiProperty({
    description: "Fee in cents for the first year.",
    example: 150000,
    required: true,
  })
  @IsNumber()
  @Min(0)
  firstYearCents: number;

  /** Fee in cents for the second year. */
  @ApiProperty({
    description: "Fee in cents for the second year.",
    example: 200000,
    required: true,
  })
  @IsNumber()
  @Min(0)
  secondYearCents: number;

  /** Fee in cents from the third year on. */
  @ApiProperty({
    description: "Fee in cents from the third year on.",
    example: 250000,
    required: true,
  })
  @IsNumber()
  @Min(0)
  ongoingCents: number;
}
