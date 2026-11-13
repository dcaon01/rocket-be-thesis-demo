import { ApiProperty } from "@nestjs/swagger";

/**
 * Data Transfer Object for responding with HubSpot deal information.
 */
export class ResponseHubspotDealDto {
  /** The identifier of the deal in HubSpot (hs_object_id of deal). */
  @ApiProperty({
    description: "The identifier of the deal in HubSpot (hs_object_id of deal).",
    example: "123456789"
  })
  id: string;

  /** The name of the deal in HubSpot. */
  @ApiProperty({
    description: "The name of the deal in HubSpot.",
    example: "New Contract Deal"
  })
  dealname: string;
}