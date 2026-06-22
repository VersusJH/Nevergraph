import { h } from "./dom";
import type { GraphModel } from "../types";
import type { FilterState } from "../state";

export interface FiltersPanel {
  element: HTMLElement;
}

/** Build the left filter panel. Handlers mutate the live `filters` object and
 *  call `onChange`; the DOM is built once so inputs keep focus. */
export function createFilters(
  graph: GraphModel,
  filters: FilterState,
  onChange: () => void,
): FiltersPanel {
  const element = h("aside", { class: "panel filter-panel" });

  // ---- display mode ----
  const modeToggle = h("div", { class: "seg" }, [
    segBtn("Hide", filters.mode === "hide", () => setMode("hide")),
    segBtn("Dim", filters.mode === "dim", () => setMode("dim")),
  ]);
  function setMode(m: FilterState["mode"]): void {
    filters.mode = m;
    modeToggle.querySelectorAll(".seg-btn").forEach((b, i) =>
      b.classList.toggle("on", (i === 0) === (m === "hide")),
    );
    onChange();
  }

  element.append(
    section("Display", [
      h("label", { class: "seg-label muted" }, "Filtered elements"),
      modeToggle,
    ]),
  );

  // ---- node types ----
  if (graph.nodeTypes.length) {
    element.append(
      section(
        "Node types",
        graph.nodeTypes.map((t) =>
          toggleRow(t, !filters.hiddenNodeTypes.has(t), (on) => {
            if (on) filters.hiddenNodeTypes.delete(t);
            else filters.hiddenNodeTypes.add(t);
            onChange();
          }),
        ),
      ),
    );
  }

  // ---- edge types ----
  if (graph.edgeTypes.length) {
    element.append(
      section(
        "Edge types",
        graph.edgeTypes.map((t) =>
          toggleRow(t, !filters.hiddenEdgeTypes.has(t), (on) => {
            if (on) filters.hiddenEdgeTypes.delete(t);
            else filters.hiddenEdgeTypes.add(t);
            onChange();
          }),
        ),
      ),
    );
  }

  // ---- facets ----
  for (const [facet, values] of Object.entries(graph.facets)) {
    if (!values.length) continue;
    const off = (filters.facetOff[facet] ??= new Set());
    const rows = values.map((v) =>
      toggleRow(v, !off.has(v), (on) => {
        if (on) off.delete(v);
        else off.add(v);
        onChange();
      }),
    );
    const setAll = (on: boolean) => {
      off.clear();
      if (!on) values.forEach((v) => off.add(v));
      rebuildFacet();
      onChange();
    };
    const facetBox = section(
      `${facet} (${values.length})`,
      [
        h("div", { class: "facet-actions" }, [
          miniLink("all", () => setAll(true)),
          miniLink("none", () => setAll(false)),
        ]),
        h("div", { class: "facet-values" }, rows),
      ],
      true,
    );
    element.append(facetBox);
    function rebuildFacet(): void {
      rows.forEach((r, i) => {
        const input = r.querySelector("input") as HTMLInputElement;
        input.checked = !off.has(values[i]);
      });
    }
  }

  element.append(
    h("button", { class: "btn-ghost reset-btn", onclick: resetAll }, "Reset filters"),
  );

  function resetAll(): void {
    filters.hiddenNodeTypes.clear();
    filters.hiddenEdgeTypes.clear();
    for (const k of Object.keys(filters.facetOff)) filters.facetOff[k].clear();
    filters.search = "";
    // rebuild checkbox states
    element.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach(
      (c) => (c.checked = true),
    );
    onChange();
  }

  return { element };
}

function section(
  title: string,
  children: Node[],
  collapsible = false,
): HTMLElement {
  if (collapsible) {
    return h("details", { class: "filter-section", open: true }, [
      h("summary", { class: "filter-title" }, title),
      ...children,
    ]);
  }
  return h("div", { class: "filter-section" }, [
    h("div", { class: "filter-title" }, title),
    ...children,
  ]);
}

function toggleRow(
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): HTMLElement {
  return h("label", { class: "toggle-row" }, [
    h("input", {
      type: "checkbox",
      checked,
      onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked),
    }),
    h("span", { class: "toggle-label" }, label),
  ]);
}

function segBtn(label: string, on: boolean, onClick: () => void): HTMLElement {
  return h("button", { class: "seg-btn" + (on ? " on" : ""), onclick: onClick }, label);
}

function miniLink(label: string, onClick: () => void): HTMLElement {
  return h("button", { class: "mini-link", onclick: onClick }, label);
}
