import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * A reseller of the network map (UR-RK-001): a reseller with the fee in force, placed by the province of its legal
 * address, with the licenses it activated in the current period.
 */
export class ResponseResellerNetworkEntryDto {
  /** Identifier of the reseller. */
  @ApiProperty({
    example: "reseller123",
    description: "Identifier of the reseller.",
    required: true,
  })
  id: string;

  /** Code of the reseller. */
  @ApiProperty({
    example: "RVD-001",
    description: "Code of the reseller.",
    required: true,
  })
  code: string;

  /** Company name of the reseller. */
  @ApiProperty({
    example: "Rivenditore Srl",
    description: "Company name of the reseller.",
    required: true,
  })
  companyName: string;

  /** City of the legal address, absent when the reseller has none. */
  @ApiPropertyOptional({
    example: "Fermo",
    description: "City of the legal address, absent when the reseller has none.",
    required: false,
  })
  city?: string;

  /** Province code of the legal address, upper case, absent when the reseller has none. */
  @ApiPropertyOptional({
    example: "FM",
    description: "Province code of the legal address, upper case, absent when the reseller has none.",
    required: false,
  })
  province?: string;

  /** Products the reseller is enabled to sell. */
  @ApiProperty({
    example: ["product123"],
    description: "Products the reseller is enabled to sell.",
    required: true,
    type: [String],
  })
  productIds: string[];

  /** Contracts the reseller itself sold that started in the current period, transfers excluded. */
  @ApiProperty({
    example: 4,
    description: "Contracts the reseller itself sold that started in the current period, transfers excluded.",
    required: true,
  })
  licensesActivated: number;
}
