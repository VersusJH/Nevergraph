import type {
  ArcMapping,
  CollectionCatalog,
  CollectionMapping,
  DatasetCatalog,
  FieldInfo,
  MappingProfile,
} from "../types";

// ---------------------------------------------------------------------------
// Heuristics that pre-fill a MappingProfile from a catalog. These are only
// suggestions — every choice is shown to the user in the wizard and can be
// overridden. The goal is sensible defaults for the common case.
// ---------------------------------------------------------------------------

const LABEL_NAME_RE = /^(name|title|label|titolo|nome|descrizione)$/i;
// Field names that strongly imply relationship / arc arrays.
const ARC_NAME_RE =
  /(child|children|legami|link|links|ref|refs|edge|edges|parent|parents|target|targets|next|depends|requires|connection|relation)/i;
// Category-ish array names (tags) vs arc arrays.
const TAG_NAME_RE = /(tag|tags|categor|trigger|label|labels|kind|kinds)/i;

function isShortString(f: FieldInfo): boolean {
  return f.valueType === "string" && f.avgTextLength <= 40;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})/;

function looksDateLike(f: FieldInfo): boolean {
  return (
    f.samples.length > 0 && f.samples.every((s) => DATE_RE.test(s))
  );
}

function pickIdField(c: CollectionCatalog): string {
  const scalars = c.fields.filter((f) => f.kind === "scalar");
  // 1. exact "id"/"ID" name.
  const exact = scalars.find((f) => /^id$/i.test(f.path));
  if (exact) return exact.path;
  // 2. any field flagged id-like, most-unique first.
  const idish = scalars
    .filter((f) => f.looksLikeId)
    .sort((a, b) => b.distinctCount - a.distinctCount);
  if (idish.length) return idish[0].path;
  // 3. the most-unique scalar (best uniqueness ~ a key).
  const byUniqueness = [...scalars].sort(
    (a, b) => b.distinctCount - a.distinctCount,
  );
  return byUniqueness[0]?.path ?? c.fields[0]?.path ?? "id";
}

function pickLabelField(c: CollectionCatalog, idField: string): string {
  const scalars = c.fields.filter(
    (f) => f.kind === "scalar" && f.path !== idField,
  );
  const named = scalars.find((f) => LABEL_NAME_RE.test(f.path));
  if (named) return named.path;
  const shortStr = scalars.find(isShortString);
  if (shortStr) return shortStr.path;
  return idField;
}

function isArcField(f: FieldInfo): boolean {
  if (f.kind === "array-object") {
    return !!f.elementKeys?.some((k) => k.looksLikeId);
  }
  if (f.kind === "array-scalar") {
    // Plain id arrays: id-shaped elements, or a relationship-ish name.
    const idish = f.valueType === "number" || f.valueType === "string";
    return (idish && f.samples.some(looksIdSample)) || ARC_NAME_RE.test(f.path);
  }
  return false;
}

function looksIdSample(s: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) || /^\d+$/.test(s.trim())
  );
}

function suggestArc(f: FieldInfo): ArcMapping | null {
  if (f.kind === "array-object") {
    const idKey = f.elementKeys?.find((k) => k.looksLikeId);
    if (!idKey) return null;
    const metadataKeys = (f.elementKeys ?? [])
      .filter((k) => k.key !== idKey.key)
      .map((k) => k.key);
    return {
      id: `arc_${f.path}`,
      field: f.path,
      idMode: "key",
      idKey: idKey.key,
      edgeType: f.path,
      directed: true,
      dropSelfLoops: true,
      dedupeReciprocal: false,
      metadataKeys,
    };
  }
  // array-scalar -> plain id array.
  return {
    id: `arc_${f.path}`,
    field: f.path,
    idMode: "self",
    edgeType: f.path,
    directed: true,
    dropSelfLoops: true,
    dedupeReciprocal: false,
    metadataKeys: [],
  };
}

function isCategoryField(f: FieldInfo, idField: string, labelField: string): boolean {
  if (f.path === idField || f.path === labelField) return false;
  if (f.kind === "array-scalar") {
    if (f.distinctCount === 0) return false; // always-empty arrays (e.g. viewLocks)
    // tag-like arrays (non-id elements) become facets.
    return !isArcField(f) || TAG_NAME_RE.test(f.path);
  }
  if (f.kind !== "scalar") return false;
  if (f.looksLikeId) return false;
  if (f.valueType === "boolean") return true;
  if (f.valueType !== "string") return false;
  if (looksDateLike(f)) return false; // timestamps aren't useful facets
  // low-cardinality, short strings → good facet.
  const lowCard =
    f.distinctCount > 0 &&
    f.distinctCount <= 60 &&
    f.distinctCount <= Math.max(2, f.fillRate * 1000);
  return lowCard && f.avgTextLength <= 40;
}

function suggestCollection(c: CollectionCatalog): CollectionMapping {
  const idField = pickIdField(c);
  const labelField = pickLabelField(c, idField);
  const nodeType = c.name === "(root)" ? "node" : singularize(c.name);

  const arcs: ArcMapping[] = [];
  const categoryFields: string[] = [];
  const numericFields: string[] = [];

  for (const f of c.fields) {
    if (f.path === idField) continue;
    if (isArcField(f)) {
      const arc = suggestArc(f);
      if (arc) arcs.push(arc);
      // An arc field that is also tag-like (rare) still won't double as facet.
      continue;
    }
    if (isCategoryField(f, idField, labelField)) {
      categoryFields.push(f.path);
      continue;
    }
    if (f.kind === "scalar" && f.valueType === "number" && !f.looksLikeId) {
      numericFields.push(f.path);
    }
  }

  return {
    collection: c.name,
    enabled: true,
    idField,
    labelField,
    nodeType,
    categoryFields,
    numericFields,
    // Default the hover tooltip to the category facets (matches prior behaviour).
    tooltipFields: [...categoryFields],
    arcs,
  };
}

function singularize(name: string): string {
  if (/ies$/i.test(name)) return name.replace(/ies$/i, "y");
  if (/s$/i.test(name) && !/ss$/i.test(name)) return name.replace(/s$/i, "");
  return name;
}

/** Build a full suggested profile for a freshly-introspected dataset. */
export function suggestProfile(
  catalog: DatasetCatalog,
  name = "Suggested mapping",
): MappingProfile {
  return {
    name,
    shapeSignature: catalog.shapeSignature,
    collections: catalog.collections.map(suggestCollection),
  };
}
