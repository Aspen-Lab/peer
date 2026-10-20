// The reading spread. P11-10 (B P11-01 §2, §4 C2; ruling §1h.113 (a)): from 1024 css px (64rem) the paper's page is the three-pane shell
// (`reader-shell.tsx`: the left pane, the centre, the margin, with two dividers), and `useSpread` — the one switch between the one
// column and the spread — asks for that width. Below it the page is today's one column, byte for byte.
//
// What is left in this file below `SPREAD_QUERY` is the OLD two-column spread (the plate, title and decision in a panel on the left, the
// words in a column on the right, from xl = 80rem), kept only where it is still read: `SPREAD_GRID`, `PAGE_CLASS` and the caps
// (`XL_CAP_PX` ...) lay out the loading mat and the error states (`loading.tsx`, `page.tsx`'s `PageContainer width="spread"` sites), which
// are two columns from xl and have no shell. `SPREAD_GRID` stays while they use it.
//
// Retired (P11-16 follow-up, ruling §1h.115 item 5): `PANEL_CLASS`, `PANEL_STICKY_CLASS`, `PANEL_TAIL_CLASS` and `COLUMN_CLASS`, the old
// spread's panel, its sticky part and its reading column. `ReaderLayout` places its blocks in the shell's panes now (P11-16), and nothing
// imported them; `spread.test.ts` pins their absence.
//
// Plain module, no directive, so `loading.tsx` (a Server Component) can import the strings and lay its mat in the panel column with no JS.
//
// The flip is keyed to the window, not the article's width: a container query would re-place the whole page every time the sidebar
// toggles, and a shell action must never move the decision.

/** The three-pane shell's width: 64rem, 1024 css px at the browser's 16px root — `SHELL_MIN_VIEWPORT_PX` (`pane-layout.ts`), and the explain
 *  dock's minimum (`DOCK_MIN_VIEWPORT_PX`); a test holds the three together. It was 80rem, the old two-column spread's xl. */
export const SPREAD_QUERY = "(min-width: 64rem)";

/** The reader's horizontal inset. The vertical half moved to
 *  `PageContainer`'s `rhythm="reader"` (`py-8 sm:py-12 xl:pt-4`) — the same
 *  three values, in the component that owns every other page's rhythm.
 *
 *  That `xl:pt-4` is load-bearing: from xl the 48px masthead sits in flow
 *  above the article, and 48 + 16 = the panel's sticky top (4rem), so the
 *  stuck position is the first-paint position and the panel never slides.
 *  (It was pt-16 when the shell was a fixed sidebar that took no height.) */
export const PAGE_CLASS = "px-5 sm:px-6";

// Ruling 21 (round 7, item 7-07): the page-width caps of the old two-column spread, in one place so the CSS (`page-container.tsx`'s `spread`
// variant calc pair, pinned against these by `reading-prefs.test.ts`) and the loading mat cannot drift apart. (P11-10: Fit's zoom no
// longer reads them — `fitZoom` takes the three-pane shell's reference width — and the two breakpoint constants that only it read,
// `XL_BREAKPOINT_PX` and `TWO_XL_BREAKPOINT_PX`, are retired.)
//
// The spread's 1x page-width cap at each breakpoint: `page-container.tsx`'s
// `spread` variant reads `1072px` directly at xl
// (`calc(1072px*var(--reading-scale,1))`) and `504px+680px` = `1184px` at
// 2xl at the default (1x) reading scale
// (`calc(504px+680px*var(--reading-scale,1))` — a fixed panel share plus a
// flexible column share, not a flat `1184px*scale`, per S20's own comment on
// that file).
//
// The cap is the container's border box, so it holds the page's own 24px
// side padding too: at xl 1072 − 48 − 64 gap − 320 panel = a 640px column.
export const XL_CAP_PX = 1072;
export const TWO_XL_CAP_PX = 1184;
// At 2xl the cap is a linear pair, not a plain multiple: the panel's share
// (360px panel + 96px gap + 48px of page padding = 504px) is fixed and only
// the 680px reading track scales with the A/A step —
// `calc(504px + 680px * var(--reading-scale, 1))` in page-container.
// TWO_XL_CAP_PX is that pair at 1x (504 + 680).
export const TWO_XL_PANEL_PX = 504;
export const TWO_XL_COLUMN_PX = 680;

/** A narrow panel and a wide reading column.
 *
 *  The panel is a fixed track — 320px at xl, 360px from 2xl — because what it
 *  holds (the plate, the title, the commands) is a sidebar, not a page: it
 *  does not get better by getting wider. Every pixel the cap gives beyond it
 *  goes to the reading column, where the claim, the abstract, the report and
 *  the paper's own text are. At 1x that is a 640px column at xl and 680px from
 *  2xl; the A/A step grows the column, never the panel. */
export const SPREAD_GRID =
  "xl:grid xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)] xl:gap-x-16 2xl:gap-x-24 xl:items-start";
