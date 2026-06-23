import type {
  ArcMapping,
  CollectionMapping,
  DatasetCatalog,
  DanglingRef,
  GEdge,
  GNode,
  GraphModel,
  JsonObject,
  JsonValue,
  MappingProfile,
} from "../types";
import { recordsForCollection } from "../io/introspect";
import { getField, isPlainObject, scalarToString } from "./paths";

const NS = "::";

function namespacedId(type: string, rawId: string): string {
  return `${type}${NS}${rawId}`;
}

/** Normalise a field value into an array of non-empty category strings. */
function toCategoryValues(value: JsonValue): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value
      .filter((v) => !Array.isArray(v) && !isPlainObject(v))
      .map((v) => scalarToString(v as JsonValue))
      .filter((s) => s !== "");
  }
  if (isPlainObject(value)) return [];
  const s = scalarToString(value);
  return s === "" ? [] : [s];
}

function nodeTypeFor(record: JsonObject, m: CollectionMapping): string {
  if (m.typeField) {
    const v = getField(record, m.typeField);
    const s = scalarToString(v);
    if (s !== "") return s;
  }
  return m.nodeType;
}

export function buildGraph(
  root: JsonValue,
  catalog: DatasetCatalog,
  profile: MappingProfile,
): GraphModel {
  const nodes: GNode[] = [];
  const byId = new Map<string, GNode>();
  const byRawId = new Map<string, GNode[]>();
  const duplicateIds: string[] = [];
  const skippedCollections: string[] = [];
  const tooltipFieldsByType: Record<string, string[]> = {};

  const mappingByName = new Map(
    profile.collections.map((c) => [c.collection, c]),
  );

  // ----------------------------- nodes -----------------------------
  for (const cc of catalog.collections) {
    const m = mappingByName.get(cc.name);
    if (!m || !m.enabled) {
      skippedCollections.push(cc.name);
      continue;
    }
    const records = recordsForCollection(root, cc);
    records.forEach((record, index) => {
      const type = nodeTypeFor(record, m);
      // Tooltip field list is per node type; fall back to categories for
      // profiles saved before tooltipFields existed.
      if (!(type in tooltipFieldsByType))
        tooltipFieldsByType[type] = m.tooltipFields ?? m.categoryFields;
      let rawId = scalarToString(getField(record, m.idField));
      if (rawId === "") rawId = `${type}#${index}`;
      const id = namespacedId(type, rawId);

      if (byId.has(id)) {
        duplicateIds.push(id);
        return; // keep the first occurrence
      }

      const categories: Record<string, string[]> = {};
      for (const cf of m.categoryFields) {
        const vals = toCategoryValues(getField(record, cf));
        if (vals.length) categories[cf] = vals;
      }
      const numeric: Record<string, number> = {};
      for (const nf of m.numericFields) {
        const v = getField(record, nf);
        if (typeof v === "number" && Number.isFinite(v)) numeric[nf] = v;
      }

      const labelRaw = scalarToString(getField(record, m.labelField));
      const node: GNode = {
        id,
        rawId,
        type,
        label: labelRaw !== "" ? labelRaw : rawId,
        data: record,
        categories,
        numeric,
      };
      nodes.push(node);
      byId.set(id, node);
      const list = byRawId.get(rawId);
      if (list) list.push(node);
      else byRawId.set(rawId, [node]);
    });
  }

  // ----------------------------- edges -----------------------------
  const edges: GEdge[] = [];
  const danglingRefs: DanglingRef[] = [];
  const seenEdgeKeys = new Set<string>();
  let selfLoopsDropped = 0;
  let reciprocalDeduped = 0;
  let edgeSeq = 0;

  const resolveTarget = (
    rawId: string,
    targetType: string | undefined,
  ): GNode | null => {
    if (targetType) return byId.get(namespacedId(targetType, rawId)) ?? null;
    const list = byRawId.get(rawId);
    if (!list || list.length === 0) return null;
    return list[0]; // unambiguous for the common (globally-unique id) case
  };

  for (const cc of catalog.collections) {
    const m = mappingByName.get(cc.name);
    if (!m || !m.enabled || m.arcs.length === 0) continue;
    const records = recordsForCollection(root, cc);
    for (const record of records) {
      const type = nodeTypeFor(record, m);
      let rawId = scalarToString(getField(record, m.idField));
      if (rawId === "") continue; // synthetic-id nodes can't be arc sources reliably
      const sourceId = namespacedId(type, rawId);
      if (!byId.has(sourceId)) continue;

      for (const arc of m.arcs) {
        const arrVal = getField(record, arc.field);
        if (!Array.isArray(arrVal)) continue;
        for (const el of arrVal) {
          const { targetRawId, meta } = extractTarget(el, arc);
          if (targetRawId === "") continue;

          const targetNode = resolveTarget(targetRawId, arc.targetType);
          if (!targetNode) {
            danglingRefs.push({
              sourceId,
              targetRawId,
              edgeType: arc.edgeType,
            });
            continue;
          }
          const targetId = targetNode.id;

          if (sourceId === targetId) {
            if (arc.dropSelfLoops) {
              selfLoopsDropped++;
              continue;
            }
          }

          // De-duplication / reciprocal collapse.
          let key: string;
          if (arc.directed) {
            key = `d:${arc.edgeType}:${sourceId}->${targetId}`;
          } else if (arc.dedupeReciprocal) {
            const [a, b] = [sourceId, targetId].sort();
            key = `u:${arc.edgeType}:${a}|${b}`;
          } else {
            key = `u:${arc.edgeType}:${sourceId}->${targetId}`;
          }
          if (seenEdgeKeys.has(key)) {
            if (!arc.directed && arc.dedupeReciprocal) reciprocalDeduped++;
            continue;
          }
          seenEdgeKeys.add(key);

          edges.push({
            id: `e${edgeSeq++}`,
            source: sourceId,
            target: targetId,
            type: arc.edgeType,
            directed: arc.directed,
            data: meta,
          });
        }
      }
    }
  }

  // --------------------------- aggregates ---------------------------
  const nodeTypes = [...new Set(nodes.map((n) => n.type))].sort();
  const edgeTypes = [...new Set(edges.map((e) => e.type))].sort();

  const facets: Record<string, Set<string>> = {};
  const numericRanges: Record<string, [number, number]> = {};
  for (const n of nodes) {
    for (const [facet, vals] of Object.entries(n.categories)) {
      const set = (facets[facet] ??= new Set());
      for (const v of vals) set.add(v);
    }
    for (const [nf, v] of Object.entries(n.numeric)) {
      const r = numericRanges[nf];
      if (!r) numericRanges[nf] = [v, v];
      else {
        if (v < r[0]) r[0] = v;
        if (v > r[1]) r[1] = v;
      }
    }
  }
  const facetsOut: Record<string, string[]> = {};
  for (const [k, set] of Object.entries(facets)) {
    facetsOut[k] = [...set].sort((a, b) => a.localeCompare(b));
  }

  return {
    nodes,
    edges,
    nodeTypes,
    edgeTypes,
    facets: facetsOut,
    numericRanges,
    tooltipFieldsByType,
    report: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      selfLoopsDropped,
      reciprocalDeduped,
      duplicateIds,
      danglingRefs,
      skippedCollections,
    },
  };
}

function extractTarget(
  el: JsonValue,
  arc: ArcMapping,
): { targetRawId: string; meta: Record<string, JsonValue> } {
  const meta: Record<string, JsonValue> = {};
  if (arc.idMode === "self") {
    if (Array.isArray(el) || isPlainObject(el)) return { targetRawId: "", meta };
    return { targetRawId: scalarToString(el), meta };
  }
  // key mode
  if (!isPlainObject(el) || !arc.idKey) return { targetRawId: "", meta };
  const targetRawId = scalarToString(el[arc.idKey]);
  for (const mk of arc.metadataKeys) {
    if (Object.prototype.hasOwnProperty.call(el, mk)) meta[mk] = el[mk];
  }
  return { targetRawId, meta };
}
