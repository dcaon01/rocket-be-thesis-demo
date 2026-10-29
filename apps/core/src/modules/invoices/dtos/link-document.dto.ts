import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

/** Request to link to an invoice the document an operator found at Sibill, after an uncertain issue. */
export class LinkDocumentDto {
  /** Identifier of the document at Sibill. */
  @ApiProperty({
    example: "01a0fc1a-389e-7635-ae93-2fbcb4c59bea",
    description: "Identifier of the document at Sibill.",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  sibillId: string;
}
