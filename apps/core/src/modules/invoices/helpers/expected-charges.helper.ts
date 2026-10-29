import type { ExpectedCharge } from "../interfaces/expected-charge.interface";
import { Invoice } from "../schemas/invoice.schema";

/** Distance between the due dates of an expected payment and of an invoice of its contract that records it (two days). */
const RECORDED_WITHIN_MS = 2 * 24 * 60 * 60 * 1000;

/** How long the expected payments of a period are reused, so the pages of one schedule do not count them again. */
export const EXPECTED_CACHE_MS = 60 * 1000;

/**
 * Drops the expected payments an invoice already records, so a schedule never shows a payment twice: same contract and
 * the same proration, the same period, or a due date within `RECORDED_WITHIN_MS`, since a Stripe invoice is created a
 * little after its period starts. Shared by the schedule of Keus and the one of a reseller.
 * @param expected the expected payments.
 * @param invoices the invoices of the same period, in every status still in the schedule: a paid one records its
 * payment as well.
 * @returns the expected payments no invoice records yet.
 */
export function dropRecorded(expected: ExpectedCharge[], invoices: Invoice[]): ExpectedCharge[] {
  const byContract = new Map<string, Invoice[]>();
  for (const invoice of invoices) {
    const contractKey = invoice.contractId ?? invoice.resellerContractId;
    if (contractKey) {
      byContract.set(contractKey, [...(byContract.get(contractKey) ?? []), invoice]);
    }
  }

  const recorded = (charge: ExpectedCharge): boolean => (byContract.get(charge.contractId ?? charge.resellerContractId ?? "") ?? []).some(invoice => (charge.prorationId
    ? invoice.prorationId === charge.prorationId
    : !invoice.prorationId && (invoice.billingPeriodStart === charge.periodStart
      || Math.abs(new Date(invoice.dueDate ?? invoice.issuedAt).getTime() - new Date(charge.dueDate).getTime()) <= RECORDED_WITHIN_MS)));
  return expected.filter(charge => !recorded(charge));
}
