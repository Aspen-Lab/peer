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
const classOf = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1] ?? "";

const PANES = { details: mark("DETAILS"), progress: mark("PROGRESS") };

describe("ReaderLayout, the three panes: the strip is the left pane's fixed zone, the map its scroll zone (P11-16; was P10-04b, A8)", () => {
  const html = render(true, PANES);
  const leftAt = html.indexOf("data-reader-left=");
  const fixedAt = html.indexOf("data-reader-left-fixed");
  const scrollAt = html.indexOf("data-reader-left-scroll");
  const centreAt = html.indexOf("data-reader-centre");

  it("has a fixed zone and a scroll zone of its own, inside the left pane and before the centre", () => {
    expect(leftAt).toBeGreaterThan(-1);
    expect(fixedAt).toBeGreaterThan(leftAt);
    expect(scrollAt).toBeGreaterThan(fixedAt);
    expect(centreAt).toBeGreaterThan(scrollAt);
    expect(tagWith(html, "data-reader-left=")).toContain('data-mode="split"');
  });

  it("the strip and the title and commands above it are in the fixed zone: they never scroll with the map", () => {
    for (const name of ["TITLE", "DECISION", "PROGRESS", "TABS"]) {
      expect(at(html, name)).toBeGreaterThan(fixedAt);
      expect(at(html, name)).toBeLessThan(scrollAt);
    }
    expect(html.slice(fixedAt, scrollAt)).not.toContain('data-mark="MAP"');
  });

  it("the map, then the plate, then the details are the scroll zone's contents, in the DOM order the reader sees", () => {
    for (const name of ["MAP", "PLATE", "DETAILS"]) {
      expect(at(html, name)).toBeGreaterThan(scrollAt);
      expect(at(html, name)).toBeLessThan(centreAt);
    }
    const order = ["MAP", "PLATE", "DETAILS"].map((name) => at(html, name));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The scroll zone holds them and nothing of the column.
    const scroll = html.slice(scrollAt, centreAt);
    expect(scroll).not.toContain('data-mark="COMMON"');
    expect(scroll).not.toContain('data-mark="WORDS"');
    expect(scroll).not.toContain('data-mark="TABS"');
  });

  it("the layout's own wrappers add no scroller: the pane's scroll zone is the one", () => {
    const wrappers = (html.slice(fixedAt, centreAt).match(/<div\b[^>]*>/g) ?? []).filter((tag) => !tag.includes("data-reader-left-"));

    expect(wrappers.length).toBeGreaterThan(0);
    for (const tag of wrappers) expect(classOf(tag)).not.toMatch(/overflow|max-h-|min-h-|reader-panel/);
  });

  // A zone clips what overflows it (`overflow-y: auto` makes the x axis clip too), so the focus ring (2px + 3px offset) of a command at the
  // zone's edge, or of a map row, needs room inside it. The old map had `xl:-mx-1.5 xl:px-1.5` for it; each zone's contents have it now.
  it("each zone's contents stand in a wrapper with the focus ring's room (px-1.5)", () => {
    const first = (at: number) => /<div\b[^>]*class="([^"]*)"/.exec(html.slice(html.indexOf(">", at) + 1))?.[1] ?? "";

    expect(first(fixedAt).split(/\s+/)).toContain("px-1.5");
    expect(first(scrollAt).split(/\s+/)).toContain("px-1.5");
  });

  it("a paper with no strip and no map (no body) has no zones: the pane itself scrolls as one", () => {
    const bare = render(true, { ...PANES, tabs: undefined, map: undefined, common: undefined });

    expect(tagWith(bare, "data-reader-left=")).toContain('data-mode="whole"');
    expect(bare).not.toContain("data-reader-left-fixed");
    expect(bare).not.toContain("data-reader-left-scroll");
    for (const name of ["TITLE", "DECISION", "PROGRESS", "PLATE", "DETAILS"]) expect(at(bare, name)).toBeGreaterThan(bare.indexOf("data-reader-left="));
  });

  it("the commands (the decision block) still follow the title (P7-14), whatever the zones hold", () => {
    expect(at(html, "DECISION")).toBeGreaterThan(at(html, "TITLE"));
    expect(html.slice(at(html, "TITLE"), at(html, "DECISION")).match(/data-mark=/g)).toHaveLength(1);
  });

  it("is not the old two-column spread: no head that scrolls away, no sticky tail of its own, no `reader-panel` utility", () => {
    expect(html).not.toContain("data-reader-panel");
    expect(html).not.toContain("data-reader-sticky");
    expect(html).not.toContain("reader-panel");
    expect(html).not.toContain("xl:grid");
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
