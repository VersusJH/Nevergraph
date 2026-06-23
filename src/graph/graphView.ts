import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import dagre from "cytoscape-dagre";
import cola from "cytoscape-cola";
import type { GNode, GraphModel, JsonValue } from "../types";
import type { EncodingConfig, FilterState, Selection } from "../state";
import { applyEncoding, baseStylesheet, type LegendData } from "./style";
import { toElements } from "./elements";
import { layoutById, physicsOptions, PHYSICS_LAYOUT_ID } from "./layouts";
import { h } from "../ui/dom";
import { renderFieldRows } from "../ui/fieldFormat";

let registered = false;
function registerExtensions(): void {
  if (registered) return;
  cytoscape.use(fcose);
  cytoscape.use(dagre);
  cytoscape.use(cola);
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
  setSpread: (spread: number) => void;
  setGrouping: (dimension: string) => void;
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

  // Live physics (cytoscape-cola, kept running so drags + filters re-settle).
  let physicsOn = false;
  let physicsSim: cytoscape.Layouts | null = null;
  let lastHiddenSig = "";
  let spread = 1;
  let userLayoutId: string = PHYSICS_LAYOUT_ID;
  let groupBy = "none";

  const hiddenSig = (): string =>
    cy
      .nodes(".hidden")
      .not(".group")
      .map((n) => n.id())
      .sort()
      .join("|");

  const groupValue = (n: GNode): string | undefined =>
    groupBy === "type" ? n.type : n.categories[groupBy]?.[0];

  /** Wrap nodes in compound parent boxes by the current grouping dimension. */
  function applyGroups(): void {
    // Tear down any existing groups: orphan children first, then remove parents.
    const existing = cy.nodes(".group");
    if (existing.nonempty()) {
      cy.nodes()
        .not(".group")
        .forEach((n) => {
          if (n.parent().nonempty()) n.move({ parent: null });
        });
      existing.remove();
    }
    if (groupBy === "none" || !graph) return;

    const parentId = (val: string) => `__grp:${groupBy}:${val}`;
    const seen = new Set<string>();
    for (const gn of graph.nodes) {
      const val = groupValue(gn);
      if (val && !seen.has(val)) {
        seen.add(val);
        cy.add({
          group: "nodes",
          data: { id: parentId(val), label: val, isGroup: true },
          classes: "group",
        });
      }
    }
    for (const gn of graph.nodes) {
      const val = groupValue(gn);
      const ele = cy.getElementById(gn.id);
      if (ele.nonempty()) ele.move({ parent: val ? parentId(val) : null });
    }
  }

  function stopPhysics(): void {
    physicsSim?.stop();
    physicsSim = null;
  }

  /** (Re)start the continuous simulation over the currently-visible nodes. */
  function startPhysics(randomize: boolean): void {
    stopPhysics();
    const eles = cy.elements(":visible");
    if (eles.length === 0) return;
    physicsSim = eles.layout(physicsOptions(randomize, spread));
    physicsSim.run();
    lastHiddenSig = hiddenSig();
  }

  /** Run the user's chosen layout — but live physics can't separate compound
   *  groups, so while grouping is on we fall back to the force layout. */
  function applyLayout(isInitial: boolean): void {
    const id =
      groupBy !== "none" && userLayoutId === PHYSICS_LAYOUT_ID
        ? "fcose"
        : userLayoutId;
    if (id === PHYSICS_LAYOUT_ID) {
      physicsOn = true;
      if (isInitial) {
        // Seed with a quick force layout for good initial placement, then go
        // live so subsequent drags and filters re-settle with physics.
        const seed = cy.layout(layoutById("fcose").options(spread));
        seed.one("layoutstop", () => startPhysics(false));
        seed.run();
      } else {
        startPhysics(false);
      }
    } else {
      physicsOn = false;
      stopPhysics();
      cy.layout(layoutById(id).options(spread)).run();
    }
  }

  function setSpread(value: number): void {
    spread = value;
    if (graph) applyLayout(false); // re-settle with the new spacing
  }

  function setGrouping(dimension: string): void {
    groupBy = dimension;
    if (!graph) return;
    applyGroups();
    if (filters) refresh();
    applyLayout(false);
  }

  // ---------------------------- tooltip -----------------------------
  const tip = document.createElement("div");
  tip.className = "cy-tooltip";
  tip.style.display = "none";
  container.appendChild(tip);

  function showTip(node: cytoscape.NodeSingular): void {
    const n = nodeById.get(node.id());
    if (!n) return;
    // Per-node-type field list, configured in the wizard (rides in the graph
    // model). Skip fields the node doesn't carry so it degrades gracefully.
    const fields = (graph?.tooltipFieldsByType ?? {})[n.type] ?? [];
    const entries: [string, JsonValue][] = [];
    for (const f of fields) {
      const v = n.data[f];
      if (v === null || v === undefined) continue;
      if (typeof v === "string" && v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      entries.push([f, v]);
    }
    tip.replaceChildren(
      h("div", { class: "tip-head" }, [
        h("strong", { class: "tip-label" }, n.label),
        h("span", { class: "tip-type" }, n.type),
      ]),
    );
    if (entries.length) tip.append(renderFieldRows(entries, { compact: true }));
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
  // Note: not "position" — under live physics that fires every frame and would
  // hide tooltips constantly. Pan/zoom/drag are user-initiated.
  cy.on("pan zoom drag", () => hideTip());

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
    const node = e.target as cytoscape.NodeSingular;
    if (node.hasClass("group")) return; // group boxes have no per-node actions
    const oe = e.originalEvent as MouseEvent;
    showMenu(node, oe.clientX, oe.clientY);
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

    // Hide a cluster box once all its members are filtered out.
    cy.nodes(".group").forEach((g) => {
      const visibleChildren = g.children().filter((c) => !c.hasClass("hidden"));
      if (visibleChildren.length) g.removeClass("hidden");
      else g.addClass("hidden");
    });

    // When hiding/showing changes the visible set, re-settle physics so the
    // remaining nodes reflow into (or out of) the freed space.
    if (physicsOn && hiddenSig() !== lastHiddenSig) startPhysics(false);
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
      stopPhysics();
      graph = g;
      nodeById = new Map(g.nodes.map((n) => [n.id, n]));
      focusId = null;
      lastHiddenSig = "";
      cy.elements().remove();
      const { nodes, edges } = toElements(g);
      cy.add(nodes);
      cy.add(edges);
      cb.onLegend(applyEncoding(cy, g, enc));
      userLayoutId = layoutId;
      groupBy = enc.groupBy ?? "none";
      applyGroups();
      applyLayout(true);
    },
    setEncoding(enc) {
      if (graph) cb.onLegend(applyEncoding(cy, graph, enc));
    },
    runLayout(id) {
      userLayoutId = id;
      applyLayout(false);
    },
    setSpread,
    setGrouping,
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
      stopPhysics();
      tip.remove();
      menu.remove();
      cy.destroy();
    },
  };
}
