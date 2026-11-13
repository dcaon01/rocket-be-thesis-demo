import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";

/**
 * A line as it comes in when an order is created or edited.
 * Plan and seats are optional because a draft can be filled in incrementally
 * (a won deal opens one with the product only); they are required by the time
 * the offer is generated. The amounts are not accepted: the service computes
 * them from the plan, so a line cannot claim a price the catalog does not sell.
 */
export class OrderLineInput {
  /** Identifier of the product sold on this line. */
  @ApiProperty({
    description: "Identifier of the product sold on this line.",
    example: "product-id-123",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  productId: string;

  /** Identifier of the plan pricing this line. */
  @ApiPropertyOptional({
    description: "Identifier of the plan pricing this line.",
    example: "plan-id-123",
    required: false,
  })
  @IsOptional()
  @IsString()
  planId?: string;

  /** Number of seats sold on this line. */
  @ApiPropertyOptional({
    description: "Number of seats sold on this line. Only volume plans are priced by seats.",
    example: 8,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  seats?: number;

  /**
   * Discount on the activation granted to the customer, in percent. On the
   * indirect channel it comes out of the reseller's margin and cannot exceed it.
   */
  @ApiPropertyOptional({
    description: "Discount on the activation granted to the customer, in percent. On the indirect channel it cannot exceed the reseller's margin.",
    example: 10,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  activationDiscountPercent?: number;

  /**
   * Discount on the recurring fee granted to the customer, in percent. On the
   * indirect channel it comes out of the reseller's margin and cannot exceed it.
   */
  @ApiPropertyOptional({
    description: "Discount on the recurring fee granted to the customer, in percent. On the indirect channel it cannot exceed the reseller's margin.",
    example: 10,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  recurringDiscountPercent?: number;

  /**
   * Constructor for OrderLineInput.
   * @param productId the identifier of the product.
   * @param planId the identifier of the plan.
   * @param seats the number of seats.
   */
  constructor(productId: string, planId?: string, seats?: number) {
    this.productId = productId;
    this.planId = planId;
    this.seats = seats;
  }
}
