import { formatAddress } from "../../contracts/helpers/contract-document.helper";
import { BilledPartyAddress, BilledPartyDetails } from "../schemas/invoice.schema";

/** What a company or a reseller says about itself that the electronic invoice needs. */
type FiscalParty = {
  /** Legal name, when the party has one apart from its display name. */
  companyName?: string;
  /** Display name. */
  name?: string;
  /** VAT number. */
  vatNumber?: string;
  /** Fiscal code. */
  fiscalCode?: string;
  /** Contact email. */
  email?: string;
  /** Free-text address. */
  address?: string;
  /** Structured legal address. */
  legalAddress?: BilledPartyAddress;
  /** Interchange code of the electronic invoice. */
  sdi?: string;
  /** Certified email. */
  pec?: string;
};

/**
 * Freezes the details of a billed company or reseller at issue, fiscal data included.
 * @param party the company or the reseller.
 * @returns the billed party details.
 */
export function billedPartyOf(party: FiscalParty): BilledPartyDetails {
  return {
    name: party.companyName || party.name || "",
    ...(party.vatNumber && { vatNumber: party.vatNumber }),
    ...(party.fiscalCode && { fiscalCode: party.fiscalCode }),
    ...(party.email && { email: party.email }),
    address: formatAddress(party.legalAddress) || party.address || "",
    ...(party.legalAddress && { legalAddress: { ...party.legalAddress } }),
    ...(party.sdi && { sdi: party.sdi }),
    ...(party.pec && { pec: party.pec }),
  };
}
