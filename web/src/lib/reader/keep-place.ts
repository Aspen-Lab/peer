// P11-45 (A P11-43's note "The place is not kept when a boundary is dragged"; ruling §1h.146): the reader's place survives a re-flow.
//
// The paper's text re-wraps when its column changes width: a separator dragged (by the mouse or by its keys), the left pane collapsed or
// pinned, Fit turned on or off, the window resized. The browser keeps the scroll OFFSET through that, and the paragraphs above the reader
// grow or shrink, so the words under the eye change: measured at 1280 x 720, scrolled to 8,000, a left drag of +60 moved the top
// paragraph by one and a margin drag of -80 by two. The browser's own scroll anchoring does not hold the place on this page: measured in
// Chromium, it kept it neither through the width change (the point under the line 822 px off at 552 to 492 px) nor through a 300 px block
// put above the reader (300 px off), so nothing here leans on it.
//
// What this file does, in one rule: **the point of the paper that is under the masthead's foot stays under it.**
//
//   What is kept   The paragraph at the top of the view (`paragraphAtTop`, the Back-to-paper return's own reading of it) and WHERE in it the
//                  line under the masthead falls, as a fraction of its height. A re-flow changes a paragraph's height, so the same
//                  FRACTION into it is the same line to within a line — a long paragraph keeps the line nearest the top, not its first line.
//                  A paragraph that starts below the line (the gap between two) keeps its gap in px.
//   When           Whenever the text column's layout key changes: its width, the reading scale and Fit's zoom. A change of height alone (the
//                  reading arriving, a block opening) is not a re-flow, and is left as it was. For `SETTLE_MS` after a
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
// P11-54 (round 4's Theme-A walk, E2; ruling §1h.159): the place is kept to the LINE, not only to the paragraph. The fraction above holds the
// paragraph and, inside it, the same share of its height; a long paragraph's lines are not equally full (a short last line, a long unbroken run, a
// formula), so after a large change of column the same fraction can be another word: the walk found 22 of 279 cells with the word under the line more
// than a line away, the worst 4.27 lines.
//
//   What is kept   The CHARACTER under the line: a text node and an offset, read by a caret hit-test (`caretPositionFromPoint`, or
//                  `caretRangeFromPoint` where that is what the browser has) at `CARET_LINE_PX`, and the share of the character's own
//                  box that is above the line. After a re-flow the character's box (a one-character `Range`) is put back at the same y by the same
//                  one instant `scrollBy`. The paragraph's fraction (or its gap) is read with it, and is what is kept where there is no character.
//   Where          x is the middle of the paragraph's own box, then 30 % and 70 % of it where the middle is a formula or other non-text. The middle,
//                  because it is the one point of a line that no word of the line is more than half a line's width from, so a line that re-wraps
//                  moves the other words of it the least; the paragraph's box and not the column's, because the paragraph is what holds the text
//                  (a rewrite beside it narrows it). y is `CARET_LINE_PX`, a little below `PLACE_LINE_PX`: the first line that is half in view.
//   No text        Under the line is the gap between two paragraphs, a formula, a figure or a control; or the node has left the page (the paper
//                  was drawn again); or the browser has neither caret function: the paragraph's fraction / gap, as it was.
//   The reader     A scroll of the reader's own during the settling reads the anchor again at the place they scrolled to and does not end the
//                  keeping: the heights that go on changing (Fit's and the text steps' 0.3 s transition) are put right until the settling is over.
//                  While they are scrolling (a scroll of theirs in the last `READER_SCROLL_MS`) a correction is never made against the direction
//                  they went: what would need the other way is let go, and the place is taken as it stands. Once they have stopped, the keeping
//                  goes on both ways until the settling is over.
//
// Everything that decides something is a pure function over numbers handed in, or a small controller over an `env`, so it runs in the
// Node-only test suite; only `domEnv` and the hook touch the real page.

import { useEffect, type RefObject } from "react";
import { DOCK_TOP_PX, PAGE_ZOOM_ROOT } from "@/components/reader/explain-dock";
import { readPageZoom } from "@/lib/reader/margin";
import { paragraphAtTop } from "@/lib/notes/return-to-paper";

/** The line under the masthead that the place is read at: `paragraphAtTop`'s own default, the masthead's foot and 8 px (the first text clear of it). */
export const PLACE_LINE_PX = DOCK_TOP_PX + 8;

/**
 * The line the CHARACTER is read at: 6 px below `PLACE_LINE_PX`, about the middle of the first line of text clear of the masthead (its foot is at 48 px; a line of
 * the reading face is about 29 px at the default size), so the line is at least half in view. It is the y at which the walk's probe reads "the word under the
 * masthead's foot" (62). The paragraph's own fraction / gap is read at `PLACE_LINE_PX`, as it was.
 */
export const CARET_LINE_PX = PLACE_LINE_PX + 6;

/** Within this many px of either end of the page, the reader is "at the top" or "at the foot": nothing is kept there. */
export const EDGE_PX = 1;

/** A correction smaller than this (a pixel) is not made: a place that holds is not touched. */
export const MIN_SHIFT_PX = 1;

/** How long after a re-flow the place is held while the page settles: more than the 0.3 s of Fit's and the text steps' transition (`.zoom-transition`). */
export const SETTLE_MS = 600;

/** The reader is "scrolling" for this long (ms) after their last scroll: a wheel's notches, a key's repeat, a scrollbar's drag, a smooth scroll's frames come well inside it. */
export const READER_SCROLL_MS = 150;

/** The smallest box (px) of a character that is read as one: below it the node is hidden or collapsed (a screen-reader-only text, a collapsed space). */
export const MIN_CHAR_PX = 6;

/** Where the caret is read, as fractions of the paragraph's own width: the middle first, and the nearer-the-edge places where the middle is not text. */
export const CARET_X = [0.5, 0.3, 0.7] as const;

/** What is not prose: a drawn formula, a figure, a control, a screen-reader-only text. The caret is not kept there (the paragraph's fraction is). */
export const NOT_PROSE = ".katex, .katex-display, math, code, figure, button, svg, .sr-only";

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

/** What the caret hit-test found under the line, in paragraph `id`: a character (a text node and its offset) and its box in the window's pixels. */
export interface CharRead {
  id: string;
  node: unknown;
  offset: number;
  top: number;
  height: number;
}

/** The character the place is kept by, and how much of its own box is above `CARET_LINE_PX` (a fraction: the line may fall a little outside the glyph, in the line's leading). */
export interface Anchor {
  node: unknown;
  offset: number;
  fraction: number;
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
 * How far the page has to scroll to put the anchor's character back under the line, given its box now: the same share of the box above `CARET_LINE_PX`.
 * Zero within `MIN_SHIFT_PX`. Pure.
 */
export function shiftToKeepChar(anchor: Pick<Anchor, "fraction">, now: { top: number; height: number }): number {
  const shift = now.top - (CARET_LINE_PX - anchor.fraction * now.height);
  return Math.abs(shift) < MIN_SHIFT_PX ? 0 : shift;
}

/**
 * Whether a character of box (`top`, `height`) is the text under the line (`CARET_LINE_PX`): the line falls in its box, or in its line's leading above or
 * below it (half a box either way). A hit that snapped to a line far from the line is not. Pure.
 */
export function underTheLine(top: number, height: number): boolean {
  return Number.isFinite(top) && height >= MIN_CHAR_PX && CARET_LINE_PX >= top - height / 2 && CARET_LINE_PX <= top + height + height / 2;
}

/**
 * The anchor to keep, from what the caret found: null where it found nothing, where the paragraph starts below the line (the gap is kept), where the
 * character is in another paragraph than the one at the top, or where it is not under the line. Pure.
 */
export function anchorOf(read: CharRead | null, held: Held | null): Anchor | null {
  if (!read || !held || held.gap > 0 || read.id !== held.id || !underTheLine(read.top, read.height)) return null;
  return { node: read.node, offset: read.offset, fraction: (CARET_LINE_PX - read.top) / read.height };
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
  /**
   * The character under the line in paragraph `id` (the caret hit-test at the line), or null where there is no text under it. Optional: an env
   * without it keeps the paragraph's fraction, as P11-45 did.
   */
  char?(id: string): CharRead | null;
  /** Where that character's box is now, or null where it has left the page or has no box. Optional with `char`. */
  charBox?(anchor: Anchor): { top: number; height: number } | null;
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
 *
 * The reader's own scroll during the settling reads the place again and leaves the hold on (rule 4). While they are scrolling (a scroll of theirs
 * in the last `READER_SCROLL_MS`, made while the settling was on), a correction that would move the page against the direction they went is not made: the place is read again
 * from where it stands. A text step's transition changes the column's width at every frame, so each of its frames is a change of layout key; the
 * direction is kept by time, not reset by the key. A scroll the window has made that its event has not yet told (the observer is told before the
 * event, in a frame whose scroll came from the compositor) is the reader's too, and a correction does not undo it.
 */
export function keepPlace(env: KeepPlaceEnv): () => void {
  let held: Held | null = null;
  let anchor: Anchor | null = null;
  let key = env.key();
  /** Where the window stood after the last correction: a scroll event that finds it there is the correction's own. */
  let own: number | null = null;
  /** Until when the place is held through the page's settling (the clock's ms); 0 when it is not. */
  let settleUntil = 0;
  /** Where the window stood at the last read, scroll or correction: a scroll the reader has made is the distance from it. */
  let at = env.scrollY();
  /** The direction of the reader's last scroll: 1 down, -1 up, 0 none (yet); and when it was (the clock's ms). */
  let dir = 0;
  let lastScroll = Number.NEGATIVE_INFINITY;

  const read = () => {
    held = heldPlace(env.view());
    anchor = held && held.gap === 0 && env.char ? anchorOf(env.char(held.id), held) : null;
    at = env.scrollY();
  };
  /** How far the page has to scroll to put the place back: by the character where there is one on the page, else by the paragraph; null where neither is. */
  const shift = (): number | null => {
    if (!held) return null;
    const box = anchor && env.charBox ? env.charBox(anchor) : null;
    if (anchor && box) return shiftToKeepChar(anchor, box);
    const now = env.paragraph(held.id);
    return now ? shiftToKeep(held, now) : null;
  };
  const onScroll = () => {
    const y = env.scrollY();
    if (own !== null && Math.abs(y - own) < MIN_SHIFT_PX) {
      at = y;
      return;
    }
    own = null;
    // The reader's own scroll: read the place where they are. During the settling the hold goes on (it is theirs to correct, not to end), and
    // the direction they went is what the corrections that follow, while they are still scrolling, must not go against. A scroll with no
    // settling on is not that: the next re-flow is a change of its own, kept in full.
    if (Math.abs(y - at) >= MIN_SHIFT_PX && env.now() < settleUntil) {
      dir = Math.sign(y - at);
      lastScroll = env.now();
    }
    read();
  };
  const onBox = () => {
    const next = env.key();
    const now = env.now();
    // The window has moved since the place was read or put back, and its scroll event has not come: the reader's, ahead of its event; unless it is
    // at the foot, where the browser puts a window that the page has become too short for (that is not the reader's, and is put right as ever).
    let ahead = Math.abs(env.scrollY() - at) >= MIN_SHIFT_PX ? env.scrollY() - at : 0;
    if (ahead !== 0 && atEdge(env.view())) ahead = 0;
    if (ahead !== 0 && now < settleUntil) {
      dir = Math.sign(ahead);
      lastScroll = now;
    }
    if (next !== key) {
      key = next;
      settleUntil = now + SETTLE_MS;
    } else if (now >= settleUntil) {
      // Taller or shorter, not re-wrapped (the reading arrived, a block opened): not a re-flow, so nothing is put back, as it was;
      // take the place as it stands.
      read();
      return;
    }
    const base = shift();
    if (base === null) return;
    // The anchor has moved with the reader's own scroll too (`ahead`): what is put right is the change of the page's heights, not their scroll.
    const dy = base + ahead;
    if (Math.abs(dy) < MIN_SHIFT_PX) return;
    if (dir !== 0 && now - lastScroll < READER_SCROLL_MS && dy * dir < 0) {
      // The reader is scrolling and the page would go back against them: not put back. The place is what it is now.
      read();
      return;
    }
    env.scrollBy(dy);
    own = env.scrollY();
    at = own;
  };

  read();
  const stopScroll = env.onScroll(onScroll);
  const stopObserving = env.observe(onBox);
  return () => {
    stopScroll();
    stopObserving();
  };
}

/** The caret hit-test the browser has: the standard `caretPositionFromPoint`, or the older `caretRangeFromPoint`; null where it has neither. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => { startContainer: Node; startOffset: number } | null;
  };
  if (typeof d.caretPositionFromPoint === "function") {
    const c = d.caretPositionFromPoint(x, y);
    return c ? { node: c.offsetNode, offset: c.offset } : null;
  }
  if (typeof d.caretRangeFromPoint === "function") {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

/** The real page. Browser only. */
export function domEnv(column: Element): KeepPlaceEnv {
  const box = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { top: rect.top, height: rect.height };
  };
  /** One Range, used again for every character: a read does not make a new one. */
  let range: Range | null = null;
  /** The box of the character at `offset` of `text`, or null where it has none (collapsed, hidden, or past the end of the node). */
  const charRect = (text: Text, offset: number) => {
    if (offset < 0 || offset >= text.length || typeof document.createRange !== "function") return null;
    range ??= document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + 1);
    const rect = range.getBoundingClientRect();
    return rect.height >= MIN_CHAR_PX ? { top: rect.top, height: rect.height } : null;
  };
  /** The character of paragraph `el` that the caret at (x, y) is on: prose inside the paragraph, the one right of the caret (or left of it, where that is a space). */
  const charAt = (el: HTMLElement, x: number, y: number): CharRead | null => {
    const caret = caretAt(x, y);
    if (!caret || caret.node.nodeType !== 3 || !el.contains(caret.node)) return null;
    const text = caret.node as Text;
    if (!text.parentElement || text.parentElement.closest(NOT_PROSE)) return null;
    for (const offset of [caret.offset, caret.offset - 1, caret.offset + 1]) {
      if (offset < 0 || offset >= text.length || !/\S/.test(text.data[offset])) continue;
      const rect = charRect(text, offset);
      if (rect && underTheLine(rect.top, rect.height)) return { id: el.id, node: text, offset, top: rect.top, height: rect.height };
    }
    return null;
  };
  return {
    char(id) {
      const el = document.getElementById(id);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      for (const share of CARET_X) {
        const found = charAt(el, rect.left + rect.width * share, CARET_LINE_PX);
        if (found) return found;
      }
      return null;
    },
    charBox(anchor) {
      const text = anchor.node as Text;
      return text.isConnected ? charRect(text, anchor.offset) : null;
    },
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
