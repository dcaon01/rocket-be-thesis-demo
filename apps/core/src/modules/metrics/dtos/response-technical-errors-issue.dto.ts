import { ApiProperty } from "@nestjs/swagger";
import { SentryIssueLevel } from "../../sentry/enums/sentry-issue-level.enum";

/**
 * An issue of a product on Sentry with its error events in the current month, never written to Rocket: its title can
 * carry personal data.
 */
export class ResponseTechnicalErrorsIssueDto {
  /** Identifier of the product the issue belongs to. */
  @ApiProperty({
    example: "product123",
    description: "Identifier of the product the issue belongs to.",
    required: true,
  })
  productId: string;

  /** Title of the issue, as Sentry shows it. */
  @ApiProperty({
    example: "TypeError: Cannot read properties of undefined",
    description: "Title of the issue, as Sentry shows it.",
    required: true,
  })
  title: string;

  /** Level of the issue. */
  @ApiProperty({
    enum: SentryIssueLevel,
    example: SentryIssueLevel.Error,
    description: "Level of the issue.",
    required: true,
  })
  level: SentryIssueLevel;

  /** Error events of the issue in the current month. */
  @ApiProperty({
    example: 42,
    description: "Error events of the issue in the current month.",
    required: true,
  })
  events: number;

  /** Moment of the last error event of the issue in the current month (ISO string). */
  @ApiProperty({
    example: "2026-10-21T08:15:00.000Z",
    description: "Moment of the last error event of the issue in the current month (ISO string).",
    required: true,
  })
  lastSeen: string;

  /** Link that opens the issue on Sentry. */
  @ApiProperty({
    example: "https://de.sentry.io/organizations/keus/issues/123456789/",
    description: "Link that opens the issue on Sentry.",
    required: true,
  })
  url: string;
}
