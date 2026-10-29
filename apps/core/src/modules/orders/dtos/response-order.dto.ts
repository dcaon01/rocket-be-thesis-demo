import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose, Type } from "class-transformer";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { OrderBlocker } from "../classes/order-blocker.class";
import { Financier } from "../enums/financier.enum";
import { OrderRefusalReason } from "../enums/order-refusal-reason.enum";
import { OrderStatus } from "../enums/order-status.enum";
import { ResponseOrderCustomizationDto } from "./response-order-customization.dto";
import { ResponseOrderLineDto } from "./response-order-line.dto";

/**
 * DTO returned for an order.
 * The listings return the order with its summary only; `lines` and
 * `customizations` are filled when a single order is read.
 */
export class ResponseOrderDto {
  /** Identifier of the order. */
  @ApiProperty({
    description: "Identifier of the order.",
    example: "order-id-123",
    required: true,
  })
  @Expose()
  id: string;

  /** Human-readable order code. */
  @ApiProperty({
    description: "Human-readable order code.",
    example: "ORD-2026-00001",
    required: true,
  })
  @Expose()
  code: string;

  /** Identifier of the company the order is placed for. */
  @ApiProperty({
    description: "Identifier of the company the order is placed for.",
    example: "company-id-123",
    required: true,
  })
  @Expose()
  companyId: string;

  /** Legal name of the company. */
  @ApiProperty({
    description: "Legal name of the company.",
    example: "Ossigeno S.r.l.",
    required: true,
  })
  @Expose()
  companyName: string;

  /** VAT number of the company. */
  @ApiPropertyOptional({
    description: "VAT number of the company.",
    example: "02542970443",
    required: false,
  })
  @Expose()
  companyVatNumber?: string;

  /** Lifecycle state of the order. */
  @ApiProperty({
    description: "Lifecycle state of the order.",
    enum: OrderStatus,
    example: OrderStatus.Draft,
    required: true,
  })
  @Expose()
  status: OrderStatus;

  /** Sales channel of the order. */
  @ApiProperty({
    description: "Sales channel of the order.",
    enum: SalesChannel,
    example: SalesChannel.Direct,
    required: true,
  })
  @Expose()
  channel: SalesChannel;

  /** Code of the reseller at the root of the seller's network. Absent on direct orders. */
  @ApiPropertyOptional({
    description: "Code of the reseller at the root of the seller's network. Absent on direct orders.",
    example: "RVD-001",
    required: false,
  })
  @Expose()
  rootResellerCode?: string;

  /** Materialized reseller lineage of the seller. Absent on direct orders. */
  @ApiPropertyOptional({
    description: "Materialized reseller lineage of the seller. Absent on direct orders.",
    example: "RVD-001#",
    required: false,
  })
  @Expose()
  resellerPath?: string;

  /** Cognito sub of whoever opened the order. */
  @ApiPropertyOptional({
    description: "Cognito sub of whoever opened the order.",
    example: "c01c191c",
    required: false,
  })
  @Expose()
  assignedSalesId?: string;

  /** ISO timestamp of the request. */
  @ApiProperty({
    description: "ISO timestamp of the request.",
    example: "2026-03-04T09:12:00.000Z",
    required: true,
  })
  @Expose()
  requestedAt: string;

  /** Month of the request ("YYYY-MM"). */
  @ApiProperty({
    description: "Month of the request (\"YYYY-MM\").",
    example: "2026-03",
    required: true,
  })
  @Expose()
  requestMonth: string;

  /** Identifier of the CRM deal that opened the order. */
  @ApiPropertyOptional({
    description: "Identifier of the CRM deal that opened the order.",
    example: "1234567890",
    required: false,
  })
  @Expose()
  dealId?: string;

  /** Number of lines of the order. */
  @ApiProperty({
    description: "Number of lines of the order.",
    example: 2,
    required: true,
  })
  @Expose()
  linesTotal: number;

  /** Number of lines provisioned. */
  @ApiProperty({
    description: "Number of lines provisioned.",
    example: 1,
    required: true,
  })
  @Expose()
  linesProvisioned: number;

  /** Number of lines activated. */
  @ApiProperty({
    description: "Number of lines activated.",
    example: 0,
    required: true,
  })
  @Expose()
  linesActivated: number;

  /** Identifiers of the products on the lines. */
  @ApiProperty({
    description: "Identifiers of the products on the lines.",
    example: ["product-id-123"],
    type: [String],
    required: true,
  })
  @Expose()
  productIds: string[];

  /** Names of the products on the lines. */
  @ApiProperty({
    description: "Names of the products on the lines.",
    example: ["Nquadro", "Genio"],
    type: [String],
    required: true,
  })
  @Expose()
  productNames: string[];

  /** Whether the order carries customization requests. */
  @ApiProperty({
    description: "Whether the order carries customization requests.",
    example: false,
    required: true,
  })
  @Expose()
  hasCustomization: boolean;

  /** Customization requests still waiting for the back office. */
  @ApiProperty({
    description: "Customization requests still waiting for the back office.",
    example: 0,
    required: true,
  })
  @Expose()
  pendingCustomizations: number;

  /** Identifier of the template the offer was generated from. */
  @ApiPropertyOptional({
    description: "Identifier of the template the offer was generated from.",
    example: "template-id-123",
    required: false,
  })
  @Expose()
  offerTemplateId?: string;

  /** ISO timestamp of the offer generation. */
  @ApiPropertyOptional({
    description: "ISO timestamp of the offer generation.",
    example: "2026-03-05T10:00:00.000Z",
    required: false,
  })
  @Expose()
  offerGeneratedAt?: string;

  /** S3 key of the signed offer. */
  @ApiPropertyOptional({
    description: "S3 key of the signed offer.",
    example: "orders/order-id-123/signed-offer.pdf",
    required: false,
  })
  @Expose()
  signedOfferS3Key?: string;

  /** ISO timestamp of the acceptance. */
  @ApiPropertyOptional({
    description: "ISO timestamp of the acceptance.",
    example: "2026-03-11T09:00:00.000Z",
    required: false,
  })
  @Expose()
  acceptedAt?: string;

  /** Reason the offer was turned down. */
  @ApiPropertyOptional({
    description: "Reason the offer was turned down.",
    enum: OrderRefusalReason,
    required: false,
  })
  @Expose()
  refusalReason?: OrderRefusalReason;

  /** Free-text note accompanying the refusal. */
  @ApiPropertyOptional({
    description: "Free-text note accompanying the refusal.",
    example: "Rimandato al prossimo esercizio.",
    required: false,
  })
  @Expose()
  refusalNote?: string;

  /** When the reseller asked the Keus back office to approve its offer. */
  @ApiPropertyOptional({
    description: "When the reseller asked the Keus back office to approve its offer.",
    example: "2026-10-06T09:00:00.000Z",
    required: false,
  })
  @Expose()
  approvalRequestedAt?: string;

  /** When the Keus back office approved the offer of the reseller. */
  @ApiPropertyOptional({
    description: "When the Keus back office approved the offer of the reseller.",
    example: "2026-10-06T10:00:00.000Z",
    required: false,
  })
  @Expose()
  approvedAt?: string;

  /** Reason the Keus back office refused the approval, for the reseller. */
  @ApiPropertyOptional({
    description: "Reason the Keus back office refused the approval, for the reseller.",
    example: "Lo sconto va concordato con il commerciale Keus.",
    required: false,
  })
  @Expose()
  approvalRefusalReason?: string;

  /** Finance company paying the order. */
  @ApiPropertyOptional({
    description: "Finance company paying the order.",
    enum: Financier,
    required: false,
  })
  @Expose()
  financier?: Financier;

  /** Identifier of the financing application. */
  @ApiPropertyOptional({
    description: "Identifier of the financing application.",
    example: "GRK-2026-0001",
    required: false,
  })
  @Expose()
  financierReference?: string;

  /** S3 key of the contract signed with the finance company. */
  @ApiPropertyOptional({
    description: "S3 key of the contract signed with the finance company.",
    example: "orders/order-id-123/financing-contract.pdf",
    required: false,
  })
  @Expose()
  financingContractS3Key?: string;

  /** Years of fee the finance company pays upfront, the duration of the order; required with a recurring line. */
  @ApiPropertyOptional({
    description: "Years of fee the finance company pays upfront, the duration of the order; required with a recurring line.",
    example: 5,
    required: false,
  })
  @Expose()
  financedYears?: number;

  /** Expected delivery date (ISO). */
  @ApiPropertyOptional({
    description: "Expected delivery date (ISO).",
    example: "2026-03-16",
    required: false,
  })
  @Expose()
  deliveryDate?: string;

  /** ISO timestamp of the confirmation by Keus. */
  @ApiPropertyOptional({
    description: "ISO timestamp of the confirmation by Keus.",
    example: "2026-03-12T15:20:00.000Z",
    required: false,
  })
  @Expose()
  confirmedAt?: string;

  /** Code of the inactive reseller the company came from, on the order that moves its contracts to Keus. */
  @ApiPropertyOptional({
    description: "Code of the inactive reseller the company came from, on the order that moves its contracts to Keus.",
    example: "RVD-001",
    required: false,
  })
  @Expose()
  transferredFromResellerCode?: string;

  /** Lines of the order. Filled when a single order is read. */
  @ApiPropertyOptional({
    description: "Lines of the order. Filled when a single order is read.",
    type: [ResponseOrderLineDto],
    required: false,
  })
  @Expose()
  @Type(() => ResponseOrderLineDto)
  lines?: ResponseOrderLineDto[];

  /** Customization requests of the order. Filled when a single order is read. */
  @ApiPropertyOptional({
    description: "Customization requests of the order. Filled when a single order is read.",
    type: [ResponseOrderCustomizationDto],
    required: false,
  })
  @Expose()
  @Type(() => ResponseOrderCustomizationDto)
  customizations?: ResponseOrderCustomizationDto[];

  /** Why the draft cannot go ahead on its products. Filled when a single draft is read and something blocks it. */
  @ApiPropertyOptional({
    description: "Why the draft cannot go ahead on its products. Filled when a single draft is read and something blocks it.",
    type: OrderBlocker,
    required: false,
  })
  @Expose()
  @Type(() => OrderBlocker)
  blockedBy?: OrderBlocker;

  /** ISO timestamp of the creation. */
  @ApiProperty({
    description: "ISO timestamp of the creation.",
    example: "2026-03-04T09:12:00.000Z",
    required: true,
  })
  @Expose()
  createdAt: string;

  /** ISO timestamp of the last update. */
  @ApiProperty({
    description: "ISO timestamp of the last update.",
    example: "2026-03-04T09:12:00.000Z",
    required: true,
  })
  @Expose()
  updatedAt: string;
}
