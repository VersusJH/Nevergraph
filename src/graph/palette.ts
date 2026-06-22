// Categorical color + shape scales. Assignment is deterministic given the
// sorted key list, so colors stay stable across re-renders and in the legend.

export const PALETTE = [
  "#7c9eff",
  "#63d2a4",
  "#f4a259",
  "#e26d8b",
  "#b18cff",
  "#5bc0de",
  "#f7c948",
  "#7bd389",
  "#ff8fa3",
  "#9aa7ff",
  "#54c7ec",
  "#d4a373",
  "#a3e635",
  "#fb7185",
  "#22d3ee",
  "#c084fc",
  "#facc15",
  "#34d399",
  "#f472b6",
  "#60a5fa",
];

export const NODE_SHAPES = [
  "ellipse",
  "round-rectangle",
  "diamond",
  "hexagon",
  "triangle",
  "pentagon",
  "star",
  "octagon",
  "barrel",
  "round-tag",
];

export const NO_VALUE_COLOR = "#5b6675";
export const EDGE_PALETTE = PALETTE;

export function colorScale(keys: string[]): Map<string, string> {
  const m = new Map<string, string>();
  keys.forEach((k, i) => m.set(k, PALETTE[i % PALETTE.length]));
  return m;
}

export function shapeScale(keys: string[]): Map<string, string> {
  const m = new Map<string, string>();
  keys.forEach((k, i) => m.set(k, NODE_SHAPES[i % NODE_SHAPES.length]));
  return m;
}
