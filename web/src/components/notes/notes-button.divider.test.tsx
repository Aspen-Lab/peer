import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DOCK_TOP_PX, MASTHEAD_MIN_VIEWPORT_PX, legendHeightPx } from "@/components/reader/explain-dock";
import { DIVIDER_PX, fitPanes, readingCentreMinimum, railMinimumWidth } from "@/components/reader/pane-layout";
import { bottomMarginRectOf, marginRectOf, type MarginRect } from "@/lib/reader/margin";
import { WINDOW_HEADER_PX, stackLayout, type FloatingWindow } from "@/lib/reader/windows";
import { EDGE_TAB_BESIDE_PX, EDGE_TAB_DIVIDER_CLEAR_PX, EDGE_TAB_HIT_PX, EDGE_TAB_LENGTH_PX, NotesButtonView } from "./notes-button";

// P12-89 (E5; A P12-88 §7, blind reader B3-r1; rulings §1h.475 and §1h.476): the fixed "Open your notes" tab never stands over the margin's pane divider.
//
// While a card stood in a side margin the tab stood "beside the card" at the margin's left edge: `left: <edge>; translateX(-100%)`, 15 px wide, so its face was x <edge> - 15 to
// <edge>. The margin divider's 12 px hit strip is the grid track between the centre and the margin (`.reader-shell`: `... 12px minmax(0, 1fr) 12px var(--margin-w)`), x <edge> - 12 to <edge>:
// the tab covered the strip's whole width for the tab's whole length (12 x 146 = 1,752 px², A's number), and the pointer there was the tab's: `default`, and a drag at the tab's height
// did nothing.
//
// The rule: the tab stands LEFT of the strip, in the centre column's right gutter, 2 px clear of it (`EDGE_TAB_DIVIDER_CLEAR_PX`), and meets no paper text, no card and no header. The
// gutter is the centre's right padding, which is 20 px since this item (`.reader-centre { padding-inline: 12px 20px }`, always: a card open or not, so the words never move when a card
// opens): the 15 px tab, the 2 px clear of the strip and 3 px before the text (its frame, 1 px, 2 px clear).
//
// There is no DOM in this suite, so no rect can be read. The tab's x is the `left:` and `width:` its markup declares (with `translateX(-100%)`: `left` is its right edge); its y is the CSS
// expression of its class, worked out by the evaluator below (copied from `notes-button.foot.test.tsx`); the strip is worked out apart from the tab, from the pane widths the shell lays
// out (`fitPanes`) and the track the stylesheet gives the divider; the text's right edge is no further right than the strip's left edge less the stylesheet's right padding (the column is all
// text at the windows where it is narrower than the 38em cap, and the blank the cap leaves only adds to it); a card's rect is the margin's, its header rows the 40 px rows the stack lays out
// (`stackLayout`). Measured in a real browser too (the real markup and stylesheet, Newsreader, Chromium, a static page) — see the checkpoint.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const CSS = read("src/app/globals.css");
const REM_PX = 16;
const LEGEND_PX = Number(/--legend-h:\s*(\d+(?:\.\d+)?)rem;/.exec(CSS)?.[1]) * REM_PX;
/** The centre's paddings as the stylesheet states them: `padding-inline: 12px 20px` (left, right). */
const PADDING = /\.reader-centre \{[^}]*padding-inline:\s*(\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px;/.exec(CSS);
const PAD_LEFT_PX = Number(PADDING?.[1]);
const PAD_RIGHT_PX = Number(PADDING?.[2]);
const FRAME_PX = 1;

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

/**
 * The tab's rect in the window's px at `width` x `height`, from its markup alone: x from `left` / `width` (with `translateX(-100%)` the `left` is its right edge) or the right edge, y from the
 * class's CSS. The transparent hit strip (`before:`) is not in it: `hitRect` adds it.
 */
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
  expect(html, "the tab's top is its class's: nothing else moves it").not.toMatch(/[;"]top:/);
  const length = Number.parseFloat(lengthClass[0].slice(3));
  const top = evaluate(topClass[0].slice(5, -1), props, height);
  const w = tabWidth(html);
  const left = px(html, "left");
  if (left === undefined) return { left: width - w, top, right: width, bottom: top + length };
  expect(html, "a tab with a `left` is translated by its own width").toContain("translateX(-100%)");
  return { left: left - w, top, right: left, bottom: top + length };
}

/** The tab's whole hit area: the face and the transparent strip beside it (`before:-left-[Npx]` with `before:w-[Mpx]`: M px to the face's left). */
function hitRect(html: string, tab: Rect): Rect {
  const strip = /before:w-\[(\d+(?:\.\d+)?)px\]/.exec(html);
  return strip ? { ...tab, left: tab.left - Number(strip[1]) } : tab;
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
  zoom: number;
  /** The page registers a side margin here (the rail): a card stands in it, the tab beside the card. */
  rail: boolean;
  /** The margin as the page registers it. */
  rect: MarginRect;
  /** The margin divider's hit strip, in the window's px: the 12 px track that ends at the margin cell's left edge, over the row (masthead's foot to the legend's top). */
  strip: Rect;
  /** The text's right edge at the very most: the strip's left edge less the centre's right padding (the column is all text; the cap's blank only adds to the gap). */
  textRight: number;
}

function layoutOf(width: number, height: number, stepName: keyof typeof STEPS, zoom = 1): Layout {
  const step = STEPS[stepName];
  const layoutWidth = width / zoom;
  const rail = layoutWidth >= railMinimumWidth(step);
  const fit = fitPanes({ viewport: layoutWidth, centreMinimum: readingCentreMinimum(step) });
  const marginLeft = (layoutWidth - fit.margin) * zoom;
  const rect = rail ? marginRectOf({ left: marginLeft, width: fit.margin * zoom }, height, zoom) : bottomMarginRectOf(width, height, zoom);
  const strip = { left: marginLeft - DIVIDER_PX * zoom, right: marginLeft, top: DOCK_TOP_PX, bottom: height - legendHeightPx(zoom) };
  return { name: `${width} x ${height}, ${stepName} step${zoom === 1 ? "" : `, Fit zoom ${zoom}`}`, width, height, step, zoom, rail, rect, strip, textRight: strip.left - PAD_RIGHT_PX * zoom };
}
const LAYOUTS = CELLS.map(([w, h, s]) => layoutOf(w, h, s));
const RAILS = LAYOUTS.filter((l) => l.rail);

/** What `NotesButton` hands the view with a card standing. */
const withCard = (layout: Layout, has: boolean) =>
  layout.rail
    ? view({ has, beside: true, marginLeft: layout.rect.left, ...(layout.zoom === 1 ? {} : { zoom: layout.zoom }) })
    : view({ has, beside: false, marginLeft: layout.rect.left, bandTop: layout.rect.top });

describe("the constants this test stands on are what the shell has (P12-89 E5)", () => {
  it("the margin divider is a 12 px grid track between the centre and the margin: its hit strip ends where the margin cell begins", () => {
    const grid = /\.reader-shell \{[^}]*grid-template-columns:\s*([^;]+);/.exec(CSS)?.[1].trim();

    expect(DIVIDER_PX).toBe(12);
    expect(grid).toBe("var(--left-w) 12px minmax(0, 1fr) 12px var(--margin-w, 360px)");
    expect(read("src/components/reader/pane-divider.tsx")).toContain('className="reader-divider"');
  });

  it("the centre's padding is 12 px on the left and 20 px on the right, in the one rule, with no variant that changes it (the words never move when a card opens)", () => {
    expect(PAD_LEFT_PX).toBe(12);
    expect(PAD_RIGHT_PX).toBe(20);
    expect(CSS.match(/\.reader-centre\s*\{/g)).toHaveLength(1);
    // no other rule of the stylesheet sets a padding on the centre, in a state or a media query
    expect(CSS.match(/\.reader-centre[^{]*\{[^}]*padding/g)).toHaveLength(1);
    expect(read("src/components/reader/reader-shell.tsx")).not.toMatch(/reader-centre[^\n]*padding/);
  });

  it("the padding holds the tab, its clear of the strip and its clear of the text: 15 + 2 + 3 = 20, the hit area 15 + 3 = 18", () => {
    const textClear = PAD_RIGHT_PX - EDGE_TAB_DIVIDER_CLEAR_PX - EDGE_TAB_BESIDE_PX;

    expect(EDGE_TAB_BESIDE_PX).toBe(15);
    expect(EDGE_TAB_DIVIDER_CLEAR_PX).toBe(2);
    expect(textClear).toBe(3);
    expect(textClear - FRAME_PX, "the frame (1 px outside the box) is 2 px clear of the text").toBe(2);
    expect(EDGE_TAB_HIT_PX).toBe(EDGE_TAB_BESIDE_PX + textClear);
    expect(EDGE_TAB_HIT_PX).toBe(18);
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

describe("the tab's rect never meets the margin divider's strip, with a card open (P12-89 E5)", () => {
  for (const layout of LAYOUTS) {
    for (const has of [true, false]) {
      const label = has ? "Open your notes" : "Notes";
      it(`${layout.name}, "${label}": left of the strip by 2 px, and 0 px² of the strip`, () => {
        const tab = tabRect(withCard(layout, has), layout.width, layout.height);

        expect(overlap(tab, layout.strip), "the tab's rect and the strip share no area").toBe(0);
        if (layout.rail) {
          expect(layout.strip.left - tab.right, "left of the strip").toBe(EDGE_TAB_DIVIDER_CLEAR_PX);
          expect(tab.right).toBeLessThan(layout.strip.left);
        } else {
          expect(layout.strip.right - tab.left, "the band's tab is on the window's right edge, far right of the strip").toBeLessThan(-100);
        }
      });
    }
  }

  it("BEFORE (the placement the view had): the face ended at the margin's edge, x <edge> - 15 to <edge> — the check can fail, and it did: 12 x 146 = 1,752 px²", () => {
    for (const layout of RAILS) {
      const now = tabRect(withCard(layout, true), layout.width, layout.height);
      // the old rect: the same y, x ending at the margin's edge
      const before = { ...now, left: layout.rect.left - EDGE_TAB_BESIDE_PX, right: layout.rect.left };

      expect(overlap(before, layout.strip), layout.name).toBe(DIVIDER_PX * EDGE_TAB_LENGTH_PX.open);
      expect(overlap(before, layout.strip)).toBe(1752);
      expect(overlap(now, layout.strip), layout.name).toBe(0);
    }
  });

  it("the hit area (the face and its transparent strip, 18 px across) meets the divider's strip nowhere either", () => {
    for (const layout of RAILS) {
      const tab = tabRect(withCard(layout, true), layout.width, layout.height);
      const hit = hitRect(withCard(layout, true), tab);

      expect(hit.right - hit.left, layout.name).toBe(EDGE_TAB_HIT_PX);
      expect(overlap(hit, layout.strip), layout.name).toBe(0);
      expect(withCard(layout, true)).toContain("before:-left-[4px]");
    }
  });

  it("at Fit's zoom too: the strip is 12 x zoom wide in the window's px and ends at the margin cell's left edge; the tab is told the zoom and stays 2 px left of it", () => {
    for (const zoom of [1.142, 1.378, 1.838, 2.5]) {
      // (a window wide enough that the zoomed page still has the side margin: 1920 px to zoom 1.838, 3200 px at the zoom's cap)
      const windowWidth = zoom > 2 ? 3200 : 1920;
      const fit = layoutOf(windowWidth, 1080, "default", zoom);
      const tab = tabRect(withCard(fit, true), windowWidth, 1080);

      expect(fit.rail).toBe(true);
      expect(fit.strip.right - fit.strip.left).toBeCloseTo(DIVIDER_PX * zoom, 6);
      expect(overlap(tab, fit.strip), `zoom ${zoom}`).toBe(0);
      expect(fit.strip.left - tab.right, `zoom ${zoom}`).toBeCloseTo(EDGE_TAB_DIVIDER_CLEAR_PX, 6);
    }
  });

  it("the tab with no card is as it was: the window's right edge, no left, no translation", () => {
    for (const layout of LAYOUTS) {
      const html = view({ has: true });

      expect(html).not.toContain("left:");
      expect(html).not.toContain("translateX");
      expect(classesOf(html)).toContain("right-0");
      expect(overlap(tabRect(html, layout.width, layout.height), layout.strip), layout.name).toBe(0);
    }
  });
});

describe("the tab meets no paper text, no card and no header (P12-89 E5)", () => {
  for (const layout of RAILS) {
    it(`${layout.name}: clear of the text's right edge by the padding's room (3 px, 2 px with its frame), the hit area ending at that edge`, () => {
      for (const has of [true, false]) {
        const html = withCard(layout, has);
        const tab = tabRect(html, layout.width, layout.height);
        const hit = hitRect(html, tab);
        // the text, at the very most: a column all text, a band of text lines from the masthead to the legend, ending at textRight
        const text = { left: layout.textRight - 400, right: layout.textRight, top: DOCK_TOP_PX, bottom: layout.strip.bottom };

        expect(overlap(tab, text), `${layout.name}: the tab and the text`).toBe(0);
        expect(overlap(hit, text), `${layout.name}: the hit area and the text`).toBe(0);
        expect(tab.left - layout.textRight, "the tab's box").toBe(PAD_RIGHT_PX - EDGE_TAB_DIVIDER_CLEAR_PX - EDGE_TAB_BESIDE_PX);
        expect(tab.left - FRAME_PX - layout.textRight, "its frame").toBeGreaterThanOrEqual(2);
        expect(hit.left, "the hit area ends at the text's edge, not past it").toBeGreaterThanOrEqual(layout.textRight);
      }
    });
  }

  it("the gap from the text's right edge to the strip is the padding's 20 px or more at every rail layout — at least the 17 px the tab and its clear need — at every Fit zoom", () => {
    for (const layout of RAILS) {
      expect(layout.strip.left - layout.textRight, layout.name).toBeGreaterThanOrEqual(EDGE_TAB_BESIDE_PX + EDGE_TAB_DIVIDER_CLEAR_PX);
      expect(layout.strip.left - layout.textRight).toBe(PAD_RIGHT_PX);
    }
    for (const zoom of [1, 1.142, 1.378, 1.838, 2.5]) {
      const fit = layoutOf(zoom > 2 ? 3200 : 1920, 1080, "default", zoom);
      expect(fit.strip.left - fit.textRight, `zoom ${zoom}`).toBeGreaterThanOrEqual(EDGE_TAB_BESIDE_PX + EDGE_TAB_DIVIDER_CLEAR_PX);
    }
  });

  const card = (id: string, kind: FloatingWindow["kind"], order: number): FloatingWindow => ({ id, kind, title: id, order });
  const STACKS = [
    [card("s1", "sticky", 1)],
    [card("s1", "sticky", 1), card("e1", "explain", 2)],
    [card("s1", "sticky", 1), card("e1", "explain", 2), card("n1", "notes", 3)],
  ];
  for (const layout of RAILS) {
    for (const has of [true, false]) {
      it(`${layout.name}, ${has ? "Open your notes" : "Notes"}: with 1 to 3 cards level with every 10 px of the margin the tab is 0 px² over any card, any header row and any card text row`, () => {
        const tab = tabRect(withCard(layout, has), layout.width, layout.height);
        let checked = 0;
        for (const windows of STACKS) {
          for (let anchor = layout.rect.top; anchor <= layout.rect.bottom; anchor += 10) {
            const top = Math.min(Math.max(anchor, layout.rect.top), layout.rect.bottom);
            const rows = stackLayout(windows, { top, bottom: layout.rect.bottom, minTop: layout.rect.top });
            for (const row of rows) {
              const cardRect = { left: layout.rect.left, right: layout.rect.left + layout.rect.width, top: row.top, bottom: row.top + row.height };
              const header = { ...cardRect, bottom: row.top + WINDOW_HEADER_PX };
              expect(overlap(tab, cardRect), `${windows.length} card(s) at ${anchor}: a card`).toBe(0);
              expect(overlap(tab, header), `${windows.length} card(s) at ${anchor}: a header`).toBe(0);
              // the card's left padding and first letters: the card's own left edge is right of the strip, which is right of the tab
              expect(tab.right, "the tab ends left of every card").toBeLessThan(cardRect.left);
              checked++;
            }
          }
        }
        expect(checked, "the sweep is not vacuous").toBeGreaterThan(50);
      });
    }
  }

  it("the tab needs no card's header out of the way and no stacking over the cards: it is z-40 and carries no top of its own, as before", () => {
    for (const layout of RAILS) {
      const html = withCard(layout, true);

      expect(classesOf(html)).toContain("z-40");
      expect(classesOf(html).some((c) => /^z-\[/.test(c)), "no z-[..] class").toBe(false);
      expect(styleOf(html)).not.toContain("top:");
    }
  });
});
