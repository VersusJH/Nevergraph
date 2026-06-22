import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import dagre from "cytoscape-dagre";
import type { GNode, GraphModel } from "../types";
import type { EncodingConfig, FilterState, Selection } from "../state";
import { applyEncoding, baseStylesheet, type LegendData } from "./style";
import { toElements } from "./elements";
import { layoutById } from "./layouts";

let registered = false;
function registerExtensions(): void {
  if (registered) return;
  cytoscape.use(fcose);
  cytoscape.use(dagre);
  registered = true;
}

export interface GraphViewCallbacks {
  onSelect: (sel: Selection | null) => void;
  onLegend: (legend: LegendData) => void;
}

export interface GraphView {
  setGraph: (graph: GraphModel, layoutId: string, enc: EncodingConfig) => void;
  setEncoding: (enc: EncodingConfig) => void;
  runLayout: (id: string) => void;
  applyFilters: (filters: FilterState) => void;
  focus: (nodeId: string) => void;
  clearFocus: () => void;
  selectById: (id: string) => void;
  fit: () => void;
  getCy: () => cytoscape.Core;
  destroy: () => void;
}

export function createGraphView(
  container: HTMLElement,
  cb: GraphViewCallbacks,
): GraphView {
  registerExtensions();

  const cy = cytoscape({
    container,
    style: baseStylesheet() as cytoscape.CytoscapeOptions["style"],
    wheelSensitivity: 0.2,
    minZoom: 0.05,
    maxZoom: 4,
  });

  let graph: GraphModel | null = null;
  let nodeById = new Map<string, GNode>();
  let filters: FilterState | null = null;
  let focusId: string | null = null;
  let lastTap = { id: "", t: 0 };

  // ---------------------------- tooltip -----------------------------
  const tip = document.createElement("div");
  tip.className = "cy-tooltip";
  tip.style.display = "none";
  container.appendChild(tip);

  function showTip(node: cytoscape.NodeSingular): void {
    const n = nodeById.get(node.id());
    if (!n) return;
    const cats = Object.entries(n.categories)
      .map(([k, v]) => `<span class="tip-cat">${esc(k)}: ${esc(v.join(", "))}</span>`)
      .join("");
    tip.innerHTML = `<strong>${esc(n.label)}</strong><span class="tip-type">${esc(n.type)}</span>${cats}`;
    const p = node.renderedPosition();
    const size = node.renderedHeight();
    tip.style.left = `${p.x}px`;
    tip.style.top = `${p.y - size / 2 - 8}px`;
    tip.style.display = "block";
  }
  const hideTip = () => (tip.style.display = "none");

  // -------------------------- context menu --------------------------
  const menu = document.createElement("div");
  menu.className = "cy-ctxmenu";
  menu.style.display = "none";
  document.body.appendChild(menu);
  const hideMenu = () => (menu.style.display = "none");
  document.addEventListener("click", hideMenu);
  document.addEventListener("scroll", hideMenu, true);

  function showMenu(node: cytoscape.NodeSingular, x: number, y: number): void {
    const pinned = node.hasClass("pinned");
    menu.innerHTML = "";
    const add = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = (e) => {
        e.stopPropagation();
        hideMenu();
        fn();
      };
      menu.appendChild(b);
    };
    add("Show details", () => selectNode(node));
    add("Focus neighborhood", () => doFocus(node.id()));
    add("Hide this node", () => {
      node.addClass("hidden");
      node.connectedEdges().addClass("hidden");
    });
    add(pinned ? "Unpin" : "Pin position", () => {
      if (pinned) {
        node.removeClass("pinned");
        node.unlock();
      } else {
        node.addClass("pinned");
        node.lock();
      }
    });
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = "block";
  }

  // -------------------------- interactions --------------------------
  cy.on("mouseover", "node", (e) => {
    const node = e.target as cytoscape.NodeSingular;
    node.addClass("highlight");
    node.connectedEdges().addClass("highlight");
    node.neighborhood("node").addClass("highlight");
    showTip(node);
  });
  cy.on("mouseout", "node", (e) => {
    cy.elements().removeClass("highlight");
    hideTip();
    void e;
  });
  cy.on("pan zoom drag position", () => hideTip());

  cy.on("tap", "node", (e) => {
    const node = e.target as cytoscape.NodeSingular;
    const now = e.timeStamp ?? 0;
    if (lastTap.id === node.id() && now - lastTap.t < 320) {
      doFocus(node.id()); // double-tap → focus
    }
    lastTap = { id: node.id(), t: now };
    selectNode(node);
  });
  cy.on("tap", "edge", (e) => {
    const edge = e.target as cytoscape.EdgeSingular;
    cy.elements().unselect();
    edge.select();
    cb.onSelect({ kind: "edge", id: edge.id() });
  });
  cy.on("tap", (e) => {
    if (e.target === cy) {
      cy.elements().unselect();
      cb.onSelect(null);
      if (focusId) doClearFocus();
    }
  });
  cy.on("cxttap", "node", (e) => {
    const oe = e.originalEvent as MouseEvent;
    showMenu(e.target as cytoscape.NodeSingular, oe.clientX, oe.clientY);
  });

  function selectNode(node: cytoscape.NodeSingular): void {
    cy.elements().unselect();
    node.select();
    cb.onSelect({ kind: "node", id: node.id() });
  }

  // ------------------------------ api ------------------------------
  function refresh(): void {
    if (!graph || !filters) return;
    const f = filters;
    const q = f.search.trim().toLowerCase();
    const neighborhood = focusId
      ? new Set(
          cy
            .getElementById(focusId)
            .closedNeighborhood()
            .nodes()
            .map((n) => n.id()),
        )
      : null;

    const passesFilter = (n: GNode): boolean => {
      if (f.hiddenNodeTypes.has(n.type)) return false;
      for (const [facet, off] of Object.entries(f.facetOff)) {
        if (off.size === 0) continue;
        const vals = n.categories[facet];
        if (vals && vals.length > 0 && vals.every((v) => off.has(v)))
          return false;
      }
      return true;
    };
    const matches = (n: GNode): boolean => {
      if (!q) return true;
      if (n.label.toLowerCase().includes(q)) return true;
      if (n.rawId.toLowerCase().includes(q)) return true;
      return Object.values(n.categories).some((vs) =>
        vs.some((v) => v.toLowerCase().includes(q)),
      );
    };

    const state = new Map<string, "hidden" | "dimmed" | "normal">();
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const n = nodeById.get(node.id());
        if (!n) return;
        let st: "hidden" | "dimmed" | "normal";
        if (!passesFilter(n)) {
          st = f.mode === "hide" ? "hidden" : "dimmed";
        } else if (
          (neighborhood && !neighborhood.has(n.id)) ||
          !matches(n)
        ) {
          st = "dimmed"; // focus / search spotlight (soft)
        } else {
          st = "normal";
        }
        state.set(node.id(), st);
        node.removeClass("hidden dimmed");
        if (st !== "normal") node.addClass(st);
      });
      cy.edges().forEach((edge) => {
        const s = state.get(edge.data("source"));
        const t = state.get(edge.data("target"));
        const typeOff = f.hiddenEdgeTypes.has(edge.data("type"));
        edge.removeClass("hidden dimmed");
        if (typeOff && f.mode === "hide") {
          edge.addClass("hidden");
        } else if (s === "hidden" || t === "hidden") {
          edge.addClass("hidden");
        } else if (typeOff || s === "dimmed" || t === "dimmed") {
          edge.addClass("dimmed");
        }
      });
    });
  }

  function doFocus(id: string): void {
    focusId = id;
    refresh();
    const hood = cy.getElementById(id).closedNeighborhood();
    if (hood.length)
      cy.animate({ fit: { eles: hood, padding: 60 }, duration: 350 });
  }
  function doClearFocus(): void {
    focusId = null;
    refresh();
  }

  return {
    setGraph(g, layoutId, enc) {
      graph = g;
      nodeById = new Map(g.nodes.map((n) => [n.id, n]));
      focusId = null;
      cy.elements().remove();
      const { nodes, edges } = toElements(g);
      cy.add(nodes);
      cy.add(edges);
      cb.onLegend(applyEncoding(cy, g, enc));
      cy.layout(layoutById(layoutId).options()).run();
    },
    setEncoding(enc) {
      if (graph) cb.onLegend(applyEncoding(cy, graph, enc));
    },
    runLayout(id) {
      cy.layout(layoutById(id).options()).run();
    },
    applyFilters(f) {
      filters = f;
      refresh();
    },
    focus: doFocus,
    clearFocus: doClearFocus,
    selectById(id) {
      const ele = cy.getElementById(id);
      if (ele.nonempty()) {
        cy.elements().unselect();
        ele.select();
        if (ele.isNode())
          cy.animate({ center: { eles: ele }, duration: 250 });
      }
    },
    fit() {
      cy.animate({ fit: { eles: cy.elements(":visible"), padding: 50 }, duration: 300 });
    },
    getCy: () => cy,
    destroy() {
      tip.remove();
      menu.remove();
      cy.destroy();
    },
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
