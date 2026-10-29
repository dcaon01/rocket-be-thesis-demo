import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { DatabaseException, EntityNotFoundException } from "../../../../errors/exception-types";
import { ProductsService } from "../../../products/lazy-products/services/products.service";
import { ResponseHubspotDealDto } from "../../dtos/response-hubspot-deal.dto";
import { ResponseHubspotDealDetailedDto } from "../../dtos/response-hubspot-deal-detailed.dto";
import { ResponseHubspotLinkDto } from "../../dtos/response-hubspot-link.dto";
import { HUBSPOT_SOLUTION_PROPERTY, dealSolutions, productsPipelineId } from "../../helpers/hubspot-products.helper";
import { HubspotDeal, HubspotDealsResponse, HubspotPipeline, HubspotSearchFilterGroup } from "../../interfaces/hubspot-deal.interface";
import { HubspotContact } from "../../interfaces/hubspot-contact.interface";
import { HubspotCompany } from "../../interfaces/hubspot-company.interface";

@Injectable()
export class HubspotService {
    /** Logger instance for HubspotService. */
    private readonly _logger = new Logger(HubspotService.name);

    /** Lazy-loaded products service */
    private _productsService: ProductsService | null = null;

    /** Portal of the HubSpot account and domain of its interface, which do not change: read once per instance. */
    private _portal: { portalId: number; uiDomain: string } | null = null;

  /**
   * Constructor for HubspotService.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) {}

  /**
   * Lazy loads the ProductsService from its module.
   * @returns A Promise resolving to the ProductsService instance.
   */
  private async _loadProductsService(): Promise<ProductsService> {
    if (!this._productsService) {
      const { ProductsLazyModule } = await import(
        "../../../products/lazy-products/products-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ProductsLazyModule,
      );
      this._productsService = moduleRef.get<ProductsService>(ProductsService);
    }
    return this._productsService;
  }

  /**
   * Queries Hubspot API's to retrieve the 'closedwon' deals of a product: the deals of the
   * products pipeline whose solutions of interest include the one of the product.
   * @param productId the product identifier.
   * @returns The 'closedwon' deals from HubSpot, none when the product has no solution.
   */
  async getHubspotClosedWonDeals(productId: string): Promise<ResponseHubspotDealDto[]> {
    try {
      const productsService = await this._loadProductsService();
      const product = await productsService.getProduct(productId);
      if (!product.hubspotSolution) {
        return [];
      }

      const deals = await this._fetchClosedWonDealsInternal(process.env.HUBSPOT_KEY, product.hubspotSolution);
      return deals.map((deal: HubspotDeal) => {
        return {
          id: deal.id,
          dealname: deal.properties.dealname
        }
      }) as ResponseHubspotDealDto[];
    } catch (error) {
      this._logger.error('Error retrieving closed won deals from HubSpot', error);
      throw new DatabaseException('An error occurred while retrieving closed won deals from HubSpot.', error);
    }
  }

  /**
   * Retrieves a single HubSpot deal by ID with associated contact and company information.
   * This provides detailed information needed to populate contract beneficiary data.
   * @param productId the product identifier to get the HubSpot API key.
   * @param dealId the HubSpot deal ID to retrieve.
   * @returns Detailed deal information including associated contact and company.
   */
  async getHubspotDealById(productId: string, dealId: string): Promise<ResponseHubspotDealDetailedDto> {
    try {
      const deal = await this._fetchDealInternal(process.env.HUBSPOT_KEY, dealId);

      if (!deal) {
        throw new EntityNotFoundException('HubSpot Deal', dealId);
      }

      // Initialize the detailed DTO with deal information.
      const detailedDeal: ResponseHubspotDealDetailedDto = {
        id: deal.id,
        dealname: deal.properties.dealname,
        amount: deal.properties.amount,
        closedate: deal.properties.closedate,
        dealstage: deal.properties.dealstage,
        pipeline: deal.properties.pipeline,
        solutions: dealSolutions(deal.properties),
        isClosedWon: deal.properties.hs_is_closed_won === 'true',
      };

      // Fetch primary contact if associated.
      if (deal.associations?.contacts?.results && deal.associations.contacts.results.length > 0) {
        const contactId = deal.associations.contacts.results[0].id;
        const contact = await this._fetchContactInternal(process.env.HUBSPOT_KEY, contactId);

        if (contact) {
          detailedDeal.primaryContact = {
            id: contact.id,
            firstname: contact.properties.firstname,
            lastname: contact.properties.lastname,
            email: contact.properties.email,
            phone: contact.properties.phone,
            address: this._buildFullAddress(
              contact.properties.address,
              contact.properties.city,
              contact.properties.state,
              contact.properties.zip,
              contact.properties.country
            ),
          };
        }
      }

      // Fetch primary company if associated.
      if (deal.associations?.companies?.results && deal.associations.companies.results.length > 0) {
        const companyId = deal.associations.companies.results[0].id;
        const company = await this._fetchCompanyInternal(process.env.HUBSPOT_KEY, companyId);

        if (company) {
          detailedDeal.primaryCompany = {
            id: company.id,
            name: company.properties.name,
            vatNumber: company.properties.vat_number,
            pec: company.properties.pec,
            sdi: company.properties.sdi_code,
            phone: company.properties.phone,
            address: this._buildFullAddress(
              company.properties.address,
              company.properties.city,
              company.properties.state,
              company.properties.zip,
              company.properties.country
            ),
          };
        }
      }

      return detailedDeal;

    } catch (error) {
      this._logger.error(`Error retrieving HubSpot deal ${dealId}`, error);
      if (error instanceof EntityNotFoundException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while retrieving the HubSpot deal.', error);
    }
  }

  /**
   * Fetches a HubSpot contact by ID.
   * @param productId the product identifier to get the HubSpot API key.
   * @param contactId the contact ID.
   * @returns The contact.
   */
  async getHubspotContactById(productId: string, contactId: string): Promise<HubspotContact> {
    try {
      const contact = await this._fetchContactInternal(process.env.HUBSPOT_KEY, contactId);

      if (!contact) {
        throw new EntityNotFoundException('HubSpot Contact', contactId);
      }

      return contact;
    } catch (error) {
      this._logger.error(`Error retrieving HubSpot contact ${contactId}`, error);
      if (error instanceof EntityNotFoundException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while retrieving the HubSpot contact.', error);
    }
  }

  /**
   * Internal method to fetch a HubSpot contact by ID.
   * @param apiKey the HubSpot API key.
   * @param contactId the contact ID.
   * @returns The contact or null if not found.
   */
  private async _fetchContactInternal(apiKey: string, contactId: string): Promise<HubspotContact | null> {
    try {
      const response = await fetch(
        `${process.env.HUBSPOT_API_URL}/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,phone,address,city,state,zip,country`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          }
        }
      );

      if (!response.ok) {
        this._logger.warn(`Failed to fetch contact ${contactId}: ${response.status}`);
        return null;
      }

      return (await response.json()) as HubspotContact;
    } catch (error) {
      this._logger.error(`Error fetching contact ${contactId}`, error);
      return null;
    }
  }

  /**
   * Internal method to fetch a HubSpot deal by ID.
   * @param apiKey the HubSpot API key.
   * @param dealId the deal ID.
   * @returns The deal or null if not found.
   */
  private async _fetchDealInternal(apiKey: string, dealId: string): Promise<HubspotDeal | null> {
    try {
      const response = await fetch(
        `${process.env.HUBSPOT_API_URL}/crm/v3/objects/deals/${dealId}?properties=dealname,amount,closedate,dealstage,pipeline,hs_is_closed_won,${HUBSPOT_SOLUTION_PROPERTY}&associations=contacts,companies`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          }
        }
      );

      if (!response.ok) {
        this._logger.warn(`Failed to fetch deal ${dealId}: ${response.status}`);
        return null;
      }

      return (await response.json()) as HubspotDeal;
    } catch (error) {
      this._logger.error(`Error fetching deal ${dealId}`, error);
      return null;
    }
  }

  /**
   * Fetches a HubSpot company by ID.
   * @param productId the product identifier to get the HubSpot API key.
   * @param companyId the company ID.
   * @returns The company.
   */
  async getHubspotCompanyById(productId: string, companyId: string): Promise<HubspotCompany> {
    try {
      const company = await this._fetchCompanyInternal(process.env.HUBSPOT_KEY, companyId);

      if (!company) {
        throw new EntityNotFoundException('HubSpot Company', companyId);
      }

      return company;
    } catch (error) {
      this._logger.error(`Error retrieving HubSpot company ${companyId}`, error);
      if (error instanceof EntityNotFoundException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while retrieving the HubSpot company.', error);
    }
  }

  /**
   * Internal method to fetch a HubSpot company by ID.
   * @param apiKey the HubSpot API key.
   * @param companyId the company ID.
   * @returns The company or null if not found.
   */
  private async _fetchCompanyInternal(apiKey: string, companyId: string): Promise<HubspotCompany | null> {
    try {
      const response = await fetch(
        `${process.env.HUBSPOT_API_URL}/crm/v3/objects/companies/${companyId}?properties=name,domain,phone,address,city,state,zip,country,vat_number,pec,sdi_code`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          }
        }
      );

      if (!response.ok) {
        this._logger.warn(`Failed to fetch company ${companyId}: ${response.status}`);
        return null;
      }

      return (await response.json()) as HubspotCompany;
    } catch (error) {
      this._logger.error(`Error fetching company ${companyId}`, error);
      return null;
    }
  }

  /**
   * Internal method to fetch closed won deals from HubSpot.
   * Walks the paginated `/crm/v3/objects/0-3/search` endpoint until the cursor is
   * exhausted: HubSpot's search API caps at 100 results per page and defaults to a
   * much smaller window when `limit` is omitted, so a single fetch silently truncates
   * the result set as soon as more than ~10 deals match.
   * @param apiKey the HubSpot API key.
   * @param solution the solution of interest the deals must include.
   * @returns Array of every closed-won deal matching the filters across all pages.
   */
  private async _fetchClosedWonDealsInternal(apiKey: string, solution: string): Promise<HubspotDeal[]> {
    // IN on a multiple-choice property matches the deals whose values include the solution.
    const filters: Record<string, unknown>[] = [
      { operator: "EQ", propertyName: "hs_is_closed_won", value: "true" },
      { operator: "EQ", propertyName: "pipeline", value: productsPipelineId() },
      { operator: "IN", propertyName: HUBSPOT_SOLUTION_PROPERTY, values: [solution] },
    ];

    const allDeals: HubspotDeal[] = [];
    let after: string | undefined;

    try {
      do {
        const body: Record<string, unknown> = {
          filterGroups: [{ filters }],
          limit: 100,
        };
        if (after) body.after = after;

        const response = await fetch(`${process.env.HUBSPOT_API_URL}/crm/v3/objects/0-3/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          this._logger.warn(`Failed to fetch closed won deals: ${response.status}`);
          break;
        }

        const data = (await response.json()) as HubspotDealsResponse;
        allDeals.push(...data.results);
        after = data.paging?.next?.after;
      } while (after);

      return allDeals;
    } catch (error) {
      this._logger.error('Error fetching closed won deals', error);
      return [];
    }
  }

  /**
   * Searches HubSpot deals with the given filter groups and properties.
   * Handles pagination automatically to fetch all matching deals (up to 10,000).
   * @param filterGroups the filter groups for the search query (OR between groups, AND within).
   * @param properties the deal properties to return.
   * @returns Array of matching deals.
   */
  async searchDeals(filterGroups: HubspotSearchFilterGroup[], properties: string[]): Promise<HubspotDeal[]> {
    const apiKey = process.env.HUBSPOT_KEY;
    const allDeals: HubspotDeal[] = [];
    let after: string | undefined;

    try {
      do {
        const body: Record<string, unknown> = {
          filterGroups,
          properties,
          limit: 100,
        };
        if (after) body.after = after;

        const response = await fetch(`${process.env.HUBSPOT_API_URL}/crm/v3/objects/deals/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          this._logger.warn(`Failed to search deals: ${response.status} - ${errorBody}`);
          this._logger.warn(`Request body: ${JSON.stringify(body)}`);
          break;
        }

        const data = (await response.json()) as HubspotDealsResponse;
        allDeals.push(...data.results);
        after = data.paging?.next?.after;
      } while (after);

      return allDeals;
    } catch (error) {
      this._logger.error('Error searching deals', error);
      throw new DatabaseException('An error occurred while searching HubSpot deals.', error);
    }
  }

  /**
   * Retrieves the total count of deals matching the given filter groups without fetching all records.
   * @param filterGroups the filter groups for the search query.
   * @returns The total count of matching deals.
   */
  async countDeals(filterGroups: HubspotSearchFilterGroup[]): Promise<number> {
    const apiKey = process.env.HUBSPOT_KEY;

    try {
      const response = await fetch(`${process.env.HUBSPOT_API_URL}/crm/v3/objects/deals/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          filterGroups,
          limit: 1,
        }),
      });

      if (!response.ok) {
        this._logger.warn(`Failed to count deals: ${response.status}`);
        return 0;
      }

      const data = (await response.json()) as HubspotDealsResponse;
      return data.total ?? 0;
    } catch (error) {
      this._logger.error('Error counting deals', error);
      throw new DatabaseException('An error occurred while counting HubSpot deals.', error);
    }
  }

  /**
   * Builds the link that opens the board of the products pipeline on HubSpot, where the deals of every product sit.
   * @returns The link to the pipeline.
   * @throws DatabaseException if the portal of the account cannot be read.
   */
  async getDealsPipelineLink(): Promise<ResponseHubspotLinkDto> {
    const pipelineId = productsPipelineId();
    const { portalId, uiDomain } = await this._getPortal();
    return { url: `https://${uiDomain}/contacts/${portalId}/objects/0-3/views/all/board?pipeline=${pipelineId}` };
  }

  /**
   * Reads the portal of the HubSpot account and the domain of its interface from the account info, once.
   * @returns The portal id and the interface domain.
   */
  private async _getPortal(): Promise<{ portalId: number; uiDomain: string }> {
    if (this._portal) {
      return this._portal;
    }

    try {
      const response = await fetch(`${process.env.HUBSPOT_API_URL}/account-info/v3/details`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.HUBSPOT_KEY}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HubSpot account info failed with status ${response.status}.`);
      }

      this._portal = (await response.json()) as { portalId: number; uiDomain: string };
      return this._portal;
    } catch (error) {
      this._logger.error('Error fetching the HubSpot portal', error);
      throw new DatabaseException('An error occurred while reading the HubSpot portal.', error);
    }
  }

  /**
   * Retrieves all pipelines with their stages for deals.
   * @returns Array of pipelines with stages.
   */
  async getDealPipelines(): Promise<HubspotPipeline[]> {
    const apiKey = process.env.HUBSPOT_KEY;

    try {
      const response = await fetch(`${process.env.HUBSPOT_API_URL}/crm/v3/pipelines/deals`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        this._logger.warn(`Failed to fetch deal pipelines: ${response.status}`);
        return [];
      }

      const data = (await response.json()) as { results: HubspotPipeline[] };
      return data.results;
    } catch (error) {
      this._logger.error('Error fetching deal pipelines', error);
      throw new DatabaseException('An error occurred while fetching HubSpot deal pipelines.', error);
    }
  }

  /**
   * Builds a full address string from individual components.
   * @param address street address.
   * @param city city.
   * @param state state/province.
   * @param zip ZIP/postal code.
   * @param country country.
   * @returns Full address string or undefined if no components provided.
   */
  private _buildFullAddress(
    address?: string,
    city?: string,
    state?: string,
    zip?: string,
    country?: string
  ): string | undefined {
    const parts = [address, city, state, zip, country].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : undefined;
  }
}
