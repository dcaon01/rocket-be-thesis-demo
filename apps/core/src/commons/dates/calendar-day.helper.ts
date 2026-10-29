/**
 * Time zone of the calendar days of Rocket: due dates, periods and the dates printed on documents are days in Italy.
 * The Lambda runs in UTC, so between midnight and 1 or 2 in Italy its day is still the one before.
 */
export const ITALY_TIME_ZONE = "Europe/Rome";

/** Formats an instant as the day it falls on in Italy (YYYY-MM-DD). */
const CALENDAR_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: ITALY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * Returns the day an instant falls on in Italy.
 * @param date the instant.
 * @returns the day (YYYY-MM-DD).
 */
export function calendarDayOf(date: Date): string {
  return CALENDAR_DAY_FORMAT.format(date);
}

/**
 * Returns today in Italy at midnight UTC, the way due dates are stored, so that they compare as text.
 * @returns today (ISO string).
 */
export function todayInItaly(): string {
  return `${calendarDayOf(new Date())}T00:00:00.000Z`;
}
