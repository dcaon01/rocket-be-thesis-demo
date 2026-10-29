import { Injectable, Logger } from "@nestjs/common";
import * as Handlebars from "handlebars";
import { BusinessException } from "../../../../errors/exception-types";
import { PlaceholderSet } from "../../constants/template-placeholders";

/** Block helpers that open a new context: their parameter becomes the prefix of the inner paths. */
const CONTEXT_HELPERS = ["each", "with"];

/** Block helpers that only test a value. */
const CONDITIONAL_HELPERS = ["if", "unless"];

/** Service that validates the placeholders of the HTML templates with Handlebars, and fills the contract. */
@Injectable()
export class TemplateRendererService {
  /** Logger instance for TemplateRendererService. */
  private readonly _logger = new Logger(TemplateRendererService.name);

  /** Isolated Handlebars environment, so that no helper registered elsewhere leaks in. */
  private readonly _handlebars = Handlebars.create();

  /**
   * Fills an HTML template with its data; the values are escaped, as the published templates only use double braces.
   * @param source the template source.
   * @param data the values of the placeholders, already formatted.
   * @returns the filled HTML.
   */
  renderHtml(source: string, data: object): string {
    return this._handlebars.compile(source)(data);
  }

  /**
   * Collects the placeholders an HTML template uses, with list fields prefixed by their list.
   * @param source the template source.
   * @returns the dotted keys used, sorted and without duplicates.
   * @throws BusinessException if the source is not valid Handlebars.
   */
  extractHtmlPlaceholders(source: string): string[] {
    let program: hbs.AST.Program;
    try {
      program = this._handlebars.parse(source);
    } catch (error) {
      this._logger.warn(`Template source rejected: ${(error as Error).message}`);
      throw new BusinessException(
        `The template is not valid: ${(error as Error).message}`,
        "TEMPLATE_INVALID_SYNTAX",
      );
    }
    const used = new Set<string>();
    this._walkProgram(program, "", used);
    return [...used].sort();
  }

  /**
   * Asserts that every placeholder used is in the catalog of the scope.
   * @param used the dotted keys the template uses.
   * @param catalog the placeholders the scope may use.
   * @throws BusinessException listing the unknown placeholders.
   */
  assertKnownPlaceholders(used: string[], catalog: PlaceholderSet): void {
    const allowed = this._allowedKeys(catalog);
    const unknown = used.filter(key => !allowed.has(key));
    if (unknown.length) {
      throw new BusinessException(
        `The template uses placeholders that are not available here: ${unknown.join(", ")}.`,
        "TEMPLATE_UNKNOWN_PLACEHOLDER",
        { unknown },
      );
    }
  }

  /**
   * Walks the statements of a program.
   * @param program the program to walk.
   * @param prefix the path prefix of the current context.
   * @param used the set collecting the keys used.
   */
  private _walkProgram(program: hbs.AST.Program | undefined, prefix: string, used: Set<string>): void {
    for (const statement of program?.body ?? []) {
      this._walkStatement(statement, prefix, used);
    }
  }

  /**
   * Records the keys a statement uses and walks its inner blocks.
   * @param statement the statement to walk.
   * @param prefix the path prefix of the current context.
   * @param used the set collecting the keys used.
   */
  private _walkStatement(statement: hbs.AST.Statement, prefix: string, used: Set<string>): void {
    if (statement.type === "MustacheStatement") {
      const mustache = statement as hbs.AST.MustacheStatement;
      if (mustache.path.type !== "PathExpression") {
        return;
      }
      const path = mustache.path as hbs.AST.PathExpression;
      // Triple braces skip escaping, and values such as company names come from users.
      if (!mustache.escaped) {
        used.add(`{{{${path.original}}}}`);
        return;
      }
      // With parameters the path is a helper call: only the built-in block helpers are allowed.
      if (mustache.params.length) {
        used.add(`${path.original}()`);
        return;
      }
      this._recordPath(path, prefix, used);
      return;
    }

    if (statement.type === "BlockStatement") {
      const block = statement as hbs.AST.BlockStatement;
      const helper = block.path.original;
      const param = block.params[0]?.type === "PathExpression"
        ? block.params[0] as hbs.AST.PathExpression
        : undefined;

      if (CONTEXT_HELPERS.includes(helper) && param) {
        const key = this._recordPath(param, prefix, used);
        this._walkProgram(block.program, key ? `${key}.` : prefix, used);
        this._walkProgram(block.inverse, prefix, used);
        return;
      }
      if (CONDITIONAL_HELPERS.includes(helper) && param) {
        this._recordPath(param, prefix, used);
        this._walkProgram(block.program, prefix, used);
        this._walkProgram(block.inverse, prefix, used);
        return;
      }
      used.add(`#${helper}`);
    }
  }

  /**
   * Records the full key of a path, resolved against the current context.
   * @param path the path expression.
   * @param prefix the path prefix of the current context.
   * @param used the set collecting the keys used.
   * @returns the full key, or undefined for `this` and the `@` data variables.
   */
  private _recordPath(path: hbs.AST.PathExpression, prefix: string, used: Set<string>): string | undefined {
    if (path.data || !path.parts.length) {
      return undefined;
    }
    // `../x` climbs out of the list: the key is read from the root.
    const key = `${path.depth > 0 ? "" : prefix}${path.parts.join(".")}`;
    used.add(key);
    return key;
  }

  /**
   * Returns the keys a catalog allows, including the parent objects used by `if` and `with`.
   * @param catalog the placeholders of the scope.
   * @returns the allowed dotted keys.
   */
  private _allowedKeys(catalog: PlaceholderSet): Set<string> {
    const leaves = [
      ...catalog.placeholders.map(placeholder => placeholder.key),
      ...catalog.collections.flatMap(collection => [
        collection.key,
        ...collection.fields.map(field => `${collection.key}.${field.key}`),
      ]),
    ];
    const allowed = new Set<string>();
    for (const leaf of leaves) {
      const parts = leaf.split(".");
      for (let i = 1; i <= parts.length; i++) {
        allowed.add(parts.slice(0, i).join("."));
      }
    }
    return allowed;
  }
}
