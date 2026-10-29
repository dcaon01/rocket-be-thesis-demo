import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseUserDto } from "./response-user.dto";

/** One page of the user listing. */
export class ResponseUsersPageDto extends PageOf(ResponseUserDto) {}
