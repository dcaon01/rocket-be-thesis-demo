import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseTenantDto } from "./response-tenant.dto";

/** One page of the tenant listing. */
export class ResponseTenantsPageDto extends PageOf(ResponseTenantDto) {}
