import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseContractDto } from "./response-contract.dto";

/** One page of the contract listing. */
export class ResponseContractsPageDto extends PageOf(ResponseContractDto) {}
