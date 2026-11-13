import { ApiProperty } from "@nestjs/swagger";

/**
 * A project of the Sentry organization, for the choice of the project of a product.
 */
export class ResponseSentryProjectDto {
  /** Identifier of the project, the one the product stores. */
  @ApiProperty({
    example: "4511292228632656",
    description: "Identifier of the project, the one the product stores.",
    required: true,
  })
  id: string;

  /** Short name of the project, as the URLs of Sentry carry it. */
  @ApiProperty({
    example: "genio",
    description: "Short name of the project, as the URLs of Sentry carry it.",
    required: true,
  })
  slug: string;

  /** Name of the project. */
  @ApiProperty({
    example: "Genio",
    description: "Name of the project.",
    required: true,
  })
  name: string;
}
