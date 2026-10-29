import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsOptional } from "class-validator";

/** DTO for marking a due date of an item collected, or not collected after a mistake. */
export class CollectCustomerChargeDto {
  /** Whether the due date is collected. */
  @ApiProperty({
    description: "Whether the due date is collected.",
    example: true,
    required: true,
  })
  @IsBoolean()
  collected: boolean;

  /** The due date of a recurring item it refers to (ISO string); a single item has one. */
  @ApiPropertyOptional({
    description: "The due date of a recurring item it refers to (ISO string); a single item has one.",
    example: "2026-11-01T00:00:00.000Z",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
