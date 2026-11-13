import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsNotEmpty, IsObject, IsString } from "class-validator";
import { RecipientTypeEnum } from "../enums/recipient-type.enum";
import { ProductMessageTemplate } from "../enums/product-message-template.enum";

/**
 * Payload object carried inside a RocketNotificationDto of type MESSAGE.
 * Rocket delegates the actual email delivery to the receiving product: it
 * simply forwards a message, and the product uses its own mail service.
 */
export class MessagePayloadDto {
  /** Whether the message is addressed to a user or a tenant. */
  @ApiProperty({
    description: "Whether the message is addressed to a user or a tenant.",
    enum: RecipientTypeEnum,
    example: RecipientTypeEnum.User,
  })
  @IsNotEmpty()
  @IsEnum(RecipientTypeEnum)
  recipientType: RecipientTypeEnum;

  /**
   * The recipient identifier. The user's email when `recipientType` is USER;
   * the tenant identifier when TENANT: the product writes to the tenant and to its referent.
   */
  @ApiProperty({
    description:
      "The recipient identifier: user email when recipientType is USER, tenant identifier when TENANT (the product writes to the tenant and to its referent).",
    example: "user@example.com",
  })
  @IsNotEmpty()
  @IsString()
  to: string;

  /** The subject of the message. */
  @ApiProperty({
    description: "The subject of the message.",
    example: "Your subscription is about to expire",
  })
  @IsNotEmpty()
  @IsString()
  subject: string;

  /**
   * Template identifier the product should use to render the email.
   * Rocket only forwards data: the product owns the actual copy and layout.
   */
  @ApiProperty({
    description:
      "Template identifier the receiving product should use to render the email.",
    enum: ProductMessageTemplate,
    example: ProductMessageTemplate.TrialResidue,
  })
  @IsNotEmpty()
  @IsEnum(ProductMessageTemplate)
  template!: ProductMessageTemplate;

  /**
   * Free-form data object passed to the template (e.g. `message`, `days`).
   * The product extracts only the variables it needs.
   */
  @ApiProperty({
    description:
      "Free-form data object passed to the template (e.g. message, days).",
    example: {
      message: "Grazie per aver scelto Nquadro! Il tuo trial è stato attivato!",
      days: 14,
    },
  })
  @IsNotEmpty()
  @IsObject()
  body: Record<string, unknown>;
}
