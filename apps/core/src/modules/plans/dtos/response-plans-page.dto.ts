import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponsePlanDto } from "./response-plan.dto";

/** One page of the plan listing. */
export class ResponsePlansPageDto extends PageOf(ResponsePlanDto) {}
