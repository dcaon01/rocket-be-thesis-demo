import { ApiProperty } from "@nestjs/swagger";
import { HubspotAssociatedContactDto } from "../classes/hubspot-associated-contact.class";
import { HubspotAssociatedCompanyDto } from "../classes/hubspot-associated-company.class";

/**
 * Data Transfer Object for responding with detailed HubSpot deal information.
 * Includes associated contacts and companies for populating contract beneficiary data.
 */
export class ResponseHubspotDealDetailedDto {
  @ApiProperty({
    description: "The identifier of the deal in HubSpot (hs_object_id of deal).",
    example: "123456789"
  })
  id: string;

  @ApiProperty({
    description: "The name of the deal in HubSpot.",
    example: "New Contract Deal"
  })
  dealname: string;

  @ApiProperty({
    description: "The deal amount/value.",
    example: "10000",
    required: false
  })
  amount?: string;

  @ApiProperty({
    description: "The close date of the deal.",
    example: "2025-12-31",
    required: false
  })
  closedate?: string;

  @ApiProperty({
    description: "The deal stage (HubSpot internal numeric identifier).",
    example: "3696966871",
    required: false
  })
  dealstage?: string;

  @ApiProperty({
    description: "The pipeline ID the deal belongs to.",
    example: "default",
    required: false
  })
  pipeline?: string;

  @ApiProperty({
    description: "The values of the deal property «Soluzione d'interesse», one per product the deal is about.",
    example: ["Ciclo Passivo AI", "Rapportini AI"],
    required: true,
    isArray: true,
    type: String
  })
  solutions: string[];

  @ApiProperty({
    description: "Whether the deal is in a 'Closed Won' stage.",
    example: true,
    required: false
  })
  isClosedWon?: boolean;

  @ApiProperty({
    description: "Associated contact (primary contact for the deal).",
    type: HubspotAssociatedContactDto,
    required: false
  })
  primaryContact?: HubspotAssociatedContactDto;

  @ApiProperty({
    description: "Associated company.",
    type: HubspotAssociatedCompanyDto,
    required: false
  })
  primaryCompany?: HubspotAssociatedCompanyDto;
}
