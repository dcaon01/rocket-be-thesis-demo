import { ApiProperty } from "@nestjs/swagger";

/**
 * Data Transfer Object for responding with HubSpot contact information.
 */
export class ResponseHubspotContactDto {
  @ApiProperty({
    description: "The contact ID in HubSpot.",
    example: "123456"
  })
  id: string;

  @ApiProperty({
    description: "First name of the contact.",
    example: "John",
    required: false
  })
  firstname?: string;

  @ApiProperty({
    description: "Last name of the contact.",
    example: "Doe",
    required: false
  })
  lastname?: string;

  @ApiProperty({
    description: "Email of the contact.",
    example: "john.doe@example.com",
    required: false
  })
  email?: string;

  @ApiProperty({
    description: "Phone number of the contact.",
    example: "+39 123 456789",
    required: false
  })
  phone?: string;

  @ApiProperty({
    description: "Address of the contact.",
    example: "Via Roma 1",
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
    description: "Company name.",
    example: "Acme Inc.",
    required: false
  })
  company?: string;
}
