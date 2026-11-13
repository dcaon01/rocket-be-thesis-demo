import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose } from "class-transformer";
import { PendingOperationKind } from "../enums/pending-operation-kind.enum";
import { PendingOperationState } from "../enums/pending-operation-state.enum";

/**
 * DTO returned for an operation sent to a product, as a step in the history of its record.
 * The notification itself is left out: it carries the record's data, already on the record.
 */
export class ResponsePendingOperationDto {
  /** Identifier of the product the operation is sent to. */
  @ApiProperty({
    description: "Identifier of the product the operation is sent to.",
    example: "product-id-123",
    required: true,
  })
  @Expose()
  productId: string;

  /** Identifier of the operation, sent to the product as `rocketOperationId`. */
  @ApiProperty({
    description: "Identifier of the operation, sent to the product as rocketOperationId.",
    example: "operation-id-123",
    required: true,
  })
  @Expose()
  id: string;

  /** What the operation asks the product to do. */
  @ApiProperty({
    description: "What the operation asks the product to do.",
    enum: PendingOperationKind,
    example: PendingOperationKind.CreateTenant,
    required: true,
  })
  @Expose()
  kind: PendingOperationKind;

  /** Identifier of the record the operation targets. */
  @ApiProperty({
    description: "Identifier of the record the operation targets.",
    example: "tenant-id-123",
    required: true,
  })
  @Expose()
  targetId: string;

  /** State of the operation. */
  @ApiProperty({
    description: "State of the operation.",
    enum: PendingOperationState,
    example: PendingOperationState.Pending,
    required: true,
  })
  @Expose()
  state: PendingOperationState;

  /** Sendings made so far. */
  @ApiProperty({
    description: "Sendings made so far.",
    example: 2,
    required: true,
  })
  @Expose()
  attempts: number;

  /** When the operation is due to be sent again (ISO 8601), only while it is pending. */
  @ApiPropertyOptional({
    description: "When the operation is due to be sent again (ISO 8601), only while it is pending.",
    example: "2026-10-08T10:15:00.000Z",
    required: false,
  })
  @Expose()
  nextAttemptAt?: string;

  /** Error of the last failed attempt or of the product's answer. */
  @ApiPropertyOptional({
    description: "Error of the last failed attempt or of the product's answer.",
    example: "A user with this email already exists on another tenant",
    required: false,
  })
  @Expose()
  lastError?: string;

  /** Cognito sub of the operator who asked for the operation; absent when Rocket itself did. */
  @ApiPropertyOptional({
    description: "Cognito sub of the operator who asked for the operation; absent when Rocket itself did.",
    example: "cognito-sub-123",
    required: false,
  })
  @Expose()
  requestedBy?: string;

  /** Set on a change the product made on its own and told Rocket about. */
  @ApiPropertyOptional({
    description: "Set on a change the product made on its own and told Rocket about.",
    example: true,
    required: false,
  })
  @Expose()
  fromProduct?: boolean;

  /** Creation timestamp. */
  @ApiProperty({
    description: "Creation timestamp.",
    example: "2026-10-08T10:00:00.000Z",
    required: true,
  })
  @Expose()
  createdAt: string;

  /** Last update timestamp. */
  @ApiProperty({
    description: "Last update timestamp.",
    example: "2026-10-08T10:05:00.000Z",
    required: true,
  })
  @Expose()
  updatedAt: string;
}
