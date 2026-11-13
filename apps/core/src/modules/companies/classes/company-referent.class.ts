import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString } from "class-validator";

/**
 * Person to talk to at a company; every field is optional.
 * Kept on the company record as part of its records: no other part of Rocket reads it.
 */
export class CompanyReferent {
  /** First name of the referent. */
  @ApiPropertyOptional({
    description: "First name of the referent.",
    example: "Mario",
    required: false,
  })
  @IsOptional()
  @IsString()
  firstName?: string;

  /** Last name of the referent. */
  @ApiPropertyOptional({
    description: "Last name of the referent.",
    example: "Rossi",
    required: false,
  })
  @IsOptional()
  @IsString()
  lastName?: string;

  /** Email of the referent. */
  @ApiPropertyOptional({
    description: "Email of the referent.",
    example: "mario.rossi@example.com",
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  /** Phone number of the referent. */
  @ApiPropertyOptional({
    description: "Phone number of the referent.",
    example: "+39 333 1234567",
    required: false,
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
