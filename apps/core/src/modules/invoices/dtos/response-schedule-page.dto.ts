import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseScheduleEntryDto } from "./response-schedule-entry.dto";

/** A page of a schedule, of Keus or of a reseller. */
export class ResponseSchedulePageDto extends PageOf(ResponseScheduleEntryDto) {}
