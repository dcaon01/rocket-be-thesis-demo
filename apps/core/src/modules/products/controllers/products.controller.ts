import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Put, UseGuards, HttpCode } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CreateProductDto } from "../dtos/create-product.dto";
import { ResponseProductDto } from "../dtos/response-product.dto";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { ResponseProductsPageDto } from "../dtos/response-products-page.dto";
import { UpdateProductDto } from "../dtos/update-product.dto";
import { ProductsService } from "../lazy-products/services/products.service";

/**
 * Controller for managing Products.
 * Uses lazy loading to load ProductsService only when needed.
 */
@ApiTags('Products')
@UseGuards(ScopeGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  /** Lazy-loaded products service */
  private _productsService: ProductsService | null = null;

  /**
   * Constructor for ProductsController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) {}

  /**
   * Lazy loads the ProductsService from its module.
   * @returns A Promise resolving to the ProductsService instance.
   */
  private async _loadProductsService(): Promise<ProductsService> {
    if (!this._productsService) {
      const { ProductsLazyModule } = await import(
        "../lazy-products/products-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => ProductsLazyModule,
      );
      this._productsService = moduleRef.get<ProductsService>(ProductsService);
    }
    return this._productsService;
  }

  /**
   * Creates a new product.
   * @param product the DTO with the information to create a new product.
   * @returns the created product.
   */
  @Post()
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'Create a new product',
    description: 'Creates a new product in the system.'
  })
  @ApiBody({
    type: CreateProductDto
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The product has been successfully created.',
    type: ResponseProductDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async createProduct(
    @Body() product: CreateProductDto
  ): Promise<ResponseProductDto> {
    const productsService = await this._loadProductsService();
    return productsService.createProduct(product);
  }

  /**
   * Retrieves an product by its unique identifier.
   * @param scope the scope of the requester.
   * @param id the identifier of the product.
   * @returns the product with the specified ID.
   */
  @Get('id/:id')
  @ApiOperation({
    summary: 'Get product by ID',
    description: 'Retrieves an product by its unique identifier. A Keus admin gets it whole, the other Keus collaborators without the Stripe secrets, a reseller only the fields its interface shows and only for the products of its contract.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The product has been successfully retrieved.',
    type: ResponseProductDto
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The product is not one the reseller of the requester may read.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'product not found.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getProduct(
    @CurrentScope() scope: RequestScope,
    @Param('id') id: string
  ): Promise<ResponseProductDto> {
    const productsService = await this._loadProductsService();
    return productsService.getProduct(id, scope);
  }

  /**
   * Lists one page of the products, for the products page.
   * @param scope the scope of the requester.
   * @param query the page.
   * @returns the page of products.
   */
  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the products',
    description: 'Lists one page of the products the requester may read: all of them for the Keus collaborators, the ones of its contract for a reseller. Shaped as the product by ID.'
  })
  @ApiBody({ type: PageQueryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Page of products retrieved successfully.',
    type: ResponseProductsPageDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid page size or cursor.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async listProducts(@CurrentScope() scope: RequestScope, @Body() query: PageQueryDto): Promise<ResponseProductsPageDto> {
    const productsService = await this._loadProductsService();
    return productsService.listProducts(query, scope);
  }

  /**
   * Retrieves all Products, for the product cache of the application.
   * @param scope the scope of the requester.
   * @returns the Products the requester may read.
   */
  @Get('all')
  @ApiOperation({
    summary: 'Get all products',
    description: 'Retrieves the products the requester may read: all of them for the Keus collaborators, the ones of its contract for a reseller. Shaped as the product by ID.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'All products have been successfully retrieved.',
    type: ResponseProductDto,
    isArray: true,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async getAllProducts(@CurrentScope() scope: RequestScope): Promise<ResponseProductDto[]> {
    const productsService = await this._loadProductsService();
    return productsService.getAllProducts(scope);
  }

  /**
   * Updates an product.
   * @param id the identifier of the product to update.
   * @param product the DTO with the information to update the product.
   * @returns the updated product.
   */
  @Put(':id')
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'Update an product',
    description: 'Updates an existing product in the system.'
  })
  @ApiBody({
    type: UpdateProductDto
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The product has been successfully updated.',
    type: ResponseProductDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data.'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async updateProduct(
    @Param('id') id: string,
    @Body() product: UpdateProductDto
  ): Promise<ResponseProductDto> {
    const productsService = await this._loadProductsService();
    return productsService.updateProduct(id, product);
  }

  /**
   * Deletes an product by its ID.
   * @param id the identifier of the product to delete.
   */
  @Delete(':id')
  @Roles(UserRole.KeusAdmin)
  @ApiOperation({
    summary: 'Delete an product',
    description: 'Deletes an existing product from the system.'
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'The product has been successfully deleted.',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error.'
  })
  async deleteProduct(@Param('id') id: string): Promise<void> {
    const productsService = await this._loadProductsService();
    return productsService.deleteProduct(id);
  }
}
