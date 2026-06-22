import type cytoscape from "cytoscape";
import type { GraphModel } from "../types";
import type { EncodingConfig } from "../state";
import { NO_VALUE_COLOR, colorScale, shapeScale } from "./palette";

export interface LegendItem {
  label: string;
  color: string;
  shape?: string;
}
export interface LegendData {
  colorTitle: string;
  colorItems: LegendItem[];
  shapeTitle: string;
  shapeItems: LegendItem[];
}

const SIZE_MIN = 18;
const SIZE_MAX = 60;
const SIZE_UNIFORM = 28;

function scaleLinear(
  v: number,
  d0: number,
  d1: number,
  r0: number,
  r1: number,
): number {
  if (d1 <= d0) return (r0 + r1) / 2;
  const t = Math.max(0, Math.min(1, (v - d0) / (d1 - d0)));
  return r0 + t * (r1 - r0);
}

/** Static stylesheet; per-element visuals are read from element `data`.
 *  Typed loosely because Cytoscape's style value types reject the
 *  `data(...)` mappers and function values we rely on. */
export function baseStylesheet(): unknown[] {
  const style: unknown[] = [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        shape: "data(shape)",
        width: "data(size)",
        height: "data(size)",
        label: "data(label)",
        color: "#c9d4e3",
        "font-size": 9,
        "font-family": "system-ui, sans-serif",
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 3,
        "text-wrap": "ellipsis",
        "text-max-width": "90px",
        "text-background-color": "#0e1117",
        "text-background-opacity": 0.55,
        "text-background-padding": "1px",
        "min-zoomed-font-size": 7,
        "border-width": 2,
        "border-color": "#0b0e14",
        "transition-property": "opacity",
        "transition-duration": "0.15s",
      },
    },
    {
      selector: "edge",
      style: {
        width: "data(width)",
        "line-color": "data(color)",
        "curve-style": "bezier",
        "target-arrow-shape": (ele: cytoscape.EdgeSingular) =>
          ele.data("directed") ? "triangle" : "none",
        "target-arrow-color": "data(color)",
        "arrow-scale": 0.85,
        opacity: 0.5,
      },
    },
    // Interaction states must NOT change node geometry (border-width / size):
    // under the live physics layout, a bbox change perturbs avoid-overlap and
    // makes the graph wobble on hover. Differentiate by colour / fill only.
    {
      selector: "node:selected",
      style: {
        "border-color": "#ffffff",
        "background-blacken": -0.25,
        "z-index": 20,
      },
    },
    {
      selector: "edge:selected",
      style: {
        width: 3,
        "line-color": "#ffffff",
        "target-arrow-color": "#ffffff",
        opacity: 1,
        "z-index": 20,
      },
    },
    {
      selector: "node.highlight",
      style: { "border-color": "#ffffff", "z-index": 15 },
    },
    { selector: "edge.highlight", style: { opacity: 1, width: 2.5, "z-index": 15 } },
    { selector: ".dimmed", style: { opacity: 0.08, "text-opacity": 0.04 } },
    {
      selector: "node.pinned",
      style: { "border-color": "#f4a259" },
    },
    { selector: ".hidden", style: { display: "none" } },
  ];
  return style;
}

/** Compute and write color/shape/size onto every element for an encoding,
 *  returning legend data for the UI. */
export function applyEncoding(
  cy: cytoscape.Core,
  graph: GraphModel,
  enc: EncodingConfig,
): LegendData {
  const shapes = shapeScale(graph.nodeTypes);
  const typeColors = colorScale(graph.nodeTypes);

  // ---- color ----
  let colorTitle: string;
  let colorItems: LegendItem[];
  let colorFor: (id: string, type: string) => string;

  if (enc.colorBy === "type") {
    colorTitle = "Node type";
    colorItems = graph.nodeTypes.map((t) => ({
      label: t,
      color: typeColors.get(t)!,
    }));
    colorFor = (_id, type) => typeColors.get(type) ?? NO_VALUE_COLOR;
  } else {
    const values = graph.facets[enc.colorBy] ?? [];
    const cs = colorScale(values);
    colorTitle = enc.colorBy;
    colorItems = values.map((v) => ({ label: v, color: cs.get(v)! }));
    colorItems.push({ label: "(none)", color: NO_VALUE_COLOR });
    const firstValByNode = new Map(
      graph.nodes.map((n) => [n.id, n.categories[enc.colorBy]?.[0]]),
    );
    colorFor = (id) => {
      const v = firstValByNode.get(id);
      return v ? (cs.get(v) ?? NO_VALUE_COLOR) : NO_VALUE_COLOR;
    };
  }

  // ---- size ----
  let sizeFor: (n: cytoscape.NodeSingular) => number;
  if (enc.sizeBy === "uniform") {
    sizeFor = () => SIZE_UNIFORM;
  } else if (enc.sizeBy === "degree") {
    let max = 1;
    cy.nodes().forEach((n) => {
      max = Math.max(max, n.data("degree") ?? 0);
    });
    sizeFor = (n) =>
      scaleLinear(n.data("degree") ?? 0, 0, max, SIZE_MIN, SIZE_MAX);
  } else {
    const range = graph.numericRanges[enc.sizeBy] ?? [0, 1];
    const numByNode = new Map(
      graph.nodes.map((n) => [n.id, n.numeric[enc.sizeBy]]),
    );
    sizeFor = (n) => {
      const v = numByNode.get(n.id());
      return v === undefined
        ? SIZE_MIN
        : scaleLinear(v, range[0], range[1], SIZE_MIN, SIZE_MAX);
    };
  }

  const edgeColors = colorScale(graph.edgeTypes);

  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const type = n.data("type");
      n.data("color", colorFor(n.id(), type));
      n.data("shape", shapes.get(type) ?? "ellipse");
      n.data("size", Math.round(sizeFor(n)));
    });
    cy.edges().forEach((e) => {
      e.data("color", edgeColors.get(e.data("type")) ?? "#3c4655");
    });
  });

  return {
    colorTitle,
    colorItems,
    shapeTitle: "Node type",
    shapeItems: graph.nodeTypes.map((t) => ({
      label: t,
      shape: shapes.get(t) ?? "ellipse",
      color: typeColors.get(t) ?? NO_VALUE_COLOR,
    })),
  };
}
