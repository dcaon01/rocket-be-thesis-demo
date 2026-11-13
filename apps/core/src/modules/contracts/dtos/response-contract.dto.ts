import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { SeatEvent } from "../classes/seat-event.class";
import { DunningStep } from "../../invoices/enums/dunning-step.enum";
import { ContractStatus } from "../enums/contract-status.enum";
import { ContractTerminationReason } from "../enums/contract-termination-reason.enum";

/**
 * Data Transfer Object for responding with contract information.
 */
export class ResponseContractDto {
  /** Identifier of the product. */
  @ApiProperty({
    description: "Identifier of the product.",
    example: "product_12345",
    required: true,
  })
  productId: string;

  /** Identifier of the contract. */
  @ApiProperty({
    description: "Identifier of the contract.",
    example: "contract_67890",
    required: true,
  })
  id: string;

  /** Human-readable code of the contract. */
  @ApiProperty({
    description: "Human-readable code of the contract.",
    example: "NQ-2026-00001",
    required: true,
  })
  code: string;

  /** Company of the tenant. */
  @ApiProperty({
    description: "Company of the tenant.",
    example: "company_123",
    required: true,
  })
  companyId: string;

  /** Name of the company, copied for the listings and realigned when the company changes it. */
  @ApiProperty({
    description: "Name of the company, copied for the listings and realigned when the company changes it.",
    example: "ACME S.r.l.",
    required: true,
  })
  companyName: string;

  /** Tenant the contract governs. */
  @ApiProperty({
    description: "Tenant the contract governs.",
    example: "tenant_123",
    required: true,
  })
  tenantId: string;

  /** Plan of the order line. */
  @ApiProperty({
    description: "Plan of the order line.",
    example: "plan_67890",
    required: true,
  })
  planId: string;

  /** Order the contract comes from; with the product it identifies the order line. */
  @ApiProperty({
    description: "Order the contract comes from; with the product it identifies the order line.",
    example: "order_123",
    required: true,
  })
  orderId: string;

  /** Salesperson who opened the order, copied when the contract is born. */
  @ApiPropertyOptional({
    description: "Salesperson who opened the order, copied when the contract is born.",
    example: "a1b2c3d4-0000-0000-0000-000000000000",
    required: false,
  })
  assignedSalesId?: string;

  /** Seats billed: the highest count of active users the tenant reached. */
  @ApiProperty({
    description: "Seats billed: the highest count of active users the tenant reached.",
    example: 10,
    required: true,
  })
  seats: number;

  /** Changes of the users of the tenant: the seats added and the users removed, with their date. */
  @ApiPropertyOptional({
    description: "Changes of the users of the tenant: the seats added and the users removed, with their date.",
    type: [SeatEvent],
    required: false,
  })
  @Type(() => SeatEvent)
  seatEvents?: SeatEvent[];

  /** Start date (ISO string). */
  @ApiProperty({
    description: "Start date (ISO string).",
    example: "2026-10-06T00:00:00.000Z",
    required: true,
  })
  startDate: string;

  /** Next renewal date (ISO string); absent on one-off plans, kept once terminated. */
  @ApiPropertyOptional({
    description: "Next renewal date (ISO string); absent on one-off plans, kept once terminated.",
    example: "2027-10-06T00:00:00.000Z",
    required: false,
  })
  renewalDate?: string;

  /** Next date the reseller is billed for a period of the fee, on indirect contracts of recurring plans. */
  @ApiPropertyOptional({
    description: "Next date the reseller is billed for a period of the fee, on indirect contracts of recurring plans.",
    example: "2026-11-06T00:00:00.000Z",
    required: false,
  })
  nextBillingDate?: string;

  /** End of the period the company already paid through the reseller it came from; nothing is charged before it. */
  @ApiPropertyOptional({
    description: "End of the period the company already paid through the reseller it came from; nothing is charged before it.",
    example: "2026-11-06T00:00:00.000Z",
    required: false,
  })
  paidUntil?: string;

  /** End of the period the Stripe subscription of a direct contract has paid, from its last paid invoice: the next charge falls on it. */
  @ApiPropertyOptional({
    description: "End of the period the Stripe subscription of a direct contract has paid, from its last paid invoice: the next charge falls on it.",
    example: "2027-10-13T12:55:07.000Z",
    required: false,
  })
  subscriptionPaidUntil?: string;

  /** Amount charged at the next renewal, in cents. */
  @ApiPropertyOptional({
    description: "Amount charged at the next renewal, in cents.",
    example: 120000,
    required: false,
  })
  renewalAmountCents?: number;

  /** Days before the renewal within which a cancellation takes effect only at the following one. */
  @ApiProperty({
    description: "Days before the renewal within which a cancellation takes effect only at the following one.",
    example: 30,
    required: true,
  })
  noticeDays: number;

  /** Status of the contract. */
  @ApiProperty({
    description: "Status of the contract.",
    example: ContractStatus.Active,
    enum: ContractStatus,
    required: true,
  })
  status: ContractStatus;

  /** Date the contract ends or ended (ISO string). */
  @ApiPropertyOptional({
    description: "Date the contract ends or ended (ISO string).",
    example: "2027-10-06T00:00:00.000Z",
    required: false,
  })
  terminationDate?: string;

  /** Why the contract was terminated, when it matters: a transfer of channel is not a loss. */
  @ApiPropertyOptional({
    description: "Why the contract was terminated, when it matters: a transfer of channel is not a loss.",
    enum: ContractTerminationReason,
    required: false,
  })
  terminationReason?: ContractTerminationReason;

  /** When the customer cancelled the contract; absent on a contract that ends by itself, as a financed one. */
  @ApiPropertyOptional({
    description: "When the customer cancelled the contract; absent on a contract that ends by itself, as a financed one.",
    example: "2026-09-01T10:00:00.000Z",
    required: false,
  })
  cancelledAt?: string;

  /** When the access of the tenant was suspended for an unpaid invoice; absent while the access is regular. */
  @ApiPropertyOptional({
    description: "When the access of the tenant was suspended for an unpaid invoice; absent while the access is regular.",
    example: "2026-11-15T08:00:00.000Z",
    required: false,
  })
  accessSuspendedAt?: string;

  /** Date until which the administration postponed the suspension of the access for an unpaid invoice (ISO string). */
  @ApiPropertyOptional({
    description: "Date until which the administration postponed the suspension of the access for an unpaid invoice (ISO string).",
    example: "2026-12-01T00:00:00.000Z",
    required: false,
  })
  suspensionPostponedUntil?: string;

  /** Materialized path of the selling reseller; absent on direct sales. */
  @ApiPropertyOptional({
    description: "Materialized path of the selling reseller; absent on direct sales.",
    example: "RVD-001#",
    required: false,
  })
  resellerPath?: string;

  /** Month of creation. */
  @ApiProperty({
    description: "Month of creation.",
    example: "2026-10",
    required: true,
  })
  monthIndex: string;

  /** S3 key of the contract document. */
  @ApiProperty({
    description: "S3 key of the contract document.",
    example: "contract-documents/product_12345/contract_67890/contract.html",
    required: true,
  })
  documentS3Key: string;

  /** S3 key of the PDF of the accepted document, written at the acceptance. */
  @ApiPropertyOptional({
    description: "S3 key of the PDF of the accepted document, written at the acceptance.",
    example: "contract-documents/product_12345/contract_67890/contract.pdf",
    required: false,
  })
  documentPdfS3Key?: string;

  /** Template the document was generated from. */
  @ApiProperty({
    description: "Template the document was generated from.",
    example: "template_123",
    required: true,
  })
  templateId: string;

  /** When the first user accepted the document (ISO string). */
  @ApiPropertyOptional({
    description: "When the first user accepted the document (ISO string).",
    example: "2026-10-08T09:30:00.000Z",
    required: false,
  })
  acceptedAt?: string;

  /** Product user who accepted the document. */
  @ApiPropertyOptional({
    description: "Product user who accepted the document.",
    example: "user_123",
    required: false,
  })
  acceptedByUserId?: string;

  /** Stripe customer the contract is charged to. */
  @ApiPropertyOptional({
    description: "Stripe customer the contract is charged to.",
    example: "cus_123",
    required: false,
  })
  stripeCustomerId?: string;

  /** Stripe subscription of the recurring charge. */
  @ApiPropertyOptional({
    description: "Stripe subscription of the recurring charge.",
    example: "sub_123",
    required: false,
  })
  stripeSubscriptionId?: string;

  /** URL of the checkout that starts charging the contract, sent by the backoffice or opened by the referent. */
  @ApiPropertyOptional({
    description: "URL of the checkout that starts charging the contract, sent by the backoffice or opened by the referent.",
    example: "https://checkout.stripe.com/c/pay/cs_test_123",
    required: false,
  })
  checkoutSessionUrl?: string;

  /** Expiry of the checkout (ISO string). */
  @ApiPropertyOptional({
    description: "Expiry of the checkout (ISO string).",
    example: "2026-10-07T00:00:00.000Z",
    required: false,
  })
  checkoutSessionExpiresAt?: string;

  /** Whether the company must still complete the checkout of the contract; given only by the detail. */
  @ApiPropertyOptional({
    description: "Whether the company must still complete the checkout of the contract; given only by the detail.",
    example: true,
    required: false,
  })
  paymentRequired?: boolean;

  /** Whether a finance company paid the contract, which then ends with its financing; given only by the detail. */
  @ApiPropertyOptional({
    description: "Whether a finance company paid the contract, which then ends with its financing; given only by the detail.",
    example: false,
    required: false,
  })
  financed?: boolean;

  /** Last step done of the dunning of a payment never set up, counted from the start of the contract. */
  @ApiPropertyOptional({
    description: "Last step done of the dunning of a payment never set up, counted from the start of the contract.",
    enum: DunningStep,
    example: DunningStep.FirstReminder,
    required: false,
  })
  paymentDunningStep?: DunningStep;

  /** Creation timestamp. */
  @ApiProperty({
    description: "Creation timestamp.",
    example: "2026-10-06T00:00:00.000Z",
    required: true,
  })
  createdAt: string;

  /** Last update timestamp. */
  @ApiProperty({
    description: "Last update timestamp.",
    example: "2026-10-06T00:00:00.000Z",
    required: true,
  })
  updatedAt: string;
}
