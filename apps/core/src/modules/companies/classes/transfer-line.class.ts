import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";

/**
 * Plan and discount of the direct contract that takes over the contract of a company on one product, when the
 * company moves from its inactive reseller to Keus (UR-RK-105). Seats come from the contract taken over.
 * A class and not an interface: `@ValidateNested` + `@Type` validate each element of `lines` only on a class.
 */
export class TransferLine {
  /** Identifier of the product of the contract taken over. */
  @ApiProperty({
    description: "Identifier of the product of the contract taken over.",
    example: "product-id-123",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  productId: string;

  /** Identifier of the plan for companies pricing the direct contract. */
  @ApiProperty({
    description: "Identifier of the plan for companies pricing the direct contract.",
    example: "plan-id-123",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  planId: string;

  /** Discount on the recurring fee of the plan, in percent. */
  @ApiPropertyOptional({
    description: "Discount on the recurring fee of the plan, in percent.",
    example: 10,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  recurringDiscountPercent?: number;

  /**
   * Constructor for TransferLine.
   * @param productId the identifier of the product of the contract taken over.
   * @param planId the identifier of the plan for companies pricing the direct contract.
   * @param recurringDiscountPercent the discount on the recurring fee of the plan, in percent.
   */
  constructor(productId: string, planId: string, recurringDiscountPercent?: number) {
    this.productId = productId;
    this.planId = planId;
    this.recurringDiscountPercent = recurringDiscountPercent;
  }
}
