import { Expose } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OrderBlockerKind } from "../enums/order-blocker-kind.enum";

/**
 * Why a draft cannot leave the draft: another open order or a contract in force on one of its products. The code is
 * left out when the requester may not read that order or contract.
 */
export class OrderBlocker {
  /** What blocks the draft. */
  @ApiProperty({
    description: "What blocks the draft.",
    enum: OrderBlockerKind,
    example: OrderBlockerKind.Order,
    required: true,
  })
  @Expose()
  kind: OrderBlockerKind;

  /** Code of the order or of the contract that blocks the draft, when the requester may read it. */
  @ApiPropertyOptional({
    description: "Code of the order or of the contract that blocks the draft, when the requester may read it.",
    example: "ORD-2026-00007",
    required: false,
  })
  @Expose()
  code?: string;

  /**
   * Constructor for OrderBlocker.
   * @param kind what blocks the draft.
   * @param code the code of the order or of the contract, when the requester may read it.
   */
  constructor(kind: OrderBlockerKind, code?: string) {
    this.kind = kind;
    this.code = code;
  }
}
