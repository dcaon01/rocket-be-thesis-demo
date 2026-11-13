import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseResellerContractDto } from "./response-reseller-contract.dto";

/** One page of the reseller contract listing. */
export class ResponseResellerContractsPageDto extends PageOf(ResponseResellerContractDto) {}
