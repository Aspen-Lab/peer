import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReaderLayout } from "./reader-layout";
import { TABPANEL_ID, tabId } from "./reader-tabs";

// P7-14 (R2 + Q1, then R10): the order of the reading page's blocks in both layouts.
//
// R2 + Q1: the commands sit directly under the title in BOTH layouts. The decision block carries
// them ("Read it here", Save, Copy, ...), and it used to stand after the question box and the map
// in the spread's panel, and after the abstract in the one-column page (a CSS re-order would have
// made a screen reader announce it before the abstract, so the DOM order was chosen on purpose).
//
// R10: on a paper Peer has read in full the page has two tabs. The strip stands under the decision
// block; "Terms to know" stands in the panel on the spread (after the common blocks in one column);
// the blocks BOTH tabs share — "Before you read" and the answers — are the column's first thing,
// above the active tab's blocks, in a slot of their own that does not depend on the tab, so that a
// switch cannot remount the field or lose what the reader has typed (Q6). The rail is gone.
//
// `ReaderLayout` takes `spread` as a prop, so both structures render here with markers; nothing is
// mounted but the layout.

const mark = (name: string): ReactNode => createElement("i", { "data-mark": name }, name);

function render(spread: boolean, over: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(ReaderLayout, {
      spread,
      plate: mark("PLATE"),
      title: mark("TITLE"),
      decision: mark("DECISION"),
      words: mark("WORDS"),
      additions: mark("ADDITIONS"),
      next: mark("NEXT"),
      ...over,
    }),
  );
}
/** The page with a body: the tab strip, the terms and the common blocks all there. */
const tabbed = (spread: boolean, over: Record<string, unknown> = {}) =>
  render(spread, { tabs: mark("TABS"), tab: "digestion", terms: mark("TERMS"), common: mark("COMMON"), ...over });

const at = (html: string, name: string) => html.indexOf(`data-mark="${name}"`);
const order = (html: string, names: readonly string[]) => names.map((name) => at(html, name));
const ascending = (indexes: number[]) => indexes.every((index, i) => index >= 0 && (i === 0 || index > indexes[i - 1]));
const absent = (html: string, ...names: string[]) => names.forEach((name) => expect(at(html, name)).toBe(-1));

describe("ReaderLayout, one column, a paper with no body (R2 + Q1)", () => {
  const html = render(false);

  it("plate, title, decision, then the abstract, the additions, Next — the decision before the abstract", () => {
    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION", "WORDS", "ADDITIONS", "NEXT"]))).toBe(true);
  });

  it("has no tab strip, no tab panel and no common slot: the page it was", () => {
    absent(html, "TABS", "TERMS", "COMMON");
    expect(html).not.toContain("role=\"tabpanel\"");
    expect(html).not.toContain(TABPANEL_ID);
  });
});

describe("ReaderLayout, one column, a paper with a body (R10)", () => {
  const html = tabbed(false);

  it("plate, title, decision, the tab strip, the common blocks, the terms, then the active tab's blocks, Next", () => {
    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION", "TABS", "COMMON", "TERMS", "WORDS", "ADDITIONS", "NEXT"]))).toBe(true);
  });

  it("puts the abstract after the decision and the questions, never before them (Q1)", () => {
    expect(at(html, "WORDS")).toBeGreaterThan(at(html, "DECISION"));
    expect(at(html, "WORDS")).toBeGreaterThan(at(html, "COMMON"));
  });

  it("holds the active tab's blocks in one tabpanel the tabs point at, labelled by the tab on show", () => {
    for (const tab of ["summary", "digestion"] as const) {
      const shown = tabbed(false, { tab });
      const panel = shown.slice(shown.indexOf('role="tabpanel"'));

      const tag = /<div\b[^>]*role="tabpanel"[^>]*>/.exec(shown)?.[0] ?? "";
      expect(tag).toContain(`id="${TABPANEL_ID}"`);
      expect(tag).toContain(`aria-labelledby="${tabId(tab)}"`);
      // The panel holds the words and the additions and nothing the two tabs share.
      expect(panel).toContain('data-mark="WORDS"');
      expect(panel).toContain('data-mark="ADDITIONS"');
      expect(panel).not.toContain('data-mark="COMMON"');
      expect(panel).not.toContain('data-mark="TERMS"');
      expect(panel).not.toContain('data-mark="TABS"');
    }
  });
});

describe("ReaderLayout, the spread, a paper with no body (R2)", () => {
  const html = render(true);
  const panelAt = html.indexOf("data-reader-panel");
  const columnAt = html.indexOf("xl:flex xl:flex-col");

  it("the panel holds the plate, the title and the decision; the column the abstract, the additions and Next", () => {
    expect(panelAt).toBeGreaterThan(-1);
    expect(columnAt).toBeGreaterThan(panelAt);
    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION"]))).toBe(true);
    for (const name of ["PLATE", "TITLE", "DECISION"]) {
      expect(at(html, name)).toBeGreaterThan(panelAt);
      expect(at(html, name)).toBeLessThan(columnAt);
    }
    expect(ascending([columnAt, ...order(html, ["WORDS", "ADDITIONS", "NEXT"])])).toBe(true);
  });

  it("still puts the decision straight after the title when nothing else fills the panel", () => {
    expect(ascending(order(render(true, { plate: null }), ["TITLE", "DECISION", "WORDS"]))).toBe(true);
  });
});

describe("ReaderLayout, the spread, a paper with a body (R10)", () => {
  const html = tabbed(true);
  const panelAt = html.indexOf("data-reader-panel");
  const columnAt = html.indexOf("xl:flex xl:flex-col");

  it("the panel: plate, title, decision, the tab strip, the terms — and none of the column's blocks", () => {
    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION", "TABS", "TERMS"]))).toBe(true);
    for (const name of ["PLATE", "TITLE", "DECISION", "TABS", "TERMS"]) {
      expect(at(html, name)).toBeGreaterThan(panelAt);
      expect(at(html, name)).toBeLessThan(columnAt);
    }
  });

  it("the column: the common blocks first, then the active tab's blocks, then Next", () => {
    expect(ascending([columnAt, ...order(html, ["COMMON", "WORDS", "ADDITIONS", "NEXT"])])).toBe(true);
  });

  it("the panel has no contents rail and no question box any more", () => {
    const panel = html.slice(panelAt, columnAt);

    expect(panel).not.toContain('data-mark="COMMON"');
    expect(panel).not.toContain("<nav");
  });

  it("the common blocks stand in the same place, with the same markup, whichever tab is on show", () => {
    const common = (tab: "summary" | "digestion") => {
      const shown = tabbed(true, { tab, words: tab === "summary" ? mark("WORDS") : null, additions: mark(tab === "summary" ? "SUMMARY-BLOCKS" : "MAP-AND-BODY") });
      const start = shown.indexOf('id="reader-common"');
      return { chunk: shown.slice(start, shown.indexOf("</div>", start)), position: start, before: shown.slice(0, start) };
    };
    const summary = common("summary");
    const digestion = common("digestion");

    expect(summary.position).toBeGreaterThan(-1);
    expect(summary.chunk).toBe(digestion.chunk);
    // Everything before the common blocks is the same too: the panel and the strip are not redrawn by the switch.
    expect(summary.before).toBe(digestion.before);
    expect(summary.chunk).toContain('data-mark="COMMON"');
  });

  // P9-04 (X2): this test pinned the opposite — "the one block of the panel that gives", a flex item
  // that shrank to a 7rem floor and scrolled inside itself, a 112-px window on one of eight terms inside
  // the panel's own scroll region. The panel scrolls as one now; nothing the layout puts inside it does.
  it("the terms stand in the panel as an ordinary block: nothing the layout adds inside the panel scrolls, shrinks or has a floor (P9-04, X2)", () => {
    const panel = html.slice(html.indexOf("data-reader-panel"), columnAt);
    const inside = panel.slice(panel.indexOf(">") + 1);

    expect(inside).toContain('data-mark="TERMS"');
    // The panel's own tag carries `reader-panel` (sticky, window-high, overflow-y: auto); no other tag in it
    // has a class that scrolls (`overflow-*`), gives (`shrink`) or keeps a floor (`min-h-*`, `max-h-*`).
    expect(inside).not.toMatch(/class="[^"]*(?:overflow|shrink|min-h-|max-h-)[^"]*"/);
    // One column has no panel to give in either: the terms are drawn as they are.
    expect(tabbed(false)).not.toMatch(/class="[^"]*(?:overflow|shrink|min-h-)[^"]*"><i data-mark="TERMS">/);
  });

  it("an empty words slot (Paper digestion) leaves the additions where they were in the tabpanel", () => {
    const shown = tabbed(true, { tab: "digestion", words: null });

    expect(ascending([shown.indexOf('role="tabpanel"'), at(shown, "ADDITIONS"), at(shown, "NEXT")])).toBe(true);
    absent(shown, "WORDS");
  });
});

describe("reader-layout.tsx source (P7-14)", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/reader/reader-layout.tsx"), "utf8");
  const body = source.slice(source.indexOf("export function ReaderLayout"));
  const stacked = body.slice(body.indexOf("if (!p.spread)"), body.indexOf("<div className={SPREAD_GRID}"));
  const spread = body.slice(body.indexOf("<div className={SPREAD_GRID}"));

  it("one column: {p.decision} right after {p.title}, before the tabs, the common blocks and the abstract", () => {
    expect(stacked.slice(stacked.indexOf("{p.title}") + "{p.title}".length, stacked.indexOf("{p.decision}")).trim()).toBe("");
    for (const later of ["{p.tabs}", "{common}", "{p.terms}", "{panel}"]) {
      expect(stacked.indexOf(later)).toBeGreaterThan(stacked.indexOf("{p.decision}"));
    }
  });

  it("the spread's panel: {p.decision} right after {p.title}, then {p.tabs}, then {p.terms}", () => {
    const panel = spread.slice(spread.indexOf("data-reader-panel"), spread.indexOf("COLUMN_CLASS"));

    expect(panel.slice(panel.indexOf("{p.title}") + "{p.title}".length, panel.indexOf("{p.decision}")).trim()).toBe("");
    expect(panel.indexOf("{p.tabs}")).toBeGreaterThan(panel.indexOf("{p.decision}"));
    expect(panel.indexOf("{p.terms}")).toBeGreaterThan(panel.indexOf("{p.tabs}"));
    expect(panel).not.toContain("{p.common}");
    expect(panel).not.toContain("{common}");
  });

  it("the common blocks are drawn before the tab panel and outside it, in both layouts, and do not read the tab", () => {
    expect(source).toContain("const common = p.common ?");
    for (const part of [stacked, spread]) {
      expect(part.indexOf("{common}")).toBeGreaterThan(-1);
      expect(part.indexOf("{common}")).toBeLessThan(part.indexOf("{panel}"));
    }
    // The element is built once, from the slot alone: `p.tab` is read for the panel's label only.
    const commonLine = source.slice(source.indexOf("const common = p.common ?"), source.indexOf(";", source.indexOf("const common = p.common ?")));
    expect(commonLine).not.toContain("p.tab");
    expect(commonLine).not.toContain("tabbed");
  });

  // P9-04 (X2): "Terms to know" lost its window of its own; the panel (`reader-panel`, globals.css) is the one
  // scroll region, so the file names no class that would make a block inside it scroll, shrink or keep a floor.
  it("gives the terms no window of their own: no wrapper class that scrolls, shrinks or keeps a floor (P9-04)", () => {
    expect(source).not.toContain("TERMS_PANEL_CLASS");
    expect(source).not.toMatch(/xl:(?:shrink|overflow-)|min-h-\[|max-h-\[/);
    expect(spread.slice(spread.indexOf("{p.terms}") - 40, spread.indexOf("{p.terms}"))).not.toContain("<div");
  });

  it("has no rail slot, no ask slot, no panel-height variable and no ResizeObserver", () => {
    expect(source).not.toMatch(/\bcontents\??:/);
    expect(source).not.toContain("p.contents");
    expect(source).not.toContain("p.ask");
    expect(source).not.toContain("--panel-h");
    expect(source).not.toContain("ResizeObserver");
    expect(source).not.toMatch(/immediately after the title/);
  });
});
