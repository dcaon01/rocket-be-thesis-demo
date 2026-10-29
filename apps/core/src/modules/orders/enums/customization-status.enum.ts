/**
 * Lifecycle of a customization request attached to an order.
 * A request blocks the offer until the back office has either quoted or
 * refused it.
 */
export enum CustomizationStatus {
  /** Submitted, waiting for the back office. */
  Requested = 'REQUESTED',
  /** Quoted: the amounts become a distinct line on the offer. */
  Quoted = 'QUOTED',
  /** Refused with a reason. The order carries on with its listed products only. */
  Refused = 'REFUSED',
}
