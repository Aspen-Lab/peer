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

// P11-16 (B P11-01 §2.3, §2.4, §3.2; ruling §1h.113 (a)), RE-AIMED from the two-column spread's cases: from 1024 css px the blocks are
// placed in the three-pane shell's zones. The left pane's fixed zone holds the reading controls, the title, the commands and the
// Summary / Paper digestion strip; its scroll zone the map, then the plate and the details; the centre the common blocks, the active
// tab's blocks and Next. A paper with no strip and no map has no scroll zone: the pane scrolls as one (`whole`).
const PANES = { details: mark("DETAILS"), progress: mark("PROGRESS") };

/** The three panes' regions of a rendered page: from each region's opening tag to the next region's. */
function panes(html: string) {
  const left = html.indexOf("data-reader-left=");
  const fixed = html.indexOf("data-reader-left-fixed");
  const scroll = html.indexOf("data-reader-left-scroll");
  const divider = html.indexOf('data-reader-divider="left"');
  const centre = html.indexOf("data-reader-centre");
  const margin = html.indexOf("data-reader-margin");
  return {
    left,
    centre,
    margin,
    pane: html.slice(left, divider),
    fixed: html.slice(fixed, scroll),
    scroll: html.slice(scroll, divider),
    column: html.slice(centre, margin),
  };
}

describe("ReaderLayout, the three panes, a paper with no body (R2; P11-16)", () => {
  const html = render(true, PANES);
  const { left, centre, pane, column } = panes(html);

  it("shows paper details in the reading column", () => {
    expect(centre).toBeGreaterThan(left);
    for (const name of ["TITLE", "DECISION", "PROGRESS", "DETAILS", "WORDS", "ADDITIONS", "PLATE", "NEXT"]) {
      expect(column).toContain(`data-mark="${name}"`);
      expect(pane).not.toContain(`data-mark="${name}"`);
    }
    expect(column).toContain('aria-label="Reading controls"');
  });

  it("has no strip and no map to float, so no zones: the pane scrolls as one", () => {
    expect(html).toContain('data-mode="whole"');
    expect(html).not.toContain("data-reader-left-fixed");
    expect(html).not.toContain("data-reader-left-scroll");
  });

  it("still puts the commands straight after the title when nothing else fills the pane", () => {
    const bare = render(true, { ...PANES, plate: null });

    expect(ascending(order(bare, ["TITLE", "DECISION", "DETAILS", "WORDS"]))).toBe(true);
  });

  it("keeps the paper blocks in the document", () => {
    for (const name of ["TITLE", "DECISION", "PLATE", "DETAILS", "WORDS"]) expect(column).toContain(`data-mark="${name}"`);
  });
});

describe("ReaderLayout, the three panes, a paper with a body (R10; P11-16)", () => {
  const html = tabbed(true, { ...PANES, map: mark("MAP") });
  const { column, left, centre, margin } = panes(html);

  // P11-16 follow-up (ruling §1h.115 item 2), RE-AIMED from "the fixed zone: the reading controls, the title, the commands, the tab strip": the
  // shell has a header slot now, and the reading controls stand in the pane's header row beside the pin button — in the DOM order the reader
  // sees, the pin first — so the fixed zone is the title, the commands and the strip.
  it("orders title, actions, tabs and reading content", () => {
    expect(ascending(order(column, ["TITLE", "DECISION", "DETAILS", "PROGRESS", "TABS", "COMMON", "WORDS", "ADDITIONS", "PLATE", "NEXT"]))).toBe(true);
  });

  // P11-16 follow-up (ruling §1h.115 item 3): the progress stands directly after the commands, in the zone that never scrolls — it was the last
  // thing of the details, which put it at the foot of the scroll zone, under a map of fourteen rows.
  it("keeps progress between actions and tabs", () => {
    expect(at(html, "PROGRESS")).toBeGreaterThan(at(html, "DECISION"));
    expect(at(html, "PROGRESS")).toBeLessThan(at(html, "TABS"));
  });

  it("places reading controls in the document", () => {
    const sidebar = html.slice(left, centre);
    expect(sidebar).toContain("reader-pin-button");
    expect(sidebar).not.toContain('aria-label="Reading controls"');
    expect(column).toContain('aria-label="Reading controls"');
    expect(html.split('aria-label="Reading controls"')).toHaveLength(2);
  });

  it("a paper with no strip and no map has the same header row: the controls beside the pin, then the title", () => {
    const bare = render(true, PANES);
    const row = bare.slice(bare.indexOf("data-reader-left-header"), bare.indexOf('data-mark="TITLE"'));

    expect(ascending([row.indexOf("reader-pin-button"), row.indexOf('aria-label="Reading controls"')])).toBe(true);
  });

  it("keeps the outline separate from document content", () => {
    const sidebar = html.slice(left, centre);
    expect(sidebar).toContain('data-mark="MAP"');
    for (const name of ["TITLE", "DECISION", "TABS", "PLATE", "DETAILS", "WORDS"]) expect(sidebar).not.toContain(`data-mark="${name}"`);
    expect(html).toContain('data-mode="whole"');
  });

  it("orders the document sections", () => {
    expect(ascending(order(column, ["TITLE", "DECISION", "DETAILS", "TABS", "COMMON", "WORDS", "ADDITIONS", "PLATE", "NEXT"]))).toBe(true);
    expect(column).not.toContain('data-mark="MAP"');
  });

  it("the DOM order is the visual order: the left pane, then the centre, then the margin", () => {
    expect(ascending([left, centre, margin])).toBe(true);
  });

  it("the pane has no contents rail and no question box any more", () => {
    const pane = html.slice(left, centre);

    expect(pane).not.toContain('data-mark="COMMON"');
    expect(pane).not.toContain("<nav");
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
    // Everything before the common blocks is the same too: the left pane and the strip are not redrawn by the switch.
    expect(summary.before).toBe(digestion.before);
    expect(summary.chunk).toContain('data-mark="COMMON"');
  });

  // P9-04 (X2), RE-AIMED: the panel scrolled as one, and nothing the layout put inside it scrolled, shrank or had a floor. The scroll zone
  // is the shell's one scroller now, and the layout's own wrappers in either zone still add none of those.
  it("keeps the outline in the sidebar scroller", () => {
    const sidebar = html.slice(left, centre);
    expect(sidebar).toContain('data-mark="MAP"');
    expect(sidebar).not.toContain("overflow-y-auto");
  });

  // goToPassage lands a paragraph at y 80 (`scroll-mt-20` = the masthead's 48 + 32, paper-body.tsx); a picked tab starts at the same y.
  it("the common blocks and the tabpanel keep `scroll-mt-20`, so a tab's start lands at y 80 as the passages do (P11-16)", () => {
    const tag = (marker: string) => html.slice(html.lastIndexOf("<", html.indexOf(marker)), html.indexOf(">", html.indexOf(marker)) + 1);

    expect(tag('id="reader-common"')).toMatch(/class="[^"]*\bscroll-mt-20\b/);
    expect(tag('role="tabpanel"')).toMatch(/class="[^"]*\bscroll-mt-20\b/);
  });

  it("places reading controls above the title", () => {
    expect(column.indexOf('aria-label="Reading controls"')).toBeLessThan(column.indexOf('data-mark="TITLE"'));
    expect(at(html, "TITLE")).toBeLessThan(at(html, "WORDS"));
  });

  it("an empty words slot (Paper digestion) leaves the additions where they were in the tabpanel", () => {
    const shown = tabbed(true, { tab: "digestion", words: null });

    expect(ascending([shown.indexOf('role="tabpanel"'), at(shown, "ADDITIONS"), at(shown, "NEXT")])).toBe(true);
    absent(shown, "WORDS");
  });
});

// One column: the details (the sentence, the private-PDF line, the reading controls, the DOI, the progress) follow the commands — the
// page hands them in a slot of their own now (P11-16), and the order is the one the decision block always had.
describe("ReaderLayout, one column, the details after the commands (P11-16)", () => {
  it("plate, title, decision, details, progress, then the common blocks, the strip, the active tab's blocks, Next", () => {
    const html = tabbed(false, PANES);

    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION", "DETAILS", "PROGRESS", "COMMON", "TABS", "WORDS", "ADDITIONS", "NEXT"]))).toBe(true);
    expect(html).not.toContain("data-reader-shell");
  });

  it("with no details the page is exactly what it was", () => {
    expect(tabbed(false)).not.toContain("DETAILS");
    expect(tabbed(false)).not.toContain("PROGRESS");
    expect(ascending(order(tabbed(false), ["PLATE", "TITLE", "DECISION", "COMMON", "TABS", "WORDS", "ADDITIONS", "NEXT"]))).toBe(true);
  });
});

// P10-04 (review 3.1; A8): the map stands directly under the Summary / Paper digestion strip and floats
// with it. On the spread it is in the panel (the sticky, window-bounded scroll region), straight after the
// strip, so a reader anywhere in the paper can jump by it and a map taller than the panel scrolls inside it;
// in one column it stands between the strip and the tabpanel. It is a slot of its own, outside the tabpanel,
// so it shows under both tabs and a tab switch does not remount it.
describe("ReaderLayout, the map under the strip (P10-04, A8)", () => {
  const withMap = (spread: boolean, over: Record<string, unknown> = {}) => tabbed(spread, { map: mark("MAP"), ...over });

  // P11-16, RE-AIMED: the strip is the fixed zone's last block and the map the scroll zone's first — the strip never scrolls away, and
  // the map is what the pane scrolls. The two are no longer adjacent siblings, but nothing stands between them but the zones' edge.
  it("shows paper details in the reading column0", () => {
    const html = withMap(true, PANES);
    const { pane, column } = panes(html);
    expect(pane).toContain('data-mark="MAP"');
    expect(pane).not.toContain('data-mark="TABS"');
    expect(column).toContain('data-mark="TABS"');
    expect(column).not.toContain('data-mark="MAP"');
    expect(html.split('data-mark="MAP"')).toHaveLength(2);
  });

  it("in one column: directly under the strip and above the tabpanel, outside it", () => {
    const html = withMap(false);

    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION", "COMMON", "TABS", "MAP", "WORDS", "ADDITIONS", "NEXT"]))).toBe(true);
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
    expect(mount).toBeLessThan(page.indexOf("additions={<BookReader"));
    expect(page.slice(page.lastIndexOf("\n", mount), mount)).toMatch(/\bmap=\{/);
  });
});

describe("reader-layout.tsx source (P7-14)", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/reader/reader-layout.tsx"), "utf8");
  const body = source.slice(source.indexOf("export function ReaderLayout"));
  // P11-16, RE-AIMED: the one-column branch ends where the shell's begins (`<ReaderShell`, not the two-column grid).
  const stacked = body.slice(body.indexOf("if (!p.spread)"), body.indexOf("<ReaderShell"));
  const spread = body.slice(body.indexOf("<ReaderShell"));

  it("one column: {p.decision} right after {p.title}, before the tabs, the common blocks and the abstract", () => {
    expect(stacked.slice(stacked.indexOf("{p.title}") + "{p.title}".length, stacked.indexOf("{p.decision}")).trim()).toBe("");
    for (const later of ["{p.tabs}", "{common}", "{panel}"]) {
      expect(stacked.indexOf(later)).toBeGreaterThan(stacked.indexOf("{p.decision}"));
    }
  });

  // P9-04 (X3): the one-column return ends with the strip and the panel it labels, side by side.
  // P10-04 (review 3.1): the map stands between the strip and the panel (JSX comments aside); the terms slot is
  // gone (P10-02).
  it("one column: {p.tabs} stands directly before {p.map}, which stands directly before {panel}, after {common}", () => {
    const between = (from: string, to: string) =>
      stacked.slice(stacked.indexOf(from) + from.length, stacked.indexOf(to)).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trim();

    expect(between("{p.tabs}", "{p.map}")).toBe("");
    expect(between("{p.map}", "{panel}")).toBe("");
    expect(stacked.indexOf("{p.tabs}")).toBeGreaterThan(stacked.indexOf("{common}"));
  });

  // P11-16, RE-AIMED from "the spread's panel: {p.decision} right after {p.title}, then {p.tabs}, and nothing after it": the left pane's fixed
  // zone is the title, the commands and the strip; its scroll zone the map, the plate and the details.
  it("shows paper details in the reading column1", () => {
    expect(spread).toContain('left={{ whole: <div className={ZONE_INSET}>{p.map ??');
    expect(spread.indexOf('{p.title}')).toBeLessThan(spread.indexOf('{p.decision}'));
    expect(spread.indexOf('{p.decision}')).toBeLessThan(spread.indexOf('{p.tabs}'));
    expect(spread.indexOf('{p.tabs}')).toBeLessThan(spread.indexOf('{panel}'));
  });

  it("one column: {p.details} right after {p.decision}, then {p.progress}, before the common blocks", () => {
    expect(stacked.slice(stacked.indexOf("{p.decision}") + "{p.decision}".length, stacked.indexOf("{p.details}")).trim()).toBe("");
    expect(stacked.slice(stacked.indexOf("{p.details}") + "{p.details}".length, stacked.indexOf("{p.progress}")).trim()).toBe("");
    expect(stacked.indexOf("{common}")).toBeGreaterThan(stacked.indexOf("{p.progress}"));
  });

  it("is placed by the shell: no two-column grid, no sticky part, no panel class of spread.ts", () => {
    expect(source).toContain("<ReaderShell");
    expect(source).not.toMatch(/SPREAD_GRID|PANEL_CLASS|PANEL_STICKY_CLASS|PANEL_TAIL_CLASS|COLUMN_CLASS|data-reader-panel|data-reader-sticky/);
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
