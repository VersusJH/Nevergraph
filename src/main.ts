import "./styles/app.css";
import { h } from "./ui/dom";
import { Store, initialState, type AppState, type Selection } from "./state";
import { introspect } from "./io/introspect";
import { suggestProfile } from "./mapping/suggest";
import { buildGraph } from "./mapping/buildGraph";
import { loadProfile, saveProfile } from "./io/profileStore";
import type { GraphModel, JsonValue, MappingProfile } from "./types";
import { renderLanding } from "./ui/landing";
import { renderWizard } from "./ui/wizard";
import { createToolbar } from "./ui/toolbar";
import { createFilters } from "./ui/filters";
import { createDetailPanel, type DetailPanel } from "./ui/detailPanel";
import { createLegend, type Legend } from "./ui/legend";
import { createGraphView, type GraphView } from "./graph/graphView";

const app = document.getElementById("app")!;
const store = new Store();

let graphView: GraphView | null = null;
let detail: DetailPanel | null = null;
let legend: Legend | null = null;

// ------------------------------- toast -----------------------------------
const toastBox = h("div", { class: "toast-box" });
document.body.appendChild(toastBox);
function toast(msg: string): void {
  const t = h("div", { class: "toast" }, msg);
  toastBox.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 2600);
}

// ------------------------------- views ------------------------------------
function teardownGraph(): void {
  graphView?.destroy();
  graphView = null;
  detail = null;
  legend = null;
}

function showLanding(): void {
  teardownGraph();
  store.set({ view: "landing" });
  app.replaceChildren(
    renderLanding({
      onLoad: (text, fileName) => loadText(text, fileName),
    }),
  );
}

function loadText(text: string, fileName: string): void {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text) as JsonValue;
  } catch (err) {
    toast(`Could not parse JSON: ${(err as Error).message}`);
    return;
  }
  const catalog = introspect(parsed);
  if (!catalog.collections.length || catalog.collections.every((c) => c.recordCount === 0)) {
    toast("No record collections found in this JSON.");
    return;
  }
  // Re-apply a saved mapping if we've seen this dataset shape before.
  const saved = loadProfile(catalog.shapeSignature);
  if (saved) {
    store.set({ rawData: parsed, fileName, catalog, profile: saved });
    buildAndShow(saved);
    toast("Applied saved mapping for this shape · use Re-map to change");
    return;
  }
  const profile = suggestProfile(catalog, `${fileName} mapping`);
  store.set({ rawData: parsed, fileName, catalog, profile });
  showWizard();
}

function showWizard(): void {
  teardownGraph();
  store.set({ view: "wizard" });
  const s = store.get();
  const wizard = renderWizard(s.catalog!, s.profile!, {
    computeReport: (profile) =>
      buildGraph(s.rawData!, s.catalog!, profile).report,
    onConfirm: (profile) => {
      store.set({ profile });
      buildAndShow(profile);
    },
    notify: toast,
  });
  app.replaceChildren(
    h("div", { class: "wizard-view" }, [
      h("div", { class: "wizard-top" }, [
        h("button", { class: "btn-ghost", onclick: showLanding }, "← New file"),
      ]),
      wizard,
    ]),
  );
}

function buildAndShow(profile: MappingProfile): void {
  const s = store.get();
  const graph = buildGraph(s.rawData!, s.catalog!, profile);
  // Fresh filter/encoding state for the new graph.
  const fresh = initialState();
  store.set({
    view: "graph",
    graph,
    filters: fresh.filters,
    encoding: fresh.encoding,
    layout: fresh.layout,
  });
  showGraph(graph);
  reportToast(graph);
}

function reportToast(graph: GraphModel): void {
  const r = graph.report;
  const bits = [`${r.nodeCount} nodes`, `${r.edgeCount} edges`];
  if (r.danglingRefs.length) bits.push(`${r.danglingRefs.length} dangling`);
  toast(bits.join(" · "));
}

function showGraph(graph: GraphModel): void {
  const state = store.get();

  const cyEl = h("div", { class: "cy", id: "cy" });
  detail = createDetailPanel((id) => selectNode(id));
  legend = createLegend();

  const filtersPanel = createFilters(graph, state.filters, () => {
    graphView?.applyFilters(store.get().filters);
  });

  const toolbar = createToolbar(graph, state, {
    onLayout: (id) => {
      store.update((s) => (s.layout = id));
      graphView?.runLayout(id);
    },
    onColorBy: (v) => {
      store.update((s) => (s.encoding.colorBy = v));
      graphView?.setEncoding(store.get().encoding);
    },
    onSizeBy: (v) => {
      store.update((s) => (s.encoding.sizeBy = v));
      graphView?.setEncoding(store.get().encoding);
    },
    onSearch: (q) => {
      store.update((s) => (s.filters.search = q));
      graphView?.applyFilters(store.get().filters);
    },
    onFit: () => graphView?.fit(),
    onReconfigure: () => showWizard(),
    onSaveProfile: () => {
      const p = store.get().profile;
      if (p) {
        saveProfile(p);
        toast("Mapping saved — future files of this shape reuse it.");
      }
    },
    onExport: async () => {
      const s = store.get();
      if (!s.graph) return;
      try {
        // Loaded on demand — the inlined viewer template is large.
        const { exportStandaloneHtml } = await import("./export/exportHtml");
        exportStandaloneHtml({
          graph: s.graph,
          encoding: s.encoding,
          layout: s.layout,
          fileName: s.fileName,
        });
        toast("Exported a standalone interactive HTML.");
      } catch (err) {
        toast(`Export failed: ${(err as Error).message}`);
      }
    },
  });

  app.replaceChildren(
    h("div", { class: "app-graph" }, [
      toolbar,
      h("div", { class: "workspace" }, [
        filtersPanel.element,
        h("div", { class: "stage" }, [cyEl, legend.element]),
        detail.element,
      ]),
    ]),
  );

  // cyEl is now in the DOM (sized) — safe to init Cytoscape.
  graphView = createGraphView(cyEl, {
    onSelect: (sel) => onSelect(sel),
    onLegend: (data) => legend?.update(data),
  });
  graphView.setGraph(graph, store.get().layout, store.get().encoding);
  graphView.applyFilters(store.get().filters);
  (window as unknown as { __cy: unknown }).__cy = graphView.getCy();
}

function onSelect(sel: Selection | null): void {
  store.set({ selection: sel });
  const g = store.get().graph;
  if (g) detail?.show(sel, g);
}

function selectNode(id: string): void {
  graphView?.selectById(id);
  onSelect({ kind: "node", id });
}

// expose a tiny bit of state for debugging / e2e checks
(window as unknown as { __nevergraph: () => AppState }).__nevergraph = () =>
  store.get();

showLanding();
