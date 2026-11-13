import { ApiProperty } from "@nestjs/swagger";

/**
 * A brand of the Intercom workspace, for the choice of the brand of a product.
 */
export class ResponseIntercomBrandDto {
  /** Identifier of the brand. */
  @ApiProperty({
    example: "15078",
    description: "Identifier of the brand.",
    required: true,
  })
  id: string;

  /** Name of the brand, as the conversations carry it. */
  @ApiProperty({
    example: "Genio",
    description: "Name of the brand, as the conversations carry it.",
    required: true,
  })
  name: string;
}
