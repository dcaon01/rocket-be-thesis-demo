import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

/** Page sizes a list accepts, the same the frontend offers. */
export const PAGE_SIZES = [10, 20, 50, 100];

/** Page size of a request that does not ask for one. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Body of a paginated list search: the page size and where to resume.
 * Each list extends it with its own filters.
 */
export class PageQueryDto {
  /** Number of items per page, 20 when absent. */
  @ApiPropertyOptional({
    example: 20,
    description: "Number of items per page: 10, 20, 50 or 100; 20 when absent.",
    type: Number,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(PAGE_SIZES)
  limit: number = DEFAULT_PAGE_SIZE;

  /** Opaque cursor returned by the previous page, absent for the first one. */
  @ApiPropertyOptional({
    description: "Opaque cursor returned by the previous page, absent for the first one.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cursor?: string;
}
