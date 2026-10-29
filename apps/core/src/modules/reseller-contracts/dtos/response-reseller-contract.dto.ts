import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ResellerContractMargin } from "../classes/reseller-contract-margin.class";
import { ResellerFee } from "../classes/reseller-fee.class";
import { ResellerContractStatus } from "../enums/reseller-contract-status.enum";
import { ResellerTier } from "../../resellers/enums/reseller-tier.enum";
import { StripeAccountLink } from "../../stripe/classes/stripe-account-link.class";

/**
 * Data Transfer Object for responding with a reseller contract.
 */
export class ResponseResellerContractDto {
  /** Identifier of the reseller. */
  @ApiProperty({
    description: "Identifier of the reseller.",
    example: "5f0c8a2e-1b2c-4d3e-8f90-1a2b3c4d5e6f",
    required: true,
  })
  resellerId: string;

  /** Identifier of the contract. */
  @ApiProperty({
    description: "Identifier of the contract.",
    example: "9a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    required: true,
  })
  id: string;

  /** Human-readable code of the contract: the reseller code and a sequence. */
  @ApiProperty({
    description: "Human-readable code of the contract: the reseller code and a sequence.",
    example: "RVD-001-001",
    required: true,
  })
  code: string;

  /** Code of the reseller. */
  @ApiProperty({
    description: "Code of the reseller.",
    example: "RVD-001",
    required: true,
  })
  resellerCode: string;

  /** Company name of the reseller. */
  @ApiProperty({
    description: "Company name of the reseller.",
    example: "Rivenditore S.r.l.",
    required: true,
  })
  resellerName: string;

  /** Email of the reseller. */
  @ApiProperty({
    description: "Email of the reseller.",
    example: "amministrazione@rivenditore.it",
    required: true,
  })
  resellerEmail: string;

  /** Partner tier of the contract. */
  @ApiProperty({
    description: "Partner tier of the contract.",
    enum: ResellerTier,
    example: ResellerTier.Gold,
    required: true,
  })
  tier: ResellerTier;

  /** Fee of the contract by year: first, second and from the third on. */
  @ApiProperty({
    description: "Fee of the contract by year: first, second and from the third on.",
    type: ResellerFee,
    required: true,
  })
  fee: ResellerFee;

  /** Products the reseller is enabled to sell under the contract. */
  @ApiProperty({
    description: "Products the reseller is enabled to sell under the contract.",
    example: ["product-id-1", "product-id-2"],
    required: true,
  })
  productIds: string[];

  /** Margin of the reseller, copied onto the order lines. Hidden from a reseller salesperson. */
  @ApiPropertyOptional({
    description: "Margin of the reseller, copied onto the order lines. Hidden from a reseller salesperson.",
    type: ResellerContractMargin,
    required: false,
  })
  margin?: ResellerContractMargin;

  /** Status of the contract. */
  @ApiProperty({
    description: "Status of the contract.",
    enum: ResellerContractStatus,
    example: ResellerContractStatus.Active,
    required: true,
  })
  status: ResellerContractStatus;

  /** Start date of the contract (ISO string). */
  @ApiProperty({
    description: "Start date of the contract (ISO string).",
    example: "2026-10-01T00:00:00.000Z",
    required: true,
  })
  validityDate: string;

  /** Number of validity years since the start. */
  @ApiProperty({
    description: "Number of validity years since the start.",
    example: 1,
    required: true,
  })
  validityYears: number;

  /** End date of the contract (ISO string), once it has ended. */
  @ApiPropertyOptional({
    description: "End date of the contract (ISO string), once it has ended.",
    example: "2027-10-01T00:00:00.000Z",
    required: false,
  })
  endDate?: string;

  /** S3 key of the signed framework agreement. */
  @ApiPropertyOptional({
    description: "S3 key of the signed framework agreement.",
    example: "resellers/5f0c/contracts/9a1b/signed-contract.pdf",
    required: false,
  })
  signedContractS3Key?: string;

  /** Stripe customer of the reseller. */
  @ApiPropertyOptional({
    description: "Stripe customer of the reseller.",
    example: "cus_123",
    required: false,
  })
  stripeCustomerId?: string;

  /** Stripe subscription billing the fee. */
  @ApiPropertyOptional({
    description: "Stripe subscription billing the fee.",
    example: "sub_123",
    required: false,
  })
  stripeSubscriptionId?: string;

  /** Stripe checkout session URL for the SEPA mandate and the first payment. */
  @ApiPropertyOptional({
    description: "Stripe checkout session URL for the SEPA mandate and the first payment.",
    example: "https://checkout.stripe.com/c/pay/cs_123",
    required: false,
  })
  checkoutSessionUrl?: string;

  /** Stripe checkout session expiration date (ISO string). */
  @ApiPropertyOptional({
    description: "Stripe checkout session expiration date (ISO string).",
    example: "2026-10-02T00:00:00.000Z",
    required: false,
  })
  checkoutSessionExpiresAt?: string;

  /** Customer and SEPA mandate of the reseller on the Stripe account of each product, held by the contract in force. A reseller sees only the account and when the mandate was collected. */
  @ApiPropertyOptional({
    description: "Customer and SEPA mandate of the reseller on the Stripe account of each product, held by the contract in force. A reseller sees only the account and when the mandate was collected.",
    type: StripeAccountLink,
    isArray: true,
    required: false,
  })
  stripeAccounts?: StripeAccountLink[];

  /** Creation timestamp. */
  @ApiProperty({
    description: "Creation timestamp.",
    required: true,
  })
  createdAt: string;

  /** Last update timestamp. */
  @ApiProperty({
    description: "Last update timestamp.",
    required: true,
  })
  updatedAt: string;
}
