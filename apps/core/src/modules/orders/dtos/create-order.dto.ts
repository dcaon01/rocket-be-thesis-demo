import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from "class-validator";
import { CustomizationInput } from "../classes/customization-input.class";
import { OrderLineInput } from "../classes/order-line-input.class";

/**
 * DTO used to create an order.
 * An order always concerns a single company: a second company means a second
 * order. Channel and reseller perimeter are not accepted, they are the
 * company's own, and name and VAT number are read from the company record.
 */
export class CreateOrderDto {
  /** Code of the order. Generated as the last code of the year plus one when omitted. */
  @ApiPropertyOptional({
    description: "Code of the order. Generated as the last code of the year plus one when omitted.",
    example: "ORD-2026-00001",
    required: false,
  })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  code?: string;

  /** Identifier of the company the order is placed for. */
  @ApiProperty({
    description: "Identifier of the company the order is placed for.",
    example: "company-id-123",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  companyId: string;

  /** Lines of the order, one per product: at least one. */
  @ApiProperty({
    description: "Lines of the order, one per product: at least one.",
    type: [OrderLineInput],
    required: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineInput)
  lines: OrderLineInput[];

  /** Customization requests: at most one per line, on its product. */
  @ApiPropertyOptional({
    description: "Customization requests: at most one per line, on its product.",
    type: [CustomizationInput],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomizationInput)
  customizations?: CustomizationInput[];

  /** Identifier of the CRM deal that opened the order. */
  @ApiPropertyOptional({
    description: "Identifier of the CRM deal that opened the order.",
    example: "1234567890",
    required: false,
  })
  @IsOptional()
  @IsString()
  dealId?: string;
}
