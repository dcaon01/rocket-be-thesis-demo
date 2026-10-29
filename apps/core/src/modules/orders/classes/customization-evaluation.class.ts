import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from "class-validator";

/**
 * Outcome of one customization in the quotation of the back office: priced with one or both list amounts, or
 * refused with a reason. The service rejects an outcome that is both, or neither.
 */
export class CustomizationEvaluation {
  /** Identifier of the customization. */
  @ApiProperty({
    description: "Identifier of the customization.",
    example: "customization-id-123",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  customizationId: string;

  /** One-off list amount, in cents. */
  @ApiPropertyOptional({
    description: "One-off list amount, in cents.",
    example: 250000,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  listOneOffCents?: number;

  /** Increase of the recurring fee, in cents per billing interval. */
  @ApiPropertyOptional({
    description: "Increase of the recurring fee, in cents per billing interval.",
    example: 30000,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  listRecurringIncreaseCents?: number;

  /** Reason of the refusal, for whoever sells the order. */
  @ApiPropertyOptional({
    description: "Reason of the refusal, for whoever sells the order.",
    example: "La funzione richiesta è già in roadmap.",
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refusalReason?: string;
}
