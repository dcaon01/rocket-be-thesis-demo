import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional } from "class-validator";

/**
 * Request to issue again the electronic invoice of an invoice. An uncertain issue is repeated only when the operator
 * confirms that Sibill has no document for it: otherwise the exchange system would get the invoice twice.
 */
export class ReissueDocumentDto {
  /** Whether the operator checked that Sibill has no document for the invoice. */
  @ApiPropertyOptional({
    example: false,
    description: "Whether the operator checked that Sibill has no document for the invoice. Required to repeat an uncertain issue.",
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  confirmedNotAtSibill?: boolean;
}
