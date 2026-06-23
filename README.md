# Nevergraph

Turn collections of JSON objects into **interactive, directed network graphs** —
nodes and arcs — entirely in the browser. Point it at a JSON file, use the
guided mapping step to say which fields are identifiers, which are arcs (edges),
and which are categories, then explore: drag, hover, click for details, filter
and group by category, switch layouts, and export a self-contained shareable
HTML.

No backend, no install required to *use* a build — it runs as a static page.

## Why a guided mapping step

Real-world JSON varies wildly in shape, so there is no reliable way to
auto-detect what is a node vs. an edge vs. a tag. The two bundled examples show
the range:

- **`example_datasets/neverwas.json`** — a single object holding *two*
  collections (`items`, `storylets`). Node ids are UUIDs. Arcs are **arrays of
  objects** with a nested id key (`children[].id`, `itemLocks[].itemID`), and
  `itemLocks` carries edge metadata (`value`, `isConsumed`).
- **`example_datasets/larp.json`** — a flat array of 90 records. The arc field
  `Legami` is a **plain array of id strings**, effectively undirected and
  containing self-references. Field names are in Italian.

Nevergraph introspects the file, suggests a sensible mapping, and lets you
confirm or override every choice:

- **Node id / label / type** per collection (a field can also *split* one
  collection into several node types).
- **Arcs**: pick the array field; whether the target id is the element itself or
  a nested key; directed vs. undirected; drop self-loops; merge reciprocal
  edges; and which extra element keys to keep as edge metadata.
- **Categories / tags**: low-cardinality fields become filterable facets and
  colour/shape encodings.
- A live preview shows node/edge counts and warns about dangling references,
  duplicate ids, dropped self-loops, etc.

## Features

- **Live physics (default):** a continuous force simulation where dragging a
  node pushes its neighbours and filtering lets the graph re-settle into the
  freed space. Switch to a static layout any time.
- Force, hierarchy (DAG), concentric, circle and grid layouts.
- **Three independent encoding channels** — colour, shape and pattern (SVG
  texture) can each be bound to node type or any category facet, so you can show
  several categorisations at once (e.g. colour by faction, shape by role,
  pattern by status). Plus size by degree or a numeric field, directed-edge
  arrowheads, and a multi-section legend.
- Drag, hover-highlight + tooltip, click-to-select with a full detail panel
  (all fields, long text, clickable in/out neighbours), right-click context
  menu (focus neighbourhood, hide, pin), double-click to focus.
- **Configurable hover tooltips:** choose per node type which fields appear on
  hover (a "Show on hover" picker in the wizard, saved with the profile). The
  tooltip and detail panel share one formatter, so values render consistently.
- Left panel: toggle node/edge types, per-facet value filters, text search,
  hide-vs-dim modes.
- **Save mapping profiles** (kept in `localStorage`, keyed by dataset shape) so
  the next file of the same shape is mapped automatically. Import/export a
  mapping as JSON from the wizard.
- **Export a standalone interactive HTML** — the whole viewer and graph data
  inlined into one file that opens offline and can be shared.

## Requirements & setup

- Node.js ≥ 20.19.
- A package manager. This repo was developed with [pnpm](https://pnpm.io)
  (`npm` was unavailable on the dev machine); npm/yarn work too.

```bash
pnpm install
pnpm run dev      # start the dev server (also builds the export viewer first)
pnpm run build    # production build into dist/
pnpm run preview  # serve the production build
pnpm run typecheck
```

Open the dev server URL, then drop a JSON file (or click an example).

> The build runs in two steps: `build:viewer` produces the self-contained
> standalone-export template (`src/export/_generated/index.html`, git-ignored),
> then the main app build inlines it. `pnpm run dev` / `pnpm run build` do this
> for you.

## Architecture

```
src/
  io/         loadJson · introspect (structure + field catalog) · profileStore
  mapping/    paths · suggest (heuristics) · buildGraph (profile -> graph)
  graph/      graphView (Cytoscape + interactions) · style · elements · layouts · palette
  ui/         landing · wizard · toolbar · filters · detailPanel · legend · dom
  export/     exportHtml (inlines data into the prebuilt viewer)
  state.ts · types.ts · main.ts
viewer/       the read-only standalone viewer (reuses src/graph + src/ui)
scripts/      selftest.ts (pipeline checks) · e2e.mjs (headless UI checks)
```

Data flow: **raw JSON → `DatasetCatalog` (introspection) → `MappingProfile`
(guided wizard) → `GraphModel` (`buildGraph`) → Cytoscape render**.

Rendering uses [Cytoscape.js](https://js.cytoscape.org/) with the `fcose` and
`dagre` layout extensions, plus `cola` for the continuous live-physics
simulation. There is no UI framework — the interactive canvas is Cytoscape and
the surrounding chrome is plain TypeScript + CSS.

## Tests

```bash
pnpm dlx tsx scripts/selftest.ts      # parse/graph pipeline vs. both datasets
SHOT_DIR=/tmp/shots node scripts/e2e.mjs   # headless Chromium UI + export check
```

The e2e script needs a Chromium/Chrome binary (set in `scripts/e2e.mjs`,
default `/usr/bin/chromium`) and a prior `pnpm run build`.
