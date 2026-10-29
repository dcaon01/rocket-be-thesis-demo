import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString } from "class-validator";

/**
 * Structured legal address of a reseller or a company.
 * Kept as a value object instead of a single free-text line, so the fiscal
 * documents and the network map can read the parts they need.
 */
export class LegalAddress {
  /** Street and number. */
  @ApiProperty({
    description: "Street and number.",
    example: "Piazza Ostilio Ricci 3",
    required: true,
  })
  @IsString()
  street: string;

  /** City. */
  @ApiProperty({
    description: "City.",
    example: "Fermo",
    required: true,
  })
  @IsString()
  city: string;

  /** Postal code. */
  @ApiProperty({
    description: "Postal code.",
    example: "63900",
    required: true,
  })
  @IsString()
  zipCode: string;

  /** Province code, stored upper case so that the network map finds it. */
  @ApiPropertyOptional({
    description: "Province code, stored upper case so that the network map finds it.",
    example: "FM",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.toUpperCase() : value)
  province?: string;

  /** ISO country code. */
  @ApiPropertyOptional({
    description: "ISO country code.",
    example: "IT",
    required: false,
  })
  @IsOptional()
  @IsString()
  country?: string;
}
