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

// --------------------------------- patterns --------------------------------
// Tileable textures rendered as SVG data-URIs, used as a node background-image
// (over the colour fill) to encode a third categorical dimension.

function svg(body: string): string {
  return (
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'>${body}</svg>`,
    )
  );
}

const STROKE = `stroke='white' stroke-width='9' fill='none'`;

function diagonal(dir: 1 | -1): string {
  const lines: string[] = [];
  for (let x = -100; x <= 100; x += 22) {
    lines.push(`<line x1='${x}' y1='0' x2='${x + dir * 100}' y2='100'/>`);
  }
  return svg(`<g ${STROKE}>${lines.join("")}</g>`);
}
function straight(horizontal: boolean): string {
  const lines: string[] = [];
  for (let p = 11; p < 100; p += 22) {
    lines.push(
      horizontal
        ? `<line x1='0' y1='${p}' x2='100' y2='${p}'/>`
        : `<line x1='${p}' y1='0' x2='${p}' y2='100'/>`,
    );
  }
  return svg(`<g ${STROKE}>${lines.join("")}</g>`);
}
function crosshatch(): string {
  const lines: string[] = [];
  for (let p = 11; p < 100; p += 22) {
    lines.push(`<line x1='0' y1='${p}' x2='100' y2='${p}'/>`);
    lines.push(`<line x1='${p}' y1='0' x2='${p}' y2='100'/>`);
  }
  return svg(`<g ${STROKE}>${lines.join("")}</g>`);
}
function dots(): string {
  const c: string[] = [];
  for (let y = 16; y < 100; y += 28)
    for (let x = 16; x < 100; x += 28)
      c.push(`<circle cx='${x}' cy='${y}' r='7' fill='white'/>`);
  return svg(c.join(""));
}

/** Distinct textures; the first categories get the most legible ones. */
export const PATTERNS = [
  diagonal(1),
  dots(),
  straight(true),
  crosshatch(),
  diagonal(-1),
  straight(false),
];

export function patternScale(keys: string[]): Map<string, string> {
  const m = new Map<string, string>();
  keys.forEach((k, i) => m.set(k, PATTERNS[i % PATTERNS.length]));
  return m;
}
