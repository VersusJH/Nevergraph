import type cytoscape from "cytoscape";
import type { GraphModel } from "../types";

export interface BuiltElements {
  nodes: cytoscape.ElementDefinition[];
  edges: cytoscape.ElementDefinition[];
  degree: Map<string, number>;
}

/** Convert a GraphModel into Cytoscape element definitions. Visual encoding
 *  attributes (color/shape/size) are filled in later by applyEncoding(). */
export function toElements(graph: GraphModel): BuiltElements {
  const degree = new Map<string, number>();
  for (const n of graph.nodes) degree.set(n.id, 0);
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const nodes: cytoscape.ElementDefinition[] = graph.nodes.map((n) => ({
    group: "nodes",
    data: {
      id: n.id,
      label: n.label,
      type: n.type,
      degree: degree.get(n.id) ?? 0,
      color: "#7c9eff",
      shape: "ellipse",
      size: 26,
      pattern: "",
    },
  }));

  const edges: cytoscape.ElementDefinition[] = graph.edges.map((e) => ({
    group: "edges",
    data: {
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      directed: e.directed,
      color: "#3c4655",
      width: 1.5,
    },
  }));

  return { nodes, edges, degree };
}
