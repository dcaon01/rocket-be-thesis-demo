import type { Schema } from "dynamoose/dist/Schema";
import { RequestScope } from "@rocket-be/scoping";
import { BusinessException } from "../../errors/exception-types";

/** An update split into the attributes to write and the ones to remove. */
export type RemovableUpdate<T> = { set: Partial<T>; remove: string[] };

/**
 * Splits an update into the attributes to write and the ones to remove.
 *   - an absent or undefined key leaves the attribute untouched;
 *   - a null key means the user cleared the field, so the attribute is removed;
 *   - any other value is written.
 * Internal paths (system scope) keep dropping their nulls, which there mean
 * "not provided" (HubSpot deals, SQS payloads, batch updates). The split is
 * shallow: nulls nested in objects and arrays are data and are written as they are.
 * @param update the update, already stripped of the class identity.
 * @param schema the Dynamoose schema of the entity, which tells the required attributes.
 * @param entityName the entity name for the error message.
 * @param scope the request scope; the system scope drops the nulls instead of removing.
 * @returns the attributes to write and the names of the ones to remove.
 * @throws BusinessException when a null targets a key or a required attribute.
 */
export function splitRemovals<T extends object>(
  update: T,
  schema: Schema,
  entityName: string,
  scope?: RequestScope,
): RemovableUpdate<T> {
  const set: Partial<T> = {};
  const remove: string[] = [];

  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if (value !== null) {
      set[key as keyof T] = value as T[keyof T];
      continue;
    }
    if (scope?.system === true) continue;

    if (key === schema.hashKey || key === schema.rangeKey || schema.getAttributeSettingValue("required", key) === true) {
      throw new BusinessException(
        `The field "${key}" of the ${entityName} is required and cannot be cleared.`,
        "REQUIRED_FIELD_CLEARED",
        { field: key }
      );
    }
    remove.push(key);
  }

  return { set, remove };
}

/**
 * Returns a copy of an object without the given keys, used to see an entity as
 * it will be once the removed attributes are gone.
 * @param object the object to copy.
 * @param keys the keys to leave out.
 * @returns the copy without those keys.
 */
export function withoutKeys<T extends object>(object: T, keys: string[]): T {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key))) as T;
}

/**
 * Builds the Dynamoose update object of a split update: Dynamoose accepts
 * `$REMOVE` next to the values, but its typings do not declare it.
 * @param set the attributes to write.
 * @param remove the attributes to remove.
 * @returns the update object.
 */
export function toDynamooseUpdate<T>(set: Partial<T>, remove: string[]): Partial<T> {
  return remove.length > 0 ? ({ ...set, $REMOVE: remove } as Partial<T>) : set;
}
