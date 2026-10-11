// The "Explain this?" conversation as a dock (P7-15; the owner's R7, ruling Q4).
//
// From a window of 1024 px the box is not a card at the selection but a window
// fixed at the right edge of the screen: flush with the edge, 360 px wide, its
// top under the masthead and its bottom above the foot legend, scrolling inside.
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

/** The dock's top: the sticky masthead's height (`h-12`). */
export const DOCK_TOP_PX = 48;

/** The dock's bottom edge stands this far above the window's: the foot legend's height (`--legend-h`). */
export const DOCK_BOTTOM_PX = 28;

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
