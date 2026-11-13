import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

/**
 * Error a product answers with when it could not carry out a request of Rocket, on a user or a tenant.
 * Rocket fails the pending operation with its message, which may come empty when the error of the product had none.
 */
export class ProductError {
  /** Code of the error, chosen by the product. */
  @ApiProperty({
    description: "Code of the error, chosen by the product.",
    example: "DUPLICATE_EMAIL",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  code: string;

  /** Message of the error, readable by a person; empty when the product had none. */
  @ApiProperty({
    description: "Message of the error, readable by a person; empty when the product had none.",
    example: "A user with this email already exists.",
    required: true,
  })
  @IsString()
  message: string;
}
