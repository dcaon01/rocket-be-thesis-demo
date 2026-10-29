import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseProductDto } from "./response-product.dto";

/** One page of the product listing. */
export class ResponseProductsPageDto extends PageOf(ResponseProductDto) {}
