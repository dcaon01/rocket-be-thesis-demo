import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { Condition } from "dynamoose";
import { InjectModel, Model } from "nestjs-dynamoose";
import { v4 as uuidv4 } from "uuid";
import { isUnrestricted, RequestScope, SYSTEM_SCOPE, UserRole } from "@rocket-be/scoping";
import { AppException, BusinessException, DatabaseException, EntityNotFoundException, ValidationException } from "../../../../errors/exception-types";
import { calendarDayOf, todayInItaly } from "../../../../commons/dates/calendar-day.helper";
import { paginate, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { rocketUrl } from "../../../../commons/formatting/notice-format.helper";
import { ResellerContractsPageQueryDto } from "../../dtos/reseller-contracts-page-query.dto";
import { ResponseResellerContractsPageDto } from "../../dtos/response-reseller-contracts-page.dto";
import { assertCollaborator } from "../../../../commons/scoping/scoped-access.helper";
import { ResellerContractStatus, RESELLER_IN_FORCE_STATUSES } from "../../enums/reseller-contract-status.enum";
import { calculateRenewalDate, deferredChargeOf } from "../../helpers/fee-schedule.helper";
import { resellerContractDocumentData } from "../../helpers/reseller-contract-document.helper";
import { ResellerContractSchedulerService } from "./reseller-contract-scheduler.service";
import type { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import type { InvoicesService } from "../../../invoices/lazy-invoices/services/invoices.service";
import type { ProductsService } from "../../../products/lazy-products/services/products.service";
import type { RenderService } from "../../../render/lazy-render/services/render.service";
import { FeePriceIds } from "../../../resellers/schemas/reseller-tier-config.schema";
import type { PresignedUrlResponseDto } from "../../../s3/dtos/presigned-url-response.dto";
import type { S3Service } from "../../../s3/lazy-s3/services/s3.service";
import { TemplateType } from "../../../templates/enums/template-type.enum";
import type { TemplatesService } from "../../../templates/lazy-templates/services/templates.service";
import { StripeAccountLink } from "../../../stripe/classes/stripe-account-link.class";
import { RESELLER_MANDATE_CHECKOUT_PURPOSE } from "../../../stripe/constants/metadata-purpose.constant";
import { KEUS_FEE_PRODUCT_ID, keusStripeAccount } from "../../../stripe/helpers/keus-stripe-account.helper";
import type { StripeService } from "../../../stripe/lazy-stripe/services/stripe.service";
import { CreateResellerContractDto } from "../../dtos/create-reseller-contract.dto";
import { ResponseResellerContractDto } from "../../dtos/response-reseller-contract.dto";
import { ResponseResellerAccessDto } from "../../dtos/response-reseller-access.dto";
import { ResellerAccessState } from "../../enums/reseller-access-state.enum";
import { ResellerAccessCharge } from "../../classes/reseller-access-charge.class";
import { InvoiceStatus } from "../../../invoices/enums/invoice-status.enum";
import type { Invoice } from "../../../invoices/schemas/invoice.schema";
import { UpdateResellerContractDto } from "../../dtos/update-reseller-contract.dto";
import { ResellerContract, ResellerContractKey } from "../../schemas/reseller-contract.schema";
import { isConditionalCheckFailed } from "../../../../commons/persistence/write-errors.helper";
import { integrationsEnabled } from "../../../../commons/integrations/integrations.helper";
import { SalesChannel } from "../../../companies/enums/sales-channel.enum";
import { BilledPartyType } from "../../../invoices/enums/billed-party-type.enum";
import { ChargeCadence } from "../../../invoices/enums/charge-cadence.enum";
import { occurrencesBetween } from "../../../invoices/helpers/charge-occurrences.helper";
import { invoiceAmounts } from "../../../invoices/helpers/invoice-amounts.helper";
import type { ExpectedCharge } from "../../../invoices/interfaces/expected-charge.interface";

/**
 * Transitions allowed between the statuses of a reseller contract.
 * A reseller contract is never suspended: an unpaid fee suspends nothing (UR-RK-101).
 */
const VALID_TRANSITIONS: Record<ResellerContractStatus, ResellerContractStatus[]> = {
  [ResellerContractStatus.Draft]: [ResellerContractStatus.Signed],
  [ResellerContractStatus.Signed]: [ResellerContractStatus.Active],
  [ResellerContractStatus.Active]: [ResellerContractStatus.EndedAtRenewal, ResellerContractStatus.Ended],
  [ResellerContractStatus.Suspended]: [],
  [ResellerContractStatus.EndedAtRenewal]: [ResellerContractStatus.Active, ResellerContractStatus.Ended],
  [ResellerContractStatus.Ended]: [],
  [ResellerContractStatus.Refused]: [],
};


/** Writes of the mandate links attempted before giving up on a contract that keeps changing under them. */
const LINKS_WRITE_ATTEMPTS = 5;

/** One year in milliseconds, to tell which year of contract an invoice bills. */
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** How long the page of Stripe to pay a charge is reused, so the blocking screen read again does not call Stripe every time. */
const PAY_URL_CACHE_MS = 10 * 60 * 1000;

/** The reseller fields a contract reads: its identity and the pointer to the contract in force. */
type ResellerRef = { id: string; code: string; contractId?: string };

/**
 * Service responsible for the contracts between Keus and its resellers.
 * A contract is opened by an operator from a partner tier, as a DRAFT carrying the fee
 * of each year (the first, the second, and from the third on) and the margins of the
 * reseller. It is signed with the framework agreement: the fee then goes through a
 * Stripe checkout on the account of Keus, and the SEPA mandate of each product of the
 * contract is collected on its own checkout. The contract starts once the fee is paid
 * (nothing to pay when it is zero, Silver) and all its mandates are active. Each yearly
 * invoice paid moves the subscription onto the price of the following year.
 *
 * Lifecycle:
 *   DRAFT → SIGNED → ACTIVE (when the fee is paid and every mandate is active)
 *   ACTIVE → ENDED_AT_RENEWAL → ENDED (at the renewal date), or back to ACTIVE
 *   ACTIVE → ENDED (immediate termination)
 *
 * A reseller has at most one contract in force, pointed at by the reseller. Changing
 * tier opens a successor that starts at the renewal of the contract in force: when the
 * successor is activated the old contract is set to end at its renewal, and the pointer
 * moves when it ends. Fee and margins are frozen once the contract leaves DRAFT.
 */
@Injectable()
export class ResellerContractsService {
  /** Logger instance for ResellerContractsService. */
  private readonly _logger = new Logger(ResellerContractsService.name);

  /** Lazy-loaded resellers service. */
  private _resellersService: ResellersService | null = null;
  /** Lazy-loaded Stripe service. */
  private _stripeService: StripeService | null = null;
  /** Lazy-loaded invoices service. */
  private _invoicesService: InvoicesService | null = null;
  /** Lazy-loaded products service. */
  private _productsService: ProductsService | null = null;
  /** Lazy-loaded templates service. */
  private _templatesService: TemplatesService | null = null;
  /** Lazy-loaded render service. */
  private _renderService: RenderService | null = null;
  /** Lazy-loaded S3 service. */
  private _s3Service: S3Service | null = null;

  /** Pages of Stripe to pay a charge read recently, by Stripe invoice, with when they were read. */
  private readonly _payUrlCache = new Map<string, { readAt: number; url: string }>();

  /**
   * Constructor for ResellerContractsService.
   * @param _contractModel the Dynamoose model used to persist the reseller contracts.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the other services on demand.
   * @param _contractSchedulerService the scheduler of the renewal and end events.
   */
  constructor(
    @InjectModel("ResellerContract")
    private readonly _contractModel: Model<ResellerContract, ResellerContractKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader,
    private readonly _contractSchedulerService: ResellerContractSchedulerService,
  ) { }

  /**
   * Lazy loads the ResellersService from its module.
   * @returns a Promise resolving to the ResellersService instance.
   */
  private async _loadResellersService(): Promise<ResellersService> {
    if (!this._resellersService) {
      const { ResellersLazyModule } = await import("../../../resellers/lazy-resellers/resellers-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ResellersLazyModule);
      const { ResellersService } = await import("../../../resellers/lazy-resellers/services/resellers.service");
      this._resellersService = moduleRef.get<ResellersService>(ResellersService);
    }
    return this._resellersService;
  }

  /**
   * Lazy loads the StripeService from its module.
   * @returns a Promise resolving to the StripeService instance.
   */
  private async _loadStripeService(): Promise<StripeService> {
    if (!this._stripeService) {
      const { StripeLazyModule } = await import("../../../stripe/lazy-stripe/stripe-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => StripeLazyModule);
      const { StripeService } = await import("../../../stripe/lazy-stripe/services/stripe.service");
      this._stripeService = moduleRef.get<StripeService>(StripeService);
    }
    return this._stripeService;
  }

  /**
   * Lazy loads the InvoicesService from its module.
   * @returns a Promise resolving to the InvoicesService instance.
   */
  private async _loadInvoicesService(): Promise<InvoicesService> {
    if (!this._invoicesService) {
      const { InvoicesLazyModule } = await import("../../../invoices/lazy-invoices/invoices-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => InvoicesLazyModule);
      const { InvoicesService } = await import("../../../invoices/lazy-invoices/services/invoices.service");
      this._invoicesService = moduleRef.get<InvoicesService>(InvoicesService);
    }
    return this._invoicesService;
  }

  /**
   * Lazy loads the ProductsService from its module.
   * @returns a Promise resolving to the ProductsService instance.
   */
  private async _loadProductsService(): Promise<ProductsService> {
    if (!this._productsService) {
      const { ProductsLazyModule } = await import("../../../products/lazy-products/products-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ProductsLazyModule);
      const { ProductsService } = await import("../../../products/lazy-products/services/products.service");
      this._productsService = moduleRef.get<ProductsService>(ProductsService);
    }
    return this._productsService;
  }

  /**
   * Lazy loads the TemplatesService from its module.
   * @returns a Promise resolving to the TemplatesService instance.
   */
  private async _loadTemplatesService(): Promise<TemplatesService> {
    if (!this._templatesService) {
      const { TemplatesLazyModule } = await import("../../../templates/lazy-templates/templates-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => TemplatesLazyModule);
      const { TemplatesService } = await import("../../../templates/lazy-templates/services/templates.service");
      this._templatesService = moduleRef.get<TemplatesService>(TemplatesService);
    }
    return this._templatesService;
  }

  /**
   * Lazy loads the RenderService from its module.
   * @returns a Promise resolving to the RenderService instance.
   */
  private async _loadRenderService(): Promise<RenderService> {
    if (!this._renderService) {
      const { RenderLazyModule } = await import("../../../render/lazy-render/render-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => RenderLazyModule);
      const { RenderService } = await import("../../../render/lazy-render/services/render.service");
      this._renderService = moduleRef.get<RenderService>(RenderService);
    }
    return this._renderService;
  }

  /**
   * Lazy loads the S3Service from its module.
   * @returns a Promise resolving to the S3Service instance.
   */
  private async _loadS3Service(): Promise<S3Service> {
    if (!this._s3Service) {
      const { S3LazyModule } = await import("../../../s3/lazy-s3/s3-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => S3LazyModule);
      const { S3Service } = await import("../../../s3/lazy-s3/services/s3.service");
      this._s3Service = moduleRef.get<S3Service>(S3Service);
    }
    return this._s3Service;
  }

  /**
   * Lists one page of the contracts of every reseller.
   * A Keus salesperson gets only the contracts of its own resellers. The table
   * is scanned, so the page has no order.
   * @param query the page and its filters.
   * @param scope the request scope.
   * @returns the page of reseller contracts.
   * @throws ValidationException if the cursor is not valid.
   */
  async listContracts(query: ResellerContractsPageQueryDto, scope: RequestScope): Promise<ResponseResellerContractsPageDto> {
    assertCollaborator(scope, 'listResellerContracts');

    const { limit, cursor, status, tier, search } = query;
    const resellersService = await this._loadResellersService();
    const ownResellerIds = resellersService.readsOwnResellersOnly(scope)
      ? new Set((await resellersService.getAllResellers(scope)).map(reseller => reseller.id))
      : null;

    try {
      const page = await paginate<ResellerContract>(
        () => this._contractModel.scan(), // Every contract of every reseller is asked for: scan.
        ["resellerId", "id"],
        limit,
        cursor,
        contract =>
          (!ownResellerIds || ownResellerIds.has(contract.resellerId))
          && (!status?.length || status.includes(contract.status))
          && (!tier?.length || tier.includes(contract.tier))
          && startsWithAny(search, contract.code, contract.resellerName, contract.resellerCode),
      );

      return { items: page.items.map(contract => this._toResponse(contract, scope)), nextCursor: page.nextCursor };
    } catch (error) {
      if (error instanceof ValidationException) {
        throw error;
      }

      this._logger.error("Error listing the reseller contracts", error);
      throw new DatabaseException("An error occurred while retrieving the reseller contracts.", error);
    }
  }

  /**
   * Lists the contracts of a reseller, the newest start date first.
   * @param resellerId the identifier of the reseller.
   * @param scope the request scope.
   * @returns the contracts of the reseller.
   */
  async getContracts(resellerId: string, scope: RequestScope): Promise<ResponseResellerContractDto[]> {
    const resellersService = await this._loadResellersService();
    await resellersService.getReseller(resellerId, scope);
    const contracts = await this._listOf(resellerId);
    return contracts.map(contract => this._toResponse(contract, scope));
  }

  /**
   * Retrieves a contract of a reseller.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @param scope the request scope.
   * @returns the contract.
   * @throws EntityNotFoundException if the contract does not exist.
   */
  async getContract(resellerId: string, id: string, scope: RequestScope): Promise<ResponseResellerContractDto> {
    const resellersService = await this._loadResellersService();
    await resellersService.getReseller(resellerId, scope);
    return this._toResponse(await this._getOrThrow(resellerId, id), scope);
  }

  /**
   * Retrieves the contract in force of a reseller.
   * @param resellerId the identifier of the reseller.
   * @param scope the request scope.
   * @returns the contract in force.
   * @throws BusinessException if the reseller has no contract in force.
   */
  async getContractInForce(resellerId: string, scope: RequestScope): Promise<ResponseResellerContractDto> {
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(resellerId, scope);
    const contract = await this._findInForce(reseller);
    if (!contract) {
      throw this._notInForce(reseller.code);
    }
    return this._toResponse(contract, scope);
  }

  /**
   * Tells whether the users of a reseller can work in Rocket, and what is left to do while they cannot. A contract in
   * force makes the reseller ACTIVE, even with a successor waiting, or SUSPENDED while an invoice blocks it with its
   * charges still unpaid; otherwise the newest signed contract makes it ACTIVATING, an ended one ENDED, and anything
   * else NO_CONTRACT. Mandates given on the contract the reseller points at count as given, since the new contract
   * inherits them (`_hasAllMandates`). The checkout links go only to the admin of the reseller, who completes the
   * activation; the unpaid charges only to that admin and to Keus, since the other reseller users need the state alone.
   * @param resellerId the identifier of the reseller.
   * @param scope the request scope.
   * @returns the access state, with the fee and the mandates of the contract being activated, or the unpaid charges.
   */
  async getAccess(resellerId: string, scope: RequestScope): Promise<ResponseResellerAccessDto> {
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(resellerId, scope);
    const canComplete = this._isOwnerOf(reseller, scope);
    const pointed = reseller.contractId ? await this._contractModel.get({ resellerId, id: reseller.contractId }) : undefined;

    if (pointed && RESELLER_IN_FORCE_STATUSES.includes(pointed.status)) {
      if (!reseller.accessSuspendedAt) {
        return plainToInstance(ResponseResellerAccessDto, { state: ResellerAccessState.Active, canComplete, mandates: [], unpaidCharges: [] });
      }

      // A block left behind by a failed automatic restore stops blocking once nothing is unpaid; `settleOverdue` clears it.
      const unpaid = await this._unpaidInvoicesOf(resellerId);
      if (unpaid.length === 0) {
        return plainToInstance(ResponseResellerAccessDto, { state: ResellerAccessState.Active, canComplete, mandates: [], unpaidCharges: [] });
      }
      const unpaidCharges = canComplete || isUnrestricted(scope) ? await this._unpaidChargesOf(unpaid, canComplete) : [];
      return plainToInstance(ResponseResellerAccessDto, { state: ResellerAccessState.Suspended, canComplete, mandates: [], unpaidCharges });
    }

    const contracts = await this._listOf(resellerId);
    const signed = contracts.find(contract => contract.status === ResellerContractStatus.Signed);
    if (!signed) {
      const ended = contracts.some(contract => contract.status === ResellerContractStatus.Ended);
      const state = ended ? ResellerAccessState.Ended : ResellerAccessState.NoContract;
      return plainToInstance(ResponseResellerAccessDto, { state, canComplete, mandates: [], unpaidCharges: [] });
    }

    const inherited = this._inheritedLinks(signed, pointed);
    const productNames = await this._productNamesOf(signed.productIds);
    const mandates = signed.productIds.map((productId, index) => {
      const own = signed.stripeAccounts?.find(link => link.accountKey === productId);
      const given = [own, inherited.find(link => link.accountKey === productId)].find(link => link?.paymentMethodId);
      return {
        productId,
        productName: productNames[index],
        ...(given && { mandateAt: given.mandateAt }),
        ...(!given && canComplete && own?.checkoutSessionUrl && {
          checkoutUrl: own.checkoutSessionUrl,
          checkoutExpiresAt: own.checkoutSessionExpiresAt,
        }),
      };
    });

    const paid = !!signed.stripeSubscriptionId;
    const fee = signed.stripePriceIds
      ? {
        amountCents: signed.fee.firstYearCents,
        paid,
        ...(!paid && canComplete && { checkoutUrl: signed.checkoutSessionUrl, checkoutExpiresAt: signed.checkoutSessionExpiresAt }),
      }
      : undefined;

    return plainToInstance(ResponseResellerAccessDto, {
      state: ResellerAccessState.Activating,
      canComplete,
      contractId: signed.id,
      contractCode: signed.code,
      ...(fee && { fee }),
      mandates,
      unpaidCharges: [],
    });
  }

  /**
   * Reads the invoices of a reseller still unpaid.
   * @param resellerId the reseller.
   * @returns the unpaid invoices.
   */
  private async _unpaidInvoicesOf(resellerId: string): Promise<Invoice[]> {
    const invoicesService = await this._loadInvoicesService();
    return (await invoicesService.getInvoicesToPayOf(resellerId)).filter(invoice => invoice.status === InvoiceStatus.Unpaid);
  }

  /**
   * Groups the unpaid invoices of a reseller into charges, one per Stripe invoice, which can bill several invoices of Rocket on
   * the same account, the oldest due first. The page to pay each on Stripe goes only to the admin of the reseller; a
   * page Stripe does not return is left out, so the list still shows what is owed.
   * @param unpaid the unpaid invoices of the reseller.
   * @param withPayUrl whether to add the page to pay each charge.
   * @returns the unpaid charges.
   */
  private async _unpaidChargesOf(unpaid: Invoice[], withPayUrl: boolean): Promise<ResellerAccessCharge[]> {
    const byCharge = new Map<string, Invoice[]>();
    for (const invoice of unpaid) {
      const chargeId = invoice.stripeInvoiceId ?? invoice.id;
      byCharge.set(chargeId, [...(byCharge.get(chargeId) ?? []), invoice]);
    }

    const charges = await Promise.all([...byCharge.values()].map(async invoices => ({
      amountCents: invoices.reduce((sum, invoice) => sum + invoice.amountCents, 0),
      dueDate: invoices[0].dueDate ?? calendarDayOf(new Date(invoices[0].issuedAt)),
      invoiceNumbers: invoices.map(invoice => invoice.number).filter((number): number is string => !!number),
      ...(withPayUrl && { payUrl: await this._payUrlOf(invoices[0]) }),
    })));
    return charges.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  /**
   * Reads the page of Stripe where a charge is paid, on the account that collects it: Keus for the fees, the product
   * for everything else. A page read in the last `PAY_URL_CACHE_MS` is reused: it does not change for an invoice.
   * @param invoice an invoice of the charge.
   * @returns the page, or undefined when the charge has no Stripe invoice or Stripe does not return it.
   */
  private async _payUrlOf(invoice: Invoice): Promise<string | undefined> {
    if (!invoice.stripeInvoiceId) {
      return undefined;
    }

    const now = Date.now();
    for (const [stripeInvoiceId, entry] of this._payUrlCache) {
      if (now - entry.readAt >= PAY_URL_CACHE_MS) {
        this._payUrlCache.delete(stripeInvoiceId);
      }
    }
    const cached = this._payUrlCache.get(invoice.stripeInvoiceId);
    if (cached) {
      return cached.url;
    }

    try {
      const stripeApiKey = invoice.stripeAccount === KEUS_FEE_PRODUCT_ID ? keusStripeAccount().apiKey : await this._stripeApiKeyOf(invoice.stripeAccount);
      const stripeService = await this._loadStripeService();
      const url = (await stripeService.getInvoice(invoice.stripeInvoiceId, stripeApiKey)).hosted_invoice_url ?? undefined;
      if (url) {
        this._payUrlCache.set(invoice.stripeInvoiceId, { readAt: now, url });
      }
      return url;
    } catch (error) {
      this._logger.warn(`Page to pay Stripe invoice ${invoice.stripeInvoiceId} not available: the charge is listed without it.`, error);
      return undefined;
    }
  }

  /**
   * Fills the RESELLER_CONTRACT template with the data of a draft, renders it to PDF and keeps it on S3.
   * The PDF is filled again at every request and overwrites the previous one. Only Keus collaborators ask for it: a
   * Keus salesperson for its own resellers.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @param scope the request scope.
   * @returns the signed URL of the PDF.
   * @throws BusinessException if the contract is not a draft, or no template is in force.
   * @throws EntityNotFoundException if the contract does not exist.
   */
  async getContractDocumentUrl(resellerId: string, id: string, scope: RequestScope): Promise<PresignedUrlResponseDto> {
    assertCollaborator(scope, 'getResellerContractDocument');
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(resellerId, scope);
    resellersService.assertAssignedSales(reseller, scope);
    const contract = await this._getOrThrow(resellerId, id);
    if (contract.status !== ResellerContractStatus.Draft) {
      throw new BusinessException(`Reseller contract ${contract.code} is not a draft.`, "RESELLER_CONTRACT_NOT_DRAFT", { code: contract.code });
    }

    const productNames = await this._productNamesOf(contract.productIds);
    const templatesService = await this._loadTemplatesService();
    const { html } = await templatesService.renderPublished(
      TemplateType.ResellerContract,
      resellerContractDocumentData(reseller, this._toResponse(contract, scope), productNames),
    );
    const renderService = await this._loadRenderService();
    const pdf = await renderService.renderPdf(html);

    const s3Key = `reseller-contract-documents/${resellerId}/${id}/contract.pdf`;
    const s3Service = await this._loadS3Service();
    await s3Service.putObject(s3Key, pdf, "application/pdf");
    this._logger.log(`Document of reseller contract ${id} stored at ${s3Key}.`);

    return s3Service.signDownloadUrl(s3Key);
  }

  /**
   * Asserts that the reseller is visible to the requester and, for a Keus salesperson, its own.
   * @param resellerId the identifier of the reseller.
   * @param scope the request scope.
   * @throws AuthorizationException when the requester may not work on the reseller.
   */
  private async _assertOwnReseller(resellerId: string, scope: RequestScope): Promise<void> {
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(resellerId, scope);
    resellersService.assertAssignedSales(reseller, scope);
  }

  /**
   * Tells whether the requester is the admin of the reseller itself, who completes the activation of its contract.
   * The admin of a parent reseller sees the reseller but does not act for it.
   * @param reseller the reseller.
   * @param scope the request scope.
   * @returns true for the owner of the reseller.
   */
  private _isOwnerOf(reseller: Pick<ResellerRef, 'code'>, scope: RequestScope): boolean {
    return scope.roles.includes(UserRole.ResellerOwner) && scope.resellerCode === reseller.code;
  }

  /**
   * Asserts that the requester can open the checkouts of a contract: the admin of the reseller, or Keus.
   * @param reseller the reseller.
   * @param scope the request scope.
   * @param operation the operation, for the error.
   * @throws AuthorizationException when the requester is neither.
   */
  private _assertCanActivate(reseller: Pick<ResellerRef, 'code'>, scope: RequestScope, operation: string): void {
    if (!this._isOwnerOf(reseller, scope)) {
      assertCollaborator(scope, operation);
    }
  }

  /**
   * Retrieves the contract in force of a reseller already read, as the orders need it for the margin.
   * @param reseller the reseller.
   * @returns the contract in force.
   * @throws BusinessException if the reseller has no contract in force.
   */
  async getContractInForceOf(reseller: ResellerRef): Promise<ResponseResellerContractDto> {
    const contract = await this._findInForce(reseller);
    if (!contract) {
      throw this._notInForce(reseller.code);
    }
    return plainToInstance(ResponseResellerContractDto, contract);
  }

  /**
   * Reads the contract a reseller points at, when it is still in force.
   * @param reseller the reseller.
   * @returns the contract in force, or null when there is none.
   */
  async findContractInForceOf(reseller: Pick<ResellerRef, 'id' | 'contractId'>): Promise<ResponseResellerContractDto | null> {
    const contract = await this._findInForce(reseller);
    return contract ? plainToInstance(ResponseResellerContractDto, contract) : null;
  }

  /**
   * Reads the contract in force of each reseller, as `_findInForce` does for one: the contract each reseller points
   * at, read by key in batches of 100, in a status of `RESELLER_IN_FORCE_STATUSES`. The history of the contracts is
   * never read. The products a reseller is enabled to sell are the ones of its contract here.
   * @param resellers the resellers, already read.
   * @returns the contract in force by reseller identifier; a reseller with none is absent.
   * @throws DatabaseException if the read fails.
   */
  async getContractsInForce(resellers: Pick<ResellerRef, 'id' | 'contractId'>[]): Promise<Map<string, ResellerContract>> {
    const keys = resellers.filter(reseller => reseller.contractId).map(reseller => ({ resellerId: reseller.id, id: reseller.contractId }));

    try {
      const inForce = new Map<string, ResellerContract>();
      for (let start = 0; start < keys.length; start += 100) {
        const contracts = await this._contractModel.batchGet(keys.slice(start, start + 100));
        for (const contract of contracts) {
          if (RESELLER_IN_FORCE_STATUSES.includes(contract.status)) {
            inForce.set(contract.resellerId, contract);
          }
        }
      }

      this._logger.log(`Resellers with a contract in force: ${inForce.size} of ${resellers.length}.`);
      return inForce;
    } catch (error) {
      this._logger.error("Error reading the reseller contracts in force", error);
      throw new DatabaseException("An error occurred while retrieving the reseller contracts.", error);
    }
  }

  /**
   * Reads the mandate of a reseller on the account of a product, from the contract it points at, whatever its status:
   * a contract that has ended keeps its mandates until the last invoice is collected.
   * @param reseller the reseller.
   * @param accountKey the product whose Stripe account is charged.
   * @returns the link, or undefined when the reseller has none there.
   * @throws DatabaseException if the read fails.
   */
  async getMandateOf(reseller: Pick<ResellerRef, 'id' | 'contractId'>, accountKey: string): Promise<StripeAccountLink | undefined> {
    if (!reseller.contractId) {
      return undefined;
    }

    try {
      const contract = await this._contractModel.get({ resellerId: reseller.id, id: reseller.contractId });
      return contract?.stripeAccounts?.find(link => link.accountKey === accountKey);
    } catch (error) {
      this._logger.error(`Error reading the mandate of reseller ${reseller.id} on ${accountKey}`, error);
      throw new DatabaseException("An error occurred while retrieving the mandate of the reseller.", error);
    }
  }

  /**
   * Generates the checkout that collects the SEPA mandate of a reseller on the account of a product its contract
   * enables, or keeps the one still valid. The month's charges of that account are debited on this mandate. The
   * mandate belongs to the contract and ends with it; the contract starts once all its mandates are active. The admin
   * of the reseller opens it too, from the activation of its contract.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract, signed or in force.
   * @param accountKey the product whose Stripe account collects.
   * @param scope the request scope.
   * @returns the contract with the checkout link on the account.
   * @throws BusinessException if the contract is neither signed nor in force, does not enable the product, or already has the mandate there.
   */
  async createMandateCheckout(resellerId: string, id: string, accountKey: string, scope: RequestScope): Promise<ResponseResellerContractDto> {
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(resellerId, scope);
    this._assertCanActivate(reseller, scope, 'createResellerMandateCheckout');
    const contract = await this._getOrThrow(resellerId, id);
    if (!this._takesMandates(contract)) {
      throw new BusinessException(`Contract ${contract.code} is ${contract.status}: mandates are collected once it is signed and until it ends.`, "RESELLER_CONTRACT_NOT_SIGNED", { code: contract.code });
    }
    if (!contract.productIds.includes(accountKey)) {
      throw new BusinessException(`Contract ${contract.code} does not enable product ${accountKey}.`, "RESELLER_PRODUCT_NOT_ENABLED", { code: contract.code, accountKey });
    }
    const link = contract.stripeAccounts?.find(item => item.accountKey === accountKey);
    if (link?.paymentMethodId) {
      throw new BusinessException(`Reseller ${reseller.code} already has a mandate on the account of product ${accountKey}.`, "MANDATE_ALREADY_COLLECTED", { accountKey });
    }
    if (link?.checkoutSessionUrl && link.checkoutSessionExpiresAt && new Date(link.checkoutSessionExpiresAt) > new Date()) {
      return this._toResponse(contract, scope);
    }

    const stripeApiKey = await this._stripeApiKeyOf(accountKey);
    const stripeService = await this._loadStripeService();
    let customerId = link?.customerId;
    if (!customerId) {
      const address = reseller.legalAddress;
      const customer = await stripeService.createOrGetCustomer({
        email: reseller.email,
        name: reseller.companyName,
        ...(reseller.vatNumber && { vatNumber: /^[A-Z]{2}/.test(reseller.vatNumber) ? reseller.vatNumber : `IT${reseller.vatNumber}` }),
        ...(address && { address: { line1: address.street, city: address.city, postal_code: address.zipCode, state: address.province, country: address.country ?? 'IT' } }),
        stripeApiKey,
      });
      customerId = customer.id;
    }

    const session = await stripeService.createMandateCheckoutSession({
      customerId,
      successUrl: rocketUrl('/mandate-success'),
      cancelUrl: rocketUrl('/mandate-cancelled'),
      metadata: { purpose: RESELLER_MANDATE_CHECKOUT_PURPOSE, resellerId, contractId: id, accountKey },
      stripeApiKey,
    });

    const updated = await this._linkStripeAccount(resellerId, id, {
      accountKey,
      customerId,
      checkoutSessionUrl: session.url ?? undefined,
      checkoutSessionExpiresAt: new Date(session.expires_at * 1000).toISOString(),
    });
    return this._toResponse(updated, scope);
  }

  /**
   * Records the SEPA mandate a reseller's checkout collected: it becomes the default payment method of the customer,
   * and the contract starts if that was the last mandate it waited for. A checkout completed after the contract ended,
   * or for a product it no longer enables, records nothing and detaches the method it just collected, so a mandate
   * never outlives the contract it was given for.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract the checkout was opened on.
   * @param accountKey the product whose Stripe account collects.
   * @param setupIntentId the setup intent of the completed checkout.
   */
  async recordMandate(resellerId: string, id: string, accountKey: string, setupIntentId: string): Promise<void> {
    const contract = await this._contractModel.get({ resellerId, id });
    const link = contract?.stripeAccounts?.find(item => item.accountKey === accountKey);
    if (!contract || !link) {
      this._logger.warn(`Mandate of reseller ${resellerId} on ${accountKey} ignored: contract ${id} has no Stripe customer there.`);
      return;
    }

    const stripeApiKey = await this._stripeApiKeyOf(accountKey);
    const stripeService = await this._loadStripeService();
    const paymentMethodId = await stripeService.getSetupIntentPaymentMethod(setupIntentId, stripeApiKey);

    if (!this._takesMandates(contract) || !contract.productIds.includes(accountKey)) {
      this._logger.warn(`Contract ${id} no longer takes a mandate on ${accountKey} for reseller ${resellerId}: the mandate just collected is detached.`);
      await stripeService.detachPaymentMethod(paymentMethodId, stripeApiKey);
      return;
    }

    await stripeService.setDefaultPaymentMethod(link.customerId, paymentMethodId, stripeApiKey);
    const recorded = await this._linkStripeAccount(resellerId, id, {
      accountKey,
      customerId: link.customerId,
      paymentMethodId,
      mandateAt: new Date().toISOString(),
      checkoutSessionUrl: undefined,
      checkoutSessionExpiresAt: undefined,
    });
    await this._activateWhenReady(recorded);
  }

  /**
   * Detaches the mandates a reseller no longer needs. The contract it points at keeps a mandate only while it is in
   * force and enables the product, or while the reseller still has invoices on that product to collect, open or
   * unpaid: the charge of the 4th still debits them. Anything else is detached on Stripe and dropped from the link,
   * which keeps its Stripe customer. A failed detach is logged and left for the next call: it never stops the caller.
   * @param resellerId the identifier of the reseller.
   */
  async settleMandates(resellerId: string): Promise<void> {
    try {
      const resellersService = await this._loadResellersService();
      const reseller = await resellersService.getReseller(resellerId, SYSTEM_SCOPE);
      const contract = reseller.contractId ? await this._contractModel.get({ resellerId, id: reseller.contractId }) : undefined;
      const enabled = contract && RESELLER_IN_FORCE_STATUSES.includes(contract.status) ? contract.productIds : [];
      const stale = (contract?.stripeAccounts ?? []).filter(link => link.paymentMethodId && !enabled.includes(link.accountKey));
      if (!contract || stale.length === 0) {
        return;
      }

      const invoicesService = await this._loadInvoicesService();
      const owed = new Set((await invoicesService.getInvoicesToPayOf(resellerId)).map(invoice => invoice.stripeAccount));
      const stripeService = await this._loadStripeService();
      const released = new Set<string>();
      for (const link of stale.filter(item => !owed.has(item.accountKey))) {
        try {
          await stripeService.detachPaymentMethod(link.paymentMethodId, await this._stripeApiKeyOf(link.accountKey));
          released.add(link.accountKey);
        } catch (error) {
          this._logger.error(`Error detaching the mandate of reseller ${resellerId} on ${link.accountKey}`, error);
        }
      }
      if (released.size === 0) {
        return;
      }

      await this._editLinks(resellerId, contract.id, links => links.map(link => released.has(link.accountKey) ? { accountKey: link.accountKey, customerId: link.customerId } : link));
      this._logger.log(`Detached the mandates of reseller ${reseller.code} on ${[...released].join(", ")}.`);
    } catch (error) {
      this._logger.error(`Error settling the mandates of reseller ${resellerId}`, error);
    }
  }

  /**
   * Opens a contract with a reseller from its partner tier, as a DRAFT.
   * The fee of each year and the margins come from the tier, unless the request carries
   * its own; a negotiated fee gets yearly prices of its own on Stripe. With a contract
   * in force the new one starts at its renewal, so a change of tier never overlaps two
   * paid years and asks for no refund; without one it starts at the requested date, or
   * now. The fee restarts from the first year of the new tier, because the years
   * count from the start of the new contract.
   * @param resellerId the identifier of the reseller.
   * @param contractDto the tier, the products and the terms negotiated apart from it.
   * @param scope the request scope.
   * @returns the contract created.
   * @throws BusinessException if the tier has no configuration or another contract is still waiting to start.
   * @throws EntityNotFoundException if a product does not exist.
   */
  async createContract(resellerId: string, contractDto: CreateResellerContractDto, scope: RequestScope): Promise<ResponseResellerContractDto> {
    assertCollaborator(scope, 'createResellerContract');
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(resellerId, scope);
    resellersService.assertAssignedSales(reseller, scope);
    const config = await resellersService.getTierConfig(contractDto.tier);
    const productIds = [...new Set(contractDto.productIds)];
    await this._productNamesOf(productIds);

    const contracts = await this._listOf(resellerId);
    const now = new Date();
    const pending = contracts.find(contract =>
      contract.status === ResellerContractStatus.Draft
      || contract.status === ResellerContractStatus.Signed
      || (contract.status === ResellerContractStatus.Active && new Date(contract.validityDate) > now));
    if (pending) {
      throw new BusinessException(
        `Reseller ${reseller.code} already has contract ${pending.code} waiting to start: complete or delete it first.`,
        "RESELLER_CONTRACT_PENDING",
        { contractId: pending.id }
      );
    }

    const inForce = contracts.find(contract => contract.id === reseller.contractId && RESELLER_IN_FORCE_STATUSES.includes(contract.status));
    const validityDate = inForce
      ? calculateRenewalDate(inForce.validityDate, inForce.validityYears).toISOString()
      : contractDto.validityDate ?? now.toISOString();

    const fee = contractDto.fee
      ? { ...contractDto.fee }
      : { firstYearCents: config.firstYearFeeCents, secondYearCents: config.secondYearFeeCents, ongoingCents: config.ongoingFeeCents };
    const stripePriceIds = await resellersService.feePricesFor(contractDto.tier, fee);

    const newContract: ResellerContract = {
      resellerId,
      id: uuidv4(),
      code: `${reseller.code}-${String(contracts.length + 1).padStart(3, '0')}`,
      resellerCode: reseller.code,
      resellerName: reseller.companyName,
      resellerEmail: reseller.email,
      tier: contractDto.tier,
      productIds,
      fee,
      ...(stripePriceIds && { stripePriceIds }),
      margin: contractDto.margin
        ? { ...contractDto.margin }
        : {
          activationPercent: config.activationDiscountPercent,
          recurringPercent: config.subscriptionDiscountPercent,
          customizationPercent: config.customizationDiscountPercent,
        },
      status: ResellerContractStatus.Draft,
      validityDate,
      validityYears: 1,
    };

    try {
      this._logger.log(`Opening a ${contractDto.tier} contract for reseller ${reseller.code}, starting ${validityDate}`);
      // Stripped of the class identity the validation pipe gives the nested objects.
      const created = await this._contractModel.create(JSON.parse(JSON.stringify(newContract)) as ResellerContract);
      return this._toResponse(created, scope);
    } catch (error) {
      this._logger.error(`Error creating a contract for reseller ${resellerId}`, error);
      throw new DatabaseException(`An error occurred while creating a contract for reseller ${resellerId}.`, error);
    }
  }

  /**
   * Updates a reseller contract: a status change, or the terms of a DRAFT. The signature comes with its signed
   * agreement, as an order is accepted with its signed offer.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @param contractDto the change to apply.
   * @param scope the request scope.
   * @returns the updated contract.
   * @throws ValidationException if a status change comes with other fields, the signed agreement comes without the
   * signature, or the terms change past DRAFT.
   * @throws EntityNotFoundException if a product does not exist.
   */
  async updateContract(resellerId: string, id: string, contractDto: UpdateResellerContractDto, scope: RequestScope): Promise<ResponseResellerContractDto> {
    assertCollaborator(scope, 'updateResellerContract');
    await this._assertOwnReseller(resellerId, scope);
    const contract = await this._getOrThrow(resellerId, id);

    const { status, signedContractS3Key, ...terms } = contractDto;
    if (status && status !== contract.status) {
      if (Object.keys(terms).length > 0 || (signedContractS3Key && status !== ResellerContractStatus.Signed)) {
        throw new ValidationException('Cannot combine a status change with field updates in the same request.', []);
      }
      return this._toResponse(await this._manageStatusChange(contract, status, signedContractS3Key), scope);
    }
    if (signedContractS3Key) {
      throw new ValidationException('The signed agreement comes with the signature of the contract.', []);
    }

    if (contract.status !== ResellerContractStatus.Draft) {
      throw new ValidationException('The terms of a reseller contract can only be changed while it is a DRAFT: open a new contract instead.', []);
    }
    if (terms.validityDate && (await this._succeedsAnother(contract))) {
      throw new ValidationException('A contract that succeeds another starts at its renewal: its start date cannot be changed.', []);
    }

    const productIds = terms.productIds ? [...new Set(terms.productIds)] : undefined;
    if (productIds) {
      await this._productNamesOf(productIds);
    }

    try {
      const fee = terms.fee && !this._sameFee(terms.fee, contract.fee) ? { ...terms.fee } : undefined;
      const resellersService = fee ? await this._loadResellersService() : undefined;
      const stripePriceIds = fee && resellersService ? await resellersService.feePricesFor(contract.tier, fee) : undefined;

      this._logger.log(`Updating reseller contract ${id} of reseller ${resellerId}`);
      const updated = await this._contractModel.update({ resellerId, id }, {
        $SET: {
          ...(productIds && { productIds }),
          ...(terms.margin && { margin: { ...terms.margin } }),
          ...(fee && { fee }),
          ...(stripePriceIds && { stripePriceIds }),
          ...(terms.validityDate && { validityDate: terms.validityDate }),
        },
        // A fee brought to zero has nothing to charge, so it keeps no price.
        ...(fee && !stripePriceIds && { $REMOVE: ["stripePriceIds"] }),
      }, { return: "item", condition: new Condition().where("status").eq(ResellerContractStatus.Draft) });
      return this._toResponse(updated, scope);
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      if (isConditionalCheckFailed(error)) {
        throw new ValidationException('The contract left the DRAFT status while it was being edited: reload it.', []);
      }
      this._logger.error(`Error updating reseller contract ${id} of reseller ${resellerId}`, error);
      throw new DatabaseException(`An error occurred while updating reseller contract ${id}.`, error);
    }
  }

  /**
   * Deletes a DRAFT reseller contract.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @param scope the request scope.
   * @throws BusinessException if the contract is past DRAFT: it ends, it is not deleted.
   */
  async deleteContract(resellerId: string, id: string, scope: RequestScope): Promise<void> {
    assertCollaborator(scope, 'deleteResellerContract');
    await this._assertOwnReseller(resellerId, scope);

    const contract = await this._getOrThrow(resellerId, id);
    if (contract.status !== ResellerContractStatus.Draft) {
      throw new BusinessException(
        `Contract ${contract.code} is ${contract.status}: only a DRAFT can be deleted.`,
        "RESELLER_CONTRACT_NOT_DRAFT",
        { contractId: id }
      );
    }

    try {
      await this._contractModel.delete({ resellerId, id });
      this._logger.log(`Reseller contract ${id} of reseller ${resellerId} deleted.`);
    } catch (error) {
      this._logger.error(`Error deleting reseller contract ${id} of reseller ${resellerId}`, error);
      throw new DatabaseException(`An error occurred while deleting reseller contract ${id}.`, error);
    }
  }

  /**
   * Refreshes the expired Stripe checkout session of a SIGNED contract, for Keus or the admin of the reseller.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @param scope the request scope.
   * @returns the contract with the new checkout session.
   * @throws ValidationException if the contract is not SIGNED or its session is still valid.
   * @throws BusinessException if the contract has no fee, or its fee is paid already.
   */
  async refreshCheckoutSession(resellerId: string, id: string, scope: RequestScope): Promise<ResponseResellerContractDto> {
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(resellerId, scope);
    this._assertCanActivate(reseller, scope, 'refreshResellerCheckout');
    const contract = await this._getOrThrow(resellerId, id);
    if (contract.status !== ResellerContractStatus.Signed) {
      throw new ValidationException('Checkout session can only be refreshed for contracts in SIGNED status.', []);
    }
    if (!contract.stripePriceIds) {
      throw new BusinessException(`Contract ${contract.code} has no fee to pay.`, "RESELLER_FEE_NONE", { code: contract.code });
    }
    if (contract.stripeSubscriptionId) {
      throw new BusinessException(`The fee of contract ${contract.code} is paid already.`, "RESELLER_FEE_PAID", { code: contract.code });
    }
    if (contract.checkoutSessionExpiresAt && new Date(contract.checkoutSessionExpiresAt) > new Date()) {
      throw new ValidationException('Checkout session has not expired yet.', []);
    }

    return this._toResponse(await this._openCheckout(contract), scope);
  }

  /**
   * Records the Stripe subscription created by the first payment of a contract.
   * Called by the Stripe webhook.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @param subscriptionId the Stripe subscription.
   */
  async recordSubscription(resellerId: string, id: string, subscriptionId: string): Promise<void> {
    await this._contractModel.update({ resellerId, id }, { stripeSubscriptionId: subscriptionId });
    this._logger.log(`Assigned subscription ${subscriptionId} to reseller contract ${id}`);
  }

  /**
   * Renews a contract for another year. Called by the renewal schedule; Stripe renews the subscription on its own.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @param validityYears the years of validity after the renewal.
   */
  async renewContract(resellerId: string, id: string, validityYears: number): Promise<void> {
    const contract = await this._getOrThrow(resellerId, id);
    if (contract.status !== ResellerContractStatus.Active) {
      this._logger.log(`Reseller contract ${id} is ${contract.status}: renewal skipped.`);
      return;
    }
    const updated = await this._contractModel.update({ resellerId, id }, { validityYears });
    await this._scheduleRenewal(updated);
    this._logger.log(`Reseller contract ${id} renewed: year ${validityYears}.`);
  }

  /**
   * Moves the subscription of a contract onto the price of the year after the one an invoice
   * has just billed, so that the next yearly invoice charges the fee of that year. Called by
   * the Stripe webhook when an invoice of the fee is paid; a price already in place is left alone.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @param periodStart the start of the period the paid invoice bills (Unix seconds).
   */
  async prepareNextYearPrice(resellerId: string, id: string, periodStart: number): Promise<void> {
    const contract = await this._getOrThrow(resellerId, id);
    if (!contract.stripeSubscriptionId || !contract.stripePriceIds) {
      return;
    }
    const billedYear = Math.round((periodStart * 1000 - new Date(contract.validityDate).getTime()) / ONE_YEAR_MS) + 1;
    const nextPrice = this._priceOfYear(contract.stripePriceIds, billedYear + 1);

    const account = keusStripeAccount();
    const stripeService = await this._loadStripeService();
    const subscription = await stripeService.getSubscription(contract.stripeSubscriptionId, account.apiKey);
    const item = subscription.items.data[0];
    const currentPrice = typeof item?.price === 'string' ? item.price : item?.price.id;
    if (currentPrice !== nextPrice) {
      await stripeService.changeSubscriptionPrice({ subscriptionId: contract.stripeSubscriptionId, priceId: nextPrice, stripeApiKey: account.apiKey });
      this._logger.log(`Reseller contract ${id} billed year ${billedYear}: the next invoice charges the fee of year ${billedYear + 1}.`);
    }
  }

  /**
   * Counts the fees Keus expects in a period from the contracts of the resellers in force, before an invoice records
   * them: one per anniversary of `validityDate`, from today on, at the amount of its year (first, second, then the
   * ongoing one) with the VAT of the Keus account. A contract ending at its renewal stops before it; a fee of zero
   * (Silver) and a contract with no subscription have nothing to count. With a reseller, only its contracts are read,
   * by their partition key.
   * @param from the start of the period (ISO string).
   * @param to the end of the period (ISO string).
   * @param resellerId the only reseller to count, every reseller when absent.
   * @returns the expected fees, unsorted, the ones already invoiced included: the caller drops them.
   * @throws AppException if the tax rate of the Keus account is not configured.
   * @throws DatabaseException if the read fails.
   */
  async getExpectedFees(from: string, to: string, resellerId?: string): Promise<ExpectedCharge[]> {
    let contracts: ResellerContract[];
    try {
      contracts = resellerId
        ? await this._contractModel.query("resellerId").eq(resellerId).where("status").in(RESELLER_IN_FORCE_STATUSES).all().exec()
        // No index holds the contracts in force of every reseller, and they are a few: scan.
        : await this._contractModel.scan("status").in(RESELLER_IN_FORCE_STATUSES).all().exec();
    } catch (error) {
      this._logger.error(`Error reading the reseller contracts in force${resellerId ? ` of reseller ${resellerId}` : ""}`, error);
      throw new DatabaseException("An error occurred while retrieving the reseller contracts.", error);
    }

    const billed = contracts.filter(contract => contract.stripeSubscriptionId);
    if (!billed.length) {
      return [];
    }

    const vatRatePercent = await this._keusVatRate();
    const today = todayInItaly();
    return billed.flatMap(contract => {
      const ending = contract.status === ResellerContractStatus.EndedAtRenewal;
      // The fee of the renewal a contract ends at is not charged.
      const ruleEnd = ending
        ? new Date(calculateRenewalDate(contract.validityDate, contract.validityYears).getTime() - 1).toISOString()
        : undefined;

      const rule = { ruleStart: contract.validityDate, cadence: ChargeCadence.Annual, ...(ruleEnd && { ruleEnd }) };
      return occurrencesBetween(rule, from < today ? today : from, to).flatMap(periodStart => {
        const year = Math.round((new Date(periodStart).getTime() - new Date(contract.validityDate).getTime()) / ONE_YEAR_MS) + 1;
        const taxableCents = this._feeOfYear(contract.fee, year);
        return taxableCents > 0 ? [{
          resellerContractId: contract.id,
          contractCode: contract.code,
          channel: SalesChannel.Reseller,
          billedPartyType: BilledPartyType.Reseller,
          billedPartyId: contract.resellerId,
          billedPartyName: contract.resellerName,
          periodStart,
          periodMonths: 12,
          dueDate: periodStart,
          description: `Canone del rivenditore, anno ${year}`,
          ...invoiceAmounts([{ amountCents: taxableCents }], vatRatePercent),
        }] : [];
      });
    });
  }

  /**
   * Reads the VAT rate of the Keus account, the one Stripe applies to the fees.
   * @returns the VAT rate, in percent.
   * @throws AppException if the Keus account or its tax rate is not configured: the fees would leave the VAT out.
   */
  private async _keusVatRate(): Promise<number> {
    const account = keusStripeAccount();
    if (!account.taxRateId) {
      throw new AppException("No Stripe tax rate configured in KEUS_STRIPE_TAX_RATE_ID: the expected fees cannot carry the VAT.", 500);
    }

    const stripeService = await this._loadStripeService();
    return stripeService.getTaxRatePercent(account.taxRateId, account.apiKey);
  }

  /**
   * Picks the fee of a year of a contract: the first, the second, then the ongoing one.
   * @param fee the fees of the contract, in cents.
   * @param year the year, from 1.
   * @returns the fee of that year, in cents.
   */
  private _feeOfYear(fee: ResellerContract["fee"], year: number): number {
    return year <= 1 ? fee.firstYearCents : year === 2 ? fee.secondYearCents : fee.ongoingCents;
  }

  /**
   * Validates a status change and runs its side effects.
   * @param contract the contract to move.
   * @param newStatus the target status.
   * @param signedContractS3Key the signed agreement, for the signature.
   * @returns the updated contract.
   * @throws ValidationException if the transition is not allowed.
   */
  private async _manageStatusChange(contract: ResellerContract, newStatus: ResellerContractStatus, signedContractS3Key?: string): Promise<ResellerContract> {
    if (!VALID_TRANSITIONS[contract.status].includes(newStatus)) {
      throw new ValidationException(`Invalid status transition from ${contract.status} to ${newStatus}.`, []);
    }

    switch (newStatus) {
      case ResellerContractStatus.Signed:
        return this._handleSigned(contract, signedContractS3Key);
      case ResellerContractStatus.Active:
        return contract.status === ResellerContractStatus.EndedAtRenewal
          ? this._handleReactivation(contract)
          : this._handleActivation(contract);
      case ResellerContractStatus.EndedAtRenewal:
        return this._handleEndedAtRenewal(contract);
      default:
        return this._handleEnded(contract);
    }
  }

  /**
   * Signs a contract with its framework agreement, uploaded under the prefix of the contract. A fee goes through the Stripe checkout on the account
   * of Keus; a fee of zero (Silver) has nothing to charge. Either way the contract waits for the SEPA mandates of its
   * products, and starts only once all are active (`activateIfReady`): signing alone starts it when the mandates are
   * already there, inherited from the contract in force.
   * @param contract the contract to sign.
   * @param signedContractS3Key the S3 key of the signed agreement.
   * @returns the signed, or already active, contract.
   * @throws ValidationException if the signed agreement is missing or outside the prefix of the contract.
   */
  private async _handleSigned(contract: ResellerContract, signedContractS3Key?: string): Promise<ResellerContract> {
    const prefix = `resellers/${contract.resellerId}/contracts/${contract.id}/`;
    if (!signedContractS3Key?.startsWith(prefix)) {
      throw new ValidationException(`The signature needs the signed framework agreement, uploaded under ${prefix}.`, []);
    }
    if (contract.stripePriceIds) {
      return this._openCheckout(contract, signedContractS3Key);
    }

    const signed = await this._contractModel.update(
      { resellerId: contract.resellerId, id: contract.id },
      { status: ResellerContractStatus.Signed, signedContractS3Key },
    );
    this._logger.log(`Reseller contract ${contract.id} has a zero fee and is signed: it starts when its mandates are active.`);
    return await this._activateWhenReady(signed);
  }

  /**
   * Starts a signed contract once everything it waits for is there: the first payment of its fee, when it has one,
   * and the SEPA mandate of each of its products. Called when the fee is paid and when a mandate is recorded.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   */
  async activateIfReady(resellerId: string, id: string): Promise<void> {
    const contract = await this._contractModel.get({ resellerId, id });
    if (contract) {
      await this._activateWhenReady(contract);
    }
  }

  /**
   * Activates a contract that is signed and has its fee settled and all its mandates, and leaves any other as it is.
   * Without Stripe there are no mandates to wait for: a signed contract starts at once.
   * @param contract the contract to look at.
   * @returns the active contract, or the contract unchanged.
   */
  private async _activateWhenReady(contract: ResellerContract): Promise<ResellerContract> {
    if (contract.status !== ResellerContractStatus.Signed) {
      return contract;
    }

    const feeSettled = !contract.stripePriceIds || !!contract.stripeSubscriptionId;
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (integrationsEnabled() && (!feeSettled || !(await this._hasAllMandates(contract)))) {
      this._logger.log(`Reseller contract ${contract.id} is signed and waits for ${feeSettled ? 'its mandates' : 'the payment of its fee'}.`);
      return contract;
    }

    return this._handleActivation(contract);
  }

  /**
   * Tells whether every product of a contract has an active mandate: its own, or the one the reseller already gave on
   * the contract in force, which the contract inherits when it takes over.
   * @param contract the contract to check.
   * @returns true when no product is left without a mandate.
   */
  private async _hasAllMandates(contract: ResellerContract): Promise<boolean> {
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(contract.resellerId, SYSTEM_SCOPE);
    const pointed = reseller.contractId ? await this._contractModel.get({ resellerId: contract.resellerId, id: reseller.contractId }) : undefined;
    const inherited = this._inheritedLinks(contract, pointed);

    const collected = new Set([...(contract.stripeAccounts ?? []), ...inherited].filter(link => link.paymentMethodId).map(link => link.accountKey));
    return contract.productIds.every(productId => collected.has(productId));
  }

  /**
   * Lists the mandate links a contract inherits from the contract its reseller points at, which hands them over when
   * the new one takes over: none when the reseller points at the contract itself, or at nothing.
   * @param contract the contract that takes over.
   * @param pointed the contract the reseller points at, if any.
   * @returns the links of the pointed contract.
   */
  private _inheritedLinks(contract: ResellerContract, pointed: ResellerContract | undefined): StripeAccountLink[] {
    return pointed && pointed.id !== contract.id ? pointed.stripeAccounts ?? [] : [];
  }

  /**
   * Opens the Stripe checkout of the fee of a contract on the account of Keus: the SEPA mandate of the fee now,
   * the first charge, at the fee of the first year, at the start date.
   * @param contract the contract to check out.
   * @param signedContractS3Key the signed agreement, when the checkout opens with the signature.
   * @returns the SIGNED contract with its checkout session.
   */
  private async _openCheckout(contract: ResellerContract, signedContractS3Key?: string): Promise<ResellerContract> {
    const account = keusStripeAccount();
    const stripeService = await this._loadStripeService();
    const customerId = contract.stripeCustomerId ?? (await stripeService.createOrGetCustomer({
      email: contract.resellerEmail,
      name: contract.resellerName,
      stripeApiKey: account.apiKey,
    })).id;

    const session = await stripeService.createCheckoutSession({
      customerId,
      priceId: this._priceOfYear(contract.stripePriceIds, 1),
      quantity: 1,
      contractId: contract.id,
      productId: KEUS_FEE_PRODUCT_ID,
      resellerId: contract.resellerId,
      successUrl: rocketUrl('/payment-success'),
      cancelUrl: rocketUrl('/payment-cancelled'),
      trialEnd: deferredChargeOf(contract.validityDate),
      stripeApiKey: account.apiKey,
      stripeTaxRateId: account.taxRateId,
    });

    const signed = await this._contractModel.update(
      { resellerId: contract.resellerId, id: contract.id },
      {
        status: ResellerContractStatus.Signed,
        ...(signedContractS3Key && { signedContractS3Key }),
        stripeCustomerId: customerId,
        checkoutSessionUrl: session.url ?? undefined,
        checkoutSessionExpiresAt: new Date(session.expires_at * 1000).toISOString(),
      },
    );
    this._logger.log(`Reseller contract ${contract.id} signed. Checkout session created: ${session.id}`);
    return signed;
  }

  /**
   * Starts a contract: schedules its renewal and moves the reseller onto it, now or at its start date.
   * @param contract the contract to activate.
   * @returns the active contract.
   */
  private async _handleActivation(contract: ResellerContract): Promise<ResellerContract> {
    const active = await this._contractModel.update(
      { resellerId: contract.resellerId, id: contract.id },
      { status: ResellerContractStatus.Active },
    );
    await this._scheduleRenewal(active);
    await this._onActivated(active);
    this._logger.log(`Reseller contract ${contract.id} activated.`);
    return active;
  }

  /**
   * Takes a contract back from ENDED_AT_RENEWAL: cancels its end and schedules its renewal again.
   * @param contract the contract to reactivate.
   * @returns the active contract.
   */
  private async _handleReactivation(contract: ResellerContract): Promise<ResellerContract> {
    await this._contractSchedulerService.cancelEnd(contract.id);
    const active = await this._contractModel.update(
      { resellerId: contract.resellerId, id: contract.id },
      { status: ResellerContractStatus.Active },
    );
    await this._scheduleRenewal(active);
    this._logger.log(`Reseller contract ${contract.id} reactivated: it renews again.`);
    return active;
  }

  /**
   * Sets a contract to end at its renewal: the fee stays billed until then, the renewal is cancelled.
   * @param contract the contract to end at renewal.
   * @returns the updated contract.
   */
  private async _handleEndedAtRenewal(contract: ResellerContract): Promise<ResellerContract> {
    await this._contractSchedulerService.cancelRenewal(contract.id);
    await this._contractSchedulerService.scheduleEnd({
      contractId: contract.id,
      resellerId: contract.resellerId,
      endDate: calculateRenewalDate(contract.validityDate, contract.validityYears),
    });

    const ending = await this._contractModel.update(
      { resellerId: contract.resellerId, id: contract.id },
      { status: ResellerContractStatus.EndedAtRenewal },
    );
    this._logger.log(`Reseller contract ${contract.id} set to end at its renewal.`);

    return ending;
  }

  /**
   * Ends a contract: closes the Stripe subscription and every pending schedule, then moves
   * the reseller onto the successor, if there is one. The invoices already issued stay due.
   * @param contract the contract to end.
   * @returns the ended contract.
   */
  private async _handleEnded(contract: ResellerContract): Promise<ResellerContract> {
    if (contract.stripeSubscriptionId) {
      const stripeService = await this._loadStripeService();
      await stripeService.cancelSubscription(contract.stripeSubscriptionId, keusStripeAccount().apiKey);
    }
    await this._contractSchedulerService.cancelRenewal(contract.id);
    await this._contractSchedulerService.cancelEnd(contract.id);

    const ended = await this._contractModel.update(
      { resellerId: contract.resellerId, id: contract.id },
      { status: ResellerContractStatus.Ended, endDate: new Date().toISOString() },
    );
    await this._onEnded(ended);
    this._logger.log(`Reseller contract ${contract.id} ended.`);
    return ended;
  }

  /**
   * Keeps the contract in force of a reseller in step with an activation.
   * A contract that has already started becomes the one in force at once. One that
   * starts later succeeds the contract in force: that one is set to end at its
   * renewal, and the reseller moves to the successor when it ends.
   * @param contract the contract just activated.
   */
  private async _onActivated(contract: ResellerContract): Promise<void> {
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(contract.resellerId, SYSTEM_SCOPE);
    const current = reseller.contractId && reseller.contractId !== contract.id
      ? await this._contractModel.get({ resellerId: contract.resellerId, id: reseller.contractId })
      : undefined;

    if (current && RESELLER_IN_FORCE_STATUSES.includes(current.status) && new Date(contract.validityDate) > new Date()) {
      if (current.status === ResellerContractStatus.Active) {
        await this._manageStatusChange(current, ResellerContractStatus.EndedAtRenewal);
      }
      this._logger.log(`Reseller contract ${contract.id} succeeds ${current.id} at its renewal.`);
      return;
    }
    await resellersService.setContractInForce(contract.resellerId, contract);
    if (reseller.contractId && reseller.contractId !== contract.id) {
      await this._handOverMandates(contract.resellerId, reseller.contractId, contract.id);
    }
  }

  /**
   * Moves a reseller to the successor of its contract in force, once that contract has ended.
   * Without a successor the reseller is left with no contract in force, and no enabled product, until a new one is
   * activated; its mandates are detached as soon as nothing is left to collect on them.
   * @param contract the contract just ended.
   */
  private async _onEnded(contract: ResellerContract): Promise<void> {
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(contract.resellerId, SYSTEM_SCOPE);
    if (reseller.contractId !== contract.id) {
      return;
    }

    const successor = (await this._listOf(contract.resellerId))
      .find(candidate => candidate.id !== contract.id && RESELLER_IN_FORCE_STATUSES.includes(candidate.status));
    if (successor) {
      await resellersService.setContractInForce(contract.resellerId, successor);
      await this._handOverMandates(contract.resellerId, contract.id, successor.id);
    } else {
      await this.settleMandates(contract.resellerId);
      this._logger.warn(`Reseller ${reseller.code} has no contract in force after the end of ${contract.id}.`);
    }
  }

  /**
   * Tells whether a contract takes mandates: from its signing until it ends.
   * @param contract the contract.
   * @returns true when it is signed or in force.
   */
  private _takesMandates(contract: ResellerContract): boolean {
    return contract.status === ResellerContractStatus.Signed || RESELLER_IN_FORCE_STATUSES.includes(contract.status);
  }

  /**
   * Hands the mandates of a contract to the one that takes over from it, and detaches the ones the successor does not
   * enable and nothing is owed on. Mandates of products the successor does not enable pass anyway, because invoices
   * already issued on them are still charged on them.
   * @param resellerId the identifier of the reseller.
   * @param fromId the identifier of the contract handing over.
   * @param toId the identifier of the contract taking over, already the one the reseller points at.
   */
  private async _handOverMandates(resellerId: string, fromId: string, toId: string): Promise<void> {
    const links = (await this._contractModel.get({ resellerId, id: fromId }))?.stripeAccounts ?? [];
    if (links.length === 0) {
      return;
    }

    const moved = (item: StripeAccountLink): boolean => links.some(link => link.accountKey === item.accountKey);
    await this._editLinks(resellerId, toId, current => [...current.filter(item => !moved(item)), ...links]);
    await this._editLinks(resellerId, fromId, current => current.filter(item => !moved(item)));
    this._logger.log(`Mandates of contract ${fromId} handed over to contract ${toId}.`);

    await this.settleMandates(resellerId);
  }

  /**
   * Records the customer, the pending checkout or the mandate of a contract on one Stripe account.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract holding the links.
   * @param link the link to record; fields left out keep their value, fields set to undefined are removed.
   * @returns the updated contract.
   */
  private async _linkStripeAccount(resellerId: string, id: string, link: StripeAccountLink): Promise<ResellerContract> {
    const updated = await this._editLinks(resellerId, id, links => {
      const current = links.find(item => item.accountKey === link.accountKey);
      const merged = Object.fromEntries(Object.entries({ ...current, ...link }).filter(([, value]) => value !== undefined)) as unknown as StripeAccountLink;
      return [...links.filter(item => item.accountKey !== link.accountKey), merged];
    });
    this._logger.log(`Reseller contract ${id} linked to Stripe account ${link.accountKey}${link.paymentMethodId ? ' with its mandate' : ''}.`);

    return updated;
  }

  /**
   * Rewrites the Stripe links of a contract from the ones it holds now. The write holds only if nobody wrote the links
   * since they were read (`mandatesVersion`): a webhook of another product, a checkout, a handover or a settlement
   * meanwhile makes it read again and edit again, so no link, and no payment method just collected, is lost.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @param edit builds the new links from the current ones.
   * @returns the updated contract.
   * @throws EntityNotFoundException if the contract does not exist.
   * @throws AppException if the contract keeps changing and the write does not hold after `LINKS_WRITE_ATTEMPTS`.
   */
  private async _editLinks(resellerId: string, id: string, edit: (links: StripeAccountLink[]) => StripeAccountLink[]): Promise<ResellerContract> {
    for (let attempt = 1; attempt <= LINKS_WRITE_ATTEMPTS; attempt++) {
      const contract = await this._getOrThrow(resellerId, id);
      const version = contract.mandatesVersion;

      try {
        return await this._contractModel.update(
          { resellerId, id },
          { $SET: { stripeAccounts: edit(contract.stripeAccounts ?? []), mandatesVersion: (version ?? 0) + 1 } },
          {
            condition: version === undefined ? new Condition().where("mandatesVersion").not().exists() : new Condition().where("mandatesVersion").eq(version),
            return: "item",
          },
        );
      } catch (error) {
        if (!isConditionalCheckFailed(error)) {
          throw error;
        }
        this._logger.warn(`The links of reseller contract ${id} changed while they were written: attempt ${attempt} of ${LINKS_WRITE_ATTEMPTS}.`);
      }
    }

    throw new AppException(`The mandates of reseller contract ${id} changed too often to be written: try again.`, 409);
  }

  /**
   * Reads the secret API key of the Stripe account of a product.
   * @param productId the product.
   * @returns the API key.
   * @throws BusinessException if the product has no Stripe account.
   */
  private async _stripeApiKeyOf(productId: string): Promise<string> {
    const productsService = await this._loadProductsService();
    const product = await productsService.getProduct(productId);
    if (!product.stripeApiKey) {
      throw new BusinessException(`Product ${productId} has no Stripe account configured.`, 'PRODUCT_WITHOUT_STRIPE');
    }
    return product.stripeApiKey;
  }

  /**
   * Tells whether a contract starts at the renewal of the contract in force of its reseller.
   * @param contract the contract to check.
   * @returns true when the reseller has another contract in force.
   */
  private async _succeedsAnother(contract: ResellerContract): Promise<boolean> {
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getReseller(contract.resellerId, SYSTEM_SCOPE);
    return !!reseller.contractId && reseller.contractId !== contract.id && !!(await this._findInForce(reseller));
  }

  /**
   * Schedules the next annual renewal of a contract.
   * @param contract the active contract.
   */
  private async _scheduleRenewal(contract: ResellerContract): Promise<void> {
    await this._contractSchedulerService.scheduleRenewal({
      contractId: contract.id,
      resellerId: contract.resellerId,
      renewalDate: calculateRenewalDate(contract.validityDate, contract.validityYears),
      validityYears: contract.validityYears + 1,
    });
  }

  /**
   * Tells whether two fees charge the same amounts every year.
   * @param a the first fee.
   * @param b the second fee.
   * @returns true when the three amounts match.
   */
  private _sameFee(a: ResellerContract['fee'], b: ResellerContract['fee']): boolean {
    return a.firstYearCents === b.firstYearCents && a.secondYearCents === b.secondYearCents && a.ongoingCents === b.ongoingCents;
  }

  /**
   * Picks the yearly price of a year of contract: the first, the second, or the one from the third on.
   * @param prices the yearly prices of the fee.
   * @param year the year of contract, from 1.
   * @returns the price of that year.
   */
  private _priceOfYear(prices: FeePriceIds, year: number): string {
    return year <= 1 ? prices.firstYear : year === 2 ? prices.secondYear : prices.ongoing;
  }

  /**
   * Lists the contracts of a reseller, the newest start date first.
   * @param resellerId the identifier of the reseller.
   * @returns the contracts.
   */
  private async _listOf(resellerId: string): Promise<ResellerContract[]> {
    try {
      const contracts = await this._contractModel.query("resellerId").eq(resellerId).exec();
      return this._newestFirst([...contracts]);
    } catch (error) {
      this._logger.error(`Error listing the contracts of reseller ${resellerId}`, error);
      throw new DatabaseException(`An error occurred while listing the contracts of reseller ${resellerId}.`, error);
    }
  }

  /**
   * Reads the contract a reseller points at, when it is still in force.
   * @param reseller the reseller.
   * @returns the contract in force, or null when there is none.
   */
  private async _findInForce(reseller: Pick<ResellerRef, 'id' | 'contractId'>): Promise<ResellerContract | null> {
    if (!reseller.contractId) {
      return null;
    }
    const contract = await this._contractModel.get({ resellerId: reseller.id, id: reseller.contractId });
    return contract && RESELLER_IN_FORCE_STATUSES.includes(contract.status) ? contract : null;
  }

  /**
   * Builds the error of a reseller without a contract in force.
   * @param code the code of the reseller.
   * @returns the exception to throw.
   */
  private _notInForce(code: string): BusinessException {
    return new BusinessException(`Reseller ${code} has no contract in force.`, "RESELLER_CONTRACT_NOT_IN_FORCE", { code });
  }

  /**
   * Reads a contract, failing when it does not exist.
   * @param resellerId the identifier of the reseller.
   * @param id the identifier of the contract.
   * @returns the contract.
   * @throws EntityNotFoundException if the contract does not exist.
   */
  private async _getOrThrow(resellerId: string, id: string): Promise<ResellerContract> {
    const contract = await this._contractModel.get({ resellerId, id });
    if (!contract) {
      this._logger.warn(`Reseller contract ${id} of reseller ${resellerId} not found.`);
      throw new EntityNotFoundException("ResellerContract", id);
    }
    return contract;
  }

  /**
   * Orders contracts by start date, the newest first.
   * @param contracts the contracts.
   * @returns the same contracts, sorted.
   */
  private _newestFirst(contracts: ResellerContract[]): ResellerContract[] {
    return contracts.sort((a, b) => b.validityDate.localeCompare(a.validityDate));
  }

  /**
   * Reads the names of the products of a contract, which also checks that they all exist.
   * @param productIds the identifiers of the products.
   * @returns the names of the products, in the order given.
   * @throws EntityNotFoundException if a product does not exist.
   */
  private async _productNamesOf(productIds: string[]): Promise<string[]> {
    const productsService = await this._loadProductsService();
    const products = await Promise.all(productIds.map(productId => productsService.getProduct(productId)));
    return products.map(product => product.name);
  }

  /**
   * Shapes a contract for the requester: a reseller salesperson does not see the margin, and a reseller never sees
   * the Stripe customer and payment method of its mandates, only whether it gave them. The links to pay the fee and
   * to give a mandate go only to the admin of the reseller itself, who completes the activation.
   * @param contract the contract.
   * @param scope the request scope.
   * @returns the response DTO.
   */
  private _toResponse(contract: ResellerContract, scope: RequestScope): ResponseResellerContractDto {
    const owner = this._isOwnerOf({ code: contract.resellerCode }, scope);
    const salespersonOnly = scope.roles.includes(UserRole.ResellerSales)
      && !scope.roles.includes(UserRole.ResellerOwner)
      && !scope.roles.includes(UserRole.ResellerBackoffice);
    const response = plainToInstance(ResponseResellerContractDto, {
      ...contract,
      ...(!isUnrestricted(scope) && !owner && { checkoutSessionUrl: undefined, checkoutSessionExpiresAt: undefined }),
      // The Stripe customer and payment method are for Keus: a reseller sees which mandates it has, and since when.
      ...(!isUnrestricted(scope) && contract.stripeAccounts && {
        stripeAccounts: contract.stripeAccounts.map(({ accountKey, mandateAt, checkoutSessionUrl, checkoutSessionExpiresAt }) => ({
          accountKey,
          mandateAt,
          ...(owner && { checkoutSessionUrl, checkoutSessionExpiresAt }),
        })),
      }),
    });
    return salespersonOnly ? { ...response, margin: undefined } as ResponseResellerContractDto : response;
  }
}
