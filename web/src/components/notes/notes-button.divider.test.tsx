import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DOCK_TOP_PX, MASTHEAD_MIN_VIEWPORT_PX, legendHeightPx } from "@/components/reader/explain-dock";
import { DIVIDER_PX, fitPanes, readingCentreMinimum, railMinimumWidth } from "@/components/reader/pane-layout";
import { bottomMarginRectOf, marginRectOf, type MarginRect } from "@/lib/reader/margin";
import { WINDOW_HEADER_PX, stackLayout, type FloatingWindow } from "@/lib/reader/windows";
import {
  EDGE_TAB_BESIDE_PX,
  EDGE_TAB_DIVIDER_CLEAR_PX,
  EDGE_TAB_FOOT_CLEAR_PX,
  EDGE_TAB_HEADER_CLEAR_PX,
  EDGE_TAB_HIT_PX,
  EDGE_TAB_LENGTH_PX,
  NotesButtonView,
  clearOfHeaders,
  edgeTabTopPx,
  readHeaderBands,
  topBesideCard,
} from "./notes-button";

// P12-89 (E5; A P12-88 §7, blind reader B3-r1): the fixed "Open your notes" tab never stands over the margin's pane divider.
//
// While a card stood in a side margin the tab stood "beside the card" at the margin's left edge: `left: <edge>; translateX(-100%)`, 15 px wide, so its face was x
// <edge> - 15 to <edge>. The margin divider's 12 px hit strip is the grid track between the centre and the margin (`.reader-shell`: `... 12px minmax(0, 1fr) 12px
// var(--margin-w)`), x <edge> - 12 to <edge>: the tab covered the strip's whole width for the tab's whole length (12 x 146 = 1,752 px², A's number), and the pointer
// there was the tab's: `default`, and a drag at the tab's height did nothing.
//
// The rule: the tab's rect never meets the strip — it stands just inside the margin, `EDGE_TAB_DIVIDER_CLEAR_PX` right of the strip's edge (its frame, 1 px outside its
// box, 2 px clear) — and it does not stand over a card's header controls: where the place it has would cover a header row it moves below it, at the same x.
//
// There is no DOM in this suite, so no rect can be read. The tab's x is the `left:` and `width:` its markup declares; its y is the CSS expression of its class, worked out by
// the evaluator below (copied from `notes-button.foot.test.tsx`) or the `top:` a header forces; the strip's rect is worked out apart from the tab, from the pane widths the
// shell lays out (`fitPanes`) and the track the stylesheet gives the divider; a card's header rows are the 40 px rows the stack lays out (`stackLayout`). Measured in a real
// browser too (the real markup and stylesheet, Chromium, a static page) — see the checkpoint.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const CSS = read("src/app/globals.css");
const REM_PX = 16;
const LEGEND_PX = Number(/--legend-h:\s*(\d+(?:\.\d+)?)rem;/.exec(CSS)?.[1]) * REM_PX;

// ── A small CSS length evaluator: calc / min / max / var / env over px, rem and vh (as in `notes-button.foot.test.tsx`) ─────────────

type Props = Record<string, string>;

function evaluate(source: string, props: Props, vh: number): number {
  const tokens = source.match(/\d+(?:\.\d+)?(?:px|rem|vh)?|--[\w-]+|[a-z][\w-]*\(?|[+\-*/(),]/g) ?? [];
  expect(tokens.join(""), `every character of ${source} is a token`).toBe(source.replace(/\s+/g, ""));
  let at = 0;
  const next = () => tokens[at++];
  const unit = (token: string): number => {
    const n = Number.parseFloat(token);
    if (token.endsWith("rem")) return n * REM_PX;
    if (token.endsWith("vh")) return (n * vh) / 100;
    return n;
  };
  const list = (): number[] => {
    const values = [sum()];
    while (tokens[at] === ",") {
      at++;
      values.push(sum());
    }
    expect(next(), "the argument list closes").toBe(")");
    return values;
  };
  const factor = (): number => {
    const token = next();
    if (token === "(") {
      const value = sum();
      expect(next()).toBe(")");
      return value;
    }
    if (/^\d/.test(token)) return unit(token);
    if (token === "calc(") return list()[0];
    if (token === "min(") return Math.min(...list());
    if (token === "max(") return Math.max(...list());
    if (token === "var(") {
      const name = next();
      const fallback = tokens[at] === "," ? (at++, sum()) : undefined;
      expect(next()).toBe(")");
      if (name in props) return evaluate(props[name], props, vh);
      if (fallback === undefined) throw new Error(`${name} is not set`);
      return fallback;
    }
    if (token === "env(") {
      next();
      expect(next()).toBe(",");
      const fallback = sum();
      expect(next()).toBe(")");
      return fallback;
    }
    throw new Error(`unexpected ${token} in ${source}`);
  };
  const product = (): number => {
    let value = factor();
    while (tokens[at] === "*" || tokens[at] === "/") value = next() === "*" ? value * factor() : value / factor();
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[at] === "+" || tokens[at] === "-") value = next() === "+" ? value + product() : value - product();
    return value;
  };
  const result = sum();
  expect(at, `${source} is read to its end`).toBe(tokens.length);
  return result;
}

// ── The tab as markup, and its rect ───────────────────────────────────────────────────────────────────────────────────────────────

const view = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has: true, onOpen: () => {}, ...props } as never));
const classesOf = (html: string) => (/class="([^"]*)"/.exec(html)?.[1] ?? "").replace(/&amp;/g, "&").split(/\s+/).filter(Boolean);
const styleOf = (html: string) => /style="([^"]*)"/.exec(html)?.[1] ?? "";
const px = (html: string, prop: string) => {
  const found = new RegExp(`[;"]${prop}:(-?\\d+(?:\\.\\d+)?)px`).exec(html);
  return found ? Number(found[1]) : undefined;
};

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The tab's width as laid out: the declared one, else the base tab's 25.1 px (its border, 2 x 4 of padding and a 16.1 px line). */
const tabWidth = (html: string) => px(html, "width") ?? 25.1;

/** The tab's rect in the window's px at `width` x `height`, from its markup alone: x from `left` / `width` (or the right edge), y from the class's CSS or the `top:` that overrides it. */
function tabRect(html: string, width: number, height: number): Rect {
  const classes = classesOf(html);
  const props: Props = { "--legend-h": `${LEGEND_PX}px` };
  for (const c of classes) {
    const base = /^\[(--[\w-]+):(.+)\]$/.exec(c);
    if (base) props[base[1]] = base[2];
  }
  if (width >= MASTHEAD_MIN_VIEWPORT_PX) {
    for (const c of classes) {
      const md = /^md:\[(--[\w-]+):(.+)\]$/.exec(c);
      if (md) props[md[1]] = md[2];
    }
  }
  for (const [, name, value] of styleOf(html).matchAll(/(--[\w-]+):([^;]+)/g)) props[name] = value;
  const topClass = classes.filter((c) => /^top-\[/.test(c));
  const lengthClass = classes.filter((c) => /^h-\[\d+(?:\.\d+)?px\]$/.test(c));
  expect(topClass, "exactly one `top` class").toHaveLength(1);
  expect(lengthClass, "exactly one `h` class").toHaveLength(1);
  const length = Number.parseFloat(lengthClass[0].slice(3));
  const top = px(html, "top") ?? evaluate(topClass[0].slice(5, -1), props, height);
  const w = tabWidth(html);
  const left = px(html, "left");
  // a tab with a `left` has it as its left edge (P12-89: no translation); one without stands on the window's right edge
  expect(html).not.toContain("translateX");
  return left === undefined ? { left: width - w, top, right: width, bottom: top + length } : { left, top, right: left + w, bottom: top + length };
}

/** The overlap of two rects, in px²; 0 where they touch or are apart. */
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

// ── The layouts: the windows A measured, at the default and the largest reading step ──────────────────────────────────────────────

const STEPS = { default: 1, largest: 1.6 } as const;
const CELLS = [
  [1440, 900, "default"],
  [1440, 900, "largest"],
  [1024, 576, "default"],
  [1024, 576, "largest"],
  [853, 480, "default"],
  [853, 480, "largest"],
] as const;

interface Layout {
  name: string;
  width: number;
  height: number;
  step: number;
  /** The page registers a side margin here (the rail): a card stands in it, the tab beside the card. */
  rail: boolean;
  /** The margin as the page registers it. */
  rect: MarginRect;
  /** The margin divider's hit strip, in the window's px: the 12 px track that ends at the margin cell's left edge, over the row (masthead's foot to the legend's top). */
  strip: Rect;
}

function layoutOf(width: number, height: number, stepName: keyof typeof STEPS, zoom = 1): Layout {
  const step = STEPS[stepName];
  const rail = width >= railMinimumWidth(step);
  const fit = fitPanes({ viewport: width, centreMinimum: readingCentreMinimum(step) });
  const marginLeft = width - fit.margin;
  const rect = rail ? marginRectOf({ left: marginLeft, width: fit.margin }, height, zoom) : bottomMarginRectOf(width, height, zoom);
  const strip = { left: marginLeft - DIVIDER_PX * zoom, right: marginLeft, top: DOCK_TOP_PX, bottom: height - legendHeightPx(zoom) };
  return { name: `${width} x ${height}, ${stepName} step${zoom === 1 ? "" : `, Fit zoom ${zoom}`}`, width, height, step, rail, rect, strip };
}
const LAYOUTS = CELLS.map(([w, h, s]) => layoutOf(w, h, s));

describe("the constants this test stands on are what the shell has (P12-89 E5)", () => {
  it("the margin divider is a 12 px grid track between the centre and the margin: its hit strip ends where the margin cell begins", () => {
    const grid = /\.reader-shell \{[^}]*grid-template-columns:\s*([^;]+);/.exec(CSS)?.[1].trim();

    expect(DIVIDER_PX).toBe(12);
    expect(grid).toBe("var(--left-w) 12px minmax(0, 1fr) 12px var(--margin-w, 360px)");
    expect(read("src/components/reader/pane-divider.tsx")).toContain('className="reader-divider"');
    expect(EDGE_TAB_DIVIDER_CLEAR_PX).toBeGreaterThanOrEqual(2 + 1); // the frame (1 px outside the box) is 2 px clear
    expect(EDGE_TAB_BESIDE_PX).toBe(15);
    expect(EDGE_TAB_HIT_PX).toBe(24);
    expect(EDGE_TAB_HEADER_CLEAR_PX).toBeGreaterThan(0);
  });

  it("the layouts: the rail (a side margin) at 1440 x 900 at both steps, 1024 x 576 and 853 x 480 at the default step; the bottom band at the largest step below 1,138 px", () => {
    expect(LAYOUTS.map((l) => [l.name, l.rail])).toEqual([
      ["1440 x 900, default step", true],
      ["1440 x 900, largest step", true],
      ["1024 x 576, default step", true],
      ["1024 x 576, largest step", false],
      ["853 x 480, default step", true],
      ["853 x 480, largest step", false],
    ]);
  });
});

describe("the tab's rect never meets the margin divider's hit strip, with a card open (P12-89 E5)", () => {
  for (const layout of LAYOUTS) {
    for (const has of [true, false]) {
      const label = has ? "Open your notes" : "Notes";
      it(`${layout.name}, "${label}": clear of the strip by at least 2 px, frame included`, () => {
        // what NotesButton hands the view with a card standing: beside a side margin; not beside the band (the right edge), the band's top written
        const html = layout.rail
          ? view({ has, beside: true, marginLeft: layout.rect.left })
          : view({ has, beside: false, marginLeft: layout.rect.left, bandTop: layout.rect.top });
        const tab = tabRect(html, layout.width, layout.height);

        expect(overlap(tab, layout.strip), "the tab's rect and the strip share no area").toBe(0);
        // the frame (`shadow-card`, 1 px outside the box) is counted: 2 px clear is the rule
        const clearOnTheRight = tab.left - 1 - layout.strip.right;
        if (layout.rail) expect(clearOnTheRight, "right of the strip").toBeGreaterThanOrEqual(2);
        else expect(tab.left - layout.strip.right, "the band's tab is on the window's right edge, far right of the strip").toBeGreaterThan(100);
      });
    }
  }

  it("BEFORE (the placement the view had): the face ended at the margin's edge, x <edge> - 15 to <edge> — the check can fail, and it did: 12 x 146 = 1,752 px²", () => {
    for (const layout of LAYOUTS.filter((l) => l.rail)) {
      const html = view({ has: true, beside: true, marginLeft: layout.rect.left });
      const now = tabRect(html, layout.width, layout.height);
      // the old rect: the same y, x ending at the margin's edge
      const before = { ...now, left: layout.rect.left - EDGE_TAB_BESIDE_PX, right: layout.rect.left };

      expect(overlap(before, layout.strip), layout.name).toBe(DIVIDER_PX * EDGE_TAB_LENGTH_PX.open);
      expect(overlap(before, layout.strip)).toBe(1752);
      expect(overlap(now, layout.strip), layout.name).toBe(0);
    }
  });

  it("the transparent hit strip (24 px across with the face) is on the card's side and meets the divider's strip nowhere either", () => {
    for (const layout of LAYOUTS.filter((l) => l.rail)) {
      const html = view({ has: true, beside: true, marginLeft: layout.rect.left });
      const tab = tabRect(html, layout.width, layout.height);
      const extra = EDGE_TAB_HIT_PX - EDGE_TAB_BESIDE_PX;
      const hit = { ...tab, right: tab.right + extra };

      expect(html).toContain(`before:-right-[${extra}px]`);
      expect(hit.right - hit.left, layout.name).toBe(EDGE_TAB_HIT_PX);
      expect(overlap(hit, layout.strip), layout.name).toBe(0);
      expect(hit.right, "inside the margin").toBeLessThanOrEqual(layout.width);
    }
  });

  it("at Fit's zoom too: the strip is 12 x zoom wide in the window's px and still ends at the margin cell's left edge, which the tab is right of", () => {
    for (const zoom of [1.142, 1.378, 1.838, 2.5]) {
      const fit = layoutOf(1920, 1080, "default", zoom);
      const html = view({ has: true, beside: true, marginLeft: fit.rect.left, zoom });
      const tab = tabRect(html, 1920, 1080);

      expect(fit.strip.right - fit.strip.left).toBeCloseTo(DIVIDER_PX * zoom, 6);
      expect(overlap(tab, fit.strip), `zoom ${zoom}`).toBe(0);
      expect(tab.left - 1 - fit.strip.right, `zoom ${zoom}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("the tab with no card, and the phone's, are as they were: the window's right edge, no left, no translation", () => {
    for (const layout of LAYOUTS) {
      const html = view({ has: true });

      expect(html).not.toContain("left:");
      expect(classesOf(html)).toContain("right-0");
      expect(classesOf(html)).toContain("z-40");
      expect(overlap(tabRect(html, layout.width, layout.height), layout.strip), layout.name).toBe(0);
    }
  });
});

// ── A card's header controls ────────────────────────────────────────────────────────────────────────────────────────────────────────

const card = (id: string, kind: FloatingWindow["kind"], order: number): FloatingWindow => ({ id, kind, title: id, order });
const CARDS = [
  [card("s1", "sticky", 1)],
  [card("s1", "sticky", 1), card("e1", "explain", 2)],
  [card("s1", "sticky", 1), card("e1", "explain", 2), card("n1", "notes", 3)],
];

/** The header rows the stack lays out in a margin, in the window's px, for cards that begin level with `anchor`: each row's top, `WINDOW_HEADER_PX` tall, across the card. */
function headersAt(layout: Layout, windows: FloatingWindow[], anchor: number): Rect[] {
  const { rect } = layout;
  const top = Math.min(Math.max(anchor, rect.top), rect.bottom);
  const rows = stackLayout(windows, { top, bottom: rect.bottom, minTop: rect.top });
  return rows.map((row) => ({ left: rect.left, right: rect.left + rect.width, top: row.top, bottom: row.top + WINDOW_HEADER_PX }));
}

/** What `NotesButton` works out for a layout with these header rows, and the tab's rect it gives. */
function placed(layout: Layout, has: boolean, bands: Rect[]) {
  const clearTop = topBesideCard({ marginLeft: layout.rect.left, has, zoom: 1, bands, viewportHeight: layout.height });
  const html = view({ has, beside: true, marginLeft: layout.rect.left, clearTop });
  return { clearTop, html, tab: tabRect(html, layout.width, layout.height) };
}

/** The tops the tab may take, whole px, from the masthead's foot to 8 px above the legend: the oracle's search space (apart from the code under test). */
function searchSpace(layout: Layout, has: boolean): number[] {
  const length = EDGE_TAB_LENGTH_PX[has ? "open" : "take"];
  const most = layout.height - LEGEND_PX - EDGE_TAB_FOOT_CLEAR_PX - length;
  const out: number[] = [];
  for (let top = DOCK_TOP_PX; top <= most; top++) out.push(top);
  return out;
}
const coverOf = (top: number, length: number, bands: Rect[], gap: number) =>
  bands.reduce((sum, b) => sum + Math.max(0, Math.min(top + length, b.bottom + gap) - Math.max(top, b.top - gap)), 0);

describe("the tab does not stand over a card's header controls; where it would, it moves below the header (P12-89 E5)", () => {
  const RAILS = LAYOUTS.filter((l) => l.rail);

  for (const layout of RAILS) {
    for (const has of [true, false]) {
      const length = EDGE_TAB_LENGTH_PX[has ? "open" : "take"];
      it(`${layout.name}, ${has ? "Open your notes" : "Notes"}: for 1 to 3 cards level with every 10 px of the margin, the tab covers no header where a clear place exists, and the least where none does`, () => {
        const space = searchSpace(layout, has);
        let moved = 0;
        let unmoved = 0;
        let crowded = 0;
        for (const windows of CARDS) {
          for (let anchor = layout.rect.top; anchor <= layout.rect.bottom; anchor += 10) {
            const bands = headersAt(layout, windows, anchor);
            const { clearTop, tab } = placed(layout, has, bands);
            const wanted = edgeTabTopPx({ viewportHeight: layout.height, length, footPx: LEGEND_PX });
            const here = `${windows.length} card(s) level with ${anchor}`;
            const gap = EDGE_TAB_HEADER_CLEAR_PX;
            const best = Math.min(...space.map((top) => coverOf(top, length, bands, gap)));

            // the E1 rule is not undone: 8 px above the legend, not above the masthead's foot
            expect(layout.height - LEGEND_PX - tab.bottom, here).toBeGreaterThanOrEqual(EDGE_TAB_FOOT_CLEAR_PX);
            expect(tab.top, here).toBeGreaterThanOrEqual(DOCK_TOP_PX);
            // no header row is under the tab's rect where any place is clear; else it is the place that covers the least
            const covered = bands.reduce((sum, b) => sum + overlap(tab, b), 0);
            if (best === 0) {
              expect(covered, `${here}: the tab's rect and the header rows`).toBe(0);
              expect(coverOf(tab.top, length, bands, gap), here).toBe(0);
            } else {
              crowded++;
              expect(coverOf(tab.top, length, bands, gap), `${here}: the least covered`).toBeCloseTo(best, 6);
            }
            // it stays where it was unless that place would cover a header (within the clear), and moves only then
            if (clearTop === undefined) {
              unmoved++;
              expect(tab.top, here).toBe(wanted);
              expect(coverOf(wanted, length, bands, gap), here).toBe(0);
            } else {
              moved++;
              expect(coverOf(wanted, length, bands, gap), `${here}: it moved, so its place was covered`).toBeGreaterThan(0);
              // below the header it met, when a clear place below exists: the smallest one
              const below = space.filter((top) => top > wanted && coverOf(top, length, bands, gap) === 0);
              if (below.length > 0) expect(clearTop, `${here}: the nearest clear place below`).toBe(below[0]);
            }
          }
        }
        // the sweep is not vacuous: it left the tab where it was, and (the long label, whose place the cards' headers reach) it moved it
        // (the short label is 80 px shorter and stands lower in a short window than the front card's header can reach: nothing to move there)
        if (has) expect(moved, "some layouts need the tab moved").toBeGreaterThan(0);
        expect(unmoved, "some layouts leave it where it was").toBeGreaterThan(0);
        expect(crowded).toBeLessThan(moved + unmoved);
      });
    }
  }

  it("the check can fail: with the tab left in its usual place, it covers a header in a good share of those layouts (the control)", () => {
    const layout = RAILS[0];
    let covers = 0;
    let total = 0;
    for (const windows of CARDS) {
      for (let anchor = layout.rect.top; anchor <= layout.rect.bottom; anchor += 10) {
        const bands = headersAt(layout, windows, anchor);
        const html = view({ has: true, beside: true, marginLeft: layout.rect.left });
        total++;
        if (bands.some((b) => overlap(tabRect(html, layout.width, layout.height), b) > 0)) covers++;
      }
    }

    expect(covers).toBeGreaterThan(0);
    expect(covers).toBeLessThan(total);
  });

  it("the measure: at each layout, with one sticky level with the tab's own place (the worst case), the tab's rect against the header row, before (unmoved) and after", () => {
    for (const layout of RAILS) {
      const length = EDGE_TAB_LENGTH_PX.open;
      const wanted = edgeTabTopPx({ viewportHeight: layout.height, length, footPx: LEGEND_PX });
      // a sticky whose header begins 20 px above the tab's usual top, so the header row [wanted - 20, wanted + 20] is under the tab's first 20 px
      const bands = headersAt(layout, [card("s1", "sticky", 1)], wanted - 20);
      const header = bands[0];
      const { clearTop, tab } = placed(layout, true, bands);
      const before = tabRect(view({ has: true, beside: true, marginLeft: layout.rect.left }), layout.width, layout.height);
      const foot = layout.height - LEGEND_PX - EDGE_TAB_FOOT_CLEAR_PX;
      const roomBelow = header.bottom + EDGE_TAB_HEADER_CLEAR_PX + length <= foot;

      expect(overlap(before, header), `${layout.name}: before`).toBeGreaterThan(0);
      expect(clearTop, layout.name).toBeDefined();
      // below the header where the window has the room (1440 x 900); where it has none (1024 x 576 and 853 x 480: the tab and the legend's 8 px leave 394 and 298 as
      // the greatest top, and a header that reaches the tab's place ends below it) it stands above the header instead, never under the legend
      if (roomBelow) expect(tab.top, `${layout.name}: below the header`).toBeGreaterThanOrEqual(header.bottom + EDGE_TAB_HEADER_CLEAR_PX);
      else expect(tab.bottom, `${layout.name}: above the header`).toBeLessThanOrEqual(header.top - EDGE_TAB_HEADER_CLEAR_PX);
      expect(tab.bottom).toBeLessThanOrEqual(foot);
      expect(overlap(tab, header), `${layout.name}: after`).toBe(0);
      expect(tab.left, "at the same x").toBe(before.left);
      expect(tab.right).toBe(before.right);
    }
    // the cases that matter to the reader: the 1440 x 900 window has the room below, the short ones do not
    const [first] = RAILS;
    expect(headersAt(first, [card("s1", "sticky", 1)], 430)[0].bottom + EDGE_TAB_HEADER_CLEAR_PX + EDGE_TAB_LENGTH_PX.open).toBeLessThanOrEqual(first.height - LEGEND_PX - EDGE_TAB_FOOT_CLEAR_PX);
  });

  it("a header at the foot of the margin, with no room below it, sends the tab above it — never past the legend's 8 px", () => {
    const layout = RAILS[0];
    const length = EDGE_TAB_LENGTH_PX.open;
    const foot = layout.height - LEGEND_PX - EDGE_TAB_FOOT_CLEAR_PX;
    const header = { left: layout.rect.left, right: layout.rect.left + layout.rect.width, top: foot - 60, bottom: foot - 20 };
    const { tab } = placed(layout, true, [header]);

    expect(tab.bottom).toBeLessThanOrEqual(foot);
    expect(tab.bottom, "above the header").toBeLessThanOrEqual(header.top - EDGE_TAB_HEADER_CLEAR_PX);
    expect(tab.top).toBeGreaterThanOrEqual(DOCK_TOP_PX);
    expect(tab.bottom - tab.top).toBe(length);
  });
});

describe("clearOfHeaders — the placement on invented header rows (P12-89 E5)", () => {
  // the tab: 146 px long, x 1003 to 1018; its usual top 450; the masthead's foot 48; the greatest top it may take 520 (8 px above the legend, less its length)
  const base = { wanted: 450, length: 146, left: 1003, right: 1018, least: 48, most: 520 };
  const row = (top: number, bottom: number, left = 1000, right = 1360) => ({ left, right, top, bottom });

  it("no header, or none the tab would meet: it stays (undefined)", () => {
    expect(clearOfHeaders({ ...base, bands: [] })).toBeUndefined();
    expect(clearOfHeaders({ ...base, bands: [row(100, 140)] })).toBeUndefined(); // above it, with room to spare
    expect(clearOfHeaders({ ...base, bands: [row(620, 660)] })).toBeUndefined(); // below it, with room to spare
    expect(clearOfHeaders({ ...base, bands: [row(440, 480, 1100, 1360)] })).toBeUndefined(); // a row that begins right of the tab
    expect(clearOfHeaders({ ...base, bands: [row(440, 480, 900, 1003)] })).toBeUndefined(); // a row that ends where the tab begins
    expect(clearOfHeaders({ ...base, bands: [row(400, 440)] })).toBeUndefined(); // 10 px above its top: clear by more than the 4 px
  });

  it("a header under its first rows: the tab goes just below it, by the clear", () => {
    expect(clearOfHeaders({ ...base, bands: [row(430, 470)] })).toBe(474);
    expect(clearOfHeaders({ ...base, bands: [row(400, 450)] })).toBe(454); // 4 px below the row's foot
  });

  it("is held between the masthead's foot and the greatest top: a place below that does not fit is not taken, and the tab goes above the header", () => {
    const top = clearOfHeaders({ ...base, bands: [row(560, 600)] });

    expect(top).toBe(560 - 4 - 146);
    expect(top! + 146, "its foot is the header's top less the clear").toBe(560 - 4);
    expect(top!).toBeGreaterThanOrEqual(base.least);
  });

  it("a stack of headers: below the last one that it meets, each in turn", () => {
    expect(clearOfHeaders({ ...base, most: 700, bands: [row(400, 440), row(440, 480), row(480, 520)] })).toBe(524);
  });

  it("room between two headers: it takes the gap if it fits there, else goes past both", () => {
    // headers 100 px apart: a 146 px tab cannot stand between them; the first clear place below both
    expect(clearOfHeaders({ ...base, most: 700, wanted: 440, bands: [row(400, 440), row(540, 580)] })).toBe(584);
    // headers 200 px apart: it stands in the gap
    expect(clearOfHeaders({ ...base, most: 700, wanted: 440, bands: [row(400, 440), row(640, 680)] })).toBe(444);
  });

  it("no clear place at all: the place that covers the least of them", () => {
    // crowded: a header every 60 px across the whole range; any 146 px stretch holds at least two
    const bands = Array.from({ length: 12 }, (_, i) => row(48 + i * 60, 88 + i * 60));
    const top = clearOfHeaders({ ...base, wanted: 300, bands, most: 600 })!;
    const covered = (t: number) => bands.reduce((s, b) => s + Math.max(0, Math.min(t + 146, b.bottom + 4) - Math.max(t, b.top - 4)), 0);
    const best = Math.min(...Array.from({ length: 553 }, (_, i) => covered(48 + i)));

    expect(best).toBeGreaterThan(0);
    expect(covered(top)).toBe(best);
  });
});

describe("the markup: a lowered tab writes its top inline, and only beside a card (P12-89 E5)", () => {
  it("clearTop is the tab's `top` in px, over its class's; left and width are untouched", () => {
    const html = view({ beside: true, marginLeft: 1000, clearTop: 474 });

    expect(px(html, "top")).toBe(474);
    expect(px(html, "left")).toBe(1000 + EDGE_TAB_DIVIDER_CLEAR_PX);
    expect(px(html, "width")).toBe(EDGE_TAB_BESIDE_PX);
    expect(classesOf(html).filter((c) => /^top-\[/.test(c))).toHaveLength(1);
  });

  it("without it the markup has no `top:`; and a tab that is not beside a card ignores it", () => {
    expect(styleOf(view({ beside: true, marginLeft: 1000 }))).not.toContain("top:");
    expect(view({ beside: false, marginLeft: 1000, clearTop: 474 })).not.toContain("top:");
    expect(view({ clearTop: 474 })).not.toContain("style=");
    expect(view({ beside: true, clearTop: 474 })).not.toContain("top:"); // no margin registered: the card's 360 px, the tab left of it
  });

  it("it is over the cards beside a margin (z-[69], the top of the stack) and z-40 anywhere else", () => {
    expect(classesOf(view({ beside: true, marginLeft: 1000 }))).toContain("z-[69]");
    expect(classesOf(view({ beside: true }))).toContain("z-40");
    expect(classesOf(view({}))).toContain("z-40");
    expect(read("src/lib/reader/windows.ts")).toContain("export const STACK_Z_MAX = 69;");
  });
});

describe("edgeTabTopPx — the place the class states, worked out in script (P12-89 E5)", () => {
  it("equals the class's `top` at every window height from 300 px to 1400, for both labels, from md", () => {
    for (const width of [768, 1024, 1440]) {
      for (let height = 300; height <= 1400; height += 10) {
        for (const has of [true, false]) {
          const length = EDGE_TAB_LENGTH_PX[has ? "open" : "take"];
          const html = view({ has });

          expect(edgeTabTopPx({ viewportHeight: height, length, footPx: LEGEND_PX }), `${width} x ${height}, ${has}`).toBeCloseTo(tabRect(html, width, height).top, 6);
        }
      }
    }
  });

  it("and under Fit's zoom (the legend is taller): the same, with --tab-legend", () => {
    for (const zoom of [1.142, 1.378, 1.838, 2.5]) {
      for (const height of [540, 576, 720, 1080]) {
        const html = view({ zoom });

        expect(edgeTabTopPx({ viewportHeight: height, length: EDGE_TAB_LENGTH_PX.open, footPx: legendHeightPx(zoom) }), `zoom ${zoom}, ${height}`).toBeCloseTo(tabRect(html, 1920, height).top, 6);
      }
    }
  });
});

describe("readHeaderBands — the rows are the ones the selection's actions keep clear of (P12-89 E5)", () => {
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
  const row = (b: ReturnType<typeof box>) => ({ getBoundingClientRect: () => b, childNodes: [], children: [] });
  const fakeCard = (kind: string, outer: ReturnType<typeof box>, first: ReturnType<typeof box>, extra: Record<string, unknown> = {}) => ({
    getBoundingClientRect: () => outer,
    getAttribute: (name: string) => (name === "data-margin-card" ? kind : null),
    firstElementChild: row(first),
    querySelector: () => null,
    querySelectorAll: () => [],
    ...extra,
  });

  it("a sticky's header is its first element's box; a card with no box is left out", () => {
    const sticky = fakeCard("sticky", box(1000, 300, 1360, 560), box(1001, 301, 1359, 341));
    const hidden = fakeCard("sticky", box(0, 0, 0, 0), box(0, 0, 0, 0));
    const root = { querySelectorAll: () => [sticky, hidden] } as never;

    expect(readHeaderBands(root)).toEqual([{ left: 1001, top: 301, right: 1359, bottom: 341 }]);
  });

  it("the explain card's header is its top row, from the card's top; the figure's zoom row is a second header", () => {
    const outer = box(1000, 100, 1360, 700);
    const explainRow = row(box(1004, 104, 1356, 140));
    const explain = fakeCard("explain", outer, box(1001, 101, 1359, 420), {
      querySelector: (selector: string) => (selector === "[data-explain-close]" ? { parentElement: explainRow } : null),
    });
    const figure = fakeCard("figure", box(1000, 440, 1360, 840), box(1001, 441, 1359, 481), {
      querySelector: (selector: string) => (selector === "[data-figure-zoom-row]" ? row(box(1001, 481, 1359, 517)) : null),
    });
    const bands = readHeaderBands({ querySelectorAll: () => [explain, figure] } as never);

    expect(bands).toEqual([
      { left: 1000, top: 100, right: 1360, bottom: 140 },
      { left: 1001, top: 441, right: 1359, bottom: 481 },
      { left: 1001, top: 481, right: 1359, bottom: 517 },
    ]);
  });
});
