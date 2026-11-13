import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { InjectModel, Model } from "nestjs-dynamoose";
import { v4 as uuidv4 } from "uuid";
import {
  AuthorizationException,
  BusinessException,
  DatabaseException,
  EntityNotFoundException,
  ValidationException,
} from "../../../../errors/exception-types";
import { normalizeSearchText, Page, paginate, paginateMerged, searchKeyOf, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { PlansPageQueryDto } from "../../dtos/plans-page-query.dto";
import { ResponsePlansPageDto } from "../../dtos/response-plans-page.dto";
import { isUnrestricted, RequestScope, SYSTEM_SCOPE } from "@rocket-be/scoping";
import { splitRemovals, toDynamooseUpdate, withoutKeys } from "../../../../commons/persistence/removable-update.helper";
import { integrationsEnabled } from "../../../../commons/integrations/integrations.helper";
import { ResponseProductDto } from "../../../products/dtos/response-product.dto";
import { ProductsService } from "../../../products/lazy-products/services/products.service";
import { CreateStripePlanDto } from "../../../stripe/dtos/create-stripe-plan.dto";
import { StripeService } from "../../../stripe/lazy-stripe/services/stripe.service";
import { Tier } from "../../classes/tier.class";
import { CreatePlanDto } from "../../dtos/create-plan.dto";
import { ResponsePlanDto } from "../../dtos/response-plan.dto";
import { UpdatePlanDto } from "../../dtos/update-plan.dto";
import { BillingInterval } from "../../enums/billing-interval.enum";
import { PlanAudience } from "../../enums/plan-audience.enum";
import { PlanStatus } from "../../enums/plan-status.enum";
import { PlanType } from "../../enums/plan-type.enum";
import { TierType } from "../../enums/tier-type.enum";
import { Plan, PlanKey, PlanSchema } from "../../schemas/plan.schema";

/**
 * Structural shape used by `_validateActivableConfig`. Both `CreatePlanDto`
 * and the merged-plan shape used at activation time satisfy it, so the
 * validator can be invoked from either path without a separate overload.
 */
type PlanPricingConfig = {
  type: PlanType;
  billingInterval?: BillingInterval;
  tiersType?: TierType;
  tiers?: Tier[];
  baseCost?: number;
  termMonths?: number;
};

/**
 * Builds the sort key of audienceIndex, rewritten on every write that changes the audience or the status.
 * @param audience the audience of the plan.
 * @param status the status of the plan.
 * @returns the composite `${audience}#${status}`.
 */
function audienceStatusOf(audience: PlanAudience, status: PlanStatus): string {
  return `${audience}#${status}`;
}

/**
 * Service responsible for the lifecycle of Plan entities.
 * A plan is always scoped to a product (composite key productId + id), so
 * every operation requires the owning productId.
 *
 * Plans are immutable once activated to prevent existing contracts that
 * reference them from drifting. The lifecycle is strictly forward-only:
 *   Draft  → Active   (mirrors the plan on Stripe and freezes the config)
 *   Active → Archived (archives the Stripe Product, no new contracts allowed)
 * Backward transitions and edits to an active/archived plan are rejected.
 * To change the pricing of an active plan, create a new Draft, activate it,
 * and archive the old one.
 */
@Injectable()
export class PlansService {
  /** Logger instance for PlansService. */
  private readonly _logger = new Logger(PlansService.name);

  /** Lazy-loaded Stripe service. */
  private _stripeService: StripeService | null = null;

  /** Lazy-loaded Products service (used to resolve the owning product's Stripe API key). */
  private _productsService: ProductsService | null = null;

  /**
   * Constructor for PlansService.
   * @param _planModel the Dynamoose model used to persist plan entities.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the Stripe/Products services on demand.
   */
  constructor(
    @InjectModel("Plan")
    private readonly _planModel: Model<Plan, PlanKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

  /**
   * Lazy loads the StripeService from its module.
   * @returns a Promise resolving to the StripeService instance.
   */
  private async _loadStripeService(): Promise<StripeService> {
    if (!this._stripeService) {
      const { StripeLazyModule } = await import(
        "../../../stripe/lazy-stripe/stripe-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => StripeLazyModule,
      );
      this._stripeService = moduleRef.get<StripeService>(StripeService);
    }
    return this._stripeService;
  }

  /**
   * Lazy loads the ProductsService from its module.
   * @returns a Promise resolving to the ProductsService instance.
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
   * Normalizes the tiers array for Dynamoose persistence: strips the
   * class identity coming from class-transformer and omits `minValue` /
   * `maxValue` when they are null/undefined (Dynamoose rejects explicit
   * null values on Number fields, so the unbounded tier ends are encoded
   * by absence of the field rather than by null).
   * @param tiers the tiers as received from the DTO (Tier instances or plain).
   * @returns the tiers ready to be passed to the Plan model.
   */
  private _normalizeTiersForPersistence(tiers: Tier[] | undefined): Plan["tiers"] {
    return (tiers ?? []).map(({ price, minValue, maxValue }) => ({
      price,
      ...(minValue != null && { minValue }),
      ...(maxValue != null && { maxValue }),
    })) as Plan["tiers"];
  }

  /**
   * Validates that a plan's pricing fields form a complete, consistent
   * configuration that can be activated and mirrored on Stripe.
   * Drafts are exempt from this check; it is enforced only at activation time.
   * @param config the pricing portion of the plan to validate.
   * @throws BusinessException if any required field for the declared type is missing or incompatible.
   */
  private _validateActivableConfig(config: PlanPricingConfig): void {
    // termMonths (fixed una-tantum term) is only meaningful on ONE_TIME plans.
    if (config.type !== PlanType.OneTime && config.termMonths != null) {
      throw new BusinessException("termMonths is only valid for ONE_TIME plans.", "INVALID_PLAN_CONFIG");
    }
    switch (config.type) {
      case PlanType.TieredVolume:
        if (!config.tiers || config.tiers.length === 0) {
          throw new BusinessException("TIERED_VOLUME plan requires at least one tier.", "INVALID_PLAN_CONFIG");
        }
        if (!config.tiersType) {
          throw new BusinessException("TIERED_VOLUME plan requires tiersType.", "INVALID_PLAN_CONFIG");
        }
        if (!config.billingInterval) {
          throw new BusinessException("TIERED_VOLUME plan requires billingInterval.", "INVALID_PLAN_CONFIG");
        }
        // baseCost is optional on TIERED_VOLUME: when > 0 it represents a flat recurring fee
        // billed alongside the per-seat tiered pricing. Negative values are not allowed.
        if (config.baseCost != null && config.baseCost < 0) {
          throw new BusinessException("TIERED_VOLUME plan baseCost must be non-negative.", "INVALID_PLAN_CONFIG");
        }
        break;
      case PlanType.OneTime:
        if (config.baseCost == null) {
          throw new BusinessException("ONE_TIME plan requires baseCost.", "INVALID_PLAN_CONFIG");
        }
        if (config.billingInterval) {
          throw new BusinessException("ONE_TIME plan cannot declare a billingInterval.", "INVALID_PLAN_CONFIG");
        }
        if (config.termMonths != null && config.termMonths <= 0) {
          throw new BusinessException("ONE_TIME plan termMonths must be a positive integer.", "INVALID_PLAN_CONFIG");
        }
        break;
      case PlanType.RecurringFlat:
        if (config.baseCost == null) {
          throw new BusinessException("RECURRING_FLAT plan requires baseCost.", "INVALID_PLAN_CONFIG");
        }
        if (!config.billingInterval) {
          throw new BusinessException("RECURRING_FLAT plan requires billingInterval.", "INVALID_PLAN_CONFIG");
        }
        break;
    }
  }

  /**
   * Validates the cross-field invariants between audience and type. Enforced on
   * create and on every draft edit (the involved fields are always present
   * thanks to the schema defaults).
   * @param plan the audience-related portion of the plan to validate.
   * @throws BusinessException if the audience configuration is inconsistent.
   */
  private _validateAudienceFieldInvariants(plan: { audience: PlanAudience; type: PlanType }): void {
    if (plan.audience === PlanAudience.Reseller && plan.type === PlanType.OneTime) {
      throw new BusinessException(
        "RESELLER-audience plans cannot be ONE_TIME.",
        "INVALID_PLAN_CONFIG",
      );
    }
  }

  /**
   * Validates that the product allows plans for the given audience.
   * @param audience the audience of the plan.
   * @param product the product that owns the plan.
   * @throws BusinessException if the corresponding product flag is disabled.
   */
  private _validateAudienceAgainstProduct(audience: PlanAudience, product: ResponseProductDto): void {
    if (audience === PlanAudience.Reseller && !product.resellerPlansEnabled) {
      throw new BusinessException(
        `Product ${product.id} does not have reseller plans enabled.`,
        "RESELLER_PLANS_DISABLED",
      );
    }
    // The professional is out of scope, so the audience is refused whatever the
    // product flag says. Existing plans stay readable and archivable.
    if (audience === PlanAudience.Professional) {
      throw new BusinessException(
        'The professional is not an active actor: plans cannot target one.',
        "PROFESSIONAL_PLANS_DISABLED",
      );
    }
  }

  /**
   * Tells whether a plan is visible in a scope: Keus sees every plan, a reseller the plans meant for resellers, the
   * ones its orders pick (UR-RK-011), once out of draft (UR-RK-243).
   * @param plan the plan to check.
   * @param scope the request scope.
   * @returns whether the scope can read the plan.
   */
  private _isVisible(plan: Plan, scope: RequestScope): boolean {
    return isUnrestricted(scope) || (plan.audience === PlanAudience.Reseller && plan.status !== PlanStatus.Draft);
  }

  /**
   * Creates a new plan for the given product. The plan is always created in
   * Draft state and is purely local: no Stripe resources are created until
   * the plan is activated via `updatePlan` with `status: ACTIVE`.
   * Cross-field pricing validation is intentionally skipped here so that
   * Drafts can be filled in incrementally; it runs at activation time.
   * Audience invariants and product flag gates are instead enforced here.
   * @param productId the identifier of the product that owns the plan.
   * @param planDto the data describing the plan to create.
   * @returns the created plan, with `status: DRAFT`.
   */
  async createPlan(productId: string, planDto: CreatePlanDto): Promise<ResponsePlanDto> {
    const audience = planDto.audience ?? PlanAudience.Company;
    const offStripe = planDto.offStripe ?? false;

    this._validateAudienceFieldInvariants({ audience, type: planDto.type });
    if (audience !== PlanAudience.Company) {
      const productsService = await this._loadProductsService();
      const product = await productsService.getProduct(productId);
      this._validateAudienceAgainstProduct(audience, product);
    }

    try {
      const id = uuidv4();

      const newPlan: Plan = {
        productId,
        id,
        name: planDto.name,
        normalizedName: searchKeyOf(planDto.name),
        description: planDto.description ?? "",
        type: planDto.type,
        billingInterval: planDto.billingInterval,
        currency: planDto.currency ?? "EUR",
        tiersType: planDto.tiersType,
        tiers: this._normalizeTiersForPersistence(planDto.tiers),
        baseCost: planDto.baseCost,
        stripePriceIds: [],
        status: PlanStatus.Draft,
        audience,
        audienceStatus: audienceStatusOf(audience, PlanStatus.Draft),
        offStripe,
        ...(planDto.activationFeeCents !== undefined && { activationFeeCents: planDto.activationFeeCents }),
        // Stripped of its class identity: Dynamoose refuses a class instance
        // where the schema declares a plain object.
        ...(planDto.assistance && { assistance: { ...planDto.assistance } }),
      };

      this._logger.log(`Creating new draft plan with ID: ${id} for product: ${productId}`);
      const createdPlan = await this._planModel.create(newPlan);
      return plainToInstance(ResponsePlanDto, createdPlan);
    } catch (error) {
      this._logger.error(`Error creating plan for product: ${productId}`, error);
      throw new DatabaseException("An error occurred while creating the plan.", error);
    }
  }

  /**
   * Updates an existing plan. The behavior depends on the current status:
   *   - Draft:    any field is editable. Supplying `status: ACTIVE` triggers
   *               activation, which validates the merged config and creates
   *               the mirroring Stripe Product+Price. On local persistence
   *               failure the Stripe Product is rolled back.
   *   - Active:   the only allowed change is `status: ARCHIVED`. Any other
   *               field update or invalid transition is rejected. Archiving
   *               also archives the Stripe Product.
   *   - Archived: every update is rejected.
   * @param productId the identifier of the product that owns the plan.
   * @param id the identifier of the plan to update.
   * @param planDto the partial data to apply to the plan.
   * @returns the updated plan.
   */
  async updatePlan(
    productId: string,
    id: string,
    planDto: UpdatePlanDto,
  ): Promise<ResponsePlanDto> {
    const existingPlan = await this._planModel.get({ productId, id });
    if (!existingPlan) {
      throw new EntityNotFoundException("Plan", id);
    }

    if (existingPlan.status === PlanStatus.Archived) {
      throw new BusinessException(
        "Cannot modify an archived plan.",
        "PLAN_ARCHIVED",
      );
    }

    if (existingPlan.status === PlanStatus.Active) {
      return await this._handleActivePlanUpdate(productId, id, existingPlan, planDto);
    }

    return await this._handleDraftPlanUpdate(productId, id, existingPlan, planDto);
  }

  /**
   * Handles an update on a plan currently in Active state. Only the
   * transition to Archived is allowed; any other field change or status
   * change is rejected. Archiving cascades to Stripe (Product set inactive).
   */
  private async _handleActivePlanUpdate(
    productId: string,
    id: string,
    existingPlan: Plan,
    planDto: UpdatePlanDto,
  ): Promise<ResponsePlanDto> {
    const { status: requestedStatus, ...fieldUpdates } = planDto;

    if (Object.keys(fieldUpdates).length > 0) {
      throw new BusinessException(
        "Cannot edit fields of an active plan: archive it and create a new draft to introduce changes.",
        "PLAN_IMMUTABLE",
      );
    }

    if (!requestedStatus || requestedStatus === existingPlan.status) {
      // No-op: nothing to apply.
      return plainToInstance(ResponsePlanDto, existingPlan);
    }

    if (requestedStatus !== PlanStatus.Archived) {
      throw new BusinessException(
        `Invalid plan transition: ACTIVE → ${requestedStatus}.`,
        "INVALID_PLAN_TRANSITION",
      );
    }

    // Active → Archived
    if (existingPlan.stripeProductId) {
      const productsService = await this._loadProductsService();
      const product = await productsService.getProduct(productId);
      if (product.stripeApiKey) {
        const stripeService = await this._loadStripeService();
        for (const stripeProductId of [existingPlan.stripeProductId, existingPlan.stripeActivationProductId, existingPlan.stripeAssistanceProductId]) {
          if (stripeProductId) await stripeService.archiveStripeProduct(stripeProductId, product.stripeApiKey);
        }
      } else {
        this._logger.warn(
          `Product ${productId} has no Stripe API key; archiving plan ${id} locally only.`,
        );
      }
    }

    this._logger.log(`Archiving plan ${id} for product ${productId}`);
    const updated = await this._planModel.update({ productId, id }, {
      status: PlanStatus.Archived,
      audienceStatus: audienceStatusOf(existingPlan.audience ?? PlanAudience.Company, PlanStatus.Archived),
    });
    return plainToInstance(ResponsePlanDto, updated);
  }

  /**
   * Handles an update on a plan currently in Draft state. Any field can be
   * edited. Supplying `status: ACTIVE` triggers activation: the merged
   * config is validated, mirrored on Stripe, and persisted with the Stripe
   * refs. On local persistence failure the Stripe Product is rolled back.
   * Direct Draft → Archived is rejected (delete the draft instead).
   */
  private async _handleDraftPlanUpdate(
    productId: string,
    id: string,
    existingPlan: Plan,
    planDto: UpdatePlanDto,
  ): Promise<ResponsePlanDto> {
    const targetStatus = planDto.status ?? existingPlan.status;

    if (targetStatus === PlanStatus.Archived) {
      throw new BusinessException(
        "Cannot archive a draft plan: delete it instead.",
        "INVALID_PLAN_TRANSITION",
      );
    }

    // A null field is removed; the merged plan sees it as absent.
    const { set, remove } = splitRemovals(planDto, PlanSchema, "plan");
    const merged = withoutKeys({ ...existingPlan, ...set } as Plan, remove);

    // Audience invariants hold on every draft edit, not only at activation.
    // Legacy records may miss the audience fields: absence means CLIENT / on-Stripe.
    this._validateAudienceFieldInvariants({ audience: merged.audience ?? PlanAudience.Company, type: merged.type });

    if (targetStatus === PlanStatus.Draft) {
      // Gate the product flags as soon as the audience is set on the draft.
      if (set.audience !== undefined && set.audience !== PlanAudience.Company) {
        const productsService = await this._loadProductsService();
        const product = await productsService.getProduct(productId);
        this._validateAudienceAgainstProduct(set.audience, product);
      }

      // Pure local edit on a draft. Tiers are normalized for Dynamoose (null bounds → absent fields,
      // class identity stripped); other fields can pass through as-is.
      const plainUpdate: Partial<Plan> = {
        ...set,
        ...(set.tiers !== undefined && { tiers: this._normalizeTiersForPersistence(set.tiers) }),
        normalizedName: searchKeyOf(merged.name),
        audienceStatus: audienceStatusOf(merged.audience ?? PlanAudience.Company, PlanStatus.Draft),
      };
      this._logger.log(`Updating draft plan ${id} for product ${productId}`);
      const updated = await this._planModel.update({ productId, id }, toDynamooseUpdate(plainUpdate, remove));
      return plainToInstance(ResponsePlanDto, updated);
    }

    // targetStatus === Active: activation flow.
    this._validateActivableConfig(merged);

    const productsService = await this._loadProductsService();
    const product = await productsService.getProduct(productId);
    this._validateAudienceAgainstProduct(merged.audience ?? PlanAudience.Company, product);

    // Off-Stripe plans activate locally: no Stripe Product/Price is created and
    // no Stripe API key is required on the product. The pricing config is still mandatory.
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket: every plan activates this way.
    if (merged.offStripe || !integrationsEnabled()) {
      const offStripeUpdate: Partial<Plan> = {
        ...set,
        ...(set.tiers !== undefined && { tiers: this._normalizeTiersForPersistence(set.tiers) }),
        normalizedName: searchKeyOf(merged.name),
      };
      this._logger.log(`Activating off-Stripe plan ${id} for product ${productId} (no Stripe sync)`);
      const updated = await this._planModel.update(
        { productId, id },
        toDynamooseUpdate({
          ...offStripeUpdate,
          stripePriceIds: [],
          status: PlanStatus.Active,
          audienceStatus: audienceStatusOf(merged.audience ?? PlanAudience.Company, PlanStatus.Active),
        }, remove),
      );
      return plainToInstance(ResponsePlanDto, updated);
    }

    if (!product.stripeApiKey) {
      throw new BusinessException(
        `Product ${productId} has no Stripe API key configured; cannot activate the plan.`,
        "PRODUCT_MISSING_STRIPE_API_KEY",
      );
    }

    const stripeService = await this._loadStripeService();
    const createStripePlanDto: CreateStripePlanDto = {
      planName: merged.name,
      planDescription: merged.description,
      productId,
      stripeApiKey: product.stripeApiKey,
      type: merged.type,
      currency: merged.currency,
      billingInterval: merged.billingInterval,
      tiersType: merged.tiersType,
      tiers: merged.tiers,
      baseCost: merged.baseCost,
      activationFeeCents: merged.activationFeeCents,
      assistance: merged.assistance,
    };

    // Step 1: mirror on Stripe. If this throws, no local state has changed.
    const stripeRefs = await stripeService.createStripePricingForPlan(createStripePlanDto);

    // Step 2: persist the activation locally. Roll back the Stripe Product on failure.
    // Tiers are normalized for Dynamoose (null bounds → absent fields, class identity stripped).
    const plainUpdate: Partial<Plan> = {
      ...set,
      ...(set.tiers !== undefined && { tiers: this._normalizeTiersForPersistence(set.tiers) }),
      normalizedName: searchKeyOf(merged.name),
    };
    try {
      const updated = await this._planModel.update(
        { productId, id },
        toDynamooseUpdate({
          ...plainUpdate,
          stripeProductId: stripeRefs.stripeProductId,
          stripePriceIds: stripeRefs.stripePriceIds,
          stripeVolumePriceId: stripeRefs.stripeVolumePriceId,
          stripeBasePriceId: stripeRefs.stripeBasePriceId,
          stripeActivationProductId: stripeRefs.stripeActivationProductId,
          stripeActivationPriceId: stripeRefs.stripeActivationPriceId,
          stripeAssistanceProductId: stripeRefs.stripeAssistanceProductId,
          stripeAssistancePriceId: stripeRefs.stripeAssistancePriceId,
          status: PlanStatus.Active,
          audienceStatus: audienceStatusOf(merged.audience ?? PlanAudience.Company, PlanStatus.Active),
        }, remove),
      );
      this._logger.log(`Plan ${id} activated for product ${productId}`);
      return plainToInstance(ResponsePlanDto, updated);
    } catch (error) {
      this._logger.error(
        `Error persisting plan activation on Dynamo for product ${productId}. Rolling back Stripe product ${stripeRefs.stripeProductId}.`,
        error,
      );
      for (const stripeProductId of [stripeRefs.stripeProductId, stripeRefs.stripeActivationProductId, stripeRefs.stripeAssistanceProductId]) {
        if (stripeProductId) await stripeService.archiveStripeProduct(stripeProductId, product.stripeApiKey);
      }
      throw new DatabaseException("An error occurred while activating the plan.", error);
    }
  }

  /**
   * Retrieves a plan by its composite key.
   * @param productId the identifier of the product that owns the plan.
   * @param id the identifier of the plan to retrieve.
   * @returns the retrieved plan.
   */
  async getPlan(productId: string, id: string, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponsePlanDto> {
    try {
      this._logger.log(`Retrieving plan with ID: ${id} for product: ${productId}`);
      const plan = await this._planModel.get({ productId, id });
      if (!plan) {
        this._logger.warn(`Plan with ID: ${id} not found for product: ${productId}.`);
        throw new EntityNotFoundException("Plan", id);
      }

      if (!this._isVisible(plan, scope)) {
        throw new AuthorizationException(`Plan ${id} is outside the scope of reseller ${scope.resellerCode}.`);
      }

      return plainToInstance(ResponsePlanDto, plan);
    } catch (error) {
      this._logger.error(`Error retrieving plan with ID: ${id}`, error);
      if (error instanceof EntityNotFoundException || error instanceof AuthorizationException) {
        throw error;
      }
      throw new DatabaseException(
        `An error occurred while retrieving the plan with ID: ${id}.`,
        error
      );
    }
  }

  /**
   * Lists one page of the plans attached to a product, on the productId hashKey: a name on nameIndex, otherwise an
   * audience or statuses on audienceIndex (one prefix for an audience alone, one partition per audience and status),
   * otherwise by id. The filters the index does not hold are checked on the rows it returns.
   * Resellers only see the plans of _isVisible.
   * @param productId the identifier of the product whose plans are listed.
   * @param query the page and its filters.
   * @param scope the request scope.
   * @returns the page of plans owned by the product.
   * @throws ValidationException if the cursor is not valid.
   */
  async listPlans(productId: string, query: PlansPageQueryDto, scope: RequestScope): Promise<ResponsePlansPageDto> {
    const { limit, cursor, status, audience, name } = query;
    const prefix = name ? normalizeSearchText(name) : "";
    const accept = (plan: Plan): boolean =>
      this._isVisible(plan, scope) && startsWithAny(name, plan.name);

    try {
      let page: Page<Plan>;
      if (prefix) {
        page = await paginate<Plan>(
          () => this._planModel.query("productId").eq(productId).where("normalizedName").beginsWith(prefix).using("nameIndex"),
          ["productId", "id", "normalizedName"],
          limit,
          cursor,
          plan => accept(plan)
            && (!audience || (plan.audience ?? PlanAudience.Company) === audience)
            && (!status?.length || status.includes(plan.status)),
        );
      } else if (!status?.length && !audience) {
        page = await paginate<Plan>(() => this._planModel.query("productId").eq(productId), ["productId", "id"], limit, cursor, accept);
      } else if (!status?.length) {
        page = await paginate<Plan>(
          () => this._planModel.query("productId").eq(productId).where("audienceStatus").beginsWith(`${audience}#`).using("audienceIndex"),
          ["productId", "id", "audienceStatus"],
          limit,
          cursor,
          accept,
        );
      } else {
        const keys = (audience ? [audience] : Object.values(PlanAudience))
          .flatMap(planAudience => status.map(planStatus => audienceStatusOf(planAudience, planStatus)));
        page = await paginateMerged<Plan>(
          keys.map(key => ({
            id: key,
            build: () => this._planModel.query("productId").eq(productId).where("audienceStatus").eq(key).using("audienceIndex"),
          })),
          ["productId", "id", "audienceStatus"],
          // One key per partition: the stable sort keeps each partition in its own order.
          (a, b) => (a.audienceStatus ?? "").localeCompare(b.audienceStatus ?? ""),
          limit,
          cursor,
          accept,
        );
      }

      return { items: page.items.map(plan => plainToInstance(ResponsePlanDto, plan)), nextCursor: page.nextCursor };
    } catch (error) {
      if (error instanceof ValidationException) {
        throw error;
      }
      this._logger.error(`Error listing plans for product: ${productId}`, error);
      throw new DatabaseException(
        `An error occurred while retrieving plans for product: ${productId}.`,
        error
      );
    }
  }

  /**
   * Deletes a plan by its composite key. Only Draft plans can be deleted:
   * Active and Archived plans may be referenced by existing contracts and
   * removing them would orphan those references.
   * @param productId the identifier of the product that owns the plan.
   * @param id the identifier of the plan to delete.
   */
  async deletePlan(productId: string, id: string): Promise<void> {
    const existingPlan = await this._planModel.get({ productId, id });
    if (!existingPlan) {
      throw new EntityNotFoundException("Plan", id);
    }

    if (existingPlan.status !== PlanStatus.Draft) {
      throw new BusinessException(
        `Cannot delete a plan in status ${existingPlan.status}: archive it instead.`,
        "PLAN_NOT_DELETABLE",
      );
    }

    try {
      this._logger.log(`Deleting draft plan with ID: ${id} for product: ${productId}`);
      await this._planModel.delete({ productId, id });
      this._logger.log(`Plan with ID: ${id} deleted successfully.`);
    } catch (error) {
      this._logger.error(`Error deleting plan with ID: ${id}`, error);
      throw new DatabaseException(
        `An error occurred while deleting the plan with ID: ${id}.`,
        error
      );
    }
  }
}
