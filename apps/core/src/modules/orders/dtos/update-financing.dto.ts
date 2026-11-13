import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";
import { Financier } from "../enums/financier.enum";

/**
 * DTO used to mark an order of the direct channel as financed, or to remove
 * the financing with NONE. The finance company's contract is required by the
 * time the order is confirmed.
 */
export class UpdateFinancingDto {
  /** Finance company paying the order; NONE removes the financing. */
  @ApiProperty({
    description: "Finance company paying the order; NONE removes the financing.",
    enum: Financier,
    example: Financier.Grenke,
    required: true,
  })
  @IsEnum(Financier)
  financier: Financier;

  /** Identifier of the financing application. */
  @ApiPropertyOptional({
    description: "Identifier of the financing application.",
    example: "GRK-2026-0001",
    required: false,
  })
  @IsOptional()
  @IsString()
  financierReference?: string;

  /** S3 key of the contract signed with the finance company, uploaded as ORDER_FINANCING_CONTRACT. */
  @ApiPropertyOptional({
    description: "S3 key of the contract signed with the finance company, uploaded as ORDER_FINANCING_CONTRACT.",
    example: "orders/order-id-123/financing-contract.pdf",
    required: false,
  })
  @IsOptional()
  @IsString()
  financingContractS3Key?: string;

  /** Years of fee the finance company pays upfront, the duration of the order; required with a recurring line. */
  @ApiPropertyOptional({
    description: "Years of fee the finance company pays upfront, the duration of the order; required with a recurring line.",
    example: 5,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  financedYears?: number;
}
