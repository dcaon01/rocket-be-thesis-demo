import { ITALY_TIME_ZONE } from "../dates/calendar-day.helper";

/** Amounts in the notices: euros, the Italian way. */
const EURO_FORMAT = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

/** Dates in the notices: day, month in words and year, on Italian time. */
const DATE_FORMAT = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: ITALY_TIME_ZONE });

/**
 * Formats an amount for a notice, which shows it as it is.
 * @param cents the amount, in cents.
 * @returns the amount in euros, such as «1.220,00 €».
 */
export function formatEuro(cents: number): string {
  return EURO_FORMAT.format(cents / 100);
}

/**
 * Formats a date for a notice, which shows it as it is.
 * @param date the date, as an ISO string or a Date.
 * @returns the date, such as «15 ottobre 2026».
 */
export function formatDate(date: string | Date): string {
  return DATE_FORMAT.format(typeof date === "string" ? new Date(date) : date);
}

/**
 * Builds the absolute link to a page of Rocket, for the emails and the Stripe return pages.
 * @param path the path of the page, starting with a slash.
 * @returns the absolute URL.
 */
export function rocketUrl(path: string): string {
  const domain = process.env.DOMAIN_NAME || "http://localhost:4200";
  const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
  return `${baseUrl}${path}`;
}
