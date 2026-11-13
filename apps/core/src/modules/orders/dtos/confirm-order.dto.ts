import { ApiProperty } from "@nestjs/swagger";
import { IsISO8601 } from "class-validator";

/**
 * DTO used by the back office to confirm an accepted order.
 */
export class ConfirmOrderDto {
  /** Expected delivery date (ISO). */
  @ApiProperty({
    description: "Expected delivery date (ISO).",
    example: "2026-03-16",
    required: true,
  })
  @IsISO8601()
  deliveryDate: string;
}
