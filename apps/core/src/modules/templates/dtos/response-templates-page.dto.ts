import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseTemplateDto } from "./response-template.dto";

/** One page of templates. */
export class ResponseTemplatesPageDto extends PageOf(ResponseTemplateDto) {}
