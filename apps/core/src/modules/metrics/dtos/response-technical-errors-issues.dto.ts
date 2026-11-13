import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ResponseTechnicalErrorsIssueDto } from "./response-technical-errors-issue.dto";

/**
 * Response DTO for the issues of the products on Sentry in the current month (UR-RK-225): the ones with most error
 * events, and the link to their projects.
 */
export class ResponseTechnicalErrorsIssuesDto {
  /** Issues with most error events in the current month, the busiest first. */
  @ApiProperty({
    type: [ResponseTechnicalErrorsIssueDto],
    description: "Issues with most error events in the current month, the busiest first.",
    required: true,
  })
  @Type(() => ResponseTechnicalErrorsIssueDto)
  issues: ResponseTechnicalErrorsIssueDto[];

  /** Link to the issues of the products on Sentry, absent when no product has a project. */
  @ApiPropertyOptional({
    example: "https://de.sentry.io/organizations/keus/issues/?project=4511292228632656",
    description: "Link to the issues of the products on Sentry, absent when no product has a project.",
    required: false,
  })
  sentryUrl?: string;
}
