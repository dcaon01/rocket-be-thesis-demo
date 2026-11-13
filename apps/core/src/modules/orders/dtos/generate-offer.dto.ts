import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

/**
 * DTO used to record that the offer has been generated and sent.
 * The document is compiled by the frontend from the template in force; the
 * service checks the template is still the one in force for the channel.
 */
export class GenerateOfferDto {
  /** Identifier of the offer template the document was generated from. */
  @ApiProperty({
    description: "Identifier of the offer template the document was generated from.",
    example: "template-id-123",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  templateId: string;
}
