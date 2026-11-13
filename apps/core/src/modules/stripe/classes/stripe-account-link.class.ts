import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** Customer and SEPA mandate of a company or a reseller on one Stripe account: a mandate authorizes one creditor only. */
export class StripeAccountLink {
  /** Stripe account the link lives on: a product id, or `keus` for the Keus account. */
  @ApiProperty({
    description: "Stripe account the link lives on: a product id, or `keus` for the Keus account.",
    example: "product_12345",
    required: true,
  })
  accountKey: string;

  /** Stripe customer on that account. */
  @ApiProperty({
    description: "Stripe customer on that account.",
    example: "cus_123",
    required: true,
  })
  customerId: string;

  /** SEPA payment method collected by the checkout, the default of the customer. */
  @ApiPropertyOptional({
    description: "SEPA payment method collected by the checkout, the default of the customer.",
    example: "pm_123",
    required: false,
  })
  paymentMethodId?: string;

  /** When the mandate was collected (ISO string). */
  @ApiPropertyOptional({
    description: "When the mandate was collected (ISO string).",
    example: "2026-10-06T10:00:00.000Z",
    required: false,
  })
  mandateAt?: string;

  /** Link of the checkout that collects the mandate, while it is pending; on a company it lives on the contract. */
  @ApiPropertyOptional({
    description: "Link of the checkout that collects the mandate, while it is pending; on a company it lives on the contract.",
    required: false,
  })
  checkoutSessionUrl?: string;

  /** Expiry of that checkout (ISO string). */
  @ApiPropertyOptional({
    description: "Expiry of that checkout (ISO string).",
    required: false,
  })
  checkoutSessionExpiresAt?: string;
}
