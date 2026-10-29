import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CustomerFollowUpReason } from "../enums/customer-follow-up-reason.enum";

/**
 * A customer to follow up today: a company on a product that never logged in, whose contract is ending, or whose
 * access is suspended for an unpaid invoice.
 */
export class ResponseCustomerFollowUpDto {
  /** Identifier of the product. */
  @ApiProperty({
    example: "product123",
    description: "Identifier of the product.",
    required: true,
  })
  productId: string;

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

  /** Code of the reseller that sold the product, absent on the direct channel. */
  @ApiPropertyOptional({
    example: "ACME",
    description: "Code of the reseller that sold the product, absent on the direct channel.",
    required: false,
  })
  resellerCode?: string;

  /** Why the customer is to follow up. */
  @ApiProperty({
    enum: CustomerFollowUpReason,
    description: "Why the customer is to follow up.",
    required: true,
  })
  reason: CustomerFollowUpReason;

  /**
   * Date the reason refers to (ISO string): the delivery of the credentials, the end of the contract or the
   * suspension of the access.
   */
  @ApiProperty({
    example: "2026-03-16T09:00:00.000Z",
    description: "Date the reason refers to: the delivery of the credentials, the end of the contract or the suspension of the access.",
    required: true,
  })
  date: string;
}
