import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

/**
 * DTO used to record the acceptance of the offer.
 */
export class AcceptOrderDto {
  /** S3 key of the signed offer, uploaded as ORDER_SIGNED_OFFER. */
  @ApiProperty({
    description: "S3 key of the signed offer, uploaded as ORDER_SIGNED_OFFER.",
    example: "orders/order-id-123/signed-offer.pdf",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  signedOfferS3Key: string;
}
