import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ResellerAccessCharge } from "../classes/reseller-access-charge.class";
import { ResellerAccessFee } from "../classes/reseller-access-fee.class";
import { ResellerAccessMandate } from "../classes/reseller-access-mandate.class";
import { ResellerAccessState } from "../enums/reseller-access-state.enum";

/**
 * Data Transfer Object for responding with whether the users of a reseller can work in Rocket, and what is left to
 * do while they cannot. Contract, fee and mandates come only while the contract is ACTIVATING, the unpaid charges
 * only while the reseller is SUSPENDED and only to its admin and to Keus; the links to pay only to the admin.
 */
export class ResponseResellerAccessDto {
  /** Whether the users of the reseller can work in Rocket. */
  @ApiProperty({
    description: "Whether the users of the reseller can work in Rocket.",
    enum: ResellerAccessState,
    example: ResellerAccessState.Activating,
    required: true,
  })
  state: ResellerAccessState;

  /** Whether the requester can complete the activation or the payment: the admin of the reseller. */
  @ApiProperty({
    description: "Whether the requester can complete the activation or the payment: the admin of the reseller.",
    example: true,
    required: true,
  })
  canComplete: boolean;

  /** Identifier of the contract being activated. */
  @ApiPropertyOptional({
    description: "Identifier of the contract being activated.",
    example: "9a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    required: false,
  })
  contractId?: string;

  /** Code of the contract being activated. */
  @ApiPropertyOptional({
    description: "Code of the contract being activated.",
    example: "RVD-001-001",
    required: false,
  })
  contractCode?: string;

  /** First fee of the contract being activated; absent with a fee of zero. */
  @ApiPropertyOptional({
    description: "First fee of the contract being activated; absent with a fee of zero.",
    type: ResellerAccessFee,
    required: false,
  })
  fee?: ResellerAccessFee;

  /** Mandate of each product of the contract being activated. */
  @ApiProperty({
    description: "Mandate of each product of the contract being activated.",
    type: ResellerAccessMandate,
    isArray: true,
    required: true,
  })
  mandates: ResellerAccessMandate[];

  /** Charges still unpaid of a SUSPENDED reseller, the oldest first; empty for the reseller users but its admin. */
  @ApiProperty({
    description: "Charges still unpaid of a SUSPENDED reseller, the oldest first; empty for the reseller users but its admin.",
    type: ResellerAccessCharge,
    isArray: true,
    required: true,
  })
  unpaidCharges: ResellerAccessCharge[];
}
