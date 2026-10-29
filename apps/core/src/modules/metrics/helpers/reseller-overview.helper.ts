import { IN_FORCE_STATUSES } from "../../contracts/enums/contract-status.enum";
import type { ResponseContractDto } from "../../contracts/dtos/response-contract.dto";
import type { ResellerOverviewDashboardMetricsRecord } from "../schemas/reseller-overview-dashboard-metrics-record.schema";

/** Product of the records that count every product together, so that a company on two products counts once. */
export const ALL_PRODUCTS = 'ALL';

/** Counts of a product, reseller and salesperson in a month, as its reseller overview record stores them. */
export type ResellerOverviewCounts = Omit<ResellerOverviewDashboardMetricsRecord, 'id' | 'monthIndex'>;

/** Date range of the month counted. */
export interface OverviewRange {
  /** First moment of the month. */
  start: Date;
  /** Last moment of the month. */
  end: Date;
}

/**
 * Builds the key of the record of a product, reseller and salesperson.
 * @param productId the product, or `ALL_PRODUCTS`.
 * @param resellerPath the reseller lineage, absent on the direct channel.
 * @param salesId the salesperson, absent for the whole reseller.
 * @returns the key.
 */
export function overviewKeyOf(productId: string, resellerPath: string | undefined, salesId: string | undefined): string {
  return `${productId}#${resellerPath ?? ''}#${salesId ?? ''}`;
}

/**
 * Counts the contracts and the companies of the resellers in a month, from the contracts of every product (terminated
 * ones included, which date the first contract of a company). Every contract counts on its product and on
 * `ALL_PRODUCTS`, for its whole reseller and, when its order has one, for the salesperson who opened it.
 *   - In force: the contracts ACTIVE or TERMINATING today, and their distinct companies.
 *   - Started: the contracts whose `startDate` falls in the month.
 *   - New companies: the ones whose first contract with the reseller, on the product or on any product, started in the
 *     month; for a salesperson, the ones whose first contract came from its order.
 * The direct channel counts too, on one leaf without `resellerPath` nor salesperson, for the active companies of the
 * global and product dashboards (UR-RK-001, UR-RK-235): a company sits on one channel, so the leaves add up to Keus.
 * @param range the month.
 * @param contracts the contracts of every product.
 * @param salesIds the salesperson of each reseller order, by identifier.
 * @returns the counts of the month, one per product, reseller and salesperson with something in it.
 */
export function countResellerOverview(
  range: OverviewRange,
  contracts: ResponseContractDto[],
  salesIds: Map<string, string>,
): ResellerOverviewCounts[] {
  const counts = new Map<string, ResellerOverviewCounts>();
  const companiesInForce = new Map<string, Set<string>>();
  const countOf = (productId: string, resellerPath: string | undefined, salesId: string | undefined): ResellerOverviewCounts => {
    const key = overviewKeyOf(productId, resellerPath, salesId);
    let count = counts.get(key);
    if (!count) {
      count = {
        productId,
        ...(resellerPath && { resellerPath }),
        ...(salesId && { salesId }),
        contractsInForce: 0,
        contractsStarted: 0,
        companiesInForce: 0,
        companiesNew: 0,
      };
      counts.set(key, count);
    }
    return count;
  };
  const leavesOf = (contract: ResponseContractDto): (string | undefined)[] => {
    const salesId = contract.resellerPath ? salesIds.get(contract.orderId) : undefined;
    return salesId ? [undefined, salesId] : [undefined];
  };
  const inRange = (date: Date): boolean => date >= range.start && date <= range.end;

  const firstContract = new Map<string, { productId: string; contract: ResponseContractDto }>();
  for (const contract of contracts) {
    const resellerPath = contract.resellerPath;
    const inForce = IN_FORCE_STATUSES.includes(contract.status);
    const started = inRange(new Date(contract.startDate));

    for (const productId of [contract.productId, ALL_PRODUCTS]) {
      for (const salesId of leavesOf(contract)) {
        const count = countOf(productId, resellerPath, salesId);
        if (inForce) {
          count.contractsInForce += 1;
          const key = overviewKeyOf(productId, resellerPath, salesId);
          companiesInForce.set(key, (companiesInForce.get(key) ?? new Set()).add(contract.companyId));
        }
        if (started) {
          count.contractsStarted += 1;
        }
      }

      const firstKey = `${contract.companyId}#${productId}#${resellerPath ?? ''}`;
      const first = firstContract.get(firstKey)?.contract;
      if (!first || contract.startDate < first.startDate || (contract.startDate === first.startDate && contract.id < first.id)) {
        firstContract.set(firstKey, { productId, contract });
      }
    }
  }

  for (const [key, companies] of companiesInForce) {
    counts.get(key).companiesInForce = companies.size;
  }
  for (const { productId, contract } of firstContract.values()) {
    if (!inRange(new Date(contract.startDate))) {
      continue;
    }

    for (const salesId of leavesOf(contract)) {
      countOf(productId, contract.resellerPath, salesId).companiesNew += 1;
    }
  }

  return [...counts.values()];
}
