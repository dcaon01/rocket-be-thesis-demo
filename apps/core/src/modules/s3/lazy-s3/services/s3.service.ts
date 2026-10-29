import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { isUnrestricted, RequestScope, UserRole } from "@rocket-be/scoping";
import {
  AppException,
  AuthorizationException,
  BusinessException,
  EntityNotFoundException,
  ValidationException,
} from "../../../../errors/exception-types";
import { assertCollaborator, canSellOn } from "../../../../commons/scoping/scoped-access.helper";
import { MaterialsService } from "../../../materials/lazy-materials/services/materials.service";
import { OrderStatus } from "../../../orders/enums/order-status.enum";
import { OrdersService } from "../../../orders/lazy-orders/services/orders.service";
import { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import type { ResellerContractsService } from "../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service";
import { TemplateType } from "../../../templates/enums/template-type.enum";
import type { TemplatesService } from "../../../templates/lazy-templates/services/templates.service";
import { S3EntityType } from "../../enums/s3-entity-type.enum";
import { PresignedUrlAction } from "../../enums/presigned-url-action.enum";
import { PresignedUrlRequestDto } from "../../dtos/presigned-url-request.dto";
import { PresignedUrlResponseDto } from "../../dtos/presigned-url-response.dto";

/** Presigned URL expiration time in seconds (1 hour). */
const PRESIGNED_URL_EXPIRES_IN = 3600;

/** MIME type of a Word document. */
const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Content types a sales material file may have, besides any image. */
const MATERIAL_CONTENT_TYPES = [
  "application/pdf",
  DOCX_CONTENT_TYPE,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
];

/** Content types a reseller logo may have: the ones Word embeds without conversion. */
const RESELLER_LOGO_CONTENT_TYPES = ["image/png", "image/jpeg"];

/** Profiles that may replace a reseller logo: Keus from the reseller record, the owner from its own. */
const RESELLER_LOGO_WRITERS: readonly UserRole[] = [UserRole.KeusAdmin, UserRole.KeusSales, UserRole.ResellerOwner];

/** Profiles that open and sell orders: they upload the signed offer and the customization files. */
const ORDER_SELLERS: readonly UserRole[] = [
  UserRole.KeusAdmin,
  UserRole.KeusSales,
  UserRole.ResellerOwner,
  UserRole.ResellerBackoffice,
  UserRole.ResellerSales,
];

/** Profiles that edit a draft order, and so its customization files: the sellers, plus the Keus back office. */
const ORDER_EDITORS: readonly UserRole[] = [...ORDER_SELLERS, UserRole.KeusBackoffice];

/** Profiles that manage the financing of an order. */
const ORDER_FINANCING_WRITERS: readonly UserRole[] = [UserRole.KeusAdmin, UserRole.KeusSales];

/**
 * Who may upload each order document and in which statuses, the same as the action that records it:
 * once the order moves on, the file backing it must not change.
 */
const ORDER_DOCUMENT_UPLOADS: Partial<Record<S3EntityType, { roles: readonly UserRole[]; statuses: readonly OrderStatus[] }>> = {
  [S3EntityType.OrderSignedOffer]: { roles: ORDER_SELLERS, statuses: [OrderStatus.Sent] },
  [S3EntityType.OrderFinancingContract]: {
    roles: ORDER_FINANCING_WRITERS,
    statuses: [OrderStatus.Draft, OrderStatus.ToBePriced, OrderStatus.Priced, OrderStatus.Sent, OrderStatus.Accepted],
  },
  [S3EntityType.OrderCustomizationAttachment]: { roles: ORDER_EDITORS, statuses: [OrderStatus.Draft] },
  [S3EntityType.OrderCustomizationVoiceNote]: { roles: ORDER_EDITORS, statuses: [OrderStatus.Draft] },
};

/** Metadata of a stored object, read server-side instead of trusting the client. */
export type S3ObjectInfo = {
  /** MIME type the object was uploaded with. */
  contentType: string;
  /** Size of the object in bytes. */
  sizeBytes: number;
};

/**
 * Service for S3 operations.
 * Handles presigned URL generation and file upload tracking.
 */
@Injectable()
export class S3Service {
  /** Logger instance for S3Service. */
  private readonly _logger = new Logger(S3Service.name);

  /** S3 Client instance. */
  private readonly _s3Client: S3Client;

  /** S3 Bucket name. */
  private readonly _bucketName: string;

  /** Lazy-loaded materials service (used to check what a reseller may download). */
  private _materialsService: MaterialsService | null = null;

  /** Lazy-loaded resellers service (used to scope-check reseller logos). */
  private _resellersService: ResellersService | null = null;

  /** Lazy-loaded reseller contracts service. */
  private _resellerContractsService: ResellerContractsService | null = null;

  /** Lazy-loaded orders service (used to scope-check the order documents). */
  private _ordersService: OrdersService | null = null;

  /** Lazy-loaded templates service (used to check the template sources a reseller downloads). */
  private _templatesService: TemplatesService | null = null;

  /**
   * Constructor for S3Service.
   * @param _lazyModuleLoader the lazy module loader used to resolve the
   * materials, resellers, reseller contracts and orders services for the reseller scope checks.
   */
  constructor(private readonly _lazyModuleLoader: LazyModuleLoader) {
    const region = process.env.AWS_REGION;
    const bucketName = process.env.S3_BUCKET;

    if (!bucketName) {
      this._logger.error('S3_BUCKET is not defined in environment variables');
      throw new Error('S3_BUCKET is required');
    }

    this._bucketName = bucketName;

    // Initialize S3 client
    if (process.env.NODE_ENV === 'development') {
      this._s3Client = new S3Client({
        region: region || 'eu-west-1',
        requestChecksumCalculation: 'WHEN_REQUIRED',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
      });
    } else {
      // In production, use default credentials (IAM role)
      this._s3Client = new S3Client({
        region: region || 'eu-west-1',
        requestChecksumCalculation: 'WHEN_REQUIRED',
      });
    }

    this._logger.log('S3 service initialized successfully');
  }

  /**
   * Generates a presigned URL for uploading a file to S3.
   * @param dto the request DTO containing entity type, ID, and file info.
   * @param scope the request scope, used to enforce reseller ownership.
   * @returns the presigned URL response with URL and S3 key.
   */
  async getPresignedUploadUrl(dto: PresignedUrlRequestDto, scope: RequestScope): Promise<PresignedUrlResponseDto> {
    try {
      // Validate request based on entity type
      this._validateRequest(dto);

      // Enforce reseller scoping on the targeted entity before signing.
      await this._assertEntityAccess(dto.entityType, dto.entityId, PresignedUrlAction.Upload, scope, dto.resellerId);

      // Generate S3 key based on entity type
      const s3Key = this._generateS3Key(dto);

      // Create the PutObject command
      const command = new PutObjectCommand({
        Bucket: this._bucketName,
        Key: s3Key,
        ContentType: dto.contentType,
      });

      // Generate presigned URL
      const url = await getSignedUrl(this._s3Client, command, {
        expiresIn: PRESIGNED_URL_EXPIRES_IN,
        signableHeaders: new Set(['content-type']),
      });

      this._logger.log(`Generated presigned URL for ${dto.entityType}: ${s3Key}`);

      return {
        url,
        s3Key,
        expiresIn: PRESIGNED_URL_EXPIRES_IN,
      };

    } catch (error) {
      this._logger.error('Error generating presigned URL', error);
      // Domain exceptions (validation/authorization/not-found) already carry the
      // correct HTTP status: re-throw them instead of masking as a 500.
      if (error instanceof AppException) {
        throw error;
      }
      throw new AppException(
        'Something went wrong trying to generate presigned URL',
        500,
        error
      );
    }
  }

  /**
   * Generates a presigned URL for downloading a file from S3.
   * @param s3Key the S3 key of the file to download.
   * @param scope the request scope, used to enforce reseller ownership.
   * @returns the presigned URL response with URL and S3 key.
   */
  async getPresignedDownloadUrl(s3Key: string, scope: RequestScope): Promise<PresignedUrlResponseDto> {
    try {
      // Never trust the raw key: derive the entity from it and enforce that the
      // requester is allowed to see it before signing a download URL.
      const { entityType, entityId, resellerId } = this.parseS3Key(s3Key);
      await this._assertEntityAccess(entityType, entityId, PresignedUrlAction.Download, scope, resellerId);

      return await this.signDownloadUrl(s3Key);

    } catch (error) {
      this._logger.error('Error generating presigned download URL', error);
      // Preserve domain exceptions (e.g. authorization / not-found) with their status.
      if (error instanceof AppException) {
        throw error;
      }
      throw new AppException(
        'Something went wrong trying to generate presigned download URL',
        500,
        error
      );
    }
  }

  /**
   * Signs a download URL without any scope check: callers authorize the key first.
   * @param s3Key the S3 key of the file to download.
   * @returns the presigned URL response with URL and S3 key.
   */
  async signDownloadUrl(s3Key: string): Promise<PresignedUrlResponseDto> {
    const command = new GetObjectCommand({
      Bucket: this._bucketName,
      Key: s3Key,
    });

    const url = await getSignedUrl(this._s3Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRES_IN,
    });

    this._logger.log(`Generated presigned download URL for: ${s3Key}`);

    return {
      url,
      s3Key,
      expiresIn: PRESIGNED_URL_EXPIRES_IN,
    };
  }

  /**
   * Reads the metadata of a stored object.
   * @param s3Key the S3 key of the object.
   * @returns the content type and the size of the object.
   * @throws EntityNotFoundException if no object exists under the key.
   * @throws AppException if S3 cannot be reached.
   */
  async headObject(s3Key: string): Promise<S3ObjectInfo> {
    try {
      const head = await this._s3Client.send(new HeadObjectCommand({ Bucket: this._bucketName, Key: s3Key }));
      return {
        contentType: head.ContentType ?? "application/octet-stream",
        sizeBytes: head.ContentLength ?? 0,
      };
    } catch (error) {
      if (error instanceof NotFound) {
        throw new EntityNotFoundException("S3 object", s3Key);
      }
      this._logger.error(`Error reading metadata of S3 object: ${s3Key}`, error);
      throw new AppException("Something went wrong trying to read the S3 object metadata.", 500, error);
    }
  }

  /**
   * Reads a small stored object, such as a template source, into memory.
   * @param s3Key the S3 key of the object.
   * @returns the content of the object.
   * @throws AppException if the object cannot be read.
   */
  async getObjectBuffer(s3Key: string): Promise<Buffer> {
    try {
      const object = await this._s3Client.send(new GetObjectCommand({ Bucket: this._bucketName, Key: s3Key }));
      const bytes = await object.Body?.transformToByteArray();
      if (!bytes) {
        throw new EntityNotFoundException("S3 object", s3Key);
      }
      return Buffer.from(bytes);
    } catch (error) {
      if (error instanceof EntityNotFoundException) {
        throw error;
      }
      this._logger.error(`Error reading S3 object: ${s3Key}`, error);
      throw new AppException("Something went wrong trying to read the S3 object.", 500, error);
    }
  }

  /**
   * Copies an object inside the bucket, e.g. the source of a duplicated template.
   * @param sourceKey the S3 key to copy from.
   * @param targetKey the S3 key to copy to.
   * @throws AppException if the copy fails.
   */
  async copyObject(sourceKey: string, targetKey: string): Promise<void> {
    try {
      await this._s3Client.send(new CopyObjectCommand({
        Bucket: this._bucketName,
        CopySource: `${this._bucketName}/${encodeURIComponent(sourceKey)}`,
        Key: targetKey,
      }));
      this._logger.log(`S3 object copied: ${sourceKey} → ${targetKey}`);
    } catch (error) {
      this._logger.error(`Error copying S3 object: ${sourceKey}`, error);
      throw new AppException("Something went wrong trying to copy the S3 object.", 500, error);
    }
  }

  /**
   * Copies an object to the public bucket of the email images, such as a product logo shown to the companies.
   * @param sourceKey the S3 key to copy from.
   * @param targetKey the S3 key in the public bucket.
   * @returns the public URL of the copy.
   * @throws AppException if the public bucket is not configured or the copy fails.
   */
  async publishEmailAsset(sourceKey: string, targetKey: string): Promise<string> {
    const bucket = process.env.EMAIL_ASSETS_BUCKET;
    const baseUrl = process.env.EMAIL_ASSETS_BASE_URL;
    if (!bucket || !baseUrl) {
      throw new AppException("EMAIL_ASSETS_BUCKET and EMAIL_ASSETS_BASE_URL must be set to publish an email image.", 500);
    }
    try {
      await this._s3Client.send(new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${this._bucketName}/${encodeURIComponent(sourceKey)}`,
        Key: targetKey,
      }));
      this._logger.log(`S3 object published for the emails: ${sourceKey} → ${targetKey}`);
      return `${baseUrl}/${targetKey}`;
    } catch (error) {
      this._logger.error(`Error publishing S3 object for the emails: ${sourceKey}`, error);
      throw new AppException("Something went wrong trying to publish the image for the emails.", 500, error);
    }
  }

  /**
   * Writes an object generated by the backend, such as the document of a contract.
   * @param s3Key the S3 key of the object.
   * @param body the content of the object.
   * @param contentType the media type of the content.
   * @throws AppException if the write fails.
   */
  async putObject(s3Key: string, body: string | Buffer, contentType: string): Promise<void> {
    try {
      await this._s3Client.send(new PutObjectCommand({ Bucket: this._bucketName, Key: s3Key, Body: body, ContentType: contentType }));
      this._logger.log(`S3 object written: ${s3Key}`);
    } catch (error) {
      this._logger.error(`Error writing S3 object: ${s3Key}`, error);
      throw new AppException("Something went wrong trying to write the S3 object.", 500, error);
    }
  }

  /**
   * Deletes an object. Deleting a key that does not exist is not an error on S3.
   * @param s3Key the S3 key of the object.
   * @throws AppException if the deletion fails.
   */
  async deleteObject(s3Key: string): Promise<void> {
    try {
      await this._s3Client.send(new DeleteObjectCommand({ Bucket: this._bucketName, Key: s3Key }));
      this._logger.log(`S3 object deleted: ${s3Key}`);
    } catch (error) {
      this._logger.error(`Error deleting S3 object: ${s3Key}`, error);
      throw new AppException("Something went wrong trying to delete the S3 object.", 500, error);
    }
  }

  /**
   * Lazy loads the MaterialsService from its module.
   * @returns a Promise resolving to the MaterialsService instance.
   */
  private async _loadMaterialsService(): Promise<MaterialsService> {
    if (!this._materialsService) {
      const { MaterialsLazyModule } = await import(
        "../../../materials/lazy-materials/materials-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(() => MaterialsLazyModule);
      this._materialsService = moduleRef.get<MaterialsService>(MaterialsService);
    }
    return this._materialsService;
  }

  /**
   * Lazy loads the OrdersService from its module.
   * @returns a Promise resolving to the OrdersService instance.
   */
  private async _loadOrdersService(): Promise<OrdersService> {
    if (!this._ordersService) {
      const { OrdersLazyModule } = await import(
        "../../../orders/lazy-orders/orders-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(() => OrdersLazyModule);
      this._ordersService = moduleRef.get<OrdersService>(OrdersService);
    }
    return this._ordersService;
  }

  /**
   * Lazy loads the ResellerContractsService from its module.
   * @returns a Promise resolving to the ResellerContractsService instance.
   */
  private async _loadResellerContractsService(): Promise<ResellerContractsService> {
    if (!this._resellerContractsService) {
      const { ResellerContractsLazyModule } = await import(
        "../../../reseller-contracts/lazy-reseller-contracts/reseller-contracts-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(() => ResellerContractsLazyModule);
      const { ResellerContractsService } = await import(
        "../../../reseller-contracts/lazy-reseller-contracts/services/reseller-contracts.service"
      );
      this._resellerContractsService = moduleRef.get<ResellerContractsService>(ResellerContractsService);
    }
    return this._resellerContractsService;
  }

  /**
   * Lazy loads the ResellersService from its module.
   * @returns a Promise resolving to the ResellersService instance.
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
   * Enforces the requester's access to the targeted entity before a URL is signed.
   * @param entityType the type of the targeted entity.
   * @param entityId the entity identifier (contractId / productId / materialId / templateId / resellerId / orderId).
   * @param action whether the URL is for an upload or a download.
   * @param scope the request scope.
   * @param resellerId the reseller owning the entity, for the documents of a reseller contract.
   */
  private async _assertEntityAccess(
    entityType: S3EntityType,
    entityId: string | undefined,
    action: PresignedUrlAction,
    scope: RequestScope,
    resellerId?: string,
  ): Promise<void> {
    switch (entityType) {
      case S3EntityType.ResellerContractSigned: {
        if (!resellerId || !entityId) {
          throw new ValidationException('resellerId and contractId are required for reseller contract documents', []);
        }
        // Keus signs its contracts with the resellers; a reseller may read its own.
        if (action === PresignedUrlAction.Upload) {
          assertCollaborator(scope, `upload ${entityType}`);
        }
        const resellerContractsService = await this._loadResellerContractsService();
        // Throws AuthorizationException when the reseller is outside the subtree.
        await resellerContractsService.getContract(resellerId, entityId, scope);
        return;
      }

      case S3EntityType.ProductLogo: {
        // Shared product-catalog assets, not reseller-private: only Keus
        // collaborators may write them; any authenticated requester may read them.
        if (action === PresignedUrlAction.Upload) {
          assertCollaborator(scope, `upload ${entityType}`);
        }
        return;
      }

      case S3EntityType.MaterialFile: {
        if (!entityId) {
          throw new ValidationException('entityId (the materialId) is required for material files', []);
        }
        if (action === PresignedUrlAction.Upload) {
          this._assertAdmin(scope, `upload ${entityType}`);
          return;
        }
        // Keus sees the whole shelf; a reseller only what is published for it.
        if (!isUnrestricted(scope)) {
          const materialsService = await this._loadMaterialsService();
          await materialsService.assertMaterialVisible(entityId, scope);
        }
        return;
      }

      case S3EntityType.TemplateSource: {
        if (action === PresignedUrlAction.Upload) {
          this._assertAdmin(scope, `upload ${entityType}`);
          return;
        }
        if (!isUnrestricted(scope)) {
          // A reseller fills its offers in the browser (UR-RK-013): only the source of an offer template in use.
          if (!entityId) {
            throw new AuthorizationException(`Operation "download ${entityType}" needs the template.`);
          }
          const templatesService = await this._loadTemplatesService();
          await templatesService.getTemplate(TemplateType.Offer, entityId, scope);
        }
        return;
      }

      case S3EntityType.ResellerLogo: {
        if (!entityId) {
          throw new ValidationException('entityId (the resellerId) is required for reseller logos', []);
        }
        if (action === PresignedUrlAction.Upload) {
          this._assertAnyRole(scope, RESELLER_LOGO_WRITERS, `upload ${entityType}`);
        }
        const resellersService = await this._loadResellersService();
        // Throws AuthorizationException when the reseller is outside the subtree.
        const reseller = await resellersService.getReseller(entityId, scope);
        if (action === PresignedUrlAction.Upload) {
          resellersService.assertAssignedSales(reseller, scope);
        }
        return;
      }

      case S3EntityType.OrderSignedOffer:
      case S3EntityType.OrderFinancingContract:
      case S3EntityType.OrderCustomizationAttachment:
      case S3EntityType.OrderCustomizationVoiceNote: {
        if (!entityId) {
          throw new ValidationException('entityId (the orderId) is required for order documents', []);
        }
        const upload = action === PresignedUrlAction.Upload ? ORDER_DOCUMENT_UPLOADS[entityType] : undefined;
        if (upload) {
          this._assertAnyRole(scope, upload.roles, `upload ${entityType}`);
        }
        const ordersService = await this._loadOrdersService();
        // Throws AuthorizationException when the order is outside the requester's perimeter.
        const order = await ordersService.getOrder(entityId, scope);
        if (upload && !canSellOn(scope, order.resellerPath)) {
          throw new AuthorizationException(`Order ${order.code} is sold by a reseller: a Keus salesperson only reads its documents.`);
        }
        if (upload && !upload.statuses.includes(order.status)) {
          throw new BusinessException(
            `This document cannot be uploaded while the order is ${order.status}.`,
            "ORDER_DOCUMENT_LOCKED",
            { orderId: entityId, status: order.status },
          );
        }
        return;
      }

      default: {
        const exhaustiveCheck: never = entityType;
        throw new ValidationException(`Unsupported entity type: ${exhaustiveCheck as string}`, []);
      }
    }
  }

  /**
   * Asserts that the requester is a Keus admin, the only profile that manages templates and materials.
   * @param scope the request scope.
   * @param operation the operation name for the error message.
   * @throws AuthorizationException for any other profile.
   */
  private _assertAdmin(scope: RequestScope, operation: string): void {
    if (scope.system === true || scope.roles.includes(UserRole.KeusAdmin)) {
      return;
    }
    throw new AuthorizationException(`Operation "${operation}" is reserved to the Keus admin.`);
  }

  /**
   * Asserts that the requester holds one of the given profiles.
   * @param scope the request scope.
   * @param roles the profiles allowed.
   * @param operation the operation name for the error message.
   * @throws AuthorizationException for any other profile.
   */
  private _assertAnyRole(scope: RequestScope, roles: readonly UserRole[], operation: string): void {
    if (scope.system === true || roles.some(role => scope.roles.includes(role))) {
      return;
    }
    throw new AuthorizationException(`Operation "${operation}" is not allowed to the requester's profile.`);
  }

  /**
   * Extracts entity information from an S3 key.
   * @param s3Key the S3 key.
   * @returns an object with entityType, entityId and, for a reseller contract, resellerId.
   */
  parseS3Key(s3Key: string): {
    entityType: S3EntityType;
    entityId: string;
    resellerId?: string;
  } {
    const parts = s3Key.split('/');

    if (parts[0] === 'resellers' && parts[2] === 'contracts' && parts.length >= 5) {
      // resellers/{resellerId}/contracts/{contractId}/signed-contract.pdf
      return {
        entityType: S3EntityType.ResellerContractSigned,
        resellerId: parts[1],
        entityId: parts[3],
      };
    }

    if (parts[0] === 'products' && parts.length === 3 && parts[2].startsWith('logo.')) {
      // products/{productId}/logo.{ext}: the exact shape, so that no other object under products/ is taken for a logo.
      return {
        entityType: S3EntityType.ProductLogo,
        entityId: parts[1],
      };
    } else if (parts[0] === 'materials' && parts.length >= 3) {
      // materials/{materialId}/{filename}
      return {
        entityType: S3EntityType.MaterialFile,
        entityId: parts[1],
      };
    } else if (parts[0] === 'resellers' && parts.length >= 3) {
      // resellers/{resellerId}/logo.{ext}
      return {
        entityType: S3EntityType.ResellerLogo,
        entityId: parts[1],
      };
    } else if (parts[0] === 'orders' && parts.length >= 3) {
      // orders/{orderId}/signed-offer.pdf, orders/{orderId}/financing-contract.pdf,
      // orders/{orderId}/customizations/{fileId}.pdf, orders/{orderId}/customizations/{fileId}.{audio ext}
      const filename = parts[parts.length - 1];
      const entityType = parts[2] === 'customizations'
        ? (filename.toLowerCase().endsWith('.pdf') ? S3EntityType.OrderCustomizationAttachment : S3EntityType.OrderCustomizationVoiceNote)
        : (filename.startsWith('financing-contract') ? S3EntityType.OrderFinancingContract : S3EntityType.OrderSignedOffer);
      return {
        entityType,
        entityId: parts[1],
      };
    } else if (parts[0] === 'templates' && parts.length >= 3) {
      // templates/{templateId}/source.docx
      return {
        entityType: S3EntityType.TemplateSource,
        entityId: parts[1],
      };
    }

    throw new ValidationException('Invalid S3 key format', []);
  }

  /**
   * Validates the request DTO based on entity type.
   * @param dto the request DTO.
   */
  private _validateRequest(dto: PresignedUrlRequestDto): void {
    // Validate content type based on entity type
    if (dto.entityType === S3EntityType.ResellerContractSigned && dto.contentType !== 'application/pdf') {
      throw new ValidationException('Reseller contract documents must be PDF files', []);
    }

    if (dto.entityType === S3EntityType.ProductLogo && !dto.contentType.startsWith('image/')) {
      throw new ValidationException('Product logos must be image files', []);
    }

    if (
      dto.entityType === S3EntityType.MaterialFile &&
      !MATERIAL_CONTENT_TYPES.includes(dto.contentType) &&
      !dto.contentType.startsWith('image/')
    ) {
      throw new ValidationException('Material files must be PDF, Word, PowerPoint, Excel, ZIP or image files', []);
    }

    if (dto.entityType === S3EntityType.TemplateSource && dto.contentType !== DOCX_CONTENT_TYPE) {
      throw new ValidationException('Template sources must be DOCX files', []);
    }

    if (dto.entityType === S3EntityType.ResellerLogo && !RESELLER_LOGO_CONTENT_TYPES.includes(dto.contentType)) {
      throw new ValidationException('Reseller logos must be PNG or JPEG files', []);
    }

    if (
      (dto.entityType === S3EntityType.OrderSignedOffer
        || dto.entityType === S3EntityType.OrderFinancingContract
        || dto.entityType === S3EntityType.OrderCustomizationAttachment)
      && dto.contentType !== 'application/pdf'
    ) {
      throw new ValidationException('Order documents must be PDF files', []);
    }

    if (dto.entityType === S3EntityType.OrderCustomizationVoiceNote && !dto.contentType.startsWith('audio/')) {
      throw new ValidationException('Voice notes must be audio files', []);
    }
  }

  /**
   * Generates the S3 key based on entity type and request data.
   * @param dto the request DTO.
   * @returns the S3 key string.
   */
  private _generateS3Key(dto: PresignedUrlRequestDto): string {
    const extension = this._getExtensionFromContentType(dto.contentType, dto.filename);

    switch (dto.entityType) {
      case S3EntityType.ResellerContractSigned:
        // resellers/{resellerId}/contracts/{contractId}/signed-contract.pdf: outside contracts/, which triggers the S3 events.
        return `resellers/${dto.resellerId}/contracts/${dto.entityId}/signed-contract.pdf`;

      case S3EntityType.ProductLogo:
        // products/{productId}/logo.{ext}
        return `products/${dto.entityId}/logo.${extension}`;

      case S3EntityType.MaterialFile:
        // materials/{materialId}/{filename}: the original name is kept, it is what the reseller downloads.
        return `materials/${dto.entityId}/${this._sanitizeFilename(dto.filename)}`;

      case S3EntityType.TemplateSource:
        // templates/{templateId}/source.docx
        return `templates/${dto.entityId}/source.docx`;

      case S3EntityType.ResellerLogo:
        // resellers/{resellerId}/logo.{ext}: the id, not the code, which can change.
        return `resellers/${dto.entityId}/logo.${extension}`;

      case S3EntityType.OrderSignedOffer:
        // orders/{orderId}/signed-offer.pdf
        return `orders/${dto.entityId}/signed-offer.pdf`;

      case S3EntityType.OrderFinancingContract:
        // orders/{orderId}/financing-contract.pdf
        return `orders/${dto.entityId}/financing-contract.pdf`;

      case S3EntityType.OrderCustomizationAttachment:
        // orders/{orderId}/customizations/{fileId}.pdf: a customization lists its own files.
        return `orders/${dto.entityId}/customizations/${uuidv4()}.pdf`;

      case S3EntityType.OrderCustomizationVoiceNote:
        // orders/{orderId}/customizations/{fileId}.{ext}
        return `orders/${dto.entityId}/customizations/${uuidv4()}.${extension}`;

      default: {
        const exhaustiveCheck: never = dto.entityType;
        throw new ValidationException(`Unsupported entity type: ${exhaustiveCheck as string}`, []);
      }
    }
  }

  /**
   * Extracts the file extension from content type or filename.
   * @param contentType the MIME content type.
   * @param filename the original filename.
   * @returns the file extension.
   */
  private _getExtensionFromContentType(contentType: string, filename: string): string {
    // Try to get extension from filename first
    const filenameExt = filename.split('.').pop()?.toLowerCase();
    if (filenameExt) {
      return filenameExt;
    }

    // Fall back to content type mapping
    const contentTypeMap: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'text/html': 'html',
      [DOCX_CONTENT_TYPE]: 'docx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/zip': 'zip',
    };

    return contentTypeMap[contentType] || 'bin';
  }

  /**
   * Reduces a filename to characters that are safe in an S3 key and in a URL.
   * @param filename the original filename.
   * @returns the sanitized filename.
   */
  private _sanitizeFilename(filename: string): string {
    const sanitized = filename
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return sanitized || 'file';
  }
}
