import type cytoscape from "cytoscape";

export interface LayoutPreset {
  id: string;
  label: string;
  /** Build Cytoscape layout options. `spread` (default 1) scales the
   *  spacing/repulsion so the user can pull clusters apart. */
  options: (spread: number) => cytoscape.LayoutOptions;
}

const animate = { animate: true as const, animationDuration: 350 };

/** Continuous, interactive physics. Handled specially by the graph view
 *  (run on visible elements, kept alive so drags and filters re-settle). */
export const PHYSICS_LAYOUT_ID = "physics";

/** Build cola options for the live physics simulation. */
export function physicsOptions(
  randomize: boolean,
  spread = 1,
): cytoscape.LayoutOptions {
  return {
    name: "cola",
    infinite: true,
    fit: false,
    animate: true,
    randomize,
    avoidOverlap: true,
    handleDisconnected: true,
    centerGraph: false, // don't recenter every tick — keeps drags stable
    nodeSpacing: () => 12 * spread,
    edgeLength: 95 * spread,
  } as unknown as cytoscape.LayoutOptions;
}

export const LAYOUTS: LayoutPreset[] = [
  {
    id: PHYSICS_LAYOUT_ID,
    label: "Physics (live)",
    options: (spread) => physicsOptions(false, spread),
  },
  {
    id: "fcose",
    label: "Force",
    options: (spread) =>
      ({
        name: "fcose",
        quality: "default",
        randomize: true,
        nodeRepulsion: 8000 * spread,
        idealEdgeLength: 90 * spread,
        nodeSeparation: 90 * spread,
        padding: 40,
        ...animate,
      }) as unknown as cytoscape.LayoutOptions,
  },
  {
    id: "dagre",
    label: "Hierarchy",
    options: (spread) =>
      ({
        name: "dagre",
        rankDir: "TB",
        nodeSep: 35 * spread,
        rankSep: 70 * spread,
        padding: 40,
        ...animate,
      }) as unknown as cytoscape.LayoutOptions,
  },
  {
    id: "concentric",
    label: "Concentric",
    options: (spread) =>
      ({
        name: "concentric",
        concentric: (n: cytoscape.NodeSingular) => n.degree(false),
        levelWidth: () => 1,
        minNodeSpacing: 30 * spread,
        padding: 40,
        ...animate,
      }) as unknown as cytoscape.LayoutOptions,
  },
  {
    id: "circle",
    label: "Circle",
    options: (spread) =>
      ({ name: "circle", spacingFactor: spread, padding: 40, ...animate }) as unknown as cytoscape.LayoutOptions,
  },
  {
    id: "grid",
    label: "Grid",
    options: (spread) =>
      ({ name: "grid", spacingFactor: spread, padding: 40, ...animate }) as unknown as cytoscape.LayoutOptions,
  },
];

export function layoutById(id: string): LayoutPreset {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
}
