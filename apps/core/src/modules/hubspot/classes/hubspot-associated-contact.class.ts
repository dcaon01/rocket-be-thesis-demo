import { ApiProperty } from "@nestjs/swagger";

/**
 * DTO for associated contact information.
 */
export class HubspotAssociatedContactDto {
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
}
