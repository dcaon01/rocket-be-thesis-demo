import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { Condition, transaction } from "dynamoose";
import { InjectModel, Model } from "nestjs-dynamoose";
import { v4 as uuidv4 } from "uuid";
import { isUnrestricted, RequestScope, SYSTEM_SCOPE } from "@rocket-be/scoping";
import {
  AppException,
  AuthorizationException,
  BusinessException,
  DatabaseException,
  EntityNotFoundException,
  ValidationException,
} from "../../../../errors/exception-types";
import { paginate, startsWithAny } from "../../../../commons/pagination/pagination.helper";
import { SalesChannel } from "../../../companies/enums/sales-channel.enum";
import { S3Service } from "../../../s3/lazy-s3/services/s3.service";
import { placeholdersFor } from "../../constants/template-placeholders";
import { CreateTemplateDto } from "../../dtos/create-template.dto";
import { ResponsePlaceholderCatalogDto } from "../../dtos/response-placeholder-catalog.dto";
import { ResponseTemplateDto } from "../../dtos/response-template.dto";
import { ResponseTemplatesPageDto } from "../../dtos/response-templates-page.dto";
import { TemplatesPageQueryDto } from "../../dtos/templates-page-query.dto";
import { UpdateTemplateDto } from "../../dtos/update-template.dto";
import { TemplateFormat } from "../../enums/template-format.enum";
import { TemplateStatus } from "../../enums/template-status.enum";
import { TemplateType } from "../../enums/template-type.enum";
import { Template, TemplateKey } from "../../schemas/template.schema";
import { DocxRendererService } from "./docx-renderer.service";
import { TemplateRendererService } from "./template-renderer.service";
import { isTransactionCanceled } from "../../../../commons/persistence/write-errors.helper";

/** Scope key used by the templates that are single for the whole platform. */
const GLOBAL_SCOPE = "GLOBAL";

/** MIME type of a Word document. */
const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Largest DOCX source read into memory for validation, in bytes (10MB). */
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

/** Content fields of a template, checked against its format. */
type TemplateContent = Pick<Template, "body" | "sourceS3Key">;

/**
 * Derives the format of a template: HTML except for the indirect-channel offer.
 * @param type the type of the template.
 * @param channel the channel, for the offer templates.
 * @returns the format of the template.
 */
export function formatFor(type: TemplateType, channel?: SalesChannel): TemplateFormat {
  if (type === TemplateType.Offer && channel === SalesChannel.Reseller) {
    return TemplateFormat.Docx;
  }
  return TemplateFormat.Html;
}

/**
 * Builds an update that also removes attributes: Dynamoose accepts it, its typings do not.
 * @param set the attributes to write.
 * @param remove the attributes to remove.
 * @returns the update object.
 */
function withRemoval(set: Partial<Template>, remove: (keyof Template)[]): Partial<Template> {
  return { ...set, $REMOVE: remove } as Partial<Template>;
}

/** Service for document templates: one published per scope, only drafts are editable. */
@Injectable()
export class TemplatesService {
  /** Logger instance for TemplatesService. */
  private readonly _logger = new Logger(TemplatesService.name);

  /** Lazy-loaded S3 service, used for the DOCX sources. */
  private _s3Service: S3Service | null = null;

  /**
   * Constructor for TemplatesService.
   * @param _templateModel the Dynamoose model used to persist templates.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the S3 service on demand.
   * @param _renderer the service that validates the placeholders of the HTML templates.
   * @param _docxRenderer the service that validates and fills the DOCX templates.
   */
  constructor(
    @InjectModel("Template")
    private readonly _templateModel: Model<Template, TemplateKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader,
    private readonly _renderer: TemplateRendererService,
    private readonly _docxRenderer: DocxRendererService,
  ) { }

  /**
   * Lazy loads the S3Service from its module.
   * @returns a Promise resolving to the S3Service instance.
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
   * Creates a template in DRAFT.
   * @param templateDto the data to create the template with.
   * @returns the created template.
   * @throws ValidationException if the scope does not match the type.
   * @throws BusinessException if the content does not match the format.
   */
  async createTemplate(templateDto: CreateTemplateDto): Promise<ResponseTemplateDto> {
    this._assertScope(templateDto.type, templateDto.channel);
    const scopeKey = this._scopeKeyFor(templateDto.type, templateDto.channel);
    const format = formatFor(templateDto.type, templateDto.channel);
    this._validateContent(format, templateDto);
    const placeholders = format === TemplateFormat.Html
      ? this._htmlPlaceholders(templateDto)
      : [];

    try {
      const template: Template = {
        type: templateDto.type,
        id: uuidv4(),
        name: templateDto.name,
        scopeKey,
        format,
        status: TemplateStatus.Draft,
        ...(templateDto.channel && { channel: templateDto.channel }),
        ...(templateDto.body && { body: templateDto.body }),
        ...(placeholders.length && { placeholders }),
      };

      this._logger.log(`Creating ${template.type} template with ID: ${template.id}`);
      const created = await this._templateModel.create(template);
      return plainToInstance(ResponseTemplateDto, created, { excludeExtraneousValues: true });
    } catch (error) {
      this._logger.error("Error creating template", error);
      throw new DatabaseException("Error creating template.", error as Error);
    }
  }

  /**
   * Lists one page of the templates, filtered by type, status and name.
   * A single type reads its partition; several types read the whole table, which holds a handful of templates.
   * @param query the page and its filters.
   * @returns the page of templates.
   * @throws ValidationException if the cursor is not valid.
   */
  async listTemplates(query: TemplatesPageQueryDto): Promise<ResponseTemplatesPageDto> {
    const { limit, cursor, type, status, name } = query;
    const page = await paginate<Template>(
      () => type?.length === 1 ? this._templateModel.query("type").eq(type[0]) : this._templateModel.scan(),
      ["type", "id"],
      limit,
      cursor,
      template =>
        (!type?.length || type.includes(template.type))
        && (!status?.length || status.includes(template.status))
        && startsWithAny(name, template.name),
    );
    return {
      items: page.items.map(template => plainToInstance(ResponseTemplateDto, template, { excludeExtraneousValues: true })),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Retrieves a template by its type and identifier. A reseller reads only the offer templates of the indirect channel,
   * never a draft: a withdrawn one too, since an offer generated with it is downloaded again from it.
   * @param type the type of the template.
   * @param id the identifier of the template.
   * @param scope the request scope.
   * @returns the template.
   * @throws AuthorizationException if a reseller asks for another template, for one of the direct channel or for a draft.
   * @throws EntityNotFoundException if the template does not exist.
   */
  async getTemplate(type: TemplateType, id: string, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseTemplateDto> {
    this._assertResellerReads(type, undefined, scope);
    const template = await this._getTemplateOrThrow(type, id);
    if (!isUnrestricted(scope) && (template.status === TemplateStatus.Draft || template.channel !== SalesChannel.Reseller)) {
      throw new AuthorizationException(`Template ${id} is a draft or of the direct channel: resellers read only the offer templates of their own.`);
    }

    return plainToInstance(ResponseTemplateDto, template, { excludeExtraneousValues: true });
  }

  /**
   * Resolves the template in force for a scope, reading the sparse index consistently. A reseller resolves only the
   * offer template of its own channel.
   * @param type the type of template to resolve.
   * @param channel the channel, for the offer templates.
   * @param scope the request scope.
   * @returns the published template, or null when none is in force.
   * @throws AuthorizationException if a reseller asks for another template than the offer of its channel.
   */
  async resolveTemplate(
    type: TemplateType,
    channel?: SalesChannel,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<ResponseTemplateDto | null> {
    this._assertResellerReads(type, channel, scope);
    const templates = await this._templateModel
      .query("type").eq(type)
      .where("publishedScopeKey").eq(this._scopeKeyFor(type, channel))
      .using("publishedIndex")
      .consistent()
      .exec();

    return templates.length
      ? plainToInstance(ResponseTemplateDto, templates[0], { excludeExtraneousValues: true })
      : null;
  }

  /**
   * Fills the HTML template in force for a scope; the backend fills only the contract and the pro forma.
   * @param type the type of template.
   * @param data the values of the placeholders, already formatted.
   * @returns the template used and the filled HTML.
   * @throws BusinessException if no HTML template is in force for the scope.
   */
  async renderPublished(type: TemplateType, data: object): Promise<{ templateId: string; html: string }> {
    const template = await this.resolveTemplate(type);
    if (!template?.body) {
      throw new BusinessException(`No published ${type} template to fill.`, "TEMPLATE_MISSING", { type });
    }
    return { templateId: template.id, html: this._renderer.renderHtml(template.body, data) };
  }

  /**
   * Fills a given HTML template, published or withdrawn: a document filled again keeps the text it was born with.
   * @param type the type of the template.
   * @param id the identifier of the template.
   * @param data the values, keyed as the placeholders of the template.
   * @returns the filled HTML.
   * @throws EntityNotFoundException if the template does not exist.
   * @throws BusinessException if the template has no HTML body.
   */
  async renderTemplate(type: TemplateType, id: string, data: object): Promise<string> {
    const template = await this._getTemplateOrThrow(type, id);
    if (!template.body) {
      throw new BusinessException(`Template ${id} has no HTML body to fill.`, "TEMPLATE_MISSING", { type, id });
    }
    return this._renderer.renderHtml(template.body, data);
  }

  /**
   * Updates a draft template; a DOCX source must be uploaded under the template's own key, and its tags are checked.
   * @param type the type of the template.
   * @param id the identifier of the template.
   * @param templateDto the data to apply.
   * @returns the updated template.
   * @throws BusinessException if the template is not a draft, the content does not match the format, or it uses unknown placeholders.
   * @throws ValidationException if the source key does not belong to the template.
   * @throws EntityNotFoundException if the template or the uploaded source does not exist.
   */
  async updateTemplate(type: TemplateType, id: string, templateDto: UpdateTemplateDto): Promise<ResponseTemplateDto> {
    const template = await this._getTemplateOrThrow(type, id);

    // A published or withdrawn template is what generated documents point at.
    if (template.status !== TemplateStatus.Draft) {
      throw new BusinessException(
        `Template ${id} is ${template.status} and cannot be edited: duplicate it and publish the copy.`,
        "TEMPLATE_NOT_EDITABLE",
        { status: template.status },
      );
    }
    this._validateContent(template.format, templateDto);
    let placeholders = template.format === TemplateFormat.Html && templateDto.body !== undefined
      ? this._htmlPlaceholders({ ...template, ...templateDto })
      : undefined;

    if (templateDto.sourceS3Key) {
      if (templateDto.sourceS3Key !== this._sourceKeyFor(id)) {
        throw new ValidationException(`Source ${templateDto.sourceS3Key} does not belong to template ${id}.`, []);
      }
      placeholders = await this._docxPlaceholders({ ...template, sourceS3Key: templateDto.sourceS3Key });
    }

    try {
      const updated = await this._templateModel.update({ type, id }, {
        ...(templateDto.name !== undefined && { name: templateDto.name }),
        ...(templateDto.body !== undefined && { body: templateDto.body }),
        ...(templateDto.sourceS3Key !== undefined && { sourceS3Key: templateDto.sourceS3Key }),
        ...(placeholders && { placeholders }),
      });
      this._logger.log(`Template ${id} updated`);
      return plainToInstance(ResponseTemplateDto, updated, { excludeExtraneousValues: true });
    } catch (error) {
      this._logger.error(`Error updating template ${id}`, error);
      throw new DatabaseException(`Error updating template ${id}.`, error as Error);
    }
  }

  /**
   * Publishes a template, withdrawing the one in force for its scope.
   * @param type the type of the template.
   * @param id the identifier of the template.
   * @returns the published template.
   * @throws BusinessException if the template is already published, has no content or uses no placeholder.
   */
  async publishTemplate(type: TemplateType, id: string): Promise<ResponseTemplateDto> {
    const template = await this._getTemplateOrThrow(type, id);
    if (template.status === TemplateStatus.Published) {
      throw new BusinessException(`Template ${id} is already published.`, "TEMPLATE_ALREADY_PUBLISHED");
    }
    this._assertPublishable(template);
    // The catalog may have changed since the draft was saved, and the source may have been uploaded again.
    const placeholders = template.format === TemplateFormat.Html
      ? this._htmlPlaceholders(template)
      : await this._docxPlaceholders(template);
    if (!placeholders.length) {
      throw new BusinessException(`Template ${id} uses no placeholder.`, "TEMPLATE_WITHOUT_PLACEHOLDERS");
    }

    const siblings = await this._templateModel
      .query("type").eq(type)
      .where("scopeKey").eq(template.scopeKey)
      .using("scopeIndex")
      .consistent()
      .exec();

    const now = new Date().toISOString();
    const inForce = siblings.filter(sibling => sibling.id !== id && sibling.status === TemplateStatus.Published);

    // Withdrawal and publication in one transaction, conditioned on the states
    // read above: of two concurrent publishes, the second fails instead of both winning.
    try {
      await transaction([
        ...inForce.map(sibling =>
          this._templateModel.transaction.update(
            { type, id: sibling.id },
            withRemoval({ status: TemplateStatus.Withdrawn, withdrawnAt: now }, ["publishedScopeKey"]),
            { condition: new Condition().where("status").eq(TemplateStatus.Published) },
          ),
        ),
        this._templateModel.transaction.update(
          { type, id },
          withRemoval({ status: TemplateStatus.Published, publishedAt: now, publishedScopeKey: template.scopeKey, placeholders }, ["withdrawnAt"]),
          { condition: new Condition().where("status").eq(template.status) },
        ),
      ]);
    } catch (error) {
      if (isTransactionCanceled(error)) {
        throw new BusinessException(
          `Template ${id} changed while it was being published: reload it and try again.`,
          "TEMPLATE_PUBLISH_CONFLICT",
        );
      }
      this._logger.error(`Error publishing template ${id}`, error);
      throw new DatabaseException(`Error publishing template ${id}.`, error as Error);
    }

    for (const sibling of inForce) {
      this._logger.log(`Template ${sibling.id} withdrawn: replaced by ${id}`);
    }
    this._logger.log(`Template ${id} published for ${template.scopeKey}`);
    return this.getTemplate(type, id);
  }

  /**
   * Withdraws a published template, leaving its scope without one in force.
   * @param type the type of the template.
   * @param id the identifier of the template.
   * @returns the withdrawn template.
   * @throws BusinessException if the template is not published, or is the contract in force.
   */
  async withdrawTemplate(type: TemplateType, id: string): Promise<ResponseTemplateDto> {
    const template = await this._getTemplateOrThrow(type, id);
    if (template.status !== TemplateStatus.Published) {
      throw new BusinessException(`Template ${id} is ${template.status}: only a published one can be withdrawn.`, "TEMPLATE_NOT_PUBLISHED");
    }
    // Without a contract in force, the first access to a product could not generate the contract.
    if (type === TemplateType.Contract) {
      throw new BusinessException(
        `Template ${id} is the contract in force: publish a new one to replace it.`,
        "TEMPLATE_CONTRACT_REQUIRED",
      );
    }

    try {
      const updated = await this._templateModel.update(
        { type, id },
        withRemoval({ status: TemplateStatus.Withdrawn, withdrawnAt: new Date().toISOString() }, ["publishedScopeKey"]),
        { return: "item", condition: new Condition().where("status").eq(TemplateStatus.Published) },
      );
      this._logger.log(`Template ${id} withdrawn`);
      return plainToInstance(ResponseTemplateDto, updated, { excludeExtraneousValues: true });
    } catch (error) {
      this._logger.error(`Error withdrawing template ${id}`, error);
      throw new DatabaseException(`Error withdrawing template ${id}.`, error as Error);
    }
  }

  /**
   * Returns the placeholders a template scope may use, with the format that decides the loop syntax.
   * @param type the type of template.
   * @param channel the channel, for the offer templates.
   * @param scope the request scope.
   * @returns the placeholder catalog of the scope.
   * @throws AuthorizationException if a reseller asks for another catalog than the offer of its channel.
   * @throws ValidationException if the scope does not match the type.
   */
  getPlaceholderCatalog(
    type: TemplateType,
    channel?: SalesChannel,
    scope: RequestScope = SYSTEM_SCOPE,
  ): ResponsePlaceholderCatalogDto {
    this._assertResellerReads(type, channel, scope);
    this._assertScope(type, channel);
    const catalog = placeholdersFor(type, channel);
    return {
      type,
      ...(channel && { channel }),
      format: formatFor(type, channel),
      placeholders: catalog.placeholders,
      collections: catalog.collections,
    };
  }

  /**
   * Creates a draft copy of a template, the way to change a published one.
   * @param type the type of the template.
   * @param id the identifier of the template to copy.
   * @returns the new draft.
   * @throws EntityNotFoundException if the template does not exist.
   */
  async duplicateTemplate(type: TemplateType, id: string): Promise<ResponseTemplateDto> {
    const source = await this._getTemplateOrThrow(type, id);
    const copyId = uuidv4();

    try {
      let sourceS3Key: string | undefined;
      if (source.sourceS3Key) {
        sourceS3Key = this._sourceKeyFor(copyId);
        const s3Service = await this._loadS3Service();
        await s3Service.copyObject(source.sourceS3Key, sourceS3Key);
      }

      const copy: Template = {
        type,
        id: copyId,
        name: `${source.name} (copia)`,
        scopeKey: source.scopeKey,
        format: source.format,
        status: TemplateStatus.Draft,
        ...(source.channel && { channel: source.channel }),
        ...(source.body && { body: source.body }),
        ...(source.placeholders && { placeholders: source.placeholders }),
        ...(sourceS3Key && { sourceS3Key }),
      };

      const created = await this._templateModel.create(copy);
      this._logger.log(`Template ${id} duplicated as ${copyId}`);
      return plainToInstance(ResponseTemplateDto, created, { excludeExtraneousValues: true });
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this._logger.error(`Error duplicating template ${id}`, error);
      throw new DatabaseException(`Error duplicating template ${id}.`, error as Error);
    }
  }

  /**
   * Deletes a draft template together with its DOCX source.
   * @param type the type of the template.
   * @param id the identifier of the template.
   * @throws BusinessException if the template was ever published.
   */
  async deleteTemplate(type: TemplateType, id: string): Promise<void> {
    const template = await this._getTemplateOrThrow(type, id);
    // A template that generated documents is part of their history.
    if (template.status !== TemplateStatus.Draft) {
      throw new BusinessException(
        `Template ${id} is ${template.status}: only a draft can be deleted.`,
        "TEMPLATE_NOT_DELETABLE",
        { status: template.status },
      );
    }

    await this._templateModel.delete({ type, id });
    this._logger.log(`Template ${id} deleted`);
    if (template.sourceS3Key) {
      try {
        const s3Service = await this._loadS3Service();
        await s3Service.deleteObject(template.sourceS3Key);
      } catch (error) {
        this._logger.warn(`Source ${template.sourceS3Key} of template ${id} could not be deleted and is left orphan.`, error);
      }
    }
  }

  /**
   * Retrieves a raw template or throws when it does not exist.
   * @param type the type of the template.
   * @param id the identifier of the template.
   * @returns the template entity.
   * @throws EntityNotFoundException if the template does not exist.
   */
  private async _getTemplateOrThrow(type: TemplateType, id: string): Promise<Template> {
    const template = await this._templateModel.get({ type, id });
    if (!template) {
      throw new EntityNotFoundException("Template", id);
    }
    return template;
  }

  /**
   * Validates that the content fields match the format.
   * @param format the format of the template.
   * @param content the content being written.
   * @throws BusinessException if a field is not allowed on this template.
   */
  private _validateContent(format: TemplateFormat, content: TemplateContent): void {
    if (format === TemplateFormat.Html && content.sourceS3Key) {
      throw new BusinessException("An HTML template has no DOCX source.", "TEMPLATE_FORMAT_MISMATCH");
    }
    if (format === TemplateFormat.Docx && content.body) {
      throw new BusinessException("A DOCX template has no inline body.", "TEMPLATE_FORMAT_MISMATCH");
    }
  }

  /**
   * Asserts that a template carries what its format needs to generate a document.
   * @param template the template to publish.
   * @throws BusinessException if the body or the source is missing.
   */
  private _assertPublishable(template: Template): void {
    if (template.format === TemplateFormat.Docx && !template.sourceS3Key) {
      throw new BusinessException(`Template ${template.id} has no DOCX source.`, "TEMPLATE_EMPTY");
    }
    if (template.format === TemplateFormat.Html && !template.body) {
      throw new BusinessException(`Template ${template.id} has no body.`, "TEMPLATE_EMPTY");
    }
  }

  /**
   * Keeps the reads of a reseller to what it needs to fill its offers (UR-RK-013): the offer templates, and with a
   * channel only the indirect one. Keus collaborators and internal callers read every template.
   * @param type the type of template asked for.
   * @param channel the channel asked for, when the read has one.
   * @param scope the request scope.
   * @throws AuthorizationException if a reseller asks for anything else.
   */
  private _assertResellerReads(type: TemplateType, channel: SalesChannel | undefined, scope: RequestScope): void {
    if (isUnrestricted(scope)) {
      return;
    }

    if (type !== TemplateType.Offer || (channel !== undefined && channel !== SalesChannel.Reseller)) {
      throw new AuthorizationException("Resellers read only the offer templates of the indirect channel.");
    }
  }

  /**
   * Validates that the scope matches the type: a channel on offers only.
   * @param type the type of the template.
   * @param channel the channel given, if any.
   * @throws ValidationException if the scope does not match the type.
   */
  private _assertScope(type: TemplateType, channel?: SalesChannel): void {
    const needsChannel = type === TemplateType.Offer;
    if (needsChannel !== Boolean(channel)) {
      throw new ValidationException(
        needsChannel ? "An offer template must be bound to a channel." : "Only an offer template is bound to a channel.",
        [],
      );
    }
  }

  /**
   * Collects the placeholders of an HTML template's body and checks them against its catalog.
   * @param template the template content with its scope.
   * @returns the placeholders used.
   * @throws BusinessException if the syntax is invalid or a placeholder is unknown.
   */
  private _htmlPlaceholders(template: Pick<Template, "type" | "channel" | "body">): string[] {
    const used = this._renderer.extractHtmlPlaceholders(template.body ?? "");
    this._renderer.assertKnownPlaceholders(used, placeholdersFor(template.type, template.channel));
    return used;
  }

  /**
   * Downloads the DOCX source of a template, collects its placeholders and checks them against its catalog.
   * The size and type are read first, so an oversized upload is refused before it reaches memory.
   * @param template the template with its scope and source.
   * @returns the placeholders used.
   * @throws EntityNotFoundException if the source was not uploaded.
   * @throws BusinessException if the source is too large, not a DOCX, invalid or uses unknown placeholders.
   */
  private async _docxPlaceholders(template: Pick<Template, "type" | "channel" | "sourceS3Key">): Promise<string[]> {
    const sourceS3Key = template.sourceS3Key ?? "";
    const s3Service = await this._loadS3Service();
    const { contentType, sizeBytes } = await s3Service.headObject(sourceS3Key);
    if (sizeBytes > MAX_SOURCE_BYTES) {
      throw new BusinessException(
        `The DOCX source is ${Math.ceil(sizeBytes / 1024 / 1024)}MB, over the ${MAX_SOURCE_BYTES / 1024 / 1024}MB limit.`,
        "TEMPLATE_SOURCE_TOO_LARGE",
        { sizeBytes, maxBytes: MAX_SOURCE_BYTES },
      );
    }
    if (contentType !== DOCX_CONTENT_TYPE) {
      throw new BusinessException(`The source of the template is ${contentType}, not a DOCX document.`, "TEMPLATE_FORMAT_MISMATCH");
    }

    const catalog = placeholdersFor(template.type, template.channel);
    const source = await s3Service.getObjectBuffer(sourceS3Key);
    const used = this._docxRenderer.extractPlaceholders(source, catalog);
    this._renderer.assertKnownPlaceholders(used, catalog);
    return used;
  }


  /**
   * Builds the scope key a template of the given type belongs to.
   * @param type the type of the template.
   * @param channel the channel, for the offer templates.
   * @returns the scope key.
   */
  private _scopeKeyFor(type: TemplateType, channel?: SalesChannel): string {
    switch (type) {
      case TemplateType.Offer:
        return `${channel}`;
      default:
        return GLOBAL_SCOPE;
    }
  }

  /**
   * Returns the S3 key of a template's DOCX source, as the presigned upload generates it.
   * @param id the identifier of the template.
   * @returns the S3 key.
   */
  private _sourceKeyFor(id: string): string {
    return `templates/${id}/source.docx`;
  }
}
