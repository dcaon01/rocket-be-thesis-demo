import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseResellerDto } from "./response-reseller.dto";

/** One page of the reseller listing. */
export class ResponseResellersPageDto extends PageOf(ResponseResellerDto) {}
