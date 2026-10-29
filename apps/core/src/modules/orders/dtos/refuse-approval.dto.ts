import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

/**
 * DTO used by the Keus back office to refuse the approval a reseller asked for its offer.
 */
export class RefuseApprovalDto {
  /** Reason of the refusal, sent to the reseller. */
  @ApiProperty({
    description: "Reason of the refusal, sent to the reseller.",
    example: "Lo sconto sull'attivazione va concordato con il commerciale Keus.",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  reason: string;
}
