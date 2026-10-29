import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReaderLayout } from "./reader-layout";

// P10-04b (A8 / X-A1, ruling §1h.87 (a)): at 1440 x 1000 the plate, the six-line title and the decision block
// filled 760 of the sticky panel's 892 px, so on arrival no row of the map was inside the panel's view. The panel
// is split: its head (the plate, the title, the decision) is in normal flow and scrolls away with the page; its
// tail (the tab strip and the map) is the sticky element — window-bounded, the map scrolling inside it. The DOM
// order is unchanged. `ReaderLayout` takes `spread` as a prop, so the structure renders here with markers.
//
// P11-16 (B P11-01 §2.3, §3.2; ruling §1h.113 (a)), RE-AIMED: the sticky part is the left pane now (`ReaderShell`, from 1024 css px). The
// pane is sticky and window-high by itself; its blocks are two zones. The fixed zone never scrolls — the reading controls, the title,
// the commands and the strip — and the scroll zone is the pane's ONE scroller: the map, then the plate and the details. At 1440 x 900 the
// plate, the six-line title and the decision block still filled the pane, so the map stood at y 915 on the owner's paper (B P11-01 §1.2):
// the head is split so that the map is on screen on arrival. The map has no scroller of its own.

const mark = (name: string): ReactNode => createElement("i", { "data-mark": name }, name);

function render(spread: boolean, over: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(ReaderLayout, {
      spread,
      plate: mark("PLATE"),
      title: mark("TITLE"),
      decision: mark("DECISION"),
      tabs: mark("TABS"),
      map: mark("MAP"),
      tab: "digestion",
      common: mark("COMMON"),
      words: mark("WORDS"),
      additions: mark("ADDITIONS"),
      next: mark("NEXT"),
      ...over,
    }),
  );
}

const at = (html: string, name: string) => html.indexOf(`data-mark="${name}"`);
/** The opening tag that carries `attr`. */
const tagWith = (html: string, attr: string) => {
  const hit = html.indexOf(attr);
  return hit < 0 ? "" : html.slice(html.lastIndexOf("<", hit), html.indexOf(">", hit) + 1);
};

const PANES = { details: mark("DETAILS"), progress: mark("PROGRESS") };

describe("ReaderLayout, desktop document", () => {
  const html = render(true, PANES);
  const left = html.indexOf("data-reader-left=");
  const centre = html.indexOf("data-reader-centre");
  const sidebar = html.slice(left, centre);

  it("keeps only the outline in the independently scrollable sidebar", () => {
    expect(sidebar).toContain('data-mark="MAP"');
    expect(tagWith(html, "data-reader-left=")).toContain('data-mode="whole"');
    for (const name of ["TITLE", "DECISION", "PROGRESS", "TABS", "DETAILS", "PLATE", "WORDS"]) {
      expect(sidebar).not.toContain(`data-mark="${name}"`);
    }
  });

  it("puts the title, actions, details and tabs above the reading content", () => {
    const order = ["TITLE", "DECISION", "DETAILS", "PROGRESS", "TABS", "COMMON", "WORDS", "ADDITIONS", "PLATE", "NEXT"].map((name) => at(html, name));
    expect(order.every((index) => index > centre)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.split('aria-label="Reading controls"')).toHaveLength(2);
  });

  it("keeps the document and actions available when no outline exists", () => {
    const bare = render(true, { ...PANES, tabs: undefined, map: undefined, common: undefined });
    expect(bare).not.toContain('data-mark="MAP"');
    for (const name of ["TITLE", "DECISION", "DETAILS", "WORDS"]) expect(at(bare, name)).toBeGreaterThan(bare.indexOf("data-reader-centre"));
  });
});

describe("ReaderLayout, one column: unchanged by the split (P10-04b)", () => {
  const html = render(false);

  it("has no sticky part and no panel; the order is plate, title, decision, common, strip, map, tabpanel, Next", () => {
    expect(html).not.toContain("data-reader-sticky");
    expect(html).not.toContain("data-reader-panel");
    expect(html).not.toContain("reader-panel");
    const order = ["PLATE", "TITLE", "DECISION", "COMMON", "TABS", "MAP", "WORDS", "ADDITIONS", "NEXT"].map((name) => at(html, name));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

// P11-16, RE-AIMED from "the map scrolls inside the sticky part, only when it is taller than the room (P10-04b)": the map is a plain
// block in the left pane's scroll zone, which is the one scroller (B P11-01 §2.3, §3.2). Its own `xl:overflow-y-auto` / `xl:min-h-0`
// (reading-map.tsx) would make a second, nested scroller inside the first, so it is gone — and with it the `xl:` ring room, which the
// layout gives the zone's content instead.
describe("the map does not scroll on its own: the pane's scroll zone is the only scroller (P11-16)", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/reader/reading-map.tsx"), "utf8");
  const outer = /<section aria-label=\{MAP\.heading\} className="([^"]*)"/.exec(source)?.[1] ?? "";

  it("the map's outer wrapper has no class that scrolls, bounds or floors it, at any width", () => {
    const classes = outer.split(/\s+/).filter(Boolean);

    expect(classes.length).toBeGreaterThan(0);
    expect(classes).toContain("mt-6");
    expect(classes.filter((c) => /overflow|min-h-|max-h-|^(?:\w+:)?h-/.test(c))).toEqual([]);
  });
});
