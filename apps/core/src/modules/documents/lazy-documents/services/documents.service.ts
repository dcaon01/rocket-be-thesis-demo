import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { InjectModel, Model } from "nestjs-dynamoose";
import { v4 as uuidv4 } from "uuid";
import { isUnrestricted, RequestScope } from "@rocket-be/scoping";
import { AuthorizationException, DatabaseException, EntityNotFoundException } from "../../../../errors/exception-types";
import { assertPathVisible } from "../../../../commons/scoping/scoped-access.helper";
import { toDynamooseUpdate } from "../../../../commons/persistence/removable-update.helper";
import type { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import { CreateDocumentDto } from "../../dtos/create-document.dto";
import { ResponseDocumentDto } from "../../dtos/response-document.dto";
import { DocumentOwnerType } from "../../enums/document-owner-type.enum";
import { DocumentKey, StoredDocument } from "../../schemas/document.schema";

/**
 * Service responsible for the documents kept alongside a company, a reseller or
 * an order: offers, signed contracts, SEPA mandates.
 *
 * Keeping them in one place is the point: the analysis asks for the contract,
 * the offers and the signed copies to live in the same section of the company
 * record, instead of being hunted for in three different screens.
 */
@Injectable()
export class DocumentsService {
  /** Logger instance for DocumentsService. */
  private readonly _logger = new Logger(DocumentsService.name);

  /** Lazy-loaded resellers service. */
  private _resellersService: ResellersService | null = null;

  /**
   * Constructor for DocumentsService.
   * @param _documentModel the Dynamoose model used to persist documents.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the resellers service on demand.
   */
  constructor(
    @InjectModel("Document")
    private readonly _documentModel: Model<StoredDocument, DocumentKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

  /**
   * Lazy loads the ResellersService from its module.
   * @returns a Promise resolving to the ResellersService instance.
   */
  private async _loadResellersService(): Promise<ResellersService> {
    if (!this._resellersService) {
      const { ResellersLazyModule } = await import("../../../resellers/lazy-resellers/resellers-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ResellersLazyModule);
      const { ResellersService } = await import("../../../resellers/lazy-resellers/services/resellers.service");
      this._resellersService = moduleRef.get<ResellersService>(ResellersService);
    }
    return this._resellersService;
  }

  /**
   * Registers a document against its owner.
   * The record is created before the file arrives, so a upload that never
   * completes stays visible as missing instead of disappearing.
   * @param documentDto the data to register the document with.
   * @param scope the request scope.
   * @returns the registered document.
   */
  async createDocument(documentDto: CreateDocumentDto, scope: RequestScope): Promise<ResponseDocumentDto> {
    // Derived from the token, never taken from the body: taking it on trust let
    // a reseller file a document into another reseller's perimeter, or file one
    // it could not read back.
    const resellerPath = scope.resellerCode
      ? `${scope.resellerCode}#`
      : (isUnrestricted(scope) ? documentDto.resellerPath : undefined);

    // The owner has to be inside the caller's own perimeter, otherwise a
    // document attaches to any company, reseller or order by id alone.
    await this._assertOwnerVisible(documentDto.ownerType, documentDto.ownerId, scope);

    try {
      const document: StoredDocument = {
        ownerId: documentDto.ownerId,
        id: uuidv4(),
        ownerType: documentDto.ownerType,
        type: documentDto.type,
        name: documentDto.name,
        fileS3Key: documentDto.fileS3Key,
        uploaded: false,
        ...(documentDto.contentType && { contentType: documentDto.contentType }),
        ...(documentDto.refId && { refId: documentDto.refId }),
        ...(resellerPath && { resellerPath }),
        ...(scope.sub && { uploadedBySub: scope.sub }),
      };

      this._logger.log(`Registering ${document.type} document for ${document.ownerType} ${document.ownerId}`);
      const created = await this._documentModel.create(document);
      return plainToInstance(ResponseDocumentDto, created, { excludeExtraneousValues: true });
    } catch (error) {
      this._logger.error("Error registering document", error);
      throw new DatabaseException("Error registering document.", error as Error);
    }
  }

  /**
   * Retrieves the documents of an owner.
   * @param ownerType the kind of owner.
   * @param ownerId the identifier of the owner.
   * @param scope the request scope.
   * @returns the documents of that owner.
   * @throws AuthorizationException when a Keus salesperson asks for a reseller that is not its own.
   */
  async getDocuments(
    ownerType: DocumentOwnerType,
    ownerId: string,
    scope: RequestScope,
  ): Promise<ResponseDocumentDto[]> {
    if (ownerType === DocumentOwnerType.Reseller) {
      await this._assertCollaboratorOnReseller(ownerId, scope, false);
    }
    const documents = await this._getOwnerDocuments(ownerType, ownerId);

    const visible = isUnrestricted(scope)
      ? documents
      : documents.filter(document => document.resellerPath?.startsWith(`${scope.resellerCode}#`));

    return visible.map(document =>
      plainToInstance(ResponseDocumentDto, document, { excludeExtraneousValues: true })
    );
  }

  /**
   * Marks a document as uploaded, on the confirmation coming back from storage.
   * @param ownerType the kind of owner.
   * @param ownerId the identifier of the owner.
   * @param id the identifier of the document.
   * @param scope the request scope.
   * @returns the updated document.
   */
  async confirmUpload(
    ownerType: DocumentOwnerType,
    ownerId: string,
    id: string,
    scope: RequestScope,
  ): Promise<ResponseDocumentDto> {
    const document = await this._getOwnerDocument(ownerType, ownerId, id);

    // Without this, anyone holding a valid token could flip the flag on someone
    // else's document by guessing the three identifiers.
    assertPathVisible(
      scope,
      scope.resellerCode ? `${scope.resellerCode}#` : undefined,
      document.resellerPath,
      "Document",
    );
    if (ownerType === DocumentOwnerType.Reseller) {
      await this._assertCollaboratorOnReseller(ownerId, scope, true);
    }
    const updated = await this._documentModel.update({ ownerId, id }, { uploaded: true });
    this._logger.log(`Document ${id} confirmed as uploaded`);
    return plainToInstance(ResponseDocumentDto, updated, { excludeExtraneousValues: true });
  }

  /**
   * Deletes a document.
   * @param ownerType the kind of owner.
   * @param ownerId the identifier of the owner.
   * @param id the identifier of the document.
   * @param scope the request scope.
   */
  async deleteDocument(
    ownerType: DocumentOwnerType,
    ownerId: string,
    id: string,
    scope: RequestScope,
  ): Promise<void> {
    const document = await this._getOwnerDocument(ownerType, ownerId, id);

    assertPathVisible(
      scope,
      scope.resellerCode ? `${scope.resellerCode}#` : undefined,
      document.resellerPath,
      "Document",
    );
    await this._documentModel.delete({ ownerId, id });
    this._logger.log(`Document ${id} deleted`);
  }

  /**
   * Asserts that the owner a document is being filed under is inside the
   * requester's own perimeter.
   *
   * A reseller may only file against itself and against the companies and
   * orders of its own subtree; a collaborator files anywhere.
   * @param ownerType the kind of owner.
   * @param ownerId the identifier of the owner.
   * @param scope the request scope.
   * @throws AuthorizationException when the owner is outside the perimeter.
   */
  private async _assertOwnerVisible(
    ownerType: DocumentOwnerType,
    ownerId: string,
    scope: RequestScope,
  ): Promise<void> {
    if (isUnrestricted(scope)) {
      if (ownerType === DocumentOwnerType.Reseller) {
        await this._assertCollaboratorOnReseller(ownerId, scope, true);
      }
      return;
    }
    if (ownerType === DocumentOwnerType.Reseller && ownerId !== scope.resellerCode) {
      throw new AuthorizationException(
        `Reseller ${scope.resellerCode} cannot file documents against reseller ${ownerId}.`,
      );
    }
    if (ownerType === DocumentOwnerType.Company || ownerType === DocumentOwnerType.Order) {
      // The sibling documents already carry the owner's perimeter: if none
      // exists yet, the first one is accepted and inherits the caller's path,
      // which is the same perimeter the caller could read back.
      const siblings = await this._getOwnerDocuments(ownerType, ownerId);
      const foreign = siblings.find(
        sibling => sibling.resellerPath && !sibling.resellerPath.startsWith(`${scope.resellerCode}#`),
      );
      if (foreign) {
        throw new AuthorizationException(
          `${ownerType} ${ownerId} is outside the scope of reseller ${scope.resellerCode}.`,
        );
      }
    }
  }

  /**
   * Asserts that a Keus collaborator may work on the documents of a reseller: a
   * Keus salesperson reads and files them only for its own resellers. Reseller
   * users and internal paths are checked elsewhere, and pass through.
   * @param resellerCode the code of the reseller owning the documents.
   * @param scope the request scope.
   * @param write whether a document is being filed, not only read.
   * @throws AuthorizationException when the reseller is not the salesperson's own.
   */
  private async _assertCollaboratorOnReseller(resellerCode: string, scope: RequestScope, write: boolean): Promise<void> {
    if (!isUnrestricted(scope) || scope.system === true) {
      return;
    }
    const resellersService = await this._loadResellersService();
    const reseller = await resellersService.getResellerByCode(resellerCode, scope);
    if (write && reseller) {
      resellersService.assertAssignedSales(reseller, scope);
    }
  }

  /**
   * Moves the documents a reseller filed on an owner to another reseller, or to Keus, when the owner is transferred
   * (UR-RK-105), so that only the new seller sees them; the documents filed by Keus carry no path and stay as they are.
   * @param ownerType the kind of owner.
   * @param ownerId the identifier of the owner.
   * @param resellerPath the path of the reseller the owner joins; absent when it joins Keus.
   */
  async transferOwnerDocuments(ownerType: DocumentOwnerType, ownerId: string, resellerPath?: string): Promise<void> {
    const documents = await this._getOwnerDocuments(ownerType, ownerId);
    const moving = documents.filter(document => document.resellerPath && document.resellerPath !== resellerPath);

    const update = toDynamooseUpdate<StoredDocument>(resellerPath ? { resellerPath } : {}, resellerPath ? [] : ["resellerPath"]);
    for (const document of moving) {
      await this._documentModel.update({ ownerId, id: document.id }, update);
    }

    this._logger.log(`${moving.length} document(s) of ${ownerType} ${ownerId} moved to ${resellerPath ? `reseller path ${resellerPath}` : "Keus"}.`);
  }

  /**
   * Reads the documents of an owner. The partition is the owner id alone, so the kind asked is checked on the records:
   * the access rules depend on it, and a request naming a reseller code as a company must not reach its documents.
   * @param ownerType the kind of owner.
   * @param ownerId the identifier of the owner.
   * @returns the documents of that owner, of that kind.
   */
  private async _getOwnerDocuments(ownerType: DocumentOwnerType, ownerId: string): Promise<StoredDocument[]> {
    const documents = await this._documentModel.query("ownerId").eq(ownerId).all().exec();
    return documents.filter(document => document.ownerType === ownerType);
  }

  /**
   * Reads a document of an owner, of the kind asked.
   * @param ownerType the kind of owner.
   * @param ownerId the identifier of the owner.
   * @param id the identifier of the document.
   * @returns the document.
   * @throws EntityNotFoundException if the owner has no such document of that kind.
   */
  private async _getOwnerDocument(ownerType: DocumentOwnerType, ownerId: string, id: string): Promise<StoredDocument> {
    const document = await this._documentModel.get({ ownerId, id });
    if (!document || document.ownerType !== ownerType) {
      throw new EntityNotFoundException("Document", id);
    }

    return document;
  }
}
