import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DIVIDER_PX, fitPanes } from "@/components/reader/pane-layout";
import { EDGE_TAB_BESIDE_PX, EDGE_TAB_DIVIDER_CLEAR_PX, EDGE_TAB_HIT_PX, NotesButtonView } from "./notes-button";

// P11-34 (BACKLOG-102; round 2, Theme A readers r1, r2, r3): the right-edge tab ("Open your notes") stood flush against the centre
// column's text whenever a card stood in the margin. With a card standing the tab is placed at the margin's left edge, beside the cards,
// and at 1024 / 1093 / 1280 / 1440 the gap between that edge and the text's right edge is only the shell's gutter — the centre's own side
// padding and the divider, 24 px — which the tab (25 px) filled: it covered no word, but it touched the line ends.
//
// The rule: wherever the tab stands it is at least 8 px clear of the text (counted from the frame's outer edge: the tab's `shadow-card`
// ring is 1 px), it never stands over a card, it keeps a hit area of 24 px across and its label stays whole. The text column does not
// move (its rect, its width and its line breaks are the owner's "the text only re-wraps"): the tab takes the room the gutter has, not
// more. There is no DOM in this suite, so a rect cannot be read; what can be held is the arithmetic. The gutter is built from the numbers
// that make it — the divider (`DIVIDER_PX`, `pane-layout.ts`) and the centre's side padding (read off `globals.css`, `.reader-centre`),
// at every window the shell stands in; the tab's own width is the one it declares (`width:Npx` on its style), and its label, frame and hit
// area from the stylesheet and its markup. A gutter that changes in the stylesheet changes these numbers, and the test goes red there.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const CSS = read("src/app/globals.css");

/** A top-level rule's body in the stylesheet. */
const rule = (selector: string) => {
  const start = CSS.indexOf(`\n${selector} {`);
  expect(start, `${selector} is a rule of the stylesheet`).toBeGreaterThanOrEqual(0);
  return CSS.slice(start, CSS.indexOf("\n}", start));
};

/** The centre's side paddings, in px, as the stylesheet states them: `padding-inline: 12px 20px` (P12-89: the left 12, the right 20 — the gutter the tab stands in). */
const CENTRE_PADDING = /padding-inline:\s*(\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px/.exec(rule(".reader-centre"));
const CENTRE_PAD_LEFT_PX = Number(CENTRE_PADDING?.[1]);
const CENTRE_PAD_PX = Number(CENTRE_PADDING?.[2]);
/** The label's size, `--text-caption` (the `eyebrow` face): a vertical label is as wide as its line is tall, never less than its font size. */
const CAPTION_PX = Number(/--text-caption:\s*(\d+(?:\.\d+)?)px/.exec(CSS)?.[1]);
/** The frame the tab draws round itself: `--shadow-card` is `0 0 0 1px`, one pixel outside its box on every side. */
const FRAME_PX = Number(/--shadow-card:\s*0 0 0 (\d+)px/.exec(CSS)?.[1]);
/** The tab's own left border (`border border-r-0`). */
const BORDER_PX = 1;
/** The `eyebrow` face's line height, as a share of its size (`globals.css`, `@utility eyebrow`: `line-height: 1.4`); `leading-none` is 1. */
const EYEBROW_LEADING = Number(/@utility eyebrow \{[^}]*line-height:\s*(\d+(?:\.\d+)?)/.exec(CSS)?.[1]);

/** The least clear the tab keeps from the text, counted from the frame's outer edge. Re-aimed (P12-89, E5): 8 px in the 24 px gutter (P11-34), where the tab stood over the margin divider's
 *  strip; the tab now stands left of the strip, in the centre's 20 px right padding, which holds it (15 px), its clear of the strip (2 px, `EDGE_TAB_DIVIDER_CLEAR_PX`), its 1 px frame and 2 px. */
const CLEAR_PX = 2;
/** The hit area across. Re-aimed (P12-89, E5): 24 px in the 24 px gutter; the padding's room after the face and the clear of the strip is 3 px, a strip that ends at the text's edge, so 18. */
const HIT_PX = 18;

/** The gutter between the text's right edge and the margin's left edge: the divider and the centre's right padding, at the page's Fit zoom `zoom` (Fit only ever enlarges: ≥ 1). */
const gutterAt = (zoom: number) => (DIVIDER_PX + CENTRE_PAD_PX) * zoom;

/** The windows the shell stands in (css px), with and without a scrollbar's 15 px taken off the grid; the margin's left edge in each. */
const WINDOWS = [1024, 1093, 1242, 1280, 1366, 1440, 1536, 1920, 2560];
const margins = WINDOWS.flatMap((viewport) => [0, 15].map((bar) => ({ viewport, bar, left: viewport - bar - fitPanes({ viewport: viewport - bar }).margin })));
/** Fit's zoom: 1 up to 1,581 px, 1.21 at 1,920, 2.5 at its cap. */
const ZOOMS = [1, 1.21, 2.5];

const view = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has: true, onOpen: () => {}, ...props } as never));
const px = (html: string, prop: string) => {
  const found = new RegExp(`[;"]${prop}:(-?\\d+(?:\\.\\d+)?)px`).exec(html);
  return found ? Number(found[1]) : undefined;
};
/**
 * The tab's width in px, as it will be laid out. A width the markup declares wins (`style="width:Npx"`); else it is what the classes make:
 * the label runs down the tab (`writing-mode: vertical-rl`), so the tab is as wide as the label's line is tall, with its left border and the
 * `py-*` padding on its two sides (in that mode `py` pads the sides and `px` the top and bottom). The base's `px-3 py-1` tab is 1 + 4 + 16.1 + 4 = 25.1 —
 * the 25.09 px a browser measured (Chromium 1024 x 768).
 */
const widthOf = (html: string) => {
  const declared = px(html, "width");
  if (declared !== undefined) return declared;
  const classes = (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(" ");
  const pad = Number(/^py-(\d+(?:\.\d+)?)$/.exec(classes.find((c) => /^py-\d/.test(c)) ?? "")?.[1] ?? 0) * 4;
  const line = CAPTION_PX * (classes.includes("leading-none") ? 1 : EYEBROW_LEADING);
  return BORDER_PX + 2 * pad + line;
};
const ext = (html: string) => {
  const found = /before:w-\[(\d+(?:\.\d+)?)px\]/.exec(html);
  return found ? Number(found[1]) : 0;
};

describe("the constants this test stands on are what the shell has", () => {
  // Re-aimed (P12-89, E5): it held "the gutter is the divider and the centre's side padding, 24 px at 1x" (12 + 12). The padding is 12 on the left and 20 on the right now, so the gutter is 32.
  it("the gutter is the divider and the centre's right padding, 32 px at 1x (the padding is 12 on the left, 20 on the right)", () => {
    expect(DIVIDER_PX).toBe(12);
    expect(CENTRE_PAD_LEFT_PX).toBe(12);
    expect(CENTRE_PAD_PX).toBe(20);
    expect(CAPTION_PX).toBe(11.5);
    expect(EYEBROW_LEADING).toBe(1.4);
    expect(FRAME_PX).toBe(1);
    expect(gutterAt(1)).toBe(32);
  });
});

describe("the tab beside a card is clear of the text (P11-34, BACKLOG-102)", () => {
  it("the base's tab, 25.1 px wide, is wider than the padding leaves it: it has no way to stand clear of the text and of the divider's strip", () => {
    const html = view({ beside: true, marginLeft: 744 });

    // The centre's 20 px right padding less the 2 px of clear of the strip, the 1 px frame and the 2 px of clear of the text is 15 px: the tab is at most that wide. (Re-aimed, P12-89: the
    // padding was the 24 px gutter less the 8 px clear and the frame, with the divider's strip under the tab.)
    expect(widthOf(html)).toBeLessThanOrEqual(CENTRE_PAD_PX - EDGE_TAB_DIVIDER_CLEAR_PX - CLEAR_PX - FRAME_PX);
  });

  // Re-aimed (P12-89, E5): "at least 8 px from the text" worked the tab's left out as `marginLeft - width - frame` (the tab ended at the margin's edge, over the divider's strip). The tab's
  // right edge is now read from its own markup (`left:` with `translateX(-100%)`), at each Fit zoom (the strip is 12 x zoom wide and the page's zoom reaches the view), and the rule is kept
  // at what the 20 px right padding leaves: CLEAR_PX (2 px, frame included), and the tab is 2 px clear of the strip.
  it.each(margins)("at $viewport px ($bar px scrollbar): clear of the text at every Fit zoom, counted from the frame's outer edge, and 2 px left of the divider's strip", ({ left }) => {
    for (const zoom of ZOOMS) {
      const html = view({ beside: true, marginLeft: left, zoom });
      const width = widthOf(html);
      const stripLeft = left - DIVIDER_PX * zoom;
      const textRight = left - gutterAt(zoom);
      const tabRight = px(html, "left")!;
      const tabLeft = tabRight - width - FRAME_PX;
      expect(tabRight, `zoom ${zoom}`).toBe(stripLeft - EDGE_TAB_DIVIDER_CLEAR_PX);
      expect(tabLeft - textRight, `zoom ${zoom}`).toBeGreaterThanOrEqual(CLEAR_PX);
    }
  });

  // Re-aimed (P12-89, E5): it held "still ends at the margin's left edge" (`left` = the edge), the face over the margin divider's 12 px strip. It ends EDGE_TAB_DIVIDER_CLEAR_PX left of the strip now
  // (`left` = the edge less the strip less the clear); beside the card, not at the window's edge, translated by its own width, wholly inside the window: as it held.
  it("ends 2 px left of the margin divider's strip — beside the card, never over the strip or the cards", () => {
    for (const { left } of margins) {
      const html = view({ beside: true, marginLeft: left });

      expect(px(html, "left")).toBe(left - DIVIDER_PX - EDGE_TAB_DIVIDER_CLEAR_PX);
      expect(html).toContain("translateX(-100%)");
      expect(html).not.toMatch(/\bright-0\b/);
      // wholly inside the window: its left edge is a positive number of px
      expect(left - DIVIDER_PX - EDGE_TAB_DIVIDER_CLEAR_PX - widthOf(html)).toBeGreaterThan(0);
    }
  });

  // Re-aimed (P12-89, E5): 24 px across (the 15 px face and a 9 px strip) in the 24 px gutter, the face over the divider. The tab stands in the 20 px right padding now: the strip is what the
  // padding leaves after the face and the 2 px clear of the strip, 3 px, and ends at the text's right edge — 18 px across (`HIT_PX`). It never reaches past the text's edge.
  it("keeps a hit area of 18 px across: the face and, where the face is narrower, a transparent strip on the text's side — which stops at the text's edge", () => {
    for (const { left } of margins) {
      const html = view({ beside: true, marginLeft: left });
      const hit = widthOf(html) + ext(html);

      expect(hit).toBeGreaterThanOrEqual(HIT_PX);
      // the hit area never reaches into the text: its left end is at or right of the text's right edge (the card side has none: the divider's strip is there)
      expect(px(html, "left")! - hit).toBeGreaterThanOrEqual(left - gutterAt(1));
      if (ext(html) > 0) {
        // Re-aimed in the fix (P11-34): the strip is placed from the button's padding edge, which is the border's width inside its outer edge, so it ends at the
        // face's outer edge when its left offset is its width plus that border (`-left-[10px]` for a 9 px strip); `right-full` would have put it a pixel short.
        const offset = Number(/before:-left-\[(\d+(?:\.\d+)?)px\]/.exec(html)?.[1]);
        expect(offset, "the strip stands on the text's side").toBe(ext(html) + BORDER_PX);
        expect(html).toMatch(/before:absolute/);
      }
    }
  });

  it("keeps its label whole: the face is as wide as the label's line and its border, and the label is still the mono face, vertical", () => {
    const html = view({ beside: true, marginLeft: 744 });

    expect(widthOf(html) - BORDER_PX).toBeGreaterThanOrEqual(CAPTION_PX);
    expect(html).toContain("eyebrow");
    expect(html).toContain("[writing-mode:vertical-rl]");
    expect(html).toContain(">Open your notes<");
    expect(html).toContain("z-40");
  });
});

describe("the two numbers the tab names (added with the fix)", () => {
  // Re-aimed (P12-89, E5): "what the narrowest gutter leaves after 8 px of clear and the 1 px frame" (24 - 8 - 1); the padding's 20 px less the 2 px clear of the strip, the 2 px clear of the text and the frame.
  it("the face is what the centre's right padding leaves after the clear of the strip, the clear of the text and the 1 px frame, and it is the width the markup declares", () => {
    expect(EDGE_TAB_BESIDE_PX).toBe(CENTRE_PAD_PX - EDGE_TAB_DIVIDER_CLEAR_PX - CLEAR_PX - FRAME_PX);
    expect(px(view({ beside: true, marginLeft: 744 }), "width")).toBe(EDGE_TAB_BESIDE_PX);
  });

  it("the hit area is 18 px across: the face and a strip of the difference, 3 px, on the text's side", () => {
    expect(EDGE_TAB_HIT_PX).toBe(HIT_PX);
    expect(ext(view({ beside: true, marginLeft: 744 }))).toBe(EDGE_TAB_HIT_PX - EDGE_TAB_BESIDE_PX);
  });

  it("the label's line is set solid, as tall as the type, so it fits the face: 11.5 px of type in the face less its border", () => {
    const html = view({ beside: true, marginLeft: 744 });

    expect(html).toMatch(/[;"]line-height:1[;"]/);
    expect(EDGE_TAB_BESIDE_PX - BORDER_PX).toBeGreaterThanOrEqual(CAPTION_PX);
    // and the face has no side padding of its own to push the label out of it
    expect((/class="([^"]*)"/.exec(html)?.[1] ?? "").split(" ")).toContain("py-0");
  });
});

describe("the tab with no card is as it was", () => {
  it("is on the window's edge, full size: no width of its own, the 25 px tab, and no strip", () => {
    const html = view({ beside: false, marginLeft: 1080 });
    const classes = (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(" ");

    expect(html).not.toContain("style=");
    expect(classes).toContain("right-0");
    expect(classes).toContain("px-3");
    expect(classes).toContain("py-1");
    expect(ext(html)).toBe(0);
  });

  it("beside a card with no margin registered (under 1024 px), is where it was: the card's 360 px from the right edge", () => {
    const html = view({ beside: true });

    expect(html).toContain("right-[min(360px,100vw)]");
    expect(html).not.toContain("left:");
  });
});
