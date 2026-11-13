import { ApiProperty } from "@nestjs/swagger";

/**
 * Alerts of a product still to handle today: the unresolved issues of its Sentry project, in the environment of this
 * Rocket. Archived and resolved issues stay out.
 */
export class ResponseOpenAlertsDto {
  /** Identifier of the product. */
  @ApiProperty({
    example: "product123",
    description: "Identifier of the product.",
    required: true,
  })
  productId: string;

  /** Unresolved issues of the product today. */
  @ApiProperty({
    example: 5,
    description: "Unresolved issues of the product today.",
    required: true,
  })
  openAlerts: number;
}
