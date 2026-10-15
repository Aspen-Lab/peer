import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReaderLayout } from "./reader-layout";
import { PANEL_CLASS, PANEL_STICKY_CLASS } from "./spread";

// P10-04b (A8 / X-A1, ruling §1h.87 (a)): at 1440 x 1000 the plate, the six-line title and the decision block
// filled 760 of the sticky panel's 892 px, so on arrival no row of the map was inside the panel's view. The panel
// is split: its head (the plate, the title, the decision) is in normal flow and scrolls away with the page; its
// tail (the tab strip and the map) is the sticky element — window-bounded, the map scrolling inside it. The DOM
// order is unchanged. `ReaderLayout` takes `spread` as a prop, so the structure renders here with markers.

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

describe("ReaderLayout, the spread: the strip and the map are the panel's sticky part (P10-04b, A8)", () => {
  const html = render(true);
  const panelAt = html.indexOf("data-reader-panel");
  const stickyAt = html.indexOf("data-reader-sticky");
  const columnAt = html.indexOf("xl:flex xl:flex-col");

  it("has a sticky part of its own, inside the panel and before the column", () => {
    expect(panelAt).toBeGreaterThan(-1);
    expect(stickyAt).toBeGreaterThan(panelAt);
    expect(stickyAt).toBeLessThan(columnAt);
    expect(classOf(tagWith(html, "data-reader-sticky"))).toContain("xl:reader-panel");
  });

  it("the head (plate, title, decision) is outside the sticky part and ahead of it: it scrolls away with the page", () => {
    for (const name of ["PLATE", "TITLE", "DECISION"]) {
      expect(at(html, name)).toBeGreaterThan(panelAt);
      expect(at(html, name)).toBeLessThan(stickyAt);
    }
  });

  it("the strip and the map are the sticky part's contents, in the DOM order the page always had", () => {
    for (const name of ["TABS", "MAP"]) {
      expect(at(html, name)).toBeGreaterThan(stickyAt);
      expect(at(html, name)).toBeLessThan(columnAt);
    }
    expect(html).toContain('<i data-mark="TABS">TABS</i><i data-mark="MAP">MAP</i>');
    const order = ["PLATE", "TITLE", "DECISION", "TABS", "MAP"].map((name) => at(html, name));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The sticky part holds them and nothing of the column.
    const sticky = html.slice(stickyAt, columnAt);
    expect(sticky).not.toContain('data-mark="COMMON"');
    expect(sticky).not.toContain('data-mark="WORDS"');
  });

  it("the panel itself is no longer the sticky, window-high scroll region: the head has no scroll of its own", () => {
    const panelClass = classOf(tagWith(html, "data-reader-panel"));

    expect(panelClass).not.toContain("reader-panel");
    expect(panelClass).not.toMatch(/overflow|max-h-/);
    // It stretches over the whole row, so the sticky part has the column's height to travel in.
    expect(panelClass).toContain("xl:self-stretch");
    expect(panelClass).not.toContain("xl:self-start");
    expect(PANEL_CLASS).not.toContain("reader-panel");
    expect(PANEL_CLASS).toContain("xl:self-stretch");
    // The head's blocks keep stacking as a flex column, as they did in the sticky panel.
    expect(PANEL_CLASS.split(/\s+/)).toEqual(expect.arrayContaining(["xl:flex", "xl:flex-col"]));
  });

  it("the sticky class is the one utility that pins, bounds and scrolls", () => {
    expect(PANEL_STICKY_CLASS.split(/\s+/)).toContain("xl:reader-panel");
  });

  it("a paper with no strip and no map (no body) keeps the panel it had: the head itself is the sticky part", () => {
    const bare = render(true, { tabs: undefined, map: undefined, common: undefined });
    const stickyAtBare = bare.indexOf("data-reader-sticky");

    expect(stickyAtBare).toBeGreaterThan(bare.indexOf("data-reader-panel"));
    expect(classOf(tagWith(bare, "data-reader-sticky"))).toContain("xl:reader-panel");
    for (const name of ["PLATE", "TITLE", "DECISION"]) expect(at(bare, name)).toBeGreaterThan(stickyAtBare);
    expect(bare.split("data-reader-sticky").length - 1).toBe(1);
  });

  it("the commands (the decision block) still follow the title (P7-14), whatever the sticky part holds", () => {
    expect(at(html, "DECISION")).toBeGreaterThan(at(html, "TITLE"));
    expect(html.slice(at(html, "TITLE"), at(html, "DECISION")).match(/data-mark=/g)).toHaveLength(1);
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

describe("the map scrolls inside the sticky part, only when it is taller than the room (P10-04b)", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/reader/reading-map.tsx"), "utf8");
  const outer = /<section aria-label=\{MAP\.heading\} className="([^"]*)"/.exec(source)?.[1] ?? "";

  it("the map's outer wrapper may shrink and scrolls on the spread only (xl:), with the focus ring's room", () => {
    const classes = outer.split(/\s+/);

    expect(classes).toContain("xl:min-h-0");
    expect(classes).toContain("xl:overflow-y-auto");
    // Below xl nothing scrolls inside the map: every one of its classes that scrolls or bounds is `xl:`-only.
    expect(classes.filter((c) => /overflow|min-h-|max-h-/.test(c) && !c.startsWith("xl:"))).toEqual([]);
  });
});
