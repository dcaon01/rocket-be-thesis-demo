// Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { AppException } from "../../../../errors/exception-types";
import type { RocketNotificationDto } from "../../../../commons/dtos/rocket-notification.dto";
import { EntityTypeEnum } from "../../../../commons/enums/entity-type.enum";
import { OperationEnum } from "../../../../commons/enums/operation.enum";
import type { ContractPayloadDto } from "../../../contracts/dtos/contract-payload.dto";
import type { TenantPayloadDto } from "../../../tenants/dtos/tenant-payload.dto";
import type { UserPayloadDto } from "../../../users/dtos/user-payload.dto";
import type { UsersService } from "../../../users/lazy-users/services/users.service";

/**
 * Stands in for the products while the integrations are off (`INTEGRATIONS_ENABLED=false`): instead of publishing on
 * EventBridge, Rocket puts on its own inbound queue the answer a product would give, which then follows the path of
 * a real answer. It answers:
 *   - the TENANT and USER operations of Rocket (with `metadata.rocketOperationId`): the same items back, as confirmed;
 *   - a new CONTRACT: the request of its document, as the dialog the referent of the tenant opens at the first access;
 *   - the link to the document of a CONTRACT with nothing to pay: the acceptance by the referent of the tenant.
 * Anything else, such as the messages to the trials or a payment to set up, gets no answer.
 */
@Injectable()
export class DemoProductService {
  /** Logger instance for DemoProductService. */
  private readonly _logger = new Logger(DemoProductService.name);

  /** SQS client instance. */
  private readonly _client: SQSClient;

  /** URL of the inbound queue the products answer on. */
  private readonly _queueUrl: string;

  /** Lazy-loaded users service. */
  private _usersService: UsersService | null = null;

  /**
   * Constructor for DemoProductService: builds the client with the credentials of the environment.
   * @param _lazyModuleLoader the lazy module loader used to resolve the users service on demand.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) {
    const region = process.env.AWS_REGION;

    this._queueUrl = process.env.SQS_INBOUND_QUEUE_URL || '';

    if (process.env.NODE_ENV === 'development') {
      this._client = new SQSClient({
        region: region || 'eu-west-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
      });
    } else {
      this._client = new SQSClient({
        region: region || 'eu-west-1',
      });
    }

    this._logger.log('Demo product service initialized successfully');
  }

  /**
   * Lazy loads the UsersService from its module.
   * @returns a Promise resolving to the UsersService instance.
   */
  private async _loadUsersService(): Promise<UsersService> {
    if (!this._usersService) {
      const { UsersLazyModule } = await import("../../../users/lazy-users/users-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => UsersLazyModule);
      const { UsersService } = await import("../../../users/lazy-users/services/users.service");
      this._usersService = moduleRef.get<UsersService>(UsersService);
    }
    return this._usersService;
  }

  /**
   * Answers a notification of Rocket as its product would, on the inbound queue.
   * @param notification the notification Rocket would have published.
   * @throws AppException if the answer cannot be put on the queue.
   */
  async answer(notification: RocketNotificationDto): Promise<void> {
    const answer = await this._answerOf(notification);
    if (!answer) {
      this._logger.log(`No answer of product ${notification.productId} to ${notification.entityType}/${notification.operation}.`);
      return;
    }

    try {
      await this._client.send(new SendMessageCommand({ QueueUrl: this._queueUrl, MessageBody: JSON.stringify(answer) }));
    } catch (error) {
      this._logger.error(`Error answering for product ${notification.productId}`, error);
      throw new AppException(`Failed to answer for product ${notification.productId}`, 500, error);
    }
    this._logger.log(`Answered for product ${notification.productId}: ${answer.entityType}/${answer.operation}.`);
  }

  /**
   * Builds the answer a product would give to a notification.
   * @param notification the notification of Rocket.
   * @returns the answer, or null when the product would not answer.
   */
  private async _answerOf(notification: RocketNotificationDto): Promise<RocketNotificationDto | null> {
    const { productId, operation, entityType, payload } = notification;

    switch (entityType) {
      case EntityTypeEnum.Tenant:
      case EntityTypeEnum.User: {
        // Only an operation of Rocket waits for an answer; a notice such as a user over the trial seats does not.
        const requested = payload.filter(item => (item as TenantPayloadDto | UserPayloadDto).metadata?.rocketOperationId);
        return requested.length > 0 ? { ...notification, payload: requested } : null;
      }
      case EntityTypeEnum.Contract: {
        const [contract] = payload as ContractPayloadDto[];
        if (operation === OperationEnum.Create) {
          return this._contractAnswer(productId, { id: contract.id, tenantId: contract.tenantId });
        }
        if (contract.documentUrl && !contract.paymentRequired) {
          return this._acceptance(productId, contract);
        }
        return null;
      }
      default:
        return null;
    }
  }

  /**
   * Builds the acceptance of a contract by the referent of its tenant, read now that the provisioning is settled.
   * @param productId the product of the contract.
   * @param contract the contract with the link to its document.
   * @returns the acceptance, or null when the tenant has no referent.
   */
  private async _acceptance(productId: string, contract: ContractPayloadDto): Promise<RocketNotificationDto | null> {
    const usersService = await this._loadUsersService();
    const referent = await usersService.getReferent(productId, contract.tenantId ?? '');
    if (!referent) {
      this._logger.warn(`Tenant ${contract.tenantId} of product ${productId} has no referent: contract ${contract.id} left to accept.`);
      return null;
    }

    const name = [referent.name, referent.surname].filter(Boolean).join(' ');
    return this._contractAnswer(productId, {
      id: contract.id,
      tenantId: contract.tenantId,
      acceptedAt: new Date().toISOString(),
      acceptedByUserId: referent.id,
      acceptedByEmail: referent.email,
      ...(name && { acceptedByName: name }),
    });
  }

  /**
   * Wraps a contract message of the product, sent as an UPDATE like the dialog of the referent does.
   * @param productId the product of the contract.
   * @param contract the contract message.
   * @returns the notification.
   */
  private _contractAnswer(productId: string, contract: ContractPayloadDto): RocketNotificationDto {
    return { productId, operation: OperationEnum.Update, entityType: EntityTypeEnum.Contract, payload: [contract] };
  }
}
