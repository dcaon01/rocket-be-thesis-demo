import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { InjectModel, Model } from "nestjs-dynamoose";
import { RequestScope, SYSTEM_SCOPE } from "@rocket-be/scoping";
import { EntityNotFoundException } from "../../../../errors/exception-types";
import { formatDate, formatEuro } from "../../../../commons/formatting/notice-format.helper";
import type { CompaniesService } from "../../../companies/lazy-companies/services/companies.service";
import type { ContractNoticesService } from "../../../contracts/lazy-contracts/services/contract-notices.service";
import type { ContractsService } from "../../../contracts/lazy-contracts/services/contracts.service";
import { MailTemplate } from "../../../mail/enums/mail-template.enum";
import type { ProductsService } from "../../../products/lazy-products/services/products.service";
import type { RenderService } from "../../../render/lazy-render/services/render.service";
import type { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import type { PresignedUrlResponseDto } from "../../../s3/dtos/presigned-url-response.dto";
import type { S3Service } from "../../../s3/lazy-s3/services/s3.service";
import { TemplateType } from "../../../templates/enums/template-type.enum";
import type { TemplatesService } from "../../../templates/lazy-templates/services/templates.service";
import { proFormaDocumentData } from "../../helpers/pro-forma-document.helper";
import { Invoice, InvoiceKey } from "../../schemas/invoice.schema";

/**
 * Service for the pro forma of the invoices of Keus to a reseller (decision of Damiano, 15/10/2026). Every period and
 * every proration billed to a reseller is charged on the 4th of the next month, and its electronic invoice is issued
 * only at the payment: meanwhile the reseller gets a PDF without fiscal value, filled from the PRO_FORMA template in
 * force, kept on S3 (`proFormaS3Key`) and attached to an email.
 *
 * The pro forma never stops the invoice: a missing template or a failed render is logged, and the invoice stays
 * without one.
 */
@Injectable()
export class ProFormaService {
  /** Logger instance for ProFormaService. */
  private readonly _logger = new Logger(ProFormaService.name);

  /** Lazy-loaded contracts service. */
  private _contractsService: ContractsService | null = null;

  /** Lazy-loaded companies service. */
  private _companiesService: CompaniesService | null = null;

  /** Lazy-loaded products service. */
  private _productsService: ProductsService | null = null;

  /** Lazy-loaded templates service. */
  private _templatesService: TemplatesService | null = null;

  /** Lazy-loaded render service. */
  private _renderService: RenderService | null = null;

  /** Lazy-loaded S3 service. */
  private _s3Service: S3Service | null = null;

  /** Lazy-loaded contract notices service. */
  private _contractNoticesService: ContractNoticesService | null = null;

  /** Lazy-loaded resellers service, for the visibility of a reseller's invoices. */
  private _resellersService: ResellersService | null = null;

  /**
   * Constructor for ProFormaService.
   * @param _invoiceModel the Dynamoose model for invoices, to record where the pro forma is.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the other services on demand.
   */
  constructor(
    @InjectModel("Invoice") private readonly _invoiceModel: Model<Invoice, InvoiceKey>,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

  /**
   * Lazy loads the ContractsService from its module.
   * @returns a Promise resolving to the ContractsService instance.
   */
  private async _loadContractsService(): Promise<ContractsService> {
    if (!this._contractsService) {
      const { ContractsLazyModule } = await import("../../../contracts/lazy-contracts/contracts-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ContractsLazyModule);
      const { ContractsService } = await import("../../../contracts/lazy-contracts/services/contracts.service");
      this._contractsService = moduleRef.get<ContractsService>(ContractsService);
    }
    return this._contractsService;
  }

  /**
   * Lazy loads the CompaniesService from its module.
   * @returns a Promise resolving to the CompaniesService instance.
   */
  private async _loadCompaniesService(): Promise<CompaniesService> {
    if (!this._companiesService) {
      const { CompaniesLazyModule } = await import("../../../companies/lazy-companies/companies-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => CompaniesLazyModule);
      const { CompaniesService } = await import("../../../companies/lazy-companies/services/companies.service");
      this._companiesService = moduleRef.get<CompaniesService>(CompaniesService);
    }
    return this._companiesService;
  }

  /**
   * Lazy loads the ProductsService from its module.
   * @returns a Promise resolving to the ProductsService instance.
   */
  private async _loadProductsService(): Promise<ProductsService> {
    if (!this._productsService) {
      const { ProductsLazyModule } = await import("../../../products/lazy-products/products-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ProductsLazyModule);
      const { ProductsService } = await import("../../../products/lazy-products/services/products.service");
      this._productsService = moduleRef.get<ProductsService>(ProductsService);
    }
    return this._productsService;
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
   * Lazy loads the RenderService from its module.
   * @returns a Promise resolving to the RenderService instance.
   */
  private async _loadRenderService(): Promise<RenderService> {
    if (!this._renderService) {
      const { RenderLazyModule } = await import("../../../render/lazy-render/render-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => RenderLazyModule);
      const { RenderService } = await import("../../../render/lazy-render/services/render.service");
      this._renderService = moduleRef.get<RenderService>(RenderService);
    }
    return this._renderService;
  }

  /**
   * Lazy loads the S3Service from its module.
   * @returns a Promise resolving to the S3Service instance.
   */
  private async _loadS3Service(): Promise<S3Service> {
    if (!this._s3Service) {
      const { S3LazyModule } = await import("../../../s3/lazy-s3/s3-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => S3LazyModule);
      const { S3Service } = await import("../../../s3/lazy-s3/services/s3.service");
      this._s3Service = moduleRef.get<S3Service>(S3Service);
    }
    return this._s3Service;
  }

  /**
   * Lazy loads the ContractNoticesService from the contracts module.
   * @returns a Promise resolving to the ContractNoticesService instance.
   */
  private async _loadContractNoticesService(): Promise<ContractNoticesService> {
    if (!this._contractNoticesService) {
      const { ContractsLazyModule } = await import("../../../contracts/lazy-contracts/contracts-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ContractsLazyModule);
      const { ContractNoticesService } = await import("../../../contracts/lazy-contracts/services/contract-notices.service");
      this._contractNoticesService = moduleRef.get<ContractNoticesService>(ContractNoticesService);
    }
    return this._contractNoticesService;
  }

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
   * Signs the download URL of the pro forma of an invoice, for Keus and for the reseller it is issued to.
   * @param billedPartyId the reseller billed.
   * @param id the invoice ID.
   * @param scope the request scope.
   * @returns the signed URL of the PDF.
   * @throws EntityNotFoundException if the invoice does not exist or has no pro forma.
   * @throws AuthorizationException if the reseller is outside the scope of the requester.
   */
  async getProFormaUrl(billedPartyId: string, id: string, scope: RequestScope): Promise<PresignedUrlResponseDto> {
    const resellersService = await this._loadResellersService();
    await resellersService.getReseller(billedPartyId, scope);

    const invoice = await this._invoiceModel.get({ billedPartyId, id });
    if (!invoice?.proFormaS3Key) {
      throw new EntityNotFoundException("Pro forma of invoice", id);
    }

    const s3Service = await this._loadS3Service();
    return s3Service.signDownloadUrl(invoice.proFormaS3Key);
  }

  /**
   * Fills the pro forma of an invoice to a reseller, keeps its PDF on S3 next to the invoice and emails it to the
   * reseller. Never throws: whatever fails is logged, and the invoice is charged on the 4th all the same.
   * @param invoice the invoice just issued to the reseller, for a contract.
   */
  async sendProForma(invoice: Invoice): Promise<void> {
    if (!invoice.contractId || !invoice.lineProductId) {
      return;
    }

    try {
      const contractsService = await this._loadContractsService();
      const contract = await contractsService.getContract(invoice.lineProductId, invoice.contractId, SYSTEM_SCOPE);
      const companiesService = await this._loadCompaniesService();
      const company = await companiesService.getCompany(contract.companyId, SYSTEM_SCOPE);
      const productsService = await this._loadProductsService();
      const product = await productsService.getProduct(contract.productId);
      const context = { contractCode: contract.code, companyName: company.name, productName: product.name };

      const templatesService = await this._loadTemplatesService();
      const { html } = await templatesService.renderPublished(TemplateType.ProForma, proFormaDocumentData(invoice, context));
      const renderService = await this._loadRenderService();
      const pdf = await renderService.renderPdf(html);

      const proFormaS3Key = `invoice-documents/${invoice.billedPartyId}/${invoice.id}/pro-forma.pdf`;
      const s3Service = await this._loadS3Service();
      await s3Service.putObject(proFormaS3Key, pdf, "application/pdf");
      await this._invoiceModel.update({ billedPartyId: invoice.billedPartyId, id: invoice.id }, { proFormaS3Key });
      this._logger.log(`Pro forma of invoice ${invoice.id} stored at ${proFormaS3Key}.`);

      const contractNoticesService = await this._loadContractNoticesService();
      await contractNoticesService.toInvoicedReseller(
        invoice.billedPartyId,
        MailTemplate.ResellerProForma,
        {
          ...context,
          total: formatEuro(invoice.amountCents),
          chargeDate: invoice.dueDate ? formatDate(invoice.dueDate) : "",
        },
        { attachments: [{ fileName: `pro-forma-${contract.code}.pdf`, contentType: "application/pdf", content: pdf }] },
      );
    } catch (error) {
      this._logger.error(`Error sending the pro forma of invoice ${invoice.id} to reseller ${invoice.billedPartyId}`, error);
    }
  }
}
