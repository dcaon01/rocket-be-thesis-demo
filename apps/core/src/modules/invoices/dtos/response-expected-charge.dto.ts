import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { BilledPartyType } from "../enums/billed-party-type.enum";

/**
 * Response DTO of a payment Keus expects from a contract in force and no invoice records yet: a contract of a product
 * (`contractId`) or the contract of the fee of a reseller (`resellerContractId`).
 */
export class ResponseExpectedChargeDto {
  /** Contract of a product the payment comes from. */
  @ApiPropertyOptional({
    description: "Contract of a product the payment comes from.",
    required: false,
  })
  contractId?: string;

  /** Contract of the fee of a reseller the payment comes from. */
  @ApiPropertyOptional({
    description: "Contract of the fee of a reseller the payment comes from.",
    required: false,
  })
  resellerContractId?: string;

  /** Code of the contract. */
  @ApiProperty({
    description: "Code of the contract.",
    example: "NQ-2026-00004",
    required: true,
  })
  contractCode: string;

  /** Product of the contract, absent on the fee of a reseller. */
  @ApiPropertyOptional({
    description: "Product of the contract, absent on the fee of a reseller.",
    required: false,
  })
  productId?: string;

  /** Company of the contract, absent on the fee of a reseller. */
  @ApiPropertyOptional({
    description: "Company of the contract, absent on the fee of a reseller.",
    required: false,
  })
  companyId?: string;

  /** Name of the company, absent on the fee of a reseller. */
  @ApiPropertyOptional({
    description: "Name of the company, absent on the fee of a reseller.",
    example: "ACME S.r.l.",
    required: false,
  })
  companyName?: string;

  /** Channel of the sale. */
  @ApiProperty({
    description: "Channel of the sale.",
    enum: SalesChannel,
    required: true,
  })
  channel: SalesChannel;

  /** Who will pay it: the company, or the reseller on the indirect channel. */
  @ApiProperty({
    description: "Who will pay it: the company, or the reseller on the indirect channel.",
    enum: BilledPartyType,
    required: true,
  })
  billedPartyType: BilledPartyType;

  /** Identifier of who will pay it. */
  @ApiProperty({
    description: "Identifier of who will pay it.",
    required: true,
  })
  billedPartyId: string;

  /** Name of who will pay it. */
  @ApiProperty({
    description: "Name of who will pay it.",
    example: "ACME S.r.l.",
    required: true,
  })
  billedPartyName: string;

  /** First day of the period it pays (ISO string). */
  @ApiProperty({
    description: "First day of the period it pays (ISO string).",
    example: "2027-10-16T16:04:40.679Z",
    required: true,
  })
  periodStart: string;

  /** Length of the period, in months. */
  @ApiProperty({
    description: "Length of the period, in months.",
    example: 12,
    required: true,
  })
  periodMonths: number;

  /** What it pays. */
  @ApiProperty({
    description: "What it pays.",
    example: "Canone Base, un anno",
    required: true,
  })
  description: string;

  /** Taxable amount in cents, net of VAT. */
  @ApiProperty({
    description: "Taxable amount in cents, net of VAT.",
    example: 10000,
    required: true,
  })
  taxableCents: number;

  /** VAT in cents. */
  @ApiProperty({
    description: "VAT in cents.",
    example: 2200,
    required: true,
  })
  vatCents: number;

  /** Total in cents, VAT included. */
  @ApiProperty({
    description: "Total in cents, VAT included.",
    example: 12200,
    required: true,
  })
  amountCents: number;

  /** What the customer pays the reseller for the period, net of VAT, on the indirect channel. */
  @ApiPropertyOptional({
    description: "What the customer pays the reseller for the period, net of VAT, on the indirect channel.",
    example: 12000,
    required: false,
  })
  customerCents?: number;
}
