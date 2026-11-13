import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { TemplateType } from "../enums/template-type.enum";

/** DTO used to create a template in DRAFT; a DOCX source is attached later with an update. */
export class CreateTemplateDto {
  /** Type of document the template produces. */
  @ApiProperty({
    description: "Type of document the template produces.",
    enum: TemplateType,
    example: TemplateType.Offer,
    required: true,
  })
  @IsEnum(TemplateType)
  type: TemplateType;

  /** Human-readable name of the template. */
  @ApiProperty({
    description: "Human-readable name of the template.",
    example: "Offerta canale diretto",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  /** Sales channel the template applies to. Required on offer templates, forbidden elsewhere. */
  @ApiPropertyOptional({
    description: "Sales channel the template applies to. Required on offer templates, forbidden elsewhere.",
    enum: SalesChannel,
    example: SalesChannel.Direct,
    required: false,
  })
  @IsOptional()
  @IsEnum(SalesChannel)
  channel?: SalesChannel;

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
