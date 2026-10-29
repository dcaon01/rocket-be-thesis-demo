import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from "class-validator";
import { CustomizationInput } from "../classes/customization-input.class";
import { OrderLineInput } from "../classes/order-line-input.class";

/**
 * DTO used to edit a draft order.
 * Only code, lines and customizations change before the offer goes out: once the
 * order is SENT it evolves through its transitions, not by editing it.
 */
export class UpdateOrderDto {
  /** Code of the order, changed by hand. */
  @ApiPropertyOptional({
    description: "Code of the order, changed by hand.",
    example: "ORD-2026-00001",
    required: false,
  })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  code?: string;

  /** Lines of the order, replacing the current ones. Omitted to leave them untouched. */
  @ApiPropertyOptional({
    description: "Lines of the order, replacing the current ones. Omitted to leave them untouched.",
    type: [OrderLineInput],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineInput)
  lines?: OrderLineInput[];

  /**
   * Customization requests, replacing the current ones: those kept carry their id. Omitted to leave them untouched,
   * empty to remove them all. Removing a line removes its customization.
   */
  @ApiPropertyOptional({
    description: "Customization requests, replacing the current ones: those kept carry their id. Omitted to leave them untouched, empty to remove them all.",
    type: [CustomizationInput],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomizationInput)
  customizations?: CustomizationInput[];
}
