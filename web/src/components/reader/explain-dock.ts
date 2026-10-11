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
