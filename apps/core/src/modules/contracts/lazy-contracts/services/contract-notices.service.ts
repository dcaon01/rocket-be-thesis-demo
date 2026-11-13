import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import { SYSTEM_SCOPE, UserRole } from "@rocket-be/scoping";
import { rocketUrl } from "../../../../commons/formatting/notice-format.helper";
import type { CompaniesService } from "../../../companies/lazy-companies/services/companies.service";
import { MailTemplate } from "../../../mail/enums/mail-template.enum";
import type { MailAttachment } from "../../../mail/interfaces/mail-attachment.interface";
import type { MailService } from "../../../mail/lazy-mail/services/mail.service";
import type { MailRecipient } from "../../../mail/interfaces/mail-recipient.interface";
import type { ProductsService } from "../../../products/lazy-products/services/products.service";
import type { ResellersService } from "../../../resellers/lazy-resellers/services/resellers.service";
import type { UsersService } from "../../../users/lazy-users/services/users.service";
import type { Contract } from "../../schemas/contract.schema";

/** The fields of a contract a notice reads: whom it reaches and what it names. */
export type NoticeContract = Pick<Contract, "productId" | "id" | "code" | "companyId" | "companyName" | "tenantId" | "resellerPath">;

/**
 * Sends the notices of a contract's life: unpaid invoices, suspensions, seat variations, renewals.
 * Who writes depends on who reads:
 *   - the company: Rocket, through SES, at the company's address and to the referent of its tenant, with the logo
 *     of the product (the products only write about their own logic and the trials);
 *   - the reseller of an indirect contract: Rocket, through SES, at the reseller's address and to its owners and back
 *     office;
 *   - the Keus accounting: Rocket, through SES, to the `keus_accounting` group.
 * Every notice carries `contractCode`, `companyName`, `productName` and, when there is one, `productLogoUrl`. A notice runs after the
 * write it reports and never undoes it: a failed send is logged and dropped.
 */
@Injectable()
export class ContractNoticesService {
  /** Logger instance for ContractNoticesService. */
  private readonly _logger = new Logger(ContractNoticesService.name);

  /** Lazy-loaded companies service. */
  private _companiesService: CompaniesService | null = null;

  /** Lazy-loaded mail service. */
  private _mailService: MailService | null = null;

  /** Lazy-loaded products service. */
  private _productsService: ProductsService | null = null;

  /** Lazy-loaded resellers service. */
  private _resellersService: ResellersService | null = null;

  /** Lazy-loaded users service, to find the referent of a tenant. */
  private _usersService: UsersService | null = null;

  /**
   * Constructor for ContractNoticesService.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the services that send.
   */
  constructor(private readonly _lazyModuleLoader: LazyModuleLoader) {}

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
   * Lazy loads the MailService from its module.
   * @returns a Promise resolving to the MailService instance.
   */
  private async _loadMailService(): Promise<MailService> {
    if (!this._mailService) {
      const { MailLazyModule } = await import("../../../mail/lazy-mail/mail-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => MailLazyModule);
      const { MailService } = await import("../../../mail/lazy-mail/services/mail.service");
      this._mailService = moduleRef.get<MailService>(MailService);
    }
    return this._mailService;
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
   * Lazy loads the UsersService from its module.
   * @returns a Promise resolving to the UsersService instance.
   */
  private async _loadUsersService(): Promise<UsersService> {
    if (!this._usersService) {
      const { UsersLazyModule } = await import("../../../users/lazy-users/users-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => UsersLazyModule);
      const { UsersService } = await import("../../../users/lazy-users/services/users.service");
      this._usersService = moduleRef.get<UsersService>(UsersService);
    }
    return this._usersService;
  }

  /**
   * Emails the company of a contract, at its address and to the referent of its tenant, each address once.
   * @param contract the contract.
   * @param template the email to send.
   * @param data the values of the template beyond the contract's own.
   * @param options the files to attach, and one more address to write to, such as whoever accepted the contract.
   */
  async toCompany(
    contract: NoticeContract,
    template: MailTemplate,
    data: Record<string, unknown>,
    options: { attachments?: MailAttachment[]; also?: string } = {},
  ): Promise<void> {
    try {
      const recipients = await this._companyRecipients(contract, options.also);
      const values = { ...(await this._contractData(contract)), ...data };
      const mailService = await this._loadMailService();
      // One address that fails must not cost the others their notice.
      let sent = 0;
      for (const to of recipients) {
        try {
          await (options.attachments?.length ? mailService.sendWithAttachments(template, to, values, options.attachments) : mailService.send(template, to, values));
          sent++;
        } catch (error) {
          this._logger.error(`Error sending ${template} to ${to} for contract ${contract.code}`, error);
        }
      }
      this._logger.log(`${template} sent to ${sent} of ${recipients.length} address(es) for contract ${contract.code}.`);
    } catch (error) {
      this._logger.error(`Error sending ${template} to the company of contract ${contract.code}`, error);
    }
  }

  /**
   * Emails the reseller of an indirect contract, at the reseller's address and to its owners and back office.
   * @param contract the contract, sold by a reseller.
   * @param template the email to send.
   * @param data the values of the template beyond the contract's own.
   */
  async toReseller(contract: NoticeContract, template: MailTemplate, data: Record<string, unknown>): Promise<void> {
    try {
      const code = contract.resellerPath?.split("#").filter(Boolean).pop();
      const resellersService = await this._loadResellersService();
      const reseller = code ? await resellersService.getResellerByCode(code) : null;
      if (!reseller) {
        this._logger.warn(`No reseller for contract ${contract.code}: ${template} not sent.`);
        return;
      }
      await this._mailReseller(reseller, template, { ...(await this._contractData(contract)), ...data }, contract.code);
    } catch (error) {
      this._logger.error(`Error sending ${template} to the reseller of contract ${contract.code}`, error);
    }
  }

  /**
   * Emails a reseller about an invoice Keus issued to it, which may bill several contracts, at its address and to its
   * owners and back office.
   * @param resellerId the reseller billed.
   * @param template the email to send.
   * @param data the values of the template.
   * @param options the files to attach, such as the pro forma.
   */
  async toInvoicedReseller(
    resellerId: string,
    template: MailTemplate,
    data: Record<string, unknown>,
    options: { attachments?: MailAttachment[] } = {},
  ): Promise<void> {
    try {
      const resellersService = await this._loadResellersService();
      const reseller = await resellersService.getReseller(resellerId, SYSTEM_SCOPE);
      await this._mailReseller(reseller, template, data, `reseller ${resellerId}`, options.attachments);
    } catch (error) {
      this._logger.error(`Error sending ${template} to reseller ${resellerId}`, error);
    }
  }

  /**
   * Emails the Keus accounting, which follows invoices, dunning and suspensions.
   * @param template the email to send.
   * @param data the values of the template.
   * @param contract the contract the email is about, whose values and link it adds, if any.
   */
  async toAccounting(template: MailTemplate, data: Record<string, unknown>, contract?: NoticeContract): Promise<void> {
    try {
      const contractData = contract
        ? { ...(await this._contractData(contract)), contractUrl: rocketUrl(`/products/workspaces/${contract.productId}/contracts/${contract.id}`) }
        : {};
      const mailService = await this._loadMailService();
      await mailService.sendToGroups(template, [UserRole.KeusAccounting], { ...contractData, ...data });
    } catch (error) {
      this._logger.error(`Error sending ${template} to the Keus accounting`, error);
    }
  }

  /**
   * Emails a reseller at its address and to its enabled owners and back office, each address once, or warns that it
   * has nobody to write to. A reseller blocked in Rocket keeps its users enabled, so they still hear of the block.
   * @param reseller the code and the address of the reseller.
   * @param template the email to send.
   * @param data the values of the template.
   * @param about what the email is about, for the logs.
   * @param attachments the files to attach, if any.
   */
  private async _mailReseller(
    reseller: { code: string; email?: string },
    template: MailTemplate,
    data: Record<string, unknown>,
    about: string,
    attachments: MailAttachment[] = [],
  ): Promise<void> {
    const mailService = await this._loadMailService();
    // Without Cognito the reseller's own address still gets the notice.
    let collaborators: MailRecipient[] = [];
    try {
      collaborators = await mailService.findCollaboratorsInGroups([UserRole.ResellerOwner, UserRole.ResellerBackoffice], reseller.code);
    } catch (error) {
      this._logger.error(`Error finding the collaborators of reseller ${reseller.code} for ${about}`, error);
    }
    const recipients = [...new Set([reseller.email, ...collaborators.map(person => person.email)].filter((email): email is string => !!email))];
    if (recipients.length === 0) {
      this._logger.warn(`Nobody to write to at the reseller for ${about}: ${template} not sent.`);
      return;
    }

    // One address that fails must not cost the others their notice.
    let sent = 0;
    for (const to of recipients) {
      try {
        await (attachments.length ? mailService.sendWithAttachments(template, to, data, attachments) : mailService.send(template, to, data));
        sent++;
      } catch (error) {
        this._logger.error(`Error sending ${template} to ${to} at the reseller for ${about}`, error);
      }
    }
    this._logger.log(`${template} sent to ${sent} of ${recipients.length} address(es) at the reseller for ${about}.`);
  }

  /**
   * Finds the addresses of the company of a contract: its own and the referent's of its tenant, each once.
   * @param contract the contract.
   * @param also one more address, if any.
   * @returns the addresses.
   */
  private async _companyRecipients(contract: NoticeContract, also?: string): Promise<string[]> {
    const [company, referent] = await Promise.all([
      this._loadCompaniesService().then(service => service.getCompany(contract.companyId, SYSTEM_SCOPE)),
      this._loadUsersService().then(service => service.getReferent(contract.productId, contract.tenantId)),
    ]);
    return [...new Set([company.email, referent?.email, also].filter((email): email is string => !!email))];
  }

  /**
   * Builds the values every notice of a contract carries.
   * @param contract the contract.
   * @returns the contract's code, its company, the name of its product and the public URL of its logo.
   */
  private async _contractData(contract: NoticeContract): Promise<Record<string, unknown>> {
    const productsService = await this._loadProductsService();
    const product = await productsService.getProduct(contract.productId);
    return {
      contractCode: contract.code,
      companyName: contract.companyName,
      productName: product.name,
      ...(product.emailLogoUrl && { productLogoUrl: product.emailLogoUrl }),
    };
  }
}
