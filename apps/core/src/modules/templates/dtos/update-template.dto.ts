import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

/** DTO used to update a draft template; type and scope are fixed at creation. */
export class UpdateTemplateDto {
  /** Human-readable name of the template. */
  @ApiPropertyOptional({
    description: "Human-readable name of the template.",
    example: "Offerta canale diretto",
    required: false,
  })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  name?: string;

  /** S3 key of the uploaded DOCX source, `templates/{id}/source.docx`. Only on DOCX templates. */
  @ApiPropertyOptional({
    description: "S3 key of the uploaded DOCX source, templates/{id}/source.docx. Only on DOCX templates.",
    example: "templates/template-id-123/source.docx",
    required: false,
  })
  @IsOptional()
  @IsString()
  sourceS3Key?: string;

  /** Inline HTML body. Only on HTML templates. */
  @ApiPropertyOptional({
    description: "Inline HTML body. Only on HTML templates.",
    example: "<p>Offerta {{order.code}} per {{company.name}}.</p>",
    required: false,
  })
  @IsOptional()
  @IsString()
  body?: string;
}
