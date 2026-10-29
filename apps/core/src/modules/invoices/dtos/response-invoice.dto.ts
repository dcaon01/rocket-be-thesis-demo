import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { BilledParty } from "../classes/billed-party.class";
import { InvoiceLine } from "../classes/invoice-line.class";
import { BilledPartyType } from "../enums/billed-party-type.enum";
import { InvoiceDocumentStatus } from "../enums/invoice-document-status.enum";
import { InvoiceStatus } from "../enums/invoice-status.enum";
import { DunningStep } from "../enums/dunning-step.enum";

/**
 * Response DTO of an invoice: the amounts as the electronic invoice carries them, the collection on Stripe and the
 * electronic invoice at Sibill.
 */
export class ResponseInvoiceDto {
  /** Identifier of the billed party: company, reseller, or the financier of a financed order. */
  @ApiProperty({
    description: "Identifier of the billed party: company, reseller, or the financier of a financed order.",
    required: true,
  })
  billedPartyId: string;

  /** Identifier of the invoice. */
  @ApiProperty({
    description: "Identifier of the invoice.",
    required: true,
  })
  id: string;

  /** Kind of the billed party. */
  @ApiProperty({
    description: "Kind of the billed party.",
    enum: BilledPartyType,
    required: true,
  })
  billedPartyType: BilledPartyType;

  /** Details of the billed party as they were at issue. */
  @ApiProperty({
    description: "Details of the billed party as they were at issue.",
    type: BilledParty,
    required: true,
  })
  @Type(() => BilledParty)
  billedParty: BilledParty;

  /** Channel of the sale the invoice belongs to. */
  @ApiProperty({
    description: "Channel of the sale the invoice belongs to.",
    enum: SalesChannel,
    required: true,
  })
  channel: SalesChannel;

  /** Issue timestamp (ISO 8601). */
  @ApiProperty({
    description: "Issue timestamp (ISO 8601).",
    example: "2026-10-07T09:30:00.000Z",
    required: true,
  })
  issuedAt: string;

  /** Due date (ISO 8601). */
  @ApiPropertyOptional({
    description: "Due date (ISO 8601).",
    example: "2026-11-04T00:00:00.000Z",
    required: false,
  })
  dueDate?: string;

  /** State of the collection. */
  @ApiProperty({
    description: "State of the collection.",
    enum: InvoiceStatus,
    required: true,
  })
  status: InvoiceStatus;

  /** Total in cents, VAT included. */
  @ApiProperty({
    description: "Total in cents, VAT included.",
    example: 18239,
    required: true,
  })
  amountCents: number;

  /** Taxable amount in cents, net of VAT. */
  @ApiProperty({
    description: "Taxable amount in cents, net of VAT.",
    example: 14950,
    required: true,
  })
  taxableCents: number;

  /** VAT in cents. */
  @ApiProperty({
    description: "VAT in cents.",
    example: 3289,
    required: true,
  })
  vatCents: number;

  /** VAT rate in percent. */
  @ApiProperty({
    description: "VAT rate in percent.",
    example: 22,
    required: true,
  })
  vatRatePercent: number;

  /** Lines of the invoice. */
  @ApiProperty({
    description: "Lines of the invoice.",
    type: [InvoiceLine],
    required: true,
  })
  @Type(() => InvoiceLine)
  items: InvoiceLine[];

  /** Order the invoice arises from, when it bills a single order. */
  @ApiPropertyOptional({
    description: "Order the invoice arises from, when it bills a single order.",
    required: false,
  })
  orderId?: string;

  /** Contract of the company the invoice belongs to. */
  @ApiPropertyOptional({
    description: "Contract of the company the invoice belongs to.",
    required: false,
  })
  contractId?: string;

  /** Reseller contract whose fee the invoice bills. */
  @ApiPropertyOptional({
    description: "Reseller contract whose fee the invoice bills.",
    required: false,
  })
  resellerContractId?: string;

  /** First day of the period of fee the invoice bills, when it bills one. */
  @ApiPropertyOptional({
    description: "First day of the period of fee the invoice bills, when it bills one.",
    required: false,
  })
  billingPeriodStart?: string;

  /** Proration of seats the invoice bills; present only on prorations. */
  @ApiPropertyOptional({
    description: "Proration of seats the invoice bills; present only on prorations.",
    required: false,
  })
  prorationId?: string;

  /** Stripe invoice that charges the amount. */
  @ApiPropertyOptional({
    description: "Stripe invoice that charges the amount.",
    required: false,
  })
  stripeInvoiceId?: string;

  /** Where the electronic invoice stands: the steps of Rocket, then the states Sibill reports; absent on the invoices Rocket does not issue. */
  @ApiPropertyOptional({
    description: "Where the electronic invoice stands: the steps of Rocket, then the states Sibill reports; absent on the invoices Rocket does not issue.",
    enum: InvoiceDocumentStatus,
    required: false,
  })
  documentStatus?: InvoiceDocumentStatus;

  /** Why the last issue failed or is uncertain. */
  @ApiPropertyOptional({
    description: "Why the last issue failed or is uncertain.",
    required: false,
  })
  documentError?: string;

  /** Number of the electronic invoice, assigned by Sibill. */
  @ApiPropertyOptional({
    description: "Number of the electronic invoice, assigned by Sibill.",
    example: "12/2026",
    required: false,
  })
  number?: string;

  /** Identifier of the document at Sibill. */
  @ApiPropertyOptional({
    description: "Identifier of the document at Sibill.",
    required: false,
  })
  sibillId?: string;

  /** Collection timestamp (ISO 8601). */
  @ApiPropertyOptional({
    description: "Collection timestamp (ISO 8601).",
    required: false,
  })
  paidAt?: string;

  /** Collection attempts that failed, as Stripe counts them on the charge. */
  @ApiPropertyOptional({
    description: "Collection attempts that failed, as Stripe counts them on the charge.",
    example: 2,
    required: false,
  })
  failedAttempts?: number;

  /** When the last collection attempt failed (ISO 8601). */
  @ApiPropertyOptional({
    description: "When the last collection attempt failed (ISO 8601).",
    required: false,
  })
  lastFailedAt?: string;

  /** Last step of the dunning done on the unpaid invoice. */
  @ApiPropertyOptional({
    description: "Last step of the dunning done on the unpaid invoice.",
    enum: DunningStep,
    required: false,
  })
  dunningStep?: DunningStep;

  /** S3 key of the pro forma PDF sent to the reseller, on the invoices charged on the 4th. */
  @ApiPropertyOptional({
    description: "S3 key of the pro forma PDF sent to the reseller, on the invoices charged on the 4th.",
    required: false,
  })
  proFormaS3Key?: string;

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
