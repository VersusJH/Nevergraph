import { h, truncate } from "./dom";
import type { JsonValue } from "../types";
import { isPlainObject, scalarToString } from "../mapping/paths";

// Shared field-value formatting, used by BOTH the detail panel (full mode) and
// the hover tooltip (compact mode), so the two render fields identically.
//
// - full mode    : long text in a scrollable box; nested arrays/objects as
//                  expandable <details>.
// - compact mode : truncated text; chip lists capped; nested values shown as a
//                  short placeholder (tooltips are pointer-events:none, so no
//                  interactive <details>).

export interface FieldFormatOpts {
  compact?: boolean;
}

const COMPACT_CHIPS = 8;
const COMPACT_TEXT = 160;

/** Render a single JSON value as a <dd> cell. */
export function renderValue(v: JsonValue, opts: FieldFormatOpts = {}): HTMLElement {
  const compact = !!opts.compact;
  if (v === null || v === undefined) return h("dd", { class: "muted" }, "—");

  if (Array.isArray(v)) {
    if (v.length === 0) return h("dd", { class: "muted" }, "(empty)");
    const allScalar = v.every((e) => !Array.isArray(e) && !isPlainObject(e));
    if (allScalar) {
      const shown = compact ? v.slice(0, COMPACT_CHIPS) : v;
      const chips = shown.map((e) =>
        h("span", { class: "mini-chip" }, scalarToString(e as JsonValue)),
      );
      if (compact && v.length > COMPACT_CHIPS)
        chips.push(h("span", { class: "mini-chip muted" }, `+${v.length - COMPACT_CHIPS}`));
      return h("dd", { class: "val-chips" }, chips);
    }
    if (compact) return h("dd", { class: "muted" }, `${v.length} items`);
    return h("dd", {}, [collapsible(`${v.length} items`, v)]);
  }

  if (isPlainObject(v)) {
    if (compact) return h("dd", { class: "muted" }, "{…}");
    return h("dd", {}, [collapsible("object", v)]);
  }

  const s = scalarToString(v);
  if (s === "") return h("dd", {}, h("span", { class: "muted" }, "—"));
  if (compact) return h("dd", {}, truncate(s, COMPACT_TEXT));
  if (s.length > 140) return h("dd", { class: "val-long" }, s);
  return h("dd", {}, s);
}

/** Render `key: value` rows as a definition list. */
export function renderFieldRows(
  entries: [string, JsonValue][],
  opts: FieldFormatOpts = {},
): HTMLElement {
  const dl = h("dl", {
    class: opts.compact ? "field-list field-list-compact" : "field-list",
  });
  for (const [k, v] of entries) {
    dl.append(h("dt", {}, k), renderValue(v, opts));
  }
  return dl;
}

function collapsible(summary: string, value: JsonValue): HTMLElement {
  return h("details", { class: "val-json" }, [
    h("summary", {}, summary),
    h("pre", {}, truncate(JSON.stringify(value, null, 2), 2000)),
  ]);
}
