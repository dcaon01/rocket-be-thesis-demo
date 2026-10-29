/**
 * Closed list of reasons an offer can be turned down.
 * A closed list rather than free text, so refusing is quick to record and the
 * reasons stay comparable over time.
 */
export enum OrderRefusalReason {
  /** The customer finds the amount above its expectations or a competing offer. */
  Price = 'PRICE',
  /** The proposed delivery date does not suit the customer. */
  Timing = 'TIMING',
  /** The customer bought a competing solution. */
  Competitor = 'COMPETITOR',
  /** The decision is postponed. */
  Postponed = 'POSTPONED',
  /** The need that originated the request is gone. */
  NeedGone = 'NEED_GONE',
  /** The offer got no answer and the deal was closed. */
  NoAnswer = 'NO_ANSWER',
  /** None of the above. The note becomes mandatory. */
  Other = 'OTHER',
}
