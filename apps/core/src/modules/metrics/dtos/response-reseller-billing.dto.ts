import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ResponseResellerBillingPeriodDto } from "./response-reseller-billing-period.dto";
import { ResponseInvoiceDto } from "../../invoices/dtos/response-invoice.dto";

/**
 * Economic position of a reseller towards Keus on its dashboard (UR-RK-339), computed when read from the invoices
 * billed to the reseller itself, as its schedule: what Keus invoiced in each period, what is still to pay, and when.
 */
export class ResponseResellerBillingDto {
  /** What Keus invoiced in each period, most recent first. */
  @ApiProperty({
    type: [ResponseResellerBillingPeriodDto],
    description: "What Keus invoiced in each period, most recent first.",
    required: true,
  })
  @Type(() => ResponseResellerBillingPeriodDto)
  records: ResponseResellerBillingPeriodDto[];

  /** Total still to pay, open and unpaid invoices, in cents, taxes included. */
  @ApiProperty({
    example: 45000,
    description: "Total still to pay, open and unpaid invoices, in cents, taxes included.",
    required: true,
  })
  dueCents: number;

  /** Part of the total still to pay whose due date has passed, or whose charge failed, in cents. */
  @ApiProperty({
    example: 15000,
    description: "Part of the total still to pay whose due date has passed, or whose charge failed, in cents.",
    required: true,
  })
  overdueCents: number;

  /** Invoices still to pay, the earliest due date first. */
  @ApiProperty({
    type: [ResponseInvoiceDto],
    description: "Invoices still to pay, the earliest due date first.",
    required: true,
  })
  @Type(() => ResponseInvoiceDto)
  dues: ResponseInvoiceDto[];
}
