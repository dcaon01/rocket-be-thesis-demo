import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsIn, IsISO8601, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";
import { ContractStatus } from "../enums/contract-status.enum";

/**
 * Query of the contract listing of a product: a page and its filters.
 * No status means every status.
 */
export class ContractsPageQueryDto extends PageQueryDto {
  /** Statuses to list, every status when absent. */
  @ApiPropertyOptional({
    description: "Statuses to list, every status when absent.",
    enum: ContractStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ContractStatus, { each: true })
  status?: ContractStatus[];

  /** Start of the contract code or company name, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the contract code or company name, case-insensitive.",
    example: "CTR-2026",
  })
  @IsOptional()
  @IsString()
  search?: string;

  /** Date the period applies to. */
  @ApiPropertyOptional({
    description: "Date the period applies to.",
    enum: ["startDate", "renewalDate", "terminationDate"],
  })
  @IsOptional()
  @IsIn(["startDate", "renewalDate", "terminationDate"])
  dateField?: "startDate" | "renewalDate" | "terminationDate";

  /** First instant of the period (ISO 8601). */
  @ApiPropertyOptional({
    description: "First instant of the period (ISO 8601).",
    example: "2026-10-01T00:00:00.000Z",
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Last instant of the period (ISO 8601). */
  @ApiPropertyOptional({
    description: "Last instant of the period (ISO 8601).",
    example: "2026-10-31T23:59:59.999Z",
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
