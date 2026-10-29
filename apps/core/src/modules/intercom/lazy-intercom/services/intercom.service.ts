import { Injectable, Logger } from "@nestjs/common";
import { AppException } from "../../../../errors/exception-types";
import { IntercomBrand, IntercomConversation, IntercomConversationPage } from "../../interfaces/intercom-conversation.interface";

/** Default Intercom API base URL. */
const DEFAULT_INTERCOM_API_URL = "https://api.intercom.io";

/** Intercom API version the requests are written for. */
const INTERCOM_API_VERSION = "2.14";

/** First Intercom API version with the brands endpoint: 2.14 answers `intercom_version_invalid`. */
const BRANDS_API_VERSION = "2.15";

/** Largest page the conversation search returns. */
const SEARCH_PAGE_SIZE = 150;

/** Server-side cache TTL of the conversation reads (~5 minutes), to respect the rate limits. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Longest wait for a single Intercom request. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Longest time all the pages of a search may take together, below the 29 seconds of API Gateway. */
const SEARCH_DEADLINE_MS = 20_000;

/**
 * Server-side reader of the Intercom REST API for the support metrics (UR-RK-221). The workspace is shared by every
 * product: a conversation belongs to a product through its brand. The access token and the base URL are read from `process.env` (INTERCOM_ACCESS_TOKEN,
 * INTERCOM_API_URL); nothing is ever written to Intercom.
 */
@Injectable()
export class IntercomService {
  /** Logger instance for IntercomService. */
  private readonly _logger = new Logger(IntercomService.name);

  /** In-memory cache of the conversation reads, keyed by the window, with a short TTL. */
  private readonly _cache = new Map<string, { data: IntercomConversation[]; expiresAt: number }>();

  /**
   * Reads every conversation updated from a moment on: the ones opened or closed in the window are among them.
   * Results are cached in memory for ~5 minutes per window. The pages are read one after the other within
   * `SEARCH_DEADLINE_MS`, so a window too large for the time of a request fails instead of hanging.
   * @param since the start of the window.
   * @returns the conversations, all the pages of the search.
   * @throws AppException if Intercom is not configured, a request fails, or the pages do not fit the deadline.
   */
  async getConversationsUpdatedSince(since: Date): Promise<IntercomConversation[]> {
    const sinceSeconds = Math.floor(since.getTime() / 1000);
    const cacheKey = String(sinceSeconds);
    const cached = this._cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      this._logger.log(`Serving Intercom conversations from cache (since ${since.toISOString()}).`);
      return cached.data;
    }

    const conversations: IntercomConversation[] = [];
    const deadline = Date.now() + SEARCH_DEADLINE_MS;
    let startingAfter: string | undefined;
    do {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        this._logger.warn(`Intercom search since ${since.toISOString()} stopped after ${conversations.length} conversations: deadline reached.`);
        throw new AppException("Intercom took too long to list the conversations of the period: choose a shorter one.", 504);
      }

      const page = await this._request<IntercomConversationPage>("/conversations/search", {
        method: "POST",
        body: JSON.stringify({
          query: { field: "updated_at", operator: ">", value: sinceSeconds },
          pagination: { per_page: SEARCH_PAGE_SIZE, ...(startingAfter && { starting_after: startingAfter }) },
        }),
      }, Math.min(REQUEST_TIMEOUT_MS, remainingMs));
      conversations.push(...(page.conversations ?? []));
      startingAfter = page.pages?.next?.starting_after ?? undefined;
    } while (startingAfter);

    this._logger.log(`Read ${conversations.length} Intercom conversations updated since ${since.toISOString()}.`);
    this._cache.set(cacheKey, { data: conversations, expiresAt: Date.now() + CACHE_TTL_MS });
    return conversations;
  }

  /**
   * Lists the brands of the workspace, for the product form.
   * @returns the brands, with identifier and name.
   * @throws AppException if Intercom is not configured or the request fails.
   */
  async listBrands(): Promise<IntercomBrand[]> {
    const response = await this._request<{ data: IntercomBrand[] }>("/brands", { method: "GET", version: BRANDS_API_VERSION });
    return (response.data ?? []).map(brand => ({ id: String(brand.id), name: brand.name }));
  }

  /**
   * Sends an authenticated request to the Intercom API and parses the JSON answer.
   * @param path the path of the endpoint.
   * @param init the method and body of the request, and the API version when it is not the default one.
   * @param timeoutMs the longest wait for the answer.
   * @returns the parsed answer.
   * @throws AppException if the token is missing, Intercom does not answer in time, or answers with an error.
   */
  private async _request<T>(path: string, init: { method: string; body?: string; version?: string }, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const token = process.env.INTERCOM_ACCESS_TOKEN;
    const baseUrl = process.env.INTERCOM_API_URL || DEFAULT_INTERCOM_API_URL;
    if (!token) {
      throw new AppException("Missing Intercom configuration (INTERCOM_ACCESS_TOKEN).", 500);
    }

    // The timeout covers the body too, so the whole exchange stays in the try.
    let status: number;
    let body: string;
    try {
      const { version, ...request } = init;
      const response = await fetch(`${baseUrl}${path}`, {
        ...request,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Intercom-Version": version ?? INTERCOM_API_VERSION,
        },
      });
      status = response.status;
      body = await response.text();
    } catch (error) {
      this._logger.warn(`Intercom request ${init.method} ${path} got no answer`, error);
      throw new AppException("Intercom could not be reached or did not answer in time.", 504);
    }

    if (status < 200 || status >= 300) {
      this._logger.warn(`Intercom request ${init.method} ${path} failed: ${status} - ${body}`);
      throw new AppException(`Intercom request failed with status ${status}.`, 502);
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      this._logger.warn(`Intercom request ${init.method} ${path} answered with a body that is not JSON.`);
      throw new AppException("Intercom answered with an unreadable body.", 502);
    }
  }
}
