/**
 * Brings a VAT number to the 11 digits that are stored: spaces and the `IT` prefix are dropped.
 * A blank value counts as not sent: only `null` clears the field.
 * @param value the value sent by the client.
 * @returns the normalized VAT number, or the value itself when it is not a string.
 */
export function normalizeVatNumber({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? compact(value).replace(/^IT/, "") || undefined : value;
}

/**
 * Brings an SDI recipient code to the form that is stored: no spaces, upper case.
 * A blank value counts as not sent: only `null` clears the field.
 * @param value the value sent by the client.
 * @returns the normalized SDI code, or the value itself when it is not a string.
 */
export function normalizeSdi({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? compact(value) || undefined : value;
}

/**
 * Drops the spaces of a fiscal identifier and brings it to upper case.
 * @param value the identifier as sent.
 * @returns the compacted identifier.
 */
function compact(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}
