import { ApiProperty } from "@nestjs/swagger";

/**
 * A contract of a reseller that renews in the next days (UR-RK-339).
 */
export class ResponseResellerRenewalDto {
  /** Identifier of the product. */
  @ApiProperty({
    example: "product123",
    description: "Identifier of the product.",
    required: true,
  })
  productId: string;

  /** Identifier of the contract. */
  @ApiProperty({
    example: "contract-id-123",
    description: "Identifier of the contract.",
    required: true,
  })
  contractId: string;

  /** Identifier of the company. */
  @ApiProperty({
    example: "company-id-123",
    description: "Identifier of the company.",
    required: true,
  })
  companyId: string;

  /** Legal name of the company. */
  @ApiProperty({
    example: "Ossigeno S.r.l.",
    description: "Legal name of the company.",
    required: true,
  })
  companyName: string;

  /** Date the contract renews (ISO string). */
  @ApiProperty({
    example: "2026-12-01",
    description: "Date the contract renews (ISO string).",
    required: true,
  })
  renewalDate: string;
}
