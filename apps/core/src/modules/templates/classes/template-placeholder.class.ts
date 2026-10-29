import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** A value Rocket fills into a template, addressed by a dotted key. */
export class TemplatePlaceholder {
  /** Dotted key written in the template, e.g. `company.name`. */
  @ApiProperty({
    description: "Dotted key written in the template.",
    example: "company.name",
    required: true,
  })
  key: string;

  /** Label shown to the admin in the editor. */
  @ApiProperty({
    description: "Label shown to the admin in the editor.",
    example: "Ragione sociale dell'azienda",
    required: true,
  })
  label: string;

  /** Sample value used by the preview. */
  @ApiProperty({
    description: "Sample value used by the preview.",
    example: "Ossigeno S.r.l.",
    required: true,
  })
  example: string;

  /**
   * Whether the value is a picture: in a DOCX it replaces an image whose alternative
   * text is the key, instead of being written as a tag.
   */
  @ApiPropertyOptional({
    description: "Whether the value is a picture, placed on an image whose alternative text is the key.",
    example: true,
    required: false,
  })
  image?: boolean;
}
