import type cytoscape from "cytoscape";
import type { GNode, GraphModel } from "../types";
import type { EncodingConfig } from "../state";
import {
  NO_VALUE_COLOR,
  colorScale,
  patternScale,
  shapeScale,
} from "./palette";

export type LegendChannel = "color" | "shape" | "pattern";
export interface LegendItem {
  label: string;
  color?: string;
  shape?: string;
  pattern?: string;
}
export interface LegendGroup {
  channel: LegendChannel;
  title: string;
  items: LegendItem[];
}
export interface LegendData {
  groups: LegendGroup[];
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
    // Pattern channel: only applied to nodes that actually carry a texture, so
    // un-patterned nodes never get a (broken, empty-string) background-image.
    {
      selector: "node.patterned",
      style: {
        "background-image": "data(pattern)",
        "background-fit": "cover",
        "background-clip": "node",
        "background-image-opacity": 0.5,
      },
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

/** The categorical values a dimension ("type" or a facet) spans. */
function domainFor(graph: GraphModel, dim: string): string[] {
  return dim === "type" ? graph.nodeTypes : (graph.facets[dim] ?? []);
}

/** The value a node takes for a dimension (first value for multi-value facets). */
function valueFor(node: GNode, dim: string): string | undefined {
  return dim === "type" ? node.type : node.categories[dim]?.[0];
}

function dimTitle(dim: string): string {
  return dim === "type" ? "node type" : dim;
}

/** Compute and write colour/shape/pattern/size onto every element for an
 *  encoding, returning legend data for the UI. Colour, shape and pattern are
 *  three independent channels, each bound to its own dimension. */
export function applyEncoding(
  cy: cytoscape.Core,
  graph: GraphModel,
  enc: EncodingConfig,
): LegendData {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // ---- colour (always on) ----
  const colorVals = domainFor(graph, enc.colorBy);
  const colors = colorScale(colorVals);
  const colorFor = (n: GNode): string => {
    const v = valueFor(n, enc.colorBy);
    return v ? (colors.get(v) ?? NO_VALUE_COLOR) : NO_VALUE_COLOR;
  };

  // ---- shape (off when "uniform") ----
  const shapeUniform = enc.shapeBy === "uniform";
  const shapeVals = shapeUniform ? [] : domainFor(graph, enc.shapeBy);
  const shapes = shapeScale(shapeVals);
  const shapeFor = (n: GNode): string => {
    if (shapeUniform) return "ellipse";
    const v = valueFor(n, enc.shapeBy);
    return v ? (shapes.get(v) ?? "ellipse") : "ellipse";
  };

  // ---- pattern (off when "none") ----
  const patternOff = enc.patternBy === "none";
  const patternVals = patternOff ? [] : domainFor(graph, enc.patternBy);
  const patterns = patternScale(patternVals);
  const patternFor = (n: GNode): string => {
    if (patternOff) return "";
    const v = valueFor(n, enc.patternBy);
    return v ? (patterns.get(v) ?? "") : "";
  };

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
    cy.nodes().forEach((cn) => {
      const n = nodeById.get(cn.id());
      if (!n) return;
      cn.data("color", colorFor(n));
      cn.data("shape", shapeFor(n));
      cn.data("size", Math.round(sizeFor(cn)));
      const pat = patternFor(n);
      cn.data("pattern", pat);
      if (pat) cn.addClass("patterned");
      else cn.removeClass("patterned");
    });
    cy.edges().forEach((e) => {
      e.data("color", edgeColors.get(e.data("type")) ?? "#3c4655");
    });
  });

  // ---- legend ----
  const groups: LegendGroup[] = [];
  groups.push({
    channel: "color",
    title: `Colour · ${dimTitle(enc.colorBy)}`,
    items: legendItems(colorVals, enc.colorBy, (v) => ({
      label: v,
      color: colors.get(v),
    })),
  });
  if (!shapeUniform && shapeVals.length > 1) {
    groups.push({
      channel: "shape",
      title: `Shape · ${dimTitle(enc.shapeBy)}`,
      items: legendItems(shapeVals, enc.shapeBy, (v) => ({
        label: v,
        shape: shapes.get(v),
      })),
    });
  }
  if (!patternOff && patternVals.length > 1) {
    groups.push({
      channel: "pattern",
      title: `Pattern · ${dimTitle(enc.patternBy)}`,
      items: legendItems(patternVals, enc.patternBy, (v) => ({
        label: v,
        pattern: patterns.get(v),
      })),
    });
  }
  return { groups };
}

/** Build legend items for a dimension, appending "(none)" for facets (whose
 *  nodes may lack a value). */
function legendItems(
  values: string[],
  dim: string,
  make: (v: string) => LegendItem,
): LegendItem[] {
  const items = values.slice(0, 24).map(make);
  if (dim !== "type") items.push({ label: "(none)" });
  return items;
}
