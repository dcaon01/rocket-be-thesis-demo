import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * First fee of a contract being activated: paid through the Stripe checkout on the account of Keus, whose link only
 * whoever completes the activation receives.
 */
export class ResellerAccessFee {
  /** Fee of the first year, in cents. */
  @ApiProperty({
    description: "Fee of the first year, in cents.",
    example: 150000,
    required: true,
  })
  amountCents: number;

  /** Whether the first fee is paid. */
  @ApiProperty({
    description: "Whether the first fee is paid.",
    example: false,
    required: true,
  })
  paid: boolean;

  /** Link of the Stripe checkout of the fee, while it is unpaid. */
  @ApiPropertyOptional({
    description: "Link of the Stripe checkout of the fee, while it is unpaid.",
    example: "https://checkout.stripe.com/c/pay/cs_test_123",
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
