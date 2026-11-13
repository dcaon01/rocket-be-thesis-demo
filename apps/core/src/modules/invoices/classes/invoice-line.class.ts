import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** A line of an invoice, net of VAT and of the discounts. */
export class InvoiceLine {
  /** What the line bills. */
  @ApiProperty({
    description: "What the line bills.",
    example: "Canone Nquadro Tiers, un anno",
    required: true,
  })
  description: string;

  /** Taxable amount in cents, net of VAT and of the discounts. */
  @ApiProperty({
    description: "Taxable amount in cents, net of VAT and of the discounts.",
    example: 10225,
    required: true,
  })
  amountCents: number;

  /** Order of the order line billed. */
  @ApiPropertyOptional({
    description: "Order of the order line billed.",
    required: false,
  })
  orderId?: string;

  /** Product of the order line billed. */
  @ApiPropertyOptional({
    description: "Product of the order line billed.",
    required: false,
  })
  productId?: string;
}
