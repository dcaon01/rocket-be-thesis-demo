import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsEnum, IsOptional, IsString } from "class-validator";
import { TrialStatus } from "../enums/trial-status.enum";

/**
 * Unified DTO for trial operations cross-product.
 * All fields are optional — the product determines which fields to include
 * based on the operation (create, update, etc.).
 */
export class TrialPayloadDto {
  /** The unique identifier of the trial. */
  @ApiPropertyOptional({
    example: "trial_12345",
    description: "The unique identifier of the trial.",
  })
  @IsString()
  @IsOptional()
  id?: string;

  /** Expires date of the trial period. */
  @ApiPropertyOptional({
    description: "Expires date of the trial period.",
    example: "2026-06-30T23:59:59.999Z",
  })
  @IsOptional()
  @IsString()
  expiresAt?: string;

  /** Email associated with the trial. */
  @ApiPropertyOptional({
    description: "Email associated with the trial.",
    example: "client@example.com",
  })
  @IsOptional()
  @IsString()
  associatedEmail?: string;

  /** Status of the trial. */
  @ApiPropertyOptional({
    description: "Status of the trial.",
    example: "ACTIVE",
    enum: TrialStatus,
  })
  @IsOptional()
  @IsEnum(TrialStatus)
  status?: TrialStatus;

  /** Indicates whether the trial has been redeemed. */
  @ApiPropertyOptional({
    description: "Indicates whether the trial has been redeemed.",
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  redeemed?: boolean;
}
