import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, IsNotEmpty } from "class-validator";

/**
 * DTO of the postponement of the suspension of a contract's access (UR-RK-157): an explicit choice of the
 * administration on a single contract, such as an agreed payment.
 */
export class PostponeSuspensionDto {
  /** Date until which the access stays, even with an invoice unpaid past its fifteenth day (ISO string). */
  @ApiProperty({
    example: "2026-12-01T00:00:00.000Z",
    description: "Date until which the access stays, even with an invoice unpaid past its fifteenth day (ISO string).",
    required: true,
  })
  @IsNotEmpty()
  @IsDateString()
  until: string;
}
