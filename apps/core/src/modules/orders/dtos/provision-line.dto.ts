import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, ValidateNested } from "class-validator";
import { ProvisionTenantInput } from "../classes/provision-tenant-input.class";
import { ProvisionUserInput } from "../classes/provision-user-input.class";

/**
 * DTO used by the back office to provision an order line: the tenant and its first users.
 * At least the referent is required, at most as many users as the seats sold on the line.
 */
export class ProvisionLineDto {
  /** The tenant to create on the product. */
  @ApiProperty({
    description: "The tenant to create on the product.",
    type: ProvisionTenantInput,
    required: true,
  })
  @ValidateNested()
  @Type(() => ProvisionTenantInput)
  tenant: ProvisionTenantInput;

  /** The users to create on the tenant; the first is the referent. */
  @ApiProperty({
    description: "The users to create on the tenant; the first is the referent.",
    type: [ProvisionUserInput],
    required: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProvisionUserInput)
  users: ProvisionUserInput[];
}
