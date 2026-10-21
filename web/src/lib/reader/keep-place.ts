// P11-45 (A P11-43's note "The place is not kept when a boundary is dragged"; ruling §1h.146): the reader's place survives a re-flow.
//
// The paper's text re-wraps when its column changes width: a separator dragged (by the mouse or by its keys), the left pane collapsed or
// pinned, Fit turned on or off, the window resized. The browser keeps the scroll OFFSET through that, and the paragraphs above the reader
// grow or shrink, so the words under the eye change: measured at 1280 x 720, scrolled to 8,000, a left drag of +60 moved the top
// paragraph by one and a margin drag of -80 by two. Chromium's own scroll anchoring does not help: it stands down when the width of the
// anchor's ancestors changes, which is exactly this change.
//
// What this file does, in one rule: **the point of the paper that is under the masthead's foot stays under it.**
//
//   What is kept   The paragraph at the top of the view (`paragraphAtTop`, the Back-to-paper return's own reading of it) and WHERE in it the
//                  line under the masthead falls, as a fraction of its height. A re-flow changes a paragraph's height, so the same
//                  FRACTION into it is the same line to within a line — a long paragraph keeps the line nearest the top, not its first line.
//                  A paragraph that starts below the line (the gap between two) keeps its gap in px.
//   When           Whenever the text column's layout key changes: its width, the reading scale and Fit's zoom. A change of height alone (the
//                  reading arriving, a block opening) is not a re-flow, and is left to the browser, as it was. For `SETTLE_MS` after a
//                  re-flow the place is held through the page's own settling: Fit and the text steps are a 0.3 s transition of the
//                  zoom, the widths and the font sizes (`.zoom-transition`, `globals.css`), so the heights go on changing for some
//                  frames after the key has changed once. The reader's own scroll ends the hold at once.
//   How            In the column's ResizeObserver callback: after the layout and before the paint, in the same frame, by one instant
//                  `scrollBy` of the difference. The frame the reader sees is the corrected one, so there is no jump to see, whether the
//                  change is one step (a key, a pin, a Fit) or sixty a second (a drag, whose divider writes the width once per frame).
//                  The place is read from the page at the reader's own scrolls (never from the correction's), and kept as it was read through
//                  every frame of a drag, so the correction does not drift.
//   Left alone     At the top (scroll 0) and at the foot of the page: there is nothing to keep, and a correction there would fight the
//                  reader's own scroll. Without a paragraph on the screen (the Summary tab, a paper with no body): nothing is moved.
//
// Nothing else is touched: the pane widths, the map's scroll, the cards (they follow their paragraphs by their own scroll listeners), the
// Back-to-paper return and the arrivals. No smooth scroll (`behavior: "instant"`), so reduced motion has nothing to respect.
//
// Everything that decides something is a pure function over numbers handed in, or a small controller over an `env`, so it runs in the
// Node-only test suite; only `domEnv` and the hook touch the real page.

import { useEffect, type RefObject } from "react";
import { DOCK_TOP_PX, PAGE_ZOOM_ROOT } from "@/components/reader/explain-dock";
import { readPageZoom } from "@/lib/reader/margin";
import { paragraphAtTop } from "@/lib/notes/return-to-paper";

/** The line under the masthead that the place is read at: `paragraphAtTop`'s own default, the masthead's foot and 8 px (the first text clear of it). */
export const PLACE_LINE_PX = DOCK_TOP_PX + 8;

/** Within this many px of either end of the page, the reader is "at the top" or "at the foot": nothing is kept there. */
export const EDGE_PX = 1;

/** A correction smaller than this (a pixel) is not made: a place that holds is not touched. */
export const MIN_SHIFT_PX = 1;

/** How long after a re-flow the place is held while the page settles: more than the 0.3 s of Fit's and the text steps' transition (`.zoom-transition`). */
export const SETTLE_MS = 600;

/** The text column, whose width is what the paragraphs wrap to (`reader-shell.tsx`: `.reader-centre-inner`, capped at 38em and centred). */
export const COLUMN_SELECTOR = "[data-reader-centre-inner]";

/** The paragraph at the top, as the page reads it. */
export interface TopParagraph {
  id: string;
  /** Its top, in the window's pixels. */
  top: number;
  height: number;
}

/** What a reading of the page holds. */
export interface View {
  scrollY: number;
  /** The window's height. */
  viewportHeight: number;
  /** The page's whole height. */
  scrollHeight: number;
  /** The first paragraph that reaches below the masthead, or null where there is none. */
  top: TopParagraph | null;
}

/** The place: which paragraph, and where in it the line falls. */
export interface Held {
  id: string;
  /** How much of the paragraph is above the line, as a fraction of its height (0 where it starts below the line). */
  fraction: number;
  /** How far below the line the paragraph starts, in px (0 where the line is inside it). */
  gap: number;
}

/** Whether `scrollY` is at the page's top, or at its foot, to within a pixel. */
export function atEdge(view: Pick<View, "scrollY" | "viewportHeight" | "scrollHeight">): boolean {
  return view.scrollY < EDGE_PX || view.scrollHeight - (view.scrollY + view.viewportHeight) <= EDGE_PX;
}

/**
 * The place to keep, read from the page: null at the top and at the foot (nothing moves there), with no paragraph at the top of the view,
 * and with that paragraph starting below the window (the reader is looking at something else). Pure.
 */
export function heldPlace(view: View): Held | null {
  const top = view.top;
  if (!top || atEdge(view)) return null;
  if (!(top.height > 0) || top.top >= view.viewportHeight) return null;
  if (top.top >= PLACE_LINE_PX) return { id: top.id, fraction: 0, gap: top.top - PLACE_LINE_PX };
  return { id: top.id, fraction: Math.min(1, (PLACE_LINE_PX - top.top) / top.height), gap: 0 };
}

/**
 * How far the page has to scroll to put `held` back under the line, given the paragraph's box now: its top less the top it should have.
 * The same fraction of its (new) height is above the line; a paragraph that began below the line keeps its gap. Zero within `MIN_SHIFT_PX`.
 * Pure.
 */
export function shiftToKeep(held: Held, now: { top: number; height: number }): number {
  const target = held.gap > 0 ? PLACE_LINE_PX + held.gap : PLACE_LINE_PX - held.fraction * now.height;
  const shift = now.top - target;
  return Math.abs(shift) < MIN_SHIFT_PX ? 0 : shift;
}

/**
 * The text column's layout, as a key: its width (tenths of a px, in the window's pixels), the reading scale and Fit's zoom. The same key
 * means the same wrapping; a different one is a re-flow. A change of height alone is not.
 */
export function layoutKey(width: number, scale: string, zoom: string): string {
  return `${Math.round(width * 10)}|${scale.trim()}|${zoom.trim()}`;
}

/** The page and the clock, as the controller sees them. */
export interface KeepPlaceEnv {
  /** Read the page now. */
  view(): View;
  /** The box of the paragraph with this id, or null where it is not on the page. */
  paragraph(id: string): { top: number; height: number } | null;
  /** The text column's layout key now. */
  key(): string;
  scrollY(): number;
  /** The clock, in ms. */
  now(): number;
  /** Scroll the window by `dy` at once (never smoothly). */
  scrollBy(dy: number): void;
  /** Told when the window scrolls (the reader's, or a correction's); the result stops listening. */
  onScroll(run: () => void): () => void;
  /** Told after the layout, before the paint, whenever the column's box (or Fit's root) changes size; the result stops it. */
  observe(run: () => void): () => void;
}

/**
 * Keep the place across re-flows until the result is called.
 *
 * The place is read at the reader's own scrolls and at a change of height alone; a change of layout key puts it back, and for `SETTLE_MS`
 * after it a change of height puts it back too (the page is still settling: a transition, a late measure). The scrolls this makes are known
 * by the position they leave (`own`) and do not read the place again, so a drag's sixty corrections a second all go back to the one place
 * the reader left, not to each other's rounding.
 */
export function keepPlace(env: KeepPlaceEnv): () => void {
  let held: Held | null = null;
  let key = env.key();
  /** Where the window stood after the last correction: a scroll event that finds it there is the correction's own. */
  let own: number | null = null;
  /** Until when the place is held through the page's settling (the clock's ms); 0 when it is not. */
  let settleUntil = 0;

  const read = () => {
    held = heldPlace(env.view());
  };
  const onScroll = () => {
    if (own !== null && Math.abs(env.scrollY() - own) < MIN_SHIFT_PX) return;
    own = null;
    settleUntil = 0;
    read();
  };
  const onBox = () => {
    const next = env.key();
    const at = env.now();
    if (next !== key) {
      key = next;
      settleUntil = at + SETTLE_MS;
    } else if (at >= settleUntil) {
      // Taller or shorter, not re-wrapped (the reading arrived, a block opened): the browser keeps the place through that, as it did;
      // take it as it stands.
      read();
      return;
    }
    if (!held) return;
    const now = env.paragraph(held.id);
    if (!now) return;
    const shift = shiftToKeep(held, now);
    if (shift === 0) return;
    env.scrollBy(shift);
    own = env.scrollY();
  };

  read();
  const stopScroll = env.onScroll(onScroll);
  const stopObserving = env.observe(onBox);
  return () => {
    stopScroll();
    stopObserving();
  };
}

/** The real page. Browser only. */
export function domEnv(column: Element): KeepPlaceEnv {
  const box = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { top: rect.top, height: rect.height };
  };
  return {
    view() {
      const top = paragraphAtTop(document, PLACE_LINE_PX);
      const rect = top ? box(top.id) : null;
      return {
        scrollY: window.scrollY,
        viewportHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
        top: top && rect ? { id: top.id, top: rect.top, height: rect.height } : null,
      };
    },
    paragraph: box,
    key() {
      const style = window.getComputedStyle(column);
      return layoutKey(column.getBoundingClientRect().width, style.getPropertyValue("--reading-scale"), String(readPageZoom(column)));
    },
    scrollY: () => window.scrollY,
    now: () => performance.now(),
    scrollBy: (dy) => window.scrollBy({ top: dy, behavior: "instant" }),
    onScroll(run) {
      window.addEventListener("scroll", run, { passive: true });
      return () => window.removeEventListener("scroll", run);
    },
    observe(run) {
      if (typeof ResizeObserver === "undefined") return () => {};
      const observer = new ResizeObserver(run);
      observer.observe(column);
      // Fit's zoom changes the root's size when it changes the wrapping, even where the capped column's own width does not move.
      const root = column.ownerDocument?.querySelector(PAGE_ZOOM_ROOT);
      if (root) observer.observe(root);
      return () => observer.disconnect();
    },
  };
}

/**
 * The shell's one call: keep the reader's place while the text column re-flows. `grid` is the shell's grid, which holds the column; where it
 * cannot be found (a shell rendered without a DOM), nothing is kept and nothing fails.
 */
export function useKeepPlace(grid: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const shell = grid.current;
    if (!shell || typeof shell.querySelector !== "function") return;
    const column = shell.querySelector(COLUMN_SELECTOR);
    return column ? keepPlace(domEnv(column)) : undefined;
  }, [grid]);
}
