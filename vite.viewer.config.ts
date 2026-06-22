import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the read-only graph viewer into a single self-contained HTML file
// (all JS/CSS inlined) under src/export/_generated/. The main app imports that
// file as a raw string and injects per-export graph data into it at download
// time, producing a shareable standalone HTML.
export default defineConfig({
  root: "viewer",
  plugins: [viteSingleFile()],
  build: {
    target: "es2020",
    outDir: "../src/export/_generated",
    emptyOutDir: true,
    // Avoid hashed asset names; everything is inlined anyway.
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5000,
  },
});
