import { Injectable, Logger } from "@nestjs/common";
import { LazyModuleLoader } from "@nestjs/core";
import type { InvoicesService } from "../../../invoices/lazy-invoices/services/invoices.service";
import { SibillDocumentUpdatedEvent } from "../../../sibill/interfaces/sibill.interface";

/**
 * Service for the Sibill webhook: it brings to the invoices the state and the number of their electronic invoice,
 * once the CEO issues the draft. Only `document.updated` on documents Keus issued matters; the other events are ignored.
 */
@Injectable()
export class SibillWebhookService {
  /** Logger instance for SibillWebhookService. */
  private readonly _logger = new Logger(SibillWebhookService.name);

  /** Lazy-loaded invoices service. */
  private _invoicesService: InvoicesService | null = null;

  /**
   * Constructor for SibillWebhookService.
   * @param _lazyModuleLoader the lazy module loader, for the invoices service.
   */
  constructor(private readonly _lazyModuleLoader: LazyModuleLoader) { }

  /**
   * Lazy loads the InvoicesService from its module.
   * @returns a Promise resolving to the InvoicesService instance.
   */
  private async _loadInvoicesService(): Promise<InvoicesService> {
    if (!this._invoicesService) {
      const { InvoicesLazyModule } = await import("../../../invoices/lazy-invoices/invoices-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => InvoicesLazyModule);
      const { InvoicesService } = await import("../../../invoices/lazy-invoices/services/invoices.service");
      this._invoicesService = moduleRef.get<InvoicesService>(InvoicesService);
    }
    return this._invoicesService;
  }

  /**
   * Processes an event of the Sibill webhook, already verified.
   * @param event the event.
   */
  async processWebhookEvent(event: SibillDocumentUpdatedEvent): Promise<void> {
    if (event.event !== "document.updated" || !event.data?.id || !event.data.status) {
      this._logger.log(`Sibill event ${event.event} (${event.id}) ignored.`);
      return;
    }
    if (event.company_id !== process.env.SIBILL_COMPANY_ID) {
      this._logger.warn(`Sibill event ${event.id} belongs to company ${event.company_id}, not to the one of Rocket: ignored.`);
      return;
    }
    if (event.data.direction === "RECEIVED") {
      this._logger.log(`Sibill event ${event.id} is about a document Keus received: ignored.`);
      return;
    }

    const invoicesService = await this._loadInvoicesService();
    await invoicesService.recordDocumentStatus(event.data.id, event.data.status, event.data.updated_at, event.data.number, event.data.gross_amount?.amount);
  }
}
