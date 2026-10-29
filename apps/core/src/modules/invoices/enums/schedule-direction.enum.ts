/** Which way the money of a due date goes: to Keus, or from a customer of a reseller. Every entry of the schedule of Keus goes to Keus. */
export enum ScheduleDirection {
  /** A payment to Keus: in the schedule of a reseller, an invoice it pays on the 4th of the month or at issue. */
  ToKeus = 'TO_KEUS',
  /** A due date the reseller collects from one of its customers. */
  FromCustomer = 'FROM_CUSTOMER',
}
