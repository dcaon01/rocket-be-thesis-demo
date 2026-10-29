/**
 * Enum describing a change of the users of a contract's tenant recorded on the contract (UR-RK-401, UR-RK-403).
 */
export enum SeatEventKind {
  /** The users went past the seats: the seats grew and the proration is invoiced at the end of the day. */
  SeatsAdded = "SEATS_ADDED",
  /** A user was deleted: recorded with its date, the seats billed stay at the highest count reached. */
  UserRemoved = "USER_REMOVED",
}
