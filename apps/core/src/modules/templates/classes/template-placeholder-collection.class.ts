import { ApiProperty } from "@nestjs/swagger";
import { TemplatePlaceholder } from "./template-placeholder.class";

/** A list the template repeats, such as the order lines; its fields are relative to one item. */
export class TemplatePlaceholderCollection {
  /** Key of the list, e.g. `lines`. */
  @ApiProperty({
    description: "Key of the list.",
    example: "lines",
    required: true,
  })
  key: string;

  /** Label shown to the admin in the editor. */
  @ApiProperty({
    description: "Label shown to the admin in the editor.",
    example: "Righe dell'ordine",
    required: true,
  })
  label: string;

  /** Fields of one item, relative to it. */
  @ApiProperty({
    description: "Fields of one item, relative to it.",
    type: [TemplatePlaceholder],
    required: true,
  })
  fields: TemplatePlaceholder[];
}
