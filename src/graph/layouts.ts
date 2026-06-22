import type cytoscape from "cytoscape";

export interface LayoutPreset {
  id: string;
  label: string;
  /** Build Cytoscape layout options. */
  options: () => cytoscape.LayoutOptions;
}

const animate = { animate: true as const, animationDuration: 350 };

/** Continuous, interactive physics. Handled specially by the graph view
 *  (run on visible elements, kept alive so drags and filters re-settle). */
export const PHYSICS_LAYOUT_ID = "physics";

/** Build cola options for the live physics simulation. */
export function physicsOptions(randomize: boolean): cytoscape.LayoutOptions {
  return {
    name: "cola",
    infinite: true,
    fit: false,
    animate: true,
    randomize,
    avoidOverlap: true,
    handleDisconnected: true,
    centerGraph: false, // don't recenter every tick — keeps drags stable
    nodeSpacing: () => 12,
    edgeLength: 95,
  } as unknown as cytoscape.LayoutOptions;
}

export const LAYOUTS: LayoutPreset[] = [
  {
    id: PHYSICS_LAYOUT_ID,
    label: "Physics (live)",
    options: () => physicsOptions(false),
  },
  {
    id: "fcose",
    label: "Force",
    options: () =>
      ({
        name: "fcose",
        quality: "default",
        randomize: true,
        nodeRepulsion: 8000,
        idealEdgeLength: 90,
        nodeSeparation: 90,
        padding: 40,
        ...animate,
      }) as unknown as cytoscape.LayoutOptions,
  },
  {
    id: "dagre",
    label: "Hierarchy",
    options: () =>
      ({
        name: "dagre",
        rankDir: "TB",
        nodeSep: 35,
        rankSep: 70,
        padding: 40,
        ...animate,
      }) as unknown as cytoscape.LayoutOptions,
  },
  {
    id: "concentric",
    label: "Concentric",
    options: () =>
      ({
        name: "concentric",
        concentric: (n: cytoscape.NodeSingular) => n.degree(false),
        levelWidth: () => 1,
        minNodeSpacing: 30,
        padding: 40,
        ...animate,
      }) as unknown as cytoscape.LayoutOptions,
  },
  {
    id: "circle",
    label: "Circle",
    options: () => ({ name: "circle", padding: 40, ...animate }),
  },
  {
    id: "grid",
    label: "Grid",
    options: () => ({ name: "grid", padding: 40, ...animate }),
  },
];

export function layoutById(id: string): LayoutPreset {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
}
