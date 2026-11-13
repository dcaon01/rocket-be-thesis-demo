import { AppException } from "../../../errors/exception-types";
import { HubspotDealProperties } from "../interfaces/hubspot-deal.interface";

/**
 * Internal name of the deal property «Soluzione d'interesse». The deals of every product sit
 * in one pipeline, and this multiple-choice property tells which products a deal is about:
 * HubSpot returns its values joined by `;`.
 */
export const HUBSPOT_SOLUTION_PROPERTY = "soluzione_dinteresse";

/**
 * Reads the HubSpot pipeline that holds the deals of every product from the environment.
 * @returns the identifier of the pipeline.
 * @throws AppException if HUBSPOT_PRODUCTS_PIPELINE_ID is not configured.
 */
export function productsPipelineId(): string {
  const pipelineId = process.env.HUBSPOT_PRODUCTS_PIPELINE_ID;
  if (!pipelineId) {
    throw new AppException('The HubSpot pipeline of the products is not configured: set HUBSPOT_PRODUCTS_PIPELINE_ID.', 500);
  }
  return pipelineId;
}

/**
 * Splits the solutions of interest of a deal.
 * @param properties the properties of the deal.
 * @returns the values of the solutions, empty when the deal has none.
 */
export function dealSolutions(properties: HubspotDealProperties): string[] {
  return (properties[HUBSPOT_SOLUTION_PROPERTY] ?? "").split(";").filter(Boolean);
}
