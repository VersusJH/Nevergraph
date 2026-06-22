import type {
  ArrayElementKey,
  CollectionCatalog,
  DatasetCatalog,
  FieldInfo,
  FieldKind,
  JsonObject,
  JsonValue,
  ValueType,
} from "../types";
import {
  isPlainObject,
  nameLooksLikeId,
  scalarToString,
  valueLooksLikeId,
  valueTypeOf,
} from "../mapping/paths";

const DISTINCT_CAP = 5000;
const SAMPLE_CAP = 12;

// --------------------------- scalar accumulator ---------------------------

interface ScalarStats {
  count: number;
  typeCounts: Map<ValueType, number>;
  distinct: Set<string>;
  capped: boolean;
  idLike: number;
  strLenSum: number;
  strCount: number;
}

function newScalarStats(): ScalarStats {
  return {
    count: 0,
    typeCounts: new Map(),
    distinct: new Set(),
    capped: false,
    idLike: 0,
    strLenSum: 0,
    strCount: 0,
  };
}

function addScalar(s: ScalarStats, v: JsonValue): void {
  s.count++;
  const t = valueTypeOf(v);
  s.typeCounts.set(t, (s.typeCounts.get(t) ?? 0) + 1);
  if (s.distinct.size < DISTINCT_CAP) s.distinct.add(scalarToString(v));
  else s.capped = true;
  if (valueLooksLikeId(v)) s.idLike++;
  if (typeof v === "string") {
    s.strLenSum += v.length;
    s.strCount++;
  }
}

function dominantType(s: ScalarStats): ValueType {
  let best: ValueType = "null";
  let bestN = -1;
  for (const [t, n] of s.typeCounts) {
    if (t === "null") continue;
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  return bestN < 0 ? "null" : best;
}

function samplesOf(s: ScalarStats): string[] {
  const out: string[] = [];
  for (const v of s.distinct) {
    out.push(v.length > 80 ? v.slice(0, 77) + "…" : v);
    if (out.length >= SAMPLE_CAP) break;
  }
  return out;
}

// ---------------------------- field accumulator ---------------------------

interface FieldAgg {
  path: string;
  present: number;
  kindCounts: Map<FieldKind, number>;
  scalar: ScalarStats;
  arrLenSum: number;
  arrCount: number;
  arrMin: number;
  arrMax: number;
  arrEmpty: number; // arrays observed with zero elements (kind-neutral)
  arrScalar: ScalarStats; // stats over scalar-array elements
  elemKeys: Map<string, ScalarStats>;
  elemPresent: Map<string, number>;
  elemTotal: number; // total object-array elements seen
}

function newFieldAgg(path: string): FieldAgg {
  return {
    path,
    present: 0,
    kindCounts: new Map(),
    scalar: newScalarStats(),
    arrLenSum: 0,
    arrCount: 0,
    arrMin: Infinity,
    arrMax: 0,
    arrEmpty: 0,
    arrScalar: newScalarStats(),
    elemKeys: new Map(),
    elemPresent: new Map(),
    elemTotal: 0,
  };
}

function bumpKind(agg: FieldAgg, kind: FieldKind): void {
  agg.kindCounts.set(kind, (agg.kindCounts.get(kind) ?? 0) + 1);
}

function observe(agg: FieldAgg, value: JsonValue): void {
  if (value === null || value === undefined) return;
  agg.present++;

  if (Array.isArray(value)) {
    agg.arrLenSum += value.length;
    agg.arrCount++;
    agg.arrMin = Math.min(agg.arrMin, value.length);
    agg.arrMax = Math.max(agg.arrMax, value.length);
    if (value.length === 0) {
      // Empty arrays are kind-ambiguous; don't let them outvote populated ones.
      agg.arrEmpty++;
      return;
    }
    const allObjects = value.every((e) => isPlainObject(e));
    if (allObjects) {
      bumpKind(agg, "array-object");
      for (const el of value as JsonObject[]) {
        agg.elemTotal++;
        for (const [k, v] of Object.entries(el)) {
          if (v === null) continue;
          agg.elemPresent.set(k, (agg.elemPresent.get(k) ?? 0) + 1);
          let st = agg.elemKeys.get(k);
          if (!st) {
            st = newScalarStats();
            agg.elemKeys.set(k, st);
          }
          if (!Array.isArray(v) && !isPlainObject(v)) addScalar(st, v);
        }
      }
    } else {
      // Treat empty arrays and scalar arrays as scalar arrays.
      bumpKind(agg, "array-scalar");
      for (const el of value) {
        if (!Array.isArray(el) && !isPlainObject(el)) {
          addScalar(agg.arrScalar, el as JsonValue);
        }
      }
    }
    return;
  }

  if (isPlainObject(value)) {
    bumpKind(agg, "object");
    return;
  }

  bumpKind(agg, "scalar");
  addScalar(agg.scalar, value);
}

function dominantKind(agg: FieldAgg): FieldKind {
  let best: FieldKind = "scalar";
  let bestN = -1;
  for (const [k, n] of agg.kindCounts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  // Field only ever seen as empty arrays → treat as a (scalar) array.
  if (bestN < 0 && agg.arrEmpty > 0) return "array-scalar";
  return best;
}

function finalizeField(agg: FieldAgg, recordCount: number): FieldInfo {
  const kind = dominantKind(agg);
  const fillRate = recordCount > 0 ? agg.present / recordCount : 0;

  const info: FieldInfo = {
    path: agg.path,
    kind,
    valueType: "null",
    fillRate,
    distinctCount: 0,
    samples: [],
    avgTextLength: 0,
    looksLikeId: false,
  };

  if (kind === "scalar") {
    const s = agg.scalar;
    info.valueType = dominantType(s);
    info.distinctCount = s.capped ? DISTINCT_CAP : s.distinct.size;
    info.samples = samplesOf(s);
    info.avgTextLength = s.strCount > 0 ? s.strLenSum / s.strCount : 0;
    const idByValue =
      s.count > 0 && s.idLike / s.count > 0.9 && info.distinctCount >= s.count;
    info.looksLikeId = nameLooksLikeId(agg.path) || idByValue;
  } else if (kind === "array-scalar") {
    const s = agg.arrScalar;
    info.valueType = dominantType(s);
    info.distinctCount = s.capped ? DISTINCT_CAP : s.distinct.size;
    info.samples = samplesOf(s);
    info.avgTextLength = s.strCount > 0 ? s.strLenSum / s.strCount : 0;
    info.arrayMinLen = agg.arrCount ? agg.arrMin : 0;
    info.arrayMaxLen = agg.arrMax;
  } else if (kind === "array-object") {
    info.valueType = "mixed";
    info.arrayMinLen = agg.arrCount ? agg.arrMin : 0;
    info.arrayMaxLen = agg.arrMax;
    const keys: ArrayElementKey[] = [];
    for (const [k, st] of agg.elemKeys) {
      const present = agg.elemPresent.get(k) ?? 0;
      const idByValue = st.count > 0 && st.idLike / st.count > 0.9;
      keys.push({
        key: k,
        valueType: dominantType(st),
        fillRate: agg.elemTotal ? present / agg.elemTotal : 0,
        looksLikeId: nameLooksLikeId(k) || idByValue,
        samples: samplesOf(st),
      });
    }
    keys.sort((a, b) => Number(b.looksLikeId) - Number(a.looksLikeId));
    info.elementKeys = keys;
  } else {
    info.valueType = "mixed";
  }

  return info;
}

// ------------------------------ collections -------------------------------

function catalogCollection(
  name: string,
  rootPath: string,
  records: JsonObject[],
): CollectionCatalog {
  const aggs = new Map<string, FieldAgg>();
  const order: string[] = [];
  for (const rec of records) {
    if (!isPlainObject(rec)) continue;
    for (const [key, value] of Object.entries(rec)) {
      let agg = aggs.get(key);
      if (!agg) {
        agg = newFieldAgg(key);
        aggs.set(key, agg);
        order.push(key);
      }
      observe(agg, value);
    }
  }
  const fields = order.map((k) => finalizeField(aggs.get(k)!, records.length));
  return { name, rootPath, recordCount: records.length, fields };
}

// -------------------------------- root scan -------------------------------

/** Detect record collections in a parsed JSON document. */
export function introspect(root: JsonValue): DatasetCatalog {
  const collections: CollectionCatalog[] = [];
  let rootKind: "array" | "object";

  if (Array.isArray(root)) {
    rootKind = "array";
    const records = root.filter(isPlainObject) as JsonObject[];
    collections.push(catalogCollection("(root)", "", records));
  } else if (isPlainObject(root)) {
    rootKind = "object";
    // Any top-level key whose value is a non-empty array of objects is a
    // collection (e.g. neverwas "items" / "storylets").
    for (const [key, value] of Object.entries(root)) {
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((e) => isPlainObject(e))
      ) {
        collections.push(
          catalogCollection(key, key, value as JsonObject[]),
        );
      }
    }
    // Fallback: a lone record object becomes a single-record collection.
    if (collections.length === 0) {
      collections.push(catalogCollection("(root)", "", [root]));
    }
  } else {
    rootKind = "object";
  }

  return {
    rootKind,
    collections,
    shapeSignature: computeShapeSignature(collections),
  };
}

/** Resolve a collection's records array from the parsed root. */
export function recordsForCollection(
  root: JsonValue,
  collection: CollectionCatalog,
): JsonObject[] {
  if (collection.rootPath === "") {
    if (Array.isArray(root)) return root.filter(isPlainObject) as JsonObject[];
    if (isPlainObject(root)) return [root];
    return [];
  }
  if (isPlainObject(root)) {
    const arr = root[collection.rootPath];
    if (Array.isArray(arr)) return arr.filter(isPlainObject) as JsonObject[];
  }
  return [];
}

function computeShapeSignature(collections: CollectionCatalog[]): string {
  const parts: string[] = [];
  for (const c of [...collections].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const fields = c.fields
      .map((f) => `${f.path}:${f.kind}`)
      .sort()
      .join(",");
    parts.push(`${c.name}{${fields}}`);
  }
  return hashString(parts.join("|"));
}

/** Small, dependency-free djb2 hash rendered as base36. */
export function hashString(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
