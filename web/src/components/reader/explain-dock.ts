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
//   top = clamp(paragraphTop, DOCK_TOP_PX, windowHeight − DOCK_BOTTOM_PX − DOCK_MIN_VISIBLE_PX)
//
// so it never stands above the masthead's foot (it stays there while the paragraph is scrolled
// above it) and never so low that less than `DOCK_MIN_VISIBLE_PX` of it shows above the foot legend.
// Its height is its content, at most what is left between its top and the legend; it scrolls inside.
// P9-03b (ruling §1h.49; the owner: "level with the first line of the SELECTED paragraph"): `paragraphTop` is that of
// the paragraph the reader last selected — the explained one until another is selected. When a selection is offered
// (settled, never during a drag) in another paragraph the window moves there at once, with no close and no reflow
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

/** The dock's bottom edge stands this far above the window's: the foot legend's height (`--legend-h`). */
export const DOCK_BOTTOM_PX = 28;

/** P8-02: the dock's top stands no lower than this much of it still shows above the foot legend (its lowest
 *  top is the window's height less `DOCK_BOTTOM_PX` less this), so a paragraph far down the screen never
 *  leaves a window too short to read. */
export const DOCK_MIN_VISIBLE_PX = 160;

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
