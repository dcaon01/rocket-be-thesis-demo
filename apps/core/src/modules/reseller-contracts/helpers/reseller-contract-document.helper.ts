import { formatEuro } from "../../../commons/formatting/notice-format.helper";
import { formatAddress, formatDocumentDate } from "../../contracts/helpers/contract-document.helper";
import { ResellerTier } from "../../resellers/enums/reseller-tier.enum";
import type { ResponseResellerDto } from "../../resellers/dtos/response-reseller.dto";
import type { ResponseResellerContractDto } from "../dtos/response-reseller-contract.dto";

/** Name of each tier as the reseller knows it. */
const TIER_LABELS: Record<ResellerTier, string> = {
  [ResellerTier.Silver]: "Silver",
  [ResellerTier.Gold]: "Gold",
  [ResellerTier.Platinum]: "Platinum",
};

/**
 * Builds the values of the RESELLER_CONTRACT template, formatted as the other documents: the reseller as in its
 * record, and the tier, the start date, the products, the fee of each year and the discounts of the contract.
 * The discounts stay empty when the requester does not see the margin of the contract.
 * @param reseller the reseller of the contract.
 * @param contract the contract, as the requester reads it.
 * @param productNames the names of the products the contract enables.
 * @returns the placeholder values, keyed as in the catalogue.
 */
export function resellerContractDocumentData(reseller: ResponseResellerDto, contract: ResponseResellerContractDto, productNames: string[]): object {
  const margin = contract.margin;

  return {
    today: formatDocumentDate(new Date().toISOString()),
    reseller: {
      name: reseller.companyName,
      vatNumber: reseller.vatNumber ?? "",
      fiscalCode: reseller.fiscalCode ?? "",
      address: formatAddress(reseller.legalAddress) || (reseller.address ?? ""),
      pec: reseller.pec ?? "",
      sdi: reseller.sdi ?? "",
      email: reseller.email,
    },
    contract: {
      code: contract.code,
      tier: TIER_LABELS[contract.tier],
      startDate: formatDocumentDate(contract.validityDate),
      fee: {
        firstYear: formatEuro(contract.fee.firstYearCents),
        secondYear: formatEuro(contract.fee.secondYearCents),
        ongoing: formatEuro(contract.fee.ongoingCents),
      },
      discount: {
        activation: margin ? `${margin.activationPercent}%` : "",
        recurring: margin ? `${margin.recurringPercent}%` : "",
        customization: margin ? `${margin.customizationPercent}%` : "",
      },
    },
    products: productNames.map(name => ({ name })),
  };
}
