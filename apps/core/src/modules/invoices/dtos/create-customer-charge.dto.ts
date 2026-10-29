import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from "class-validator";
import { ChargeCadence } from "../enums/charge-cadence.enum";
import { CustomerChargeKind } from "../enums/customer-charge-kind.enum";

/** Kinds of item a reseller adds by hand. */
const MANUAL_KINDS = [CustomerChargeKind.OneOff, CustomerChargeKind.Recurring];

/**
 * DTO for adding an item a reseller bills one of its customers, beyond the shares of the contracts.
 * A one-off item needs `dueDate`; a recurring one needs `ruleStart` and `cadence`, and `ruleEnd` when it stops.
 */
export class CreateCustomerChargeDto {
  /** Kind of the item: once or recurring. */
  @ApiProperty({
    description: "Kind of the item: once or recurring.",
    enum: MANUAL_KINDS,
    required: true,
  })
  @IsIn(MANUAL_KINDS)
  kind: CustomerChargeKind;

  /** Company billed, a customer of the reseller. */
  @ApiProperty({
    description: "Company billed, a customer of the reseller.",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  companyId: string;

  /** What the item bills. */
  @ApiProperty({
    description: "What the item bills.",
    example: "Formazione del personale",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  description: string;

  /** Amount of each due date, net of VAT, in cents. */
  @ApiProperty({
    description: "Amount of each due date, net of VAT, in cents.",
    example: 15000,
    required: true,
  })
  @IsInt()
  @Min(1)
  amountCents: number;

  /** Due date of a one-off item (ISO string). */
  @ApiPropertyOptional({
    description: "Due date of a one-off item (ISO string).",
    example: "2026-11-15T00:00:00.000Z",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  /** First due date of a recurring item (ISO string). */
  @ApiPropertyOptional({
    description: "First due date of a recurring item (ISO string).",
    example: "2026-11-01T00:00:00.000Z",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  ruleStart?: string;

  /** Cadence of a recurring item. */
  @ApiPropertyOptional({
    description: "Cadence of a recurring item.",
    enum: ChargeCadence,
    required: false,
  })
  @IsOptional()
  @IsIn(Object.values(ChargeCadence))
  cadence?: ChargeCadence;

  /** Last day a recurring item can fall due (ISO string); absent while it goes on. */
  @ApiPropertyOptional({
    description: "Last day a recurring item can fall due (ISO string); absent while it goes on.",
    example: "2027-10-31T00:00:00.000Z",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  ruleEnd?: string;
}
