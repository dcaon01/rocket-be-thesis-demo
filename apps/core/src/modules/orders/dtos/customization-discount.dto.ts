import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, Max, Min } from "class-validator";

/**
 * DTO used by the seller to grant a discount on a priced customization.
 * On the indirect channel it comes out of the reseller's customization margin
 * and cannot exceed it.
 */
export class CustomizationDiscountDto {
  /** Discount granted to the customer, in percent. */
  @ApiProperty({
    description: "Discount granted to the customer, in percent.",
    example: 10,
    required: true,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent: number;
}
