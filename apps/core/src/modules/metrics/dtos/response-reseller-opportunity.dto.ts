import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ResellerOpportunityReason } from "../enums/reseller-opportunity-reason.enum";

/**
 * A customer of a reseller with room to grow (UR-RK-339): a tenant close to its seats, or a company on a single
 * product with the ones the reseller sells and it does not have yet.
 */
export class ResponseResellerOpportunityDto {
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

  /** Why the customer is an opportunity. */
  @ApiProperty({
    enum: ResellerOpportunityReason,
    description: "Why the customer is an opportunity.",
    required: true,
  })
  reason: ResellerOpportunityReason;

  /** Product the company is on: the one close to its seats, or the only one it has. */
  @ApiProperty({
    example: "product123",
    description: "Product the company is on: the one close to its seats, or the only one it has.",
    required: true,
  })
  productId: string;

  /** Active users of the tenant, on a tenant close to its seats. */
  @ApiPropertyOptional({
    example: 9,
    description: "Active users of the tenant, on a tenant close to its seats.",
    required: false,
  })
  activeUsers?: number;

  /** Seats of the tenant, on a tenant close to its seats. */
  @ApiPropertyOptional({
    example: 10,
    description: "Seats of the tenant, on a tenant close to its seats.",
    required: false,
  })
  seats?: number;

  /** Products the reseller sells and the company does not have, on a company on a single product. */
  @ApiPropertyOptional({
    type: [String],
    example: ["product456"],
    description: "Products the reseller sells and the company does not have, on a company on a single product.",
    required: false,
  })
  missingProductIds?: string[];
}
