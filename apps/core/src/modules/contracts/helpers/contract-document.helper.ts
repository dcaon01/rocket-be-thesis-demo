import { ITALY_TIME_ZONE } from "../../../commons/dates/calendar-day.helper";
import { ResponseCompanyDto } from "../../companies/dtos/response-company.dto";
import { Contract } from "../schemas/contract.schema";

/** Who accepted the contract and when, printed on the document once the referent accepts. */
export type ContractAcceptance = {
  /** When the contract was accepted (ISO string). */
  acceptedAt: string;
  /** Full name of the user who accepted. */
  userName?: string;
  /** Email of the user who accepted. */
  userEmail?: string;
};

/**
 * Builds the values of the CONTRACT template, formatted as the frontend formats the other documents.
 * The acceptance fields stay empty until the referent accepts.
 * @param company the company of the tenant.
 * @param productName the name of the product.
 * @param contract the contract being created.
 * @param acceptance who accepted the contract and when, once accepted.
 * @returns the placeholder values, keyed as in the catalogue.
 */
export function contractDocumentData(
  company: ResponseCompanyDto,
  productName: string,
  contract: Pick<Contract, "code" | "seats" | "startDate" | "renewalDate">,
  acceptance?: ContractAcceptance,
): object {
  return {
    today: formatDocumentDate(new Date().toISOString()),
    company: {
      name: company.name,
      vatNumber: company.vatNumber ?? "",
      fiscalCode: company.fiscalCode ?? "",
      address: formatAddress(company.legalAddress) || (company.address ?? ""),
      pec: company.pec ?? "",
      sdi: company.sdi ?? "",
    },
    product: { name: productName },
    contract: {
      code: contract.code,
      seats: String(contract.seats),
      startDate: formatDocumentDate(contract.startDate),
      renewalDate: formatDocumentDate(contract.renewalDate),
    },
    acceptance: {
      date: formatDocumentDate(acceptance?.acceptedAt),
      time: acceptance ? new Date(acceptance.acceptedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: ITALY_TIME_ZONE }) : "",
      userName: acceptance?.userName ?? "",
      userEmail: acceptance?.userEmail ?? "",
    },
  };
}

/**
 * Formats a date as dd/mm/yyyy.
 * @param iso the date (ISO string).
 * @returns the formatted date, or an empty string when there is none.
 */
export function formatDocumentDate(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: ITALY_TIME_ZONE }) : "";
}

/**
 * Formats a legal address on one line: street, postal code, city and province.
 * @param address the structured address.
 * @returns the address on one line, or an empty string when there is none.
 */
export function formatAddress(address: ResponseCompanyDto["legalAddress"]): string {
  if (!address) return "";
  const city = [address.zipCode, address.city].filter(Boolean).join(" ");
  return [address.street, address.province ? `${city} (${address.province})` : city].filter(Boolean).join(", ");
}
