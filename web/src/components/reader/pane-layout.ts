// The reader's three panes, as numbers (P11-10; B P11-01 §2.2 and §2.6; ruling §1h.113 (a)).
//
// From a window of 1024 css px the paper's page is one full-width shell: the left pane (the title, the commands, the tabs, the map),
// the centre (the paper's text) and the margin (an empty slot the cards stand in), with a divider between each pair. This file is the
// arithmetic of that shell and nothing else — no DOM, no React, no storage — so the shell, the dividers and the store share one
// set of numbers, and a test can hold each of them.
//
//   | left pane | 12 | centre              | 12 | margin    |
//   | 240 … 480 |    | at least 440        |    | 280 … 560 |
//   | (320, 360 |    | (a constant, not    |    | (360)     |
//   |  from 1536)|   |  scaled by A / A)   |    |           |
//
// Every width here is in UNZOOMED css px: the layout's own, what `offsetWidth` reads. Fit's CSS `zoom` (`usePageZoom`) scales the page
// as a whole, so a pointer's distance in window px is divided by `--page-zoom` before it gets here (`pane-divider.tsx`).
//
// Widths are remembered per browser (`store/reader-panes.ts`) and never overwritten by what the window forces: `fitPanes` is the
// WINDOW's answer to the remembered widths, recomputed on every resize, so a bigger window gives the remembered widths back.
//
// A first visit is pinned at every width the shell exists in (ruling §1h.115 item 4, amending D6): the narrowest panes pinned need 984 px, so
// the panes fit from 1024, the margin and then the left pane giving way as the window narrows (320 · 440 · 309 at 1093, 280 · 440 · 280 at 1024).
// The rail is the reader's choice, and the window's only below the shell.
//
// The margin is never collapsible (ruling §1h.113: D7) — a margin that came and went would re-wrap the paper under the reader's pointer
// at the moment they select — so there is no collapsed flag for it anywhere; only the left pane has a rail.

/** From this window width the paper's page is the three panes; below it, today's one column. It is the explain dock's own minimum
 *  (`DOCK_MIN_VIEWPORT_PX`, `explain-dock.ts`; a test holds the two equal): the margin exists exactly where the dock existed. */
export const SHELL_MIN_VIEWPORT_PX = 1024;

/** The left pane's narrowest, widest and default width. From `LEFT_WIDE_VIEWPORT_PX` the default is the wider track, as the old
 *  spread's panel was (320 at xl, 360 from 2xl). */
export const LEFT_MIN_PX = 240;
export const LEFT_DEFAULT_PX = 320;
export const LEFT_DEFAULT_WIDE_PX = 360;
export const LEFT_WIDE_VIEWPORT_PX = 1536;
export const LEFT_MAX_PX = 480;

/** The centre's least width: about 58 characters of Newsreader at the lead size. A constant, independent of the A / A step. */
export const CENTRE_MIN_PX = 440;

/** The margin's narrowest, widest and default width. 360 is the dock's width (`DOCK_WIDTH_PX`): the cards keep the size they were
 *  designed at. */
export const MARGIN_MIN_PX = 280;
export const MARGIN_DEFAULT_PX = 360;
export const MARGIN_MAX_PX = 560;

/** The left pane when it is collapsed: one icon button's column, as Claude's collapsed sidebar. */
export const RAIL_PX = 48;

/** A divider's hit area (its line is 1 px, drawn in the middle). */
export const DIVIDER_PX = 12;

/** The arrow keys' step on a divider, and with Shift. */
export const KEY_STEP_PX = 16;
export const KEY_STEP_SHIFT_PX = 64;

/** The two panes a reader can resize. */
export type PaneName = "left" | "margin";

export interface PaneRange {
  min: number;
  max: number;
}

/** The window and the other pane, for a range that keeps the centre at its minimum. `other` is the other pane's TRACK (`RAIL_PX`
 *  for a collapsed left pane). */
export interface PaneRoom {
  viewport: number;
  other: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A pane's default width in this window: the left pane's is wider from 1536 css px. */
export function defaultPanePx(pane: PaneName, viewport?: number): number {
  if (pane === "margin") return MARGIN_DEFAULT_PX;
  return finite(viewport) && viewport >= LEFT_WIDE_VIEWPORT_PX ? LEFT_DEFAULT_WIDE_PX : LEFT_DEFAULT_PX;
}

/**
 * The widths a pane may take: its own bounds, and — when the window and the other pane are given — no wider than leaves the centre
 * its minimum. The range never inverts: where the room is less than the pane's own minimum, the minimum stands (the centre gives
 * way last, and only in a window narrower than the shell exists in).
 */
export function paneRange(pane: PaneName, room?: PaneRoom): PaneRange {
  const own: PaneRange = pane === "left" ? { min: LEFT_MIN_PX, max: LEFT_MAX_PX } : { min: MARGIN_MIN_PX, max: MARGIN_MAX_PX };
  if (!room || !finite(room.viewport) || !finite(room.other)) return own;
  const left = Math.floor(room.viewport - room.other - 2 * DIVIDER_PX - CENTRE_MIN_PX);
  return { min: own.min, max: Math.max(own.min, Math.min(own.max, left)) };
}

/** A width inside its pane's range, in whole px. Something that is not a number is the pane's default. */
export function clampPane(pane: PaneName, width: number, room?: PaneRoom): number {
  const { min, max } = paneRange(pane, room);
  const wanted = finite(width) ? Math.round(width) : defaultPanePx(pane, room?.viewport);
  return Math.min(max, Math.max(min, wanted));
}

/**
 * What a key does to a divider, as the pane's new width — or null for a key the divider does not take. The arrows move the BOUNDARY the
 * way they point, so ArrowRight widens the left pane and narrows the margin, ± 16 px (± 64 with Shift); Home and End are the pane's
 * least and greatest width (the WAI-ARIA window splitter: the primary pane is the one `aria-valuenow` reports); Enter is its default.
 */
export function stepPane(pane: PaneName, width: number, key: string, shift: boolean, room?: PaneRoom): number | null {
  const step = shift ? KEY_STEP_SHIFT_PX : KEY_STEP_PX;
  const sign = pane === "left" ? 1 : -1;
  const from = finite(width) ? width : defaultPanePx(pane, room?.viewport);
  switch (key) {
    case "ArrowRight":
      return clampPane(pane, from + sign * step, room);
    case "ArrowLeft":
      return clampPane(pane, from - sign * step, room);
    case "Home":
      return paneRange(pane, room).min;
    case "End":
      return paneRange(pane, room).max;
    case "Enter":
      return clampPane(pane, defaultPanePx(pane, room?.viewport), room);
    default:
      return null;
  }
}

/** What the reader remembered, and the window. Any of the three may be absent. */
export interface PaneRequest {
  viewport: number;
  /** The left pane's remembered width. */
  left?: number;
  /** The margin's remembered width. */
  margin?: number;
  /** Whether the reader pinned the left pane. Absent on a first visit: pinned (ruling §1h.115 item 4). */
  leftPinned?: boolean;
  /** A reader can omit the reserved margin and let tools float over the page. */
  hasMargin?: boolean;
}

export interface PaneFit {
  /** The left pane's width as a column. Kept when the pane is the rail: it is what the peek opens at. */
  left: number;
  /** The left pane's grid track: `left` pinned, `RAIL_PX` as the rail. */
  leftTrack: number;
  margin: number;
  /** What the window leaves the centre. */
  centre: number;
  /** The left pane is a column; false is the rail. */
  pinned: boolean;
  /** The rail is the window's doing: the pane is wanted pinned (the reader's pin, or a first visit) and even the narrowest panes do not
   *  fit — which happens only below the shell. */
  forced: boolean;
}

/**
 * The window's answer to the remembered widths. Pure; the remembered values are never touched, so a bigger window restores them.
 *
 *   1. each width is clamped to its own range;
 *   2. where the left pane pinned, the margin, the centre's minimum and the dividers do not fit the window, the margin gives way
 *      toward its minimum, then the left pane toward its;
 *   3. if even that is not enough, the left pane is the rail — the pin is kept (`forced`) — and the margin gives way again.
 *
 * A first visit (no choice yet) wants the pane pinned, so inside the shell it is pinned at every width; only the reader's own fold is the rail.
 *
 * Inside the shell (1024 up) step 2 always answers: 240 + 280 + 440 + 24 = 984. The centre is never below `CENTRE_MIN_PX` there.
 */
export function fitPanes(request: PaneRequest): PaneFit {
  const viewport = finite(request.viewport) ? request.viewport : SHELL_MIN_VIEWPORT_PX;
  const gutters = 2 * DIVIDER_PX;
  const wantLeft = clampPane("left", finite(request.left) ? request.left : defaultPanePx("left", viewport));
  const wantMargin = clampPane("margin", finite(request.margin) ? request.margin : MARGIN_DEFAULT_PX);
  const wantPinned = request.leftPinned ?? true;

  if (request.hasMargin === false) {
    const available = Math.max(LEFT_MIN_PX, viewport - DIVIDER_PX - CENTRE_MIN_PX);
    const left = Math.min(wantLeft, available);
    const pinned = wantPinned && viewport >= LEFT_MIN_PX + DIVIDER_PX + CENTRE_MIN_PX;
    const leftTrack = pinned ? left : RAIL_PX;
    return { left, leftTrack, margin: 0, centre: Math.max(0, viewport - leftTrack - DIVIDER_PX), pinned, forced: wantPinned && !pinned };
  }

  if (wantPinned) {
    let over = wantLeft + wantMargin + CENTRE_MIN_PX + gutters - viewport;
    const margin = wantMargin - Math.min(Math.max(over, 0), wantMargin - MARGIN_MIN_PX);
    over -= wantMargin - margin;
    const left = wantLeft - Math.min(Math.max(over, 0), wantLeft - LEFT_MIN_PX);
    over -= wantLeft - left;
    if (over <= 0) {
      return { left, leftTrack: left, margin, centre: viewport - left - margin - gutters, pinned: true, forced: false };
    }
  }

  const over = RAIL_PX + wantMargin + CENTRE_MIN_PX + gutters - viewport;
  const margin = wantMargin - Math.min(Math.max(over, 0), wantMargin - MARGIN_MIN_PX);
  return {
    left: wantLeft,
    leftTrack: RAIL_PX,
    margin,
    centre: Math.max(0, viewport - RAIL_PX - margin - gutters),
    pinned: false,
    forced: wantPinned,
  };
}
