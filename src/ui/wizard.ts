import { h, clear } from "./dom";
import type {
  ArcMapping,
  CollectionMapping,
  DatasetCatalog,
  FieldInfo,
  MappingProfile,
  ValidationReport,
} from "../types";
import { suggestProfile } from "../mapping/suggest";
import { downloadJson, pickFile } from "../io/download";
import { isMappingProfile } from "../io/profileStore";

export interface WizardCallbacks {
  onConfirm: (profile: MappingProfile) => void;
  computeReport: (profile: MappingProfile) => ValidationReport;
  notify?: (msg: string) => void;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function renderWizard(
  catalog: DatasetCatalog,
  baseProfile: MappingProfile,
  cb: WizardCallbacks,
): HTMLElement {
  let profile = clone(baseProfile);
  const catByName = new Map(catalog.collections.map((c) => [c.name, c]));

  const root = h("div", { class: "wizard" });
  const body = h("div", { class: "wizard-body" });
  const footer = h("div", { class: "wizard-footer" });

  async function importMapping(): Promise<void> {
    const picked = await pickFile(".json");
    if (!picked) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(picked.text);
    } catch {
      cb.notify?.("Could not parse mapping file.");
      return;
    }
    if (!isMappingProfile(parsed)) {
      cb.notify?.("That file is not a Nevergraph mapping.");
      return;
    }
    // Overlay imported collections (by name) onto a fresh suggestion so the
    // working profile always covers exactly this dataset's collections.
    const merged = suggestProfile(catalog);
    const byName = new Map(parsed.collections.map((c) => [c.collection, c]));
    merged.collections = merged.collections.map((c) => byName.get(c.collection) ?? c);
    merged.shapeSignature = catalog.shapeSignature;
    profile = merged;
    cb.notify?.("Mapping imported.");
    rerender();
  }

  root.append(
    h("div", { class: "wizard-head" }, [
      h("div", { class: "wizard-head-row" }, [
        h("h2", {}, "Configure the graph"),
        h("div", { class: "wizard-head-actions" }, [
          h(
            "button",
            { class: "btn-ghost btn-sm", onclick: importMapping },
            "Import mapping",
          ),
          h(
            "button",
            {
              class: "btn-ghost btn-sm",
              onclick: () => downloadJson("nevergraph-mapping.json", profile),
            },
            "Export mapping",
          ),
        ]),
      ]),
      h(
        "p",
        { class: "muted" },
        "Tell Nevergraph which fields are identifiers, arcs (edges), and categories. Defaults are suggested — adjust as needed.",
      ),
    ]),
    body,
    footer,
  );

  const opt = (value: string, label: string, selected: boolean) =>
    h("option", { value, selected }, label);

  function fieldSelect(
    fields: FieldInfo[],
    current: string,
    onChange: (v: string) => void,
    allowNone = false,
    noneLabel = "(none)",
  ): HTMLElement {
    const sel = h(
      "select",
      {
        class: "w-select",
        onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
      },
      [
        allowNone ? opt("", noneLabel, current === "") : null,
        ...fields.map((f) =>
          opt(f.path, `${f.path}  ·  ${f.kind}`, f.path === current),
        ),
      ].filter(Boolean) as Node[],
    );
    return sel;
  }

  function arcRow(m: CollectionMapping, field: FieldInfo): HTMLElement {
    const existing = m.arcs.find((a) => a.field === field.path);
    const enabled = !!existing;
    const idKeys = field.elementKeys ?? [];

    const enableBox = h("input", {
      type: "checkbox",
      checked: enabled,
      onchange: (e: Event) => {
        if ((e.target as HTMLInputElement).checked) {
          m.arcs.push(defaultArc(field));
        } else {
          m.arcs = m.arcs.filter((a) => a.field !== field.path);
        }
        rerender();
      },
    });

    const head = h("label", { class: "arc-head" }, [
      enableBox,
      h("span", { class: "arc-field" }, field.path),
      h(
        "span",
        { class: "muted arc-meta" },
        field.kind === "array-object"
          ? `array of objects · ${idKeys.length} keys`
          : `id array · e.g. ${field.samples.slice(0, 2).join(", ") || "—"}`,
      ),
    ]);

    if (!existing) return h("div", { class: "arc-row" }, head);

    const controls = h("div", { class: "arc-controls" }, [
      labeled(
        "Edge type",
        h("input", {
          class: "w-input",
          value: existing.edgeType,
          oninput: (e: Event) => {
            existing.edgeType = (e.target as HTMLInputElement).value;
            updatePreview();
          },
        }),
      ),
      field.kind === "array-object"
        ? labeled(
            "Target id key",
            h(
              "select",
              {
                class: "w-select",
                onchange: (e: Event) => {
                  existing.idKey = (e.target as HTMLSelectElement).value;
                  existing.idMode = "key";
                  rerender();
                },
              },
              idKeys.map((k) =>
                opt(
                  k.key,
                  `${k.key}${k.looksLikeId ? " (id)" : ""}`,
                  k.key === existing.idKey,
                ),
              ),
            ),
          )
        : labeled("Target id", h("span", { class: "muted w-static" }, "whole value")),
      checkbox("Directed", existing.directed, (v) => {
        existing.directed = v;
        if (v) existing.dedupeReciprocal = false;
        rerender();
      }),
      checkbox("Drop self-loops", existing.dropSelfLoops, (v) => {
        existing.dropSelfLoops = v;
        updatePreview();
      }),
      checkbox(
        "Merge reciprocal",
        existing.dedupeReciprocal,
        (v) => {
          existing.dedupeReciprocal = v;
          updatePreview();
        },
        existing.directed,
      ),
      labeled(
        "Target type",
        h(
          "select",
          {
            class: "w-select",
            onchange: (e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              existing.targetType = v === "" ? undefined : v;
              updatePreview();
            },
          },
          [
            opt("", "any", !existing.targetType),
            ...profile.collections.map((c) =>
              opt(c.nodeType, c.nodeType, existing.targetType === c.nodeType),
            ),
          ],
        ),
      ),
      field.kind === "array-object" && idKeys.length > 1
        ? labeled(
            "Edge metadata",
            h(
              "div",
              { class: "chip-row" },
              idKeys
                .filter((k) => k.key !== existing.idKey)
                .map((k) =>
                  chipToggle(k.key, existing.metadataKeys.includes(k.key), (on) => {
                    existing.metadataKeys = on
                      ? [...existing.metadataKeys, k.key]
                      : existing.metadataKeys.filter((x) => x !== k.key);
                    updatePreview();
                  }),
                ),
            ),
          )
        : null,
    ]);

    return h("div", { class: "arc-row arc-open" }, [head, controls]);
  }

  function collectionSection(m: CollectionMapping): HTMLElement {
    const cc = catByName.get(m.collection)!;
    const scalars = cc.fields.filter((f) => f.kind === "scalar");
    const arrays = cc.fields.filter(
      (f) => f.kind === "array-object" || f.kind === "array-scalar",
    );
    const catCandidates = cc.fields.filter(
      (f) =>
        f.path !== m.idField &&
        f.path !== m.labelField &&
        ((f.kind === "scalar" &&
          (f.valueType === "string" || f.valueType === "boolean")) ||
          (f.kind === "array-scalar" && f.distinctCount > 0)),
    );
    const numCandidates = scalars.filter(
      (f) => f.valueType === "number" && !f.looksLikeId,
    );

    const enableBox = h("input", {
      type: "checkbox",
      checked: m.enabled,
      onchange: (e: Event) => {
        m.enabled = (e.target as HTMLInputElement).checked;
        rerender();
      },
    });

    const headerRow = h("div", { class: "coll-head" }, [
      h("label", { class: "coll-title" }, [
        enableBox,
        h("strong", {}, m.collection),
        h("span", { class: "muted" }, `${cc.recordCount} records`),
      ]),
    ]);

    if (!m.enabled)
      return h("section", { class: "coll-card disabled" }, headerRow);

    const identity = h("div", { class: "field-grid" }, [
      labeled(
        "Node type",
        h("input", {
          class: "w-input",
          value: m.nodeType,
          oninput: (e: Event) => {
            m.nodeType = (e.target as HTMLInputElement).value;
            updatePreview();
          },
        }),
      ),
      labeled(
        "ID field",
        fieldSelect(scalars, m.idField, (v) => {
          m.idField = v;
          updatePreview();
        }),
      ),
      labeled(
        "Label field",
        fieldSelect(scalars, m.labelField, (v) => {
          m.labelField = v;
          updatePreview();
        }),
      ),
      labeled(
        "Split types by",
        fieldSelect(
          scalars.filter((f) => f.distinctCount <= 40),
          m.typeField ?? "",
          (v) => {
            m.typeField = v === "" ? undefined : v;
            updatePreview();
          },
          true,
          "(use one type)",
        ),
      ),
    ]);

    const arcsBlock = h("div", { class: "subsection" }, [
      h("h4", {}, "Arcs (edges)"),
      arrays.length
        ? h(
            "div",
            { class: "arc-list" },
            arrays.map((f) => arcRow(m, f)),
          )
        : h("p", { class: "muted" }, "No array fields to use as arcs."),
    ]);

    const catBlock = h("div", { class: "subsection" }, [
      h("h4", {}, "Categories / tags"),
      h(
        "div",
        { class: "chip-row" },
        catCandidates.map((f) =>
          chipToggle(
            `${f.path} (${f.distinctCount})`,
            m.categoryFields.includes(f.path),
            (on) => {
              m.categoryFields = on
                ? [...m.categoryFields, f.path]
                : m.categoryFields.filter((x) => x !== f.path);
              updatePreview();
            },
          ),
        ),
      ),
    ]);

    const numBlock = numCandidates.length
      ? h("div", { class: "subsection" }, [
          h("h4", {}, "Numeric (for node size / filters)"),
          h(
            "div",
            { class: "chip-row" },
            numCandidates.map((f) =>
              chipToggle(f.path, m.numericFields.includes(f.path), (on) => {
                m.numericFields = on
                  ? [...m.numericFields, f.path]
                  : m.numericFields.filter((x) => x !== f.path);
                updatePreview();
              }),
            ),
          ),
        ])
      : null;

    return h("section", { class: "coll-card" }, [
      headerRow,
      identity,
      arcsBlock,
      catBlock,
      numBlock,
    ]);
  }

  function rerender(): void {
    clear(body);
    for (const m of profile.collections) body.append(collectionSection(m));
    updatePreview();
  }

  function updatePreview(): void {
    clear(footer);
    let report: ValidationReport;
    try {
      report = cb.computeReport(profile);
    } catch (err) {
      footer.append(
        h("span", { class: "preview-error" }, `Preview error: ${String(err)}`),
      );
      return;
    }
    const warn: string[] = [];
    if (report.danglingRefs.length)
      warn.push(`${report.danglingRefs.length} dangling refs`);
    if (report.duplicateIds.length)
      warn.push(`${report.duplicateIds.length} duplicate ids`);
    if (report.selfLoopsDropped)
      warn.push(`${report.selfLoopsDropped} self-loops dropped`);
    if (report.reciprocalDeduped)
      warn.push(`${report.reciprocalDeduped} reciprocal merged`);

    footer.append(
      h("div", { class: "preview-stats" }, [
        stat(report.nodeCount, "nodes"),
        stat(report.edgeCount, "edges"),
        h(
          "span",
          { class: "preview-warn muted" },
          warn.length ? warn.join(" · ") : "no issues",
        ),
      ]),
      h(
        "button",
        {
          class: "btn-primary",
          disabled: report.nodeCount === 0,
          onclick: () => cb.onConfirm(clone(profile)),
        },
        "Build graph →",
      ),
    );
  }

  rerender();
  return root;
}

// ------------------------------ small bits --------------------------------

function defaultArc(field: FieldInfo): ArcMapping {
  if (field.kind === "array-object") {
    const keys = field.elementKeys ?? [];
    const idKey = (keys.find((k) => k.looksLikeId) ?? keys[0])?.key;
    return {
      id: `arc_${field.path}`,
      field: field.path,
      idMode: "key",
      idKey,
      edgeType: field.path,
      directed: true,
      dropSelfLoops: true,
      dedupeReciprocal: false,
      metadataKeys: keys.filter((k) => k.key !== idKey).map((k) => k.key),
    };
  }
  return {
    id: `arc_${field.path}`,
    field: field.path,
    idMode: "self",
    edgeType: field.path,
    directed: true,
    dropSelfLoops: true,
    dedupeReciprocal: false,
    metadataKeys: [],
  };
}

function labeled(label: string, control: Node): HTMLElement {
  return h("label", { class: "w-labeled" }, [
    h("span", { class: "w-label" }, label),
    control,
  ]);
}

function checkbox(
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
  disabled = false,
): HTMLElement {
  return h("label", { class: "w-check" + (disabled ? " disabled" : "") }, [
    h("input", {
      type: "checkbox",
      checked,
      disabled,
      onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked),
    }),
    label,
  ]);
}

function chipToggle(
  label: string,
  on: boolean,
  onChange: (v: boolean) => void,
): HTMLElement {
  const chip = h(
    "button",
    {
      class: "chip" + (on ? " chip-on" : ""),
      onclick: () => {
        on = !on;
        chip.classList.toggle("chip-on", on);
        onChange(on);
      },
    },
    label,
  );
  return chip;
}

function stat(n: number, label: string): HTMLElement {
  return h("span", { class: "stat" }, [
    h("span", { class: "stat-n" }, String(n)),
    h("span", { class: "stat-l muted" }, label),
  ]);
}
