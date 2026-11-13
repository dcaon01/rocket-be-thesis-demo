import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsDateString, IsEnum, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { InvoiceDocumentStatus } from "../enums/invoice-document-status.enum";
import { InvoiceStatus } from "../enums/invoice-status.enum";

/**
 * Filters every invoice listing shares, the status aside: a page, the document status, the channel, the product and
 * the search. No document status means every status, and the same for the channel and the product.
 */
export class InvoiceFiltersPageQueryDto extends PageQueryDto {
  /** Statuses of the electronic invoice to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Statuses of the electronic invoice to list, every status when absent.",
    enum: InvoiceDocumentStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(InvoiceDocumentStatus, { each: true })
  documentStatus?: InvoiceDocumentStatus[];

  /** Channel of the invoices to list, both when absent. */
  @ApiPropertyOptional({
    description: "Channel of the invoices to list, both when absent.",
    enum: SalesChannel,
  })
  @IsOptional()
  @IsEnum(SalesChannel)
  channel?: SalesChannel;

  /** Product one of the lines must be about, any when absent. */
  @ApiPropertyOptional({
    description: "Product one of the lines must be about, any when absent.",
  })
  @IsOptional()
  @IsString()
  productId?: string;

  /** Start of the invoice number, billed party name or VAT number, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the invoice number, billed party name or VAT number, case-insensitive.",
    example: "2026/",
  })
  @IsOptional()
  @IsString()
  search?: string;
}

/** Query of an invoice listing: a page and its filters, the collection status included, every status when absent. */
export class InvoicesPageQueryDto extends InvoiceFiltersPageQueryDto {
  /** Collection statuses to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Collection statuses to list, every status when absent.",
    enum: InvoiceStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(InvoiceStatus, { each: true })
  status?: InvoiceStatus[];
}

/** Search of the invoices issued in a period: its bounds, the page and the filters. */
export class PeriodInvoicesPageQueryDto extends InvoicesPageQueryDto {
  /** Start of the period of issue (ISO 8601). */
  @ApiProperty({
    description: "Start of the period of issue (ISO 8601).",
    example: "2026-09-30T22:00:00.000Z",
    required: true,
  })
  @IsDateString()
  from: string;

  /** End of the period (ISO 8601), at most 24 months after its start. */
  @ApiProperty({
    description: "End of the period (ISO 8601), at most 24 months after its start.",
    example: "2026-10-31T22:59:59.999Z",
    required: true,
  })
  @IsDateString()
  to: string;
}
