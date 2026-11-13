import { Injectable, Logger } from "@nestjs/common";
import { SYSTEM_SCOPE } from "@rocket-be/scoping";
import { LazyModuleLoader } from "@nestjs/core";
import { AppException } from "../../../../errors/exception-types";
import { S3Service } from "../../../s3/lazy-s3/services/s3.service";
import { S3EntityType } from "../../../s3/enums/s3-entity-type.enum";
import { ProductsService } from "../../../products/lazy-products/services/products.service";
import { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import type { S3Event } from "aws-lambda";

/**
 * Service for handling S3 events received via SQS.
 * Processes S3 event notifications and updates the corresponding entities.
 */
@Injectable()
export class SqsS3EventService {
  /** Logger instance for SqsS3EventService. */
  private readonly _logger = new Logger(SqsS3EventService.name);

  /** Lazy-loaded S3 service */
  private _s3Service: S3Service | null = null;

  /** Lazy-loaded products service */
  private _productsService: ProductsService | null = null;

  /** Lazy-loaded resellers service */
  private _resellersService: ResellersService | null = null;

  /**
   * Constructor for SqsS3EventService.
   * @param _lazyModuleLoader the lazy module loader.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

  /**
   * Lazy loads the S3Service from its module.
   * @returns A Promise resolving to the S3Service instance.
   */
  private async _loadS3Service(): Promise<S3Service> {
    if (!this._s3Service) {
      const { S3LazyModule } = await import(
        "../../../s3/lazy-s3/s3-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => S3LazyModule,
      );
      this._s3Service = moduleRef.get<S3Service>(S3Service);
    }
    return this._s3Service;
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
   * Handles an S3 event notification received from SQS.
   * @param s3Event the S3 event notification.
   * @returns confirmation message.
   */
  async handleS3Event(s3Event: S3Event): Promise<{ message: string }> {
    this._logger.log(`Received S3 event: ${JSON.stringify(s3Event)}`);
    try {
      if (s3Event.Records && s3Event.Records.length > 0) {
        for (const record of s3Event.Records) {
          if (record.eventSource === 'aws:s3' && record.eventName.startsWith('ObjectCreated')) {
            const decodedKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
            await this._handleS3ObjectCreated(decodedKey);
          }
        }
      }

      return { message: 'S3 event processed' };

    } catch (error) {
      this._logger.error('Error handling S3 event', error);
      throw new AppException(
        'Something went wrong while processing S3 event',
        500,
        error
      );
    }
  }

  /**
   * Handles S3 object created event.
   * Updates the corresponding entity with the S3 key.
   * @param s3Key the S3 key of the uploaded object.
   */
  private async _handleS3ObjectCreated(s3Key: string): Promise<void> {
    this._logger.log(`Processing S3 object created: ${s3Key}`);

    try {
      const s3Service = await this._loadS3Service();
      const entityInfo = s3Service.parseS3Key(s3Key);

      switch (entityInfo.entityType) {
        case S3EntityType.ProductLogo:
          await this._updateProductLogoS3Key(entityInfo.entityId, s3Key);
          break;

        case S3EntityType.ResellerLogo:
          await this._updateResellerLogoS3Key(entityInfo.entityId, s3Key);
          break;

        // Confirmed by the entity's own update, which reads the object metadata.
        case S3EntityType.MaterialFile:
        case S3EntityType.TemplateSource:
          break;

        // Recorded by the contract update that carries the key.
        case S3EntityType.ResellerContractSigned:
          break;

        // Recorded by the order action that carries the key (accept, financing, draft edit).
        case S3EntityType.OrderSignedOffer:
        case S3EntityType.OrderFinancingContract:
        case S3EntityType.OrderCustomizationAttachment:
        case S3EntityType.OrderCustomizationVoiceNote:
          break;

        default:
          this._logger.warn(`Unknown entity type for S3 key: ${s3Key}`);
      }
    } catch (error) {
      this._logger.error(`Error processing S3 object: ${s3Key}`, error);
    }
  }

  /**
   * Updates the product with the logo S3 key, and publishes a copy of the logo for the emails to the companies.
   * A copy that fails leaves the emails without the logo, not the product without it.
   * @param productId the product ID.
   * @param s3Key the S3 key.
   */
  private async _updateProductLogoS3Key(
    productId: string,
    s3Key: string
  ): Promise<void> {
    const productsService = await this._loadProductsService();
    let emailLogoUrl: string | undefined;
    try {
      const s3Service = await this._loadS3Service();
      // A new name at every upload: the mail clients cache the images by URL.
      emailLogoUrl = await s3Service.publishEmailAsset(s3Key, `products/${productId}/logo-${Date.now()}.${s3Key.split('.').pop()}`);
    } catch (error) {
      this._logger.warn(`Logo of product ${productId} not published for the emails`, error);
    }
    try {
      await productsService.recordLogo(productId, s3Key, emailLogoUrl);
    } catch (error) {
      this._logger.error(`Failed to update product ${productId} with logo S3 key: ${s3Key}`, error);
      throw new AppException(
        `Failed to update product with S3 key: ${s3Key}`,
        500,
        error
      );
    }
  }

  /**
   * Updates the reseller with the logo S3 key.
   * @param resellerId the reseller ID.
   * @param s3Key the S3 key.
   */
  private async _updateResellerLogoS3Key(
    resellerId: string,
    s3Key: string
  ): Promise<void> {
    const resellersService = await this._loadResellersService();
    try {
      await resellersService.updateReseller(resellerId, { logoS3Key: s3Key }, SYSTEM_SCOPE);
    } catch (error) {
      this._logger.error(`Failed to update reseller ${resellerId} with logo S3 key: ${s3Key}`, error);
      throw new AppException(
        `Failed to update reseller with S3 key: ${s3Key}`,
        500,
        error
      );
    }
  }
}
