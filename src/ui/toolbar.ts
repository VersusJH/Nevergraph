import { h } from "./dom";
import type { GraphModel } from "../types";
import type { AppState } from "../state";
import { LAYOUTS } from "../graph/layouts";

export interface ToolbarCallbacks {
  onLayout: (id: string) => void;
  onColorBy: (v: string) => void;
  onShapeBy: (v: string) => void;
  onPatternBy: (v: string) => void;
  onSizeBy: (v: string) => void;
  onSearch: (q: string) => void;
  onFit: () => void;
  onReconfigure: () => void;
  onSaveProfile: () => void;
  onExport: () => void;
}

export function createToolbar(
  graph: GraphModel,
  state: AppState,
  cb: ToolbarCallbacks,
): HTMLElement {
  const facets = Object.keys(graph.facets);
  const colorOpts = ["type", ...facets];
  const shapeOpts = ["type", "uniform", ...facets];
  const patternOpts = ["none", "type", ...facets];
  const sizeOpts = ["degree", "uniform", ...Object.keys(graph.numericRanges)];

  const search = h("input", {
    class: "toolbar-search",
    type: "search",
    placeholder: "Search nodes…",
    value: state.filters.search,
    oninput: (e: Event) => cb.onSearch((e.target as HTMLInputElement).value),
  });

  return h("header", { class: "toolbar" }, [
    h("div", { class: "toolbar-left" }, [
      h("span", { class: "toolbar-brand" }, "Nevergraph"),
      h("span", { class: "toolbar-file muted" }, state.fileName ?? ""),
    ]),
    h("div", { class: "toolbar-mid" }, [
      labeledSelect("Layout", LAYOUTS.map((l) => [l.id, l.label]), state.layout, cb.onLayout),
      labeledSelect("Colour", colorOpts.map((o) => [o, o]), state.encoding.colorBy, cb.onColorBy),
      labeledSelect("Shape", shapeOpts.map((o) => [o, o]), state.encoding.shapeBy, cb.onShapeBy),
      labeledSelect("Pattern", patternOpts.map((o) => [o, o]), state.encoding.patternBy, cb.onPatternBy),
      labeledSelect("Size", sizeOpts.map((o) => [o, o]), String(state.encoding.sizeBy), cb.onSizeBy),
      search,
    ]),
    h("div", { class: "toolbar-right" }, [
      btn("Fit", cb.onFit),
      btn("Re-map", cb.onReconfigure),
      btn("Save", cb.onSaveProfile),
      btn("Export", cb.onExport, "btn-accent"),
    ]),
  ]);
}

function labeledSelect(
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

function btn(label: string, onClick: () => void, cls = "btn-ghost"): HTMLElement {
  return h("button", { class: cls, onclick: onClick }, label);
}
