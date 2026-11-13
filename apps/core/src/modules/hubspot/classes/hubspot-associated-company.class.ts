import { ApiProperty } from "@nestjs/swagger";

/**
 * DTO for associated company information.
 */
export class HubspotAssociatedCompanyDto {
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
    description: "VAT number.",
    example: "IT12345678901",
    required: false
  })
  vatNumber?: string;

  @ApiProperty({
    description: "PEC (Certified Electronic Mail).",
    example: "company@pec.it",
    required: false
  })
  pec?: string;

  @ApiProperty({
    description: "SDI code for Italian electronic invoicing.",
    example: "ABCDEFG",
    required: false
  })
  sdi?: string;

  @ApiProperty({
    description: "Phone number of the company.",
    example: "+39 02 1234567",
    required: false
  })
  phone?: string;

  @ApiProperty({
    description: "Address of the company.",
    example: "Via Milano 10, 20100 Milano, Italy",
    required: false
  })
  address?: string;
}
