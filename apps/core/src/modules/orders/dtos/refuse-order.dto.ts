import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { OrderRefusalReason } from "../enums/order-refusal-reason.enum";

/**
 * DTO used to record the refusal of the offer.
 * The note is optional, except with the reason OTHER.
 */
export class RefuseOrderDto {
  /** Reason of the refusal, from the closed list. */
  @ApiProperty({
    description: "Reason of the refusal, from the closed list.",
    enum: OrderRefusalReason,
    example: OrderRefusalReason.Price,
    required: true,
  })
  @IsEnum(OrderRefusalReason)
  reason: OrderRefusalReason;

  /** Free-text note. Mandatory with the reason OTHER. */
  @ApiPropertyOptional({
    description: "Free-text note. Mandatory with the reason OTHER.",
    example: "Rimandato al prossimo esercizio.",
    required: false,
  })
  @IsOptional()
  @IsString()
  note?: string;
}
