/**
 * Interface for HubSpot Contact properties.
 * Contains properties that may be used for contract beneficiary information.
 */
export interface HubspotContactProperties {
  /** First name of the contact. */
  firstname?: string;
  /** Last name of the contact. */
  lastname?: string;
  /** Email of the contact. */
  email?: string;
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
  /** Company name (if individual contact has company info). */
  company?: string;
}

/**
 * Interface for a single HubSpot Contact.
 */
export interface HubspotContact {
  /** The unique identifier of the contact. */
  id: string;
  /** Contact properties. */
  properties: HubspotContactProperties;
}

/**
 * Interface for HubSpot Contacts API response.
 */
export interface HubspotContactsResponse {
  /** Array of contacts. */
  results: HubspotContact[];
}
