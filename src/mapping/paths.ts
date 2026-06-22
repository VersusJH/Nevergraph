import type { JsonValue, JsonObject, ValueType } from "../types";

// ---------------------------------------------------------------------------
// Small value helpers shared by introspection and graph building. Fields are
// addressed by plain top-level keys (we keep arc arrays one level deep, which
// covers both example datasets and the common case); array element ids are
// addressed by a single nested key.
// ---------------------------------------------------------------------------

export function isPlainObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function valueTypeOf(v: JsonValue): ValueType {
  if (v === null) return "null";
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "mixed";
}

/** Render a scalar JSON value as a stable, comparable string. */
export function scalarToString(v: JsonValue): string {
  if (v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_NAME_RE = /(^id$|_id$|id$|^uuid$|guid|\bkey$)/i;

/** Does a single value look like an identifier reference? */
export function valueLooksLikeId(v: JsonValue): boolean {
  if (typeof v === "number") return Number.isInteger(v);
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s === "") return false;
  if (UUID_RE.test(s)) return true;
  if (/^\d+$/.test(s)) return true; // numeric-string ids ("1", "47")
  return false;
}

/** Does a field name suggest it holds an id? */
export function nameLooksLikeId(name: string): boolean {
  return ID_NAME_RE.test(name);
}

/** Read a top-level field value from a record. */
export function getField(record: JsonObject, path: string): JsonValue {
  return Object.prototype.hasOwnProperty.call(record, path)
    ? record[path]
    : null;
}
