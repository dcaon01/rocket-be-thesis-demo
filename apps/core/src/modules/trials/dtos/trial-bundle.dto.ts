import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNotEmpty, ValidateNested } from "class-validator";
import { TenantPayloadDto } from "../../tenants/dtos/tenant-payload.dto";
import { UserPayloadDto } from "../../users/dtos/user-payload.dto";
import { TrialPayloadDto } from "./trial-payload.dto";

/**
 * Bundle DTO for creating a trial with its associated tenant and user in a single operation.
 * Used by inbound SQS events to create all three entities in cascade:
 * trial → tenant (with trialId) → user (with tenant).
 * This approach is needed because otherwise we wouldn't be able to connect the tenant to the trial and the user to the tenant,
 * since we need the trialId and tenant respectively, which are generated upon creation.
 */
export class TrialBundleDto {
  /** Trial data. */
  @ApiProperty({
    description: "Trial data.",
    type: TrialPayloadDto,
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => TrialPayloadDto)
  trial: TrialPayloadDto;

  /** Tenant data. trialId will be auto-filled from the created trial. */
  @ApiProperty({
    description: "Tenant data. trialId will be auto-filled from the created trial.",
    type: TenantPayloadDto,
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => TenantPayloadDto)
  tenant: TenantPayloadDto;

  /** User data. tenant and tenantName will be auto-filled from the created tenant. */
  @ApiProperty({
    description: "User data. tenant and tenantName will be auto-filled from the created tenant.",
    type: UserPayloadDto,
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => UserPayloadDto)
  user: UserPayloadDto;
}
