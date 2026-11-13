import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseInvoiceDto } from "./response-invoice.dto";

/** One page of an invoice listing. */
export class ResponseInvoicesPageDto extends PageOf(ResponseInvoiceDto) {}
