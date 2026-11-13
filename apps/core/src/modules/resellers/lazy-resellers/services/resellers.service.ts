import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { Condition } from "dynamoose";
import { InjectModel, Model } from "nestjs-dynamoose";
import { v4 as uuidv4 } from "uuid";
import { AppException, AuthorizationException, BusinessException, DatabaseException, EntityNotFoundException, ValidationException } from "../../../../errors/exception-types";
import { paginate, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { ResellersPageQueryDto } from "../../dtos/resellers-page-query.dto";
import { ResponseResellersPageDto } from "../../dtos/response-resellers-page.dto";
import { isUnrestricted, RequestScope, SYSTEM_SCOPE, UserRole } from "@rocket-be/scoping";
import { splitRemovals, toDynamooseUpdate } from "../../../../commons/persistence/removable-update.helper";
import { assertCollaborator, isKeusSalespersonOnly } from "../../../../commons/scoping/scoped-access.helper";
import { isConditionalCheckFailed } from "../../../../commons/persistence/write-errors.helper";
import type { TransactionWrite } from "../../../pending-operations/lazy-pending-operations/services/pending-operations.service";
import { EncryptionService } from "../../../../commons/encryption/encryption.service";
import { keusStripeAccount } from "../../../stripe/helpers/keus-stripe-account.helper";
import type { StripeService } from "../../../stripe/lazy-stripe/services/stripe.service";
import type { ResellerContractsService } from "../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service";
import type { CompaniesService } from "../../../companies/lazy-companies/services/companies.service";
import type { InvoicesService } from "../../../invoices/lazy-invoices/services/invoices.service";
import type { ContractNoticesService } from "../../../contracts/lazy-contracts/services/contract-notices.service";
import { MailTemplate } from "../../../mail/enums/mail-template.enum";
import { formatEuro, rocketUrl } from "../../../../commons/formatting/notice-format.helper";
import { integrationsEnabled } from "../../../../commons/integrations/integrations.helper";
import { CreateResellerDto } from "../../dtos/create-reseller.dto";
import { ResponseResellerDto } from "../../dtos/response-reseller.dto";
import { ResponseResellerTierConfigDto, UpsertResellerTierConfigDto } from "../../dtos/reseller-tier-config.dto";
import { UpdateResellerDto } from "../../dtos/update-reseller.dto";
import { ResellerStatus } from "../../enums/reseller-status.enum";
import { ResellerTier } from "../../enums/reseller-tier.enum";
import { Reseller, ResellerKey, ResellerSchema } from "../../schemas/reseller.schema";
import { FeePriceIds, ResellerTierConfig, ResellerTierConfigKey } from "../../schemas/reseller-tier-config.schema";

/** Amounts of a reseller fee in cents, by year of contract. */
type FeeAmounts = { firstYearCents: number; secondYearCents: number; ongoingCents: number };

/** Stripe product and yearly prices of a reseller fee; both absent while the fee is zero. */
type FeePrices = { stripeProductId?: string; stripePriceIds?: FeePriceIds };

/** Fields a reseller owner may change on its own reseller: contacts, legal address and fiscal data. */
const RESELLER_OWNER_EDITABLE_FIELDS: ReadonlySet<string> = new Set<keyof UpdateResellerDto>([
  "email", "phoneNumber", "pec", "legalAddress", "vatNumber", "sdi", "fiscalCode", "iban",
]);

@Injectable()
export class ResellersService {
  /** Logger instance for ResellersService. */
  private readonly _logger = new Logger(ResellersService.name);

  /** Lazy-loaded Stripe service. */
  private _stripeService: StripeService | null = null;

  /** Lazy-loaded reseller contracts service. */
  private _resellerContractsService: ResellerContractsService | null = null;

  /** Lazy-loaded companies service. */
  private _companiesService: CompaniesService | null = null;

  /** Lazy-loaded invoices service. */
  private _invoicesService: InvoicesService | null = null;

  /** Lazy-loaded contract notices service. */
  private _contractNoticesService: ContractNoticesService | null = null;

  /**
   * Constructor for ResellersService.
   * @param _resellerModel the model to manage reseller entities.
   * @param _tierConfigModel the model carrying the default terms of each commercial tier.
   * @param _encryptionService service used to encrypt/decrypt the IBAN at rest.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the Stripe, reseller contracts, companies, invoices and notices services on demand.
   */
  constructor(
    @InjectModel("Reseller")
    private readonly _resellerModel: Model<Reseller, ResellerKey>,
    @InjectModel("ResellerTierConfig")
    private readonly _tierConfigModel: Model<ResellerTierConfig, ResellerTierConfigKey>,
    private readonly _encryptionService: EncryptionService,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

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
   * Lazy loads the ResellerContractsService from its module.
   * @returns a Promise resolving to the ResellerContractsService instance.
   */
  private async _loadResellerContractsService(): Promise<ResellerContractsService> {
    if (!this._resellerContractsService) {
      const { ResellerContractsLazyModule } = await import("../../../reseller-contracts/lazy-reseller-contracts/reseller-contracts-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ResellerContractsLazyModule);
      const { ResellerContractsService } = await import("../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service");
      this._resellerContractsService = moduleRef.get<ResellerContractsService>(ResellerContractsService);
    }
    return this._resellerContractsService;
  }

  /**
   * Lazy loads the CompaniesService from its module.
   * @returns a Promise resolving to the CompaniesService instance.
   */
  private async _loadCompaniesService(): Promise<CompaniesService> {
    if (!this._companiesService) {
      const { CompaniesLazyModule } = await import("../../../companies/lazy-companies/companies-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => CompaniesLazyModule);
      const { CompaniesService } = await import("../../../companies/lazy-companies/services/companies.service");
      this._companiesService = moduleRef.get<CompaniesService>(CompaniesService);
    }
    return this._companiesService;
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
   * Lazy loads the ContractNoticesService from the contracts module.
   * @returns a Promise resolving to the ContractNoticesService instance.
   */
  private async _loadContractNoticesService(): Promise<ContractNoticesService> {
    if (!this._contractNoticesService) {
      const { ContractsLazyModule } = await import("../../../contracts/lazy-contracts/contracts-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ContractsLazyModule);
      const { ContractNoticesService } = await import("../../../contracts/lazy-contracts/services/contract-notices.service");
      this._contractNoticesService = moduleRef.get<ContractNoticesService>(ContractNoticesService);
    }
    return this._contractNoticesService;
  }

  /**
   * Retrieves the configuration of every commercial tier.
   * Three rows at most, one per tier, so the scan reads the whole table on purpose.
   * @param scope the request scope.
   * @returns the configurations, ordered as they come.
   */
  async getTierConfigs(scope: RequestScope): Promise<ResponseResellerTierConfigDto[]> {
    assertCollaborator(scope, 'getTierConfigs');
    try {
      const configs = await this._tierConfigModel.scan().exec();
      return configs.map(config => plainToInstance(ResponseResellerTierConfigDto, config));
    } catch (error) {
      this._logger.error("Error retrieving the reseller tier configurations", error);
      throw new DatabaseException("An error occurred while retrieving the reseller tier configurations.", error);
    }
  }

  /**
   * Writes the configuration of a commercial tier, creating it if absent.
   * The contracts already opened keep the terms they were given: this changes
   * what the next ones will get, not what the existing ones pay.
   * @param tier the tier to configure.
   * @param config the terms to write.
   * @param scope the request scope.
   * @returns the written configuration.
   */
  async upsertTierConfig(tier: ResellerTier, config: UpsertResellerTierConfigDto, scope: RequestScope): Promise<ResponseResellerTierConfigDto> {
    assertCollaborator(scope, 'upsertTierConfig');
    try {
      const existing = await this._tierConfigModel.get({ tier });
      const prices = await this._feePricesOf(tier, this._amountsOf(config), existing ?? undefined);

      this._logger.log(`Writing the configuration of the reseller tier: ${tier}`);
      const written = await this._tierConfigModel.update({ tier }, {
        $SET: {
          ...config,
          ...(prices.stripeProductId && { stripeProductId: prices.stripeProductId }),
          ...(prices.stripePriceIds && { stripePriceIds: prices.stripePriceIds }),
        },
        // A fee back to zero has nothing to charge: its prices are dropped, its product is kept for later.
        ...(!prices.stripePriceIds && { $REMOVE: ["stripePriceIds"] }),
      });
      return plainToInstance(ResponseResellerTierConfigDto, written);
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this._logger.error(`Error writing the configuration of the reseller tier: ${tier}`, error);
      throw new DatabaseException(`An error occurred while writing the configuration of the reseller tier: ${tier}.`, error);
    }
  }

  /**
   * Returns the yearly Stripe prices of a fee negotiated on a contract of a tier: the prices
   * of the tier when the amounts are the same, new prices on the product of the tier otherwise.
   * @param tier the tier of the contract.
   * @param amounts the amounts of the fee.
   * @returns the prices, absent when the fee is zero.
   */
  async feePricesFor(tier: ResellerTier, amounts: FeeAmounts): Promise<FeePriceIds | undefined> {
    const config = await this.getTierConfig(tier);
    return (await this._feePricesOf(tier, amounts, config)).stripePriceIds;
  }

  /**
   * Creates the yearly Stripe prices of a fee on the account of Keus, reusing those of a
   * reference whose amount is the same year by year. A fee of zero has no price at all, and no fee has one while the
   * integrations are off.
   * @param tier the tier the fee belongs to, which names its Stripe product.
   * @param amounts the amounts of the fee.
   * @param reference the configuration whose product and prices can be reused.
   * @returns the product and the prices.
   */
  private async _feePricesOf(tier: ResellerTier, amounts: FeeAmounts, reference?: ResellerTierConfig): Promise<FeePrices> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled() || (!amounts.firstYearCents && !amounts.secondYearCents && !amounts.ongoingCents)) {
      return { stripeProductId: reference?.stripeProductId };
    }

    const account = keusStripeAccount();
    const stripeService = await this._loadStripeService();
    let stripeProductId = reference?.stripeProductId;
    const referenceAmounts = reference ? this._amountsOf(reference) : undefined;
    const priceOf = async (year: keyof FeePriceIds, cents: number, referenceCents?: number): Promise<string> => {
      const reused = reference?.stripePriceIds?.[year];
      if (reused && referenceCents === cents) {
        return reused;
      }
      const created = await stripeService.createYearlyFeePrice({
        stripeProductId,
        productName: `Canone rivenditore ${tier}`,
        amountCents: cents,
        stripeApiKey: account.apiKey,
      });
      stripeProductId = created.stripeProductId;
      return created.stripePriceId;
    };

    const firstYear = await priceOf('firstYear', amounts.firstYearCents, referenceAmounts?.firstYearCents);
    const secondYear = await priceOf('secondYear', amounts.secondYearCents, referenceAmounts?.secondYearCents);
    const ongoing = await priceOf('ongoing', amounts.ongoingCents, referenceAmounts?.ongoingCents);
    return { stripeProductId, stripePriceIds: { firstYear, secondYear, ongoing } };
  }

  /**
   * Reads the fee amounts of a tier configuration.
   * @param config the configuration, stored or incoming.
   * @returns the amounts by year of contract.
   */
  private _amountsOf(config: Pick<ResellerTierConfig, 'firstYearFeeCents' | 'secondYearFeeCents' | 'ongoingFeeCents'>): FeeAmounts {
    return {
      firstYearCents: config.firstYearFeeCents,
      secondYearCents: config.secondYearFeeCents,
      ongoingCents: config.ongoingFeeCents,
    };
  }

  /**
   * Reads the configuration of a tier from the reseller_tiers table, when a contract is opened from it.
   * @param tier the commercial tier to read.
   * @returns the configuration of the tier.
   * @throws BusinessException if the tier has no configuration yet.
   */
  async getTierConfig(tier: ResellerTier): Promise<ResellerTierConfig> {
    const config = await this._tierConfigModel.get({ tier });
    if (!config) {
      throw new BusinessException(
        `The commercial tier "${tier}" has no configuration yet: fill the reseller tiers table first.`,
        "RESELLER_TIER_NOT_CONFIGURED",
        { tier }
      );
    }

    return config;
  }

  /**
   * Encrypts the IBAN of an incoming DTO before persistence.
   * The fiscal code stays in clear on purpose: it is printed on every invoice
   * and is searched for, while the IBAN alone is enough to set up a direct debit.
   * @param data the object carrying the plaintext IBAN.
   * @returns a new object with the IBAN replaced by its encrypted form.
   */
  private _encryptIban<T extends { iban?: string }>(data: T): T {
    return {
      ...data,
      ...(data.iban !== undefined && { iban: this._encryptionService.encrypt(data.iban) }),
    };
  }

  /**
   * Decrypts the IBAN of a reseller before it leaves the service.
   * Records written before the field was encrypted would throw here, so a
   * failed decryption drops the field instead of breaking the whole read.
   * @param reseller the reseller as retrieved from DynamoDB.
   * @returns a new reseller object with the IBAN in clear.
   */
  private _decryptIban(reseller: Reseller): Reseller {
    if (!reseller.iban) {
      return reseller;
    }

    try {
      return { ...reseller, iban: this._encryptionService.decrypt(reseller.iban) };
    } catch {
      this._logger.warn(`Reseller ${reseller.id} carries an IBAN that cannot be decrypted: it is omitted from the response.`);
      const { iban: _iban, ...rest } = reseller;
      return rest as Reseller;
    }
  }

  /**
   * Builds the responses of some resellers, each with the products of the contract it has in force, read in one batch:
   * the products are never stored on the reseller.
   * @param resellers the resellers as retrieved from DynamoDB.
   * @returns the response DTOs, in the same order.
   * @throws DatabaseException if the read of the contracts fails.
   */
  private async _toResponses(resellers: Reseller[]): Promise<ResponseResellerDto[]> {
    const contractsService = await this._loadResellerContractsService();
    const inForce = await contractsService.getContractsInForce(resellers);

    return resellers.map(reseller => plainToInstance(ResponseResellerDto, {
      ...this._decryptIban(reseller),
      productIds: inForce.get(reseller.id)?.productIds ?? [],
    }));
  }

  /**
   * Reads the products the contract in force of a reseller enables.
   * @param reseller the reseller, already read.
   * @returns the identifiers of the products, empty without a contract in force.
   * @throws DatabaseException if the read fails.
   */
  async getEnabledProductIds(reseller: Pick<Reseller, "id" | "contractId">): Promise<string[]> {
    const contractsService = await this._loadResellerContractsService();
    return (await contractsService.getContractsInForce([reseller])).get(reseller.id)?.productIds ?? [];
  }

  /**
   * Collects the products the contracts in force enable to a reseller and to its descendants, whose dashboards it reads.
   * @param code the code of the reseller.
   * @returns the identifiers of the products.
   * @throws DatabaseException if a read fails.
   */
  async getEnabledProductIdsOfSubtree(code: string): Promise<Set<string>> {
    const [own, descendants] = await Promise.all([this.getResellerByCode(code), this.getDescendantResellers(code)]);
    const contractsService = await this._loadResellerContractsService();
    const inForce = await contractsService.getContractsInForce([...(own ? [own] : []), ...descendants]);

    return new Set([...inForce.values()].flatMap(contract => contract.productIds));
  }

  /**
   * Resolves the reseller codes visible to a restricted scope: the requester's
   * own code plus the codes of all its descendant sub-resellers.
   * @param scope the request scope.
   * @returns the set of visible codes, or null when no filtering applies.
   */
  private async _resolveVisibleCodes(scope: RequestScope): Promise<Set<string> | null> {
    if (isUnrestricted(scope) || !scope.resellerCode) {
      return null;
    }
    const descendants = await this.getDescendantResellers(scope.resellerCode);
    return new Set([scope.resellerCode, ...descendants.map(descendant => descendant.code)]);
  }

  /**
   * Retrieves a reseller by its code using the GSI.
   * Returns the stored record as it is, so the IBAN comes back encrypted: this
   * is the entry point of the other services, which need the code and the tier.
   * @param code the code of the reseller to retrieve.
   * @returns the reseller if found, null otherwise.
   */
  async getResellerByCode(code: string, scope: RequestScope = SYSTEM_SCOPE): Promise<Reseller | null> {
    try {
      const visibleCodes = await this._resolveVisibleCodes(scope);
      if (visibleCodes !== null && !visibleCodes.has(code)) {
        throw new AuthorizationException(`Reseller ${code} is outside the scope of reseller ${scope.resellerCode}.`);
      }

      this._logger.log(`Searching for reseller with code: ${code}`);
      const resellers = await this._resellerModel
        .query("code")
        .eq(code)
        .using("codeIndex")
        .exec();
      const reseller = resellers.length > 0 ? resellers[0] : null;
      if (reseller && !this._isOwnedOrReadable(reseller, scope)) {
        throw new AuthorizationException(`Reseller ${code} is not assigned to the requesting Keus salesperson.`);
      }
      return reseller;
    } catch (error) {
      if (error instanceof AuthorizationException) {
        throw error;
      }
      this._logger.error(`Error searching for reseller with code: ${code}`, error);
      throw new DatabaseException(`An error occurred while searching for reseller with code: ${code}.`, error);
    }
  }

  /**
   * Resolves the materialized path of a reseller by its code, used to build
   * the begins_with subtree filter of a reseller-scoped request.
   * @param code the reseller code (typically scope.resellerCode).
   * @returns the reseller's path, or undefined when the reseller or its path is missing.
   */
  async getResellerPath(code: string): Promise<string | undefined> {
    const reseller = await this.getResellerByCode(code);
    return reseller?.path;
  }

  /**
   * Creates a new reseller.
   * Enforces app-side uniqueness of the code and validates the parent reseller (createdBy) if provided.
   * @param reseller the data to create a new reseller.
   * @returns the created reseller.
   */
  async createReseller(reseller: CreateResellerDto, scope: RequestScope): Promise<ResponseResellerDto> {
    // The resale network is single-level: only Keus creates resellers, and a
    // parent is refused explicitly so the caller gets a reason instead of a
    // silently ignored field. Existing multi-level records keep working: the
    // scoping matches by path prefix, so their subtree stays visible.
    assertCollaborator(scope, 'createReseller');
    if (reseller.createdBy) {
      throw new BusinessException(
        'Sub-resellers are disabled: the resale network is single-level.',
        'SUB_RESELLERS_DISABLED',
        { createdBy: reseller.createdBy }
      );
    }
    try {
      // Check if a reseller with the same code already exists (no unique constraint in DynamoDB).
      const existingReseller = await this.getResellerByCode(reseller.code);
      if (existingReseller) {
        throw new BusinessException(
          `A reseller with the code "${reseller.code}" already exists.`,
          "DUPLICATE_RESELLER_CODE",
          { code: reseller.code }
        );
      }

      // Single-segment path: every reseller is a root one.
      const path = `${reseller.code}#`;

      const id = uuidv4();

      // Stripped of the class identity the validation pipe gives the nested
      // objects: Dynamoose refuses one where the schema declares a plain object.
      const plainReseller = JSON.parse(JSON.stringify(reseller)) as CreateResellerDto;

      // A Keus salesperson owns the resellers it creates, or it could not edit them afterwards.
      if (this._isKeusSalespersonOnly(scope) && plainReseller.assignedSalesId !== scope.sub) {
        plainReseller.assignedSalesId = scope.sub;
        delete plainReseller.assignedSalesName;
      }

      // Create new reseller object.
      const newReseller: Reseller = {
        ...this._encryptIban(plainReseller),
        id,
        status: ResellerStatus.Active,
        path,
        rootResellerCode: reseller.code,
      }

      // Create the reseller in the database.
      this._logger.log(`Creating new reseller with ID: ${id} and code: ${reseller.code}`);
      const createdReseller = await this._resellerModel.create(newReseller);
      return plainToInstance(ResponseResellerDto, { ...this._decryptIban(createdReseller), productIds: [] });

    } catch (error) {
      this._logger.error("Error creating reseller", error);
      if (error instanceof BusinessException || error instanceof EntityNotFoundException) {
        throw error;
      }
      throw new DatabaseException("An error occurred while creating the reseller.", error);
    }
  }

  /**
   * Updates an existing reseller.
   * The createdBy field is immutable and cannot be updated. Who may change what
   * is decided by `_assertCanUpdate`; a null field is removed (see `splitRemovals`).
   * @param id the identifier of the reseller.
   * @param reseller the data to update the reseller with.
   * @returns the updated reseller.
   * @throws AuthorizationException when the requester may not apply the update.
   */
  async updateReseller(id: string, reseller: UpdateResellerDto, scope: RequestScope): Promise<ResponseResellerDto> {
    try {
      const existingReseller = await this._resellerModel.get({ id });

      // Check if the reseller exists.
      if (!existingReseller) {
        throw new EntityNotFoundException("Reseller", id);
      }

      const plainReseller = JSON.parse(JSON.stringify(reseller)) as UpdateResellerDto;
      this._assertCanUpdate(existingReseller, plainReseller, scope);

      // The code is an identity: it sits in the path of every entity of the perimeter and in pathIndex.
      if (reseller.code && reseller.code !== existingReseller.code) {
        throw new BusinessException(
          `The code of reseller "${existingReseller.code}" cannot change.`,
          "RESELLER_CODE_IMMUTABLE",
          { code: existingReseller.code }
        );
      }

      // Archiving a reseller with active children would orphan its hierarchy.
      if (reseller.status === ResellerStatus.Archived && existingReseller.status !== ResellerStatus.Archived) {
        await this._assertNoActiveChildren(existingReseller.code, "archive");
      }

      this._logger.log(`Updating reseller with ID: ${id}`);
      const { set, remove } = splitRemovals(plainReseller, ResellerSchema, "reseller", scope);
      const updatedReseller = await this._resellerModel.update({ id }, toDynamooseUpdate(this._encryptIban(set), remove));
      this._logger.log(`Reseller with ID: ${id} updated successfully`);

      return (await this._toResponses([updatedReseller]))[0];
    } catch (error) {
      this._logger.error(`Error updating reseller with ID: ${id}`, error);
      if (error instanceof EntityNotFoundException || error instanceof BusinessException || error instanceof AuthorizationException) {
        throw error;
      }
      throw new DatabaseException(`An error occurred while updating the reseller with ID: ${id}.`, error);
    }
  }

  /**
   * Asserts that a Keus salesperson is assigned to the reseller: the
   * Keus sales profile works on its own resellers only. No-op for every other
   * profile, whose limits are checked by the caller.
   * @param reseller the reseller being touched.
   * @param scope the request scope.
   * @throws AuthorizationException when a Keus salesperson is not assigned to the reseller.
   */
  assertAssignedSales(reseller: Pick<Reseller, "id" | "assignedSalesId">, scope: RequestScope): void {
    if (this._isKeusSalespersonOnly(scope) && reseller.assignedSalesId !== scope.sub) {
      throw new AuthorizationException(`Reseller ${reseller.id} is not assigned to the requesting Keus salesperson.`);
    }
  }

  /**
   * Whether the requester is a Keus salesperson without the admin profile.
   * @param scope the request scope.
   * @returns true for a Keus salesperson that is not also an admin.
   */
  private _isKeusSalespersonOnly(scope: RequestScope): boolean {
    return scope.roles.includes(UserRole.KeusSales) && !scope.roles.includes(UserRole.KeusAdmin);
  }

  /**
   * Whether the requester reads only the resellers assigned to it: a Keus salesperson
   * without the admin, back office or accounting profile (`isKeusSalespersonOnly`).
   * @param scope the request scope.
   * @returns true when the reads are limited to the own resellers.
   */
  readsOwnResellersOnly(scope: RequestScope): boolean {
    return isKeusSalespersonOnly(scope);
  }

  /**
   * Whether the assignment lets the requester read a reseller. The reseller
   * subtree of a reseller requester is checked apart.
   * @param reseller the reseller to read.
   * @param scope the request scope.
   * @returns true when the ownership does not stop the read.
   */
  private _isOwnedOrReadable(reseller: Pick<Reseller, "assignedSalesId">, scope: RequestScope): boolean {
    return !this.readsOwnResellersOnly(scope) || reseller.assignedSalesId === scope.sub;
  }

  /**
   * Asserts that the requester may apply an update to a reseller:
   *   - internal paths and Keus admins change any field;
   *   - a Keus salesperson changes its own resellers, without reassigning them;
   *   - a reseller owner changes its own reseller, only in `RESELLER_OWNER_EDITABLE_FIELDS`;
   *   - anyone else is refused.
   * @param existing the stored reseller.
   * @param update the update, stripped of the undefined fields.
   * @param scope the request scope.
   * @throws AuthorizationException when the update is not allowed.
   */
  private _assertCanUpdate(existing: Reseller, update: UpdateResellerDto, scope: RequestScope): void {
    if (scope.system === true || scope.roles.includes(UserRole.KeusAdmin)) {
      return;
    }

    if (scope.roles.includes(UserRole.KeusSales)) {
      this.assertAssignedSales(existing, scope);
      if (update.assignedSalesId !== undefined && update.assignedSalesId !== existing.assignedSalesId) {
        throw new AuthorizationException(`Only a Keus admin can reassign the salesperson of reseller ${existing.id}.`);
      }
      return;
    }

    if (scope.roles.includes(UserRole.ResellerOwner) && existing.code === scope.resellerCode) {
      const forbidden = Object.keys(update).filter(field => !RESELLER_OWNER_EDITABLE_FIELDS.has(field));
      if (forbidden.length > 0) {
        throw new AuthorizationException(`The reseller owner cannot change these fields of reseller ${existing.id}: ${forbidden.join(", ")}.`);
      }
      return;
    }

    throw new AuthorizationException(`Operation "updateReseller" is not allowed on reseller ${existing.id}.`);
  }

  /**
   * Builds the write that counts an invoice of a reseller entering or leaving the unpaid set, for the transaction
   * that moves the invoice. An invoice entering it also marks the reseller overdue (UR-RK-101).
   * @param resellerId the reseller.
   * @param delta 1 for an invoice that becomes unpaid, -1 for one that stops being unpaid.
   * @returns the transaction write.
   */
  unpaidInvoiceWrite(resellerId: string, delta: 1 | -1): TransactionWrite {
    return this._resellerModel.transaction.update(
      { id: resellerId },
      { $ADD: { unpaidInvoices: delta }, ...(delta > 0 && { $SET: { overdue: true } }) },
    );
  }

  /**
   * Settles the overdue mark of a reseller after its unpaid invoices changed: it records since when the reseller is
   * overdue, or clears the mark once no invoice is left unpaid. Each write holds only if the count allows it, so a
   * concurrent change is never overwritten.
   * @param resellerId the reseller.
   * @param since when the first invoice became unpaid (ISO), kept if the reseller was overdue already.
   */
  async settleOverdue(resellerId: string, since: string): Promise<void> {
    try {
      await this._resellerModel.update(
        { id: resellerId },
        { overdueSince: since },
        { condition: new Condition().where("unpaidInvoices").gt(0).and().where("overdueSince").not().exists(), return: "item" },
      );
      this._logger.log(`Reseller ${resellerId} overdue since ${since}.`);
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        this._logger.error(`Error marking reseller ${resellerId} overdue`, error);
        throw new DatabaseException("An error occurred while marking the reseller overdue.", error);
      }
    }

    try {
      await this._resellerModel.update(
        { id: resellerId },
        toDynamooseUpdate<Reseller>({ overdue: false }, ["overdueSince"]),
        { condition: new Condition().where("unpaidInvoices").eq(0), return: "item" },
      );
      this._logger.log(`Reseller ${resellerId} has no unpaid invoice left: overdue mark cleared.`);
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        this._logger.error(`Error clearing the overdue mark of reseller ${resellerId}`, error);
        throw new DatabaseException("An error occurred while clearing the overdue mark of the reseller.", error);
      }
      return;
    }

    // The invoices are moved already: a failed restore must not fail the payment, `access` lifts the block when read.
    try {
      await this.restoreAccess(resellerId);
    } catch (error) {
      this._logger.error(`Error restoring the access of reseller ${resellerId} after its last unpaid invoice`, error);
    }
  }

  /**
   * Tells whether the users of a reseller are blocked in Rocket, for every request they make: no contract in force
   * (none yet, one still to activate, or an ended one), or an invoice still unpaid on the fifteenth day of its
   * dunning. A block left behind with nothing unpaid does not block, as `access` answers. An unknown code is blocked.
   * @param code the code of the reseller.
   * @returns true when the users of the reseller cannot work.
   */
  async isAccessBlocked(code: string): Promise<boolean> {
    const reseller = await this.getResellerByCode(code);
    if (!reseller) {
      return true;
    }

    const contractsService = await this._loadResellerContractsService();
    if (!(await contractsService.findContractInForceOf(reseller))) {
      return true;
    }
    return !!reseller.accessSuspendedAt && (reseller.unpaidInvoices ?? 0) > 0;
  }

  /**
   * Blocks the users of a reseller in Rocket for an invoice still unpaid on the fifteenth day of its dunning, and
   * tells the reseller and the administration. A reseller already blocked, or with nothing left unpaid, is left as
   * it is, so a second invoice reaching its fifteenth day sends nothing.
   * @param resellerId the reseller.
   * @param invoice the number and amount of the unpaid invoice, and the name of the reseller it bills, for the emails.
   */
  async suspendAccess(resellerId: string, invoice: { number?: string; amountCents: number; partyName: string }): Promise<void> {
    try {
      await this._resellerModel.update(
        { id: resellerId },
        { accessSuspendedAt: new Date().toISOString() },
        { condition: new Condition().where("accessSuspendedAt").not().exists().and().where("unpaidInvoices").gt(0), return: "item" },
      );
      this._logger.log(`Access of reseller ${resellerId} suspended for invoice ${invoice.number ?? "without number"}.`);
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        this._logger.log(`Reseller ${resellerId} is blocked already or has nothing unpaid: suspension skipped.`);
        return;
      }
      this._logger.error(`Error suspending the access of reseller ${resellerId}`, error);
      throw new DatabaseException("An error occurred while suspending the access of the reseller.", error);
    }

    const amount = formatEuro(invoice.amountCents);
    const contractNoticesService = await this._loadContractNoticesService();
    await contractNoticesService.toInvoicedReseller(resellerId, MailTemplate.ResellerAccessSuspended, {
      amount,
      invoiceNumber: invoice.number ?? "",
      loginUrl: rocketUrl("/"),
    });
    await contractNoticesService.toAccounting(MailTemplate.ResellerAccessSuspendedAdmin, {
      amount,
      invoiceNumber: invoice.number ?? "",
      partyName: invoice.partyName,
      resellerUrl: rocketUrl(`/resellers/edit/${resellerId}`),
    });
  }

  /**
   * Gives Rocket back to the users of a blocked reseller, and tells the reseller and the administration. Called when
   * no invoice is left unpaid, or by hand by the administration before the money arrives: then the dunning of the
   * invoices still unpaid stops first, so a failure leaves the reseller blocked and the restore can be retried.
   * @param resellerId the reseller.
   * @param byHand whether the administration restores it before the payment.
   * @param scope the request scope.
   * @returns the reseller.
   * @throws EntityNotFoundException if the reseller does not exist.
   */
  async restoreAccess(resellerId: string, byHand = false, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseResellerDto> {
    const reseller = await this.getReseller(resellerId, scope);
    if (!reseller.accessSuspendedAt) {
      return reseller;
    }

    if (byHand) {
      const invoicesService = await this._loadInvoicesService();
      await invoicesService.stopDunningOfBilledParty(resellerId);
    }

    try {
      await this._resellerModel.update(
        { id: resellerId },
        toDynamooseUpdate<Reseller>({}, ["accessSuspendedAt"]),
        { condition: new Condition().where("accessSuspendedAt").exists(), return: "item" },
      );
      this._logger.log(`Access of reseller ${reseller.code} restored${byHand ? " by hand" : ""}.`);
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        this._logger.log(`Access of reseller ${reseller.code} restored meanwhile: nothing to do.`);
        return reseller;
      }
      this._logger.error(`Error restoring the access of reseller ${resellerId}`, error);
      throw new DatabaseException("An error occurred while restoring the access of the reseller.", error);
    }

    const contractNoticesService = await this._loadContractNoticesService();
    await contractNoticesService.toInvoicedReseller(resellerId, MailTemplate.ResellerAccessRestored, {});
    await contractNoticesService.toAccounting(MailTemplate.ResellerAccessRestoredAdmin, {
      byHand,
      partyName: reseller.companyName,
      resellerUrl: rocketUrl(`/resellers/edit/${resellerId}`),
    });
    return this.getReseller(resellerId, scope);
  }

  /**
   * Retrieves all the resellers visible to the requester: a reseller its subtree,
   * a Keus salesperson the ones assigned to it (see `_isOwnedOrReadable`).
   * @param scope the request scope.
   * @return the list of resellers.
   */
  async getAllResellers(scope: RequestScope): Promise<ResponseResellerDto[]> {
    try {
      this._logger.log("Retrieving all resellers");
      // A Keus salesperson reads its own resellers straight from the sales index.
      const resellers = this.readsOwnResellersOnly(scope)
        ? await this._resellerModel.query("assignedSalesId").eq(scope.sub).using("salesIndex").exec()
        : await this._resellerModel.scan().all().exec(); // Every reseller is asked for, so scan is necessary here.
      const visibleCodes = await this._resolveVisibleCodes(scope);
      const scoped = visibleCodes === null ? [...resellers] : resellers.filter(reseller => visibleCodes.has(reseller.code));
      return await this._toResponses(scoped);

    } catch (error) {
      this._logger.error("Error retrieving resellers", error);
      throw new DatabaseException("An error occurred while retrieving resellers.", error);
    }
  }

  /**
   * Lists one page of the resellers visible to the requester: a reseller its
   * subtree, a Keus salesperson the ones assigned to it, read off the sales index.
   * @param query the page and its filters.
   * @param scope the request scope.
   * @returns the page of resellers.
   * @throws ValidationException if the cursor is not valid.
   */
  async listResellers(query: ResellersPageQueryDto, scope: RequestScope): Promise<ResponseResellersPageDto> {
    const { limit, cursor, status, companyName, email } = query;

    try {
      const ownOnly = this.readsOwnResellersOnly(scope);
      const visibleCodes = await this._resolveVisibleCodes(scope);
      const page = await paginate<Reseller>(
        () => ownOnly
          ? this._resellerModel.query("assignedSalesId").eq(scope.sub).using("salesIndex")
          : this._resellerModel.scan(), // Every reseller is asked for, so scan is necessary here.
        ownOnly ? ["id", "assignedSalesId"] : ["id"],
        limit,
        cursor,
        reseller =>
          (visibleCodes === null || visibleCodes.has(reseller.code))
          && (!status?.length || status.includes(reseller.status))
          && startsWithAny(companyName, reseller.companyName)
          && startsWithAny(email, reseller.email),
      );
      return {
        items: await this._toResponses(page.items),
        nextCursor: page.nextCursor,
      };
    } catch (error) {
      if (error instanceof ValidationException) {
        throw error;
      }
      this._logger.error("Error listing resellers", error);
      throw new DatabaseException("An error occurred while retrieving resellers.", error);
    }
  }

  /**
   * Retrieves a reseller by its ID.
   * @param id the identifier of the reseller to retrieve.
   * @returns the retrieved reseller.
   */
  async getReseller(id: string, scope: RequestScope): Promise<ResponseResellerDto> {
    try {
      this._logger.log(`Retrieving reseller with ID: ${id}`);
      const reseller = await this._resellerModel.get({ id });
      if (!reseller) {
        this._logger.warn(`Reseller with ID: ${id} not found.`);
        throw new EntityNotFoundException("Reseller", id);
      }

      const visibleCodes = await this._resolveVisibleCodes(scope);
      if (visibleCodes !== null && !visibleCodes.has(reseller.code)) {
        throw new AuthorizationException(`Reseller ${reseller.code} is outside the scope of reseller ${scope.resellerCode}.`);
      }
      if (!this._isOwnedOrReadable(reseller, scope)) {
        throw new AuthorizationException(`Reseller ${id} is not assigned to the requesting Keus salesperson.`);
      }

      this._logger.log(`Reseller with ID: ${id} retrieved successfully.`);
      return (await this._toResponses([reseller]))[0];

    } catch (error) {
      this._logger.error(`Error retrieving reseller with ID: ${id}`, error);
      if (error instanceof EntityNotFoundException || error instanceof AuthorizationException) {
        throw error;
      }
      throw new DatabaseException(`An error occurred while retrieving the reseller with ID: ${id}.`, error);
    }
  }

  /**
   * Retrieves the direct children (sub-resellers) of a reseller using the GSI.
   * @param code the code of the parent reseller.
   * @returns the list of direct child resellers.
   */
  async getChildResellers(code: string, scope: RequestScope = SYSTEM_SCOPE): Promise<Reseller[]> {
    try {
      const visibleCodes = await this._resolveVisibleCodes(scope);
      if (visibleCodes !== null && !visibleCodes.has(code)) {
        throw new AuthorizationException(`Reseller ${code} is outside the scope of reseller ${scope.resellerCode}.`);
      }

      this._logger.log(`Retrieving child resellers of: ${code}`);
      const children = await this._resellerModel
        .query("createdBy")
        .eq(code)
        .using("createdByIndex")
        .exec();
      return children.filter(child => this._isOwnedOrReadable(child, scope));
    } catch (error) {
      this._logger.error(`Error retrieving child resellers of: ${code}`, error);
      if (error instanceof AuthorizationException) {
        throw error;
      }
      throw new DatabaseException(`An error occurred while retrieving child resellers of: ${code}.`, error);
    }
  }

  /**
   * Retrieves all the descendants (whole subtree) of a reseller with one query on pathIndex: the resellers of its root
   * whose path starts with its own. Used by the scoping layer and before archiving or deleting a reseller.
   * @param code the code of the reseller.
   * @returns the list of all descendant resellers, the reseller itself excluded.
   * @throws DatabaseException if the query fails.
   */
  async getDescendantResellers(code: string): Promise<Reseller[]> {
    const reseller = await this.getResellerByCode(code);
    if (!reseller) {
      return [];
    }

    // The network is single-level: a root reseller's path is its code.
    const path = reseller.path ?? `${code}#`;
    try {
      const subtree = await this._resellerModel
        .query("rootResellerCode").eq(path.split('#')[0])
        .where("path").beginsWith(path)
        .using("pathIndex")
        .all()
        .exec();
      return subtree.filter(descendant => descendant.code !== code);
    } catch (error) {
      this._logger.error(`Error retrieving the descendants of reseller ${code}`, error);
      throw new DatabaseException(`An error occurred while retrieving the descendants of reseller ${code}.`, error);
    }
  }

  /**
   * Deletes a reseller by its ID.
   * Rejects the deletion if the reseller still has non-archived children, companies or a contract in force: its
   * companies are transferred first (UR-RK-105), so the sequence is deactivate, transfer, delete.
   * @param id the identifier of the reseller to delete.
   * @param scope the request scope.
   * @returns void.
   * @throws BusinessException if the reseller has children, companies or a contract in force.
   */
  async deleteReseller(id: string, scope: RequestScope): Promise<void> {
    assertCollaborator(scope, 'deleteReseller');
    try {
      const existingReseller = await this._resellerModel.get({ id });
      if (!existingReseller) {
        throw new EntityNotFoundException("Reseller", id);
      }

      await this._assertNoActiveChildren(existingReseller.code, "delete");

      await this._assertNoCompanies(existingReseller);

      // A contract in force keeps its Stripe subscription charging: it has to end first.
      const resellerContractsService = await this._loadResellerContractsService();
      const contractInForce = await resellerContractsService.findContractInForceOf(existingReseller);
      if (contractInForce) {
        throw new BusinessException(
          `Cannot delete reseller "${existingReseller.code}": its contract ${contractInForce.code} is still in force.`,
          "RESELLER_CONTRACT_IN_FORCE",
          { contractId: contractInForce.id }
        );
      }

      this._logger.log(`Deleting reseller with ID: ${id}`);
      await this._resellerModel.delete({ id });
      this._logger.log(`Reseller with ID: ${id} deleted successfully`);

    } catch (error) {
      this._logger.error(`Error deleting reseller with ID: ${id}`, error);
      if (error instanceof EntityNotFoundException || error instanceof BusinessException) {
        throw error;
      }
      throw new DatabaseException(`An error occurred while deleting the reseller with ID: ${id}.`, error);
    }
  }

  /**
   * Points a reseller at its new contract in force and copies its tier, which the materials filter by.
   * Called by the reseller contracts service when a contract starts or takes over from the previous one.
   * @param resellerId the identifier of the reseller.
   * @param contract the contract now in force.
   */
  async setContractInForce(resellerId: string, contract: { id: string; tier: ResellerTier }): Promise<void> {
    try {
      this._logger.log(`Reseller ${resellerId} is now under contract ${contract.id}`);
      await this._resellerModel.update({ id: resellerId }, { contractId: contract.id, tier: contract.tier });
    } catch (error) {
      this._logger.error(`Error setting the contract in force of reseller ${resellerId}`, error);
      throw new DatabaseException(`An error occurred while setting the contract in force of reseller ${resellerId}.`, error);
    }
  }

  /**
   * Asserts that a reseller has no non-archived descendants before a destructive operation.
   * @param code the code of the reseller.
   * @param operation the operation being attempted (for the error message).
   */
  private async _assertNoActiveChildren(code: string, operation: string): Promise<void> {
    const descendants = await this.getDescendantResellers(code);
    const activeChildren = descendants.filter(child => child.status !== ResellerStatus.Archived);

    if (activeChildren.length > 0) {
      throw new BusinessException(
        `Cannot ${operation} reseller "${code}": it still has ${activeChildren.length} non-archived sub-reseller(s).`,
        "RESELLER_HAS_ACTIVE_CHILDREN",
        { code, activeChildren: activeChildren.map(child => child.code) }
      );
    }
  }

  /**
   * Asserts that no company sits within the perimeter of a reseller before its deletion: a company left behind would
   * keep a path that leads to no reseller, and could no longer be transferred.
   * @param reseller the reseller.
   * @throws BusinessException if at least one company is still within its perimeter.
   */
  private async _assertNoCompanies(reseller: Reseller): Promise<void> {
    // The network is single-level: a root reseller's path is its code.
    const path = reseller.path ?? `${reseller.code}#`;
    const companiesService = await this._loadCompaniesService();

    if (await companiesService.hasCompaniesInPath(path)) {
      throw new BusinessException(
        `Cannot delete reseller "${reseller.code}": it still has companies, transfer them first.`,
        "RESELLER_HAS_COMPANIES",
        { code: reseller.code }
      );
    }
  }
}
