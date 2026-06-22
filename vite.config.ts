import { defineConfig } from "vite";

// The main app is a static, browser-only SPA. `base: "./"` keeps asset URLs
// relative so a production build can be served from any path (or opened
// directly). The standalone-HTML export feature uses its own inlining step
// (see src/export/) rather than a separate Vite build.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    // cytoscape + the on-demand viewer template are inherently large; the
    // export template is code-split so the initial chunk stays reasonable.
    chunkSizeWarningLimit: 1500,
  },
});
