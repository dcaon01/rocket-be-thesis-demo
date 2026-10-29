import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose, Type } from "class-transformer";
import { CustomizationAttachment } from "../classes/customization-attachment.class";
import { CustomizationKind } from "../enums/customization-kind.enum";
import { CustomizationStatus } from "../enums/customization-status.enum";

/**
 * DTO returned for a customization request.
 * `resellerMarginPercent` and the `billed*` amounts are the purchase terms of
 * the reseller: they are left out for a reseller salesperson.
 */
export class ResponseOrderCustomizationDto {
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

  /** Identifier of the customization request. */
  @ApiProperty({
    description: "Identifier of the customization request.",
    example: "customization-id-123",
    required: true,
  })
  @Expose()
  id: string;

  /** Lifecycle state. */
  @ApiProperty({
    description: "Lifecycle state.",
    enum: CustomizationStatus,
    example: CustomizationStatus.Requested,
    required: true,
  })
  @Expose()
  status: CustomizationStatus;

  /** What the customization is attached to: a line of the order. */
  @ApiProperty({
    description: "What the customization is attached to: a line of the order.",
    enum: CustomizationKind,
    example: CustomizationKind.Product,
    required: true,
  })
  @Expose()
  kind: CustomizationKind;

  /** Product of the line the customization is attached to. */
  @ApiPropertyOptional({
    description: "Product of the line the customization is attached to.",
    example: "product-id-123",
    required: false,
  })
  @Expose()
  productId?: string;

  /** The need, described in words. */
  @ApiPropertyOptional({
    description: "The need, described in words.",
    example: "Integrazione con il gestionale interno",
    required: false,
  })
  @Expose()
  description?: string;

  /** Files describing the need: PDFs and voice notes. */
  @ApiPropertyOptional({
    description: "Files describing the need: PDFs and voice notes.",
    type: [CustomizationAttachment],
    required: false,
  })
  @Expose()
  @Type(() => CustomizationAttachment)
  attachments?: CustomizationAttachment[];

  /** One-off list amount priced by the back office, in cents. */
  @ApiPropertyOptional({
    description: "One-off list amount priced by the back office, in cents.",
    example: 250000,
    required: false,
  })
  @Expose()
  listOneOffCents?: number;

  /** Increase of the recurring fee priced by the back office, in cents. */
  @ApiPropertyOptional({
    description: "Increase of the recurring fee priced by the back office, in cents.",
    example: 30000,
    required: false,
  })
  @Expose()
  listRecurringIncreaseCents?: number;

  /** Discount granted to the customer, in percent. */
  @ApiProperty({
    description: "Discount granted to the customer, in percent.",
    example: 0,
    required: true,
  })
  @Expose()
  discountPercent: number;

  /** One-off amount printed on the offer, in cents. */
  @ApiPropertyOptional({
    description: "One-off amount printed on the offer, in cents.",
    example: 250000,
    required: false,
  })
  @Expose()
  offerOneOffCents?: number;

  /** Increase of the recurring fee printed on the offer, in cents. */
  @ApiPropertyOptional({
    description: "Increase of the recurring fee printed on the offer, in cents.",
    example: 30000,
    required: false,
  })
  @Expose()
  offerRecurringIncreaseCents?: number;

  /** Customization margin of the reseller, in percent. Absent on direct orders and for a reseller salesperson. */
  @ApiPropertyOptional({
    description: "Customization margin of the reseller, in percent. Absent on direct orders and for a reseller salesperson.",
    example: 15,
    required: false,
  })
  @Expose()
  resellerMarginPercent?: number;

  /** One-off amount Keus invoices, in cents. Absent for a reseller salesperson. */
  @ApiPropertyOptional({
    description: "One-off amount Keus invoices, in cents. Absent for a reseller salesperson.",
    example: 212500,
    required: false,
  })
  @Expose()
  billedOneOffCents?: number;

  /** Increase of the recurring fee Keus invoices, in cents. Absent for a reseller salesperson. */
  @ApiPropertyOptional({
    description: "Increase of the recurring fee Keus invoices, in cents. Absent for a reseller salesperson.",
    example: 25500,
    required: false,
  })
  @Expose()
  billedRecurringIncreaseCents?: number;

  /** Reason the request was refused. */
  @ApiPropertyOptional({
    description: "Reason the request was refused.",
    example: "La funzione richiesta è già in roadmap.",
    required: false,
  })
  @Expose()
  refusalReason?: string;

  /** Cognito sub of whoever priced or refused it. */
  @ApiPropertyOptional({
    description: "Cognito sub of whoever priced or refused it.",
    example: "c01c191c",
    required: false,
  })
  @Expose()
  evaluatedBySub?: string;

  /** ISO timestamp of the evaluation. */
  @ApiPropertyOptional({
    description: "ISO timestamp of the evaluation.",
    example: "2026-09-16T09:00:00.000Z",
    required: false,
  })
  @Expose()
  evaluatedAt?: string;

  /** Cognito sub of whoever wrote the request. */
  @ApiPropertyOptional({
    description: "Cognito sub of whoever wrote the request.",
    example: "c01c191c",
    required: false,
  })
  @Expose()
  authorSub?: string;
}
