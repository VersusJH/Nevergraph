import "../src/styles/app.css";
import { h } from "../src/ui/dom";
import { initialState, type EncodingConfig } from "../src/state";
import type { GraphModel } from "../src/types";
import { createGraphView, type GraphView } from "../src/graph/graphView";
import { createFilters } from "../src/ui/filters";
import { createDetailPanel } from "../src/ui/detailPanel";
import { createLegend } from "../src/ui/legend";
import { LAYOUTS } from "../src/graph/layouts";

interface Payload {
  graph: GraphModel;
  encoding: EncodingConfig;
  layout: string;
  fileName?: string;
}

const app = document.getElementById("app")!;
const dataEl = document.getElementById("ng-data");
let payload: Payload | null = null;
try {
  const raw = dataEl?.textContent?.trim();
  if (raw) payload = JSON.parse(raw) as Payload;
} catch {
  payload = null;
}

if (!payload || !payload.graph) {
  app.append(
    h("div", { class: "landing" }, [
      h("div", { class: "landing-inner" }, [
        h("h1", {}, "Nevergraph viewer"),
        h(
          "p",
          { class: "muted" },
          "This file has no embedded graph data. Export one from the Nevergraph app.",
        ),
      ]),
    ]),
  );
} else {
  boot(payload);
}

function boot(p: Payload): void {
  const graph = p.graph;
  const state = initialState();
  state.encoding = { ...state.encoding, ...p.encoding };
  state.layout = p.layout;
  state.fileName = p.fileName ?? null;

  let graphView: GraphView;
  const cyEl = h("div", { class: "cy", id: "cy" });
  const detail = createDetailPanel((id) => {
    graphView.selectById(id);
    detail.show({ kind: "node", id }, graph);
  });
  const legend = createLegend();
  const filters = createFilters(graph, state.filters, () =>
    graphView.applyFilters(state.filters),
  );

  const toolbar = h("header", { class: "toolbar" }, [
    h("div", { class: "toolbar-left" }, [
      h("span", { class: "toolbar-brand" }, "Nevergraph"),
      h("span", { class: "toolbar-file muted" }, state.fileName ?? ""),
    ]),
    h("div", { class: "toolbar-mid" }, [
      control("Layout", LAYOUTS.map((l) => [l.id, l.label]), state.layout, (v) => {
        state.layout = v;
        graphView.runLayout(v);
      }),
      control(
        "Colour",
        ["type", ...Object.keys(graph.facets)].map((o) => [o, o]),
        state.encoding.colorBy,
        (v) => {
          state.encoding.colorBy = v;
          graphView.setEncoding(state.encoding);
        },
      ),
      control(
        "Shape",
        ["type", "uniform", ...Object.keys(graph.facets)].map((o) => [o, o]),
        state.encoding.shapeBy,
        (v) => {
          state.encoding.shapeBy = v;
          graphView.setEncoding(state.encoding);
        },
      ),
      control(
        "Pattern",
        ["none", "type", ...Object.keys(graph.facets)].map((o) => [o, o]),
        state.encoding.patternBy,
        (v) => {
          state.encoding.patternBy = v;
          graphView.setEncoding(state.encoding);
        },
      ),
      control(
        "Size",
        ["degree", "uniform", ...Object.keys(graph.numericRanges)].map((o) => [o, o]),
        String(state.encoding.sizeBy),
        (v) => {
          state.encoding.sizeBy = v;
          graphView.setEncoding(state.encoding);
        },
      ),
      h("input", {
        class: "toolbar-search",
        type: "search",
        placeholder: "Search nodes…",
        oninput: (e: Event) => {
          state.filters.search = (e.target as HTMLInputElement).value;
          graphView.applyFilters(state.filters);
        },
      }),
    ]),
    h("div", { class: "toolbar-right" }, [
      h("button", { class: "btn-ghost", onclick: () => graphView.fit() }, "Fit"),
    ]),
  ]);

  app.append(
    h("div", { class: "app-graph" }, [
      toolbar,
      h("div", { class: "workspace" }, [
        filters.element,
        h("div", { class: "stage" }, [cyEl, legend.element]),
        detail.element,
      ]),
    ]),
  );

  graphView = createGraphView(cyEl, {
    onSelect: (sel) => detail.show(sel, graph),
    onLegend: (d) => legend.update(d),
  });
  graphView.setGraph(graph, state.layout, state.encoding);
  graphView.applyFilters(state.filters);
  (window as unknown as { __cy: unknown }).__cy = graphView.getCy();
}

function control(
  label: string,
  options: [string, string][],
  current: string,
  onChange: (v: string) => void,
): HTMLElement {
  return h("label", { class: "toolbar-control" }, [
    h("span", { class: "toolbar-clabel muted" }, label),
    h(
      "select",
      {
        class: "toolbar-select",
        onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
      },
      options.map(([v, l]) =>
        h("option", { value: v, selected: v === current }, l),
      ),
    ),
  ]);
}
