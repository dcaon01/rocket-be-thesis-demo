import { ApiProperty } from "@nestjs/swagger";
import { SeatEventKind } from "../enums/seat-event-kind.enum";

/** A change of the users of a contract's tenant, as the contract records it. */
export class SeatEvent {
  /** When the change arrived (ISO string). */
  @ApiProperty({
    description: "When the change arrived (ISO string).",
    example: "2026-10-09T10:00:00.000Z",
    required: true,
  })
  at: string;

  /** What changed. */
  @ApiProperty({
    description: "What changed.",
    enum: SeatEventKind,
    required: true,
  })
  kind: SeatEventKind;

  /** Active users of the tenant after the change. */
  @ApiProperty({
    description: "Active users of the tenant after the change.",
    example: 7,
    required: true,
  })
  users: number;

  /** Seats billed after the change: the highest count of users reached. */
  @ApiProperty({
    description: "Seats billed after the change: the highest count of users reached.",
    example: 7,
    required: true,
  })
  seats: number;

  /**
   * Constructor for SeatEvent.
   * @param at when the change arrived.
   * @param kind what changed.
   * @param users the active users after the change.
   * @param seats the seats billed after the change.
   */
  constructor(at: string, kind: SeatEventKind, users: number, seats: number) {
    this.at = at;
    this.kind = kind;
    this.users = users;
    this.seats = seats;
  }
}
