// The "Explain this" conversation as a dock (P7-15; the owner's R7, ruling Q4) that stays open and
// stands level with the paragraph it explains (P8-02; BACKLOG-31, the owner's words, ruling §1h.41 (b)) — P9-03b
// (ruling §1h.49): level with the SELECTED paragraph.
//
// From a window of 1024 px the box is not a card at the selection but a card in the margin (P11-14: one card of the margin's stack,
// `lib/reader/windows.ts`, `margin-card.tsx`; where no shell has registered a margin, a window fixed at the right edge: flush with the
// edge, 360 px wide), scrolling inside. P10-08 (review 8.5; the owner: no window on entering a paper): it exists only
// while a passage is open — the selection buttons and `e` open it, Close and Escape close it. P11-14: nothing is reserved for it — the
// margin is a track of the reader's shell, so the paper's words never move when it opens or closes. Once it is open it STAYS open across
// selections (`explain-box.tsx`), and its top is level with the first line of
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
// its own height, measured after each commit (`explain-box.tsx`; P10-08: `settleHeight` below keeps that read from running away) — at
// least `DOCK_THREAD_FLOOR_PX` once it holds a passage
// (its sticky header, its sticky controls row and two lines of the answer between them). So the window is level with the paragraph's
// first line whenever all of it fits below that line, else it is lifted until its bottom edge stands on the legend's reserve
// (the legend's height, `legendHeightPx`: the legend is the page's own last line), never lower.
// Its height is its content, at most what is left between its top and the legend; it scrolls inside.
// P9-03b (ruling §1h.49; the owner: "level with the first line of the SELECTED paragraph"): `paragraphTop` is that of
// the paragraph the reader last selected — the explained one until another is selected. When a selection is settled
// (P9-18: when the primary pointer is up — a drag that pauses with the button held offers nothing; a keyboard
// selection keeps the page's 150 ms debounce) in another paragraph the window moves there at once, with no close and no reflow
// (the properties below are never taken off) and its content unchanged. P10-08: a selection in the Summary or an answer has no
// paragraph of the paper, so the window stands at `DOCK_TOP_PX`.
//
// Below 1024 px — the card and the sheet — nothing is persistent: they open on the reader's press only, as the dock does.
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

/**
 * P10-31 (BACKLOG-86): a modal dialog over the page — the figure lightbox and the Keyboard-shortcuts sheet are the two — takes Escape before
 * the explain window does. Both mark themselves with this (their own markup, not the window's: the window is a region, never modal).
 */
export const MODAL_OVER_PAGE = '[aria-modal="true"]';

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
 *  leaves a window too short to read. P9-17 (ruling §1h.57): what a window is given to stand on until its own height
 *  is measured; a window that holds a passage needs `DOCK_THREAD_FLOOR_PX` at least. */
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

// ── The band the cards stand in ───────────────────────────────────────────
//
// P10-18 (A P10-14 §4 X-B1, B9; ruling §1h.93 (a)) made the explain window give the stickies' column its room (`dockInStack`): it stood
// at z 70 over the stack and had to shrink so no header stood under it. P11-14 (O-8, BACKLOG-66) retires that: the explain card is one
// card OF the stack (`lib/reader/windows.ts`) — a header when another card is in front, the front otherwise — so nothing stands over
// the others and there is nothing to make room for. What stays is the band every card stands in and the floor of the explain card.

/** The column's foot: the screen's bottom less the foot legend and a margin, but at least this much (`margin.ts`, `windows.ts`). */
export const COLUMN_FOOT_PX = 40;
export const COLUMN_LEGEND_MARGIN_PX = 8;

/** Where the column of floating windows ends: the screen's height less the legend (at the page's zoom) and its margin. */
export function columnBottomPx(viewportHeight: number, legend: number): number {
  return viewportHeight - Math.max(COLUMN_FOOT_PX, Math.ceil(legend) + COLUMN_LEGEND_MARGIN_PX);
}

/**
 * The least the explain card keeps in front when the stack is lifted to make room for it: its sticky header with the quote and its X
 * (140 px), its sticky controls row with the follow-up field and Send (101 px), and a few lines of the answer between them. Above the
 * card's own `CARD_MIN_HEIGHT` on purpose: at 120 px the two bars would overlap and cover each other's controls.
 */
export const DOCK_STACK_FLOOR_PX = 250;
