import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * SEPA mandate of a reseller on the Stripe account of a product of the contract being activated. The mandate may
 * come from the contract in force, which the new one inherits.
 */
export class ResellerAccessMandate {
  /** Product whose Stripe account collects. */
  @ApiProperty({
    description: "Product whose Stripe account collects.",
    example: "product_12345",
    required: true,
  })
  productId: string;

  /** Name of the product. */
  @ApiProperty({
    description: "Name of the product.",
    example: "Nquadro",
    required: true,
  })
  productName: string;

  /** When the mandate was given (ISO); absent while it is missing. */
  @ApiPropertyOptional({
    description: "When the mandate was given (ISO); absent while it is missing.",
    example: "2026-10-22T10:00:00.000Z",
    required: false,
  })
  mandateAt?: string;

  /** Link of the Stripe checkout that collects the mandate, once generated and while it is missing. */
  @ApiPropertyOptional({
    description: "Link of the Stripe checkout that collects the mandate, once generated and while it is missing.",
    example: "https://checkout.stripe.com/c/pay/cs_test_456",
    required: false,
  })
  checkoutUrl?: string;

  /** Expiration of the checkout link (ISO); an expired link is generated again. */
  @ApiPropertyOptional({
    description: "Expiration of the checkout link (ISO); an expired link is generated again.",
    example: "2026-10-23T14:14:00.000Z",
    required: false,
  })
  checkoutExpiresAt?: string;
}
