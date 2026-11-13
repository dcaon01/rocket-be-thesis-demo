import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseOrderDto } from "./response-order.dto";

/** One page of the orders listing. */
export class ResponseOrdersPageDto extends PageOf(ResponseOrderDto) {}
