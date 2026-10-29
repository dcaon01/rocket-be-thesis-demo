import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose, Type } from "class-transformer";
import { Assistance } from "../../plans/classes/assistance.class";
import { SyncState } from "../../../commons/enums/sync-state.enum";
import { TenantStatus } from "../../tenants/enums/tenant-status.enum";
import { ResellerMargin } from "../classes/reseller-margin.class";
import { OrderLineStatus } from "../enums/order-line-status.enum";

/**
 * DTO returned for an order line.
 * `resellerMargin` and the `billed*` amounts are the purchase terms of the
 * reseller: they are left out for a reseller salesperson.
 */
export class ResponseOrderLineDto {
  /** Identifier of the product the line refers to. */
  @ApiProperty({
    description: "Identifier of the product the line refers to.",
    example: "product-id-123",
    required: true,
  })
  @Expose()
  productId: string;

  /** Identifier of the owning order. */
  @ApiProperty({
    description: "Identifier of the owning order.",
    example: "order-id-123",
    required: true,
  })
  @Expose()
  orderId: string;

  /** Code of the owning order. */
  @ApiProperty({
    description: "Code of the owning order.",
    example: "ORD-2026-00001",
    required: true,
  })
  @Expose()
  orderCode: string;

  /** Name of the product. */
  @ApiProperty({
    description: "Name of the product.",
    example: "Nquadro",
    required: true,
  })
  @Expose()
  productName: string;

  /** Identifier of the plan pricing this line. */
  @ApiPropertyOptional({
    description: "Identifier of the plan pricing this line.",
    example: "plan-id-123",
    required: false,
  })
  @Expose()
  planId?: string;

  /** Name of the plan. */
  @ApiPropertyOptional({
    description: "Name of the plan.",
    example: "Tiers annuale",
    required: false,
  })
  @Expose()
  planName?: string;

  /** Number of seats sold on this line. */
  @ApiPropertyOptional({
    description: "Number of seats sold on this line. Only volume plans are priced by seats.",
    example: 8,
    required: false,
  })
  @Expose()
  seats?: number;

  /** Provisioning state of the line. Absent until the order is confirmed. */
  @ApiPropertyOptional({
    description: "Provisioning state of the line. Absent until the order is confirmed.",
    enum: OrderLineStatus,
    required: false,
  })
  @Expose()
  status?: OrderLineStatus;

  /** Identifier of the company. */
  @ApiProperty({
    description: "Identifier of the company.",
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

  /** Reseller lineage of the seller, absent on direct orders. */
  @ApiPropertyOptional({
    description: "Reseller lineage of the seller, absent on direct orders.",
    example: "ACME#",
    required: false,
  })
  @Expose()
  resellerPath?: string;

  /** List activation amount in cents. */
  @ApiPropertyOptional({
    description: "List activation amount in cents.",
    example: 50000,
    required: false,
  })
  @Expose()
  listActivationCents?: number;

  /** List recurring amount in cents, per billing interval of the plan. */
  @ApiPropertyOptional({
    description: "List recurring amount in cents, per billing interval of the plan.",
    example: 149760,
    required: false,
  })
  @Expose()
  listRecurringCents?: number;

  /** Discount on the activation granted to the customer, in percent. */
  @ApiProperty({
    description: "Discount on the activation granted to the customer, in percent.",
    example: 0,
    required: true,
  })
  @Expose()
  activationDiscountPercent: number;

  /** Discount on the recurring fee granted to the customer, in percent. */
  @ApiProperty({
    description: "Discount on the recurring fee granted to the customer, in percent.",
    example: 10,
    required: true,
  })
  @Expose()
  recurringDiscountPercent: number;

  /** Activation amount printed on the offer, in cents. */
  @ApiPropertyOptional({
    description: "Activation amount printed on the offer, in cents.",
    example: 50000,
    required: false,
  })
  @Expose()
  offerActivationCents?: number;

  /** Recurring amount printed on the offer, in cents. */
  @ApiPropertyOptional({
    description: "Recurring amount printed on the offer, in cents.",
    example: 134784,
    required: false,
  })
  @Expose()
  offerRecurringCents?: number;

  /** Margin of the reseller. Absent on direct orders and for a reseller salesperson. */
  @ApiPropertyOptional({
    description: "Margin of the reseller. Absent on direct orders and for a reseller salesperson.",
    type: ResellerMargin,
    required: false,
  })
  @Expose()
  @Type(() => ResellerMargin)
  resellerMargin?: ResellerMargin;

  /** Activation amount Keus invoices, in cents. Absent for a reseller salesperson. */
  @ApiPropertyOptional({
    description: "Activation amount Keus invoices, in cents. Absent for a reseller salesperson.",
    example: 30000,
    required: false,
  })
  @Expose()
  billedActivationCents?: number;

  /** Recurring amount Keus invoices, in cents. Absent for a reseller salesperson. */
  @ApiPropertyOptional({
    description: "Recurring amount Keus invoices, in cents. Absent for a reseller salesperson.",
    example: 89856,
    required: false,
  })
  @Expose()
  billedRecurringCents?: number;

  /** Separately-priced assistance component, at full price. */
  @ApiPropertyOptional({
    description: "Separately-priced assistance component, at full price.",
    type: Assistance,
    required: false,
  })
  @Expose()
  @Type(() => Assistance)
  assistance?: Assistance;

  /** Identifier of the tenant created at provisioning. */
  @ApiPropertyOptional({
    description: "Identifier of the tenant created at provisioning.",
    example: "tenant-id-123",
    required: false,
  })
  @Expose()
  tenantId?: string;

  /** Status of the tenant, for the back office only, in the detail of the order and in the lines to provision. */
  @ApiPropertyOptional({
    description: "Status of the tenant, for the back office only, in the detail of the order and in the lines to provision.",
    enum: TenantStatus,
    example: TenantStatus.Requested,
    required: false,
  })
  @Expose()
  tenantStatus?: TenantStatus;

  /** Whether the tenant matches its copy on the product, for the back office only, in the detail of the order and in the lines to provision. */
  @ApiPropertyOptional({
    description: "Whether the tenant matches its copy on the product, for the back office only, in the detail of the order and in the lines to provision.",
    enum: SyncState,
    example: SyncState.Failed,
    required: false,
  })
  @Expose()
  tenantSyncState?: SyncState;

  /** Error the product answered the tenant request with, for the back office only, in the detail of the order and in the lines to provision. */
  @ApiPropertyOptional({
    description: "Error the product answered the tenant request with, for the back office only, in the detail of the order and in the lines to provision.",
    example: "Tenant name already taken",
    required: false,
  })
  @Expose()
  tenantFailureReason?: string;

  /** Users asked with the tenant still waiting for the product, for the back office only, in the detail of the order and in the lines to provision. */
  @ApiPropertyOptional({
    description: "Users asked with the tenant still waiting for the product, for the back office only, in the detail of the order and in the lines to provision.",
    example: 2,
    required: false,
  })
  @Expose()
  tenantPendingUsers?: number;

  /** Contract born when the line was provisioned. */
  @ApiPropertyOptional({
    description: "Contract born when the line was provisioned.",
    example: "contract_67890",
    required: false,
  })
  @Expose()
  contractId?: string;

  /** Code of the contract born when the line was provisioned. */
  @ApiPropertyOptional({
    description: "Code of the contract born when the line was provisioned.",
    example: "NQ-2026-00007",
    required: false,
  })
  @Expose()
  contractCode?: string;

  /** Indirect contract the line takes over, on the order that moves a company to Keus. */
  @ApiPropertyOptional({
    description: "Indirect contract the line takes over, on the order that moves a company to Keus.",
    required: false,
  })
  @Expose()
  previousContractId?: string;

  /** End of the period the reseller already paid on the contract taken over. */
  @ApiPropertyOptional({
    description: "End of the period the reseller already paid on the contract taken over.",
    example: "2026-11-06T00:00:00.000Z",
    required: false,
  })
  @Expose()
  paidUntil?: string;

  /** ISO timestamp of the confirmation of the order. */
  @ApiPropertyOptional({
    description: "ISO timestamp of the confirmation of the order.",
    example: "2026-03-12T15:20:00.000Z",
    required: false,
  })
  @Expose()
  confirmedAt?: string;

  /** ISO timestamp of the delivery of the credentials. */
  @ApiPropertyOptional({
    description: "ISO timestamp of the delivery of the credentials.",
    example: "2026-03-16T09:00:00.000Z",
    required: false,
  })
  @Expose()
  provisionedAt?: string;

  /** ISO timestamp of the first access with acceptance of the terms. */
  @ApiPropertyOptional({
    description: "ISO timestamp of the first access with acceptance of the terms.",
    example: "2026-03-17T10:42:00.000Z",
    required: false,
  })
  @Expose()
  activatedAt?: string;
}
