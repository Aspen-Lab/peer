import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DOCK_TOP_PX, MASTHEAD_MIN_VIEWPORT_PX, legendHeightPx } from "@/components/reader/explain-dock";
import { bottomMarginRectOf } from "@/lib/reader/margin";
import { fitPanes } from "@/components/reader/pane-layout";
import { THUMB_BAR_PX } from "@/components/shell/thumb-bar";
import { EDGE_TAB_FOOT_CLEAR_PX, EDGE_TAB_LENGTH_PX, EDGE_TAB_PASSES_DRAG, NOTES_LABEL, NotesButtonView } from "./notes-button";

// P12-77 rule 1 (E1; A P12-71 §6): the fixed "Open your notes" edge tab never overlaps the fixed key legend and never runs below the window.
//
// A measured it at 1024 x 576 (the tab ended at 574, the legend began at 548: it covered the legend's "H" key cap beside a card) and at
// 853 x 480 (the label wrapped to three lines, 57.3 x 64.5, from 432 to 496.5: 16.5 px below the window, over the legend's last word). The
// tab was `top-[max(27rem,50vh)]` whatever the window's height. Now its top is clamped to its foot, and its label does not wrap.
//
// There is no DOM in this suite, so no rect can be read. What can be held is the arithmetic, and it is held on the markup itself: the tab's
// `top` is a CSS expression in its class (`min`, `max`, `calc`, `var`, `env` over px / rem / vh), its length is the `h-[Npx]` beside it, and what
// stands at the window's foot is the custom property the same element sets (`--tab-foot`, the legend from `md`, the thumb bar under it). The
// evaluator below reads those the way a browser does, at each window, and the legend's top is worked out apart from the tab, from the
// legend's own source and the stylesheet. Measured in a real browser too (Chromium, the real stylesheet, the real markup, 1024 x 576 and
// 853 x 480: a gap of 8 px, the label on one line) — see the checkpoint.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const CSS = read("src/app/globals.css");
const REM_PX = 16;
/** The foot legend's height at the page's own scale, from the stylesheet (`--legend-h`: 1.75rem). */
const LEGEND_PX = Number(/--legend-h:\s*(\d+(?:\.\d+)?)rem;/.exec(CSS)?.[1]) * REM_PX;

// ── A small CSS length evaluator: calc / min / max / var / env over px, rem and vh ─────────────────────────────────────────────

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
      next(); // safe-area-inset-bottom
      expect(next()).toBe(",");
      const fallback = sum(); // no notch in this suite: the fallback is the value
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

// ── The tab as markup, and where it stands ──────────────────────────────────────────────────────────────────────────────────────

const view = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has: true, onOpen: () => {}, ...props } as never));
const classesOf = (html: string) => (/class="([^"]*)"/.exec(html)?.[1] ?? "").replace(/&amp;/g, "&").split(/\s+/).filter(Boolean);
const styleProps = (html: string): Props => {
  const out: Props = {};
  for (const [, name, value] of (/style="([^"]*)"/.exec(html)?.[1] ?? "").matchAll(/(--[\w-]+):([^;]+)/g)) out[name] = value;
  return out;
};

/** The tab's rect in y, in the window's px at `width` x `height`, worked out from its classes and style alone. */
function tabAt(html: string, width: number, height: number) {
  const classes = classesOf(html);
  const props: Props = { "--legend-h": `${LEGEND_PX}px` };
  // custom properties the classes set: the base ones, then the `md:` ones from 768 px, then the element's own style (which wins)
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
  Object.assign(props, styleProps(html));
  const topClass = classes.filter((c) => /^top-\[/.test(c));
  const lengthClass = classes.filter((c) => /^h-\[\d+(?:\.\d+)?px\]$/.test(c));
  expect(topClass, "exactly one `top`").toHaveLength(1);
  expect(lengthClass, "exactly one `h`").toHaveLength(1);
  const top = evaluate(topClass[0].slice(5, -1), props, height);
  const length = Number.parseFloat(lengthClass[0].slice(3));
  return { top, length, bottom: top + length };
}

/** Where the window's foot furniture begins, worked out apart from the tab: the legend from `md` (its height at the page's zoom), the thumb bar under it. */
const footTop = (width: number, height: number, zoom = 1) =>
  width >= MASTHEAD_MIN_VIEWPORT_PX ? height - legendHeightPx(zoom) : height - THUMB_BAR_PX;

/** The windows A measured and the phone, with the margin's left edge as the page registers it: a side margin from 1024 px, the narrow bottom band's left (8) under it. */
const WINDOWS = [
  { name: "1440 x 900", width: 1440, height: 900 },
  { name: "1024 x 576", width: 1024, height: 576 },
  { name: "853 x 480", width: 853, height: 480 },
  { name: "390 x 844", width: 390, height: 844 },
].map((w) => ({ ...w, left: w.width >= 1024 ? w.width - fitPanes({ viewport: w.width }).margin : 8 }));

/** Both states of the tab at a window: no card standing, and a card standing in the margin (the tab beside it). */
const states = (left: number) => [
  { state: "no card", extra: {} },
  { state: "card open", extra: { beside: true, marginLeft: left } },
];
const LABELS = [
  { name: "Open your notes", has: true, key: "open" as const },
  { name: "Notes", has: false, key: "take" as const },
];

describe("the constants this test stands on are what the shell has (P12-77 E1)", () => {
  it("the legend is 28 px at the foot from md; the phone's thumb bar is 56 px; md is 768 px", () => {
    const legend = read("src/components/reader/key-legend.tsx");

    expect(LEGEND_PX).toBe(28);
    expect(legend).toContain("h-[var(--legend-h)]");
    expect(legend).toMatch(/fixed inset-x-0 bottom-0/);
    expect(legend).toMatch(/hidden md:flex/);
    expect(THUMB_BAR_PX).toBe(56);
    expect(MASTHEAD_MIN_VIEWPORT_PX).toBe(768);
    expect(DOCK_TOP_PX).toBe(48);
    expect(EDGE_TAB_FOOT_CLEAR_PX).toBe(8);
  });

  it("the tab's foot classes name those numbers: the thumb bar's 56 px under md, the legend's own height (or Fit's, --tab-legend) from md", () => {
    const classes = classesOf(view({}));

    expect(classes).toContain(`[--tab-foot:calc(${THUMB_BAR_PX}px+env(safe-area-inset-bottom,0px))]`);
    expect(classes).toContain("md:[--tab-foot:var(--tab-legend,var(--legend-h))]");
    // the least top: the masthead's foot (3rem) where there is a masthead, from md; the window's top under it, where there is none
    expect(classes).toContain("[--tab-floor:0px]");
    expect(classes).toContain(`md:[--tab-floor:${DOCK_TOP_PX / 16}rem]`);
  });
});

describe("the tab's foot stays at least 8 px above the legend's top, at every window height (P12-77 E1)", () => {
  for (const w of WINDOWS) {
    for (const label of LABELS) {
      for (const { state, extra } of states(w.left)) {
        it(`${w.name}, ${label.name}, ${state}: bottom ${EDGE_TAB_FOOT_CLEAR_PX} px or more above the foot, and inside the window`, () => {
          const tab = tabAt(view({ has: label.has, ...extra }), w.width, w.height);
          const foot = footTop(w.width, w.height);

          expect(foot - tab.bottom, "the gap above the legend (or the thumb bar)").toBeGreaterThanOrEqual(EDGE_TAB_FOOT_CLEAR_PX);
          expect(tab.bottom, "never below the window").toBeLessThanOrEqual(w.height);
          expect(tab.top, "never above the masthead's foot (from md, where there is a masthead)").toBeGreaterThanOrEqual(w.width >= MASTHEAD_MIN_VIEWPORT_PX ? DOCK_TOP_PX : 0);
        });
      }
    }
  }

  it("at any window height from 300 px to 1400, and a width with the legend or the thumb bar", () => {
    for (const width of [390, 768, 1024, 1440]) {
      for (let height = 300; height <= 1400; height += 10) {
        for (const label of LABELS) {
          const tab = tabAt(view({ has: label.has }), width, height);
          expect(footTop(width, height) - tab.bottom, `${width} x ${height} ${label.name}`).toBeGreaterThanOrEqual(EDGE_TAB_FOOT_CLEAR_PX);
          expect(tab.top, `${width} x ${height} ${label.name}`).toBeGreaterThanOrEqual(width >= MASTHEAD_MIN_VIEWPORT_PX ? DOCK_TOP_PX : 0);
        }
      }
    }
  });

  // The measured collisions, as the fix places them (the before numbers are the tab's `top-[max(27rem,50vh)]`: 450, 432, 432).
  it("the places: 1440 x 900 where it was (450), 1024 x 576 and 853 x 480 raised until the gap is exactly 8", () => {
    const at = (w: (typeof WINDOWS)[number], has: boolean) => tabAt(view({ has }), w.width, w.height);
    const [w1, w2, w3, w4] = WINDOWS;

    expect(at(w1, true)).toMatchObject({ top: 450, bottom: 596 }); // 50vh; the legend begins at 872
    expect(at(w2, true)).toMatchObject({ top: 394, bottom: 540 }); // 576 - 28 - 8 - 146; was 432..574 over the legend (548)
    expect(at(w3, true)).toMatchObject({ top: 298, bottom: 444 }); // 480 - 28 - 8 - 146; was 432..496.5, wrapped, below the window
    expect(at(w4, true)).toMatchObject({ top: 432, bottom: 578 }); // 27rem; the thumb bar begins at 788
    // the short label (no note yet) needs less room: where it already cleared, it stays at 27rem
    expect(at(w2, false)).toMatchObject({ top: 432, bottom: 498 });
    expect(at(w3, false)).toMatchObject({ top: 378, bottom: 444 });
  });

  it("moves only as far as the foot needs: where the tab already clears by 8 px or more it stands at 27rem or the window's middle, as it always did", () => {
    for (const height of [700, 800, 900, 1000, 1200]) {
      const tab = tabAt(view({}), 1440, height);

      expect(tab.top, `${height} px high`).toBe(Math.max(27 * REM_PX, height / 2));
    }
    // and where it is clamped, the gap is the 8 px and not more (it is not pushed higher than it has to be)
    for (const height of [480, 520, 576, 600]) {
      const tab = tabAt(view({}), 1024, height);

      expect(footTop(1024, height) - tab.bottom, `${height} px high`).toBe(EDGE_TAB_FOOT_CLEAR_PX);
    }
  });

  it("clears the legend at Fit's zoom too: the legend is that much taller on the window's pixels, and the tab is told (--tab-legend)", () => {
    for (const zoom of [1.142, 1.378, 1.838, 2.5]) {
      for (const height of [540, 576, 720]) {
        const html = view({ zoom });
        const tab = tabAt(html, 1920, height);

        expect(styleProps(html)["--tab-legend"], `zoom ${zoom}`).toBe(`${legendHeightPx(zoom)}px`);
        expect(footTop(1920, height, zoom) - tab.bottom, `zoom ${zoom}, ${height} px high`).toBeGreaterThanOrEqual(EDGE_TAB_FOOT_CLEAR_PX);
      }
    }
    // Fit off (the zoom is 1): nothing is written on the tab, as before
    expect(styleProps(view({ zoom: 1 }))).toEqual({});
    expect(view({ zoom: 1 })).not.toContain("style=");
    expect(view({})).not.toContain("style=");
  });
});

describe("the label stays on one line, as long as the tab is (P12-77 E1)", () => {
  it("does not wrap, and the tab's declared length holds the label: 26 px of padding and border and the measured 7.72 px a character", () => {
    const MEASURED_PX_PER_CHAR = 7.72; // A P12-71: 141.9 px for "Open your notes" (15 characters), 64.5 for "Notes" (5), Roboto Mono at 11.5 px, 0.06em tracked
    for (const label of LABELS) {
      const html = view({ has: label.has });
      const classes = classesOf(html);
      const length = tabAt(html, 1440, 900).length;

      expect(html).toContain(`>${label.name}<`);
      expect(classes).toContain("whitespace-nowrap");
      expect(length).toBe(EDGE_TAB_LENGTH_PX[label.key]);
      expect(length, `${label.name} fits its tab`).toBeGreaterThanOrEqual(26 + label.name.length * MEASURED_PX_PER_CHAR);
      expect(length, `${label.name}: not much longer than it needs`).toBeLessThanOrEqual(26 + label.name.length * 8);
    }
    expect(NOTES_LABEL).toEqual({ take: "Notes", open: "Open your notes" });
  });

  it("the label runs down the tab as before: vertical, in the label face, centred in its length", () => {
    const html = view({});

    expect(html).toContain("[writing-mode:vertical-rl]");
    expect(html).toContain("eyebrow");
    expect(classesOf(html)).toEqual(expect.arrayContaining(["items-center", "justify-center"]));
  });
});

// P12-77 (ruling §1h.455, item 2): on a phone the cards stand in a band across the foot of the window, not in a margin at the right. The tab stays on the
// right edge whatever a card does and ends 8 px above the band's top while one stands: the rule of E1 with the band as the foot. From md the band
// is not read. (`NotesButton` writes `--tab-band-top` only on a phone, only while a card stands: `notes-button.phone.flow.test.tsx`.)
describe("a card standing on a phone: the tab's foot is the band's top (§1h.455 item 2)", () => {
  // the band as the page registers it, for the phones that exist (width x height): portrait and landscape, small and large
  const PHONES = [[390, 844], [375, 667], [360, 640], [320, 568], [667, 375], [767, 1024]] as const;

  it.each(PHONES)("%i x %i: the tab ends at least 8 px above the band's top, both labels, and stays inside the window", (width, height) => {
    const band = bottomMarginRectOf(width, height, 1);

    for (const label of LABELS) {
      const tab = tabAt(view({ has: label.has, bandTop: band.top }), width, height);

      expect(band.top - tab.bottom, `${label.name}`).toBeGreaterThanOrEqual(EDGE_TAB_FOOT_CLEAR_PX);
      expect(tab.top, `${label.name}: inside the window`).toBeGreaterThanOrEqual(0);
      expect(footTop(width, height) - tab.bottom, `${label.name}: and still clear of the thumb bar`).toBeGreaterThanOrEqual(EDGE_TAB_FOOT_CLEAR_PX);
    }
  });

  it("at 390 x 844 the band begins at 384.6 and the tab (Open your notes) stands from 230.6 to 376.6: exactly 8 px above it; it is where it was while no card stands", () => {
    const band = bottomMarginRectOf(390, 844, 1);

    expect(band.top).toBeCloseTo(384.6, 1);
    const withCard = tabAt(view({ bandTop: band.top }), 390, 844);
    expect(withCard.top).toBeCloseTo(230.6, 1);
    expect(withCard.bottom).toBeCloseTo(376.6, 1);
    expect(tabAt(view({}), 390, 844)).toMatchObject({ top: 432, bottom: 578 });
  });

  it("where the tab already clears the band it does not move: a band that begins below the tab's own foot changes nothing", () => {
    const free = tabAt(view({}), 390, 844);

    expect(tabAt(view({ bandTop: 800 }), 390, 844)).toEqual(free);
  });

  it("from md the band is not read: the tab is placed as it was, whatever bandTop says", () => {
    for (const [width, height] of [[768, 576], [853, 480], [1024, 576], [1440, 900]] as const) {
      expect(tabAt(view({ bandTop: 100 }), width, height), `${width} x ${height}`).toEqual(tabAt(view({}), width, height));
    }
  });

  it("writes the band on the tab's style (--tab-band-top) and nothing when there is none", () => {
    expect(styleProps(view({ bandTop: 384.6 }))["--tab-band-top"]).toBe("384.6px");
    expect(view({})).not.toContain("--tab-band-top:");
    expect(view({})).not.toContain("style=");
  });
});

describe("the tab's behaviour is as it was (P12-77 E1)", () => {
  it("is one button that presses to open and reports expanded; a press that began elsewhere still passes through it", () => {
    for (const shown of [false, true]) {
      const html = view({ shown });

      expect(html.match(/<button\b/g)).toHaveLength(1);
      expect(html).toContain('type="button"');
      expect(html).toContain(`aria-expanded="${shown}"`);
      expect(classesOf(html)).toContain(EDGE_TAB_PASSES_DRAG);
    }
  });

  it("stays fixed at the right edge under the cards (z-40), or beside a card at the margin's left edge, whatever its top", () => {
    const alone = view({});
    const beside = view({ beside: true, marginLeft: 1000 });

    expect(classesOf(alone)).toEqual(expect.arrayContaining(["fixed", "right-0", "z-40"]));
    expect(beside).toContain("left:1000px");
    expect(beside).toContain("translateX(-100%)");
    expect(classesOf(beside)).not.toContain("right-0");
  });

  it("the phone's row is untouched: no clamp, no length, a command row", () => {
    const row = renderToStaticMarkup(createElement(NotesButtonView, { variant: "row", has: true, onOpen: () => {} }));

    expect(row).not.toMatch(/--tab-foot|top-\[|h-\[\d+px\]/);
    expect(classesOf(row)).toContain("w-full");
  });
});
