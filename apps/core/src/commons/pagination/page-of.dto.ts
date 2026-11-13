import { Type } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Builds the response class of a paginated list of `itemType`.
 * Each list declares its own subclass, so Swagger gives it a name:
 * `class ResponseOrdersPageDto extends PageOf(ResponseOrderDto) {}`.
 * @param itemType the DTO of a single item.
 * @returns the page class for that item.
 */
export function PageOf<T>(itemType: Type<T>) {
  /** One page of a list. */
  abstract class PageDto {
    /** Items of the page. */
    @ApiProperty({
      description: "Items of the page.",
      type: [itemType],
      required: true,
    })
    items: T[];

    /** Cursor of the next page, absent on the last one. */
    @ApiPropertyOptional({
      description: "Cursor of the next page, absent on the last one.",
    })
    nextCursor?: string;
  }
  return PageDto;
}
