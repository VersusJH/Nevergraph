import { h } from "./dom";

// Resolve bundled example datasets to URLs that work in dev and in a build.
const EXAMPLES = [
  {
    label: "Neverwas",
    note: "narrative storylets + items",
    url: new URL("../../example_datasets/neverwas.json", import.meta.url),
    file: "neverwas.json",
  },
  {
    label: "LARP characters",
    note: "90 characters, relationship web",
    url: new URL("../../example_datasets/larp.json", import.meta.url),
    file: "larp.json",
  },
];

export interface LandingCallbacks {
  onLoad: (text: string, fileName: string) => void;
}

export function renderLanding(cb: LandingCallbacks): HTMLElement {
  const fileInput = h("input", {
    type: "file",
    accept: ".json,application/json",
    style: "display:none",
    onchange: async (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) cb.onLoad(await f.text(), f.name);
    },
  });

  const drop = h(
    "div",
    {
      class: "dropzone",
      ondragover: (e: DragEvent) => {
        e.preventDefault();
        drop.classList.add("dragover");
      },
      ondragleave: () => drop.classList.remove("dragover"),
      ondrop: async (e: DragEvent) => {
        e.preventDefault();
        drop.classList.remove("dragover");
        const f = e.dataTransfer?.files?.[0];
        if (f) cb.onLoad(await f.text(), f.name);
      },
      onclick: () => fileInput.click(),
    },
    [
      h("div", { class: "drop-icon", html: graphIcon() }),
      h("p", { class: "drop-title" }, "Drop a JSON file here"),
      h("p", { class: "muted" }, "or click to browse"),
    ],
  );

  const examples = h(
    "div",
    { class: "examples" },
    EXAMPLES.map((ex) =>
      h(
        "button",
        {
          class: "example-card",
          onclick: async () => {
            const res = await fetch(ex.url.href);
            cb.onLoad(await res.text(), ex.file);
          },
        },
        [
          h("span", { class: "example-name" }, ex.label),
          h("span", { class: "muted example-note" }, ex.note),
        ],
      ),
    ),
  );

  return h("main", { class: "landing" }, [
    h("div", { class: "landing-inner" }, [
      h("h1", { class: "brand" }, [
        h("span", { class: "brand-mark", html: graphIcon() }),
        "Nevergraph",
      ]),
      h(
        "p",
        { class: "tagline muted" },
        "Turn collections of JSON objects into interactive network graphs.",
      ),
      drop,
      fileInput,
      h("p", { class: "muted try-label" }, "Or try an example:"),
      examples,
    ]),
  ]);
}

function graphIcon(): string {
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    <g stroke="#8892b0" stroke-width="3" opacity="0.8">
      <line x1="25" y1="32" x2="72" y2="26"/>
      <line x1="72" y1="26" x2="60" y2="74"/>
      <line x1="25" y1="32" x2="60" y2="74"/>
    </g>
    <circle cx="25" cy="32" r="9" fill="#7c9eff"/>
    <circle cx="72" cy="26" r="8" fill="#f4a259"/>
    <circle cx="60" cy="74" r="10" fill="#63d2a4"/>
  </svg>`;
}
