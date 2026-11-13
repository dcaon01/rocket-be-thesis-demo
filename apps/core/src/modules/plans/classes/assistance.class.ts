import { Expose } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString, Min } from "class-validator";

/**
 * Optional separately-priced assistance of a plan, copied onto the order line.
 * It is charged once and covers the whole duration of the order.
 */
export class Assistance {
  /** Assistance amount in cents. */
  @ApiProperty({
    description: "Assistance amount in cents.",
    example: 120000,
    required: true,
  })
  @IsNumber()
  @Min(0)
  @Expose()
  amountCents: number;

  /** Human-readable label rendered on the offer. */
  @ApiPropertyOptional({
    description: "Human-readable label rendered on the offer.",
    example: "Assistenza 5 anni",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Expose()
  label?: string;
}
