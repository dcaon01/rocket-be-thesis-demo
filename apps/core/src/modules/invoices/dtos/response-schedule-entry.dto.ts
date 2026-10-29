import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ScheduleDirection } from "../enums/schedule-direction.enum";
import { ResponseCustomerChargeDto } from "./response-customer-charge.dto";
import { ResponseExpectedChargeDto } from "./response-expected-charge.dto";
import { ResponseInvoiceDto } from "./response-invoice.dto";

/**
 * A due date in a schedule. In the one of a reseller: an invoice of Keus to pay, a due date of an item to collect from
 * a customer, a recurring item once per due date in the period, or a payment expected either way from an indirect
 * contract in force or from its fee. In the one of Keus: an invoice to collect or collected, or a payment expected
 * from a contract in force, all of them towards Keus.
 */
export class ResponseScheduleEntryDto {
  /** Identifier of the entry in the schedule: the item and its due date, the invoice, or the contract and its period. */
  @ApiProperty({
    description: "Identifier of the entry in the schedule: the item and its due date, the invoice, or the contract and its period.",
    required: true,
  })
  key: string;

  /** Which way the money goes. */
  @ApiProperty({
    description: "Which way the money goes.",
    enum: ScheduleDirection,
    required: true,
  })
  direction: ScheduleDirection;

  /** Due date (ISO string). */
  @ApiProperty({
    description: "Due date (ISO string).",
    example: "2026-11-04T00:00:00.000Z",
    required: true,
  })
  dueDate: string;

  /** Whether the reseller collected the due date of the customer. */
  @ApiPropertyOptional({
    description: "Whether the reseller collected the due date of the customer.",
    required: false,
  })
  collected?: boolean;

  /** The invoice of Keus, on the entries of a recorded payment. */
  @ApiPropertyOptional({
    description: "The invoice of Keus, on the entries of a recorded payment.",
    type: ResponseInvoiceDto,
    required: false,
  })
  @Type(() => ResponseInvoiceDto)
  invoice?: ResponseInvoiceDto;

  /** The item of the customer, on the entries from a customer. */
  @ApiPropertyOptional({
    description: "The item of the customer, on the entries from a customer.",
    type: ResponseCustomerChargeDto,
    required: false,
  })
  @Type(() => ResponseCustomerChargeDto)
  charge?: ResponseCustomerChargeDto;

  /** The payment expected from a contract, before it is recorded: towards Keus, or from the customer at `customerCents`. */
  @ApiPropertyOptional({
    description: "The payment expected from a contract, before it is recorded: towards Keus, or from the customer at `customerCents`.",
    type: ResponseExpectedChargeDto,
    required: false,
  })
  @Type(() => ResponseExpectedChargeDto)
  expected?: ResponseExpectedChargeDto;
}
