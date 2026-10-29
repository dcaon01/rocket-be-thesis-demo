import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsObject, IsOptional, IsString, ValidateNested } from "class-validator";
import { UserStatus } from "../enums/user-status.enum";
import { UserAttributeDto } from "../classes/user-attribute.class";

/**
 * Update DTO for user operations.
 */
export class UpdateUserDto {
  /** The name of the tenant. */
  @ApiPropertyOptional({
    example: "tenant123",
    description: "The name of the tenant.",
  })
  @IsOptional()
  @IsString()
  tenantName?: string;

  /** The first name of the user. */
  @ApiPropertyOptional({
    example: "John",
    description: "The first name of the user.",
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  /** Roles the user belongs to in Cognito. */
  @ApiPropertyOptional({
    example: ["admin", "users"],
    description: "Roles the user belongs to in Cognito.",
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  roles?: string[];

  /** The surname of the user. */
  @ApiPropertyOptional({
    example: "Doe",
    description: "The surname of the user.",
    required: false,
  })
  @IsOptional()
  @IsString()
  surname?: string;



  /** The status of the user. */
  @ApiPropertyOptional({
    example: "ACTIVE",
    description: "The status of the user.",
    required: false,
    enum: UserStatus,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  /** The previous status of the user before the tenant deactivation. */
  @ApiPropertyOptional({
    example: "INACTIVE",
    description: "The previous status of the user before the tenant deactivation.",
    required: false,
    enum: UserStatus,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  prevStatus?: UserStatus;

  /** Additional custom attributes for the user. */
  @ApiPropertyOptional({
    description: 'Additional custom attributes for the user',
    type: [UserAttributeDto]
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => UserAttributeDto)
  customAttributes?: UserAttributeDto[];

  /** Object containing the user information structured as indicated in the product's userStructure. */
  @ApiPropertyOptional({
    example: { name: "John", age: 30 },
    description: "Object containing the user information structured as indicated in the product's userStructure.",
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, any>;

  /** Whether the user is the referent of its tenant, who accepts the contract: the product keeps one per tenant. */
  @ApiPropertyOptional({
    example: true,
    description: "Whether the user is the referent of its tenant, who accepts the contract: the product keeps one per tenant.",
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  referent?: boolean;
}
