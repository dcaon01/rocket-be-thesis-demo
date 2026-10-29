import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { UserStatus } from "../enums/user-status.enum";

/**
 * Query of the user listing of a product: a page and its filters.
 * No status means every status.
 */
export class UsersPageQueryDto extends PageQueryDto {
  /** Statuses to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Statuses to list, every status when absent.",
    enum: UserStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(UserStatus, { each: true })
  status?: UserStatus[];

  /** Start of the user name, surname or email, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the user name, surname or email, case-insensitive.",
    example: "Mario",
  })
  @IsOptional()
  @IsString()
  search?: string;

  /** Start of the tenant name, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the tenant name, case-insensitive.",
    example: "Acme",
  })
  @IsOptional()
  @IsString()
  tenantName?: string;
}
