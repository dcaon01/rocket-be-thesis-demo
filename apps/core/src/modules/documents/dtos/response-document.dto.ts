import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose } from "class-transformer";
import { DocumentOwnerType } from "../enums/document-owner-type.enum";
import { DocumentType } from "../enums/document-type.enum";

/**
 * DTO returned for a stored document.
 */
export class ResponseDocumentDto {
  /** Identifier of the document. */
  @ApiProperty({
    description: "Identifier of the document.",
    example: "doc-id-123",
    required: true,
  })
  @Expose()
  id: string;

  /** Kind of entity the document is attached to. */
  @ApiProperty({
    description: "Kind of entity the document is attached to.",
    enum: DocumentOwnerType,
    required: true,
  })
  @Expose()
  ownerType: DocumentOwnerType;

  /** Identifier of the owner. */
  @ApiProperty({
    description: "Identifier of the owner.",
    example: "company-id-123",
    required: true,
  })
  @Expose()
  ownerId: string;

  /** Business type of the document. */
  @ApiProperty({
    description: "Business type of the document.",
    enum: DocumentType,
    required: true,
  })
  @Expose()
  type: DocumentType;

  /** Display name of the document. */
  @ApiProperty({
    description: "Display name of the document.",
    example: "Contratto quadro firmato",
    required: true,
  })
  @Expose()
  name: string;

  /** S3 key of the stored file. */
  @ApiProperty({
    description: "S3 key of the stored file.",
    example: "documents/COMPANY/company-id-123/doc-id.pdf",
    required: true,
  })
  @Expose()
  fileS3Key: string;

  /** MIME type of the file. */
  @ApiPropertyOptional({
    description: "MIME type of the file.",
    example: "application/pdf",
    required: false,
  })
  @Expose()
  contentType?: string;

  /** Whether the upload has been confirmed. */
  @ApiProperty({
    description: "Whether the upload has been confirmed.",
    example: true,
    required: true,
  })
  @Expose()
  uploaded: boolean;

  /** Reference to the entity the document belongs to. */
  @ApiPropertyOptional({
    description: "Reference to the entity the document belongs to.",
    example: "contract-id-123",
    required: false,
  })
  @Expose()
  refId?: string;
}
