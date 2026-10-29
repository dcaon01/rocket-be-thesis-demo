import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { DocumentOwnerType } from "../enums/document-owner-type.enum";
import { DocumentType } from "../enums/document-type.enum";

/**
 * DTO used to register a document against its owner.
 */
export class CreateDocumentDto {
  /** Kind of entity the document is attached to. */
  @ApiProperty({
    description: "Kind of entity the document is attached to.",
    enum: DocumentOwnerType,
    required: true,
  })
  @IsEnum(DocumentOwnerType)
  ownerType: DocumentOwnerType;

  /** Identifier of the owner: company id, reseller code or order id. */
  @ApiProperty({
    description: "Identifier of the owner.",
    example: "company-id-123",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  ownerId: string;

  /** Business type of the document. */
  @ApiProperty({
    description: "Business type of the document.",
    enum: DocumentType,
    required: true,
  })
  @IsEnum(DocumentType)
  type: DocumentType;

  /** Display name of the document. */
  @ApiProperty({
    description: "Display name of the document.",
    example: "Contratto quadro firmato",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  /** S3 key of the stored file. */
  @ApiProperty({
    description: "S3 key of the stored file.",
    example: "documents/COMPANY/company-id-123/doc-id.pdf",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  fileS3Key: string;

  /** MIME type of the file. */
  @ApiPropertyOptional({
    description: "MIME type of the file.",
    example: "application/pdf",
    required: false,
  })
  @IsOptional()
  @IsString()
  contentType?: string;

  /** Reference to the entity the document belongs to, when it is not the owner. */
  @ApiPropertyOptional({
    description: "Reference to the entity the document belongs to.",
    example: "contract-id-123",
    required: false,
  })
  @IsOptional()
  @IsString()
  refId?: string;

  /** Materialized reseller lineage of the owner, for the reseller scoping. */
  @ApiPropertyOptional({
    description: "Materialized reseller lineage of the owner.",
    example: "RVD-001#",
    required: false,
  })
  @IsOptional()
  @IsString()
  resellerPath?: string;
}
