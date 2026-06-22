import viewerTemplate from "./_generated/index.html?raw";
import type { GraphModel } from "../types";
import type { EncodingConfig } from "../state";
import { downloadText } from "../io/download";

const DATA_MARKER = '<script id="ng-data" type="application/json">';

export interface ExportOptions {
  graph: GraphModel;
  encoding: EncodingConfig;
  layout: string;
  fileName: string | null;
}

/** Produce and download a self-contained interactive HTML of the graph. */
export function exportStandaloneHtml(opts: ExportOptions): void {
  if (!viewerTemplate.includes(DATA_MARKER)) {
    throw new Error("Viewer template is missing its data slot.");
  }
  const payload = {
    graph: opts.graph,
    encoding: opts.encoding,
    layout: opts.layout,
    fileName: opts.fileName,
  };
  // Escape "<" so the JSON can never break out of the <script> tag.
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const html = viewerTemplate.replace(DATA_MARKER, DATA_MARKER + json);

  const base = (opts.fileName ?? "graph").replace(/\.json$/i, "") || "graph";
  downloadText(`${base}-nevergraph.html`, html, "text/html");
}
