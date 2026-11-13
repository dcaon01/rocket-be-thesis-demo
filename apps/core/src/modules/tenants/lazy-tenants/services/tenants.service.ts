import { Injectable, Logger } from "@nestjs/common";
import { isUnrestricted, RequestScope, SYSTEM_SCOPE } from "@rocket-be/scoping";
import { paginate, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { TenantsPageQueryDto } from "../../dtos/tenants-page-query.dto";
import { ResponseTenantsPageDto } from "../../dtos/response-tenants-page.dto";
import { assertCollaborator, assertPathVisible, isPathVisible } from "../../../../commons/scoping/scoped-access.helper";
import { AppException } from "../../../../errors/exception-types";
import { LazyModuleLoader } from "@nestjs/core";
import { InjectModel, Model } from "nestjs-dynamoose";
import { Condition, transaction } from "dynamoose";
import { Tenant, TenantKey } from "../../schemas/tenant.schema";
import { CreateTenantDto } from "../../dtos/create-tenant.dto";
import { ResponseTenantDto } from "../../dtos/response-tenant.dto";
import { UpdateTenantDto } from "../../dtos/update-tenant.dto";
import { DatabaseException, EntityNotFoundException, ValidationException, BusinessException } from "../../../../errors/exception-types";
import { plainToInstance } from "class-transformer";
import { v4 as uuidv4 } from "uuid";
import { SyncState } from "../../../../commons/enums/sync-state.enum";
import { TenantStatus } from "../../enums/tenant-status.enum";
import { StructureTypeCheckService } from "../../../products/lazy-products/services/structure-type-check.service";
import { ProductsService } from "../../../products/lazy-products/services/products.service";
import { ContractsService } from "../../../contracts/lazy-contracts/services/contracts.service";
import { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import { TrialsService } from "../../../trials/lazy-trials/services/trials.service";
import { UsersService } from "../../../users/lazy-users/services/users.service";
import type { User } from "../../../users/schemas/user.schema";
import { EventBridgeService } from "../../../event-bridge/lazy-event-bridge/services/event-bridge.service";
import { OperationEnum } from "../../../../commons/enums/operation.enum";
import { AccountType } from "../../../../commons/enums/account-type.enum";
import { UsersLimitType } from "../../../trials/enums/users-limit-type.enum";
import { EntityTypeEnum } from "../../../../commons/enums/entity-type.enum";
import { toDynamooseUpdate } from "../../../../commons/persistence/removable-update.helper";
import { PendingOperationKind, TENANT_OPERATION_KINDS } from "../../../pending-operations/enums/pending-operation-kind.enum";
import { ResponsePendingOperationDto } from "../../../pending-operations/dtos/response-pending-operation.dto";
import { PendingOperationState } from "../../../pending-operations/enums/pending-operation-state.enum";
import { PendingOperationsService, TransactionWrite } from "../../../pending-operations/lazy-pending-operations/services/pending-operations.service";
import { PendingOperation, PendingOperationKey } from "../../../pending-operations/schemas/pending-operation.schema";
import { OrdersService } from "../../../orders/lazy-orders/services/orders.service";
import type { TenantPayloadDto } from "../../dtos/tenant-payload.dto";
import { isConditionalCheckFailed, isTransactionCanceled } from "../../../../commons/persistence/write-errors.helper";

/** A tenant request ready to be committed: the record, its pending operation and the writes that store both. */
export interface TenantRequest {
  /** The tenant in REQUESTED, with the id Rocket decided. */
  tenant: Tenant;
  /** The operation that asks the product to create it. */
  operation: PendingOperation;
  /** The writes of the record and of the operation, for one transaction. */
  writes: TransactionWrite[];
}

/** Settings of the creation that replaces a tenant the product deleted, keeping its id. */
const REPLACE_DELETED_TENANT = { overwrite: true, condition: new Condition().where('status').eq(TenantStatus.Deleted) };

/**
 * Service for managing tenants.
 *
 * A tenant Rocket asks for is written at once in REQUESTED, in the same transaction as the
 * pending operation that asks the product to create it, with an id Rocket decides. The
 * product's answer comes back on the SQS inbound queue with `metadata.rocketOperationId`:
 * an error moves the tenant to FAILED, a confirmation to ACTIVE, rewritten under the
 * product's own id when the product keys it differently. A tenant the product creates on
 * its own initiative arrives without `rocketOperationId` and is created as it comes.
 */
@Injectable()
export class TenantsService {
  /** Logger instance for TenantsService. */
  private readonly _logger = new Logger(TenantsService.name);

  /** Lazy-loaded products service */
  private _productsService: ProductsService | null = null;

  /** Lazy-loaded structure type check service */
  private _structureTypeCheckService: StructureTypeCheckService | null = null;

  /** Lazy-loaded contracts service */
  private _contractsService: ContractsService | null = null;

  /** Lazy-loaded resellers service */
  private _resellersService: ResellersService | null = null;

  /** Lazy-loaded trials service */
  private _trialsService: TrialsService | null = null;

  /** Lazy-loaded users service */
  private _usersService: UsersService | null = null;

  /** Lazy-loaded event bridge service */
  private _eventBridgeService: EventBridgeService | null = null;

  /** Lazy-loaded pending operations service. */
  private _pendingOperationsService: PendingOperationsService | null = null;

  /** Lazy-loaded orders service. */
  private _ordersService: OrdersService | null = null;

  /**
   * Constructor for TenantsService.
   */
  constructor(
    @InjectModel("Tenant")
    private readonly _tenantModel: Model<Tenant, TenantKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

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
   * Lazy loads the StructureTypeCheckService from its module.
   * @returns A Promise resolving to the StructureTypeCheckService instance.
   */
  private async _loadStructureTypeCheckService(): Promise<StructureTypeCheckService> {
    if (!this._structureTypeCheckService) {
      const { ProductsLazyModule } = await import(
        "../../../products/lazy-products/products-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ProductsLazyModule,
      );
      this._structureTypeCheckService = moduleRef.get<StructureTypeCheckService>(StructureTypeCheckService);
    }
    return this._structureTypeCheckService;
  }

  /**
   * Lazy loads the ContractsService from its module.
   * @returns A Promise resolving to the ContractsService instance.
   */
  private async _loadContractsService(): Promise<ContractsService> {
    if (!this._contractsService) {
      const { ContractsLazyModule } = await import(
        "../../../contracts/lazy-contracts/contracts-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ContractsLazyModule,
      );
      this._contractsService = moduleRef.get<ContractsService>(ContractsService);
    }
    return this._contractsService;
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
      const moduleRef = await this._lazyModuleLoader.load(() => ResellersLazyModule);
      this._resellersService = moduleRef.get<ResellersService>(ResellersService);
    }
    return this._resellersService;
  }

  /**
   * Lazy loads the TrialsService from its module.
   * @returns A Promise resolving to the TrialsService instance.
   */
  private async _loadTrialsService(): Promise<TrialsService> {
    if (!this._trialsService) {
      const { TrialsLazyModule } = await import(
        "../../../trials/lazy-trials/trials-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => TrialsLazyModule,
      );
      this._trialsService = moduleRef.get<TrialsService>(TrialsService);
    }
    return this._trialsService;
  }

  /**
   * Lazy loads the UsersService from its module.
   * @returns A Promise resolving to the UsersService instance.
   */
  private async _loadUsersService(): Promise<UsersService> {
    if (!this._usersService) {
      const { UsersLazyModule } = await import(
        "../../../users/lazy-users/users-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => UsersLazyModule,
      );
      this._usersService = moduleRef.get<UsersService>(UsersService);
    }
    return this._usersService;
  }

  /**
   * Lazy loads the EventBridgeService from its module.
   * @returns A Promise resolving to the EventBridgeService instance.
   */
  private async _loadEventBridgeService(): Promise<EventBridgeService> {
    if (!this._eventBridgeService) {
      const { EventBridgeLazyModule } = await import(
        "../../../event-bridge/lazy-event-bridge/event-bridge-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => EventBridgeLazyModule,
      );
      this._eventBridgeService = moduleRef.get<EventBridgeService>(EventBridgeService);
    }
    return this._eventBridgeService;
  }

  /**
   * Resolves the requesting reseller's materialized path (undefined for
   * unrestricted scopes: collaborators / system).
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
   * Queries the whole reseller subtree of tenants with a single begins_with on
   * the resellerPathIndex LSI.
   * @param productId the product ID to filter tenants by.
   * @param viewerPath the requester's reseller path (e.g. "RVD-001#").
   * @returns the tenants whose issuer lineage is within the viewer's subtree.
   */
  private async _queryTenantsByResellerPath(productId: string, viewerPath: string): Promise<Tenant[]> {
    return await this._tenantModel
      .query("productId").eq(productId)
      .where("resellerPath").beginsWith(viewerPath)
      .using("resellerPathIndex")
      .exec();
  }

  /**
   * Counts the active tenants activated by a professional on a product,
   * using the issuerIndex LSI. Used for license metering and reseller invoicing.
   * @param productId the product ID.
   * @param issuerId the professional whose tenants are counted.
   * @returns the number of active tenants activated by the professional.
   */
  async countTenantsByIssuer(productId: string, issuerId: string): Promise<number> {
    try {
      const tenants = await this._tenantModel
        .query("productId").eq(productId)
        .where("issuerId").eq(issuerId)
        .using("issuerIndex")
        .exec();
      return tenants.filter(tenant => tenant.status === TenantStatus.Active).length;
    } catch (error) {
      this._logger.error(`Error counting tenants activated by ${issuerId} for product ID: ${productId}`, error);
      throw new DatabaseException('An error occurred while counting the tenants by issuer.', error);
    }
  }

  /**
   * Creates a tenant the product created on its own initiative, as it arrives from the product.
   * A tenant that already exists under that id is returned as it is, so a repeated message is harmless.
   * @param tenant the DTO with the information to create a new tenant.
   * @returns the created tenant.
   */
  async createTenant(tenant: CreateTenantDto): Promise<ResponseTenantDto> {
    try {
      this._validateTenantSource(tenant);

      let historySince: string | undefined;
      if (tenant.id) {
        const existingTenant = await this._tenantModel.get({ productId: tenant.productId, id: tenant.id });
        if (existingTenant && existingTenant.status !== TenantStatus.Deleted) {
          this._logger.log(`Tenant with ID: ${tenant.id} already exists; creation skipped.`);
          return plainToInstance(ResponseTenantDto, existingTenant);
        }
        // A tenant deleted on the product frees its id (O2 derives it from the name): the new one replaces it.
        if (existingTenant) {
          historySince = new Date().toISOString();
        }
      }

      const productsService = await this._loadProductsService();
      const structureTypeCheckService = await this._loadStructureTypeCheckService();
      const product = await productsService.getProduct(tenant.productId);

      // Validate tenant data structure against product tenantStructure.
      const isValid = structureTypeCheckService.checkType(
        tenant.data,
        product.tenantStructure
      );
      if (!isValid) {
        this._logger.warn(`Tenant data structure is invalid for product ID: ${tenant.productId}`);
        throw new ValidationException('Tenant data structure does not match the product tenant structure.', []);
      }

      const id = tenant.id ?? uuidv4();

      const resellerPath = await this._resolveResellerPath(tenant);

      const newTenant: Tenant = {
        ...tenant,
        id,
        status: TenantStatus.Active,
        syncState: SyncState.InSync,
        activeUsers: 0,
        accountType: tenant.accountType ?? AccountType.Company,
        maxConstraintValue: tenant.maxConstraintValue ?? 5,
        monthIndex: new Date().toISOString().slice(0, 7),
        ...(resellerPath && { resellerPath }),
        ...(historySince && { historySince }),
      }

      this._logger.log(`Creating tenant with ID: ${id}`, newTenant);
      const createdTenant = historySince
        ? await this._tenantModel.create(newTenant, { ...REPLACE_DELETED_TENANT, return: 'item' })
        : await this._tenantModel.create(newTenant);
      this._logger.log(`Tenant with ID: ${id} created successfully.`);

      await this._afterTenantCreated(createdTenant);

      return plainToInstance(ResponseTenantDto, createdTenant);

    } catch (error) {
      this._logger.error('Error creating tenant', error);
      if (error instanceof ValidationException || error instanceof EntityNotFoundException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while creating the tenant.', error);
    }
  }

  /**
   * Prepares a tenant request: validates it, decides the id and builds the REQUESTED record and its pending operation.
   * Nothing is written: the caller commits `writes` in one transaction, possibly with writes of its own, and then dispatches the operation.
   * @param tenant the tenant to ask the product for.
   * @param context the reseller lineage when the caller already knows it (the order line), resolved from the source
   * otherwise; `pendingUsers` when users are asked with the tenant, so that the last one settled provisions the line;
   * `requestedBy`, the operator asking for it.
   * @returns the record, the operation and their writes.
   * @throws ValidationException if the source is missing or the data do not match the product's tenant structure.
   */
  async prepareTenantRequest(
    tenant: CreateTenantDto,
    context: { resellerPath?: string; pendingUsers?: number; requestedBy?: string } = {},
  ): Promise<TenantRequest> {
    this._validateTenantSource(tenant);

    const productsService = await this._loadProductsService();
    const structureTypeCheckService = await this._loadStructureTypeCheckService();
    const product = await productsService.getProduct(tenant.productId);
    // Generated fields are filled by the product, so a request cannot carry them yet.
    const requestStructure = product.tenantStructure.filter(field => !field.generated);
    if (!structureTypeCheckService.checkType(tenant.data, requestStructure)) {
      this._logger.warn(`Tenant data structure is invalid for product ID: ${tenant.productId}`);
      throw new ValidationException('Tenant data structure does not match the product tenant structure.', []);
    }

    const id = uuidv4();
    const resellerPath = context.resellerPath ?? await this._resolveResellerPath(tenant);
    const pendingOperationsService = await this._loadPendingOperationsService();
    const { operation, write } = pendingOperationsService.createWrite({
      productId: tenant.productId,
      kind: PendingOperationKind.CreateTenant,
      targetId: id,
      requestedBy: context.requestedBy,
      buildNotification: operationId => ({
        productId: tenant.productId,
        operation: OperationEnum.Create,
        entityType: EntityTypeEnum.Tenant,
        payload: [this._tenantRequestPayload({ ...tenant, id }, operationId)],
      }),
    });

    const { id: _requestedId, ...fields } = tenant;
    const record: Tenant = {
      ...fields,
      id,
      status: TenantStatus.Requested,
      activeUsers: 0,
      accountType: tenant.accountType ?? AccountType.Company,
      maxConstraintValue: tenant.maxConstraintValue ?? 5,
      monthIndex: new Date().toISOString().slice(0, 7),
      pendingOperationId: operation.id,
      syncState: SyncState.Pending,
      ...(resellerPath && { resellerPath }),
      ...(context.pendingUsers && { pendingUsers: context.pendingUsers }),
    };
    return { tenant: record, operation, writes: [this._tenantModel.transaction.create(record), write] };
  }

  /**
   * Records the product's answer to a tenant request, found through `metadata.rocketOperationId`.
   * An error leaves the tenant REQUESTED with `syncState` FAILED. A confirmation moves it to ACTIVE, merging the product's data,
   * and rewrites it under the product's id when that differs from Rocket's; a confirmation after a
   * cancellation still lands, flagged. An operation already confirmed is left alone.
   * @param productId the product that answered.
   * @param item the tenant as the product sent it back.
   * @returns the confirmed tenant, or null when nothing was confirmed.
   * @throws EntityNotFoundException if the tenant of the operation does not exist.
   */
  async confirmTenantRequest(productId: string, item: TenantPayloadDto): Promise<Tenant | null> {
    const pendingOperationsService = await this._loadPendingOperationsService();
    const operationKey = { productId, id: String(item.metadata?.rocketOperationId) };
    const operation = await pendingOperationsService.find(operationKey);
    // An unknown operation would never be found by retrying the message: it is dropped, not sent to the dead-letter queue.
    if (!operation) {
      this._logger.warn(`Tenant answer from product ${productId} names unknown operation ${operationKey.id}; answer dropped.`);
      return null;
    }
    if (operation.state === PendingOperationState.Done) {
      this._logger.log(`Tenant request ${operation.id} already confirmed; answer ignored.`);
      return null;
    }

    const tenant = await this._tenantModel.get({ productId, id: operation.targetId }, { consistent: true, return: 'item' });
    if (!tenant) {
      throw new EntityNotFoundException('Tenant', operation.targetId);
    }
    const sameStatus = { condition: new Condition().where('status').eq(tenant.status) };

    if (item.error) {
      try {
        const writes = [pendingOperationsService.failWrite(operationKey, item.error.message)];
        // A cancelled tenant stays as it is: the operator already discarded it.
        if (tenant.status === TenantStatus.Requested) {
          writes.push(this._tenantModel.transaction.update(
            { productId, id: tenant.id },
            { syncState: SyncState.Failed, failureReason: item.error.message },
            sameStatus,
          ));
        }
        await transaction(writes);
      } catch (error) {
        return this._answerNotRecorded(operation.id, error);
      }
      await pendingOperationsService.cancelSchedule(operation.id);
      this._logger.warn(`Tenant request ${operation.id} failed on product ${productId}: ${item.error.message}`);
      return null;
    }

    const id = item.id ?? tenant.id;
    const confirmation = {
      name: item.name ?? tenant.name,
      data: { ...tenant.data, ...(item.data ?? {}) },
      status: TenantStatus.Active,
      syncState: SyncState.InSync,
      ...(tenant.status === TenantStatus.Cancelled && { confirmedAfterCancellation: true }),
    };
    const { failureReason: _failureReason, ...kept } = JSON.parse(JSON.stringify(tenant)) as Tenant;
    const confirmed: Tenant = { ...kept, ...confirmation, id };
    // Under the product's id there may be a tenant it deleted: the new one replaces it, with a history of its own.
    const replaced = id !== tenant.id ? await this._tenantModel.get({ productId, id }, { consistent: true, return: 'item' }) : undefined;
    if (replaced?.status === TenantStatus.Deleted) {
      confirmed.historySince = new Date().toISOString();
    }

    // The users asked together with the tenant are released in the same transaction, under the tenant's id on the product.
    const usersService = await this._loadUsersService();
    const release = await usersService.prepareUserRelease(productId, tenant.id, id);
    try {
      // A key cannot change in place: under the product's own id the record is deleted and written again.
      const recordWrites = id === tenant.id
        ? [this._tenantModel.transaction.update({ productId, id }, toDynamooseUpdate<Tenant>(confirmation, ['failureReason']), sameStatus)]
        : [
          this._tenantModel.transaction.delete({ productId, id: tenant.id }, sameStatus),
          this._tenantModel.transaction.create(confirmed, confirmed.historySince ? REPLACE_DELETED_TENANT : undefined),
        ];
      // The order line points at the tenant, so it follows the new id in the same transaction.
      const lineWrites = tenant.orderId && id !== tenant.id
        ? await (await this._loadOrdersService()).lineTenantWrites(productId, tenant.orderId, tenant.id, id)
        : [];
      await transaction([...recordWrites, ...lineWrites, ...release.writes, pendingOperationsService.resolveWrite(operationKey, id)]);
    } catch (error) {
      return this._answerNotRecorded(operation.id, error);
    }
    await pendingOperationsService.cancelSchedule(operation.id);
    this._logger.log(`Tenant request ${operation.id} confirmed by product ${productId} as tenant ${id}.`);

    await this._afterTenantCreated(confirmed);
    await pendingOperationsService.release(release.operations);
    return confirmed;
  }

  /**
   * Sends again the open operation of a tenant (its creation, a change or a deletion), reopening it when the product
   * had answered with an error.
   * @param productId the product of the tenant.
   * @param id the identifier of the tenant.
   * @param scope the request scope.
   * @returns the tenant, waiting for the product again.
   * @throws BusinessException if the tenant has no open operation.
   */
  async resendTenantRequest(productId: string, id: string, scope: RequestScope): Promise<ResponseTenantDto> {
    const tenant = await this.getTenant(productId, id, scope);
    const isOpen = tenant.status === TenantStatus.Requested || [SyncState.Pending, SyncState.Failed].includes(tenant.syncState);
    if (!tenant.pendingOperationId || !isOpen) {
      throw new BusinessException('Only a tenant with an operation waiting for the product, or failed, can be sent again.', 'TENANT_NOT_PENDING');
    }
    try {
      const recordWrites = tenant.syncState === SyncState.Failed
        ? [this._tenantModel.transaction.update(
          { productId, id },
          toDynamooseUpdate<Tenant>({ syncState: SyncState.Pending }, ['failureReason']),
          { condition: new Condition().where('syncState').eq(SyncState.Failed) },
        )]
        : [];
      const pendingOperationsService = await this._loadPendingOperationsService();
      await pendingOperationsService.resend({ productId, id: tenant.pendingOperationId }, recordWrites);
      this._logger.log(`Tenant request for tenant ${id} sent again to product ${productId}.`);
      return await this.getTenant(productId, id, scope);
    } catch (error) {
      if (error instanceof AppException) throw error;
      this._logger.error(`Error sending again the request of tenant ${id}`, error);
      throw new DatabaseException('An error occurred while sending the tenant request again.', error);
    }
  }

  /**
   * Discards the operation of a tenant the product answered with an error. A discarded creation marks the tenant
   * CANCELLED, not deleted, together with the users waiting for it; a discarded change or deletion leaves the tenant
   * as it is on the product. An operation without an answer is never discarded, since the product may have carried
   * it out: it is only sent again.
   * @param productId the product of the tenant.
   * @param id the identifier of the tenant.
   * @param scope the request scope.
   * @returns the tenant.
   * @throws BusinessException if the product has not answered the operation with an error, or the tenant changed meanwhile.
   */
  async cancelTenantRequest(productId: string, id: string, scope: RequestScope): Promise<ResponseTenantDto> {
    const tenant = await this.getTenant(productId, id, scope);
    if (!tenant.pendingOperationId || tenant.syncState !== SyncState.Failed) {
      throw new BusinessException('Only an operation the product answered with an error can be discarded.', 'TENANT_NOT_FAILED');
    }
    const isCreation = tenant.status === TenantStatus.Requested;
    try {
      const pendingOperationsService = await this._loadPendingOperationsService();
      // The users asked together with the tenant would wait forever: they are discarded with it.
      const usersService = await this._loadUsersService();
      const userWrites = isCreation ? await usersService.cancelWritesOfTenant(productId, id) : [];
      await transaction([
        this._tenantModel.transaction.update(
          { productId, id },
          toDynamooseUpdate<Tenant>({ ...(isCreation && { status: TenantStatus.Cancelled }), syncState: SyncState.InSync }, ['failureReason']),
          { condition: new Condition().where('syncState').eq(SyncState.Failed) },
        ),
        pendingOperationsService.abandonWrite({ productId, id: tenant.pendingOperationId }),
        ...userWrites,
      ]);
      await pendingOperationsService.cancelSchedule(tenant.pendingOperationId);
      this._logger.log(`Tenant request for tenant ${id} of product ${productId} cancelled.`);
      return await this.getTenant(productId, id, scope);
    } catch (error) {
      if (error instanceof AppException) throw error;
      if (isTransactionCanceled(error)) {
        throw new BusinessException('The tenant changed while it was being cancelled: reload it.', 'REQUEST_CHANGED');
      }
      this._logger.error(`Error cancelling the request of tenant ${id}`, error);
      throw new DatabaseException('An error occurred while cancelling the tenant request.', error);
    }
  }

  /**
   * Lists the operations sent to the product for a tenant, newest first: its history.
   * @param productId the product of the tenant.
   * @param id the identifier of the tenant.
   * @param scope the request scope.
   * @returns the operations of the tenant.
   * @throws EntityNotFoundException if the tenant does not exist.
   */
  async listTenantOperations(productId: string, id: string, scope: RequestScope): Promise<ResponsePendingOperationDto[]> {
    // Read first for its visibility to the caller.
    await this.getTenant(productId, id, scope);
    const tenant = await this._tenantModel.get({ productId, id });
    const pendingOperationsService = await this._loadPendingOperationsService();
    return pendingOperationsService.listByTarget(productId, id, TENANT_OPERATION_KINDS, tenant?.historySince);
  }

  /**
   * Checks that the tenant is on the product, so that the operator can change or delete it.
   * @param productId the product of the tenant.
   * @param id the identifier of the tenant.
   * @param scope the caller's scope.
   * @returns the tenant.
   * @throws BusinessException if the tenant is requested, failed or cancelled.
   */
  async assertTenantOnProduct(productId: string, id: string, scope: RequestScope): Promise<ResponseTenantDto> {
    const tenant = await this.getTenant(productId, id, scope);
    if (![TenantStatus.Active, TenantStatus.Inactive].includes(tenant.status)) {
      throw new BusinessException('Only an active or inactive tenant can be changed: the product has not created this one.', 'TENANT_NOT_ON_PRODUCT');
    }
    return tenant;
  }

  /**
   * Builds the write that points a tenant at the contract born with the provisioning of its order line.
   * @param productId the product of the tenant.
   * @param tenantId the identifier of the tenant on the product.
   * @param contractId the contract governing the tenant.
   * @param contractCode the code of the contract.
   * @returns the transaction write.
   */
  contractLinkWrite(productId: string, tenantId: string, contractId: string, contractCode: string): TransactionWrite {
    return this._tenantModel.transaction.update({ productId, id: tenantId }, { contractId, contractCode });
  }

  /**
   * Builds the write that hands an existing tenant to the order line about to provision it: the tenant takes the
   * order and the seats of the line, at least its active users, and leaves its terminated contract, which keeps the
   * tenant in its own record. Until the new contract is linked, users arriving are counted on the order.
   * The write fails if the tenant's status or contract changed since it was read.
   * @param tenant the tenant as read.
   * @param orderId the order of the line.
   * @param seats the seats sold on the line, if its plan counts them.
   * @returns the transaction write.
   */
  orderHandoverWrite(tenant: ResponseTenantDto, orderId: string, seats?: number): TransactionWrite {
    const condition = new Condition().where('status').eq(tenant.status).and();
    return this._tenantModel.transaction.update(
      { productId: tenant.productId, id: tenant.id },
      toDynamooseUpdate<Tenant>({ orderId, maxConstraintValue: Math.max(seats ?? 0, tenant.activeUsers) }, ['contractId', 'contractCode']),
      { condition: tenant.contractId ? condition.where('contractId').eq(tenant.contractId) : condition.where('contractId').not().exists() },
    );
  }

  /**
   * Builds the writes that give back the seat of an active user deleted on the product, for the user's transaction.
   * On a tenant with a contract the deletion is also recorded on the contract, with its date (UR-RK-403); the seats
   * billed stay at the highest count reached. A tenant with no seat taken gets no write.
   * @param productId the product of the tenant.
   * @param tenantId the identifier of the tenant on the product.
   * @returns the atomic subtraction and the record on the contract, or none.
   * @throws DatabaseException if the tenant cannot be read.
   */
  async releaseSeatWrites(productId: string, tenantId: string): Promise<TransactionWrite[]> {
    let tenant: Tenant | undefined;
    try {
      tenant = await this._tenantModel.get({ productId, id: tenantId });
    } catch (error) {
      this._logger.error(`Error reading tenant ${tenantId} to give back a seat`, error);
      throw new DatabaseException('An error occurred while giving back a seat of the tenant.', error);
    }
    if (!tenant?.activeUsers) return [];
    const writes: TransactionWrite[] = [this._tenantModel.transaction.update(
      { productId, id: tenantId },
      { $ADD: { activeUsers: -1 } },
      { condition: new Condition().where('activeUsers').gt(0) },
    )];
    if (tenant.contractId) {
      const contractsService = await this._loadContractsService();
      writes.push(contractsService.userRemovedWrite(productId, tenant.contractId, tenant.activeUsers - 1, tenant.maxConstraintValue));
    }
    return writes;
  }

  /**
   * Builds the write that counts one more user of a provisioning as settled (confirmed or given up), for the
   * transaction that confirms or cancels the user. A tenant not waiting for users gets no write.
   * @param productId the product of the tenant.
   * @param tenantId the identifier of the tenant on the product.
   * @returns the atomic subtraction, or none.
   * @throws DatabaseException if the tenant cannot be read.
   */
  async settleUserWrites(productId: string, tenantId: string): Promise<TransactionWrite[]> {
    let tenant: Tenant | undefined;
    try {
      tenant = await this._tenantModel.get({ productId, id: tenantId });
    } catch (error) {
      this._logger.error(`Error reading tenant ${tenantId} to settle a user`, error);
      throw new DatabaseException('An error occurred while settling a user of the tenant.', error);
    }
    if (!tenant?.pendingUsers) return [];
    return [this._tenantModel.transaction.update(
      { productId, id: tenantId },
      { $ADD: { pendingUsers: -1 } },
      { condition: new Condition().where('pendingUsers').gt(0) },
    )];
  }

  /**
   * Reads several tenants in one request, such as the ones of a page of order lines (at most 100, as DynamoDB allows).
   * @param keys the product and identifier of each tenant.
   * @returns the tenants found, in no particular order.
   * @throws DatabaseException if the read fails.
   */
  async getTenantsByKeys(keys: TenantKey[]): Promise<Tenant[]> {
    if (keys.length === 0) return [];
    try {
      return await this._tenantModel.batchGet(keys);
    } catch (error) {
      this._logger.error(`Error reading ${keys.length} tenants`, error);
      throw new DatabaseException('An error occurred while reading the tenants.', error);
    }
  }

  /**
   * Reads the order whose line a tenant provisions, once the tenant is active and every user asked with it is settled.
   * @param productId the product of the tenant.
   * @param tenantId the identifier of the tenant on the product.
   * @returns the order, or undefined while the provisioning is still open or the tenant does not come from an order.
   * @throws DatabaseException if the tenant cannot be read.
   */
  async settledProvisioningOrder(productId: string, tenantId: string): Promise<string | undefined> {
    try {
      const tenant = await this._tenantModel.get({ productId, id: tenantId });
      return tenant?.orderId && tenant.status === TenantStatus.Active && !tenant.pendingUsers ? tenant.orderId : undefined;
    } catch (error) {
      this._logger.error(`Error reading the provisioning of tenant ${tenantId}`, error);
      throw new DatabaseException('An error occurred while reading the provisioning of the tenant.', error);
    }
  }

  /**
   * Handles an answer that could not be recorded: a concurrent change of the request is not an error.
   * @param operationId the pending operation of the request.
   * @param error the error of the transaction.
   * @returns null, nothing having been confirmed.
   * @throws DatabaseException if the failure is not a concurrent change.
   */
  private _answerNotRecorded(operationId: string, error: unknown): null {
    if (isTransactionCanceled(error)) {
      this._logger.warn(`Tenant request ${operationId} changed while recording the answer; answer ignored.`);
      return null;
    }
    this._logger.error(`Error recording the answer to tenant request ${operationId}`, error);
    throw new DatabaseException('An error occurred while recording the answer to the tenant request.', error);
  }

  /**
   * Validates that a tenant has a source: a contract, a trial, an issuer, or the order line it provisions.
   * Professionals always get a tenant even without a contract or trial, so the issuer alone is a valid source;
   * a tenant provisioned from an order has no contract yet, which is born at first access.
   * @param tenant the tenant to validate.
   * @throws ValidationException if no source is given.
   */
  private _validateTenantSource(tenant: CreateTenantDto): void {
    if (!tenant.trialId && !tenant.issuerId && !tenant.orderId) {
      throw new ValidationException('At least one of trialId, issuerId or orderId must be provided.', []);
    }
  }

  /**
   * Resolves the reseller lineage of a tenant from its source (issuer or trial), so the tenant
   * and its users are reachable by a single begins_with subtree query. Best-effort: a lookup failure
   * leaves it unset instead of blocking the tenant.
   * @param tenant the tenant.
   * @returns the reseller path, or undefined for a Keus-direct tenant or a failed lookup.
   */
  private async _resolveResellerPath(tenant: CreateTenantDto): Promise<string | undefined> {
    try {
      if (tenant.issuerId) {
        const resellersService = await this._loadResellersService();
        return await resellersService.getResellerPath(tenant.issuerId);
      }
      if (tenant.trialId) {
        const trialsService = await this._loadTrialsService();
        const trial = await trialsService.getTrial(tenant.productId, tenant.trialId);
        return trial.resellerPath;
      }
    } catch (pathError) {
      this._logger.warn(`Could not resolve resellerPath for tenant of product ${tenant.productId}; leaving it unset.`, pathError);
    }
    return undefined;
  }

  /**
   * Runs what follows the birth of an active tenant: the redemption of its trial.
   * @param tenant the tenant just created or confirmed.
   */
  private async _afterTenantCreated(tenant: Tenant): Promise<void> {
    if (tenant.trialId) {
      const trialsService = await this._loadTrialsService();
      await trialsService.updateTrial(tenant.productId, tenant.trialId, { redeemed: true });
    }
  }

  /**
   * Builds the payload of a tenant request: the standard fields, the data, and the Rocket-only fields in `metadata`,
   * which the product sends back unchanged together with `rocketOperationId`.
   * @param tenant the tenant, with the id Rocket decided.
   * @param operationId the pending operation of the request.
   * @returns the payload item.
   */
  private _tenantRequestPayload(tenant: CreateTenantDto, operationId: string): TenantPayloadDto {
    const { productId: _productId, data, description, trialId, trialEmail, maxConstraintValue, issuerId, orderId, ...standard } = tenant;
    return {
      ...standard,
      data,
      metadata: { description, trialId, trialEmail, maxConstraintValue, issuerId, orderId, rocketOperationId: operationId },
    };
  }

  /**
   * Retrieves all tenants.
   * @returns the list of all tenants.
   */
  async getAllTenants(scope: RequestScope): Promise<ResponseTenantDto[]> {
    assertCollaborator(scope, 'getAllTenants');
    try {
      const tenants = (await this._tenantModel.scan().exec()).filter(tenant => tenant.status !== TenantStatus.Deleted);
      this._logger.log(`Retrieved ${tenants.length} tenants.`);
      return tenants.map(tenant => plainToInstance(ResponseTenantDto, tenant));

    } catch (error) {
      this._logger.error('Error retrieving products', error);
      throw new DatabaseException('An error occurred while retrieving the products.', error);
    }
  }

  /**
   * Lists one page of the tenants of a product; a reseller sees only those of its subtree, its salesperson included,
   * read off the reseller path index.
   * @param productId the product of the tenants.
   * @param query the page and its filters.
   * @param scope the request scope.
   * @returns the page of tenants.
   * @throws ValidationException if the cursor is not valid.
   */
  async listTenants(productId: string, query: TenantsPageQueryDto, scope: RequestScope): Promise<ResponseTenantsPageDto> {
    const { limit, cursor, status, search } = query;

    try {
      const viewerPath = isUnrestricted(scope) ? undefined : await this._resolveScopePath(scope);
      if (!isUnrestricted(scope) && !viewerPath) {
        return { items: [] };
      }

      const page = await paginate<Tenant>(
        () => viewerPath
          ? this._tenantModel.query("productId").eq(productId).where("resellerPath").beginsWith(viewerPath).using("resellerPathIndex")
          : this._tenantModel.query("productId").eq(productId),
        viewerPath ? ["productId", "id", "resellerPath"] : ["productId", "id"],
        limit,
        cursor,
        tenant =>
          (status?.length ? status.includes(tenant.status) : tenant.status !== TenantStatus.Deleted)
          && startsWithAny(search, tenant.name, tenant.contractCode, tenant.trialEmail),
      );
      return { items: page.items.map(tenant => plainToInstance(ResponseTenantDto, tenant)), nextCursor: page.nextCursor };
    } catch (error) {
      this._logger.error(`Error listing the tenants of product ${productId}`, error);
      if (error instanceof AppException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while retrieving the tenants.', error);
    }
  }


  /**
   * Retrieves all the tenants associated with a specific product.
   * @param productId the product ID to filter tenants by.
   * @returns a list of tenants associated with the specified app.
   */
  async getTenantsByProduct(productId: string, scope: RequestScope): Promise<ResponseTenantDto[]> {
    try {
      let scoped: Tenant[];
      if (isUnrestricted(scope)) {
        scoped = [...await this._tenantModel.query("productId").eq(productId).exec()];
      } else {
        // Reseller scope: a single begins_with on the materialized path returns
        // the whole subtree (own + descendants + their professionals) in one query.
        const viewerPath = await this._resolveScopePath(scope);
        scoped = viewerPath ? await this._queryTenantsByResellerPath(productId, viewerPath) : [];
      }
      scoped = scoped.filter(tenant => tenant.status !== TenantStatus.Deleted);
      this._logger.log(`Retrieved ${scoped.length} tenants for product ID: ${productId}.`);
      return scoped.map(tenant => plainToInstance(ResponseTenantDto, tenant));

    } catch (error) {
      this._logger.error(`Error retrieving tenants for product ID: ${productId}`, error);
      if (error instanceof AppException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while retrieving the tenants.', error);
    }
  }

  /**
   * Retrieves the tenants of a company on every product: the tenants of its contracts, terminated ones included,
   * since a tenant belongs to the company and outlives its contracts.
   * @param companyId the company of the tenants.
   * @param scope the request scope.
   * @returns the tenants of the company, by name.
   */
  async getTenantsByCompany(companyId: string, scope: RequestScope): Promise<ResponseTenantDto[]> {
    try {
      const contractsService = await this._loadContractsService();
      const contracts = await contractsService.getContractsByCompany(companyId, scope);

      const keys = new Map(contracts.map(contract => [`${contract.productId}#${contract.tenantId}`, { productId: contract.productId, id: contract.tenantId }]));
      const tenants = (await this.getTenantsByKeys([...keys.values()])).filter(tenant => tenant.status !== TenantStatus.Deleted);

      // A transfer leaves the terminated contracts with the old reseller and moves the tenant: its own path decides.
      const viewerPath = await this._resolveScopePath(scope);
      const visible = isUnrestricted(scope) ? tenants : tenants.filter(tenant => isPathVisible(viewerPath, tenant.resellerPath));

      this._logger.log(`Retrieved ${visible.length} tenants for company ID: ${companyId}.`);
      return visible
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(tenant => plainToInstance(ResponseTenantDto, tenant));

    } catch (error) {
      this._logger.error(`Error retrieving the tenants of company ${companyId}`, error);
      if (error instanceof AppException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while retrieving the tenants of the company.', error);
    }
  }

  /**
   * Retrieves a tenant by its ID.
   * @param productId the product ID.
   * @param id the identifier of the tenant.
   * @returns the tenant with the specified ID.
   */
  async getTenant(productId: string, id: string, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseTenantDto> {
    try {
      const tenant = await this._tenantModel.get({ productId, id }); // O(1)

      if (!tenant) {
        this._logger.warn(`Tenant with ID: ${id} for product ID: ${productId} not found.`);
        throw new EntityNotFoundException('Tenant', id);
      }

      if (!isUnrestricted(scope)) {
        const viewerPath = await this._resolveScopePath(scope);
        assertPathVisible(scope, viewerPath, tenant.resellerPath, `Tenant ${id}`);
      }

      this._logger.log(`Tenant with ID: ${id} for product ID: ${productId} retrieved successfully.`);
      return plainToInstance(ResponseTenantDto, tenant);

    } catch (error) {
      this._logger.error(`Error retrieving tenant with ID: ${id} for product ID: ${productId}`, error);
      if (error instanceof AppException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while retrieving the tenant.', error);
    }
  }

  /**
   * Updates a tenant by its ID.
   * @param productId the product ID.
   * @param id the identifier of the tenant.
   * @param tenant the information to update the tenant.
   * @returns the updated tenant.
   */
  async updateTenant(productId: string, id: string, tenant: UpdateTenantDto, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseTenantDto> {
    try {
      const existingTenant = await this._tenantModel.get({ productId, id });

      // Check if the tenant exists.
      if (!existingTenant) {
        this._logger.warn(`Tenant with ID: ${id} for product ID: ${productId} not found for update.`);
        throw new EntityNotFoundException('Tenant', id);
      }

      // Resellers can only touch tenants of their subtree.
      if (!isUnrestricted(scope)) {
        const viewerPath = await this._resolveScopePath(scope);
        assertPathVisible(scope, viewerPath, existingTenant.resellerPath, `Tenant ${id}`);
      }

      // Validate tenant data structure against product tenantStructure (only when data is provided).
      if (tenant.data) {
        const productsService = await this._loadProductsService();
        const structureTypeCheckService = await this._loadStructureTypeCheckService();
        const product = await productsService.getProduct(productId);
        const isValid = structureTypeCheckService.checkType(
          tenant.data,
          product.tenantStructure
        );
        if (!isValid) {
          this._logger.warn(`Tenant data structure is invalid for product ID: ${productId}`);
          throw new ValidationException('Tenant data structure does not match the product tenant structure.', []);
        }
      }

      // Proceed with the update.
      const plainUpdateTenant: Partial<Tenant> = JSON.parse(JSON.stringify(tenant)) as Partial<Tenant>;
      // accountType is immutable after creation (a professional/client tenant is
      // never converted): never let an update — including inbound event metadata — change it.
      delete plainUpdateTenant.accountType;
      this._logger.log(`Updating tenant with ID: ${id} for product ID: ${productId}`, plainUpdateTenant);
      const updatedTenantResult = await this._tenantModel.update({ productId, id }, plainUpdateTenant);

      // If tenant name changed, batch update tenantName on all users
      if (tenant.name && tenant.name !== existingTenant.name) {
        const usersService = await this._loadUsersService();
        await usersService.batchUpdateUsers(productId, id, { tenantName: tenant.name });
      }

      // Suspending or reactivating the tenant cascades to its users, as operations waiting for the product's answer.
      const isDeactivating = existingTenant.status === TenantStatus.Active && tenant.status === TenantStatus.Inactive;
      const isReactivating = existingTenant.status === TenantStatus.Inactive && tenant.status === TenantStatus.Active;
      if (isDeactivating || isReactivating) {
        const usersService = await this._loadUsersService();
        await usersService.requestStatusChanges(productId, id, isDeactivating, scope.system ? undefined : scope.sub);
      }

      return plainToInstance(ResponseTenantDto, updatedTenantResult);

    } catch(error) {
      this._logger.error(`Error updating tenant with ID: ${id} for product ID: ${productId}`, error);
      if (error instanceof EntityNotFoundException || error instanceof ValidationException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while updating the tenant.', error);
    }
  }

  /**
   * Moves a tenant and its users to another reseller, or to Keus, when its company is transferred (UR-RK-105). The
   * product is not told: it does not know the reseller. The users are rewritten every time, so a retry completes a
   * transfer that stopped after the tenant.
   * @param productId the product of the tenant.
   * @param id the identifier of the tenant.
   * @param resellerPath the path of the reseller it joins; absent when it joins Keus.
   * @throws EntityNotFoundException if the tenant does not exist.
   */
  async transferTenant(productId: string, id: string, resellerPath?: string): Promise<void> {
    const tenant = await this._tenantModel.get({ productId, id });
    if (!tenant) {
      throw new EntityNotFoundException('Tenant', id);
    }

    const lineage = resellerPath ? { resellerPath } : {};
    const removed = resellerPath ? [] : ['resellerPath'];
    if (tenant.resellerPath !== resellerPath) {
      await this._tenantModel.update({ productId, id }, toDynamooseUpdate<Tenant>(lineage, removed));
    }
    const usersService = await this._loadUsersService();
    await usersService.batchUpdateUsers(productId, id, toDynamooseUpdate<User>(lineage, removed));
    this._logger.log(`Tenant ${id} of product ${productId} moved to ${resellerPath ? `reseller path ${resellerPath}` : 'Keus'}.`);
  }

  /**
   * Increments the active users count for a tenant.
   * The count is raised with an atomic addition, so concurrent sign-ups on the same tenant never
   * lose an increment; every limit is checked by the store against the current count.
   * - Trial-only tenants (no contractId): checks the associated trial's `usersLimitType`.
   *   PRODUCT uses the product's `trialsUsersLimit`, CUSTOM uses the trial's `usersLimit`, INFINITE has no limit.
   *   If the limit is reached, does NOT increment and returns `{ trialLimitExceeded: true }`.
   * - Contract tenants: past maxConstraintValue, the seats grow to the new count, which never goes down, and the
   *   contract records the variation and invoices its prorated amount at the end of the day (UR-RK-401).
   * - Order tenants, waiting for their contract: the seats grow the same way, and the contract catches up with
   *   them when the provisioning of the line creates it.
   * @param productId the identifier of the product.
   * @param tenantId the identifier of the tenant.
   * @returns whether the trial seat limit was exceeded.
   */
  async incrementActiveUsers(productId: string, tenantId: string): Promise<{ trialLimitExceeded: boolean }> {
    try {
      const tenant = await this._tenantModel.get({ productId, id: tenantId });

      if (!tenant) {
        this._logger.warn(`Tenant with ID: ${tenantId} for product ID: ${productId} not found.`);
        throw new EntityNotFoundException('Tenant', tenantId);
      }

      if (!tenant.contractId && tenant.orderId) {
        return await this._incrementOrderActiveUsers(productId, tenantId);
      }
      if (!tenant.contractId) {
        return await this._incrementTrialActiveUsers(productId, tenantId, tenant.trialId);
      }

      const updatedTenant = await this._tenantModel.update(
        { productId, id: tenantId },
        { $ADD: { activeUsers: 1 } },
        { return: 'item' },
      );
      const newActiveUsers = updatedTenant.activeUsers;

      if (newActiveUsers <= updatedTenant.maxConstraintValue) {
        this._logger.log(`Active users incremented for tenant ID: ${tenantId}. New count: ${newActiveUsers}`);
        return { trialLimitExceeded: false };
      }

      // Contract tenant beyond maxConstraintValue: expand it, unless a concurrent increment already
      // expanded it further, in which case that call also brings the subscription up to date.
      try {
        await this._tenantModel.update(
          { productId, id: tenantId },
          { maxConstraintValue: newActiveUsers },
          { condition: new Condition().where('maxConstraintValue').lt(newActiveUsers), return: 'item' },
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          this._logger.log(`Active users incremented for tenant ID: ${tenantId}. New count: ${newActiveUsers}. maxConstraintValue already expanded.`);
          return { trialLimitExceeded: false };
        }
        throw error;
      }
      this._logger.log(`Active users incremented for tenant ID: ${tenantId}. New count: ${newActiveUsers}. maxConstraintValue expanded.`);

      const contractsService = await this._loadContractsService();
      await contractsService.recordSeatIncrease(productId, tenant.contractId, newActiveUsers);
      return { trialLimitExceeded: false };

    } catch (error) {
      this._logger.error(`Error incrementing active users for tenant ID: ${tenantId}`, error);
      if (error instanceof EntityNotFoundException || error instanceof BusinessException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while incrementing active users.', error);
    }
  }

  /**
   * Increments the active users count of a tenant provisioned from an order, before its contract exists.
   * Going past the seats sold on the line raises them, as on a contract: the contract catches up when it is created.
   * @param productId the identifier of the product.
   * @param tenantId the identifier of the tenant.
   * @returns never a trial limit, since the tenant is not a trial.
   */
  private async _incrementOrderActiveUsers(productId: string, tenantId: string): Promise<{ trialLimitExceeded: boolean }> {
    const updatedTenant = await this._tenantModel.update(
      { productId, id: tenantId },
      { $ADD: { activeUsers: 1 } },
      { return: 'item' },
    );
    this._logger.log(`Active users incremented for tenant ID: ${tenantId}. New count: ${updatedTenant.activeUsers}`);
    if (updatedTenant.activeUsers > updatedTenant.maxConstraintValue) {
      try {
        await this._tenantModel.update(
          { productId, id: tenantId },
          { maxConstraintValue: updatedTenant.activeUsers },
          { condition: new Condition().where('maxConstraintValue').lt(updatedTenant.activeUsers), return: 'item' },
        );
      } catch (error) {
        if (!isConditionalCheckFailed(error)) throw error;
      }
    }
    return { trialLimitExceeded: false };
  }

  /**
   * Increments the active users count of a trial-only tenant, within the users limit of its trial.
   * The limit is a condition on the atomic addition, so concurrent sign-ups cannot overshoot it.
   * @param productId the identifier of the product.
   * @param tenantId the identifier of the tenant.
   * @param trialId the identifier of the tenant's trial, if any.
   * @returns whether the trial seat limit was exceeded.
   */
  private async _incrementTrialActiveUsers(productId: string, tenantId: string, trialId?: string): Promise<{ trialLimitExceeded: boolean }> {
    const effectiveLimit = trialId ? await this._resolveTrialUsersLimit(productId, trialId) : undefined;

    try {
      const updatedTenant = await this._tenantModel.update(
        { productId, id: tenantId },
        { $ADD: { activeUsers: 1 } },
        {
          ...(effectiveLimit != null && { condition: new Condition().where('activeUsers').lt(effectiveLimit) }),
          return: 'item',
        },
      );
      this._logger.log(`Active users incremented for tenant ID: ${tenantId}. New count: ${updatedTenant.activeUsers}`);
      return { trialLimitExceeded: false };
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        this._logger.warn(
          `Tenant ${tenantId} (trial-only) exceeded trial users limit (${effectiveLimit}). User will be created as INACTIVE.`
        );
        return { trialLimitExceeded: true };
      }
      throw error;
    }
  }

  /**
   * Resolves the users limit that applies to a trial.
   * PRODUCT uses the product's `trialsUsersLimit`, CUSTOM uses the trial's `usersLimit`, INFINITE has no limit.
   * @param productId the identifier of the product.
   * @param trialId the identifier of the trial.
   * @returns the users limit, or undefined when the trial has none.
   */
  private async _resolveTrialUsersLimit(productId: string, trialId: string): Promise<number | undefined> {
    const trialsService = await this._loadTrialsService();
    const trial = await trialsService.getTrial(productId, trialId);

    if (trial.usersLimitType === UsersLimitType.Product) {
      const productsService = await this._loadProductsService();
      const product = await productsService.getProduct(productId);
      return product.hasTrialsUsersLimit && product.trialsUsersLimit != null ? product.trialsUsersLimit : undefined;
    }
    if (trial.usersLimitType === UsersLimitType.Custom) {
      return trial.usersLimit;
    }
    return undefined;
  }

  /**
   * Decrements the active users count for a tenant.
   * The count is lowered with an atomic addition guarded on a positive count, so it never goes below zero.
   * @param productId the identifier of the product.
   * @param tenantId the identifier of the tenant.
   */
  async decrementActiveUsers(productId: string, tenantId: string): Promise<void> {
    try {
      const updatedTenant = await this._tenantModel.update(
        { productId, id: tenantId },
        { $ADD: { activeUsers: -1 } },
        { condition: new Condition().where('activeUsers').gt(0), return: 'item' },
      );
      this._logger.log(`Active users decremented for tenant ID: ${tenantId}. New count: ${updatedTenant.activeUsers}`);

    } catch (error) {
      // The condition also fails on a missing tenant, which has no attribute to compare.
      if (isConditionalCheckFailed(error)) {
        const tenant = await this._tenantModel.get({ productId, id: tenantId });
        if (!tenant) {
          this._logger.warn(`Tenant with ID: ${tenantId} for product ID: ${productId} not found.`);
          throw new EntityNotFoundException('Tenant', tenantId);
        }
        this._logger.warn(`Active users of tenant ID: ${tenantId} already at zero, decrement ignored.`);
        return;
      }
      this._logger.error(`Error decrementing active users for tenant ID: ${tenantId}`, error);
      throw new DatabaseException('An error occurred while decrementing active users.', error);
    }
  }

  /**
   * Lazy loads the OrdersService from its module.
   * @returns a Promise resolving to the OrdersService instance.
   */
  private async _loadOrdersService(): Promise<OrdersService> {
    if (!this._ordersService) {
      const { OrdersLazyModule } = await import("../../../orders/lazy-orders/orders-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => OrdersLazyModule);
      this._ordersService = moduleRef.get<OrdersService>(OrdersService);
    }
    return this._ordersService;
  }

  /**
   * Lazy loads the PendingOperationsService from its module.
   * @returns a Promise resolving to the PendingOperationsService instance.
   */
  private async _loadPendingOperationsService(): Promise<PendingOperationsService> {
    if (!this._pendingOperationsService) {
      const { PendingOperationsLazyModule } = await import(
        "../../../pending-operations/lazy-pending-operations/pending-operations-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(() => PendingOperationsLazyModule);
      this._pendingOperationsService = moduleRef.get<PendingOperationsService>(PendingOperationsService);
    }
    return this._pendingOperationsService;
  }

  /**
   * Asks the product to create a tenant: the tenant is written at once in REQUESTED with its pending operation,
   * then the request is sent; the product's answer moves it on through the SQS inbound queue.
   * @param tenant the tenant to ask for.
   * @param scope the request scope.
   * @returns the tenant in REQUESTED.
   * @throws ValidationException if the source is missing or the data do not match the product's structure.
   */
  async notifyCreateTenant(tenant: CreateTenantDto, scope: RequestScope): Promise<ResponseTenantDto> {
    // Resellers can only provision tenants for issuers of their subtree. The
    // tenant's path is not persisted yet at notify time, so resolve it from the
    // issuer id (absent issuer ⇒ Keus-direct ⇒ rejected for resellers).
    if (!isUnrestricted(scope)) {
      const resellersService = await this._loadResellersService();
      const resellerPath = tenant.issuerId
        ? await resellersService.getResellerPath(tenant.issuerId)
        : undefined;
      const viewerPath = await this._resolveScopePath(scope);
      assertPathVisible(scope, viewerPath, resellerPath, 'Tenant provisioning');
    }

    const request = await this.prepareTenantRequest(tenant, { requestedBy: scope.system ? undefined : scope.sub });
    try {
      this._logger.log(`Requesting tenant ${request.tenant.id} to product ${tenant.productId}`);
      await transaction(request.writes);
    } catch (error) {
      this._logger.error(`Error writing the request of tenant ${request.tenant.id}`, error);
      throw new DatabaseException('An error occurred while requesting the tenant.', error);
    }
    const pendingOperationsService = await this._loadPendingOperationsService();
    await pendingOperationsService.dispatch(request.operation);
    return plainToInstance(ResponseTenantDto, request.tenant);
  }

  /**
   * Asks the product to change a tenant, as a pending operation: the change lands on Rocket when the product
   * confirms it. Only one operation per tenant is open at a time.
   * @param productId the product of the tenant.
   * @param id the identifier of the tenant.
   * @param tenant the fields to change, the status excluded (Rocket applies it itself).
   * @param scope the request scope.
   * @returns the tenant, waiting for the product.
   * @throws BusinessException if the tenant is not on the product, or another operation on it is still open.
   */
  async requestTenantUpdate(productId: string, id: string, tenant: UpdateTenantDto, scope: RequestScope): Promise<ResponseTenantDto> {
    const existing = await this._getTenantReadyForOperation(productId, id);
    const { data, description, maxConstraintValue, status: _status, ...standard } = tenant;
    return this._requestTenantOperation(existing, PendingOperationKind.UpdateTenant, OperationEnum.Update, scope, operationId => ({
      id,
      ...standard,
      data,
      metadata: { description, maxConstraintValue, rocketOperationId: operationId },
    }));
  }

  /**
   * Asks the product to delete a tenant, as a pending operation: the tenant and its users become DELETED when the
   * product confirms it.
   * @param productId the product of the tenant.
   * @param id the identifier of the tenant.
   * @param scope the request scope.
   * @returns the tenant, waiting for the product.
   * @throws BusinessException if the tenant is not on the product, or another operation on it is still open.
   */
  async requestTenantDelete(productId: string, id: string, scope: RequestScope): Promise<ResponseTenantDto> {
    const existing = await this._getTenantReadyForOperation(productId, id);
    return this._requestTenantOperation(existing, PendingOperationKind.DeleteTenant, OperationEnum.Delete, scope, operationId => ({
      id,
      metadata: { rocketOperationId: operationId },
    } as TenantPayloadDto));
  }

  /**
   * Reads a tenant the operator wants to change or delete on the product.
   * @param productId the product of the tenant.
   * @param id the identifier of the tenant.
   * @returns the tenant.
   * @throws EntityNotFoundException if the tenant does not exist.
   * @throws BusinessException if the tenant is not on the product, or another operation on it is still open.
   */
  private async _getTenantReadyForOperation(productId: string, id: string): Promise<Tenant> {
    const tenant = await this._tenantModel.get({ productId, id }, { consistent: true, return: 'item' });
    if (!tenant) {
      throw new EntityNotFoundException('Tenant', id);
    }
    if (![TenantStatus.Active, TenantStatus.Inactive].includes(tenant.status)) {
      throw new BusinessException('Only an active or inactive tenant can be changed: the product has not created this one.', 'TENANT_NOT_ON_PRODUCT');
    }
    if (tenant.syncState && tenant.syncState !== SyncState.InSync) {
      throw new BusinessException('Another operation on the tenant is still waiting for the product.', 'TENANT_OPERATION_OPEN');
    }
    return tenant;
  }

  /**
   * Writes an operation on a tenant together with its `syncState`, and sends it once committed.
   * @param tenant the tenant the operation targets.
   * @param kind what the operation asks the product to do.
   * @param operation the operation of the notification.
   * @param scope the request scope, whose operator is recorded on the operation.
   * @param buildItem builds the payload item from the operation id.
   * @returns the tenant, waiting for the product.
   * @throws BusinessException if another operation on the tenant opened meanwhile.
   * @throws DatabaseException if the operation cannot be written.
   */
  private async _requestTenantOperation(
    tenant: Tenant,
    kind: PendingOperationKind,
    operation: OperationEnum,
    scope: RequestScope,
    buildItem: (operationId: string) => TenantPayloadDto,
  ): Promise<ResponseTenantDto> {
    const key = { productId: tenant.productId, id: tenant.id };
    const pendingOperationsService = await this._loadPendingOperationsService();
    const { operation: pending, write } = pendingOperationsService.createWrite({
      productId: tenant.productId,
      kind,
      targetId: tenant.id,
      requestedBy: scope.system ? undefined : scope.sub,
      buildNotification: operationId => ({ productId: tenant.productId, operation, entityType: EntityTypeEnum.Tenant, payload: [buildItem(operationId)] }),
    });
    try {
      await transaction([
        this._tenantModel.transaction.update(
          key,
          toDynamooseUpdate<Tenant>({ syncState: SyncState.Pending, pendingOperationId: pending.id }, ['failureReason']),
          { condition: new Condition().where('syncState').not().exists().or().where('syncState').eq(SyncState.InSync) },
        ),
        write,
      ]);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        throw new BusinessException('Another operation on the tenant is still waiting for the product.', 'TENANT_OPERATION_OPEN');
      }
      this._logger.error(`Error writing operation ${kind} of tenant ${tenant.id}`, error);
      throw new DatabaseException('An error occurred while asking the product for the operation.', error);
    }
    await pendingOperationsService.dispatch(pending);
    this._logger.log(`Operation ${kind} of tenant ${tenant.id} sent to product ${tenant.productId}.`);
    const { failureReason: _failureReason, ...rest } = tenant;
    return plainToInstance(ResponseTenantDto, { ...rest, syncState: SyncState.Pending, pendingOperationId: pending.id });
  }

  /**
   * Records the product's answer to a change or a deletion of a tenant, found through `metadata.rocketOperationId`.
   * An error leaves the tenant as it was with `syncState` FAILED. A confirmed change is applied before the operation
   * is closed, so that a process stopping in between applies it again at the next sending; a confirmed deletion
   * makes the tenant and its users DELETED. An answer to an unknown or closed operation, or to a tenant purged
   * meanwhile, is dropped.
   * @param productId the product that answered.
   * @param item the tenant as the product sent it back.
   * @throws DatabaseException if the answer cannot be recorded.
   */
  async confirmTenantOperation(productId: string, item: TenantPayloadDto): Promise<void> {
    const pendingOperationsService = await this._loadPendingOperationsService();
    const operationKey = { productId, id: String(item.metadata?.rocketOperationId) };
    const operation = await pendingOperationsService.find(operationKey);
    if (!operation) {
      this._logger.warn(`Tenant answer from product ${productId} names unknown operation ${operationKey.id}; answer dropped.`);
      return;
    }
    if (operation.state !== PendingOperationState.Pending) {
      this._logger.log(`Tenant operation ${operation.id} is ${operation.state}; answer ignored.`);
      return;
    }
    const tenant = await this._tenantModel.get({ productId, id: operation.targetId }, { consistent: true, return: 'item' });
    if (!tenant) {
      this._logger.warn(`Tenant ${operation.targetId} of operation ${operation.id} is no longer on Rocket; answer dropped.`);
      return;
    }
    const key = { productId, id: tenant.id };
    const ownOperation = { condition: new Condition().where('pendingOperationId').eq(operation.id) };

    if (item.error) {
      try {
        await transaction([
          pendingOperationsService.failWrite(operationKey, item.error.message),
          this._tenantModel.transaction.update(key, { syncState: SyncState.Failed, failureReason: item.error.message }, ownOperation),
        ]);
      } catch (error) {
        this._answerNotRecorded(operation.id, error);
        return;
      }
      await pendingOperationsService.cancelSchedule(operation.id);
      this._logger.warn(`Tenant operation ${operation.id} failed on product ${productId}: ${item.error.message}`);
      return;
    }

    if (operation.kind === PendingOperationKind.DeleteTenant) {
      await this._markTenantDeleted(tenant, operationKey);
      return;
    }
    const { id: _id, data, metadata, error: _error, ...standard } = item;
    const { rocketOperationId: _operationId, ...fields } = metadata ?? {};
    await this.updateTenant(productId, tenant.id, { ...standard, data, ...fields } as UpdateTenantDto);
    try {
      await transaction([
        pendingOperationsService.resolveWrite(operationKey, tenant.id),
        this._tenantModel.transaction.update(key, toDynamooseUpdate<Tenant>({ syncState: SyncState.InSync }, ['failureReason']), ownOperation),
      ]);
    } catch (error) {
      this._answerNotRecorded(operation.id, error);
      return;
    }
    await pendingOperationsService.cancelSchedule(operation.id);
    this._logger.log(`Tenant operation ${operation.id} confirmed by product ${productId}.`);
  }

  /**
   * Records that the product changed a tenant on its own: the change is applied and joins the tenant's history.
   * @param productId the product of the tenant.
   * @param item the tenant as the product sent it.
   * @throws EntityNotFoundException if the tenant does not exist.
   */
  async applyTenantUpdate(productId: string, item: TenantPayloadDto): Promise<void> {
    const { id, data, metadata, error: _error, ...standard } = item;
    await this.updateTenant(productId, String(id), { ...standard, data, ...(metadata || {}) } as UpdateTenantDto);
    await this._recordProductChange(productId, PendingOperationKind.UpdateTenant, OperationEnum.Update, String(id), item);
  }

  /**
   * Records that the product deleted a tenant on its own: the tenant and its users become DELETED and the change
   * joins the tenant's history.
   * @param productId the product of the tenant.
   * @param item the tenant as the product sent it.
   * @throws DatabaseException if the tenant cannot be marked.
   */
  async applyTenantDeletion(productId: string, item: TenantPayloadDto): Promise<void> {
    const id = String(item.id);
    const tenant = await this._tenantModel.get({ productId, id }, { consistent: true, return: 'item' });
    if (!tenant) {
      this._logger.warn(`Tenant ${id} deleted by product ${productId} is not on Rocket; nothing to record.`);
      return;
    }
    await this._markTenantDeleted(tenant);
    await this._recordProductChange(productId, PendingOperationKind.DeleteTenant, OperationEnum.Delete, id, item);
  }

  /**
   * Records that the product created a tenant on its own, in the tenant's history.
   * @param productId the product of the tenant.
   * @param item the tenant as the product sent it.
   */
  async recordTenantCreation(productId: string, item: TenantPayloadDto): Promise<void> {
    await this._recordProductChange(productId, PendingOperationKind.CreateTenant, OperationEnum.Create, String(item.id), item);
  }

  /**
   * Removes for good a tenant deleted on the product, or a request discarded after the product's error, with its
   * DELETED or CANCELLED users. The operations stay in their table.
   * @param productId the product of the tenant.
   * @param id the identifier of the tenant.
   * @param scope the request scope.
   * @throws BusinessException if the tenant is neither DELETED nor CANCELLED.
   */
  async purgeTenant(productId: string, id: string, scope: RequestScope): Promise<void> {
    const tenant = await this.getTenant(productId, id, scope);
    if (![TenantStatus.Deleted, TenantStatus.Cancelled].includes(tenant.status)) {
      throw new BusinessException('Only a tenant deleted on the product, or a discarded request, can be removed for good.', 'TENANT_NOT_PURGEABLE');
    }
    const usersService = await this._loadUsersService();
    await usersService.purgeUsersOfTenant(productId, id);
    try {
      // A one-write transaction, since a conditional delete is typed as a request builder.
      await transaction([this._tenantModel.transaction.delete({ productId, id }, { condition: new Condition().where('status').eq(tenant.status) })]);
      this._logger.log(`Tenant ${id} of product ${productId} removed for good.`);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        throw new BusinessException('The tenant changed while it was being removed: reload it.', 'REQUEST_CHANGED');
      }
      this._logger.error(`Error removing tenant ${id}`, error);
      throw new DatabaseException('An error occurred while removing the tenant.', error);
    }
  }

  /**
   * Marks a tenant and its users DELETED and closes the operation that deleted it; then records the volume drop and
   * frees its trial. The users go first: a run stopped halfway is repeated when the answer arrives again, the
   * tenant being still open.
   * @param tenant the tenant.
   * @param operationKey the deletion asked by Rocket, absent when the product deleted the tenant on its own.
   * @throws DatabaseException if the tenant cannot be marked.
   */
  private async _markTenantDeleted(tenant: Tenant, operationKey?: PendingOperationKey): Promise<void> {
    const { productId } = tenant;
    const pendingOperationsService = await this._loadPendingOperationsService();
    const usersService = await this._loadUsersService();
    await usersService.markUsersOfTenantDeleted(productId, tenant.id);
    try {
      await transaction([
        this._tenantModel.transaction.update(
          { productId, id: tenant.id },
          toDynamooseUpdate<Tenant>({ status: TenantStatus.Deleted, syncState: SyncState.InSync }, ['failureReason']),
          { condition: new Condition().where('status').eq(tenant.status) },
        ),
        ...(operationKey ? [pendingOperationsService.resolveWrite(operationKey, tenant.id)] : []),
      ]);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        this._logger.warn(`Tenant ${tenant.id} changed while it was being marked deleted; left as it is.`);
        return;
      }
      this._logger.error(`Error marking deleted tenant ${tenant.id}`, error);
      throw new DatabaseException('An error occurred while marking the tenant deleted.', error);
    }
    if (operationKey) {
      await pendingOperationsService.cancelSchedule(operationKey.id);
    }
    this._logger.log(`Tenant ${tenant.id} of product ${productId} deleted on the product.`);
    if (tenant.status === TenantStatus.Deleted) return;

    if (tenant.trialId) {
      const trialsService = await this._loadTrialsService();
      await trialsService.updateTrial(productId, tenant.trialId, { redeemed: false });
    }
  }

  /**
   * Records a change the product made on a tenant on its own, in the tenant's history.
   * @param productId the product of the tenant.
   * @param kind what the product did.
   * @param operation the operation of the product's message.
   * @param id the identifier of the tenant.
   * @param item the tenant as the product sent it.
   */
  private async _recordProductChange(productId: string, kind: PendingOperationKind, operation: OperationEnum, id: string, item: TenantPayloadDto): Promise<void> {
    const pendingOperationsService = await this._loadPendingOperationsService();
    await pendingOperationsService.recordFromProduct(productId, kind, id, { productId, operation, entityType: EntityTypeEnum.Tenant, payload: [item] });
  }

  /**
   * Retrieves the tenants of a product created in a month, via the monthIndex LSI.
   * @param productId the product of the tenants.
   * @param monthIndex the month index (format: "YYYY-MM").
   * @returns a list of tenants for the given month.
   */
  async getByMonthIndex(productId: string, monthIndex: string): Promise<ResponseTenantDto[]> {
    try {
      const tenants = await this._tenantModel.query('productId').eq(productId).where('monthIndex').eq(monthIndex).using('monthIndex').all().exec();
      this._logger.log(`Retrieved ${tenants.length} tenants for monthIndex: ${monthIndex}.`);
      return tenants.map(tenant => plainToInstance(ResponseTenantDto, tenant));

    } catch (error) {
      this._logger.error(`Error retrieving tenants by monthIndex: ${monthIndex}`, error);
      throw new DatabaseException('An error occurred while retrieving tenants by monthIndex.', error);
    }
  }

  /**
   * Retrieves the tenants of a product in a status, via the statusIndex LSI.
   * @param productId the product of the tenants.
   * @param status the tenant status to filter by.
   * @returns a list of tenants with the given status.
   */
  async getByStatus(productId: string, status: TenantStatus): Promise<ResponseTenantDto[]> {
    try {
      const tenants = await this._tenantModel.query('productId').eq(productId).where('status').eq(status).using('statusIndex').all().exec();
      this._logger.log(`Retrieved ${tenants.length} tenants for status: ${status}.`);
      return tenants.map(tenant => plainToInstance(ResponseTenantDto, tenant));

    } catch (error) {
      this._logger.error(`Error retrieving tenants by status: ${status}`, error);
      throw new DatabaseException('An error occurred while retrieving tenants by status.', error);
    }
  }
}
