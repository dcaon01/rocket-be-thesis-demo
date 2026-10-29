import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Data Transfer Object for Contact information.
 */
export class ContactDto {
  /**
   * Email address of the contact.
   */
  @ApiPropertyOptional({
    description: "Email address of the contact",
    example: "example@mail.com",
  })
  @IsOptional()
  @IsString()
  email?: string;

  /**
   * Phone number of the contact.
   */
  @ApiPropertyOptional({
    description: "Phone number of the contact",
    example: "+1234567890",
  })
  @IsOptional()
  @IsString()
  phoneNum?: string;

  /**
   * Website of the contact.
   */
  @ApiPropertyOptional({
    description: "Website of the contact",
    example: "https://example.com",
  })
  @IsOptional()
  @IsString()
  webSite?: string;

  /**
   * Type of contact (e.g., personal, business).
   */
  @ApiPropertyOptional({
    description: "Type of contact (e.g., personal, business)",
    example: "business",
  })
  @IsOptional()
  @IsString()
  contactType?: string;
}