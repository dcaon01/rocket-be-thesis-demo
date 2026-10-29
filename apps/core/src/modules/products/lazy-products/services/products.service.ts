import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { InjectModel, Model } from "nestjs-dynamoose";
import { v4 as uuidv4 } from "uuid";
import { isUnrestricted, RequestScope, SYSTEM_SCOPE, UserRole } from "@rocket-be/scoping";
import { EncryptionService } from "../../../../commons/encryption/encryption.service";
import { splitRemovals, toDynamooseUpdate } from "../../../../commons/persistence/removable-update.helper";
import { AuthorizationException, BusinessException, DatabaseException, EntityNotFoundException, ValidationException } from "../../../../errors/exception-types";
import { PageQueryDto } from '../../../../commons/pagination/page-query.dto';
import { paginate } from '../../../../commons/pagination/pagination.helper';
import { ResponseProductsPageDto } from '../../dtos/response-products-page.dto';
import { CreateProductDto } from "../../dtos/create-product.dto";
import { ResponseProductDto } from "../../dtos/response-product.dto";
import { UpdateProductDto } from "../../dtos/update-product.dto";
import { ProductStatus } from "../../enums/product-status.enum";
import { IMPLIED_RULE_DIRECTION, MixpanelRuleDirection } from "../../enums/mixpanel-rule-direction.enum";
import { MixpanelRuleShape } from "../../enums/mixpanel-rule-shape.enum";
import { MixpanelLeverRule } from "../../classes/mixpanel-lever-rule.class";
import { Product, ProductKey, ProductSchema } from "../../schemas/product.schema";
import type { OrdersService } from "../../../orders/lazy-orders/services/orders.service";
import type { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";

/**
 * Fields of a product a reseller reads: what its interface shows, and the tenant and user structures with the roles,
 * which its forms build on. Nothing of the configuration: no secrets, integrations or metrics.
 */
const RESELLER_VISIBLE_FIELDS = [
  "id", "name", "description", "status", "logoS3Key", "prefix", "orderable",
  "tenantStructure", "userStructure", "customAttributes", "roles",
] as const;

/**
 * Service for managing products.
 */
@Injectable()
export class ProductsService {
  /** Logger instance for ProductsService. */
  private readonly _logger = new Logger(ProductsService.name);

  /**
   * Constructor for ProductsService.
   * @param _productModel the model for product operations.
   * @param _encryptionService service used to encrypt/decrypt per-product Stripe secrets at rest.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the orders service on demand.
   */
  constructor(
    @InjectModel("Product")
    private readonly _productModel: Model<Product, ProductKey>,
    private readonly _encryptionService: EncryptionService,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

  /** Lazy-loaded orders service, used to realign the product name copied on the order lines. */
  private _ordersService: OrdersService | null = null;

  /**
   * Lazy loads the OrdersService from its module.
   * @returns a Promise resolving to the OrdersService instance.
   */
  private async _loadOrdersService(): Promise<OrdersService> {
    if (!this._ordersService) {
      const { OrdersLazyModule } = await import("../../../orders/lazy-orders/orders-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => OrdersLazyModule);
      const { OrdersService } = await import("../../../orders/lazy-orders/services/orders.service");
      this._ordersService = moduleRef.get<OrdersService>(OrdersService);
    }
    return this._ordersService;
  }

  /** Lazy-loaded resellers service, to know which products a reseller may read. */
  private _resellersService: ResellersService | null = null;

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
   * Encrypts the Stripe secret fields on an incoming DTO before persistence.
   * Fields that are absent on the input are left absent on the output.
   * @param data the object carrying the plaintext Stripe secrets.
   * @returns a new object with the Stripe secrets replaced by their encrypted form.
   */
  private _encryptStripeSecrets<T extends { stripeApiKey?: string; stripeWebhookSecret?: string }>(data: T): T {
    return {
      ...data,
      ...(data.stripeApiKey !== undefined && {
        stripeApiKey: this._encryptionService.encrypt(data.stripeApiKey),
      }),
      ...(data.stripeWebhookSecret !== undefined && {
        stripeWebhookSecret: this._encryptionService.encrypt(data.stripeWebhookSecret),
      }),
    };
  }

  /**
   * Decrypts the Stripe secret fields stored on a Product before it leaves the service.
   * Fields that are absent on the input are left absent on the output (defensive against
   * legacy records that might pre-date the feature).
   * @param product the product as retrieved from DynamoDB (with ciphertext secrets).
   * @returns a new product object with decrypted Stripe secrets.
   */
  private _decryptStripeSecrets(product: Product): Product {
    return {
      ...product,
      ...(product.stripeApiKey && {
        stripeApiKey: this._encryptionService.decrypt(product.stripeApiKey),
      }),
      ...(product.stripeWebhookSecret && {
        stripeWebhookSecret: this._encryptionService.decrypt(product.stripeWebhookSecret),
      }),
    };
  }

  /**
   * Lists the products a reseller may read: the ones its contract enables and the ones of its descendants, whose
   * dashboards it reads too. Keus collaborators and the internal paths are not filtered.
   * @param scope the request scope.
   * @returns the identifiers of the products, or null when every product is readable.
   * @throws DatabaseException if the read of the resellers fails.
   */
  private async _readableProductIds(scope: RequestScope): Promise<Set<string> | null> {
    if (isUnrestricted(scope) || !scope.resellerCode) {
      return null;
    }

    const resellersService = await this._loadResellersService();
    return resellersService.getEnabledProductIdsOfSubtree(scope.resellerCode);
  }

  /**
   * Shapes a product for the requester: a Keus admin and the internal paths get it whole, with the Stripe secrets
   * decrypted; the other Keus collaborators get it without the secrets; a reseller gets only what its interface shows.
   * @param product the product as stored.
   * @param scope the request scope.
   * @returns the response DTO.
   */
  private _toResponse(product: Product, scope: RequestScope): ResponseProductDto {
    if (scope.system === true || scope.roles.includes(UserRole.KeusAdmin)) {
      return plainToInstance(ResponseProductDto, this._decryptStripeSecrets(product));
    }

    if (isUnrestricted(scope)) {
      const { stripeApiKey: _stripeApiKey, stripeWebhookSecret: _stripeWebhookSecret, ...withoutSecrets } = product;
      return plainToInstance(ResponseProductDto, withoutSecrets);
    }

    return plainToInstance(ResponseProductDto, Object.fromEntries(RESELLER_VISIBLE_FIELDS.map(field => [field, product[field]])));
  }

  /**
   * Validates the rules of the levers across their fields: no two rules with the same id, the yellow threshold past
   * the green one on the bad side, and coverage thresholds within 100%. The single fields are checked by the DTO.
   * @param rules the rules to validate, if any.
   * @throws BusinessException if a rule breaks one of the constraints.
   */
  private _validateMixpanelRules(rules?: MixpanelLeverRule[] | null): void {
    if (!rules) {
      return;
    }

    const ids = new Set<string>();
    for (const rule of rules) {
      if (rule.id && ids.has(rule.id)) {
        throw new BusinessException(`The rule ${rule.id} appears more than once in the rules of the product.`, "MIXPANEL_RULE_DUPLICATE_ID");
      }
      if (rule.id) {
        ids.add(rule.id);
      }

      const direction = rule.direction ?? IMPLIED_RULE_DIRECTION[rule.shape];
      const ordered = direction === MixpanelRuleDirection.AtLeast
        ? rule.yellowThreshold <= rule.greenThreshold
        : rule.yellowThreshold >= rule.greenThreshold;
      if (!ordered) {
        throw new BusinessException(`The yellow threshold of the ${rule.lever} rule must lie past the green one, on the bad side.`, "MIXPANEL_RULE_THRESHOLDS_ORDER");
      }

      if (rule.shape === MixpanelRuleShape.Coverage && rule.greenThreshold > 100) {
        throw new BusinessException(`The thresholds of the ${rule.lever} coverage rule are percentages: at most 100.`, "MIXPANEL_RULE_THRESHOLD_RANGE");
      }
    }
  }

  /**
   * Gives an identifier to the rules that have none, so that their results can be told apart.
   * @param rules the rules of the product, if any.
   */
  private _assignRuleIds(rules?: MixpanelLeverRule[] | null): void {
    rules?.forEach(rule => {
      rule.id ??= uuidv4();
    });
  }

  /**
   * Creates a new product.
   * @param product the DTO with the information to create a new product.
   * @returns the created product.
   * @throws BusinessException if the lever rules are not consistent.
   */
  async createProduct(product: CreateProductDto): Promise<ResponseProductDto> {
    this._validateMixpanelRules(product.mixpanelRules);
    this._assignRuleIds(product.mixpanelRules);

    try {
      const id = uuidv4();

      const encryptedInput = this._encryptStripeSecrets(product);
      const newProduct: Product = {
        ...encryptedInput,
        id,
        status: ProductStatus.Active,
        tenantStructure: JSON.parse(JSON.stringify(product.tenantStructure)) as Product['tenantStructure'],
        userStructure: JSON.parse(JSON.stringify(product.userStructure)) as Product['userStructure'],
        resellerPlansEnabled: product.resellerPlansEnabled ?? false,
        // The professional is out of scope: the flag stays on the schema for the
        // existing records, but no new product can turn it on.
        professionalPlansEnabled: false,
        mixpanelRules: product.mixpanelRules
          ? JSON.parse(JSON.stringify(product.mixpanelRules)) as Product['mixpanelRules']
          : undefined,
      }
      this._logger.log(`Creating product with ID: ${id}`);
      const createdProduct = await this._productModel.create(newProduct);
      this._logger.log(`Product created with ID: ${createdProduct.id}`);

      return plainToInstance(ResponseProductDto, this._decryptStripeSecrets(createdProduct));

    } catch (error) {
      this._logger.error('Error creating product', error);
      throw new DatabaseException('An error occurred while creating the product.', error);
    }
  }

  /**
   * Retrieves an product by its unique identifier.
   * @param id the identifier of the product to find.
   * @returns the found product.
   */
  async getProduct(id: string, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseProductDto> {
    const readable = await this._readableProductIds(scope);
    if (readable && !readable.has(id)) {
      throw new AuthorizationException(`Product ${id} is outside the scope of reseller ${scope.resellerCode}.`);
    }

    try {
      const product = await this._productModel.get({ id: id }); // O(1)

      if (!product) {
        this._logger.warn(`Product with ID: ${id} not found.`);
        throw new EntityNotFoundException('Product', id);
      }

      this._logger.log(`Product with ID: ${id} retrieved successfully.`);
      return this._toResponse(product, scope);

    } catch (error) {
      this._logger.error('Error creating product', error);
      if (error instanceof EntityNotFoundException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while creating the product.', error);
    }
  }

  /**
   * Retrieves the products the requester may read: all of them for the internal paths and Keus collaborators, the
   * ones its contract enables for a reseller.
   * @param scope the request scope.
   * @returns the products.
   */
  async getAllProducts(scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseProductDto[]> {
    const readable = await this._readableProductIds(scope);

    try {
      const products = await this._productModel.scan().exec(); // We need to return all products, so scan is necessary here.
      this._logger.log(`Retrieved ${products.length} products.`);
      return products
        .filter(product => !readable || readable.has(product.id))
        .map(product => this._toResponse(product, scope));

    } catch (error) {
      this._logger.error('Error retrieving products', error);
      throw new DatabaseException('An error occurred while retrieving the products.', error);
    }
  }

  /**
   * Lists one page of the products, for the products page.
   * @param query the page.
   * @param scope the request scope.
   * @returns the page of products.
   * @throws ValidationException if the cursor is not valid.
   */
  async listProducts(query: PageQueryDto, scope: RequestScope = SYSTEM_SCOPE): Promise<ResponseProductsPageDto> {
    const readable = await this._readableProductIds(scope);

    try {
      const page = await paginate<Product>(() => this._productModel.scan(), ['id'], query.limit, query.cursor, product => !readable || readable.has(product.id)); // Every product is asked for: scan.
      return {
        items: page.items.map(product => this._toResponse(product, scope)),
        nextCursor: page.nextCursor,
      };
    } catch (error) {
      if (error instanceof ValidationException) {
        throw error;
      }
      this._logger.error('Error listing products', error);
      throw new DatabaseException('An error occurred while retrieving the products.', error);
    }
  }

  /**
   * Updates a product. A null field is removed (see `splitRemovals`).
   * @param id the identifier of the product to update.
   * @param product the DTO with the information to update the product.
   * @returns the updated product.
   * @throws EntityNotFoundException if the product does not exist.
   * @throws BusinessException if the lever rules are not consistent.
   */
  async updateProduct(id: string, product: UpdateProductDto): Promise<ResponseProductDto> {
    this._validateMixpanelRules(product.mixpanelRules);
    this._assignRuleIds(product.mixpanelRules);

    try {
      const existingProduct = await this._productModel.get({ id: id });

      // Check if the product exists.
      if (!existingProduct) {
        this._logger.warn(`Product with ID: ${id} not found for update.`);
        throw new EntityNotFoundException('Product', id);
      }

      // Update the product.
      const plainUpdateProduct: Partial<Product> = JSON.parse(JSON.stringify(product)) as Partial<Product>;
      const { set, remove } = splitRemovals(plainUpdateProduct, ProductSchema, "product");
      const encryptedUpdate = this._encryptStripeSecrets(set);
      this._logger.log(`Updating product with ID: ${id}`);
      const updatedProductResult = await this._productModel.update({ id: id }, toDynamooseUpdate(encryptedUpdate, remove));

      this._logger.log(`Product with ID: ${id} updated successfully.`);
      if (updatedProductResult.name !== existingProduct.name) {
        await this._syncOrderLineNames(id, updatedProductResult.name);
      }
      return plainToInstance(ResponseProductDto, this._decryptStripeSecrets(updatedProductResult));

    } catch (error) {
      this._logger.error('Error updating product', error);
      if (error instanceof EntityNotFoundException || error instanceof BusinessException) {
        throw error;
      }
      throw new DatabaseException('An error occurred while updating the product.', error);
    }
  }

  /**
   * Records the logo of a product once uploaded, with its public copy for the emails when it was made.
   * @param id the identifier of the product.
   * @param logoS3Key the S3 key of the logo.
   * @param emailLogoUrl the public URL of its copy for the emails, if any.
   * @throws DatabaseException if the product cannot be updated.
   */
  async recordLogo(id: string, logoS3Key: string, emailLogoUrl?: string): Promise<void> {
    try {
      await this._productModel.update({ id }, toDynamooseUpdate<Product>({ logoS3Key, ...(emailLogoUrl && { emailLogoUrl }) }, emailLogoUrl ? [] : ['emailLogoUrl']));
      this._logger.log(`Logo of product ${id} recorded.`);
    } catch (error) {
      this._logger.error(`Error recording the logo of product ${id}`, error);
      throw new DatabaseException('An error occurred while recording the logo of the product.', error);
    }
  }

  /**
   * Realigns the product name copied on the order lines after a rename.
   * A failure is logged and does not undo the rename.
   * @param id the identifier of the product.
   * @param name the new name of the product.
   */
  private async _syncOrderLineNames(id: string, name: string): Promise<void> {
    try {
      const ordersService = await this._loadOrdersService();
      await ordersService.syncProductName(id, name);
    } catch (error) {
      this._logger.error(`Product ${id} renamed, but its order lines could not be realigned`, error);
    }
  }

  /**
   * Deletes an product by its ID.
   * @param id the identifier of the product to delete.
   * @remarks for now, the deletion of the product is indipendent from the
   * associated elements in Rocket, but also from the elements in the integrations.
   * This is due to the fact that it may involve complex business logic that is
   * better to handle manually.
   * For example, it is impossible to delete a Stripe product if there are active subscriptions
   * associated with it, which obviously may involve customers and their money, which is
   * a sensitive topic.
   */
  async deleteProduct(id: string): Promise<void> {
    try {
      this._logger.log(`Deleting product with ID: ${id}`);
      await this._productModel.delete({ id: id });
      this._logger.log(`Product with ID: ${id} deleted successfully.`);

    } catch (error) {
      this._logger.error('Error deleting product', error);
      throw new DatabaseException('An error occurred while deleting the product.', error);
    }
  }
}
