import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseOrderLineDto } from "./response-order-line.dto";

/** One page of order lines. */
export class ResponseOrderLinesPageDto extends PageOf(ResponseOrderLineDto) {}
