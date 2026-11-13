import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose } from "class-transformer";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { TemplateFormat } from "../enums/template-format.enum";
import { TemplateStatus } from "../enums/template-status.enum";
import { TemplateType } from "../enums/template-type.enum";

/** DTO returned for a template. */
export class ResponseTemplateDto {
  /** Type of document the template produces. */
  @ApiProperty({
    description: "Type of document the template produces.",
    enum: TemplateType,
    required: true,
  })
  @Expose()
  type: TemplateType;

  /** Identifier of the template. */
  @ApiProperty({
    description: "Identifier of the template.",
    example: "template-id-123",
    required: true,
  })
  @Expose()
  id: string;

  /** Human-readable name of the template. */
  @ApiProperty({
    description: "Human-readable name of the template.",
    example: "Offerta canale diretto",
    required: true,
  })
  @Expose()
  name: string;

  /** Scope of the template: the channel, or GLOBAL. */
  @ApiProperty({
    description: "Scope of the template: the channel, or GLOBAL.",
    example: "DIRECT",
    required: true,
  })
  @Expose()
  scopeKey: string;

  /** Sales channel the template applies to. */
  @ApiPropertyOptional({
    description: "Sales channel the template applies to.",
    enum: SalesChannel,
    required: false,
  })
  @Expose()
  channel?: SalesChannel;

  /** Format of the template. */
  @ApiProperty({
    description: "Format of the template.",
    enum: TemplateFormat,
    required: true,
  })
  @Expose()
  format: TemplateFormat;

  /** Publication state. */
  @ApiProperty({
    description: "Publication state.",
    enum: TemplateStatus,
    required: true,
  })
  @Expose()
  status: TemplateStatus;

  /** S3 key of the DOCX source. */
  @ApiPropertyOptional({
    description: "S3 key of the DOCX source.",
    example: "templates/template-id-123/source.docx",
    required: false,
  })
  @Expose()
  sourceS3Key?: string;

  /** Inline HTML body. */
  @ApiPropertyOptional({
    description: "Inline HTML body.",
    required: false,
  })
  @Expose()
  body?: string;

  /** Placeholders the template uses, computed by the server. */
  @ApiPropertyOptional({
    description: "Placeholders the template uses, computed by the server.",
    example: ["order.code"],
    required: false,
  })
  @Expose()
  placeholders?: string[];

  /** ISO timestamp of the publication. */
  @ApiPropertyOptional({
    description: "ISO timestamp of the publication.",
    example: "2026-09-15T10:00:00.000Z",
    required: false,
  })
  @Expose()
  publishedAt?: string;

  /** ISO timestamp of the withdrawal. */
  @ApiPropertyOptional({
    description: "ISO timestamp of the withdrawal.",
    example: "2026-10-01T10:00:00.000Z",
    required: false,
  })
  @Expose()
  withdrawnAt?: string;

  /** ISO timestamp of the creation. */
  @ApiProperty({
    description: "ISO timestamp of the creation.",
    example: "2026-09-15T10:00:00.000Z",
    required: true,
  })
  @Expose()
  createdAt: string;

  /** ISO timestamp of the last update. */
  @ApiProperty({
    description: "ISO timestamp of the last update.",
    example: "2026-09-15T10:00:00.000Z",
    required: true,
  })
  @Expose()
  updatedAt: string;
}
