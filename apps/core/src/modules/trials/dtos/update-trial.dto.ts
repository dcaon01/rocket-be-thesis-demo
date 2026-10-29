import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsEnum, IsOptional, IsString } from "class-validator";
import { TrialStatus } from "../enums/trial-status.enum";

/**
 * DTO for updating a trial.
 */
export class UpdateTrialDto {
  /** Description of the trial. */
  @ApiPropertyOptional({
    description: "Description of the trial.",
    example: "Trial for testing the premium plan.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  /** Expires date of the trial period. */
  @ApiPropertyOptional({
    description: "Expires date of the trial period.",
    example: "2026-06-30T23:59:59.999Z",
    required: false,
  })
  @IsOptional()
  @IsString()
  expiresAt?: string;

  /** Email associated with the trial. */
  @ApiPropertyOptional({
    description: "Email associated with the trial.",
    example: "client@example.com",
    required: false,
  })
  @IsOptional()
  @IsString()
  associatedEmail?: string;

  /** Status of the trial. */
  @ApiPropertyOptional({
    description: "Status of the trial.",
    example: "cancelled",
    enum: TrialStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(TrialStatus)
  status?: TrialStatus;

  /** Indicates whether the trial has been redeemed, so a tenant linked to the trial has been created. */
  @ApiPropertyOptional({
    description: "Indicates whether the trial has been redeemed, so a tenant linked to the trial has been created.",
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  redeemed?: boolean;

}
