import { BadRequestException } from "@nestjs/common";
import { ObjectType } from "dynamoose/dist/General";

/**
 * Cursor pagination over DynamoDB, the same rules as the lists of core (`apps/core/src/commons/pagination`): the
 * two functions share no library, so the part the collaborators list needs is copied here, as the S3 code is.
 *
 * DynamoDB applies `Limit` before any filter, so a page is read in blocks, keeping the items the predicate accepts,
 * until it holds one item more than asked or the partition ends. The cursor is rebuilt from the key attributes of the
 * last item returned (table key plus index key), so it points exactly where the next page starts.
 */

/** Smallest block read when a predicate may discard items. */
const MIN_FILTERED_BLOCK = 100;

/** A Dynamoose query or scan, rebuilt for every block because `limit` and `startAt` change it. */
export interface PageSource<T> {
  limit(value: number): PageSource<T>;
  startAt(key: ObjectType): PageSource<T>;
  exec(): Promise<T[] & { lastKey?: ObjectType }>;
}

/** One page of items and the cursor of the next one. */
export interface Page<T> {
  /** Items of the page. */
  items: T[];
  /** Cursor of the next page, absent on the last one. */
  nextCursor?: string;
}

/**
 * Reads one page of a single query or scan.
 * @param build builds the query or scan to read.
 * @param keys the key attributes of the table and of the index read.
 * @param limit the page size.
 * @param cursor the cursor of the page, absent for the first one.
 * @param accept the filters of the list, absent when every item counts.
 * @returns the page and the cursor of the next one.
 * @throws BadRequestException if the cursor cannot be read.
 */
export async function paginate<T>(
  build: () => PageSource<T>,
  keys: string[],
  limit: number,
  cursor: string | undefined,
  accept?: (item: T) => boolean,
): Promise<Page<T>> {
  const block = accept ? Math.max(limit + 1, MIN_FILTERED_BLOCK) : limit + 1;
  const items: T[] = [];
  let key = _decodeCursor(cursor, keys);

  do {
    const source = build().limit(block);
    const result = await (key ? source.startAt(key) : source).exec();
    for (const item of result) {
      if (accept && !accept(item)) {
        continue;
      }
      items.push(item);
      if (items.length > limit) {
        return { items: items.slice(0, limit), nextCursor: _encodeCursor(_keyOf(items[limit - 1], keys)) };
      }
    }
    key = result.lastKey;
  } while (key);

  return { items };
}

/**
 * Encodes a key as an opaque cursor.
 * @param key the key to resume from.
 * @returns the cursor.
 */
function _encodeCursor(key: ObjectType): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

/**
 * Decodes a cursor back into the key it carries, checking that it holds exactly the key attributes of the list: a
 * cursor of another list, or edited by hand, would otherwise reach DynamoDB and fail there.
 * @param cursor the cursor, absent for the first page.
 * @param keys the key attributes of the table and of the index read.
 * @returns the key, or undefined for the first page.
 * @throws BadRequestException if the cursor cannot be read or does not fit the list.
 */
function _decodeCursor(cursor: string | undefined, keys: string[]): ObjectType | undefined {
  if (!cursor) {
    return undefined;
  }

  let key: unknown;
  try {
    key = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new BadRequestException("The page cursor is not valid.");
  }

  const record = key as Record<string, unknown>;
  const fits = !!key && typeof key === "object" && !Array.isArray(key)
    && Object.keys(record).length === keys.length
    && keys.every(attribute => typeof record[attribute] === "string" || typeof record[attribute] === "number");
  if (!fits) {
    throw new BadRequestException("The page cursor is not valid.");
  }
  return key as ObjectType;
}

/**
 * Picks the key attributes of an item, to resume right after it.
 * @param item the item.
 * @param keys the key attributes of the table and of the index read.
 * @returns the key of the item.
 */
function _keyOf<T>(item: T, keys: string[]): ObjectType {
  const record = item as unknown as Record<string, unknown>;
  return Object.fromEntries(keys.map(key => [key, record[key]])) as ObjectType;
}
