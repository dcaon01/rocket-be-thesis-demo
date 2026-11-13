import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { CreateDocumentDto } from "../dtos/create-document.dto";
import { ResponseDocumentDto } from "../dtos/response-document.dto";
import { DocumentOwnerType } from "../enums/document-owner-type.enum";
import { DocumentsService } from "../lazy-documents/services/documents.service";

/**
 * Controller for managing the documents kept alongside a company, a reseller or
 * an order.
 * Uses lazy loading to load DocumentsService only when needed.
 */
@ApiTags("Documents")
@UseGuards(ScopeGuard, RolesGuard)
@Controller("documents")
export class DocumentsController {
  /** Lazy-loaded documents service */
  private _documentsService: DocumentsService | null = null;

  /**
   * Constructor for DocumentsController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /**
   * Lazy loads the DocumentsService from its module.
   * @returns A Promise resolving to the DocumentsService instance.
   */
  private async _loadDocumentsService(): Promise<DocumentsService> {
    if (!this._documentsService) {
      const { DocumentsLazyModule } = await import(
        "../lazy-documents/documents-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => DocumentsLazyModule,
      );
      this._documentsService = moduleRef.get<DocumentsService>(DocumentsService);
    }
    return this._documentsService;
  }

  /**
   * Registers a document against its owner.
   * @param scope the request scope.
   * @param documentDto the document data.
   * @returns the registered document.
   */
  @Post()
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({
    summary: "Register a document",
    description: "Registers a document against its owner, before the file reaches storage."
  })
  @ApiBody({ type: CreateDocumentDto, description: "The document data to register." })
  @ApiResponse({ status: HttpStatus.CREATED, description: "The document has been successfully registered.", type: ResponseDocumentDto })
  async createDocument(
    @CurrentScope() scope: RequestScope,
    @Body() documentDto: CreateDocumentDto,
  ): Promise<ResponseDocumentDto> {
    const documentsService = await this._loadDocumentsService();
    return documentsService.createDocument(documentDto, scope);
  }

  /**
   * Retrieves the documents of an owner.
   * @param scope the request scope.
   * @param ownerType the kind of owner.
   * @param ownerId the identifier of the owner.
   * @returns the documents of that owner.
   */
  @Get(":ownerType/:ownerId")
  @ApiOperation({ summary: "Get the documents of an owner", description: "Retrieves every document attached to the given owner." })
  @ApiParam({ name: "ownerType", enum: DocumentOwnerType })
  @ApiParam({ name: "ownerId", description: "Identifier of the owner." })
  @ApiResponse({ status: HttpStatus.OK, description: "Documents retrieved successfully.", type: [ResponseDocumentDto] })
  async getDocuments(
    @CurrentScope() scope: RequestScope,
    @Param("ownerType") ownerType: DocumentOwnerType,
    @Param("ownerId") ownerId: string,
  ): Promise<ResponseDocumentDto[]> {
    const documentsService = await this._loadDocumentsService();
    return documentsService.getDocuments(ownerType, ownerId, scope);
  }

  /**
   * Marks a document as uploaded.
   * @param ownerType the kind of owner.
   * @param ownerId the identifier of the owner.
   * @param id the identifier of the document.
   * @returns the updated document.
   */
  @Patch(":ownerType/:ownerId/:id/confirm")
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({
    summary: "Confirm the upload of a document",
    description: "Marks the document as uploaded, on the confirmation coming back from storage."
  })
  @ApiParam({ name: "ownerType", enum: DocumentOwnerType })
  @ApiParam({ name: "ownerId", description: "Identifier of the owner." })
  @ApiParam({ name: "id", description: "Identifier of the document." })
  @ApiResponse({ status: HttpStatus.OK, description: "Document confirmed successfully.", type: ResponseDocumentDto })
  async confirmUpload(
    @CurrentScope() scope: RequestScope,
    @Param("ownerType") ownerType: DocumentOwnerType,
    @Param("ownerId") ownerId: string,
    @Param("id") id: string,
  ): Promise<ResponseDocumentDto> {
    const documentsService = await this._loadDocumentsService();
    return documentsService.confirmUpload(ownerType, ownerId, id, scope);
  }

  /**
   * Deletes a document.
   * @param scope the request scope.
   * @param ownerType the kind of owner.
   * @param ownerId the identifier of the owner.
   * @param id the identifier of the document.
   */
  @Delete(":ownerType/:ownerId/:id")
  @Roles(UserRole.KeusAdmin, UserRole.KeusBackoffice)
  @ApiOperation({ summary: "Delete a document", description: "Deletes the document permanently." })
  @ApiParam({ name: "ownerType", enum: DocumentOwnerType })
  @ApiParam({ name: "ownerId", description: "Identifier of the owner." })
  @ApiParam({ name: "id", description: "Identifier of the document." })
  @ApiResponse({ status: HttpStatus.OK, description: "Document deleted successfully." })
  async deleteDocument(
    @CurrentScope() scope: RequestScope,
    @Param("ownerType") ownerType: DocumentOwnerType,
    @Param("ownerId") ownerId: string,
    @Param("id") id: string,
  ): Promise<void> {
    const documentsService = await this._loadDocumentsService();
    return documentsService.deleteDocument(ownerType, ownerId, id, scope);
  }
}
