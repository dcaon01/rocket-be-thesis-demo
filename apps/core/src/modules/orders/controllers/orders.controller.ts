import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Put, UseGuards, HttpCode } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentScope, RequestScope, Roles, RolesGuard, ScopeGuard, UserRole } from "@rocket-be/scoping";
import { AcceptOrderDto } from "../dtos/accept-order.dto";
import { ConfirmOrderDto } from "../dtos/confirm-order.dto";
import { CreateOrderDto } from "../dtos/create-order.dto";
import { CustomizationDiscountDto } from "../dtos/customization-discount.dto";
import { GenerateOfferDto } from "../dtos/generate-offer.dto";
import { ProvisionLineDto } from "../dtos/provision-line.dto";
import { ProvisionLineOnTenantDto } from "../dtos/provision-line-on-tenant.dto";
import { RefuseApprovalDto } from "../dtos/refuse-approval.dto";
import { SaveQuotationDto } from "../dtos/save-quotation.dto";
import { RefuseOrderDto } from "../dtos/refuse-order.dto";
import { OrdersPageQueryDto } from "../dtos/orders-page-query.dto";
import { ProvisioningPageQueryDto } from "../dtos/provisioning-page-query.dto";
import { ResponseOrderLinesPageDto } from "../dtos/response-order-lines-page.dto";
import { ResponseOrderDto } from "../dtos/response-order.dto";
import { ResponseOrdersPageDto } from "../dtos/response-orders-page.dto";
import { ResponseOrderLineDto } from "../dtos/response-order-line.dto";
import { ResponseOrderSellerDto } from "../dtos/response-order-seller.dto";
import { UpdateFinancingDto } from "../dtos/update-financing.dto";
import { UpdateOrderDto } from "../dtos/update-order.dto";
import { OrdersService } from "../lazy-orders/services/orders.service";

/** Profiles that sell: Keus sales and every reseller profile, plus the admin. */
const SELLER_ROLES = [UserRole.KeusAdmin, UserRole.KeusSales, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales];

/** Profiles that price customizations and confirm orders: the Keus back office, plus the admin. */
const BACK_OFFICE_ROLES = [UserRole.KeusAdmin, UserRole.KeusBackoffice];

/**
 * Profiles that provision the lines of an order: the Keus back office and admin, and the owner and back office of a
 * reseller on its own orders (decision of Damiano, 24/10/2026, beyond UR-RK-017).
 */
const PROVISIONING_ROLES = [UserRole.KeusAdmin, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice];

/** Profiles of a reseller that sell its orders and ask Keus to approve their offers. */
const RESELLER_SELLER_ROLES = [UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales];

/**
 * Controller for managing orders, their lines and their customization requests.
 * Uses lazy loading to load OrdersService only when needed.
 */
@ApiTags("Orders")
@UseGuards(ScopeGuard, RolesGuard)
@Controller("orders")
export class OrdersController {
  /** Lazy-loaded orders service */
  private _ordersService: OrdersService | null = null;

  /**
   * Constructor for OrdersController.
   * @param _lazyModuleLoader the lazy module loader for lazy loading services.
   */
  constructor(
    private readonly _lazyModuleLoader: LazyModuleLoader
  ) { }

  /**
   * Lazy loads the OrdersService from its module.
   * @returns A Promise resolving to the OrdersService instance.
   */
  private async _loadOrdersService(): Promise<OrdersService> {
    if (!this._ordersService) {
      const { OrdersLazyModule } = await import(
        "../lazy-orders/orders-lazy.module"
      );
      const moduleRef = await this._lazyModuleLoader.load(
        () => OrdersLazyModule,
      );
      this._ordersService = moduleRef.get<OrdersService>(OrdersService);
    }
    return this._ordersService;
  }

  /**
   * Creates a new order in DRAFT with its lines and its customization request.
   * @param scope the request scope.
   * @param orderDto the order data.
   * @returns the created order.
   */
  @Post()
  @Roles(...SELLER_ROLES)
  @ApiOperation({
    summary: "Create a new order",
    description: "Creates an order in DRAFT for a single company, with one line per product and an optional customization request. Prices are computed from the plans."
  })
  @ApiBody({ type: CreateOrderDto, description: "The order data to create." })
  @ApiResponse({ status: HttpStatus.CREATED, description: "The order has been successfully created.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "No content, a duplicated product, or a plan, product or discount not admitted on the channel. A product the company already has is accepted: the draft stops at the next step." })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: "The company is outside the requester's perimeter, or sold by a reseller for a Keus salesperson." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async createOrder(
    @CurrentScope() scope: RequestScope,
    @Body() orderDto: CreateOrderDto,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.createOrder(orderDto, scope);
  }

  /**
   * Lists one page of the orders visible to the requester.
   * @param scope the request scope.
   * @param query the page and its filters.
   * @returns the page of orders with their summary, newest first.
   */
  @Post("search")
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.KeusAccounting, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({
    summary: "List the orders",
    description: "Lists one page of the orders, newest first, restricted to the requester's perimeter and filtered by status (every status when none), channel, request period and the start of code, company name or VAT number."
  })
  @ApiBody({ type: OrdersPageQueryDto })
  @ApiResponse({ status: HttpStatus.OK, description: "Orders retrieved successfully.", type: ResponseOrdersPageDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Reversed period, or invalid page size or cursor." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async listOrders(
    @CurrentScope() scope: RequestScope,
    @Body() query: OrdersPageQueryDto,
  ): Promise<ResponseOrdersPageDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.listOrders(query, scope);
  }

  /**
   * Retrieves the orders of a company.
   * @param scope the request scope.
   * @param companyId the identifier of the company.
   * @returns the orders of the company, newest first.
   */
  @Get("company/:companyId")
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.KeusAccounting, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({ summary: "Get the orders of a company", description: "Retrieves every order of a company, for its record." })
  @ApiParam({ name: "companyId", description: "Identifier of the company." })
  @ApiResponse({ status: HttpStatus.OK, description: "Orders retrieved successfully.", type: [ResponseOrderDto] })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Company not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async getOrdersByCompany(
    @CurrentScope() scope: RequestScope,
    @Param("companyId") companyId: string,
  ): Promise<ResponseOrderDto[]> {
    const ordersService = await this._loadOrdersService();
    return ordersService.getOrdersByCompany(companyId, scope);
  }

  /**
   * Retrieves who sells to a company, for the order form.
   * @param scope the request scope.
   * @param companyId the identifier of the company.
   * @returns the channel and, on the indirect channel, the enabled products and the margin of the reseller.
   */
  @Get("seller/:companyId")
  // The Keus back office edits drafts too, and the form reads the seller to cap their lines.
  @Roles(...SELLER_ROLES, UserRole.KeusBackoffice)
  @ApiOperation({
    summary: "Get who sells to a company",
    description: "Retrieves the sales channel of a company and, on the indirect channel, the products its reseller is enabled to sell and the margin of its contract in force. The margin is left out for a reseller salesperson.",
  })
  @ApiParam({ name: "companyId", description: "Identifier of the company." })
  @ApiResponse({ status: HttpStatus.OK, description: "Seller retrieved successfully.", type: ResponseOrderSellerDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: "The company is outside the requester's perimeter." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Company or reseller not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async getSeller(
    @CurrentScope() scope: RequestScope,
    @Param("companyId") companyId: string,
  ): Promise<ResponseOrderSellerDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.getSeller(companyId, scope);
  }

  /**
   * Lists one page of the order lines waiting to be provisioned.
   * Declared before `:id` so that the path is not read as an order id.
   * @param query the page and its filters.
   * @returns the page of lines waiting to be provisioned.
   */
  @Post("provisioning/search")
  @HttpCode(HttpStatus.OK)
  @Roles(...BACK_OFFICE_ROLES)
  @ApiOperation({ summary: "List the lines to provision", description: "Lists one page of the lines of confirmed orders waiting to be provisioned, for one product or for all of them, filtered by the start of order code or company name. A line already requested carries its tenant." })
  @ApiBody({ type: ProvisioningPageQueryDto })
  @ApiResponse({ status: HttpStatus.OK, description: "Lines retrieved successfully.", type: ResponseOrderLinesPageDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Invalid page size or cursor." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async listProvisioningQueue(
    @Body() query: ProvisioningPageQueryDto,
  ): Promise<ResponseOrderLinesPageDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.listProvisioningQueue(query);
  }

  /**
   * Retrieves an order with its lines and its customization request.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @returns the order.
   */
  @Get(":id")
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.KeusAccounting, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({ summary: "Get an order", description: "Retrieves a single order by its identifier, with its lines and its customization request." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiResponse({ status: HttpStatus.OK, description: "Order retrieved successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async getOrder(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.getOrder(id, scope);
  }

  /**
   * Edits a draft order.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @param orderDto the data to apply.
   * @returns the updated order.
   */
  @Put(":id")
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales, UserRole.KeusBackoffice, UserRole.ResellerOwner, UserRole.ResellerBackoffice, UserRole.ResellerSales)
  @ApiOperation({ summary: "Edit a draft order", description: "Replaces the lines and the customization request of a draft order, recomputing the prices." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiBody({ type: UpdateOrderDto, description: "The data to apply." })
  @ApiResponse({ status: HttpStatus.OK, description: "Order updated successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The order is no longer a draft, or the data is not admitted." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async updateOrder(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
    @Body() orderDto: UpdateOrderDto,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.updateOrder(id, orderDto, scope);
  }

  /**
   * Sends a draft with a customization request to the back office for pricing.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @returns the updated order.
   */
  @Patch(":id/request-quote")
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: "Request the pricing of the customization", description: "Moves a draft with a customization request to TO_BE_PRICED, in the queue of the back office." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiResponse({ status: HttpStatus.OK, description: "Order updated successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The order is not a draft, has no customization to price, or a product has a contract in force or another order out of the draft for the company." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async requestQuote(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.requestQuote(id, scope);
  }

  /**
   * Saves the quotation of an order: the outcome of every customization at once.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @param quotationDto the outcome of the customizations.
   * @returns the updated order.
   */
  @Put(":id/quotation")
  @Roles(...BACK_OFFICE_ROLES)
  @ApiOperation({ summary: "Save the quotation", description: "Prices or refuses the customizations of the order in one go; none may be left to price. The order moves to PRICED, or to REFUSED when nothing is left to sell, and the seller gets one email. Saving again after the offer voids it." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiBody({ type: SaveQuotationDto, description: "The outcome of the customizations." })
  @ApiResponse({ status: HttpStatus.OK, description: "Quotation saved successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "An outcome is incomplete, a customization is left to price, or the order cannot be priced in its status." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order or customization not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async saveQuotation(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
    @Body() quotationDto: SaveQuotationDto,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.saveQuotation(id, quotationDto, scope);
  }

  /**
   * Sets the discount the seller grants on a customization.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @param customizationId the identifier of the customization.
   * @param discountDto the discount.
   * @returns the updated order.
   */
  @Patch(":id/customizations/:customizationId/discount")
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: "Discount the customization", description: "Sets the discount granted to the customer on the customization, before the offer. On the indirect channel it cannot exceed the reseller margin." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiParam({ name: "customizationId", description: "Identifier of the customization." })
  @ApiBody({ type: CustomizationDiscountDto, description: "The discount." })
  @ApiResponse({ status: HttpStatus.OK, description: "Discount set successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The offer already went out, or the discount exceeds the margin." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async setCustomizationDiscount(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
    @Param("customizationId") customizationId: string,
    @Body() discountDto: CustomizationDiscountDto,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.setCustomizationDiscount(id, customizationId, discountDto, scope);
  }

  /**
   * Asks the Keus back office to approve the offer of a reseller order.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @returns the updated order.
   */
  @Patch(":id/request-approval")
  @Roles(...RESELLER_SELLER_ROLES)
  @ApiOperation({ summary: "Request the approval of the offer", description: "Moves a reseller order, with every customization priced, to TO_BE_APPROVED, in the queue of the Keus back office." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiResponse({ status: HttpStatus.OK, description: "Approval requested successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Not a reseller order, customizations still to price, a line incomplete, or a product has a contract in force or another order out of the draft for the company." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async requestApproval(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.requestApproval(id, scope);
  }

  /**
   * Approves the offer of a reseller order.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @returns the updated order.
   */
  @Patch(":id/approve")
  @Roles(...BACK_OFFICE_ROLES)
  @ApiOperation({ summary: "Approve the offer", description: "Approves the offer of a reseller order waiting for approval: the reseller can now generate it." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiResponse({ status: HttpStatus.OK, description: "Offer approved successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The order is not waiting for approval." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async approveOffer(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.approveOffer(id, scope);
  }

  /**
   * Refuses the approval of the offer of a reseller order.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @param refusalDto the reason of the refusal.
   * @returns the updated order.
   */
  @Patch(":id/refuse-approval")
  @Roles(...BACK_OFFICE_ROLES)
  @ApiOperation({ summary: "Refuse the approval of the offer", description: "Sends a reseller order waiting for approval back to the reseller with a reason: priced when it has customizations, a draft otherwise." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiBody({ type: RefuseApprovalDto, description: "The reason of the refusal." })
  @ApiResponse({ status: HttpStatus.OK, description: "Approval refused successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The order is not waiting for approval." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async refuseApproval(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
    @Body() refusalDto: RefuseApprovalDto,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.refuseApproval(id, refusalDto, scope);
  }

  /**
   * Records that the offer has been generated and sent.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @param offerDto the template the offer was generated from.
   * @returns the updated order.
   */
  @Patch(":id/offer")
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: "Record the offer", description: "Records that the offer has been generated from the template in force for the channel and sent. The document is compiled by the client." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiBody({ type: GenerateOfferDto, description: "The template the offer was generated from." })
  @ApiResponse({ status: HttpStatus.OK, description: "Offer recorded successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Customization not priced, incomplete lines, template not in force, or a product has a contract in force or another order out of the draft for the company." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async generateOffer(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
    @Body() offerDto: GenerateOfferDto,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.generateOffer(id, offerDto, scope);
  }

  /**
   * Records the acceptance of the offer.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @param acceptDto the signed offer.
   * @returns the updated order.
   */
  @Patch(":id/accept")
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: "Accept the offer", description: "Records the acceptance with the signed offer, uploaded as ORDER_SIGNED_OFFER." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiBody({ type: AcceptOrderDto, description: "The signed offer." })
  @ApiResponse({ status: HttpStatus.OK, description: "Offer accepted successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The offer has not been sent, or the file is not the signed offer." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async acceptOrder(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
    @Body() acceptDto: AcceptOrderDto,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.acceptOrder(id, acceptDto, scope);
  }

  /**
   * Records the refusal of the offer.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @param refusalDto the reason and the note.
   * @returns the updated order.
   */
  @Patch(":id/refuse")
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: "Refuse the offer", description: "Records the refusal of the offer with a reason from the closed list; the note is mandatory with OTHER." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiBody({ type: RefuseOrderDto, description: "The reason and the note." })
  @ApiResponse({ status: HttpStatus.OK, description: "Offer refused successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The offer has not been sent, or the note is missing." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async refuseOrder(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
    @Body() refusalDto: RefuseOrderDto,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.refuseOrder(id, refusalDto, scope);
  }

  /**
   * Marks an order of the direct channel as financed, or removes the financing.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @param financingDto the financing data.
   * @returns the updated order.
   */
  @Put(":id/financing")
  @Roles(UserRole.KeusAdmin, UserRole.KeusSales)
  @ApiOperation({ summary: "Set the financing", description: "Marks an order of the direct channel as financed by a finance company, or removes the financing with NONE." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiBody({ type: UpdateFinancingDto, description: "The financing data." })
  @ApiResponse({ status: HttpStatus.OK, description: "Financing updated successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Indirect channel, or the order is already confirmed." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async updateFinancing(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
    @Body() financingDto: UpdateFinancingDto,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.updateFinancing(id, financingDto, scope);
  }

  /**
   * Confirms an accepted order with the expected delivery date.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @param confirmDto the expected delivery date.
   * @returns the updated order.
   */
  @Patch(":id/confirm")
  @Roles(...BACK_OFFICE_ROLES)
  @ApiOperation({ summary: "Confirm the order", description: "Confirms an accepted order with the expected delivery date and releases its lines for provisioning. The company's fiscal data must be complete." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiBody({ type: ConfirmOrderDto, description: "The expected delivery date." })
  @ApiResponse({ status: HttpStatus.OK, description: "Order confirmed successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The order is not accepted, or fiscal data, IBAN or financing contract are missing." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async confirmOrder(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
    @Body() confirmDto: ConfirmOrderDto,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.confirmOrder(id, confirmDto, scope);
  }

  /**
   * Provisions a line of a confirmed order: asks the product for the tenant and, once it is confirmed, for its users.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @param productId the product of the line.
   * @param provisionDto the tenant and its users, the first being the referent.
   * @returns the line, with its tenant in REQUESTED.
   */
  @Post(":id/lines/:productId/provision")
  @Roles(...PROVISIONING_ROLES)
  @ApiOperation({ summary: "Provision an order line", description: "Writes the tenant and its users in REQUESTED and asks the product for the tenant; the users are sent once the product confirms it. The first user is the referent." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiParam({ name: "productId", description: "Identifier of the product of the line." })
  @ApiBody({ type: ProvisionLineDto, description: "The tenant and its users." })
  @ApiResponse({ status: HttpStatus.CREATED, description: "Line provisioning requested.", type: ResponseOrderLineDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The order is not confirmed, the line is not waiting, the company has a contract in force on the product or another order provisioning it, the users exceed the seats, or a role is unknown to the product." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order or line not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async provisionLine(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
    @Param("productId") productId: string,
    @Body() provisionDto: ProvisionLineDto,
  ): Promise<ResponseOrderLineDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.provisionLine(id, productId, provisionDto, scope);
  }

  /**
   * Provisions a line of a confirmed order on a tenant the product already has, which keeps its users and data.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @param productId the product of the line.
   * @param provisionDto the existing tenant.
   * @returns the line, provisioned on the tenant.
   */
  @Post(":id/lines/:productId/provision-on-tenant")
  @Roles(...PROVISIONING_ROLES)
  @ApiOperation({ summary: "Provision an order line on an existing tenant", description: "Hands an existing tenant of the product to the line, such as the tenant of a trial or of a terminated contract, and reactivates it if it is inactive. Nothing is asked to the product: the contract is born as for a new tenant and the referent accepts it at the next access. A tenant with a contract in force is refused." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiParam({ name: "productId", description: "Identifier of the product of the line." })
  @ApiBody({ type: ProvisionLineOnTenantDto, description: "The existing tenant." })
  @ApiResponse({ status: HttpStatus.CREATED, description: "Line provisioned on the tenant.", type: ResponseOrderLineDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The order is not confirmed, the line is not waiting, the company has a contract in force on the product or another order provisioning it, or the tenant is not on the product, has a contract in force, is being provisioned for another order, belongs to another company, comes from another channel or has no referent." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order, line or tenant not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async provisionLineOnTenant(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
    @Param("productId") productId: string,
    @Body() provisionDto: ProvisionLineOnTenantDto,
  ): Promise<ResponseOrderLineDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.provisionLineOnTenant(id, productId, provisionDto.tenantId, scope);
  }

  /**
   * Completes a line whose tenant and users the product has all answered, but which was not recorded as provisioned.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @param productId the product of the line.
   * @returns the line, provisioned.
   */
  @Post(":id/lines/:productId/complete-provisioning")
  @Roles(...PROVISIONING_ROLES)
  @ApiOperation({ summary: "Complete an order line provisioning", description: "Records as provisioned a line whose tenant is active and whose users are all confirmed or cancelled, when the automatic step did not run." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiParam({ name: "productId", description: "Identifier of the product of the line." })
  @ApiResponse({ status: HttpStatus.CREATED, description: "Line provisioned.", type: ResponseOrderLineDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The line is not waiting, or its tenant or users are still waiting for the product." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order or line not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async completeLineProvisioning(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
    @Param("productId") productId: string,
  ): Promise<ResponseOrderLineDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.completeLineProvisioning(id, productId, scope);
  }

  /**
   * Cancels an order before its confirmation.
   * @param scope the request scope.
   * @param id the identifier of the order.
   * @returns the updated order.
   */
  @Patch(":id/cancel")
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: "Cancel the order", description: "Cancels an order before its confirmation. Final." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiResponse({ status: HttpStatus.OK, description: "Order cancelled successfully.", type: ResponseOrderDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The order is confirmed or already final." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async cancelOrder(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
  ): Promise<ResponseOrderDto> {
    const ordersService = await this._loadOrdersService();
    return ordersService.cancelOrder(id, scope);
  }

  /**
   * Deletes a draft, refused or cancelled order with its lines, its customization request and its files.
   * @param scope the request scope.
   * @param id the identifier of the order.
   */
  @Delete(":id")
  @Roles(UserRole.KeusAdmin, UserRole.ResellerOwner)
  @ApiOperation({ summary: "Delete an order", description: "Deletes a draft, refused or cancelled order with its lines, its customization request and its files: the Keus admin on any order, the owner of a reseller on the orders of its reseller. An order on its way is cancelled first; a confirmed one is kept." })
  @ApiParam({ name: "id", description: "Identifier of the order." })
  @ApiResponse({ status: HttpStatus.OK, description: "Order deleted successfully." })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "The order is still on its way, or confirmed." })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Order not found." })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: "Internal server error." })
  async deleteOrder(
    @CurrentScope() scope: RequestScope,
    @Param("id") id: string,
  ): Promise<void> {
    const ordersService = await this._loadOrdersService();
    return ordersService.deleteOrder(id, scope);
  }
}
