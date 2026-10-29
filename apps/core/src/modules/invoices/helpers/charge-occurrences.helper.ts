import { CADENCE_MONTHS, ChargeCadence } from "../enums/charge-cadence.enum";

/** The rule of a recurring item: its first due date, its cadence and its last day. */
export type ChargeRule = { ruleStart: string; cadence: ChargeCadence; ruleEnd?: string };

/**
 * Lists the due dates of a recurring item that fall within a period. The dates are counted from the start, so a
 * monthly item started on the 31st falls on the last day of the shorter months and comes back to the 31st.
 * @param rule the rule of the item.
 * @param from the start of the period (ISO string).
 * @param to the end of the period (ISO string).
 * @returns the due dates within the period (ISO strings), in order.
 */
export function occurrencesBetween(rule: ChargeRule, from: string, to: string): string[] {
  const months = CADENCE_MONTHS[rule.cadence];
  const last = rule.ruleEnd && rule.ruleEnd < to ? rule.ruleEnd : to;
  const dates: string[] = [];

  for (let step = 0; ; step++) {
    const date = stepFrom(rule.ruleStart, step * months);
    if (date > last) break;
    if (date >= from) dates.push(date);
  }

  return dates;
}

/**
 * Tells whether a date is one of the due dates of a recurring item.
 * @param rule the rule of the item.
 * @param date the date (ISO string).
 * @returns whether the item falls due on that date.
 */
export function isOccurrence(rule: ChargeRule, date: string): boolean {
  return occurrencesBetween(rule, date, date).length === 1;
}

/**
 * Moves a date on by a number of months, keeping its day or the last day of a shorter month.
 * @param start the date (ISO string).
 * @param months the months to add.
 * @returns the resulting date (ISO string).
 */
function stepFrom(start: string, months: number): string {
  const date = new Date(start);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);

  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}
