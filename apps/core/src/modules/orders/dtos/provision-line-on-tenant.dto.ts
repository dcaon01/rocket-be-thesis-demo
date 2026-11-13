import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

/**
 * DTO used by the back office to provision an order line on a tenant the product already has, such as the tenant of
 * a trial or of a terminated contract: no tenant nor user is asked to the product.
 */
export class ProvisionLineOnTenantDto {
  /** Identifier of the existing tenant, on the product of the line. */
  @ApiProperty({
    description: "Identifier of the existing tenant, on the product of the line.",
    example: "acme-srl",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  tenantId: string;
}
