import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";
import { TrialStatus } from "../enums/trial-status.enum";
import { UsersLimitType } from "../enums/users-limit-type.enum";

/**
 * DTO for creating a new trial.
 * If status is DRAFT, activatedAt and expiresAt are not set.
 * If status is ACTIVE (default), activatedAt is set to now and expiresAt is calculated
 * from the product's defaultTrialDuration (in days), unless an explicit expiresAt is provided.
 */
export class CreateTrialDto {
  /** Identifier of the product associated with the trial. */
  @ApiProperty({
    description: "Identifier of the product associated with the trial.",
    example: "product_12345",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  productId: string;

  /** Description of the trial. */
  @ApiPropertyOptional({
    description: "Description of the trial.",
    example: "Trial for testing the premium plan.",
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  /** Email associated with the trial. Can't open more trials with the same email. */
  @ApiProperty({
    description: "Email associated with the trial. Can't open more trials with the same email.",
    example: "client@example.com",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  associatedEmail: string;

  /** Status of the trial. Defaults to ACTIVE. Use DRAFT to create without activation/expiration dates. */
  @ApiPropertyOptional({
    description: "Status of the trial. Defaults to ACTIVE. Use DRAFT to create without activation/expiration dates.",
    example: "ACTIVE",
    enum: [TrialStatus.Active, TrialStatus.Draft],
    required: false,
  })
  @IsOptional()
  @IsEnum([TrialStatus.Active, TrialStatus.Draft])
  status?: TrialStatus.Active | TrialStatus.Draft;

  /** Optional explicit expiration date. If not provided, calculated from the product's defaultTrialDuration (in days). */
  @ApiPropertyOptional({
    description: "Optional explicit expiration date. If not provided, calculated from the product's defaultTrialDuration (in days).",
    example: "2026-06-30T23:59:59.999Z",
    required: false,
  })
  @IsOptional()
  @IsString()
  expiresAt?: string;

  /** Whether the trial never expires (can only be cancelled manually). Defaults to false. Cannot be used together with expiresAt. */
  @ApiPropertyOptional({
    description: "Whether the trial never expires (can only be cancelled manually). Defaults to false. Cannot be used together with expiresAt.",
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  perpetual?: boolean;

  /** Type of users limit for the trial. PRODUCT uses the product's default, INFINITE means no limit, CUSTOM requires usersLimit. */
  @ApiProperty({
    description: "Type of users limit for the trial. PRODUCT uses the product's default, INFINITE means no limit, CUSTOM requires usersLimit.",
    example: "PRODUCT",
    enum: UsersLimitType,
    required: true,
  })
  @IsNotEmpty()
  @IsEnum(UsersLimitType)
  usersLimitType: UsersLimitType;

  /** Maximum number of users allowed for the trial. */
  @ApiPropertyOptional({
    description: "Maximum number of users allowed for the trial.",
    example: 10,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  usersLimit?: number;

  /** Identifier of the CRM deal that opened the trial. */
  @ApiPropertyOptional({
    description: "Identifier of the CRM deal that opened the trial.",
    example: "1234567890",
    required: false,
  })
  @IsOptional()
  @IsString()
  dealId?: string;
}
