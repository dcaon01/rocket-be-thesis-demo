import { Injectable, Logger } from "@nestjs/common";
import * as Docxtemplater from "docxtemplater";
import type InspectModule from "docxtemplater/js/inspect-module.js";
import * as inspectModuleFactory from "docxtemplater/js/inspect-module.js";
import * as PizZip from "pizzip";
import { BusinessException } from "../../../../errors/exception-types";
import { TemplatePlaceholderCollection } from "../../classes/template-placeholder-collection.class";
import { PlaceholderSet } from "../../constants/template-placeholders";
import { listPictureKeys } from "../../helpers/docx-picture.helper";

/** The inspect module exports a factory at runtime, while its typings declare a class. */
const createInspectModule = inspectModuleFactory as unknown as () => InspectModule;

/** Largest total size of the parts of a DOCX once inflated, in bytes (100MB), against zip bombs. */
const MAX_INFLATED_BYTES = 100 * 1024 * 1024;

/** Entry of a zip as PizZip keeps it: the sizes come from the zip directory, before inflating. */
type ZipEntrySizes = { _data?: { uncompressedSize?: number } };

/** Error raised by docxtemplater on an invalid template, with one explanation per tag. */
type DocxtemplaterError = { properties?: { errors?: { properties?: { explanation?: string } }[] } };

/**
 * Service that validates the DOCX templates with docxtemplater; the frontend fills them.
 * Tags use `{{ }}` like the HTML templates, but the loops follow docxtemplater:
 * `{{#lines}}…{{/lines}}`, and a tag inside a loop falls back to the root when the
 * item does not have it. Pictures are not tags: an image drawn in Word whose
 * alternative text is a picture key, such as `{{reseller.logo}}`, receives the picture.
 * The compile options must match the frontend renderer, or a valid template renders differently.
 */
@Injectable()
export class DocxRendererService {
  /** Logger instance for DocxRendererService. */
  private readonly _logger = new Logger(DocxRendererService.name);

  /**
   * Collects the placeholders a DOCX template uses, pictures included.
   * @param source the DOCX source.
   * @param catalog the placeholders the scope may use, which tell a list field from a root value.
   * @returns the dotted keys used, sorted and without duplicates.
   * @throws BusinessException if the file or its tags are invalid, or a picture key is used as text.
   */
  extractPlaceholders(source: Buffer, catalog: PlaceholderSet): string[] {
    const zip = this._openZip(source);
    const inspectModule = createInspectModule();
    this._compile(zip, [inspectModule]);

    const imageKeys = this._imageKeys(catalog);
    const used = new Set<string>();
    const asText = new Set<string>();
    this._walkParts(inspectModule.getAllStructuredTags(), undefined, catalog, used, asText);

    const pictures = listPictureKeys(zip, imageKeys);
    const asImage = pictures.filter(key => !imageKeys.includes(key));
    if (asText.size || asImage.length) {
      throw new BusinessException(
        "Pictures go in the alternative text of an image, text values in the document body.",
        "TEMPLATE_PLACEHOLDER_MISPLACED",
        { asText: [...asText], asImage },
      );
    }
    pictures.forEach(key => used.add(key));
    return [...used].sort();
  }

  /**
   * Opens a DOCX file, refusing one whose parts would inflate beyond the limit.
   * @param source the file content.
   * @returns the zip archive.
   * @throws BusinessException if the file is not a zip archive or inflates too much.
   */
  private _openZip(source: Buffer): PizZip {
    let zip: PizZip;
    try {
      zip = new PizZip(source);
    } catch (error) {
      this._logger.warn(`DOCX source rejected: ${(error as Error).message}`);
      throw new BusinessException("The file is not a valid DOCX document.", "TEMPLATE_INVALID_SYNTAX");
    }
    const inflatedBytes = Object.values(zip.files)
      .reduce((total, file) => total + ((file as unknown as ZipEntrySizes)._data?.uncompressedSize ?? 0), 0);
    if (inflatedBytes > MAX_INFLATED_BYTES) {
      this._logger.warn(`DOCX source rejected: it inflates to ${inflatedBytes} bytes.`);
      throw new BusinessException(
        `The DOCX source inflates beyond ${MAX_INFLATED_BYTES / 1024 / 1024}MB.`,
        "TEMPLATE_SOURCE_TOO_LARGE",
        { inflatedBytes, maxBytes: MAX_INFLATED_BYTES },
      );
    }
    return zip;
  }


  /**
   * Compiles a DOCX template with the `{{ }}` delimiters, which parses and checks its tags.
   * @param zip the DOCX.
   * @param modules the docxtemplater modules to attach.
   * @returns the compiled template.
   * @throws BusinessException listing the invalid tags.
   */
  private _compile(zip: PizZip, modules: Docxtemplater.DXT.Module[]): Docxtemplater {
    try {
      return new Docxtemplater(zip, {
        modules,
        delimiters: { start: "{{", end: "}}" },
        paragraphLoop: true,
        linebreaks: true,
        // The errors reach the logger below, not the console.
        errorLogging: false,
      });
    } catch (error) {
      const errors = (error as DocxtemplaterError).properties?.errors ?? [];
      const explanations = errors.map(item => item.properties?.explanation).filter(Boolean);
      this._logger.warn(`DOCX template rejected: ${explanations.join("; ") || (error as Error).message}`);
      throw new BusinessException(
        `The template is not valid: ${explanations.join("; ") || (error as Error).message}`,
        "TEMPLATE_INVALID_SYNTAX",
        { errors: explanations },
      );
    }
  }

  /**
   * Records the keys the tags use and walks the loops, resolving the tags of a list against its fields.
   * @param parts the structured tags.
   * @param collection the list being looped over, if any.
   * @param catalog the placeholders of the scope.
   * @param used the set collecting the keys used.
   * @param asText the set collecting the picture keys written as tags.
   */
  private _walkParts(
    parts: Docxtemplater.DXT.Part[],
    collection: TemplatePlaceholderCollection | undefined,
    catalog: PlaceholderSet,
    used: Set<string>,
    asText: Set<string>,
  ): void {
    const imageKeys = this._imageKeys(catalog);
    for (const part of parts) {
      if (part.type !== "placeholder" || part.value === ".") {
        continue;
      }
      // Raw XML skips escaping, and values such as company names come from users.
      if (part.module === "rawxml") {
        used.add(`{{@${part.value}}}`);
        continue;
      }
      const key = this._resolveKey(part.value, collection);
      if (imageKeys.includes(key)) {
        asText.add(key);
        continue;
      }
      used.add(key);
      if (part.module === "loop") {
        // A loop over a list opens its items; any other loop is a condition and keeps the scope.
        const list = catalog.collections.find(item => item.key === key) ?? collection;
        this._walkParts(part.subparsed ?? [], list, catalog, used, asText);
      }
    }
  }

  /**
   * Resolves a tag to its full key: a field of the current list, or a root value.
   * @param tag the tag as written.
   * @param collection the list being looped over, if any.
   * @returns the full dotted key.
   */
  private _resolveKey(tag: string, collection: TemplatePlaceholderCollection | undefined): string {
    const isField = collection?.fields.some(field => field.key === tag || field.key.startsWith(`${tag}.`));
    return collection && isField ? `${collection.key}.${tag}` : tag;
  }

  /**
   * Returns the picture keys of a catalog.
   * @param catalog the placeholders of the scope.
   * @returns the keys whose value is a picture.
   */
  private _imageKeys(catalog: PlaceholderSet): string[] {
    return catalog.placeholders.filter(placeholder => placeholder.image).map(placeholder => placeholder.key);
  }
}
