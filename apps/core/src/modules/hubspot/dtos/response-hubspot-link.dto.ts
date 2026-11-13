import { ApiProperty } from "@nestjs/swagger";

/**
 * Data Transfer Object for responding with a link that opens a view on HubSpot.
 */
export class ResponseHubspotLinkDto {
  @ApiProperty({
    description: "Link that opens the view on HubSpot.",
    example: "https://app-eu1.hubspot.com/contacts/123456/objects/0-3/views/all/board?pipeline=4129198276"
  })
  url: string;
}
