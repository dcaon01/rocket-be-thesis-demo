import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { AppException } from "../../../../errors/exception-types";
import { SibillCompany, SibillDocument, SibillErrorBody, SibillInvoiceBody } from "../../interfaces/sibill.interface";

/** How long a call to Sibill may take before Rocket stops waiting, in milliseconds. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Oldest webhook signature accepted, in seconds: three days, past the two days Sibill keeps retrying a delivery.
 * Replaying an older event changes nothing anyway, since the state is written only when newer.
 */
const WEBHOOK_TOLERANCE_SECONDS = 3 * 24 * 60 * 60;

/**
 * Error of a call to Sibill. `uncertain` tells whether the call may have taken effect anyway: a timeout, a network
 * error or a server error leave it unknown, while a 4xx answer means Sibill refused it and created nothing.
 */
export class SibillRequestError extends AppException {
  /**
   * Constructor for SibillRequestError.
   * @param message what went wrong, with the details Sibill gave.
   * @param uncertain whether the call may have taken effect anyway.
   * @param error the original error, when there is one.
   */
  constructor(message: string, readonly uncertain: boolean, error?: unknown) {
    super(message, 502, error);
  }
}

/**
 * Client of the Sibill integration API, where Rocket creates the electronic invoices of Keus as drafts: the CEO
 * issues them to the exchange system from Sibill. Reads `SIBILL_API_URL`, `SIBILL_API_TOKEN` and `SIBILL_COMPANY_ID`: dev points at the Sibill development
 * environment, prod at production. Creating an invoice is not idempotent at Sibill, so the caller must never repeat a
 * call whose outcome is uncertain.
 */
@Injectable()
export class SibillService {
  /** Logger instance for SibillService. */
  private readonly _logger = new Logger(SibillService.name);

  /** Company of Keus at Sibill, read once per process. */
  private _company: SibillCompany | null = null;

  /**
   * Reads the company of Keus at Sibill: its legal name, VAT number, tax regime and address, the issuer of every
   * invoice.
   * @returns the company.
   * @throws SibillRequestError if Sibill cannot be read or the configured company is not on the account.
   */
  async getCompany(): Promise<SibillCompany> {
    if (this._company) {
      return this._company;
    }

    const { companyId } = this._config();
    const body = await this._request<{ data: SibillCompany[] }>("GET", "/api/v1/companies");
    const company = body.data.find(item => item.id === companyId);
    if (!company) {
      throw new SibillRequestError(`Company ${companyId} is not on the Sibill account of the token.`, false);
    }

    this._company = company;
    return company;
  }

  /**
   * Creates an invoice as a draft, with the next number Sibill assigns when it gives one to drafts. Nothing reaches
   * the exchange system: the CEO issues the draft from Sibill.
   * @param invoice the electronic invoice.
   * @param reconciliationIdentifier the identifier Sibill matches the payment with: the Stripe invoice that charges it.
   * @returns the created draft.
   * @throws SibillRequestError if Sibill refuses it or the outcome is uncertain.
   */
  async createDraftInvoice(invoice: SibillInvoiceBody, reconciliationIdentifier: string): Promise<SibillDocument> {
    const { companyId } = this._config();
    const query = new URLSearchParams({ issue: "false", automatic_number: "true", reconciliation_identifier: reconciliationIdentifier });
    const body = await this._request<{ data: SibillDocument[] }>("POST", `/api/v1/companies/${companyId}/documents/invoice?${query}`, invoice);

    const document = body.data?.[0];
    if (!document?.id) {
      // The call succeeded, so the invoice exists: without its identifier the outcome is uncertain for Rocket.
      throw new SibillRequestError("Sibill accepted the invoice without returning its document.", true);
    }

    this._logger.log(`Draft invoice ${document.number ?? "without number"} created at Sibill as document ${document.id} (${document.status}).`);
    return document;
  }

  /**
   * Reads a document, to link an invoice whose creation had an uncertain outcome.
   * @param documentId the identifier of the document at Sibill.
   * @returns the document.
   * @throws SibillRequestError if Sibill cannot be read or the document does not exist.
   */
  async getDocument(documentId: string): Promise<SibillDocument> {
    const { companyId } = this._config();
    const body = await this._request<{ data: SibillDocument }>("GET", `/api/v1/companies/${companyId}/documents/${encodeURIComponent(documentId)}`);
    return body.data;
  }

  /**
   * Verifies the signature of a webhook (`X-Sibill-Signature: t=<timestamp>, v1=<signature>`): an HMAC SHA-256 of
   * `<timestamp>.<raw body>` keyed with the token, compared in constant time. Schemes other than v1 are ignored.
   * @param rawBody the body exactly as received.
   * @param header the signature header.
   * @returns true when the signature is valid and recent enough.
   */
  verifyWebhookSignature(rawBody: Buffer, header: string | undefined): boolean {
    if (!header) {
      return false;
    }

    const parts = header.split(",").map(part => part.trim().split("=", 2) as [string, string | undefined]);
    const timestamps = parts.filter(([prefix]) => prefix === "t").map(([, value]) => value);
    const signatures = parts.filter(([prefix]) => prefix === "v1").map(([, value]) => value ?? "");
    const timestamp = Number(timestamps[0]);
    if (timestamps.length !== 1 || !Number.isInteger(timestamp) || signatures.length === 0) {
      return false;
    }

    if (Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
      this._logger.warn(`Sibill webhook signed at ${timestamp} is too old to be accepted.`);
      return false;
    }

    const expected = Buffer.from(
      createHmac("sha256", this._config().token).update(`${timestamps[0]}.`).update(rawBody).digest("hex"),
    );
    return signatures.some(signature => {
      const received = Buffer.from(signature);
      return received.length === expected.length && timingSafeEqual(received, expected);
    });
  }

  /**
   * Reads the configuration of the integration.
   * @returns the base URL, the token and the company.
   * @throws AppException if a variable is missing.
   */
  private _config(): { url: string; token: string; companyId: string } {
    const url = process.env.SIBILL_API_URL;
    const token = process.env.SIBILL_API_TOKEN;
    const companyId = process.env.SIBILL_COMPANY_ID;
    if (!url || !token || !companyId) {
      throw new AppException("Sibill is not configured: set SIBILL_API_URL, SIBILL_API_TOKEN and SIBILL_COMPANY_ID.", 500);
    }

    return { url, token, companyId };
  }

  /**
   * Calls the Sibill API and classifies its failures.
   * @param method the HTTP method.
   * @param path the path, with its query.
   * @param payload the JSON body, for a write.
   * @returns the parsed answer.
   * @throws SibillRequestError on any failure, uncertain unless Sibill answered with a 4xx.
   */
  private async _request<T>(method: "GET" | "POST", path: string, payload?: unknown): Promise<T> {
    const { url, token } = this._config();

    let response: Response;
    try {
      response = await fetch(`${url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(payload !== undefined && { "Content-Type": "application/json" }),
        },
        ...(payload !== undefined && { body: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this._logger.error(`Sibill ${method} ${path} got no answer`, error);
      throw new SibillRequestError(`Sibill did not answer ${method} ${path}.`, method !== "GET", error);
    }

    const text = await response.text();
    if (!response.ok) {
      const details = this._errorDetails(text);
      this._logger.error(`Sibill ${method} ${path} answered ${response.status}: ${details}`);
      // A 4xx (429 included) is a refusal: nothing was created. A 5xx leaves the outcome of a write unknown.
      throw new SibillRequestError(`Sibill answered ${response.status}: ${details}`, response.status >= 500 && method !== "GET");
    }

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new SibillRequestError(`Sibill answered ${method} ${path} with a body that is not JSON.`, method !== "GET", error);
    }
  }

  /**
   * Turns the error body of Sibill into one line, with the fields it points at.
   * @param text the raw body.
   * @returns the details, or the raw body when it is not the documented shape.
   */
  private _errorDetails(text: string): string {
    try {
      const body = JSON.parse(text) as SibillErrorBody;
      const details = (body.errors ?? []).map(error =>
        [error.title, error.detail, error.source?.pointer && `(${error.source.pointer})`].filter(Boolean).join(" "));
      return details.length ? details.join("; ") : text.slice(0, 500);
    } catch {
      return text.slice(0, 500);
    }
  }
}
