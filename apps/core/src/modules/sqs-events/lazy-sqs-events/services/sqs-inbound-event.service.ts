import { Injectable, Logger } from "@nestjs/common";
import { SYSTEM_SCOPE } from "@rocket-be/scoping";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { RocketNotificationDto } from "../../../../commons/dtos/rocket-notification.dto";
import { OperationEnum } from "../../../../commons/enums/operation.enum";
import { EntityTypeEnum } from "../../../../commons/enums/entity-type.enum";
import { RecipientTypeEnum } from "../../../../commons/enums/recipient-type.enum";
import { ProductMessageTemplate } from "../../../../commons/enums/product-message-template.enum";
import { TrialStatus } from "../../../trials/enums/trial-status.enum";
import { DuplicateEmailException, ValidationException } from "../../../../errors/exception-types";
import { UsersService } from "../../../users/lazy-users/services/users.service";
import { TenantsService } from "../../../tenants/lazy-tenants/services/tenants.service";
import { TrialsService } from "../../../trials/lazy-trials/services/trials.service";
import { ContractsService } from "../../../contracts/lazy-contracts/services/contracts.service";
import { ResellerContractStatus } from "../../../reseller-contracts/enums/reseller-contract-status.enum";
import type { ResellerContractsService } from "../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service";
import { ProductsService } from "../../../products/lazy-products/services/products.service";
import { EventBridgeService } from "../../../event-bridge/lazy-event-bridge/services/event-bridge.service";
import { PendingOperationsService } from "../../../pending-operations/lazy-pending-operations/services/pending-operations.service";
import { TrialBundleDto } from "../../../trials/dtos/trial-bundle.dto";
import type { ContractEvent } from "../../../contracts/enums/contract-event.enum";
import { ContractPayloadDto } from "../../../contracts/dtos/contract-payload.dto";
import type { MessagePayloadDto } from "../../../../commons/dtos/message-payload.dto";

import type { CreateUserDto } from "../../../users/dtos/create-user.dto";
import type { UserPayloadDto } from "../../../users/dtos/user-payload.dto";
import type { CreateTenantDto } from "../../../tenants/dtos/create-tenant.dto";
import type { TenantPayloadDto } from "../../../tenants/dtos/tenant-payload.dto";
import type { CreateTrialDto } from "../../../trials/dtos/create-trial.dto";
import type { UpdateTrialDto } from "../../../trials/dtos/update-trial.dto";
import type { TrialPayloadDto } from "../../../trials/dtos/trial-payload.dto";
import type { ResponseTrialDto } from "../../../trials/dtos/response-trial.dto";
import type { DunningStep } from "../../../invoices/enums/dunning-step.enum";

/**
 * Service for handling inbound queue events received via SQS.
 * Routes notifications to the appropriate entity service based on
 * the combination of entityType and operation.
 */
@Injectable()
export class SqsInboundEventService {
  /** Logger instance for SqsInboundEventService. */
  private readonly _logger = new Logger(SqsInboundEventService.name);

  /** Lazy-loaded users service */
  private _usersService: UsersService | null = null;

  /** Lazy-loaded tenants service */
  private _tenantsService: TenantsService | null = null;

  /** Lazy-loaded trials service */
  private _trialsService: TrialsService | null = null;

  /** Lazy-loaded contracts service */
  private _contractsService: ContractsService | null = null;

  /** Lazy-loaded reseller contracts service */
  private _resellerContractsService: ResellerContractsService | null = null;

  /** Lazy-loaded products service */
  private _productsService: ProductsService | null = null;

  /** Lazy-loaded event bridge service */
  private _eventBridgeService: EventBridgeService | null = null;

  /** Lazy-loaded pending operations service. */
  private _pendingOperationsService: PendingOperationsService | null = null;

  /**
   * Constructor for SqsInboundEventService.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) {}

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
   * Lazy loads the PendingOperationsService from its module.
   * @returns A Promise resolving to the PendingOperationsService instance.
   */
  private async _loadPendingOperationsService(): Promise<PendingOperationsService> {
    if (!this._pendingOperationsService) {
      const { PendingOperationsLazyModule } = await import(
        "../../../pending-operations/lazy-pending-operations/pending-operations-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => PendingOperationsLazyModule,
      );
      this._pendingOperationsService = moduleRef.get<PendingOperationsService>(PendingOperationsService);
    }
    return this._pendingOperationsService;
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
   * Lazy loads the ResellerContractsService from its module.
   * @returns A Promise resolving to the ResellerContractsService instance.
   */
  private async _loadResellerContractsService(): Promise<ResellerContractsService> {
    if (!this._resellerContractsService) {
      const { ResellerContractsLazyModule } = await import(
        "../../../reseller-contracts/lazy-reseller-contracts/reseller-contracts-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ResellerContractsLazyModule,
      );
      const { ResellerContractsService } = await import(
        "../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service"
      );
      this._resellerContractsService = moduleRef.get<ResellerContractsService>(ResellerContractsService);
    }
    return this._resellerContractsService;
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
   * Handles an inbound SQS message.
   * Validates the notification DTO and routes each payload item
   * to the appropriate entity handler based on entityType and operation.
   * @param body the raw parsed message body.
   * @returns confirmation message.
   */
  async handleInboundMessage(body: unknown): Promise<{ message: string }> {
    this._logger.log(`Received inbound message (raw): ${JSON.stringify(body)}`);
    const notification = plainToInstance(RocketNotificationDto, body);
    this._logger.log(`Received inbound notification (parsed): ${JSON.stringify(notification)}`);
    const errors = await validate(notification);

    if (errors.length > 0) {
      const errorMessages = errors.map(e => Object.values(e.constraints ?? {}).join(', ')).join('; ');
      this._logger.error(`Invalid inbound notification: ${errorMessages}`);
      throw new ValidationException(`Invalid inbound notification: ${errorMessages}`, errors);
    }

    const { productId, operation, entityType, payload } = notification;

    if (!productId) {
      this._logger.error('productId is required for inbound messages');
      throw new ValidationException('productId is required for inbound messages.', []);
    }

    if (!entityType) {
      this._logger.error('entityType is required for inbound messages');
      throw new ValidationException('entityType is required for inbound messages.', []);
    }

    this._logger.log(`Processing inbound message: product=${productId}, entityType=${entityType}, operation=${operation}, payloadCount=${payload.length}`);

    for (const item of payload) {
      try {
        await this._processPayloadItem(productId, entityType, operation, item);
      } catch (error) {
        this._logger.error(
          `Error processing payload item for ${entityType}/${operation}: ${JSON.stringify(item)}`,
          error,
        );
        throw error;
      }
    }

    return { message: 'Inbound message processed' };
  }

  /**
   * Routes a single payload item to the correct entity handler.
   * @param entityType the entity type.
   * @param operation the operation to perform.
   * @param item the payload item.
   */
  private async _processPayloadItem(
    productId: string,
    entityType: EntityTypeEnum,
    operation: OperationEnum,
    item: object,
  ): Promise<void> {
    switch (entityType) {
      case EntityTypeEnum.User:
        await this._handleUserOperation(productId, operation, item);
        break;
      case EntityTypeEnum.Tenant:
        await this._handleTenantOperation(productId, operation, item);
        break;
      case EntityTypeEnum.Trial:
        await this._handleTrialOperation(productId, operation, item);
        break;
      case EntityTypeEnum.TrialBundle:
        await this._handleTrialBundleOperation(productId, operation, item);
        break;
      case EntityTypeEnum.Contract:
        if ("event" in item) {
          await this._handleContractOperation(productId, item);
        } else {
          await this._handleProductContractMessage(productId, item);
        }
        break;
      case EntityTypeEnum.ResellerContract:
        await this._handleResellerContractOperation(item);
        break;
      case EntityTypeEnum.Message:
        await this._handleMessageOperation(productId, operation, item);
        break;
      case EntityTypeEnum.PendingOperation:
        await this._handlePendingOperationRetry(productId, item);
        break;
      case EntityTypeEnum.PendingOperationSweep:
        await this._handlePendingOperationSweep();
        break;
      case EntityTypeEnum.ResellerCharge:
        await this._handleResellerCharge(item);
        break;
      case EntityTypeEnum.CustomerDuesDigest:
        await this._handleCustomerDuesDigest();
        break;
      case EntityTypeEnum.OrderOverdueCheck:
        await this._handleOrderOverdueCheck();
        break;
      case EntityTypeEnum.MetricsRefresh:
        await this._handleMetricsRefresh();
        break;
      case EntityTypeEnum.HealthCheck:
        await this._handleHealthCheck();
        break;
      case EntityTypeEnum.InvoiceDunning:
        await this._handleInvoiceDunning(item);
        break;
    }
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
   * Handles MESSAGE operations: forwards the payload to the product via EventBridge.
   * Used by reminder schedules and any other producer that wants to delegate
   * email delivery to the receiving product.
   * @param productId target product.
   * @param operation operation (only CREATE is supported).
   * @param item the MessagePayloadDto-shaped item.
   */
  private async _handleMessageOperation(productId: string, operation: OperationEnum, item: object): Promise<void> {
    if (operation !== OperationEnum.Create) {
      this._logger.warn(`Unsupported MESSAGE operation ${operation}; ignoring.`);
      return;
    }
    const eventBridge = await this._loadEventBridgeService();
    await eventBridge.sendMessage(productId, item as MessagePayloadDto);
  }

  /**
   * Handles the scheduled attempt of a pending operation: sends it again if it is still waiting for the product.
   * @param productId the product the operation is sent to.
   * @param item the `{ id }` of the operation.
   */
  private async _handlePendingOperationRetry(productId: string, item: object): Promise<void> {
    const { id } = item as { id: string };
    const pendingOperationsService = await this._loadPendingOperationsService();
    this._logger.log(`Retrying pending operation ${id} for product ${productId}`);
    await pendingOperationsService.retry({ productId, id });
  }

  /**
   * Handles the periodic sweep from EventBridge Scheduler: sends again the pending operations whose own schedule never fired.
   */
  private async _handlePendingOperationSweep(): Promise<void> {
    const pendingOperationsService = await this._loadPendingOperationsService();
    await pendingOperationsService.sweep();
  }

  /**
   * Runs the charge of the resellers on the 4th of a month, from EventBridge Scheduler.
   * @param item the payload item: the month of the charge.
   */
  private async _handleResellerCharge(item: object): Promise<void> {
    const { month } = item as { month: string };
    const { InvoicesLazyModule } = await import("../../../invoices/lazy-invoices/invoices-lazy.module");
    const moduleRef = await this._lazyModuleLoader.load(() => InvoicesLazyModule);
    const { MonthlyChargeService } = await import("../../../invoices/lazy-invoices/services/monthly-charge.service");
    this._logger.log(`Charging the resellers for ${month}`);
    await moduleRef.get(MonthlyChargeService).chargeMonth(month);
  }

  /**
   * Reminds the resellers of the due dates of their customers still open, once a day from EventBridge Scheduler.
   */
  private async _handleCustomerDuesDigest(): Promise<void> {
    const { InvoicesLazyModule } = await import("../../../invoices/lazy-invoices/invoices-lazy.module");
    const moduleRef = await this._lazyModuleLoader.load(() => InvoicesLazyModule);
    const { CustomerChargesService } = await import("../../../invoices/lazy-invoices/services/customer-charges.service");
    await moduleRef.get(CustomerChargesService).sendDueDigests();
  }

  /**
   * Tells the Keus back office of the confirmed orders past their delivery date, once a day from EventBridge Scheduler.
   */
  private async _handleOrderOverdueCheck(): Promise<void> {
    const { OrdersLazyModule } = await import("../../../orders/lazy-orders/orders-lazy.module");
    const moduleRef = await this._lazyModuleLoader.load(() => OrdersLazyModule);
    const { OrdersService } = await import("../../../orders/lazy-orders/services/orders.service");
    await moduleRef.get(OrdersService).noticeOverdueOrders();
  }

  /**
   * Recalculates the metrics of the current month, once a day from EventBridge Scheduler.
   */
  private async _handleMetricsRefresh(): Promise<void> {
    const { MetricsLazyModule } = await import("../../../metrics/lazy-metrics/metrics-lazy.module");
    const moduleRef = await this._lazyModuleLoader.load(() => MetricsLazyModule);
    const { MetricsService } = await import("../../../metrics/lazy-metrics/services/metrics.service");
    await moduleRef.get(MetricsService).refreshCurrentMonth();
  }

  /**
   * Checks the health address of the products, every 15 minutes from EventBridge Scheduler.
   */
  private async _handleHealthCheck(): Promise<void> {
    const { MetricsLazyModule } = await import("../../../metrics/lazy-metrics/metrics-lazy.module");
    const moduleRef = await this._lazyModuleLoader.load(() => MetricsLazyModule);
    const { MetricsService } = await import("../../../metrics/lazy-metrics/services/metrics.service");
    await moduleRef.get(MetricsService).checkProductsHealth();
  }

  /**
   * Runs a step of the dunning of an unpaid invoice, from EventBridge Scheduler.
   * @param item the payload item: the invoice and the step.
   */
  private async _handleInvoiceDunning(item: object): Promise<void> {
    const { billedPartyId, id, step } = item as { billedPartyId: string; id: string; step: DunningStep };
    const { InvoicesLazyModule } = await import("../../../invoices/lazy-invoices/invoices-lazy.module");
    const moduleRef = await this._lazyModuleLoader.load(() => InvoicesLazyModule);
    const { InvoicesService } = await import("../../../invoices/lazy-invoices/services/invoices.service");
    this._logger.log(`Running ${step} of invoice ${id}`);
    await moduleRef.get(InvoicesService).runDunningStep({ billedPartyId, id }, step);
  }

  /**
   * Handles all user operations.
   * @param operation the operation to perform.
   * @param item the payload item containing user data.
   */
  private async _handleUserOperation(productId: string, operation: OperationEnum, item: object): Promise<void> {
    const usersService = await this._loadUsersService();

    switch (operation) {
      case OperationEnum.Create: {
        // An answer to a request of Rocket carries the id of its pending operation; anything else is the product's own initiative.
        if ((item as UserPayloadDto).metadata?.rocketOperationId) {
          this._logger.log(`Recording the answer to a user request for product ${productId}`);
          await usersService.confirmUserRequest(productId, item as UserPayloadDto);
          break;
        }
        const { data, metadata, ...standard } = item as UserPayloadDto;

        // Resolve tenantName from the tenant ID in the payload
        const tenantsService = await this._loadTenantsService();
        const tenant = await tenantsService.getTenant(productId, standard.tenant ?? '');

        // Resolve productName from the productId
        const productsService = await this._loadProductsService();
        const product = await productsService.getProduct(productId);

        const dto = {
          ...standard,
          data,
          ...(metadata || {}),
          productId,
          tenantName: tenant.name,
          productName: product.name,
          resellerPath: tenant.resellerPath,
        } as unknown as CreateUserDto;
        this._logger.log(`Creating user for product ${productId}`);
        const created = await usersService.createUser(dto);
        await usersService.recordUserCreation(productId, { ...(item as UserPayloadDto), id: created.id });
        break;
      }

      // An answer to an operation of Rocket carries its id; anything else is the product's own initiative.
      case OperationEnum.Update:
      case OperationEnum.Delete: {
        const user = item as UserPayloadDto;
        if (user.metadata?.rocketOperationId) {
          this._logger.log(`Recording the answer to a user operation for product ${productId}`);
          await usersService.confirmUserOperation(productId, user);
        } else if (operation === OperationEnum.Update) {
          this._logger.log(`Updating user ${user.id} for product ${productId}`);
          await usersService.applyUserUpdate(productId, user);
        } else {
          this._logger.log(`Deleting user ${user.id} for product ${productId}`);
          await usersService.applyUserDeletion(productId, user);
        }
        break;
      }

    }
  }

  /**
   * Handles all tenant operations.
   * @param operation the operation to perform.
   * @param item the payload item containing tenant data.
   */
  private async _handleTenantOperation(productId: string, operation: OperationEnum, item: object): Promise<void> {
    const tenantsService = await this._loadTenantsService();

    switch (operation) {
      case OperationEnum.Create: {
        // An answer to a request of Rocket carries the id of its pending operation; anything else is the product's own initiative.
        if ((item as TenantPayloadDto).metadata?.rocketOperationId) {
          this._logger.log(`Recording the answer to a tenant request for product ${productId}`);
          await tenantsService.confirmTenantRequest(productId, item as TenantPayloadDto);
          break;
        }
        const { data, metadata, ...standard } = item as TenantPayloadDto;
        const dto = { ...standard, data, ...(metadata || {}), productId } as CreateTenantDto;
        this._logger.log(`Creating tenant for product ${productId}`);
        const created = await tenantsService.createTenant(dto);
        await tenantsService.recordTenantCreation(productId, { ...(item as TenantPayloadDto), id: created.id });
        break;
      }

      // An answer to an operation of Rocket carries its id; anything else is the product's own initiative.
      case OperationEnum.Update:
      case OperationEnum.Delete: {
        const tenant = item as TenantPayloadDto;
        if (tenant.metadata?.rocketOperationId) {
          this._logger.log(`Recording the answer to a tenant operation for product ${productId}`);
          await tenantsService.confirmTenantOperation(productId, tenant);
        } else if (operation === OperationEnum.Update) {
          this._logger.log(`Updating tenant ${tenant.id} for product ${productId}`);
          await tenantsService.applyTenantUpdate(productId, tenant);
        } else {
          this._logger.log(`Deleting tenant ${tenant.id} for product ${productId}`);
          await tenantsService.applyTenantDeletion(productId, tenant);
        }
        break;
      }

    }
  }

  /**
   * Handles direct trial operations (update, delete).
   * Used by EventBridge Scheduler for trial expiration.
   * @param productId the product ID.
   * @param operation the operation to perform.
   * @param item the payload item containing trial data.
   */
  private async _handleTrialOperation(productId: string, operation: OperationEnum, item: object): Promise<void> {
    const trialsService = await this._loadTrialsService();

    switch (operation) {
      case OperationEnum.Update: {
        const { id, ...updateData } = item as TrialPayloadDto & { id: string };
        // An expiration that outlived its trial (converted, closed by hand) must not close it again.
        if ((updateData as { status?: TrialStatus }).status === TrialStatus.Expired
          && (await trialsService.getTrial(productId, id)).status !== TrialStatus.Active) {
          this._logger.log(`Trial ${id} of product ${productId} is no longer active: expiration skipped.`);
          break;
        }
        this._logger.log(`Updating trial ${id} for product ${productId}`);
        const updatedTrial = await trialsService.updateTrial(productId, id, updateData as UpdateTrialDto);

        if ((updateData as { status?: TrialStatus }).status === TrialStatus.Expired) {
          await this._notifyTrialExpired(productId, updatedTrial.associatedEmail);
        }
        break;
      }

      case OperationEnum.Delete: {
        const { id } = item as { id: string };
        this._logger.log(`Deleting trial ${id} for product ${productId}`);
        await trialsService.deleteTrial(productId, id);
        break;
      }
    }
  }

  /**
   * Sends the TRIAL_END MESSAGE notification after a trial has expired.
   * Targets directly the email associated with the trial.
   * @param productId the product ID.
   * @param associatedEmail the trial owner's email.
   */
  private async _notifyTrialExpired(productId: string, associatedEmail: string): Promise<void> {
    const productsService = await this._loadProductsService();
    const product = await productsService.getProduct(productId);

    const payload: MessagePayloadDto = {
      recipientType: RecipientTypeEnum.User,
      to: associatedEmail,
      subject: "Trial scaduto",
      template: ProductMessageTemplate.TrialEnd,
      body: {
        message: `Il tuo trial ${product.name} è scaduto.\nPer acquistare la licenza contatta il nostro commerciale di riferimento.`,
      },
    };

    const eventBridge = await this._loadEventBridgeService();
    await eventBridge.sendMessage(productId, payload);
  }

  /**
   * Handles trial bundle operations (create bundle with trial+tenant+user, update, delete).
   * @param productId the product ID.
   * @param operation the operation to perform.
   * @param item the payload item containing trial bundle data.
   */
  private async _handleTrialBundleOperation(productId: string, operation: OperationEnum, item: object): Promise<void> {
    const trialsService = await this._loadTrialsService();

    switch (operation) {
      case OperationEnum.Create: {
        const bundleDto = plainToInstance(TrialBundleDto, item);
        const errors = await validate(bundleDto);

        if (errors.length > 0) {
          const errorMessages = errors.map(e => Object.values(e.constraints ?? {}).join(', ')).join('; ');
          this._logger.error(`Invalid trial bundle payload: ${errorMessages}`);
          throw new ValidationException(`Invalid trial bundle payload: ${errorMessages}`, errors);
        }

        // 1. Create trial
        const createdTrial = await this._createBundleTrial(productId, bundleDto);

        // 2. Create tenant with trialId from the created trial
        const tenantsService = await this._loadTenantsService();
        const { data: tenantData, metadata: tenantMetadata, ...tenantStandard } = bundleDto.tenant;
        const tenantDto = {
          ...tenantStandard,
          data: tenantData,
          ...(tenantMetadata || {}),
          productId,
          trialId: createdTrial.id,
          trialEmail: bundleDto.trial.associatedEmail,
        } as CreateTenantDto;
        this._logger.log(`Creating tenant for trial ${createdTrial.id}, product ${productId}`);
        const createdTenant = await tenantsService.createTenant(tenantDto);
        await tenantsService.recordTenantCreation(productId, { ...bundleDto.tenant, id: createdTenant.id });

        // 3. Create user with tenant from the created tenant
        const usersService = await this._loadUsersService();
        const productsService = await this._loadProductsService();
        const product = await productsService.getProduct(productId);
        const { data: userData, metadata: userMetadata, ...userStandard } = bundleDto.user;
        const userDto = {
          ...userStandard,
          data: userData,
          ...(userMetadata || {}),
          productId,
          tenant: createdTenant.id,
          tenantName: createdTenant.name,
          productName: product.name,
          resellerPath: createdTenant.resellerPath,
        } as unknown as CreateUserDto;
        this._logger.log(`Creating user for tenant ${createdTenant.id}, product ${productId}`);
        const createdUser = await usersService.createUser(userDto);
        await usersService.recordUserCreation(productId, { ...bundleDto.user, id: createdUser.id });

        break;
      }

      case OperationEnum.Update: {
        const { id, ...updateData } = item as TrialPayloadDto & { id: string };
        this._logger.log(`Updating trial ${id} for product ${productId}`);
        await trialsService.updateTrial(productId, id, updateData as UpdateTrialDto);
        break;
      }

      case OperationEnum.Delete: {
        const { id } = item as { id: string };
        this._logger.log(`Deleting trial ${id} for product ${productId}`);
        await trialsService.deleteTrial(productId, id);
        break;
      }

    }
  }

  /**
   * Creates the trial of a bundle, or goes on with the trial the email already holds when it is the bundle's own: one
   * redeemed by the bundle's tenant, or an active one not yet redeemed (created by a first delivery that failed later,
   * or given from Rocket and now taken up on the product). The tenant and the user are created idempotently too.
   * @param productId the product ID.
   * @param bundle the validated bundle.
   * @returns the trial of the bundle.
   * @throws DuplicateEmailException if the email already holds another trial on the product.
   */
  private async _createBundleTrial(productId: string, bundle: TrialBundleDto): Promise<ResponseTrialDto> {
    const trialsService = await this._loadTrialsService();
    try {
      this._logger.log(`Creating trial for product ${productId}`);
      return await trialsService.createTrial({ ...bundle.trial, productId } as CreateTrialDto);
    } catch (error) {
      if (!(error instanceof DuplicateEmailException)) {
        throw error;
      }
      const existing = await trialsService.findTrialByEmail(productId, bundle.trial.associatedEmail ?? '');
      const tenantsService = await this._loadTenantsService();
      const [tenant] = bundle.tenant.id ? await tenantsService.getTenantsByKeys([{ productId, id: bundle.tenant.id }]) : [];
      if (existing && ((existing.status === TrialStatus.Active && !existing.redeemed) || tenant?.trialId === existing.id)) {
        this._logger.log(`Trial ${existing.id} already held by the email taken up by the bundle for product ${productId}`);
        return existing;
      }
      throw error;
    }
  }

  /**
   * Handles the renewal and termination events of a contract from EventBridge Scheduler.
   * @param productId the product ID.
   * @param item the payload item: the contract and its event.
   */
  private async _handleContractOperation(productId: string, item: object): Promise<void> {
    const { contractId, event } = item as { contractId: string; event: ContractEvent };
    const contractsService = await this._loadContractsService();

    this._logger.log(`Processing scheduled ${event} of contract ${contractId}, product ${productId}`);
    await contractsService.handleScheduledEvent(productId, contractId, event);
  }

  /**
   * Handles a contract message of a product, from the dialog in which the referent accepts the contract at the
   * first access: with `acceptedAt` it records the acceptance, without it it asks for the link to the document.
   * @param productId the product ID.
   * @param item the payload item, a ContractPayloadDto.
   * @throws ValidationException if the payload is invalid, or an acceptance does not say who accepted.
   */
  private async _handleProductContractMessage(productId: string, item: object): Promise<void> {
    const contractDto = plainToInstance(ContractPayloadDto, item);
    const errors = await validate(contractDto);
    if (errors.length > 0) {
      const errorMessages = errors.map(e => Object.values(e.constraints ?? {}).join(', ')).join('; ');
      this._logger.error(`Invalid contract payload: ${errorMessages}`);
      throw new ValidationException(`Invalid contract payload: ${errorMessages}`, errors);
    }

    const contractsService = await this._loadContractsService();
    if (!contractDto.acceptedAt) {
      this._logger.log(`Product ${productId} asks for the document of contract ${contractDto.id}`);
      await contractsService.sendDocumentUrl(productId, contractDto.id);
      return;
    }
    if (!contractDto.acceptedByUserId || !contractDto.acceptedByEmail) {
      throw new ValidationException(`The acceptance of contract ${contractDto.id} does not say which user accepted, with the email.`, []);
    }
    this._logger.log(`Product ${productId} reports the acceptance of contract ${contractDto.id}`);
    await contractsService.acceptContract(productId, contractDto.id, contractDto.acceptedByUserId, {
      acceptedAt: contractDto.acceptedAt,
      userName: contractDto.acceptedByName,
      userEmail: contractDto.acceptedByEmail,
    });
  }

  /**
   * Handles the renewal and end events of a reseller contract from EventBridge Scheduler.
   * @param item the payload item: the reseller, the contract and either the new validity years or the ENDED status.
   */
  private async _handleResellerContractOperation(item: object): Promise<void> {
    const { resellerId, contractId, validityYears, status } = item as {
      resellerId: string; contractId: string; validityYears?: number; status?: ResellerContractStatus;
    };
    const resellerContractsService = await this._loadResellerContractsService();

    this._logger.log(`Processing scheduled update of reseller contract ${contractId}, reseller ${resellerId}`);
    if (validityYears !== undefined) {
      await resellerContractsService.renewContract(resellerId, contractId, validityYears);
    } else if (status) {
      await resellerContractsService.updateContract(resellerId, contractId, { status }, SYSTEM_SCOPE);
    }
  }
}
