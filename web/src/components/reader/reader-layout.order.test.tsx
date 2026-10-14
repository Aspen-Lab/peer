import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMMON_ID, ReaderLayout, scrollToTabStart } from "./reader-layout";
import { TABPANEL_ID, tabId } from "./reader-tabs";

// P7-14 (R2 + Q1, then R10): the order of the reading page's blocks in both layouts.
//
// R2 + Q1: the commands sit directly under the title in BOTH layouts. The decision block carries
// them ("Read it here", Save, Copy, ...), and it used to stand after the question box and the map
// in the spread's panel, and after the abstract in the one-column page (a CSS re-order would have
// made a screen reader announce it before the abstract, so the DOM order was chosen on purpose).
//
// R10: on a paper Peer has read in full the page has two tabs. The strip stands under the decision
// block; the blocks BOTH tabs share — "Before you read" and the answers — are the column's first thing,
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
/** The page with a body: the tab strip and the common blocks all there. */
const tabbed = (spread: boolean, over: Record<string, unknown> = {}) =>
  render(spread, { tabs: mark("TABS"), tab: "digestion", common: mark("COMMON"), ...over });

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
    absent(html, "TABS", "COMMON");
    expect(html).not.toContain("role=\"tabpanel\"");
    expect(html).not.toContain(TABPANEL_ID);
  });
});

describe("ReaderLayout, one column, a paper with a body (R10)", () => {
  const html = tabbed(false);

  // P9-04 (X3), RE-AIMED: this test pinned plate, title, decision, TABS, common, terms, panel — the strip
  // four screens above the panel it switches (on a phone the Map started at y 3,449). The strip now stands
  // directly above its panel, after the blocks both tabs share. P10-02: the terms strip is gone from the order.
  it("plate, title, decision, the common blocks, the tab strip, then the active tab's blocks, Next (P9-04, X3)", () => {
    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION", "COMMON", "TABS", "WORDS", "ADDITIONS", "NEXT"]))).toBe(true);
  });

  it("the tab strip is the tabpanel's immediate previous sibling, with the common blocks before it (P9-04, X3)", () => {
    expect(html).toContain('<i data-mark="TABS">TABS</i><div role="tabpanel"');
    expect(at(html, "COMMON")).toBeLessThan(at(html, "TABS"));
    // The spread keeps the strip in the panel beside the column, a remote control by design (P7-14, R10).
    expect(tabbed(true)).not.toContain('<i data-mark="TABS">TABS</i><div role="tabpanel"');
  });

  it("the one-column tabpanel is its own block formatting context, so its box begins at the strip's foot and not a block's top gap below it (P9-04, X3)", () => {
    const tag = /<div\b[^>]*role="tabpanel"[^>]*>/.exec(html)?.[0] ?? "";

    expect(tag).toMatch(/class="[^"]*\bflow-root\b/);
    // The spread's tabpanel is a flex column already (no collapse there); it does not take the class.
    expect(/<div\b[^>]*role="tabpanel"[^>]*>/.exec(tabbed(true))?.[0] ?? "").not.toContain("flow-root");
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

  it("the panel: plate, title, decision, the tab strip — and none of the column's blocks (P10-02: no terms after it)", () => {
    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION", "TABS"]))).toBe(true);
    for (const name of ["PLATE", "TITLE", "DECISION", "TABS"]) {
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

  // P9-04 (X2): the panel scrolls as one; nothing the layout puts inside it scrolls, shrinks or has a floor.
  // P10-02: it held the terms as its example; the terms are gone, the panel's own contents are the same.
  it("nothing the layout adds inside the panel scrolls, shrinks or has a floor (P9-04, X2)", () => {
    const panel = html.slice(html.indexOf("data-reader-panel"), columnAt);
    const inside = panel.slice(panel.indexOf(">") + 1);

    expect(inside).toContain('data-mark="TABS"');
    // The panel's own tag carries `reader-panel` (sticky, window-high, overflow-y: auto); no other tag in it
    // has a class that scrolls (`overflow-*`), gives (`shrink`) or keeps a floor (`min-h-*`, `max-h-*`).
    expect(inside).not.toMatch(/class="[^"]*(?:overflow|shrink|min-h-|max-h-)[^"]*"/);
  });

  it("an empty words slot (Paper digestion) leaves the additions where they were in the tabpanel", () => {
    const shown = tabbed(true, { tab: "digestion", words: null });

    expect(ascending([shown.indexOf('role="tabpanel"'), at(shown, "ADDITIONS"), at(shown, "NEXT")])).toBe(true);
    absent(shown, "WORDS");
  });
});

// P10-04 (review 3.1; A8): the map stands directly under the Summary / Paper digestion strip and floats
// with it. On the spread it is in the panel (the sticky, window-bounded scroll region), straight after the
// strip, so a reader anywhere in the paper can jump by it and a map taller than the panel scrolls inside it;
// in one column it stands between the strip and the tabpanel. It is a slot of its own, outside the tabpanel,
// so it shows under both tabs and a tab switch does not remount it.
describe("ReaderLayout, the map under the strip (P10-04, A8)", () => {
  const withMap = (spread: boolean, over: Record<string, unknown> = {}) => tabbed(spread, { map: mark("MAP"), ...over });

  it("on the spread: in the panel, directly after the tab strip and before the terms", () => {
    const html = withMap(true);
    const panelAt = html.indexOf("data-reader-panel");
    const columnAt = html.indexOf("xl:flex xl:flex-col");

    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION", "TABS", "MAP", "TERMS"]))).toBe(true);
    expect(html).toContain('<i data-mark="TABS">TABS</i><i data-mark="MAP">MAP</i>');
    expect(at(html, "MAP")).toBeGreaterThan(panelAt);
    expect(at(html, "MAP")).toBeLessThan(columnAt);
    // Nothing of it in the column, and the column is as it was.
    expect(html.slice(columnAt)).not.toContain('data-mark="MAP"');
    expect(html.split('data-mark="MAP"').length - 1).toBe(1);
  });

  it("in one column: directly under the strip and above the tabpanel, outside it", () => {
    const html = withMap(false);

    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION", "COMMON", "TERMS", "TABS", "MAP", "WORDS", "ADDITIONS", "NEXT"]))).toBe(true);
    expect(html).toContain('<i data-mark="TABS">TABS</i><i data-mark="MAP">MAP</i><div role="tabpanel"');
    expect(html.split('data-mark="MAP"').length - 1).toBe(1);
  });

  it("shows under both tabs, in the same place with the same markup", () => {
    for (const spread of [true, false]) {
      const summary = withMap(spread, { tab: "summary", words: mark("WORDS"), additions: mark("SUMMARY-BLOCKS") });
      const digestion = withMap(spread, { tab: "digestion", words: null, additions: mark("BODY") });

      expect(summary).toContain('<i data-mark="MAP">MAP</i>');
      expect(digestion).toContain('<i data-mark="MAP">MAP</i>');
      expect(summary.slice(0, summary.indexOf('data-mark="MAP"'))).toBe(digestion.slice(0, digestion.indexOf('data-mark="MAP"')));
    }
  });

  it("is not part of the tabpanel and takes no scale wrapper of its own", () => {
    const html = withMap(false);
    const panel = html.slice(html.indexOf('role="tabpanel"'));

    expect(panel).not.toContain('data-mark="MAP"');
    expect(html).not.toMatch(/reading-scaled[^>]*><i data-mark="MAP"/);
  });

  it("without a map the page is exactly what it was: the strip is the tabpanel's previous sibling", () => {
    expect(tabbed(false)).toContain('<i data-mark="TABS">TABS</i><div role="tabpanel"');
    absent(tabbed(true), "MAP");
  });

  it("the page hands the map to the layout in its own slot, not among the additions", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");
    const mount = page.indexOf("<ReadingMapView");

    expect(page.match(/<ReadingMapView/g)).toHaveLength(1);
    expect(mount).toBeGreaterThan(page.indexOf("tabs={hasBody"));
    expect(mount).toBeLessThan(page.indexOf("additions={digestion"));
    expect(page.slice(page.lastIndexOf("\n", mount), mount)).toMatch(/\bmap=\{/);
  });
});

describe("reader-layout.tsx source (P7-14)", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/reader/reader-layout.tsx"), "utf8");
  const body = source.slice(source.indexOf("export function ReaderLayout"));
  const stacked = body.slice(body.indexOf("if (!p.spread)"), body.indexOf("<div className={SPREAD_GRID}"));
  const spread = body.slice(body.indexOf("<div className={SPREAD_GRID}"));

  it("one column: {p.decision} right after {p.title}, before the tabs, the common blocks and the abstract", () => {
    expect(stacked.slice(stacked.indexOf("{p.title}") + "{p.title}".length, stacked.indexOf("{p.decision}")).trim()).toBe("");
    for (const later of ["{p.tabs}", "{common}", "{panel}"]) {
      expect(stacked.indexOf(later)).toBeGreaterThan(stacked.indexOf("{p.decision}"));
    }
  });

  // P9-04 (X3): the one-column return ends with the strip and the panel it labels, side by side.
  it("one column: {p.tabs} stands directly before {panel}, after {common}", () => {
    expect(stacked.slice(stacked.indexOf("{p.tabs}") + "{p.tabs}".length, stacked.indexOf("{panel}")).trim()).toBe("");
    expect(stacked.indexOf("{p.tabs}")).toBeGreaterThan(stacked.indexOf("{common}"));
  });

  it("the spread's panel: {p.decision} right after {p.title}, then {p.tabs}, and nothing after it", () => {
    const panel = spread.slice(spread.indexOf("data-reader-panel"), spread.indexOf("COLUMN_CLASS"));

    expect(panel.slice(panel.indexOf("{p.title}") + "{p.title}".length, panel.indexOf("{p.decision}")).trim()).toBe("");
    expect(panel.indexOf("{p.tabs}")).toBeGreaterThan(panel.indexOf("{p.decision}"));
    expect(panel.slice(panel.indexOf("{p.tabs}") + "{p.tabs}".length).replace(/<\/div>[\s\S]*$/, "").trim()).toBe("");
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

  // P9-04 (X2): the panel (`reader-panel`, globals.css) is the one scroll region, so the file names no class that
  // would make a block inside it scroll, shrink or keep a floor. (P10-02: the terms it was pinned on are gone.)
  it("gives no block of the panel a window of its own: no wrapper class that scrolls, shrinks or keeps a floor (P9-04)", () => {
    expect(source).not.toMatch(/xl:(?:shrink|overflow-)|min-h-\[|max-h-\[/);
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

// P9-04 follow-up (§1h.50 a): where a tab the reader picks starts. The page's `startOfTab` scrolled to the
// common blocks when they had gone off the top. In one column they used to stand BELOW the strip; since the
// strip moved to directly above its panel they stand above it, so a pick made at the strip threw the page back
// up to "Before you read" (measured at 390 x 844: scrollY 1,048 -> 616, the strip from y 13 to y 445). In one
// column the start of a tab is its panel (`scroll-mt-20` leaves the strip above it in view); on the spread the
// column still opens with the common blocks, as before. No DOM here: the lookup is a stub with rects.
describe("scrollToTabStart — where a picked tab starts (P9-04 follow-up, §1h.50 a)", () => {
  /** A document of the named elements and their tops; every `scrollIntoView` is written down. */
  function stub(tops: Record<string, number>) {
    const scrolled: Array<{ id: string; arg: unknown }> = [];
    const doc = {
      getElementById: (id: string) =>
        id in tops
          ? ({ getBoundingClientRect: () => ({ top: tops[id] }), scrollIntoView: (arg: unknown) => scrolled.push({ id, arg }) } as unknown as HTMLElement)
          : null,
    };
    return { doc, scrolled };
  }

  it("one column: never back up to the common blocks, whatever their top (the measured jump)", () => {
    // The strip is in view at the top of a phone (y 13), its panel 54 px below, the common blocks 350 above.
    const { doc, scrolled } = stub({ [COMMON_ID]: -352, [TABPANEL_ID]: 67 });

    scrollToTabStart(false, doc);

    expect(scrolled).toEqual([]);
  });

  it("one column: when the panel has gone off the top, the page goes to the panel (the strip above it), not to the common blocks", () => {
    const { doc, scrolled } = stub({ [COMMON_ID]: -900, [TABPANEL_ID]: -40 });

    scrollToTabStart(false, doc);

    expect(scrolled).toEqual([{ id: TABPANEL_ID, arg: { block: "start" } }]);
  });

  it("one column: with no common blocks on the page it is the same", () => {
    const { doc, scrolled } = stub({ [TABPANEL_ID]: -40 });

    scrollToTabStart(false, doc);

    expect(scrolled).toEqual([{ id: TABPANEL_ID, arg: { block: "start" } }]);
  });

  it("the spread, unchanged: the column opens with the common blocks, and a pick goes there when they have scrolled off", () => {
    const off = stub({ [COMMON_ID]: -300, [TABPANEL_ID]: 120 });
    scrollToTabStart(true, off.doc);
    expect(off.scrolled).toEqual([{ id: COMMON_ID, arg: { block: "start" } }]);

    // On screen already: nothing moves.
    const on = stub({ [COMMON_ID]: 80, [TABPANEL_ID]: 400 });
    scrollToTabStart(true, on.doc);
    expect(on.scrolled).toEqual([]);

    // No common blocks: the panel, when it has scrolled off.
    const bare = stub({ [TABPANEL_ID]: -10 });
    scrollToTabStart(true, bare.doc);
    expect(bare.scrolled).toEqual([{ id: TABPANEL_ID, arg: { block: "start" } }]);
  });

  it("does nothing on a page with neither (no tabs, no body)", () => {
    for (const spread of [false, true]) {
      const { doc, scrolled } = stub({});

      scrollToTabStart(spread, doc);

      expect(scrolled).toEqual([]);
    }
  });
});

describe("page.tsx hands the tab pick's start to scrollToTabStart with the layout it is in (P9-04 follow-up)", () => {
  const page = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");
  const start = page.slice(page.indexOf("const startOfTab = useCallback("), page.indexOf("const { tab, select: selectTab, reveal } = useReaderTab"));

  it("startOfTab is scrollToTabStart(spread, document), re-made when the layout changes, and no longer reads the common blocks itself", () => {
    expect(start).toContain("scrollToTabStart(spread, document)");
    expect(start).toContain("[spread]");
    expect(start).not.toContain("COMMON_ID");
    expect(start).not.toContain("getElementById");
  });
});
