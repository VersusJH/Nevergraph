import { h, clear } from "./dom";
import type { LegendData, LegendItem } from "../graph/style";

export interface Legend {
  element: HTMLElement;
  update: (data: LegendData) => void;
}

export function createLegend(): Legend {
  const element = h("div", { class: "legend" });

  function swatch(item: LegendItem): HTMLElement {
    return h("span", { class: "legend-item" }, [
      h("span", {
        class: `legend-swatch shape-${item.shape ?? "ellipse"}`,
        style: `background:${item.color}`,
      }),
      h("span", { class: "legend-label" }, item.label),
    ]);
  }

  function update(data: LegendData): void {
    clear(element);
    element.append(
      h("div", { class: "legend-group" }, [
        h("div", { class: "legend-title muted" }, `Colour · ${data.colorTitle}`),
        h("div", { class: "legend-items" }, data.colorItems.slice(0, 24).map(swatch)),
      ]),
    );
    if (data.shapeItems.length > 1) {
      element.append(
        h("div", { class: "legend-group" }, [
          h("div", { class: "legend-title muted" }, "Shape · node type"),
          h(
            "div",
            { class: "legend-items" },
            data.shapeItems.map((it) =>
              h("span", { class: "legend-item" }, [
                h("span", {
                  class: `legend-swatch shape-${it.shape ?? "ellipse"}`,
                  style: "background:#9aa7ff",
                }),
                h("span", { class: "legend-label" }, it.label),
              ]),
            ),
          ),
        ]),
      );
    }
  }

  return { element, update };
}
