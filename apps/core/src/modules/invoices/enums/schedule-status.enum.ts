/**
 * States of a payment in the schedule of Keus: the ones of a recorded invoice, to collect, failed or collected, and
 * the expected payment of a contract in force that no invoice records yet. The first three match `InvoiceStatus`.
 */
export enum ScheduleStatus {
  /** Charged and waiting for the money. */
  Open = "OPEN",
  /** The charge was attempted and failed. */
  Unpaid = "UNPAID",
  /** Collected. */
  Paid = "PAID",
  /** Not charged yet: the next periods of a contract in force, counted from its dates. */
  Expected = "EXPECTED",
}
