import { h, clear } from "./dom";
import type { GraphModel, GEdge, GNode, JsonValue } from "../types";
import { renderFieldRows } from "./fieldFormat";

export interface DetailPanel {
  element: HTMLElement;
  show: (
    sel: { kind: "node" | "edge"; id: string } | null,
    graph: GraphModel,
  ) => void;
}

export function createDetailPanel(onNavigate: (nodeId: string) => void): DetailPanel {
  const element = h("aside", { class: "panel detail-panel" });
  showEmpty();

  function showEmpty(): void {
    clear(element);
    element.append(
      h("div", { class: "panel-empty muted" }, "Select a node or edge to inspect it."),
    );
  }

  function show(
    sel: { kind: "node" | "edge"; id: string } | null,
    graph: GraphModel,
  ): void {
    if (!sel) return showEmpty();
    if (sel.kind === "node") {
      const node = graph.nodes.find((n) => n.id === sel.id);
      if (node) showNode(node, graph);
    } else {
      const edge = graph.edges.find((e) => e.id === sel.id);
      if (edge) showEdge(edge, graph);
    }
  }

  function showNode(node: GNode, graph: GraphModel): void {
    clear(element);
    const outgoing = graph.edges.filter((e) => e.source === node.id);
    const incoming = graph.edges.filter((e) => e.target === node.id);
    const labelOf = (id: string) =>
      graph.nodes.find((n) => n.id === id)?.label ?? id;

    const kids: (Node | null)[] = [
      h("div", { class: "detail-head" }, [
        h("span", { class: "type-chip" }, node.type),
        h("h3", { class: "detail-title" }, node.label),
      ]),
      chipRow(node.categories),
      fieldList(node.data),
      neighborGroup("Outgoing", outgoing, (e) => e.target, labelOf),
      neighborGroup("Incoming", incoming, (e) => e.source, labelOf),
    ];
    element.append(...(kids.filter(Boolean) as Node[]));
  }

  function showEdge(edge: GEdge, graph: GraphModel): void {
    clear(element);
    const src = graph.nodes.find((n) => n.id === edge.source);
    const tgt = graph.nodes.find((n) => n.id === edge.target);
    element.append(
      h("div", { class: "detail-head" }, [
        h("span", { class: "type-chip" }, edge.type),
        h(
          "h3",
          { class: "detail-title" },
          `${src?.label ?? edge.source} ${edge.directed ? "→" : "—"} ${tgt?.label ?? edge.target}`,
        ),
      ]),
      Object.keys(edge.data).length
        ? fieldList(edge.data as Record<string, JsonValue>)
        : h("p", { class: "muted" }, "No edge metadata."),
    );
  }

  function neighborGroup(
    title: string,
    edges: GEdge[],
    pick: (e: GEdge) => string,
    labelOf: (id: string) => string,
  ): HTMLElement | null {
    if (!edges.length) return null;
    return h("div", { class: "detail-section" }, [
      h("h4", {}, `${title} (${edges.length})`),
      h(
        "div",
        { class: "neighbor-list" },
        edges.map((e) => {
          const id = pick(e);
          return h(
            "button",
            { class: "neighbor", onclick: () => onNavigate(id) },
            [
              h("span", { class: "neighbor-edge muted" }, e.type),
              h("span", { class: "neighbor-label" }, labelOf(id)),
            ],
          );
        }),
      ),
    ]);
  }

  return { element, show };
}

function chipRow(categories: Record<string, string[]>): HTMLElement | null {
  const entries = Object.entries(categories);
  if (!entries.length) return null;
  return h(
    "div",
    { class: "detail-chips" },
    entries.flatMap(([facet, vals]) =>
      vals.map((v) =>
        h("span", { class: "facet-chip" }, [
          h("span", { class: "facet-chip-k" }, facet),
          v,
        ]),
      ),
    ),
  );
}

function fieldList(data: Record<string, JsonValue>): HTMLElement {
  return renderFieldRows(Object.entries(data));
}
