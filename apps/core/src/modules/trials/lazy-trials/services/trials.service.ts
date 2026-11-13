import { Injectable, Logger } from "@nestjs/common";
import { isUnrestricted, RequestScope, SYSTEM_SCOPE } from "@rocket-be/scoping";
import { isWithin, paginate, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { TrialsPageQueryDto } from "../../dtos/trials-page-query.dto";
import { ResponseTrialsPageDto } from "../../dtos/response-trials-page.dto";
import { splitRemovals, toDynamooseUpdate } from "../../../../commons/persistence/removable-update.helper";
import { assertCollaborator, assertPathVisible } from "../../../../commons/scoping/scoped-access.helper";
import { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { InjectModel, Model } from "nestjs-dynamoose";
import { Condition } from "dynamoose";
import { v4 as uuidv4 } from "uuid";
import { AppException, BusinessException, DatabaseException, DuplicateEmailException, EntityNotFoundException } from "../../../../errors/exception-types";
import { TenantsService } from "../../../tenants/lazy-tenants/services/tenants.service";
import { TenantStatus } from "../../../tenants/enums/tenant-status.enum";
import type { UpdateTenantDto } from "../../../tenants/dtos/update-tenant.dto";
import { ProductsService } from "../../../products/lazy-products/services/products.service";
import { CreateTrialDto } from "../../dtos/create-trial.dto";
import { ResponseTrialDto } from "../../dtos/response-trial.dto";
import { UpdateTrialDto } from "../../dtos/update-trial.dto";
import { TrialStatus } from "../../enums/trial-status.enum";
import { UsersLimitType } from "../../enums/users-limit-type.enum";
import { Trial, TrialKey, TrialSchema } from "../../schemas/trial.schema";
import { TrialSchedulerService } from "./trial-scheduler.service";
import { EventBridgeService } from "../../../event-bridge/lazy-event-bridge/services/event-bridge.service";
import { RecipientTypeEnum } from "../../../../commons/enums/recipient-type.enum";
import { ProductMessageTemplate } from "../../../../commons/enums/product-message-template.enum";
import type { MessagePayloadDto } from "../../../../commons/dtos/message-payload.dto";
import type { TransactionWrite } from "../../../pending-operations/lazy-pending-operations/services/pending-operations.service";

/**
 * Service for managing trials.
 */
@Injectable()
export class TrialsService {
  /** Logger instance for TrialsService. */
  private readonly _logger = new Logger(TrialsService.name);

  /** Lazy-loaded products service. */
  private _productsService: ProductsService | null = null;

  /** Lazy-loaded tenants service. */
  private _tenantsService: TenantsService | null = null;

  /** Lazy-loaded event bridge service. */
  private _eventBridgeService: EventBridgeService | null = null;

  /** Lazy-loaded resellers service. */
  private _resellersService: ResellersService | null = null;

  /**
   * Constructor for TrialsService.
   * @param _trialModel the model to manage trial entities.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    @InjectModel("Trial")
    private readonly _trialModel: Model<Trial, TrialKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader,
    private readonly _trialScheduler: TrialSchedulerService,
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
   * Lazy loads the TenantsService from its module.
   * @returns A Promise resolving to the TenantsService instance.
   */
  private async _loadTenantsService(): Promise<TenantsService> {
    if (!this._tenantsService) {
      const { TenantsLazyModule } = await import(
        "../../../tenants/lazy-tenants/tenants-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => TenantsLazyModule,
      );
      this._tenantsService = moduleRef.get<TenantsService>(TenantsService);
    }
    return this._tenantsService;
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
   * Queries the trials of a reseller's whole subtree with a single begins_with
   * on the resellerPathIndex LSI.
   * @param productId the product ID to filter trials by.
   * @param viewerPath the requester's reseller path (e.g. "RVD-001#").
   * @returns the trials whose creator lineage is within the viewer's subtree.
   */
  private async _queryTrialsByResellerPath(productId: string, viewerPath: string): Promise<Trial[]> {
    return await this._trialModel
      .query("productId").eq(productId)
      .where("resellerPath").beginsWith(viewerPath)
      .using("resellerPathIndex")
      .exec();
  }

  /**
   * Sends the TRIAL_RESIDUE activation MESSAGE notification to the product.
   * Targets directly the email associated with the trial (trials are not
   * guaranteed to have a tenant association).
   * @param productId the product ID.
   * @param associatedEmail the trial owner's email.
   * @param expiresAt the trial expiration date, or null for perpetual trials.
   */
  private async _notifyTrialActivated(
    productId: string,
    associatedEmail: string,
    expiresAt: Date | null,
  ): Promise<void> {
    const productsService = await this._loadProductsService();
    const product = await productsService.getProduct(productId);
    const productName = product.name;

    let body: Record<string, unknown>;
    if (expiresAt == null) {
      body = {
        message: `Grazie per aver scelto ${productName}! Il tuo trial è stato attivato senza scadenza.\nIn caso volessi acquistare la licenza ti ricordiamo che puoi contattare un nostro commerciale di riferimento.`,
        perpetual: true,
      };
    } else {
      body = {
        message: `Grazie per aver scelto ${productName}! Il tuo trial è stato attivato!\nIn caso volessi acquistare la licenza ti ricordiamo che puoi contattare un nostro commerciale di riferimento.`,
        days: Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000)),
      };
    }

    const payload: MessagePayloadDto = {
      recipientType: RecipientTypeEnum.User,
      to: associatedEmail,
      subject: "Trial attivato",
      template: ProductMessageTemplate.TrialResidue,
      body,
    };

    const eventBridge = await this._loadEventBridgeService();
    await eventBridge.sendMessage(productId, payload);
  }

  /**
   * Sends the TRIAL_END MESSAGE notification when a trial is closed early
   * (manual cancellation). Targets directly the email associated with the
   * trial. Mirrors the copy emitted by the SQS handler on natural expiration.
   * @param productId the product ID.
   * @param associatedEmail the trial owner's email.
   */
  private async _notifyTrialClosed(productId: string, associatedEmail: string): Promise<void> {
    const productsService = await this._loadProductsService();
    const product = await productsService.getProduct(productId);

    const payload: MessagePayloadDto = {
      recipientType: RecipientTypeEnum.User,
      to: associatedEmail,
      subject: "Trial scaduto",
      template: ProductMessageTemplate.TrialEnd,
      body: {
        message: `Il tuo trial ${product.name} è scaduto.\nIn caso volessi acquistare la licenza ti ricordiamo che puoi contattare un nostro commerciale di riferimento.`,
      },
    };

    const eventBridge = await this._loadEventBridgeService();
    await eventBridge.sendMessage(productId, payload);
  }

  /**
   * Creates a new trial.
   * @param trial the trial data to create.
   * @returns the created trial.
   */
  async createTrial(trial: CreateTrialDto, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseTrialDto> {
    try {
      // A reseller-collaborator's trials are attributed to its reseller org so
      // the whole subtree can list them with a single begins_with query.
      const resellerPath = await this._resolveScopePath(scope);

      // Check if a trial with the same email already exists for this product (using LSI).
      const existingTrials = await this._trialModel
        .query("productId")
        .eq(trial.productId)
        .where("associatedEmail")
        .eq(trial.associatedEmail)
        .using("associatedEmailIndex")
        .exec();

      if (existingTrials.length > 0) {
        this._logger.warn(`A trial with email ${trial.associatedEmail} already exists for product ${trial.productId}.`);
        throw new DuplicateEmailException(trial.associatedEmail);
      }

      const id = uuidv4();
      const isDraft = trial.status === TrialStatus.Draft;
      const isPerpetual = trial.perpetual === true;
      const now = new Date();

      const newTrial: Trial = {
        productId: trial.productId,
        id,
        associatedEmail: trial.associatedEmail,
        description: trial.description,
        status: isDraft ? TrialStatus.Draft : TrialStatus.Active,
        redeemed: false,
        perpetual: isPerpetual,
        usersLimitType: trial.usersLimitType,
        monthIndex: now.toISOString().slice(0, 7),
        ...(resellerPath && { resellerPath }),
        ...(trial.dealId && { dealId: trial.dealId }),
      };

      // Resolve usersLimit: if PRODUCT type and no value passed, fetch from product
      if (trial.usersLimitType === UsersLimitType.Product && trial.usersLimit == null) {
        const productsService = await this._loadProductsService();
        const product = await productsService.getProduct(trial.productId);
        if (product.trialsUsersLimit != null) {
          newTrial.usersLimit = product.trialsUsersLimit;
        }
      } else if (trial.usersLimit != null) {
        newTrial.usersLimit = Number(trial.usersLimit);
      }

      if (!isDraft) {
        newTrial.activatedAt = now;

        if (!isPerpetual) {
          if (trial.expiresAt) {
            newTrial.expiresAt = new Date(trial.expiresAt);
          } else {
            const productsService = await this._loadProductsService();
            const product = await productsService.getProduct(trial.productId);
            const trialDays = product.defaultTrialDuration ?? 14;
            newTrial.expiresAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
          }
        }
      }

      this._logger.log(`Creating trial with ID: ${id}`, newTrial);
      const createdTrial = await this._trialModel.create(newTrial);

      if (!isDraft && newTrial.expiresAt) {
        await this._trialScheduler.scheduleExpiration({
          trialId: id,
          productId: trial.productId,
          expiresAt: newTrial.expiresAt,
        });

        const productsService = await this._loadProductsService();
        const product = await productsService.getProduct(trial.productId);
        await this._trialScheduler.scheduleReminders({
          trialId: id,
          productId: trial.productId,
          productName: product.name,
          associatedEmail: newTrial.associatedEmail,
          activatedAt: now,
          expiresAt: newTrial.expiresAt,
        });
      }

      if (!isDraft) {
        await this._notifyTrialActivated(trial.productId, newTrial.associatedEmail, newTrial.expiresAt ?? null);
      }

      return plainToInstance(ResponseTrialDto, createdTrial);

    } catch (error) {
      this._logger.error('Error creating trial', error);
      if (error instanceof DuplicateEmailException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while creating the trial.', error);
    }
  }

  /**
   * Lists one page of the trials of a product; a reseller sees only those of its subtree,
   * read off the reseller path index.
   * @param productId the product of the trials.
   * @param query the page and its filters.
   * @param scope the request scope.
   * @returns the page of trials.
   * @throws ValidationException if the cursor is not valid.
   */
  async listTrials(productId: string, query: TrialsPageQueryDto, scope: RequestScope): Promise<ResponseTrialsPageDto> {
    const { limit, cursor, status, search, dateField, from, to } = query;
    try {
      const viewerPath = isUnrestricted(scope) ? undefined : await this._resolveScopePath(scope);
      if (!isUnrestricted(scope) && !viewerPath) {
        return { items: [] };
      }
      const page = await paginate<Trial>(
        () => viewerPath
          ? this._trialModel.query("productId").eq(productId).where("resellerPath").beginsWith(viewerPath).using("resellerPathIndex")
          : this._trialModel.query("productId").eq(productId),
        viewerPath ? ["productId", "id", "resellerPath"] : ["productId", "id"],
        limit,
        cursor,
        trial =>
          (!status?.length || status.includes(trial.status))
          && startsWithAny(search, trial.associatedEmail)
          && isWithin(dateField === "expiresAt" ? trial.expiresAt : trial.activatedAt, from, to),
      );
      return { items: page.items.map(trial => plainToInstance(ResponseTrialDto, trial)), nextCursor: page.nextCursor };
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this._logger.error(`Error listing the trials of product ${productId}`, error);
      throw new DatabaseException('An error occurred while retrieving the trials by product.', error);
    }
  }

  /**
   * Gets trials grouped by product.
   * @param productId the product ID to filter trials by.
   * @returns a list of trials for the specified product.
   */
  async getTrialsByProduct(productId: string, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseTrialDto[]> {
    try {
      let trials: Trial[];
      if (isUnrestricted(scope)) {
        trials = [...await this._trialModel.query("productId").eq(productId).exec()];
      } else {
        // Reseller scope: a single begins_with on the materialized path returns
        // the trials of the whole subtree in one query.
        const viewerPath = await this._resolveScopePath(scope);
        trials = viewerPath ? await this._queryTrialsByResellerPath(productId, viewerPath) : [];
      }
      this._logger.log(`Retrieved ${trials.length} trials for product ID: ${productId}.`);
      return trials.map(trial => plainToInstance(ResponseTrialDto, trial));

    } catch (error) {
      this._logger.error('Error retrieving trials by product', error);
      throw new DatabaseException('An error occurred while retrieving the trials by product.', error);
    }
  }

  /**
   * Retrieves all trials.
   * @returns all trials.
   */
  async getAllTrials(scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseTrialDto[]> {
    assertCollaborator(scope, 'getAllTrials');
    try {
      const trials = await this._trialModel.scan().exec();
      this._logger.log(`Retrieved ${trials.length} trials.`);
      return trials.map(trial => plainToInstance(ResponseTrialDto, trial));
    } catch (error) {
      this._logger.error('Error retrieving trials', error);
      throw new DatabaseException('An error occurred while retrieving the trials.', error);
    }
  }

  /**
   * Retrieves a trial by its ID.
   * @param productId the product ID to filter trials by.
   * @param id the identifier of the trial.
   * @returns the trial with the specified ID.
   */
  async getTrial(productId: string, id: string, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseTrialDto> {
    try {
      const trial = await this._trialModel.get({ productId, id });
      if (!trial) {
        this._logger.warn(`Trial with ID: ${id} for product ID: ${productId} not found.`);
        throw new EntityNotFoundException('Trial', id);
      }

      // Resellers only see trials of their own subtree.
      const viewerPath = await this._resolveScopePath(scope);
      assertPathVisible(scope, viewerPath, trial.resellerPath, `Trial ${id}`);

      this._logger.log(`Retrieved trial with ID: ${id} for product ID: ${productId}.`);
      return plainToInstance(ResponseTrialDto, trial);

    } catch (error) {
      this._logger.error(`Error retrieving trial with ID: ${id} for product ID: ${productId}`, error);
      if (error instanceof AppException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while retrieving the trial.', error);
    }
  }

  /**
   * Retrieves the trial given to an email on a product: an email holds at most one trial per product.
   * @param productId the product of the trial.
   * @param associatedEmail the trial owner's email.
   * @returns the trial, or null when the email has none.
   */
  async findTrialByEmail(productId: string, associatedEmail: string): Promise<ResponseTrialDto | null> {
    try {
      const [trial] = await this._trialModel
        .query("productId")
        .eq(productId)
        .where("associatedEmail")
        .eq(associatedEmail)
        .using("associatedEmailIndex")
        .exec();
      return trial ? plainToInstance(ResponseTrialDto, trial) : null;
    } catch (error) {
      this._logger.error(`Error retrieving the trial of ${associatedEmail} for product ID: ${productId}`, error);
      throw new DatabaseException('An error occurred while retrieving the trial.', error);
    }
  }

  /**
   * Updates the specified trial. A null field is removed (see `splitRemovals`),
   * except the expiry, which drives the schedules and cannot be cleared.
   * @param productId the product ID to filter trials by.
   * @param id the identifier of the trial.
   * @param trial the information to update the trial.
   * @param scope the request scope.
   * @returns the updated trial.
   */
  async updateTrial(productId: string, id: string, trial: UpdateTrialDto, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseTrialDto> {
    try {
      const existingTrial = await this._trialModel.get({ productId, id });

      if (!existingTrial) {
        this._logger.warn(`Trial with ID: ${id} for product ID: ${productId} not found.`);
        throw new EntityNotFoundException('Trial', id);
      }

      // Resellers can only touch trials of their own subtree.
      const viewerPath = await this._resolveScopePath(scope);
      assertPathVisible(scope, viewerPath, existingTrial.resellerPath, `Trial ${id}`);

      // Only the provisioning of an order line converts a trial, and a converted trial keeps its status for good.
      if (trial.status && trial.status !== existingTrial.status
        && (existingTrial.status === TrialStatus.Converted || trial.status === TrialStatus.Converted)) {
        throw new BusinessException(`Trial ${id} is converted, or can only be converted by an order: its status cannot change.`, "TRIAL_CONVERTED");
      }

      const plainUpdateTrial: Partial<Trial> = JSON.parse(JSON.stringify(trial)) as Partial<Trial>;
      if (plainUpdateTrial.expiresAt === null) {
        delete plainUpdateTrial.expiresAt;
      }

      // Ignore expiresAt changes on perpetual trials.
      if (existingTrial.perpetual && trial.expiresAt) {
        delete plainUpdateTrial.expiresAt;
      }

      // Ensure expiresAt is a Date object (DTO receives string, Dynamoose expects Date)
      if (trial.expiresAt && !existingTrial.perpetual) {
        plainUpdateTrial.expiresAt = new Date(trial.expiresAt);
      }

      // Detect (re)activation: DRAFT, CANCELLED or EXPIRED transitioning to ACTIVE.
      const isActivating =
        (existingTrial.status === TrialStatus.Draft || existingTrial.status === TrialStatus.Cancelled || existingTrial.status === TrialStatus.Expired) &&
        trial.status === TrialStatus.Active;
      const isReactivating = (existingTrial.status === TrialStatus.Cancelled || existingTrial.status === TrialStatus.Expired) && trial.status === TrialStatus.Active;

      // On any activation, refresh activatedAt and recompute expiresAt: the trial restarts from now.
      if (isActivating) {
        const now = new Date();
        plainUpdateTrial.activatedAt = now;

        if (!existingTrial.perpetual) {
          if (trial.expiresAt) {
            plainUpdateTrial.expiresAt = new Date(trial.expiresAt);
          } else {
            const productsService = await this._loadProductsService();
            const product = await productsService.getProduct(productId);
            const trialDays = product.defaultTrialDuration ?? 14;
            plainUpdateTrial.expiresAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
          }
        }
      }

      // The month of the closing feeds the conversion rate of the sales metrics; a reactivated trial is open again.
      const isClosing = trial.status !== existingTrial.status && (trial.status === TrialStatus.Expired || trial.status === TrialStatus.Cancelled);
      if (isClosing) {
        plainUpdateTrial.closedMonth = new Date().toISOString().slice(0, 7);
      }

      this._logger.log(`Updating trial with ID: ${id} for product ID: ${productId}`, plainUpdateTrial);
      const { set, remove } = splitRemovals(plainUpdateTrial, TrialSchema, "trial", scope);
      if (isReactivating && existingTrial.closedMonth) {
        remove.push("closedMonth");
      }
      const updatedTrial = await this._trialModel.update({ productId, id }, toDynamooseUpdate(set, remove));

      const isExpiresAtChanged = trial.expiresAt && existingTrial.status === TrialStatus.Active;
      if ((isActivating || isExpiresAtChanged) && plainUpdateTrial.expiresAt) {
        await this._trialScheduler.scheduleExpiration({
          trialId: id,
          productId,
          expiresAt: plainUpdateTrial.expiresAt,
        });

        const activatedAt = isActivating
          ? (plainUpdateTrial.activatedAt ?? new Date())
          : (existingTrial.activatedAt ? new Date(existingTrial.activatedAt as unknown as string) : new Date());
        const productsServiceForReminder = await this._loadProductsService();
        const productForReminder = await productsServiceForReminder.getProduct(productId);
        await this._trialScheduler.scheduleReminders({
          trialId: id,
          productId,
          productName: productForReminder.name,
          associatedEmail: existingTrial.associatedEmail,
          activatedAt,
          expiresAt: plainUpdateTrial.expiresAt,
        });
      }

      // Reactivate associated tenant when trial is reactivated from cancelled or expired
      if (isReactivating) {
        await this._reactivateAssociatedTenant(productId, id);
      }

      // Fire activation MESSAGE notification on DRAFT/CANCELLED/EXPIRED → ACTIVE transitions
      if (isActivating) {
        await this._notifyTrialActivated(productId, existingTrial.associatedEmail, plainUpdateTrial.expiresAt ?? null);
      }

      // Cancel all schedules and notify on early trial cancellation
      if (trial.status === TrialStatus.Cancelled) {
        await this._trialScheduler.cancelExpiration(id);
        await this._trialScheduler.cancelReminders(id);
        await this._notifyTrialClosed(productId, existingTrial.associatedEmail);
      }

      // Deactivate associated tenant when trial expires or is cancelled
      if (trial.status === TrialStatus.Expired || trial.status === TrialStatus.Cancelled) {
        await this._deactivateAssociatedTenant(productId, id);
      }

      return plainToInstance(ResponseTrialDto, updatedTrial);

    } catch (error) {
      this._logger.error(`Error updating trial with ID: ${id} for product ID: ${productId}`, error);
      if (error instanceof AppException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while updating the trial.', error);
    }
  }

  /**
   * Builds the write that turns a trial into CONVERTED, closed in the current month, for the transaction that hands
   * its tenant to an order line.
   * It fails if the trial is missing or was converted meanwhile.
   * @param productId the product of the trial.
   * @param id the identifier of the trial.
   * @returns the transaction write.
   */
  conversionWrite(productId: string, id: string): TransactionWrite {
    return this._trialModel.transaction.update(
      { productId, id },
      { status: TrialStatus.Converted, convertedAt: new Date(), closedMonth: new Date().toISOString().slice(0, 7) },
      { condition: new Condition().where("id").exists().and().where("status").not().eq(TrialStatus.Converted) },
    );
  }

  /**
   * Cancels the expiration and the reminders of a converted trial, without the closing message: its tenant stays on.
   * @param id the identifier of the trial.
   */
  async cancelSchedules(id: string): Promise<void> {
    await this._trialScheduler.cancelExpiration(id);
    await this._trialScheduler.cancelReminders(id);
  }

  /**
   * Deactivates the tenant associated with a trial.
   * Finds the tenant linked via trialId and sets it to Inactive.
   * @param productId the product ID.
   * @param trialId the trial ID.
   */
  private async _deactivateAssociatedTenant(productId: string, trialId: string): Promise<void> {
    const tenantsService = await this._loadTenantsService();
    const tenants = await tenantsService.getTenantsByProduct(productId, SYSTEM_SCOPE);
    const tenant = tenants.find(t => t.trialId === trialId);

    if (tenant && tenant.status === TenantStatus.Active) {
      await tenantsService.updateTenant(productId, tenant.id, { status: TenantStatus.Inactive } as UpdateTenantDto);
      this._logger.log(`Tenant ${tenant.id} deactivated for trial ${trialId}`);
    }
  }

  /**
   * Reactivates the tenant associated with a trial.
   * Finds the tenant linked via trialId and sets it back to Active.
   * @param productId the product ID.
   * @param trialId the trial ID.
   */
  private async _reactivateAssociatedTenant(productId: string, trialId: string): Promise<void> {
    const tenantsService = await this._loadTenantsService();
    const tenants = await tenantsService.getTenantsByProduct(productId, SYSTEM_SCOPE);
    const tenant = tenants.find(t => t.trialId === trialId);

    if (tenant && tenant.status === TenantStatus.Inactive) {
      await tenantsService.updateTenant(productId, tenant.id, { status: TenantStatus.Active } as UpdateTenantDto);
      this._logger.log(`Tenant ${tenant.id} reactivated for trial ${trialId}`);
    }
  }

  /**
   * Deletes a specified trial.
   * @param productId the product ID to filter trials by.
   * @param id the identifier of the trial.
   */
  async deleteTrial(productId: string, id: string, scope: RequestScope = SYSTEM_SCOPE): Promise<void> {
    try {
      // Resellers can only delete trials of their own subtree.
      if (!isUnrestricted(scope)) {
        const existingTrial = await this._trialModel.get({ productId, id });
        const viewerPath = await this._resolveScopePath(scope);
        assertPathVisible(scope, viewerPath, existingTrial?.resellerPath, `Trial ${id}`);
      }

      this._logger.log(`Deleting trial with ID: ${id} for product ID: ${productId}`);
      await this._trialScheduler.cancelExpiration(id);
      await this._trialScheduler.cancelReminders(id);
      await this._trialModel.delete({ productId, id });

    } catch (error) {
      this._logger.error(`Error deleting trial with ID: ${id} for product ID: ${productId}`, error);
      if (error instanceof AppException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while deleting the trial.', error);
    }
  }

  /**
   * Retrieves the trials of a product created in a month, via the monthIndex LSI.
   * @param productId the product of the trials.
   * @param monthIndex the month index (format: "YYYY-MM").
   * @returns a list of trials for the given month.
   */
  async getByMonthIndex(productId: string, monthIndex: string): Promise<ResponseTrialDto[]> {
    try {
      const trials = await this._trialModel.query('productId').eq(productId).where('monthIndex').eq(monthIndex).using('monthIndex').all().exec();
      this._logger.log(`Retrieved ${trials.length} trials for monthIndex: ${monthIndex}.`);
      return trials.map(trial => plainToInstance(ResponseTrialDto, trial));

    } catch (error) {
      this._logger.error(`Error retrieving trials by monthIndex: ${monthIndex}`, error);
      throw new DatabaseException('An error occurred while retrieving trials by monthIndex.', error);
    }
  }

  /**
   * Retrieves the trials of a product in a status, via the statusIndex LSI.
   * @param productId the product of the trials.
   * @param status the trial status to filter by.
   * @returns a list of trials with the given status.
   */
  async getByStatus(productId: string, status: TrialStatus): Promise<ResponseTrialDto[]> {
    try {
      const trials = await this._trialModel.query('productId').eq(productId).where('status').eq(status).using('statusIndex').all().exec();
      this._logger.log(`Retrieved ${trials.length} trials for status: ${status}.`);
      return trials.map(trial => plainToInstance(ResponseTrialDto, trial));

    } catch (error) {
      this._logger.error(`Error retrieving trials by status: ${status}`, error);
      throw new DatabaseException('An error occurred while retrieving trials by status.', error);
    }
  }

  /**
   * Retrieves the trials of every product that closed in a month, for the conversion rate of the sales metrics.
   * @param monthIndex the month of the closing (format: "YYYY-MM").
   * @returns the trials expired, cancelled or converted in that month, and not reactivated since.
   * @throws DatabaseException if the query fails.
   */
  async getClosedIn(monthIndex: string): Promise<ResponseTrialDto[]> {
    try {
      const trials = await this._trialModel.query('closedMonth').eq(monthIndex).using('closedMonthIndex').all().exec();
      return trials.map(trial => plainToInstance(ResponseTrialDto, trial));
    } catch (error) {
      this._logger.error(`Error retrieving the trials closed in ${monthIndex}`, error);
      throw new DatabaseException('An error occurred while retrieving the closed trials.', error);
    }
  }
}
