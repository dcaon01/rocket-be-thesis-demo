import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { transaction } from "dynamoose";
import { InjectModel, Model } from "nestjs-dynamoose";
import { v4 as uuidv4 } from "uuid";
import { AuthorizationException, BusinessException, DatabaseException, DuplicateEmailException, EntityNotFoundException, ValidationException } from "../../../../errors/exception-types";
import { normalizeSearchText, Page, paginate, paginateMerged, searchKeyOf, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { CompaniesPageQueryDto } from "../../dtos/companies-page-query.dto";
import { ResponseCompaniesPageDto } from "../../dtos/response-companies-page.dto";
import { isUnrestricted, RequestScope, SYSTEM_SCOPE } from "@rocket-be/scoping";
import { splitRemovals, toDynamooseUpdate, withoutKeys } from "../../../../commons/persistence/removable-update.helper";
import { assertPathVisible, isPathVisible } from "../../../../commons/scoping/scoped-access.helper";
import { IssuerType } from "../../../../commons/enums/issuer-type.enum";
import { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import { ResellerStatus } from "../../../resellers/enums/reseller-status.enum";
import type { ContractsService } from "../../../contracts/lazy-contracts/services/contracts.service";
import { ContractStatus, IN_FORCE_STATUSES } from "../../../contracts/enums/contract-status.enum";
import type { ResponseContractDto } from "../../../contracts/dtos/response-contract.dto";
import type { OrdersService } from "../../../orders/lazy-orders/services/orders.service";
import type { TenantsService } from "../../../tenants/lazy-tenants/services/tenants.service";
import type { DocumentsService } from "../../../documents/lazy-documents/services/documents.service";
import { DocumentOwnerType } from "../../../documents/enums/document-owner-type.enum";
import { StripeAccountLink } from "../../../stripe/classes/stripe-account-link.class";
import { CreateCompanyDto } from "../../dtos/create-company.dto";
import { ResponseCompanyDto } from "../../dtos/response-company.dto";
import { TransferCompanyDto } from "../../dtos/transfer-company.dto";
import { UpdateCompanyDto } from "../../dtos/update-company.dto";
import { CompanyStatus } from "../../enums/company-status.enum";
import { SalesChannel } from "../../enums/sales-channel.enum";
import { Company, CompanyKey, CompanySchema } from "../../schemas/company.schema";

/** Attributes an update never writes: creator, lineage and Stripe links change only through their own flows. */
const NON_UPDATABLE_FIELDS = ["id", "createdByType", "createdById", "createdBySub", "rootResellerCode", "resellerPath", "channel", "resellerCode", "stripeAccounts", "transferredAt", "previousResellerCode", "sameAsCompanyIds", "normalizedName", "statusName", "normalizedEmail"];

/** A complete Italian VAT number, with or without the country prefix: searched by equality on vatIndex. */
const FULL_VAT_NUMBER = /^(?:IT)?(\d{11})$/i;

/**
 * Builds the search attributes of a company, the sort keys of the indexes of the collaborator list.
 * @param company the name, the status and the email of the company.
 * @returns the normalized name, the status with the name and the normalized email.
 */
function searchKeysOf(company: Pick<Company, "name" | "status" | "email">): Pick<Company, "normalizedName" | "statusName" | "normalizedEmail"> {
  const normalizedName = searchKeyOf(company.name);
  return { normalizedName, statusName: `${company.status}#${normalizedName}`, normalizedEmail: searchKeyOf(company.email) };
}

/**
 * Compares two texts by code units, the order DynamoDB keeps a string sort key in.
 * @param a the first text.
 * @param b the second text.
 * @returns a negative number, zero or a positive number.
 */
function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

@Injectable()
export class CompaniesService {
  /** Logger instance for CompaniesService. */
  private readonly _logger = new Logger(CompaniesService.name);

  /**
   * Contructor for CompaniesService.
   * @param _companyModel the model to manage companies entities.
   */
  constructor(
    @InjectModel("Company")
    private readonly _companyModel: Model<Company, CompanyKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /** Lazy-loaded resellers service */
  private _resellersService: ResellersService | null = null;

  /** Lazy-loaded orders service, used to realign the company details copied on the open orders. */
  private _ordersService: OrdersService | null = null;

  /** Lazy-loaded contracts service. */
  private _contractsService: ContractsService | null = null;

  /** Lazy-loaded tenants service, used to move the tenants of a transferred company. */
  private _tenantsService: TenantsService | null = null;

  /** Lazy-loaded documents service, used to move the documents of a transferred company. */
  private _documentsService: DocumentsService | null = null;

  /**
   * Lazy loads the TenantsService from its module.
   * @returns a Promise resolving to the TenantsService instance.
   */
  private async _loadTenantsService(): Promise<TenantsService> {
    if (!this._tenantsService) {
      const { TenantsLazyModule } = await import("../../../tenants/lazy-tenants/tenants-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => TenantsLazyModule);
      const { TenantsService } = await import("../../../tenants/lazy-tenants/services/tenants.service");
      this._tenantsService = moduleRef.get<TenantsService>(TenantsService);
    }
    return this._tenantsService;
  }

  /**
   * Lazy loads the DocumentsService from its module.
   * @returns a Promise resolving to the DocumentsService instance.
   */
  private async _loadDocumentsService(): Promise<DocumentsService> {
    if (!this._documentsService) {
      const { DocumentsLazyModule } = await import("../../../documents/lazy-documents/documents-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => DocumentsLazyModule);
      const { DocumentsService } = await import("../../../documents/lazy-documents/services/documents.service");
      this._documentsService = moduleRef.get<DocumentsService>(DocumentsService);
    }
    return this._documentsService;
  }

  /**
   * Lazy loads the ContractsService from its module.
   * @returns a Promise resolving to the ContractsService instance.
   */
  private async _loadContractsService(): Promise<ContractsService> {
    if (!this._contractsService) {
      const { ContractsLazyModule } = await import("../../../contracts/lazy-contracts/contracts-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ContractsLazyModule);
      const { ContractsService } = await import("../../../contracts/lazy-contracts/services/contracts.service");
      this._contractsService = moduleRef.get<ContractsService>(ContractsService);
    }
    return this._contractsService;
  }

  /**
   * Lazy loads the OrdersService from its module.
   * @returns a Promise resolving to the OrdersService instance.
   */
  private async _loadOrdersService(): Promise<OrdersService> {
    if (!this._ordersService) {
      const { OrdersLazyModule } = await import("../../../orders/lazy-orders/orders-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => OrdersLazyModule);
      const { OrdersService } = await import("../../../orders/lazy-orders/services/orders.service");
      this._ordersService = moduleRef.get<OrdersService>(OrdersService);
    }
    return this._ordersService;
  }

  /**
   * Lazy loads the ResellersService from its module.
   * @returns A Promise resolving to the ResellersService instance.
   */
  private async _loadResellersService(): Promise<ResellersService> {
    if (!this._resellersService) {
      const { ResellersLazyModule } = await import(
        "../../../resellers/lazy-resellers/resellers-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ResellersLazyModule,
      );
      this._resellersService = moduleRef.get<ResellersService>(ResellersService);
    }
    return this._resellersService;
  }

  /**
   * Resolves the requesting reseller's materialized path. Returns undefined for
   * unrestricted scopes (collaborators / system).
   * @param scope the request scope.
   * @returns the viewer's reseller path, or undefined.
   */
  private async _resolveScopePath(scope: RequestScope): Promise<string | undefined> {
    if (isUnrestricted(scope) || !scope.resellerCode) {
      return undefined;
    }
    const resellersService = await this._loadResellersService();
    return await resellersService.getResellerPath(scope.resellerCode);
  }

  /**
   * Queries the companies of a reseller's whole subtree with a single begins_with
   * on the resellerPathIndex GSI. The companies table is not product-scoped, so
   * the GSI partitions by the root reseller (first path segment) and filters by
   * path prefix.
   * @param viewerPath the requester's reseller path (e.g. "RVD-001#RVD-002#").
   * @returns the companies whose creator lineage is within the viewer's subtree.
   */
  private async _queryCompaniesByResellerPath(viewerPath: string): Promise<Company[]> {
    return await this._companyModel
      .query("rootResellerCode").eq(viewerPath.split('#')[0])
      .where("resellerPath").beginsWith(viewerPath)
      .using("resellerPathIndex")
      .all()
      .exec();
  }


  /**
   * Tells whether any company sits within the perimeter of a reseller, read on the resellerPathIndex GSI up to the
   * first match: the path prefix is the range key, so the limit applies to matching companies only.
   * @param resellerPath the path of the reseller (e.g. "RVD-001#").
   * @returns true if at least one company has a path within the reseller's.
   * @throws DatabaseException if the query fails.
   */
  async hasCompaniesInPath(resellerPath: string): Promise<boolean> {
    try {
      const companies = await this._companyModel
        .query("rootResellerCode").eq(resellerPath.split('#')[0])
        .where("resellerPath").beginsWith(resellerPath)
        .using("resellerPathIndex")
        .limit(1)
        .exec();
      return companies.length > 0;
    } catch (error) {
      this._logger.error(`Error reading the companies within path ${resellerPath}`, error);
      throw new DatabaseException("An error occurred while reading the companies of the reseller.", error);
    }
  }

  /**
   * Retrieves the companies of a channel with an email: the email is unique among the direct companies, and among
   * those of each reseller, while a direct company and one of a reseller may be the same real one.
   * @param email the email to look for.
   * @param resellerPath the path of the channel, absent for the direct one.
   * @returns the companies of the channel with that email.
   * @throws DatabaseException if the query fails.
   */
  private async _companiesWithEmailInChannel(email: string, resellerPath: string | undefined): Promise<Company[]> {
    try {
      const companies = await this._companyModel.query("email").eq(email).using("emailIndex").exec();
      return companies.filter(company => (company.resellerPath ?? "") === (resellerPath ?? ""));
    } catch (error) {
      this._logger.error(`Error searching for company with email: ${email}`, error);
      throw new DatabaseException(`An error occurred while searching for company with email: ${email}.`, error);
    }
  }

  /**
   * Tells whether another company of the same channel has an email, the records of the same real company apart.
   * @param email the email to check.
   * @param resellerPath the path of the channel, absent for the direct one.
   * @param exceptIds the company being edited and its twins, which do not count.
   * @returns true when the email is taken in the channel.
   */
  private async _isEmailTakenInChannel(email: string, resellerPath: string | undefined, exceptIds: string[] = []): Promise<boolean> {
    const companies = await this._companiesWithEmailInChannel(email, resellerPath);
    return companies.some(company => !exceptIds.includes(company.id));
  }

  /**
   * Retrieves the records of the real company a company stands for: itself and the twins a transfer linked to it.
   * One contract in force per product holds across them.
   * @param companyId the company.
   * @returns the identifiers of the company and of its twins.
   * @throws EntityNotFoundException if the company does not exist.
   */
  async getCompanyGroupIds(companyId: string): Promise<string[]> {
    const company = await this._companyModel.get({ id: companyId });
    if (!company) {
      throw new EntityNotFoundException('Company', companyId);
    }
    return [company.id, ...(company.sameAsCompanyIds ?? [])];
  }

  /**
   * Retrieves a direct company by its email using the GSI, for HubSpot, which is the direct channel of Keus.
   * @param email the email of the company to retrieve.
   * @returns the direct company if found, null otherwise.
   */
  async getDirectCompanyByEmail(email: string): Promise<Company | null> {
    try {
      this._logger.log(`Searching for company with email: ${email}`);
      const companies = await this._companyModel
        .query("email")
        .eq(email)
        .using("emailIndex")
        .exec();
      return companies.find(company => !company.resellerPath) ?? null;
    } catch (error) {
      this._logger.error(`Error searching for company with email: ${email}`, error);
      throw new DatabaseException(`An error occurred while searching for company with email: ${email}.`, error);
    }
  }

  /**
   * Retrieves a direct company by its VAT number using the GSI, for HubSpot, which is the direct channel of Keus.
   * @param vatNumber the VAT number of the company to retrieve.
   * @returns the direct company if found, null otherwise.
   */
  async getDirectCompanyByVatNumber(vatNumber: string): Promise<Company | null> {
    try {
      this._logger.log(`Searching for company with VAT number: ${vatNumber}`);
      const companies = await this._companyModel
        .query("vatNumber")
        .eq(vatNumber)
        .using("vatIndex")
        .exec();
      return companies.find(company => !company.resellerPath) ?? null;
    } catch (error) {
      this._logger.error(`Error searching for company with VAT number: ${vatNumber}`, error);
      throw new DatabaseException(`An error occurred while searching for company with VAT number: ${vatNumber}.`, error);
    }
  }

  /**
   * Creates a new company.
   * @param company the data to create a new company.
   * @returns the created company.
   */
  async createCompany(company: CreateCompanyDto, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseCompanyDto> {
    // Reseller requesters always create companies as their own; their path is
    // resolved here. Other callers (e.g. contracts) pass resellerPath in the DTO.
    let resellerPath = company.resellerPath;
    if (!isUnrestricted(scope) && scope.resellerCode) {
      company = { ...company, createdByType: IssuerType.Reseller, createdById: scope.resellerCode };
      const resellersService = await this._loadResellersService();
      resellerPath = await resellersService.getResellerPath(scope.resellerCode);
    }
    try {
      if (await this._isEmailTakenInChannel(company.email, resellerPath)) {
        throw new DuplicateEmailException(company.email);
      }

      const id = uuidv4();

      // Create new company object. The creator defaults to KEUS when not specified.
      // rootResellerCode (the path's first segment) partitions the subtree GSI.
      // Stripped of the class identity the validation pipe gives the nested
      // objects: Dynamoose refuses one where the schema declares a plain object.
      // The fields only the server writes are dropped from the body, since the validation pipe lets unknown keys
      // through: the twins, for one, widen the rule of one contract per product.
      const plainCompany = withoutKeys(JSON.parse(JSON.stringify(company)) as CreateCompanyDto, NON_UPDATABLE_FIELDS);
      const newCompany: Company = {
        ...plainCompany,
        id,
        status: CompanyStatus.Active,
        createdByType: company.createdByType ?? IssuerType.Keus,
        ...(company.createdById && { createdById: company.createdById }),
        ...(!scope.system && { createdBySub: scope.sub }),
        ...(resellerPath && { resellerPath, rootResellerCode: resellerPath.split('#')[0] }),
        channel: resellerPath ? SalesChannel.Reseller : SalesChannel.Direct,
        ...searchKeysOf({ name: plainCompany.name, status: CompanyStatus.Active, email: plainCompany.email }),
      }

      // Create the company in the database.
      this._logger.log(`Creating new company with ID: ${id}`);
      const createdCompany = await this._companyModel.create(newCompany);
      return plainToInstance(ResponseCompanyDto, createdCompany);

    } catch (error) {
      this._logger.error("Error creating company", error);
      if (error instanceof DuplicateEmailException) {
        throw error;
      }
      throw new DatabaseException("An error occurred while creating the company.", error);
    }
  }

  /**
   * Updates an existing company. A null field is removed (see `splitRemovals`); the attributes of
   * `NON_UPDATABLE_FIELDS` are dropped, since the validation pipe lets unknown keys through.
   * @param id the identifier of the company.
   * @param company the data to update the company with.
   * @param scope the request scope.
   * @returns the updated company.
   */
  async updateCompany(id: string, company: UpdateCompanyDto, scope: RequestScope): Promise<ResponseCompanyDto> {
    try {
      const existingCompany = await this._companyModel.get({ id });

      // Check if the company exists.
      if (!existingCompany) {
        throw new EntityNotFoundException(`Company not found.`, id);
      }

      // Resellers can only touch companies of their own subtree.
      const viewerPath = await this._resolveScopePath(scope);
      assertPathVisible(scope, viewerPath, existingCompany.resellerPath, `Company ${id}`);

      // A new email must be free among the companies of the same channel.
      if (company.email && company.email !== existingCompany.email
        && await this._isEmailTakenInChannel(company.email, existingCompany.resellerPath, [id, ...(existingCompany.sameAsCompanyIds ?? [])])) {
        throw new DuplicateEmailException(company.email);
      }

      this._logger.log(`Updating company with ID: ${id}`);
      const plainCompany = withoutKeys(JSON.parse(JSON.stringify(company)) as Partial<Company>, NON_UPDATABLE_FIELDS);
      const { set, remove } = splitRemovals(plainCompany, CompanySchema, "company", scope);

      // After the split, so a required field cleared is refused there and the keys read only real values.
      if (set.name !== undefined || set.status !== undefined || set.email !== undefined) {
        Object.assign(set, searchKeysOf({ ...existingCompany, ...set }));
      }

      const updatedCompany = await this._companyModel.update({ id }, toDynamooseUpdate(set, remove));
      this._logger.log(`Company with ID: ${id} updated successfully`);
      await this._syncCompanyCopies(existingCompany, updatedCompany);

      return plainToInstance(ResponseCompanyDto, this._withoutTwinsFor(updatedCompany, scope));
    } catch (error) {
      this._logger.error(`Error updating company with ID: ${id}`, error);
      if (error instanceof EntityNotFoundException || error instanceof DuplicateEmailException || error instanceof AuthorizationException || error instanceof BusinessException) {
        throw error;
      }
      throw new DatabaseException(`An error occurred while updating the company with ID: ${id}.`, error);
    }
  }

  /**
   * Records the customer, and the mandate once collected, of a company on one Stripe account.
   * @param companyId the company.
   * @param link the link to record; fields left out keep the value already recorded.
   * @returns the updated company.
   * @throws EntityNotFoundException if the company does not exist.
   */
  async linkStripeAccount(companyId: string, link: StripeAccountLink): Promise<ResponseCompanyDto> {
    const company = await this._companyModel.get({ id: companyId });
    if (!company) {
      throw new EntityNotFoundException('Company', companyId);
    }
    const links = company.stripeAccounts ?? [];
    const current = links.find(item => item.accountKey === link.accountKey);
    const merged = { ...current, ...link };
    const stripeAccounts = [...links.filter(item => item.accountKey !== link.accountKey), merged];
    const updated = await this._companyModel.update({ id: companyId }, { stripeAccounts });
    this._logger.log(`Company ${companyId} linked to Stripe account ${link.accountKey}${link.paymentMethodId ? ' with its mandate' : ''}.`);
    return plainToInstance(ResponseCompanyDto, updated);
  }

  /**
   * Forgets the mandate of a company on one Stripe account, keeping its customer: a payment that failed on it means
   * the company has to give a new one, so its contract waits for the checkout again.
   * @param companyId the company.
   * @param accountKey the Stripe account: a product id.
   * @throws EntityNotFoundException if the company does not exist.
   * @throws DatabaseException if the write fails.
   */
  async dropMandate(companyId: string, accountKey: string): Promise<void> {
    const company = await this._companyModel.get({ id: companyId });
    if (!company) {
      throw new EntityNotFoundException('Company', companyId);
    }

    const links = company.stripeAccounts ?? [];
    const stripeAccounts = links.map(link => link.accountKey === accountKey
      ? { accountKey: link.accountKey, customerId: link.customerId }
      : link);
    try {
      await this._companyModel.update({ id: companyId }, { stripeAccounts });
      this._logger.log(`Mandate of company ${companyId} on Stripe account ${accountKey} dropped.`);
    } catch (error) {
      this._logger.error(`Error dropping the mandate of company ${companyId} on Stripe account ${accountKey}`, error);
      throw new DatabaseException(`An error occurred while dropping the mandate of company ${companyId}.`, error);
    }
  }

  /**
   * Transfers a company of an inactive reseller (UR-RK-105) to another active reseller, or to Keus when the DTO names
   * none. The lineage is rewritten record by record, without a transaction:
   *   - the open orders of the old reseller are cancelled once every check passed, a confirmed one blocks the transfer;
   *     the closed ones and the invoices stay its history;
   *   - towards a reseller, the contracts in force bill the new one from their next period, with the amounts of their
   *     order line; towards Keus, each is terminated and taken over on the same tenant by a direct contract, through
   *     a confirmed order whose lines are charged from the end of the period the reseller paid;
   *   - the tenants of every contract of the company follow, with their users, and so do the company documents;
   *   - the company is written last, with when and from which reseller it moved: a failed transfer is retried from
   *     the old reseller, and every step already done is found done (records moved, contracts terminated, transfer
   *     order and lines provisioned).
   * It runs within the request, not on a queue: a company has few tenants, so the API Gateway timeout is enough,
   *   and a retry resumes the steps left.
   * @param id the identifier of the company.
   * @param transferDto the reseller the company moves to, or the plans of the direct contracts towards Keus.
   * @param scope the request scope.
   * @returns the company on its new channel.
   * @throws EntityNotFoundException if the company or the reseller does not exist.
   * @throws BusinessException if the company is not on an inactive reseller, the target is not active or does not
   * sell a product of the contracts in force, a contract is terminating on the way to Keus, an order is still being
   * provisioned, or the transfer order cannot be opened (see `OrdersService.openTransferOrder`).
   */
  async transferCompany(id: string, transferDto: TransferCompanyDto, scope: RequestScope): Promise<ResponseCompanyDto> {
    const company = await this._companyModel.get({ id });
    if (!company) {
      throw new EntityNotFoundException('Company', id);
    }

    const resellersService = await this._loadResellersService();
    const sourceCode = company.resellerPath?.split('#').filter(Boolean).pop();
    const source = sourceCode ? await resellersService.getResellerByCode(sourceCode) : null;
    if (!company.resellerPath || !source || source.status !== ResellerStatus.Inactive) {
      throw new BusinessException(`Company ${id} is not on an inactive reseller: only those can be transferred.`, "RESELLER_NOT_INACTIVE");
    }

    const contractsService = await this._loadContractsService();
    const contracts = await contractsService.getContractsByCompany(id, SYSTEM_SCOPE);
    // The direct contracts a previous attempt towards Keus already opened are not the reseller's.
    const inForce = contracts.filter(contract => IN_FORCE_STATUSES.includes(contract.status) && contract.resellerPath);
    const resellerPath = transferDto.resellerId
      ? await this._resolveTransferTarget(transferDto.resellerId, inForce)
      : undefined;
    // A cancelled contract is not worth a direct one: it ends where it is.
    const terminating = resellerPath ? undefined : inForce.find(contract => contract.status === ContractStatus.Terminating);
    if (terminating) {
      throw new BusinessException(`Contract ${terminating.code} is terminating: withdraw the cancellation or wait for its end before moving company ${id} to Keus.`, "CONTRACT_TERMINATING");
    }
    const destination = resellerPath ?? "Keus";
    const ordersService = await this._loadOrdersService();
    await ordersService.assertNoOrderInProvisioning(id, company.resellerPath);
    // The destination may already hold the same real company, under the same email: the two get linked.
    const twin = (await this._companiesWithEmailInChannel(company.email, resellerPath)).find(other => other.id !== id);
    if (twin) {
      await this._assertTwinFree(company, twin);
    }

    try {
      this._logger.log(`Transferring company ${id} from reseller ${source.code} to ${destination}`);
      // Opening the transfer order checks what Keus needs: the open orders are cancelled only once it passed.
      const lines = resellerPath ? [] : await ordersService.openTransferOrder(id, inForce, transferDto.lines ?? [], source.code, company.transferredAt, scope);
      await ordersService.cancelOrdersForTransfer(id, company.resellerPath);
      if (resellerPath) {
        await contractsService.transferCompanyContracts(id, resellerPath);
      }
      for (const line of lines) {
        await contractsService.terminateForTransfer(line.productId, line.previousContractId);
      }

      const tenantsService = await this._loadTenantsService();
      const tenants = new Map(contracts.filter(contract => contract.tenantId).map(contract => [`${contract.productId}#${contract.tenantId}`, contract]));
      for (const contract of tenants.values()) {
        await tenantsService.transferTenant(contract.productId, contract.tenantId, resellerPath);
      }
      for (const line of lines) {
        const previous = contracts.find(contract => contract.id === line.previousContractId);
        await ordersService.provisionLineOnTenant(line.orderId, line.productId, previous.tenantId, SYSTEM_SCOPE);
      }

      const documentsService = await this._loadDocumentsService();
      await documentsService.transferOwnerDocuments(DocumentOwnerType.Company, id, resellerPath);

      // The move and the links to the same company on the destination go in one transaction: never one without the other.
      const transfer = { transferredAt: new Date().toISOString(), previousResellerCode: source.code };
      const group = twin ? await this._twinGroupOf(company, twin) : [];
      const links = (companyId: string): Partial<Company> => (twin ? { sameAsCompanyIds: group.filter(other => other !== companyId) } : {});
      await transaction([
        this._companyModel.transaction.update({ id }, resellerPath
          ? { rootResellerCode: resellerPath.split('#')[0], resellerPath, channel: SalesChannel.Reseller, ...transfer, ...links(id) }
          : toDynamooseUpdate<Company>({ ...transfer, channel: SalesChannel.Direct, ...links(id) }, ["rootResellerCode", "resellerPath"])),
        ...group.filter(companyId => companyId !== id).map(companyId => this._companyModel.transaction.update({ id: companyId }, links(companyId))),
      ]);
      this._logger.log(`Company ${id} transferred to ${destination}${twin ? `, linked to company ${twin.id}, the same company there` : ""}.`);

      return plainToInstance(ResponseCompanyDto, await this._companyModel.get({ id }, { consistent: true, return: "item" }));
    } catch (error) {
      if (error instanceof BusinessException || error instanceof EntityNotFoundException) {
        throw error;
      }
      this._logger.error(`Error transferring company ${id} to ${destination}`, error);
      throw new DatabaseException(`An error occurred while transferring the company with ID: ${id}.`, error);
    }
  }

  /**
   * Asserts that linking a transferred company to the record of the same company on its destination keeps one contract
   * in force per product: the two sides, each record with its twins, have no contract in force on the same product,
   * and neither has an open order on a product the other has in force. The orders the transfer cancels do not count.
   * The error names the company of the destination and what clashes.
   * @param company the company being transferred.
   * @param twin the company of the destination with the same email.
   * @throws BusinessException if the two sides clash on a product.
   */
  private async _assertTwinFree(company: Company, twin: Company): Promise<void> {
    const ownIds = [company.id, ...(company.sameAsCompanyIds ?? [])];
    const twinIds = [twin.id, ...(twin.sameAsCompanyIds ?? [])].filter(companyId => !ownIds.includes(companyId));
    const twinName = twin.name;
    const contractsService = await this._loadContractsService();
    const ordersService = await this._loadOrdersService();
    const inForceOf = async (companyIds: string[]): Promise<ResponseContractDto[]> =>
      (await Promise.all(companyIds.map(companyId => contractsService.getContractsByCompany(companyId, SYSTEM_SCOPE)))).flat()
        .filter(contract => IN_FORCE_STATUSES.includes(contract.status));

    const [ownInForce, twinInForce, ownOrders, twinOrders] = await Promise.all([
      inForceOf(ownIds),
      inForceOf(twinIds),
      ordersService.getOpenOrdersOf(ownIds),
      ordersService.getOpenOrdersOf(twinIds),
    ]);
    const ownProducts = new Set(ownInForce.map(contract => contract.productId));
    const twinProducts = new Set(twinInForce.map(contract => contract.productId));

    const clashing = twinInForce.filter(contract => ownProducts.has(contract.productId));
    if (clashing.length > 0) {
      const codes = clashing.map(contract => contract.code);
      throw new BusinessException(
        `Company ${twinName} is the same company on the destination and has contract(s) ${codes.join(", ")} in force on the products arriving.`,
        "TWIN_CONTRACT_IN_FORCE",
        { companyId: twin.id, companyName: twinName, contractCodes: codes },
      );
    }

    const blocking = [
      ...twinOrders.filter(order => order.productIds.some(productId => ownProducts.has(productId))),
      // The open orders of the reseller the company leaves are cancelled by the transfer.
      ...ownOrders.filter(order => order.resellerPath !== company.resellerPath && order.productIds.some(productId => twinProducts.has(productId))),
    ];
    if (blocking.length > 0) {
      const codes = blocking.map(order => order.code);
      throw new BusinessException(
        `Company ${twinName} is the same company on the destination, and order(s) ${codes.join(", ")} are open on a product the other side has in force.`,
        "TWIN_ORDER_OPEN",
        { companyId: twin.id, companyName: twinName, orderCodes: codes },
      );
    }
  }

  /**
   * Gathers the records of the same real company when a transfer meets one on its destination: the company, that
   * record and the twins of both that are still on record. Every record then lists all the others.
   * @param company the transferred company.
   * @param twin the company of the destination with the same email.
   * @returns the identifiers of the whole group.
   */
  private async _twinGroupOf(company: Company, twin: Company): Promise<string[]> {
    const listed = [...new Set([company.id, twin.id, ...(company.sameAsCompanyIds ?? []), ...(twin.sameAsCompanyIds ?? [])])];
    // A twin deleted since would come back as an empty record from the update that links it.
    const found = await this._companyModel.batchGet(listed.map(id => ({ id })));
    return listed.filter(id => found.some(record => record.id === id));
  }

  /**
   * Keeps, among the twins of a company, those the requester can see: a reseller does not learn the records of the same
   * company on other channels.
   * @param company the company.
   * @param scope the request scope.
   * @param viewerPath the path of the requester, absent for a collaborator.
   * @returns the company with the twins the requester can see.
   */
  private async _withVisibleTwins(company: Company, scope: RequestScope, viewerPath: string | undefined): Promise<Company> {
    if (isUnrestricted(scope) || !company.sameAsCompanyIds?.length) {
      return company;
    }

    const twins = await this._companyModel.batchGet(company.sameAsCompanyIds.map(id => ({ id })));
    const visible = twins.filter(twin => isPathVisible(viewerPath, twin.resellerPath)).map(twin => twin.id);
    return { ...company, sameAsCompanyIds: visible };
  }

  /**
   * Leaves the twins out of a company shown to a reseller in a list or after a write: only the page of the company reads
   * the ones it may see.
   * @param company the company.
   * @param scope the request scope.
   * @returns the company as the requester may see it.
   */
  private _withoutTwinsFor(company: Company, scope: RequestScope): Company {
    return isUnrestricted(scope) ? company : { ...company, sameAsCompanyIds: undefined };
  }

  /**
   * Reads the reseller a company is transferred to and checks it can take the contracts in force.
   * @param resellerId the identifier of the reseller.
   * @param inForce the contracts in force of the company.
   * @returns the path of the reseller.
   * @throws EntityNotFoundException if the reseller does not exist.
   * @throws BusinessException if the reseller is not active or does not sell a product of the contracts.
   */
  private async _resolveTransferTarget(resellerId: string, inForce: ResponseContractDto[]): Promise<string> {
    const resellersService = await this._loadResellersService();
    const target = await resellersService.getReseller(resellerId, SYSTEM_SCOPE);
    const resellerPath = await resellersService.getResellerPath(target.code);
    if (target.status !== ResellerStatus.Active || !resellerPath) {
      throw new BusinessException(`Reseller ${target.code} is not active.`, "RESELLER_NOT_ACTIVE");
    }

    const missing = [...new Set(inForce.map(contract => contract.productId))].filter(productId => !target.productIds?.includes(productId));
    if (missing.length > 0) {
      throw new BusinessException(`Reseller ${target.code} does not sell product(s) ${missing.join(', ')}.`, "RESELLER_PRODUCT_NOT_ENABLED", { productIds: missing });
    }
    return resellerPath;
  }

  /**
   * Realigns the copies of a company when they change: name and VAT number on the open orders, name on the
   * contracts. A failure is logged and does not undo the update.
   * @param before the company as it was.
   * @param after the company as updated.
   */
  private async _syncCompanyCopies(before: Company, after: Company): Promise<void> {
    const name = after.name;
    const nameChanged = name !== before.name;
    if (!nameChanged && after.vatNumber === before.vatNumber) {
      return;
    }
    try {
      const ordersService = await this._loadOrdersService();
      await ordersService.syncCompanyDetails(after.id, name, after.vatNumber);
    } catch (error) {
      this._logger.error(`Company ${after.id} updated, but its open orders could not be realigned`, error);
    }
    if (!nameChanged) {
      return;
    }
    try {
      const contractsService = await this._loadContractsService();
      await contractsService.syncCompanyName(after.id, name);
    } catch (error) {
      this._logger.error(`Company ${after.id} updated, but its contracts could not be realigned`, error);
    }
  }


  /**
   * Lists one page of the companies visible to the requester: every company
   * for a collaborator, the subtree's companies for a reseller or for a
   * collaborator previewing its workspace, read off the resellerPathIndex GSI.
   * @param query the page and its filters.
   * @param scope the request scope.
   * @returns the page of companies.
   * @throws ValidationException if the cursor is not valid.
   */
  async listCompanies(query: CompaniesPageQueryDto, scope: RequestScope): Promise<ResponseCompaniesPageDto> {
    const { limit, cursor, status, name, email, channel } = query;
    try {
      // A collaborator previewing a reseller workspace reads that reseller's companies like the reseller does.
      const previewPath = isUnrestricted(scope) && query.resellerCode
        ? await (await this._loadResellersService()).getResellerPath(query.resellerCode)
        : undefined;
      const viewerPath = isUnrestricted(scope) ? previewPath : await this._resolveScopePath(scope);
      if ((!isUnrestricted(scope) || query.resellerCode) && !viewerPath) {
        return { items: [] };
      }
      // A reseller subtree holds no direct company.
      if (viewerPath && channel === SalesChannel.Direct) {
        return { items: [] };
      }
      const page = viewerPath
        ? await paginate<Company>(
          () => this._companyModel.query("rootResellerCode").eq(viewerPath.split('#')[0]).where("resellerPath").beginsWith(viewerPath).using("resellerPathIndex"),
          ["id", "rootResellerCode", "resellerPath"],
          limit,
          cursor,
          company =>
            (!status?.length || status.includes(company.status))
            && startsWithAny(name, company.name, company.vatNumber)
            && startsWithAny(email, company.email),
        )
        : await this._listAllCompanies({ name, email, status, channel }, limit, cursor);
      return { items: page.items.map(company => plainToInstance(ResponseCompanyDto, this._withoutTwinsFor(company, scope))), nextCursor: page.nextCursor };
    } catch (error) {
      if (error instanceof ValidationException) {
        throw error;
      }
      this._logger.error("Error listing companies", error);
      throw new DatabaseException("An error occurred while retrieving companies.", error);
    }
  }

  /**
   * Lists one page of every company, for a collaborator, on the index of the filter given, the two channels merged in
   * the order of its sort key: a complete VAT number by equality on vatIndex, an email on emailSearchIndex, statuses
   * on statusNameIndex (with the name as prefix), a name or nothing on nameIndex. A shorter numeric prefix searches
   * the name. A channel given reads its partition only. The filters the index does not hold are checked on the rows
   * it returns.
   * @param query the filters of the list.
   * @param limit the page size.
   * @param cursor the cursor of the page, absent for the first one.
   * @returns the page of companies.
   * @throws ValidationException if the cursor is not valid.
   */
  private async _listAllCompanies(
    query: Pick<CompaniesPageQueryDto, "name" | "email" | "status" | "channel">,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<Company>> {
    const { name, email, status, channel } = query;
    const prefix = name ? normalizeSearchText(name) : "";
    const emailPrefix = email ? normalizeSearchText(email) : "";
    const acceptOthers = (company: Company): boolean =>
      (!status?.length || status.includes(company.status))
      && (!channel || company.channel === channel)
      && startsWithAny(email, company.email);

    // The search text is the VAT number here, so the name is not checked.
    const vatDigits = name?.replace(/\s/g, "").match(FULL_VAT_NUMBER)?.[1];
    if (vatDigits) {
      const matches = await Promise.all([vatDigits, `IT${vatDigits}`].map(vatNumber =>
        this._companyModel.query("vatNumber").eq(vatNumber).using("vatIndex").exec()));
      return { items: matches.flat().filter(acceptOthers) };
    }

    // The index read, its sort key and the prefix of each partition, by the most selective filter given.
    const [index, sortKey, prefixes] = emailPrefix
      ? ["emailSearchIndex", "normalizedEmail", [emailPrefix]] as const
      : status?.length
        ? ["statusNameIndex", "statusName", status.map(companyStatus => `${companyStatus}#${prefix}`)] as const
        : ["nameIndex", "normalizedName", [prefix]] as const;

    const channels = channel ? [channel] : Object.values(SalesChannel);
    const partitions = channels.flatMap(partitionChannel => prefixes.map(keyPrefix => ({
      id: `${partitionChannel}#${keyPrefix}`,
      build: () => {
        const partition = this._companyModel.query("channel").eq(partitionChannel);
        return (keyPrefix ? partition.where(sortKey).beginsWith(keyPrefix) : partition).using(index);
      },
    })));
    return paginateMerged<Company>(
      partitions,
      ["id", "channel", sortKey],
      // Byte order of the sort key, as the partitions come; equal keys keep their order, since the sort is stable.
      (a, b) => byCodeUnits(a[sortKey] ?? "", b[sortKey] ?? ""),
      limit,
      cursor,
      company => acceptOthers(company) && startsWithAny(name, company.name),
    );
  }

  /**
   * Retrieves a company by its ID.
   * @param id the identifier of the company to retrieve.
   * @returns the retrieved company.
   */
  async getCompany(id: string, scope: RequestScope): Promise<ResponseCompanyDto> {
    try {
      this._logger.log(`Retrieving company with ID: ${id}`);
      const company = await this._companyModel.get({ id });
      if (!company) {
        this._logger.warn(`Company with ID: ${id} not found.`);
        throw new EntityNotFoundException('Company', id);
      }

      // Resellers can only see companies of their own subtree.
      const viewerPath = await this._resolveScopePath(scope);
      assertPathVisible(scope, viewerPath, company.resellerPath, `Company ${id}`);

      this._logger.log(`Company with ID: ${id} retrieved successfully.`);
      return plainToInstance(ResponseCompanyDto, await this._withVisibleTwins(company, scope, viewerPath));

    } catch (error) {
      this._logger.error(`Error retrieving company with ID: ${id}`, error);
      if (error instanceof EntityNotFoundException || error instanceof AuthorizationException) {
        throw error;
      }
      throw new DatabaseException(`An error occurred while retrieving the company with ID: ${id}.`, error);
    }
  }

  /**
   * Deletes a company by its ID.
   * @param id the identifier of the company to delete.
   * @returns void.
   */
  async deleteCompany(id: string, scope: RequestScope): Promise<void> {
    try {
      // Resellers can only delete companies of their own subtree.
      if (!isUnrestricted(scope)) {
        const existingCompany = await this._companyModel.get({ id });
        const viewerPath = await this._resolveScopePath(scope);
        assertPathVisible(scope, viewerPath, existingCompany?.resellerPath, `Company ${id}`);
      }

      this._logger.log(`Deleting company with ID: ${id}`);
      await this._companyModel.delete({ id });
      this._logger.log(`Company with ID: ${id} deleted successfully`);

    } catch (error) {
      this._logger.error(`Error deleting company with ID: ${id}`, error);
      if (error instanceof AuthorizationException) {
        throw error;
      }
      throw new DatabaseException(`An error occurred while deleting the company with ID: ${id}.`, error);
    }
  }
}
