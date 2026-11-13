import { ObjectType } from "dynamoose/dist/General";
import { ValidationException } from "../../errors/exception-types";

/**
 * Cursor pagination over DynamoDB, the rules every list follows.
 *
 * DynamoDB applies `Limit` before any filter, so a filtered page read in one go
 * can come back short or empty while matches wait further on. A page is read
 * in blocks instead, keeping the items the predicate accepts, until it holds
 * one item more than asked or the partition ends: the extra item only proves
 * that a next page exists. The cursor is rebuilt from the key attributes of the
 * last item returned (table key plus index key, all projected), so it points
 * exactly where the next page starts.
 *
 * Filters live in the predicate and not in a FilterExpression: DynamoDB bills
 * the filtered-out items anyway, and in JS the text compares case-insensitively.
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

/** One partition read by `paginateMerged`. */
export interface PagePartition<T> {
  /** Stable name of the partition inside the cursor (e.g. the status). */
  id: string;
  /** Builds the query of the partition. */
  build: () => PageSource<T>;
}

/** Items read from one partition and the key to resume it, absent when nothing is left. */
interface PartitionRead<T> {
  items: T[];
  lastKey?: ObjectType;
}

/**
 * Reads one page of a single query or scan.
 * @param build builds the query or scan to read.
 * @param keys the key attributes of the table and of the index read.
 * @param limit the page size.
 * @param cursor the cursor of the page, absent for the first one.
 * @param accept the filters of the list, absent when every item counts.
 * @returns the page and the cursor of the next one.
 * @throws ValidationException if the cursor cannot be read.
 */
export async function paginate<T>(
  build: () => PageSource<T>,
  keys: string[],
  limit: number,
  cursor: string | undefined,
  accept?: (item: T) => boolean,
): Promise<Page<T>> {
  const read = await _readPartition(build, keys, limit, decodeCursor(cursor), accept);
  return { items: read.items, nextCursor: read.lastKey ? encodeCursor(read.lastKey) : undefined };
}

/**
 * Reads one page out of several partitions, merged in the order of `compare`.
 * Each partition reads a page of its own; the merge keeps the first `limit`
 * items, and the cursor remembers where each partition stopped (null once it
 * is exhausted). A page costs up to one page per partition.
 * @param partitions the partitions to merge, each sorted like `compare`.
 * @param keys the key attributes of the table and of the index read.
 * @param compare the order of the merged page.
 * @param limit the page size.
 * @param cursor the cursor of the page, absent for the first one.
 * @param accept the filters of the list, absent when every item counts.
 * @returns the page and the cursor of the next one.
 * @throws ValidationException if the cursor cannot be read.
 */
export async function paginateMerged<T>(
  partitions: PagePartition<T>[],
  keys: string[],
  compare: (a: T, b: T) => number,
  limit: number,
  cursor: string | undefined,
  accept?: (item: T) => boolean,
): Promise<Page<T>> {
  const state = (decodeCursor(cursor) ?? {}) as Record<string, ObjectType | null>;
  if (Object.values(state).some(key => key !== null && (typeof key !== "object" || Array.isArray(key)))) {
    throw new ValidationException("The page cursor is not valid.", [{ field: "cursor" }]);
  }
  const open = partitions.filter(partition => state[partition.id] !== null);
  const reads = await Promise.all(open.map(partition =>
    _readPartition(partition.build, keys, limit, state[partition.id] ?? undefined, accept),
  ));

  const merged = reads
    .flatMap((read, index) => read.items.map(item => ({ item, index })))
    .sort((a, b) => compare(a.item, b.item))
    .slice(0, limit);

  const next: Record<string, ObjectType | null> = {};
  for (const partition of partitions) {
    const index = open.indexOf(partition);
    const read = reads[index];
    const taken = merged.filter(entry => entry.index === index).map(entry => entry.item);
    if (!read) {
      next[partition.id] = null;
    } else if (taken.length === read.items.length) {
      next[partition.id] = read.lastKey ?? null;
    } else if (taken.length > 0) {
      next[partition.id] = _keyOf(taken[taken.length - 1], keys);
    } else {
      // Nothing taken: the partition resumes where it was, an empty key meaning its start.
      next[partition.id] = state[partition.id] ?? {};
    }
  }

  const more = Object.values(next).some(key => key !== null);
  return { items: merged.map(entry => entry.item), nextCursor: more ? encodeCursor(next) : undefined };
}

/**
 * Cuts one page out of a list read whole and kept in memory, such as a schedule merged from several sources: the
 * entries are ordered by due date, then by key, and the cursor holds the due date and the key of the last one.
 * @param entries the entries, unsorted.
 * @param limit the page size.
 * @param cursor the cursor of the page, absent for the first one.
 * @param descending whether the latest due date comes first.
 * @returns the page and the cursor of the next one.
 * @throws ValidationException if the cursor is not valid.
 */
export function pageByDueDate<T extends { dueDate: string; key: string }>(
  entries: T[],
  limit: number,
  cursor: string | undefined,
  descending = false,
): Page<T> {
  const after = decodeCursor(cursor);
  if (after && (typeof after.dueDate !== "string" || typeof after.key !== "string")) {
    throw new ValidationException("The page cursor is not valid.", [{ field: "cursor" }]);
  }

  const byDueDate = (a: { dueDate: string; key: string }, b: { dueDate: string; key: string }): number =>
    (a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key)) * (descending ? -1 : 1);
  const sorted = [...entries]
    .sort(byDueDate)
    .filter(entry => !after || byDueDate(entry, after as { dueDate: string; key: string }) > 0);

  const items = sorted.slice(0, limit);
  const last = items[items.length - 1];
  return { items, ...(sorted.length > limit && last && { nextCursor: encodeCursor({ dueDate: last.dueDate, key: last.key }) }) };
}

/**
 * Normalizes a text for a prefix search: lowercase, without accents nor punctuation, single spaces. The same form is
 * stored as the sort key of the indexes searched by name, such as `normalizedName` on companies.
 * @param text the text.
 * @returns the normalized text, empty when nothing searchable is left.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds the stored sort key of a text searched by prefix: its normalized form, or the text in lowercase when nothing
 * searchable is left (a name made of symbols), since DynamoDB refuses an empty string as the key of an index.
 * @param text the text.
 * @returns the key, never empty for a non-empty text.
 */
export function searchKeyOf(text: string): string {
  return normalizeSearchText(text) || text.toLowerCase();
}

/**
 * Tells whether any of the values starts with the searched text, both normalized by `normalizeSearchText`.
 * @param search the searched text, empty or absent when there is no search.
 * @param values the values the search covers.
 * @returns true when there is no search or a value starts with it.
 */
export function startsWithAny(search: string | undefined, ...values: (string | undefined)[]): boolean {
  const prefix = search ? normalizeSearchText(search) : "";
  return !prefix || values.some(value => value !== undefined && normalizeSearchText(value).startsWith(prefix));
}

/**
 * Tells whether a date falls in a period; with no bound every item passes, with
 * a bound an item without the date does not.
 * @param value the date of the item, a timestamp or a day.
 * @param from the first instant of the period (ISO 8601), optional.
 * @param to the last instant of the period (ISO 8601), optional.
 * @returns true when there is no period or the date falls in it.
 */
export function isWithin(value: string | Date | undefined, from: string | undefined, to: string | undefined): boolean {
  if (!from && !to) {
    return true;
  }
  if (!value) {
    return false;
  }
  const time = new Date(value).getTime();
  return (!from || time >= new Date(from).getTime()) && (!to || time <= new Date(to).getTime());
}

/**
 * Encodes a key, or a set of keys, as an opaque cursor.
 * @param key the key to resume from.
 * @returns the cursor.
 */
export function encodeCursor(key: object): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

/**
 * Decodes a cursor back into the key it carries.
 * @param cursor the cursor, absent for the first page.
 * @returns the key, or undefined for the first page.
 * @throws ValidationException if the cursor cannot be read.
 */
export function decodeCursor(cursor: string | undefined): ObjectType | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const key: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (key && typeof key === "object" && !Array.isArray(key)) {
      return key as ObjectType;
    }
  } catch {
    // Falls through to the validation error below.
  }

  throw new ValidationException("The page cursor is not valid.", [{ field: "cursor" }]);
}

/**
 * Reads the items of one partition, in blocks, until one more than the page
 * size is accepted or the partition ends.
 * @param build builds the query or scan to read.
 * @param keys the key attributes of the table and of the index read.
 * @param limit the page size.
 * @param startKey the key to resume from, absent (or empty) from the start.
 * @param accept the filters of the list, absent when every item counts.
 * @returns at most `limit` items, and the key of the last one when more follow.
 */
async function _readPartition<T>(
  build: () => PageSource<T>,
  keys: string[],
  limit: number,
  startKey: ObjectType | undefined,
  accept?: (item: T) => boolean,
): Promise<PartitionRead<T>> {
  const block = accept ? Math.max(limit + 1, MIN_FILTERED_BLOCK) : limit + 1;
  const items: T[] = [];
  let key = startKey && Object.keys(startKey).length > 0 ? _checkedKey(startKey, keys) : undefined;
  do {
    const source = build().limit(block);
    const result = await (key ? source.startAt(key) : source).exec();
    for (const item of result) {
      if (accept && !accept(item)) {
        continue;
      }
      items.push(item);
      if (items.length > limit) {
        return { items: items.slice(0, limit), lastKey: _keyOf(items[limit - 1], keys) };
      }
    }
    key = result.lastKey;
  } while (key);
  return { items };
}

/**
 * Checks that a key read from a cursor carries exactly the key attributes of
 * the list, as strings or numbers: a cursor of another list, or edited by
 * hand, would otherwise reach DynamoDB and fail there.
 * @param key the key read from the cursor.
 * @param keys the key attributes of the table and of the index read.
 * @returns the key.
 * @throws ValidationException if the key does not fit the list.
 */
function _checkedKey(key: ObjectType, keys: string[]): ObjectType {
  const attributes = Object.keys(key);
  const fits = attributes.length === keys.length
    && keys.every(attribute => typeof key[attribute] === "string" || typeof key[attribute] === "number");
  if (!fits) {
    throw new ValidationException("The page cursor is not valid.", [{ field: "cursor" }]);
  }
  return key;
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
