/** Stripe accepts a trial end only 48 hours ahead: one more hour covers the time to create the session. */
const MIN_DEFERRED_CHARGE_MS = 49 * 60 * 60 * 1000;

/**
 * Returns the moment the first charge of the fee is deferred to: the start date of the
 * contract, when it is far enough for a Stripe trial. A closer start date is charged at once.
 * @param validityDate the start date of the contract (ISO string).
 * @returns the Unix timestamp (seconds) of the first charge, or undefined to charge now.
 */
export function deferredChargeOf(validityDate: string): number | undefined {
  const startsAt = new Date(validityDate).getTime();
  return startsAt - Date.now() >= MIN_DEFERRED_CHARGE_MS ? Math.floor(startsAt / 1000) : undefined;
}

/**
 * Calculates the renewal date of a contract from its start date and the years elapsed.
 * @param validityDate the contract start date (ISO string).
 * @param validityYears the number of validity years elapsed.
 * @returns the next renewal date.
 */
export function calculateRenewalDate(validityDate: string, validityYears: number): Date {
  const date = new Date(validityDate);
  date.setFullYear(date.getFullYear() + validityYears);
  return date;
}
