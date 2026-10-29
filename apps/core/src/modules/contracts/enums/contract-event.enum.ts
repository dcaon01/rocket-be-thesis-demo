/** Scheduled events of a contract, fired by EventBridge Scheduler through the SQS inbound queue. */
export enum ContractEvent {
  /** The renewal date is reached: the contract is extended by one year. */
  Renew = 'RENEW',
  /** The termination date is reached: the contract ends. */
  Terminate = 'TERMINATE',
  /** A billing date of an indirect contract is reached: the reseller is billed for the period. */
  Bill = 'BILL',
  /** The notice days before the renewal are reached: whoever pays learns date and amount of the renewal (UR-RK-405). */
  RenewalNotice = 'RENEWAL_NOTICE',
  /** A day of the dunning of a payment never set up is reached: a reminder, the notice or the suspension (UR-RK-019). */
  PaymentDunning = 'PAYMENT_DUNNING',
  /** The end of a day with seat increases is reached: the proration of the seats not invoiced yet is billed (UR-RK-401). */
  SeatBilling = 'SEAT_BILLING',
}
