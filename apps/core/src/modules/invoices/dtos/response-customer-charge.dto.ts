import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ChargeCadence } from "../enums/charge-cadence.enum";
import { CustomerChargeKind } from "../enums/customer-charge-kind.enum";

/** Response DTO of an item a reseller bills one of its customers. */
export class ResponseCustomerChargeDto {
  /** Reseller that bills the customer. */
  @ApiProperty({
    description: "Reseller that bills the customer.",
    required: true,
  })
  resellerId: string;

  /** Identifier of the item. */
  @ApiProperty({
    description: "Identifier of the item.",
    required: true,
  })
  id: string;

  /** Kind of the item. */
  @ApiProperty({
    description: "Kind of the item.",
    enum: CustomerChargeKind,
    required: true,
  })
  kind: CustomerChargeKind;

  /** Company billed, a customer of the reseller. */
  @ApiProperty({
    description: "Company billed, a customer of the reseller.",
    required: true,
  })
  companyId: string;

  /** Name of the company. */
  @ApiProperty({
    description: "Name of the company.",
    example: "ACME S.r.l.",
    required: true,
  })
  companyName: string;

  /** What the item bills. */
  @ApiProperty({
    description: "What the item bills.",
    example: "Formazione del personale",
    required: true,
  })
  description: string;

  /** Amount of each due date, net of VAT, in cents. */
  @ApiProperty({
    description: "Amount of each due date, net of VAT, in cents.",
    example: 15000,
    required: true,
  })
  amountCents: number;

  /** Due date of a single item (ISO string). */
  @ApiPropertyOptional({
    description: "Due date of a single item (ISO string).",
    required: false,
  })
  dueDate?: string;

  /** When a single item was collected (ISO string). */
  @ApiPropertyOptional({
    description: "When a single item was collected (ISO string).",
    required: false,
  })
  collectedAt?: string;

  /** First due date of a recurring item (ISO string). */
  @ApiPropertyOptional({
    description: "First due date of a recurring item (ISO string).",
    required: false,
  })
  ruleStart?: string;

  /** Cadence of a recurring item. */
  @ApiPropertyOptional({
    description: "Cadence of a recurring item.",
    enum: ChargeCadence,
    required: false,
  })
  cadence?: ChargeCadence;

  /** Last day a recurring item can fall due (ISO string). */
  @ApiPropertyOptional({
    description: "Last day a recurring item can fall due (ISO string).",
    required: false,
  })
  ruleEnd?: string;

  /** Due dates of a recurring item already collected (ISO strings). */
  @ApiPropertyOptional({
    description: "Due dates of a recurring item already collected (ISO strings).",
    type: [String],
    required: false,
  })
  collectedDates?: string[];

  /** Contract whose share the item is. */
  @ApiPropertyOptional({
    description: "Contract whose share the item is.",
    required: false,
  })
  contractId?: string;

  /** Product of the contract. */
  @ApiPropertyOptional({
    description: "Product of the contract.",
    required: false,
  })
  productId?: string;

  /** Code of the contract. */
  @ApiPropertyOptional({
    description: "Code of the contract.",
    example: "NQ-2026-00012",
    required: false,
  })
  contractCode?: string;

  /** End of the period of the contract billed (ISO string); absent on a one-off plan. */
  @ApiPropertyOptional({
    description: "End of the period of the contract billed (ISO string); absent on a one-off plan.",
    required: false,
  })
  periodEnd?: string;

  /** Creation timestamp. */
  @ApiProperty({
    description: "Creation timestamp.",
    required: true,
  })
  createdAt: string;

  /** Last update timestamp. */
  @ApiProperty({
    description: "Last update timestamp.",
    required: true,
  })
  updatedAt: string;
}
