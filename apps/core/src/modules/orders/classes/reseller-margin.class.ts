import { Expose } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";

/**
 * Margin of the reseller on an order line: the percentages copied from its
 * contract in force when the order was raised. Keus invoices the list price minus these.
 */
export class ResellerMargin {
  /** Margin on the activation, in percent. */
  @ApiProperty({
    description: "Margin on the activation, in percent.",
    example: 40,
    required: true,
  })
  @Expose()
  activationPercent: number;

  /** Margin on the recurring fee, in percent. */
  @ApiProperty({
    description: "Margin on the recurring fee, in percent.",
    example: 40,
    required: true,
  })
  @Expose()
  recurringPercent: number;

  /**
   * Constructor for ResellerMargin.
   * @param activationPercent the margin on the activation.
   * @param recurringPercent the margin on the recurring fee.
   */
  constructor(activationPercent: number, recurringPercent: number) {
    this.activationPercent = activationPercent;
    this.recurringPercent = recurringPercent;
  }
}
