/**
 * Interface for HubSpot Deal properties.
 */
export interface HubspotDealProperties {
  /** The name of the deal. */
  dealname: string;
  /** The deal amount/value. */
  amount?: string;
  /** The creation date of the deal (ISO string). */
  createdate?: string;
  /** The close date of the deal. */
  closedate?: string;
  /** The deal stage (HubSpot internal numeric identifier). */
  dealstage?: string;
  /** The pipeline. */
  pipeline?: string;
  /** Whether the deal is in a "Closed Won" stage (computed by HubSpot). */
  hs_is_closed_won?: string;
  /** Whether the deal is closed (computed by HubSpot). */
  hs_is_closed?: string;
  /** The owner ID. */
  hubspot_owner_id?: string;
  /** Allow additional dynamic properties (e.g. hs_date_entered_*). */
  [key: string]: string | undefined;
}

/**
 * Interface for a single HubSpot Deal.
 */
export interface HubspotDeal {
  /** The unique identifier of the deal (hs_object_id). */
  id: string;
  /** Deal properties. */
  properties: HubspotDealProperties;
  /** Associated object IDs (contacts, companies). */
  associations?: {
    contacts?: {
      results: Array<{ id: string; type: string }>;
    };
    companies?: {
      results: Array<{ id: string; type: string }>;
    };
  };
}

/**
 * Interface for HubSpot API search/list response.
 */
export interface HubspotDealsResponse {
  /** Array of deals. */
  results: HubspotDeal[];
  /** Total count. */
  total?: number;
  /** Paging information. */
  paging?: {
    next?: {
      after: string;
      link: string;
    };
  };
}

/**
 * Interface for a HubSpot pipeline stage.
 */
export interface HubspotPipelineStage {
  /** The internal stage ID. */
  id: string;
  /** The display label of the stage. */
  label: string;
  /** Display order of the stage. */
  displayOrder: number;
}

/**
 * Interface for a HubSpot pipeline.
 */
export interface HubspotPipeline {
  /** The pipeline ID. */
  id: string;
  /** The pipeline label. */
  label: string;
  /** The stages in this pipeline. */
  stages: HubspotPipelineStage[];
}

/**
 * Interface for a single HubSpot search filter.
 */
export interface HubspotSearchFilter {
  propertyName: string;
  operator: string;
  value?: string;
  values?: string[];
}

/**
 * Interface for a HubSpot search filter group.
 */
export interface HubspotSearchFilterGroup {
  filters: HubspotSearchFilter[];
}

/**
 * Interface for a HubSpot search request body.
 */
export interface HubspotSearchRequest {
  filterGroups: HubspotSearchFilterGroup[];
  properties?: string[];
  limit?: number;
  after?: string;
}
