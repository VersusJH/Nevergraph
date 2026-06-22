// Vite raw imports (used to inline the prebuilt standalone viewer).
declare module "*?raw" {
  const content: string;
  export default content;
}

// Cytoscape layout extensions ship without bundled type definitions.
declare module "cytoscape-fcose" {
  import type { Ext } from "cytoscape";
  const ext: Ext;
  export default ext;
}
declare module "cytoscape-dagre" {
  import type { Ext } from "cytoscape";
  const ext: Ext;
  export default ext;
}
declare module "cytoscape-cola" {
  import type { Ext } from "cytoscape";
  const ext: Ext;
  export default ext;
}
