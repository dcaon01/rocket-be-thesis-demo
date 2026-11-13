import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseCompanyDto } from "./response-company.dto";

/** One page of the company listing. */
export class ResponseCompaniesPageDto extends PageOf(ResponseCompanyDto) {}
