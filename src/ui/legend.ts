import { h, clear } from "./dom";
import type { LegendData, LegendGroup, LegendItem } from "../graph/style";
import { NO_VALUE_COLOR } from "../graph/palette";

export interface Legend {
  element: HTMLElement;
  update: (data: LegendData) => void;
}

const SHAPE_NEUTRAL = "#9aa7ff";

export function createLegend(): Legend {
  const element = h("div", { class: "legend" });

  function swatch(item: LegendItem, channel: LegendGroup["channel"]): HTMLElement {
    const base =
      channel === "color" ? (item.color ?? NO_VALUE_COLOR) : SHAPE_NEUTRAL;
    let style = `background:${base}`;
    if (item.pattern) {
      style += `;background-image:url("${item.pattern}");background-size:cover`;
    }
    return h("span", { class: "legend-item" }, [
      h("span", {
        class: `legend-swatch shape-${item.shape ?? "ellipse"}`,
        style,
      }),
      h("span", { class: "legend-label" }, item.label),
    ]);
  }

  function update(data: LegendData): void {
    clear(element);
    for (const group of data.groups) {
      element.append(
        h("div", { class: "legend-group" }, [
          h("div", { class: "legend-title muted" }, group.title),
          h(
            "div",
            { class: "legend-items" },
            group.items.map((it) => swatch(it, group.channel)),
          ),
        ]),
      );
    }
  }

  return { element, update };
}
