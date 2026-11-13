import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { LegalAddress } from "../../resellers/classes/legal-address.class";

/** Details of the billed party as they were at issue, with the fiscal data of the electronic invoice. */
export class BilledParty {
  /** Legal name. */
  @ApiProperty({
    description: "Legal name.",
    example: "ACME S.r.l.",
    required: true,
  })
  name: string;

  /** VAT number. */
  @ApiPropertyOptional({
    description: "VAT number.",
    example: "01234567890",
    required: false,
  })
  vatNumber?: string;

  /** Fiscal code. */
  @ApiPropertyOptional({
    description: "Fiscal code.",
    example: "01234567890",
    required: false,
  })
  fiscalCode?: string;

  /** Email the invoice is sent to. */
  @ApiPropertyOptional({
    description: "Email the invoice is sent to.",
    example: "amministrazione@acme.it",
    required: false,
  })
  email?: string;

  /** Address, as one line. */
  @ApiPropertyOptional({
    description: "Address, as one line.",
    example: "Via Roma 1, 35100 Padova (PD)",
    required: false,
  })
  address?: string;

  /** Structured legal address. */
  @ApiPropertyOptional({
    description: "Structured legal address.",
    type: LegalAddress,
    required: false,
  })
  legalAddress?: LegalAddress;

  /** Interchange code of the electronic invoice. */
  @ApiPropertyOptional({
    description: "Interchange code of the electronic invoice.",
    example: "M5UXCR1",
    required: false,
  })
  sdi?: string;

  /** Certified email. */
  @ApiPropertyOptional({
    description: "Certified email.",
    example: "acme@pec.it",
    required: false,
  })
  pec?: string;
}
