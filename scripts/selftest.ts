/* Ad-hoc self-test of the pure parse->graph pipeline against the example
 * datasets. Run with: pnpm dlx tsx scripts/selftest.ts                        */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { JsonValue, MappingProfile } from "../src/types";
import { introspect } from "../src/io/introspect";
import { suggestProfile } from "../src/mapping/suggest";
import { buildGraph } from "../src/mapping/buildGraph";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string): JsonValue =>
  JSON.parse(
    readFileSync(resolve(here, "..", "example_datasets", name), "utf8"),
  ) as JsonValue;

function summarizeProfile(p: MappingProfile): void {
  for (const c of p.collections) {
    console.log(
      `  • ${c.collection} -> type "${c.nodeType}" | id=${c.idField} label=${c.labelField}`,
    );
    console.log(
      `    categories: [${c.categoryFields.join(", ")}]  numeric: [${c.numericFields.join(", ")}]`,
    );
    for (const a of c.arcs) {
      console.log(
        `    arc "${a.edgeType}" field=${a.field} mode=${a.idMode}${a.idKey ? `(${a.idKey})` : ""} directed=${a.directed} meta=[${a.metadataKeys.join(",")}]`,
      );
    }
  }
}

function run(name: string, file: string): void {
  console.log(`\n=== ${name} (${file}) ===`);
  const root = load(file);
  const catalog = introspect(root);
  console.log(
    `rootKind=${catalog.rootKind} collections=${catalog.collections.map((c) => `${c.name}(${c.recordCount})`).join(", ")} sig=${catalog.shapeSignature}`,
  );
  const profile = suggestProfile(catalog);
  summarizeProfile(profile);
  const g = buildGraph(root, catalog, profile);
  const r = g.report;
  console.log(
    `GRAPH: nodes=${r.nodeCount} edges=${r.edgeCount} types=[${g.nodeTypes.join(",")}] edgeTypes=[${g.edgeTypes.join(",")}]`,
  );
  console.log(
    `  dangling=${r.danglingRefs.length} selfLoopsDropped=${r.selfLoopsDropped} reciprocalDeduped=${r.reciprocalDeduped} dupes=${r.duplicateIds.length} skipped=[${r.skippedCollections.join(",")}]`,
  );
  console.log(`  facets: ${Object.keys(g.facets).map((k) => `${k}(${g.facets[k].length})`).join(", ")}`);
  if (r.danglingRefs.length)
    console.log(
      `  e.g. dangling: ${r.danglingRefs.slice(0, 3).map((d) => `${d.edgeType}->${d.targetRawId}`).join(", ")}`,
    );
  return;
}

run("Neverwas", "neverwas.json");
run("LARP", "larp.json");

// Verify the undirected path the user would pick in the wizard for LARP.
console.log(`\n=== LARP with Legami marked UNDIRECTED + dedupe reciprocal ===`);
const root = load("larp.json");
const catalog = introspect(root);
const profile = suggestProfile(catalog);
for (const c of profile.collections)
  for (const a of c.arcs)
    if (a.field === "Legami") {
      a.directed = false;
      a.dedupeReciprocal = true;
      a.dropSelfLoops = true;
    }
const g = buildGraph(root, catalog, profile);
console.log(
  `GRAPH: nodes=${g.report.nodeCount} edges=${g.report.edgeCount} selfLoopsDropped=${g.report.selfLoopsDropped} reciprocalDeduped=${g.report.reciprocalDeduped} dangling=${g.report.danglingRefs.length}`,
);
