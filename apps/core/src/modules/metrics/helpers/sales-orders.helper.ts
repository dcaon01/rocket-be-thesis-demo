import { TrialStatus } from "../../trials/enums/trial-status.enum";
import type { ResponseContractDto } from "../../contracts/dtos/response-contract.dto";
import type { ResponseOrderDto } from "../../orders/dtos/response-order.dto";
import type { ResponseOrderLineDto } from "../../orders/dtos/response-order-line.dto";
import type { ResponseTrialDto } from "../../trials/dtos/response-trial.dto";
import type { SalesOrdersDashboardMetricsRecord } from "../schemas/sales-orders-dashboard-metrics-record.schema";
import { ALL_PRODUCTS, OverviewRange } from "./reseller-overview.helper";

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses of a closed trial that count in the conversion rate. */
const CLOSED_TRIAL_STATUSES: TrialStatus[] = [TrialStatus.Expired, TrialStatus.Cancelled, TrialStatus.Converted];

/** Counts of a product, seller and salesperson in a month, as its sales orders record stores them. */
export type SalesOrdersCounts = Omit<SalesOrdersDashboardMetricsRecord, 'id' | 'monthIndex'>;

/** What the Rocket half of the sales metrics counts a month from. */
export interface SalesOrdersSources {
  /** Orders requested in the month. */
  orders: ResponseOrderDto[];
  /** Trials closed in the month. */
  closedTrials: ResponseTrialDto[];
  /** Contracts of every product, in every status. */
  contracts: ResponseContractDto[];
  /** Delivered order lines of every product. */
  lines: ResponseOrderLineDto[];
  /** Keus salesperson of each direct order, by identifier. */
  salesIds: Map<string, string>;
}

/**
 * Builds the key of the record of a product, seller and salesperson.
 * @param productId the product, or `ALL_PRODUCTS`.
 * @param resellerPath the reseller lineage, absent on the direct channel.
 * @param salesId the Keus salesperson of the direct orders, absent otherwise.
 * @returns the key.
 */
export function salesOrdersKeyOf(productId: string, resellerPath: string | undefined, salesId: string | undefined): string {
  return `${productId}#${resellerPath ?? ''}#${salesId ?? ''}`;
}

/**
 * Counts the Rocket half of the sales metrics in a month (UR-RK-222), one leaf per product, seller and salesperson:
 * the direct channel is split by the Keus salesperson who opened the order, the reseller channel by seller. Everything
 * counts on its product and on `ALL_PRODUCTS`, where an order on two products counts once.
 *   - Orders: the ones requested in the month, drafts included, since an order has no date of leaving the draft.
 *   - Trials: the ones closed in the month, and of them the converted ones; a trial has no salesperson.
 *   - Licenses: the contracts whose `startDate` falls in the month, as the reseller overview counts them.
 *   - Provisioning: the lines delivered in the month, from the confirmation of their order to `provisionedAt`; the
 *     lines confirmed before `confirmedAt` existed stay out instead of counting zero.
 * The order that moves a company from a reseller to Keus (`transferredFromResellerCode`) is no sale: its order, its
 * lines (`previousContractId`) and the contracts they start stay out.
 * @param range the month.
 * @param sources the orders, trials, contracts and lines to count.
 * @returns the counts of the month, one per product, seller and salesperson with something in it.
 */
export function countSalesOrders(range: OverviewRange, sources: SalesOrdersSources): SalesOrdersCounts[] {
  const counts = new Map<string, SalesOrdersCounts>();
  const countOf = (productId: string, resellerPath: string | undefined, salesId: string | undefined): SalesOrdersCounts => {
    const key = salesOrdersKeyOf(productId, resellerPath, salesId);
    let count = counts.get(key);
    if (!count) {
      count = {
        productId,
        ...(resellerPath && { resellerPath }),
        ...(salesId && { salesId }),
        ordersRequested: 0,
        trialsClosed: 0,
        trialsConverted: 0,
        contractsStarted: 0,
        provisionedTimed: 0,
        provisioningDaysTotal: 0,
      };
      counts.set(key, count);
    }
    return count;
  };
  // A trial, a contract and a line belong to one product: they count on it and on every product together.
  const productAndAll = (productId: string, resellerPath: string | undefined, orderId: string | undefined): SalesOrdersCounts[] => {
    const salesId = !resellerPath && orderId ? sources.salesIds.get(orderId) : undefined;
    return [productId, ALL_PRODUCTS].map(product => countOf(product, resellerPath, salesId));
  };
  const inRange = (date: Date): boolean => date >= range.start && date <= range.end;

  for (const order of sources.orders) {
    if (order.transferredFromResellerCode) {
      continue;
    }

    const salesId = !order.resellerPath ? order.assignedSalesId : undefined;
    for (const productId of [...new Set(order.productIds), ALL_PRODUCTS]) {
      countOf(productId, order.resellerPath, salesId).ordersRequested += 1;
    }
  }

  for (const trial of sources.closedTrials) {
    if (!CLOSED_TRIAL_STATUSES.includes(trial.status)) {
      continue;
    }

    for (const count of productAndAll(trial.productId, trial.resellerPath, undefined)) {
      count.trialsClosed += 1;
      if (trial.status === TrialStatus.Converted) {
        count.trialsConverted += 1;
      }
    }
  }

  const transferred = new Set(sources.lines.filter(line => line.previousContractId && line.contractId).map(line => line.contractId));
  for (const contract of sources.contracts) {
    if (transferred.has(contract.id) || !inRange(new Date(contract.startDate))) {
      continue;
    }

    for (const count of productAndAll(contract.productId, contract.resellerPath, contract.orderId)) {
      count.contractsStarted += 1;
    }
  }

  for (const line of sources.lines) {
    const provisionedAt = line.provisionedAt ? new Date(line.provisionedAt) : undefined;
    if (line.previousContractId || !line.confirmedAt || !provisionedAt || !inRange(provisionedAt)) {
      continue;
    }

    const days = (provisionedAt.getTime() - new Date(line.confirmedAt).getTime()) / DAY_MS;
    for (const count of productAndAll(line.productId, line.resellerPath, line.orderId)) {
      count.provisionedTimed += 1;
      count.provisioningDaysTotal += days;
    }
  }

  return [...counts.values()].map(count => ({ ...count, provisioningDaysTotal: Math.round(count.provisioningDaysTotal * 100) / 100 }));
}
