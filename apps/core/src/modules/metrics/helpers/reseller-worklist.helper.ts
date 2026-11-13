import type { ResponseContractDto } from "../../contracts/dtos/response-contract.dto";
import { ResellerOpportunityReason } from "../enums/reseller-opportunity-reason.enum";
import type { ResponseResellerOpportunityDto } from "../dtos/response-reseller-opportunity.dto";

/** Days ahead the renewals of a reseller are listed in (UR-RK-339). */
export const RENEWAL_HORIZON_DAYS = 90;

/** Share of the seats of a tenant its active users must reach to be close to the cap. */
export const NEAR_CAP_RATIO = 0.8;

/** Active users and seats of a tenant, by `productId#tenantId`. */
export type TenantSeats = Map<string, { activeUsers: number; seats: number }>;

/**
 * Builds the key a tenant is found by among the seats.
 * @param productId the product of the tenant.
 * @param tenantId the identifier of the tenant.
 * @returns the key.
 */
export function tenantKeyOf(productId: string, tenantId: string): string {
  return `${productId}#${tenantId}`;
}

/**
 * Finds the customers of a reseller with room to grow, from its contracts in force:
 *   - a tenant whose active users reached `NEAR_CAP_RATIO` of its seats (the cap is soft: past it the seats grow and
 *     the fee with them);
 *   - a company in force on a single product, with the products its reseller sells and it does not have.
 * The products of a company are read from every contract of the reseller, so a salesperson whose company bought
 * another product through someone else does not see it as single; the opportunities are only the ones of its own
 * contracts.
 * @param contracts the contracts in force of the reseller and its subtree.
 * @param isOwned whether a contract is one of the requester's.
 * @param seats the active users and seats of the tenants of the contracts.
 * @param productsOf the products each reseller sells, by code.
 * @returns the opportunities, companies on a single product first.
 */
export function findOpportunities(
  contracts: ResponseContractDto[],
  isOwned: (contract: ResponseContractDto) => boolean,
  seats: TenantSeats,
  productsOf: Map<string, string[]>,
): ResponseResellerOpportunityDto[] {
  const productsOfCompany = new Map<string, Set<string>>();
  for (const contract of contracts) {
    productsOfCompany.set(contract.companyId, (productsOfCompany.get(contract.companyId) ?? new Set()).add(contract.productId));
  }

  const singles: ResponseResellerOpportunityDto[] = [];
  const nearCap: ResponseResellerOpportunityDto[] = [];
  const listed = new Set<string>();
  for (const contract of contracts.filter(isOwned)) {
    const products = productsOfCompany.get(contract.companyId);
    const sellerCode = contract.resellerPath?.split('#').filter(Boolean).pop();
    const missingProductIds = (productsOf.get(sellerCode) ?? []).filter(productId => !products.has(productId));
    if (products.size === 1 && missingProductIds.length > 0 && !listed.has(contract.companyId)) {
      listed.add(contract.companyId);
      singles.push({
        companyId: contract.companyId,
        companyName: contract.companyName,
        reason: ResellerOpportunityReason.SingleProduct,
        productId: contract.productId,
        missingProductIds,
      });
    }

    const tenant = seats.get(tenantKeyOf(contract.productId, contract.tenantId));
    if (tenant && tenant.seats > 0 && tenant.activeUsers >= tenant.seats * NEAR_CAP_RATIO) {
      nearCap.push({
        companyId: contract.companyId,
        companyName: contract.companyName,
        reason: ResellerOpportunityReason.SeatsNearCap,
        productId: contract.productId,
        activeUsers: tenant.activeUsers,
        seats: tenant.seats,
      });
    }
  }

  return [...singles, ...nearCap];
}
