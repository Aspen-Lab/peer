// The "Explain this?" conversation as a dock (P7-15; the owner's R7, ruling Q4) that stays open and
// stands level with the paragraph it explains (P8-02; BACKLOG-31, the owner's words, ruling §1h.41 (b)) — P9-03b
// (ruling §1h.49): level with the SELECTED paragraph, and carrying the "Explain this?" control itself.
//
// From a window of 1024 px the box is not a card at the selection but a window
// fixed at the right edge of the screen: flush with the edge, 360 px wide, in the
// margin the page keeps clear (below), scrolling inside. Once it is open it STAYS open across
// selections (`explain-box.tsx`) until Close (Escape clears its passage, P8-06, and with no empty state to go back to
// closes it), and its top is level with the first line of
// the PARAGRAPH it stands at (below: the selected one), measured again as the page scrolls and the window
// resizes:
//
//   top = clamp(paragraphTop, DOCK_TOP_PX, windowHeight − legend − needed)
//
// where `legend` is the foot legend's height on screen: `DOCK_BOTTOM_PX` at the page's own scale, and 28 × the page's zoom once
// Fit to screen scales it (`legendHeightPx`; P9-20, BACKLOG-42).
//
// so it never stands above the masthead's foot (it stays there while the paragraph is scrolled
// above it) and never so low that the whole window it needs does not fit above the foot legend. P9-17 (rulings §1h.56 and
// §1h.57; A P9-R2 F1; the owner: "if the selected paragraph is at the bottom of the screen, the window's bottom edge
// sits directly on the bottom of the screen; in short, the window is always inside the screen"): what the window needs is
// its own height, measured after each commit (`explain-box.tsx`) — at least `DOCK_THREAD_FLOOR_PX` once it holds a passage
// (its sticky header, its sticky controls row and two lines of the answer between them), and for the empty window just its
// own (about 125 px; `DOCK_MIN_VISIBLE_PX` until it is measured). So the window is level with the paragraph's first
// line whenever all of it fits below that line, else it is lifted until its bottom edge stands on the legend's reserve
// (the legend's height, `legendHeightPx`: the legend is the page's own last line), never lower.
// Its height is its content, at most what is left between its top and the legend; it scrolls inside.
// P9-03b (ruling §1h.49; the owner: "level with the first line of the SELECTED paragraph"): `paragraphTop` is that of
// the paragraph the reader last selected — the explained one until another is selected. When a selection is offered
// (P9-18: when the primary pointer is up — a drag that pauses with the button held offers nothing; a keyboard
// selection keeps the page's 150 ms debounce) in another paragraph the window moves there at once, with no close and no reflow
// (the properties below are never taken off) and its content unchanged; the "Explain this?" control is in its header
// while the selection is not the passage it explains. The floating button stands only where no window does.
//
// P8-06 (the owner's "yes" of 16:4xZ 2026-10-11 to "is the window already there, as an empty panel, before any
// text is selected?"; ruling §1h.45): for a reader with a key, on a paper with a readable body, from the same
// 1024 px, the window is there from the body's first paint — before anything is selected, let alone explained.
// It is the same dock: the right edge, 360 wide, its top at `DOCK_TOP_PX` until a passage is selected (then the
// rule above — level with the paragraph), the page keeping `DOCK_RESERVE_PX` clear from the mount, not from the
// first open. It holds the card's header and one line of copy (`EXPLAIN.empty`); the first Explain fills it in
// place, nothing closes or reopens. Close hides it for the rest of the page visit (the box's state, not stored; a
// reload shows it again) and the next "Explain this?" brings it back; Escape never hides it — it clears the passage
// back to the empty state and, with the empty state showing, is the page's. Without a key nothing stands — a
// permanent panel for a reader with none would be a locked block (§1b) — and below 1024 px nothing does: the card
// and the sheet open on the reader's press only. `emptyDockStands` is that rule.
//
// Plain module, no directive: the placement (`explain-box.tsx`) and the pins on
// the shell's own heights read the numbers from one place.
//
// The masthead is `h-12` (`components/shell/masthead.tsx`) and the foot legend
// is `h-[var(--legend-h)]` with `--legend-h: 1.75rem` (`globals.css`), at the
// browser's 16 px root; a test holds each of the two against the source it
// copies, so a change there cannot leave the dock under or over them.

/** From this window width the conversation is the dock (Tailwind's `lg`); below it,
 *  P3-02's card (640 to 1023) or a phone's bottom sheet (under 640). */
export const DOCK_MIN_VIEWPORT_PX = 1024;

/** The dock's width: also the card's. */
export const DOCK_WIDTH_PX = 360;

/** The dock's highest top: the sticky masthead's height (`h-12`). Its top is level with its paragraph's
 *  (P8-02) and never above this. */
export const DOCK_TOP_PX = 48;

/** P9-17 (A P9-R2 F4): the masthead is `hidden md:grid sticky top-0 h-12`, so it is there only from Tailwind's `md`, 48rem, and
 *  the 48 px of `DOCK_TOP_PX` are the page's head only from this width. The floating button (`fixed z-[70]`, above the
 *  masthead's `z-50`) keeps below them from here; under it the window's own margin is its head. */
export const MASTHEAD_MIN_VIEWPORT_PX = 768;

/**
 * P9-20 (A P9-W2's X13), P9-41 (ruling §1h.66): the page's bottom furniture is the phone's thumb bar under 768 px and the foot legend from
 * it. Both swap at Tailwind's `md`, 48rem, the masthead's own breakpoint (`MASTHEAD_MIN_VIEWPORT_PX`): the bar
 * (`components/shell/thumb-bar.tsx`) is `md:hidden fixed inset-x-0 bottom-0`, the legend (`key-legend.tsx`) is `hidden md:flex fixed
 * inset-x-0 bottom-0`, `DOCK_BOTTOM_PX` tall. The "Explain this?" control follows the swap: from 768 px a pill above the legend where no
 * gutter stands (`explain-box.tsx`, `placeButton`); under 768 px a cell of the bar's own rail, with no pill at all — so nothing here
 * copies the bar's height any more: there is nothing above the bar to clear (a test holds the swap against both components).
 */

/** The dock's bottom edge stands this far above the window's: the foot legend's height (`--legend-h`) at the page's own scale (zoom 1).
 *  P9-20 (BACKLOG-42): the legend is `DOCK_BOTTOM_PX × zoom` tall once Fit to screen scales the page — `legendHeightPx` — and
 *  the window's reserve is that, not this flat number. */
export const DOCK_BOTTOM_PX = 28;

/** P9-20 (BACKLOG-42; A P9-W2): the custom property that carries the page's Fit zoom (`usePageZoom`, set on the page container
 *  `[data-zoom-root]` beside the CSS `zoom` it mirrors). The foot legend is inside that container and so is scaled by it; the
 *  explain box is mounted outside it, in the window's own pixels, and reads the number to size the legend's strip. */
export const PAGE_ZOOM_VAR = "--page-zoom";

/** The page container the zoom is set on (`page.tsx`, `data-zoom-root`; `withZoomTransition` finds it the same way). */
export const PAGE_ZOOM_ROOT = "[data-zoom-root]";

/**
 * P9-20 (BACKLOG-42): the foot legend's height on screen, in the window's own pixels. The legend is `h-[var(--legend-h)]`
 * (`DOCK_BOTTOM_PX` at 16 px to the rem) inside the page container, which Fit scales with CSS `zoom` — so it is 32 px tall at
 * 1440 × 1000 (zoom 1.142), 38.6 at 1920 × 1080 (1.378) and 51.5 at 2560 × 1440 (1.838) — while the window kept a flat 28 and
 * stood 4.0 / 10.6 / 23.5 px over it. Fit off, or no zoom to read, is the flat number. The window's bottom stands on this, and so
 * does the floating control's strip: the legend's top edge.
 */
export function legendHeightPx(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? DOCK_BOTTOM_PX * zoom : DOCK_BOTTOM_PX;
}

/** P8-02: the dock's top stands no lower than this much of it still shows above the foot legend (its lowest
 *  top is the window's height less `DOCK_BOTTOM_PX` less this), so a paragraph far down the screen never
 *  leaves a window too short to read. P9-17 (ruling §1h.57): what the empty window is given to stand on until its own height
 *  is measured (it is about 125 px tall); a window that holds a passage needs `DOCK_THREAD_FLOOR_PX` at least. */
export const DOCK_MIN_VISIBLE_PX = 160;

/**
 * P9-17 (ruling §1h.56; A P9-R2 F1): the least a window that holds a passage needs — room for its sticky header
 * (140 px at 1440 × 900 with the build's CSS and fonts: a two-line quote, its section and the "Explain this?" control;
 * 154 px with the control at the 44 px touch size), its sticky controls row (101 px: the search toggle, the input and
 * Send) and the top of the answer between them (a 16 px gap, the label, then two 23 px lines). Measured in a browser,
 * the second line of the answer ends 330 px below the window's top with the pointer's control and 344 px with the touch
 * one, so 360. At the old 160 px floor the two bars overlapped by 38 to 83 px, covered the search toggle and showed none
 * of the answer; A's first bound (300) counted two lines and not the answer's own top, and shows none of it either.
 * The box uses the larger of this and the card's measured height (ruling §1h.57), so the window's whole height is in view.
 */
export const DOCK_THREAD_FLOOR_PX = 360;

/** P10-08 (review 1.1; B P10-01; ruling §1h.80 (a)): a reading of the card's height within this many pixels of the one the box already
 *  holds is the same height. It was 1: a sub-pixel overshoot of a bottom-clamped card flipped it across the boundary. */
export const HEIGHT_TOLERANCE_PX = 2;

/** The most writes the height effect makes for one change the reader made (a burst of commits with nothing changed by the reader). */
export const HEIGHT_BURST_MAX = 8;

/** What the height effect remembers between commits: the reader-facing inputs it last wrote for, the heights it wrote in this burst,
 *  and whether it has settled. */
export interface HeightGuard {
  key: string;
  writes: number;
  trail: number[];
  locked: boolean;
}

export const newHeightGuard = (): HeightGuard => ({ key: "", writes: 0, trail: [], locked: false });

/** The burst is over (a frame has passed, or the reader changed something): a fresh budget. */
export function resetHeightGuard(guard: HeightGuard): void {
  guard.writes = 0;
  guard.trail = [];
  guard.locked = false;
}

/**
 * P10-08 (review 1.1; B P10-01's fix guide step 1 and 3; ruling §1h.80 (a)): the height the box's after-every-commit layout effect may
 * write, or null for none. The effect reads the card's height on every commit and the card's place depends on it, so a layout that
 * answers the card's own size with another size (a scrollbar that comes and goes, a sub-pixel overshoot) makes the effect write on
 * every commit, and React throws "Maximum update depth exceeded" at the 51st. The cause was never found in a browser, so this
 * ends a loop of that shape whatever its cause:
 *
 *   - a reading within `HEIGHT_TOLERANCE_PX` of the height held is the same height, and ends the burst;
 *   - an A, B, A pattern (the reading is the height written two writes ago) or more than `HEIGHT_BURST_MAX` writes with nothing
 *     changed by the reader (`key`, the reader-facing inputs: the passage, the thread, the draft, the window) settles on the LARGEST
 *     height seen — a taller window never hides content, the card scrolls inside and `placePanel` keeps it on the screen — and
 *     writes no more until the reader changes something (a new `key`) or the box resets the guard on the next frame.
 *
 * Mutates `guard`; the caller writes the returned height.
 */
export function settleHeight(guard: HeightGuard, held: number | null, reading: number, key: string): number | null {
  if (guard.key !== key) {
    resetHeightGuard(guard);
    guard.key = key;
  }
  if (guard.locked) return null;
  const same = (a: number, b: number) => Math.abs(a - b) < HEIGHT_TOLERANCE_PX;
  if (held !== null && same(held, reading)) {
    guard.writes = 0;
    guard.trail = [];
    return null;
  }
  const echoed = guard.trail.length >= 2 && same(guard.trail[guard.trail.length - 2], reading);
  if (echoed || guard.writes >= HEIGHT_BURST_MAX) {
    guard.locked = true;
    const largest = Math.max(reading, held ?? reading, ...guard.trail);
    return held !== null && same(held, largest) ? null : largest;
  }
  guard.writes += 1;
  guard.trail.push(reading);
  return reading;
}

/**
 * P8-06 (ruling §1h.45): whether the window stands EMPTY, before any passage is explained — a reader with a key
 * (`canAsk`), a paper with a readable body (`hasBody`: its Paper digestion tab exists, so there is text to select),
 * the dock's width (`width` ≥ `DOCK_MIN_VIEWPORT_PX`), and not yet hidden (`hidden`: Close, for the rest of
 * the page visit). The box adds "and no passage is open" — an open window is its own. Without a key it is false:
 * the Tier 0 definition opens on a defined-term selection as it always did, and stays open once it has (P8-02).
 */
export function emptyDockStands(state: { canAsk: boolean; hasBody: boolean; hidden: boolean; width: number }): boolean {
  return state.canAsk && state.hasBody && !state.hidden && state.width >= DOCK_MIN_VIEWPORT_PX;
}

// ── Making room ───────────────────────────────────────────────────────────
//
// The dock covers nothing (Q4): while it is open the page keeps its width clear. The box is
// mounted outside the page's container on purpose (its pixels are the window's, which the
// container's zoom would scale), so it tells the page through two custom properties on the
// document's root, written while the dock is open and taken off when it closes:
//
//   `--explain-dock`        what the page leaves free at its right: the dock and a gap, 376px.
//                           `globals.css` pads the shell's <main> by it, so the page container — whose
//                           width is a cap on the room it is given — is given the room that is left,
//                           and centres itself in it: the spread moves left and the reading column
//                           keeps its width where the cap allows, else it narrows; the panel never does.
//   `--explain-dock-width`  the dock itself, 360px. The notes tab (`notes-button.tsx`) stands at this
//                           offset from the window's edge, beside the dock instead of under it.

/** The room between the page's right edge and the dock. */
export const DOCK_GAP_PX = 16;

/** What the page keeps clear: the dock and the gap. */
export const DOCK_RESERVE_PX = DOCK_WIDTH_PX + DOCK_GAP_PX;

export const DOCK_VAR = "--explain-dock";
export const DOCK_WIDTH_VAR = "--explain-dock-width";

type StyleRoot = { style?: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty"> } | null | undefined;

/**
 * Keep the dock's width clear on the page: write the two properties on `root` (the document element)
 * and return what takes them off again. Quiet where there is no root to write to (a server render,
 * a test with a bare document).
 */
export function reserveDock(root: StyleRoot): () => void {
  const style = root?.style;
  if (!style) return () => {};
  style.setProperty(DOCK_VAR, `${DOCK_RESERVE_PX}px`);
  style.setProperty(DOCK_WIDTH_VAR, `${DOCK_WIDTH_PX}px`);
  return () => {
    style.removeProperty(DOCK_VAR);
    style.removeProperty(DOCK_WIDTH_VAR);
  };
}
