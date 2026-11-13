import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseMaterialDto } from "./response-material.dto";

/** One page of materials. */
export class ResponseMaterialsPageDto extends PageOf(ResponseMaterialDto) {}
