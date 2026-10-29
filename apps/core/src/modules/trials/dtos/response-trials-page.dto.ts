import { PageOf } from "../../../commons/pagination/page-of.dto";
import { ResponseTrialDto } from "./response-trial.dto";

/** One page of the trial listing. */
export class ResponseTrialsPageDto extends PageOf(ResponseTrialDto) {}
