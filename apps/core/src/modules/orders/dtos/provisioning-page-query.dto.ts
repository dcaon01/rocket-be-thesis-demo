import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../../commons/pagination/page-query.dto";

/** Query of the provisioning queue: a page and its filters. */
export class ProvisioningPageQueryDto extends PageQueryDto {
  /** Product to list, every product when absent. */
  @ApiPropertyOptional({
    description: "Product to list, every product when absent.",
  })
  @IsOptional()
  @IsString()
  productId?: string;

  /** Start of the order code or company name, case-insensitive. */
  @ApiPropertyOptional({
    description: "Start of the order code or company name, case-insensitive.",
    example: "ORD-2026",
  })
  @IsOptional()
  @IsString()
  search?: string;
}
