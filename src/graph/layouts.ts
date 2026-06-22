import type cytoscape from "cytoscape";

export interface LayoutPreset {
  id: string;
  label: string;
  /** Build Cytoscape layout options. */
  options: () => cytoscape.LayoutOptions;
}

const animate = { animate: true as const, animationDuration: 350 };

export const LAYOUTS: LayoutPreset[] = [
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
