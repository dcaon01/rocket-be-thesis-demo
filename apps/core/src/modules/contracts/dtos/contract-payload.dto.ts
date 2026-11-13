import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";

/**
 * DTO of the contract exchanged with the products, in the `CONTRACT` notifications.
 * The referent of the tenant accepts the contract at the first access, from a blocking dialog:
 *   - Rocket → product, CREATE: the contract exists, at the provisioning of its line (no link yet), and whether the
 *     payment must be set up first;
 *   - product → Rocket, UPDATE without `acceptedAt`: the dialog asks for the link to the document;
 *   - Rocket → product, UPDATE: the signed link to the document and its expiry, and the checkout to open while the
 *     payment is not set up;
 *   - Rocket → product, UPDATE with `paymentRequired: false`: the checkout was completed, the contract can be accepted;
 *   - product → Rocket, UPDATE with `acceptedAt`: the referent accepted, with who did it. While the payment is not set
 *     up Rocket refuses it and sends the CREATE again.
 * The document itself never travels in the notifications: they are logged in full.
 */
export class ContractPayloadDto {
  /** Identifier of the contract on Rocket. */
  @ApiProperty({
    example: "6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f",
    description: "Identifier of the contract on Rocket.",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  id: string;

  /** Tenant of the product the contract belongs to. */
  @ApiPropertyOptional({
    example: "acme",
    description: "Tenant of the product the contract belongs to.",
    required: false,
  })
  @IsOptional()
  @IsString()
  tenantId?: string;

  /** Human-readable code of the contract. */
  @ApiPropertyOptional({
    example: "NQ-2026-00007",
    description: "Human-readable code of the contract.",
    required: false,
  })
  @IsOptional()
  @IsString()
  code?: string;

  /** Seats the contract grants. */
  @ApiPropertyOptional({
    example: 8,
    description: "Seats the contract grants.",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  seats?: number;

  /** Start date of the contract (ISO 8601). */
  @ApiPropertyOptional({
    example: "2026-10-06T10:00:00.000Z",
    description: "Start date of the contract (ISO 8601).",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** Signed link to the document of the contract, sent by Rocket on request. */
  @ApiPropertyOptional({
    example: "https://bucket.s3.eu-north-1.amazonaws.com/contract-documents/…",
    description: "Signed link to the document of the contract, sent by Rocket on request.",
    required: false,
  })
  @IsOptional()
  @IsString()
  documentUrl?: string;

  /** When the link to the document expires (ISO 8601): past it, the product asks for a new one. */
  @ApiPropertyOptional({
    example: "2026-10-06T11:00:00.000Z",
    description: "When the link to the document expires (ISO 8601): past it, the product asks for a new one.",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  documentUrlExpiresAt?: string;

  /** Whether the referent must set up the payment, with the checkout, before accepting the contract; sent by Rocket. */
  @ApiPropertyOptional({
    example: true,
    description: "Whether the referent must set up the payment, with the checkout, before accepting the contract; sent by Rocket.",
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  paymentRequired?: boolean;

  /** Link of the Stripe checkout that sets up the payment, sent with the link to the document while it is required. */
  @ApiPropertyOptional({
    example: "https://checkout.stripe.com/c/pay/cs_test_a1b2c3",
    description: "Link of the Stripe checkout that sets up the payment, sent with the link to the document while it is required.",
    required: false,
  })
  @IsOptional()
  @IsString()
  checkoutUrl?: string;

  /** When the checkout expires (ISO 8601): past it, the product asks for the link again and gets a new one. */
  @ApiPropertyOptional({
    example: "2026-10-07T10:00:00.000Z",
    description: "When the checkout expires (ISO 8601): past it, the product asks for the link again and gets a new one.",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  checkoutExpiresAt?: string;

  /** When the referent accepted the contract (ISO 8601), sent by the product. */
  @ApiPropertyOptional({
    example: "2026-10-06T10:42:00.000Z",
    description: "When the referent accepted the contract (ISO 8601), sent by the product.",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  acceptedAt?: string;

  /** Identifier on the product of the user who accepted, required with `acceptedAt`. */
  @ApiPropertyOptional({
    example: "a1b2c3d4-sub",
    description: "Identifier on the product of the user who accepted, required with acceptedAt.",
    required: false,
  })
  @IsOptional()
  @IsString()
  acceptedByUserId?: string;

  /** Full name of the user who accepted, printed on the document. */
  @ApiPropertyOptional({
    example: "Mario Rossi",
    description: "Full name of the user who accepted, printed on the document.",
    required: false,
  })
  @IsOptional()
  @IsString()
  acceptedByName?: string;

  /** Email of the user who accepted, required with `acceptedAt`: printed on the document, and where the product sends it. */
  @ApiPropertyOptional({
    example: "mario.rossi@acme.it",
    description: "Email of the user who accepted, required with acceptedAt: printed on the document, and where the product sends it.",
    required: false,
  })
  @IsOptional()
  @IsEmail()
  acceptedByEmail?: string;
}
