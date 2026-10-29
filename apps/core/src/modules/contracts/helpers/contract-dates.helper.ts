/**
 * Returns the ISO date that falls a number of years after another one.
 * @param isoDate the starting date (ISO string).
 * @param years the years to add.
 * @returns the resulting date (ISO string).
 */
export function addYears(isoDate: string, years: number): string {
  const date = new Date(isoDate);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

/**
 * Returns the ISO date that falls a number of months after another one.
 * @param isoDate the starting date (ISO string).
 * @param months the months to add.
 * @returns the resulting date (ISO string).
 */
export function addMonths(isoDate: string, months: number): string {
  const date = new Date(isoDate);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

/**
 * Returns the ISO date that falls a number of days before another one.
 * @param isoDate the starting date (ISO string).
 * @param days the days to subtract.
 * @returns the resulting date (ISO string).
 */
export function subtractDays(isoDate: string, days: number): string {
  return new Date(new Date(isoDate).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Returns the month of an ISO date, the partition key of the date indexes.
 * @param isoDate the date (ISO string).
 * @returns the month in the format "YYYY-MM".
 */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}
