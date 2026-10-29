import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Trials active today of a product and a seller, for the Rocket half of the sales metrics (UR-RK-222): a snapshot,
 * counted when read and never stored.
 */
export class ResponseSalesActiveTrialsDto {
  /** Identifier of the product. */
  @ApiProperty({
    example: "product123",
    description: "Identifier of the product.",
    required: true,
  })
  productId: string;

  /** Code of the reseller that opened the trials, absent for the trials of Keus. */
  @ApiPropertyOptional({
    example: "ACME",
    description: "Code of the reseller that opened the trials, absent for the trials of Keus.",
    required: false,
  })
  resellerCode?: string;

  /** Trials active today. */
  @ApiProperty({
    example: 5,
    description: "Trials active today.",
    required: true,
  })
  trials: number;
}
