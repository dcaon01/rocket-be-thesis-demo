import { ApiProperty } from "@nestjs/swagger";

/**
 * Data Transfer Object for responding with HubSpot company information.
 */
export class ResponseHubspotCompanyDto {
  @ApiProperty({
    description: "The company ID in HubSpot.",
    example: "789012"
  })
  id: string;

  @ApiProperty({
    description: "Name of the company.",
    example: "Acme Inc.",
    required: false
  })
  name?: string;

  @ApiProperty({
    description: "Domain of the company.",
    example: "acme.com",
    required: false
  })
  domain?: string;

  @ApiProperty({
    description: "Phone number of the company.",
    example: "+39 02 1234567",
    required: false
  })
  phone?: string;

  @ApiProperty({
    description: "Address.",
    example: "Via Milano 10",
    required: false
  })
  address?: string;

  @ApiProperty({
    description: "City.",
    example: "Milano",
    required: false
  })
  city?: string;

  @ApiProperty({
    description: "State/Province.",
    example: "MI",
    required: false
  })
  state?: string;

  @ApiProperty({
    description: "ZIP/Postal code.",
    example: "20100",
    required: false
  })
  zip?: string;

  @ApiProperty({
    description: "Country.",
    example: "Italy",
    required: false
  })
  country?: string;

  @ApiProperty({
    description: "VAT number (custom property).",
    example: "IT12345678901",
    required: false
  })
  vat_number?: string;

  @ApiProperty({
    description: "PEC - Certified Electronic Mail (custom property).",
    example: "company@pec.it",
    required: false
  })
  pec?: string;

  @ApiProperty({
    description: "SDI code for Italian electronic invoicing (custom property).",
    example: "ABCDEFG",
    required: false
  })
  sdi_code?: string;
}
