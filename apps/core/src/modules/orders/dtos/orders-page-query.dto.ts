import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsISO8601, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { OrderLineStatus } from "../enums/order-line-status.enum";
import { OrderStatus } from "../enums/order-status.enum";

/**
 * Query of the orders listing: a page and its filters.
 * No status means every status.
 */
export class OrdersPageQueryDto extends PageQueryDto {
  /** Statuses to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Statuses to list, every status when absent.",
    enum: OrderStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(OrderStatus, { each: true })
  status?: OrderStatus[];

  /**
   * Statuses of the lines: an order is listed when at least one of its lines is in one of them (UR-RK-010).
   * Every order when absent.
   */
  @ApiPropertyOptional({
    description: "Statuses of the lines: an order is listed when at least one of its lines is in one of them. Every order when absent.",
    enum: OrderLineStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(OrderLineStatus, { each: true })
  lineStatus?: OrderLineStatus[];

  /** Sales channels to list, both when absent. */
  @ApiPropertyOptional({
    description: "Sales channels to list, both when absent.",
    enum: SalesChannel,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(SalesChannel, { each: true })
  channel?: SalesChannel[];

  /** Reseller whose network to list, for a collaborator previewing its workspace. Ignored for resellers, who always get their own. */
  @ApiPropertyOptional({
    description: "Reseller whose network to list, for a collaborator previewing its workspace. Ignored for resellers, who always get their own.",
    example: "RVD-001",
  })
  @IsOptional()
  @IsString()
  resellerCode?: string;

  /** Start of the order code, company name or VAT number, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the order code, company name or VAT number, case-insensitive.",
    example: "ORD-2026",
  })
  @IsOptional()
  @IsString()
  search?: string;

  /** First instant of the request period (ISO 8601). */
  @ApiPropertyOptional({
    description: "First instant of the request period (ISO 8601).",
    example: "2026-10-01T00:00:00.000Z",
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Last instant of the request period (ISO 8601). */
  @ApiPropertyOptional({
    description: "Last instant of the request period (ISO 8601).",
    example: "2026-10-31T23:59:59.999Z",
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
