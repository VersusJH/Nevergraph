// ---------------------------------------------------------------------------
// Core type definitions for Nevergraph.
//
// Data flows: raw JSON -> DatasetCatalog (introspection) -> MappingProfile
// (user-guided, in the wizard) -> GraphModel (buildGraph) -> Cytoscape render.
// ---------------------------------------------------------------------------

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

// ----------------------------- Field catalog ------------------------------

/** Shape of a field within a record collection. */
export type FieldKind = "scalar" | "array-scalar" | "array-object" | "object";

/** Primitive value type, used for scalars and array element types. */
export type ValueType = "string" | "number" | "boolean" | "mixed" | "null";

/** A key found on the objects inside an array-of-objects field. */
export interface ArrayElementKey {
  key: string;
  valueType: ValueType;
  fillRate: number; // fraction of array elements that have this key
  /** Looks like an identifier reference (uuid / numeric id / "*id" name). */
  looksLikeId: boolean;
  samples: string[];
}

/** Inferred information about a single field path within a collection. */
export interface FieldInfo {
  /** Field name / array path, e.g. "name", "tags", "children", "itemLocks". */
  path: string;
  kind: FieldKind;
  /** For scalar: the value type. For arrays: the element value type. */
  valueType: ValueType;
  /** Records (or array elements for arrays) that carry a non-null value. */
  fillRate: number;
  /** Distinct scalar values seen (scalar + array-scalar only). */
  distinctCount: number;
  /** A sample of distinct values rendered as strings (capped). */
  samples: string[];
  /** Average string length of scalar string values (used to flag long text). */
  avgTextLength: number;
  /** For array-* fields: observed min/max element counts per record. */
  arrayMinLen?: number;
  arrayMaxLen?: number;
  /** For array-object fields: the keys present on the element objects. */
  elementKeys?: ArrayElementKey[];
  /** Heuristic: this scalar field looks like the record's unique id. */
  looksLikeId: boolean;
}

export interface CollectionCatalog {
  /** Collection name: a top-level array key, or "(root)" for a root array. */
  name: string;
  /** Path from the JSON root to this collection's array ("" for root array). */
  rootPath: string;
  recordCount: number;
  fields: FieldInfo[];
}

export interface DatasetCatalog {
  rootKind: "array" | "object";
  collections: CollectionCatalog[];
  /** Stable signature of the dataset's structure, for profile matching. */
  shapeSignature: string;
}

// ----------------------------- Mapping profile ----------------------------

/** How to extract a target node id from each element of an arc array. */
export type ArcIdMode =
  | "self" // the array element IS the id (plain id array, e.g. Legami)
  | "key"; // the id is a key within the element object (e.g. children[].id)

export interface ArcMapping {
  /** Stable local id for this arc mapping. */
  id: string;
  /** Path to the array field within the record, e.g. "children", "Legami". */
  field: string;
  idMode: ArcIdMode;
  /** Element key holding the target id, when idMode === "key". */
  idKey?: string;
  /** Display name / semantic type of these edges, e.g. "child", "itemLock". */
  edgeType: string;
  directed: boolean;
  dropSelfLoops: boolean;
  /** Collapse A->B / B->A into one edge (meaningful for undirected arcs). */
  dedupeReciprocal: boolean;
  /** Element keys (for "key" mode) captured as edge metadata. */
  metadataKeys: string[];
  /**
   * Node type the targets resolve into. Used only to disambiguate when the
   * same raw id exists under multiple node types; undefined = any type.
   */
  targetType?: string;
}

export interface CollectionMapping {
  collection: string; // matches CollectionCatalog.name
  enabled: boolean;
  idField: string;
  labelField: string;
  /** Node type for records in this collection (default = collection name). */
  nodeType: string;
  /** Optional field whose value overrides nodeType per-record. */
  typeField?: string;
  /** Fields treated as filterable facets / encodings. */
  categoryFields: string[];
  /** Numeric fields usable for node sizing / range filters. */
  numericFields: string[];
  arcs: ArcMapping[];
}

export interface MappingProfile {
  name: string;
  shapeSignature: string;
  collections: CollectionMapping[];
  createdAt?: string;
}

// ------------------------------- Graph model ------------------------------

export interface GNode {
  /** Globally unique, namespaced id ("type::rawId"). */
  id: string;
  rawId: string;
  type: string;
  label: string;
  /** All original record fields, for the detail panel. */
  data: JsonObject;
  /** Facet name -> value(s); array fields normalised to string arrays. */
  categories: Record<string, string[]>;
  /** Numeric field name -> value. */
  numeric: Record<string, number>;
}

export interface GEdge {
  id: string;
  source: string; // namespaced node id
  target: string; // namespaced node id
  type: string;
  directed: boolean;
  data: Record<string, JsonValue>;
}

export interface DanglingRef {
  sourceId: string;
  targetRawId: string;
  edgeType: string;
}

export interface ValidationReport {
  nodeCount: number;
  edgeCount: number;
  selfLoopsDropped: number;
  reciprocalDeduped: number;
  duplicateIds: string[];
  danglingRefs: DanglingRef[];
  /** Collections present in the data but not enabled in the profile. */
  skippedCollections: string[];
}

export interface GraphModel {
  nodes: GNode[];
  edges: GEdge[];
  nodeTypes: string[];
  edgeTypes: string[];
  /** Facet name -> sorted distinct values across all nodes. */
  facets: Record<string, string[]>;
  /** Numeric field name -> [min, max] across all nodes. */
  numericRanges: Record<string, [number, number]>;
  report: ValidationReport;
}
