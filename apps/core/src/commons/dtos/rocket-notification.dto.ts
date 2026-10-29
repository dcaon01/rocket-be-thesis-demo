import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { EntityTypeEnum } from "../enums/entity-type.enum";
import { OperationEnum } from "../enums/operation.enum";

/**
 * Data Transfer Object for Rocket Notification.
 * Useful for sending notifications from Rocket to the products
 * and vice versa.
 */
export class RocketNotificationDto {
  /** The identifier of the product. */
  @ApiProperty({
    description: "The identifier of the product.",
    example: "product_12345",
  })
  @IsNotEmpty()
  @IsString()
  productId: string;

  /** The operation type of the notification */
  @ApiProperty({
    description: "The operation type of the notification",
    example: OperationEnum.Create,
  })
  @IsNotEmpty()
  @IsEnum(OperationEnum)
  operation: OperationEnum;

  /** The entities type trasported in the payload */
  @ApiProperty({
    description: "The entities type trasported in the payload",
    example: "user",
  })
  @IsOptional()
  @IsEnum(EntityTypeEnum)
  entityType?: EntityTypeEnum;

  /** The payload of the notification */
  @ApiProperty({
    description: "The payload of the notification",
    example: [{ userId: "12345", action: "login" }],
    type: [Object],
  })
  @IsNotEmpty()
  @IsArray()
  payload: object[];
}
