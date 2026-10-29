import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { SortOrder } from "dynamoose/dist/General";
import { InjectModel, Model } from "nestjs-dynamoose";
import { v4 as uuidv4 } from "uuid";
import {
  AppException,
  AuthorizationException,
  BusinessException,
  DatabaseException,
  EntityNotFoundException,
  ValidationException,
} from "../../../../errors/exception-types";
import { isUnrestricted, RequestScope } from "@rocket-be/scoping";
import { paginate, paginateMerged, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { ResellerTier } from "../../../resellers/enums/reseller-tier.enum";
import { AvailableMaterialsPageQueryDto } from "../../dtos/available-materials-page-query.dto";
import { CreateMaterialDto } from "../../dtos/create-material.dto";
import { MaterialsPageQueryDto } from "../../dtos/materials-page-query.dto";
import { ResponseMaterialDto } from "../../dtos/response-material.dto";
import { ResponseMaterialsPageDto } from "../../dtos/response-materials-page.dto";
import { UpdateMaterialDto } from "../../dtos/update-material.dto";
import { MaterialStatus } from "../../enums/material-status.enum";
import { MaterialType } from "../../enums/material-type.enum";
import { Material, MaterialKey } from "../../schemas/material.schema";
import { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import { S3ObjectInfo, S3Service } from "../../../s3/lazy-s3/services/s3.service";

/** What a requester may see of the shelf: collaborators have no product whitelist. */
type MaterialViewer = {
  /** Whether the requester is a Keus collaborator. */
  isCollaborator: boolean;
  /** Tier the materials are filtered on, when there is one. */
  tier?: ResellerTier;
  /** Products the reseller is enabled to sell. Absent for collaborators. */
  enabledProductIds?: string[];
};

/** Service for the sales materials: DRAFT → PUBLISHED ⇄ WITHDRAWN, editable in any state. */
@Injectable()
export class MaterialsService {
  /** Logger instance for MaterialsService. */
  private readonly _logger = new Logger(MaterialsService.name);

  /** Lazy-loaded resellers service, used to resolve the requester's tier and products. */
  private _resellersService: ResellersService | null = null;

  /** Lazy-loaded S3 service, used to read and delete the material files. */
  private _s3Service: S3Service | null = null;

  /**
   * Constructor for MaterialsService.
   * @param _materialModel the Dynamoose model used to persist materials.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the resellers and S3 services on demand.
   */
  constructor(
    @InjectModel("Material")
    private readonly _materialModel: Model<Material, MaterialKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

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
   * Lazy loads the S3Service from its module.
   * @returns A Promise resolving to the S3Service instance.
   */
  private async _loadS3Service(): Promise<S3Service> {
    if (!this._s3Service) {
      const { S3LazyModule } = await import("../../../s3/lazy-s3/s3-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => S3LazyModule);
      this._s3Service = moduleRef.get<S3Service>(S3Service);
    }
    return this._s3Service;
  }

  /**
   * Creates a material in DRAFT, without its file.
   * @param materialDto the data to create the material with.
   * @returns the created material.
   * @throws BusinessException if a link is given to a material that is not a link.
   */
  async createMaterial(materialDto: CreateMaterialDto): Promise<ResponseMaterialDto> {
    this._validateContent(materialDto.type, undefined, materialDto.externalUrl);

    try {
      const id = uuidv4();
      const createdAt = new Date().toISOString();
      const material: Material = {
        id,
        title: materialDto.title,
        description: materialDto.description,
        type: materialDto.type,
        status: MaterialStatus.Draft,
        createdAtKey: `${createdAt}#${id}`,
        ...(materialDto.productIds && { productIds: materialDto.productIds }),
        ...(materialDto.resellerTiers && { resellerTiers: materialDto.resellerTiers }),
        ...(materialDto.externalUrl && { externalUrl: materialDto.externalUrl }),
      };

      this._logger.log(`Creating material with ID: ${id}`);
      const created = await this._materialModel.create(material);
      this._logger.log(`Material with ID: ${id} created successfully.`);
      return plainToInstance(ResponseMaterialDto, created, { excludeExtraneousValues: true });
    } catch (error) {
      this._logger.error("Error creating material", error);
      throw new DatabaseException("Error creating material.", error as Error);
    }
  }

  /**
   * Lists one page of the catalogue: one partition of `statusIndex` per status
   * asked (every status when none), merged newest first.
   * @param query the page and its filters.
   * @returns the page of materials, newest first.
   * @throws ValidationException if the cursor is not valid.
   */
  async listMaterials(query: MaterialsPageQueryDto): Promise<ResponseMaterialsPageDto> {
    const { limit, cursor, search, type, productId, tier } = query;
    const statuses = query.status?.length ? query.status : Object.values(MaterialStatus);
    const page = await paginateMerged<Material>(
      statuses.map(status => ({
        id: status,
        build: () => this._materialModel.query("status").eq(status).using("statusIndex").sort(SortOrder.descending),
      })),
      ["id", "status", "createdAtKey"],
      (a, b) => b.createdAtKey.localeCompare(a.createdAtKey),
      limit,
      cursor,
      material =>
        startsWithAny(search, material.title)
        && (!type?.length || type.includes(material.type))
        && (!productId || !material.productIds?.length || material.productIds.includes(productId))
        && (!tier?.length || !material.resellerTiers?.length || material.resellerTiers.some(assigned => tier.includes(assigned))),
    );
    return {
      items: page.items.map(material => plainToInstance(ResponseMaterialDto, material, { excludeExtraneousValues: true })),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Lists one page of the published materials the requester can see; a reseller's tier comes from its record, never from the request.
   * DynamoDB does not index list elements, so the assignment is part of the page predicate.
   * @param query the page and its filters, with the product, tier and reseller to preview.
   * @param scope the request scope.
   * @returns the page of published materials assigned to that product and tier, newest first.
   * @throws EntityNotFoundException if the reseller to preview does not exist.
   * @throws ValidationException if the cursor is not valid.
   */
  async listAvailableMaterials(query: AvailableMaterialsPageQueryDto, scope: RequestScope): Promise<ResponseMaterialsPageDto> {
    const { limit, cursor, productId, tier, resellerId, search, type } = query;
    const viewer = await this._resolveViewer(scope, tier, resellerId);
    const page = await paginate<Material>(
      () => this._materialModel.query("status").eq(MaterialStatus.Published).using("statusIndex").sort(SortOrder.descending),
      ["id", "status", "createdAtKey"],
      limit,
      cursor,
      material =>
        this._isAssignedTo(material, productId, viewer)
        && startsWithAny(search, material.title)
        && (!type?.length || type.includes(material.type)),
    );
    return {
      items: page.items.map(material => plainToInstance(ResponseMaterialDto, material, { excludeExtraneousValues: true })),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Asserts that a reseller may see a material: published and assigned to its tier and products.
   * @param id the identifier of the material.
   * @param scope the request scope.
   * @throws AuthorizationException if the material is not available to the reseller.
   */
  async assertMaterialVisible(id: string, scope: RequestScope): Promise<void> {
    if (isUnrestricted(scope)) {
      return;
    }
    const material = await this._materialModel.get({ id });
    const viewer = await this._resolveViewer(scope);
    // Same answer for missing and hidden materials, so drafts cannot be probed.
    if (!material || material.status !== MaterialStatus.Published || !this._isAssignedTo(material, undefined, viewer)) {
      throw new AuthorizationException(
        `Material ${id} is not available to reseller ${scope.resellerCode}.`,
      );
    }
  }

  /**
   * Retrieves a material by its identifier.
   * @param id the identifier of the material.
   * @returns the material.
   * @throws EntityNotFoundException if the material does not exist.
   */
  async getMaterial(id: string): Promise<ResponseMaterialDto> {
    const material = await this._getMaterialOrThrow(id);
    return plainToInstance(ResponseMaterialDto, material, { excludeExtraneousValues: true });
  }

  /**
   * Updates a material; attaching a file reads its metadata from S3 and deletes the replaced one.
   * @param id the identifier of the material.
   * @param materialDto the data to apply.
   * @returns the updated material.
   * @throws EntityNotFoundException if the material or the uploaded file does not exist.
   * @throws ValidationException if the file key does not belong to the material.
   * @throws BusinessException if a file or a link does not match the material type.
   */
  async updateMaterial(id: string, materialDto: UpdateMaterialDto): Promise<ResponseMaterialDto> {
    const material = await this._getMaterialOrThrow(id);
    this._validateContent(material.type, materialDto.fileS3Key, materialDto.externalUrl);

    const s3Service = await this._loadS3Service();
    let fileInfo: S3ObjectInfo | undefined;
    if (materialDto.fileS3Key) {
      // The key must be one the presigned upload generated for this material.
      if (!materialDto.fileS3Key.startsWith(`materials/${id}/`)) {
        throw new ValidationException(`File ${materialDto.fileS3Key} does not belong to material ${id}.`, []);
      }
      fileInfo = await s3Service.headObject(materialDto.fileS3Key);
    }

    try {
      this._logger.log(`Updating material with ID: ${id}`);
      const updated = await this._materialModel.update({ id }, {
        ...(materialDto.title !== undefined && { title: materialDto.title }),
        ...(materialDto.description !== undefined && { description: materialDto.description }),
        ...(materialDto.productIds !== undefined && { productIds: materialDto.productIds }),
        ...(materialDto.resellerTiers !== undefined && { resellerTiers: materialDto.resellerTiers }),
        ...(materialDto.externalUrl !== undefined && { externalUrl: materialDto.externalUrl }),
        ...(fileInfo && { fileS3Key: materialDto.fileS3Key, ...fileInfo }),
      });
      this._logger.log(`Material with ID: ${id} updated successfully.`);

      if (fileInfo && material.fileS3Key && material.fileS3Key !== materialDto.fileS3Key) {
        await this._deleteFile(material.fileS3Key);
      }
      return plainToInstance(ResponseMaterialDto, updated, { excludeExtraneousValues: true });
    } catch (error) {
      this._logger.error(`Error updating material with ID: ${id}`, error);
      throw new DatabaseException(`Error updating material ${id}.`, error as Error);
    }
  }

  /**
   * Publishes a material, making it visible to the resellers it is assigned to.
   * @param id the identifier of the material.
   * @returns the published material.
   * @throws BusinessException if the material is already published or has no content.
   */
  async publishMaterial(id: string): Promise<ResponseMaterialDto> {
    const material = await this._getMaterialOrThrow(id);
    this._assertTransition(material, [MaterialStatus.Draft, MaterialStatus.Withdrawn], MaterialStatus.Published);

    if (material.type === MaterialType.ExternalLink && !material.externalUrl) {
      throw new BusinessException(`Material ${id} is a link but has no address.`, "MATERIAL_MISSING_LINK");
    }
    if (material.type !== MaterialType.ExternalLink && !material.fileS3Key) {
      throw new BusinessException(`Material ${id} has no file attached.`, "MATERIAL_MISSING_FILE");
    }

    try {
      const updated = await this._materialModel.update(
        { id },
        { status: MaterialStatus.Published, publishedAt: new Date().toISOString() },
      );
      this._logger.log(`Material ${id} published`);
      return plainToInstance(ResponseMaterialDto, updated, { excludeExtraneousValues: true });
    } catch (error) {
      this._logger.error(`Error publishing material with ID: ${id}`, error);
      throw new DatabaseException(`Error publishing material ${id}.`, error as Error);
    }
  }

  /**
   * Withdraws a published material from the resellers' view, keeping it on the Keus side.
   * @param id the identifier of the material.
   * @returns the withdrawn material.
   * @throws BusinessException if the material is not published.
   */
  async withdrawMaterial(id: string): Promise<ResponseMaterialDto> {
    const material = await this._getMaterialOrThrow(id);
    this._assertTransition(material, [MaterialStatus.Published], MaterialStatus.Withdrawn);

    try {
      const updated = await this._materialModel.update({ id }, { status: MaterialStatus.Withdrawn });
      this._logger.log(`Material ${id} withdrawn`);
      return plainToInstance(ResponseMaterialDto, updated, { excludeExtraneousValues: true });
    } catch (error) {
      this._logger.error(`Error withdrawing material with ID: ${id}`, error);
      throw new DatabaseException(`Error withdrawing material ${id}.`, error as Error);
    }
  }

  /**
   * Deletes a material that is not published, together with its file.
   * @param id the identifier of the material.
   * @throws BusinessException if the material is published.
   */
  async deleteMaterial(id: string): Promise<void> {
    const material = await this._getMaterialOrThrow(id);
    if (material.status === MaterialStatus.Published) {
      throw new BusinessException(
        `Material ${id} is published: withdraw it before deleting it.`,
        "MATERIAL_NOT_DELETABLE",
      );
    }

    try {
      await this._materialModel.delete({ id });
      this._logger.log(`Material ${id} deleted`);
      if (material.fileS3Key) {
        await this._deleteFile(material.fileS3Key);
      }
    } catch (error) {
      this._logger.error(`Error deleting material with ID: ${id}`, error);
      throw new DatabaseException(`Error deleting material ${id}.`, error as Error);
    }
  }

  /**
   * Retrieves a raw material or throws when it does not exist.
   * @param id the identifier of the material.
   * @returns the material entity.
   * @throws EntityNotFoundException if the material does not exist.
   */
  private async _getMaterialOrThrow(id: string): Promise<Material> {
    const material = await this._materialModel.get({ id });
    if (!material) {
      throw new EntityNotFoundException("Material", id);
    }
    return material;
  }

  /**
   * Validates that a file or a link matches the material type.
   * @param type the type of the material.
   * @param fileS3Key the file being attached, if any.
   * @param externalUrl the link being set, if any.
   * @throws BusinessException if a link material gets a file or a file material gets a link.
   */
  private _validateContent(type: MaterialType, fileS3Key?: string, externalUrl?: string): void {
    if (type === MaterialType.ExternalLink && fileS3Key) {
      throw new BusinessException("A link material carries no file.", "MATERIAL_CONTENT_MISMATCH");
    }
    if (type !== MaterialType.ExternalLink && externalUrl) {
      throw new BusinessException(`A ${type} material carries a file, not a link.`, "MATERIAL_CONTENT_MISMATCH");
    }
  }

  /**
   * Asserts that a material can move to the target state.
   * @param material the material to move.
   * @param allowedFrom the states the transition may start from.
   * @param target the target state.
   * @throws BusinessException if the transition is not allowed.
   */
  private _assertTransition(material: Material, allowedFrom: MaterialStatus[], target: MaterialStatus): void {
    if (!allowedFrom.includes(material.status)) {
      throw new BusinessException(
        `Material ${material.id} is ${material.status} and cannot move to ${target}.`,
        "MATERIAL_INVALID_TRANSITION",
        { status: material.status, target },
      );
    }
  }

  /**
   * Deletes a material file, logging instead of failing: an orphan file is harmless.
   * @param s3Key the S3 key of the file.
   */
  private async _deleteFile(s3Key: string): Promise<void> {
    try {
      const s3Service = await this._loadS3Service();
      await s3Service.deleteObject(s3Key);
    } catch (error) {
      if (!(error instanceof AppException)) {
        throw error;
      }
      this._logger.warn(`Material file ${s3Key} could not be deleted and is left orphan.`);
    }
  }

  /**
   * Resolves what the requester may see of the shelf.
   * @param scope the request scope.
   * @param requestedTier the tier to preview. Honoured for collaborators only.
   * @param resellerId the reseller whose shelf a collaborator previews, which wins over the tier.
   * @returns the viewer's tier and, for a reseller, its enabled products.
   */
  private async _resolveViewer(scope: RequestScope, requestedTier?: ResellerTier, resellerId?: string): Promise<MaterialViewer> {
    if (isUnrestricted(scope) && resellerId) {
      // A collaborator previewing a workspace sees exactly what that reseller sees.
      const resellersService = await this._loadResellersService();
      const reseller = await resellersService.getReseller(resellerId, scope);
      return { isCollaborator: false, tier: reseller.tier, enabledProductIds: reseller.productIds ?? [] };
    }
    if (isUnrestricted(scope)) {
      return { isCollaborator: true, tier: requestedTier };
    }
    if (!scope.resellerCode) {
      return { isCollaborator: false, enabledProductIds: [] };
    }
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getResellerByCode(scope.resellerCode);
    return {
      isCollaborator: false,
      tier: reseller?.tier,
      enabledProductIds: reseller ? await resellersService.getEnabledProductIds(reseller) : [],
    };
  }

  /**
   * Tells whether a material is assigned to a product and to the viewer (empty list = all).
   * @param material the material to check.
   * @param productId the product to filter on, or undefined for any product.
   * @param viewer what the requester may see.
   * @returns true when the material is on the viewer's shelf.
   */
  private _isAssignedTo(material: Material, productId: string | undefined, viewer: MaterialViewer): boolean {
    const products = material.productIds ?? [];
    const productOk = !productId || !products.length || products.includes(productId);
    // A reseller only gets the product materials of what it can sell.
    const enabledOk = !viewer.enabledProductIds
      || !products.length
      || products.some(id => viewer.enabledProductIds?.includes(id));
    // A reseller with no tier is in none of the listed tiers; a collaborator sees them all.
    const tierOk = !material.resellerTiers?.length
      || (viewer.tier ? material.resellerTiers.includes(viewer.tier) : viewer.isCollaborator);
    return productOk && enabledOk && tierOk;
  }
}
