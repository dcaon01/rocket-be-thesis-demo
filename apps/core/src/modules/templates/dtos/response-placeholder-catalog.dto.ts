import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { TemplatePlaceholderCollection } from "../classes/template-placeholder-collection.class";
import { TemplatePlaceholder } from "../classes/template-placeholder.class";
import { TemplateFormat } from "../enums/template-format.enum";
import { TemplateType } from "../enums/template-type.enum";

/** DTO returned for the placeholders a template scope may use. */
export class ResponsePlaceholderCatalogDto {
  /** Type of template the catalog is for. */
  @ApiProperty({
    description: "Type of template the catalog is for.",
    enum: TemplateType,
    required: true,
  })
  type: TemplateType;

  /** Channel, for the offer templates. */
  @ApiPropertyOptional({
    description: "Channel, for the offer templates.",
    enum: SalesChannel,
    required: false,
  })
  channel?: SalesChannel;

  /** Format of the template: it decides the loop syntax (Handlebars for HTML, docxtemplater for DOCX). */
  @ApiProperty({
    description: "Format of the template: it decides the loop syntax (Handlebars for HTML, docxtemplater for DOCX).",
    enum: TemplateFormat,
    required: true,
  })
  format: TemplateFormat;

  /** Single values. */
  @ApiProperty({
    description: "Single values.",
    type: [TemplatePlaceholder],
    required: true,
  })
  placeholders: TemplatePlaceholder[];

  /** Repeated lists. */
  @ApiProperty({
    description: "Repeated lists.",
    type: [TemplatePlaceholderCollection],
    required: true,
  })
  collections: TemplatePlaceholderCollection[];
}
