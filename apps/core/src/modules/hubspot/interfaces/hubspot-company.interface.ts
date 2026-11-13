/**
 * Interface for HubSpot Company properties.
 * Contains properties that may be used for contract beneficiary information.
 */
export interface HubspotCompanyProperties {
  /** Name of the company. */
  name?: string;
  /** Domain of the company. */
  domain?: string;
  /** Phone number. */
  phone?: string;
  /** Address. */
  address?: string;
  /** City. */
  city?: string;
  /** State/Province. */
  state?: string;
  /** ZIP/Postal code. */
  zip?: string;
  /** Country. */
  country?: string;
  /** VAT number (custom property or standard depending on HubSpot setup). */
  vat_number?: string;
  /** PEC (Posta Elettronica Certificata - Italian certified email). */
  pec?: string;
  /** SDI code (Sistema di Interscambio - Italian electronic invoicing code). */
  sdi_code?: string;
}

/**
 * Interface for a single HubSpot Company.
 */
export interface HubspotCompany {
  /** The unique identifier of the company. */
  id: string;
  /** Company properties. */
  properties: HubspotCompanyProperties;
}

/**
 * Interface for HubSpot Companies API response.
 */
export interface HubspotCompaniesResponse {
  /** Array of companies. */
  results: HubspotCompany[];
}
