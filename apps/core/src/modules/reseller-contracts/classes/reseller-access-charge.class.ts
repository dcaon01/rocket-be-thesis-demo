import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Charge of Keus to a reseller that is still unpaid while its users are blocked: one Stripe invoice, which can bill
 * several invoices of Rocket on the same account. Paying it on Stripe unblocks the reseller once nothing is left.
 */
export class ResellerAccessCharge {
  /** Total of the charge, VAT included, in cents. */
  @ApiProperty({
    description: "Total of the charge, VAT included, in cents.",
    example: 144643,
    required: true,
  })
  amountCents: number;

  /** Due date of the charge (YYYY-MM-DD): the 4th of the month after the period. */
  @ApiProperty({
    description: "Due date of the charge (YYYY-MM-DD): the 4th of the month after the period.",
    example: "2026-11-04",
    required: true,
  })
  dueDate: string;

  /** Numbers of the invoices of Rocket the charge bills, once issued. */
  @ApiProperty({
    description: "Numbers of the invoices of Rocket the charge bills, once issued.",
    example: ["FPR 12/26"],
    type: [String],
    required: true,
  })
  invoiceNumbers: string[];

  /** Page of Stripe where the charge is paid; only for whoever completes the payment, the admin of the reseller. */
  @ApiPropertyOptional({
    description: "Page of Stripe where the charge is paid; only for whoever completes the payment, the admin of the reseller.",
    example: "https://invoice.stripe.com/i/acct_123/test_456",
    required: false,
  })
  payUrl?: string;
}
