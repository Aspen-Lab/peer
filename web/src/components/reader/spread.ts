// The reading spread. P11-10 (B P11-01 §2, §4 C2; ruling §1h.113 (a)): from 1024 css px (64rem) the paper's page is the three-pane shell
// (`reader-shell.tsx`: the left pane, the centre, the margin, with two dividers), and `useSpread` — the one switch between the one
// column and the spread — asks for that width. Below it the page is today's one column, byte for byte.
//
// What is left in this file below `SPREAD_QUERY` is the OLD two-column spread (the plate, title and decision in a panel on the left, the
// words in a column on the right, from xl = 80rem), kept only where it is still read:
//   - `SPREAD_GRID`, `PAGE_CLASS` and the caps (`XL_CAP_PX` ...) lay out the loading mat and the error states (`loading.tsx`, `page.tsx`'s
//     `PageContainer width="spread"` sites), which are two columns from xl and have no shell;
//   - `PANEL_CLASS`, `PANEL_STICKY_CLASS`, `PANEL_TAIL_CLASS` and `COLUMN_CLASS` are what `reader-layout.tsx` still imports until the blocks
//     move into the shell (P11-16 retires them with it). They carry `xl:` still, and the sticky rule they name (`reader-panel`) is gone from
//     globals.css — the pane rule (`.reader-left`) replaced it — so until then the spread side of `ReaderLayout` is a plate-first stack of
//     plain blocks below 1280 and an unpinned two-column grid above it.
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

/** The left panel (P10-04b): no longer the sticky element itself. It stretches over the row (`self-stretch`),
 *  so the sticky part inside it (`PANEL_STICKY_CLASS`) has the whole column's height to travel in, and stacks
 *  its head — the plate, the title, the decision — as a flex column, as the old sticky panel did. The head is
 *  in normal flow and scrolls away with the page.
 *
 *  `xl:flex-col xl:flex`, in that order, on purpose: `reader-layout.order.test.tsx` finds the reading column
 *  by the first `xl:flex xl:flex-col` in the markup, and the panel comes first. */
export const PANEL_CLASS = "xl:min-w-0 xl:self-stretch xl:flex-col xl:flex";

/** The panel's sticky part (P10-04b, A8): pinned under the masthead while the reader scrolls the column,
 *  window-bounded, scrolling inside only when it is taller than the room (`reader-panel` in `globals.css`).
 *  It is the tab strip and the map; for a paper with no body, the head. */
export const PANEL_STICKY_CLASS = "xl:reader-panel";

/** The sticky part when it holds the strip and the map: the strip's own 32px top gap is the holder's
 *  (`reader-layout.tsx`), so a stuck strip stands at the masthead's foot with no gap above it.
 *
 *  P10-21 (A P10-14 §8 item 7): `xl:-mb-3`. At the very foot of the page the sticky part stops where its holder ends,
 *  and the holder ends 64 px above the window's bottom at 1280 x 720, so the part (612 px tall there) stopped with its
 *  top at 43.9 px — 4 px under the masthead's bottom (48 px), the strip's top edge hidden. A sticky element stops
 *  when its margin box meets the holder's end; a bottom margin of -12 px lets it end 12 px below the holder, in the
 *  page's own bottom room, so its top is 55.9 px there and the strip is never under the masthead. */
export const PANEL_TAIL_CLASS = `${PANEL_STICKY_CLASS} xl:-mb-3 xl:[&>:first-child]:mt-0`;

/** The reading column: a flex column so the Next row can take the free space
 *  on a page shorter than the panel.
 *
 *  The column is the measure on the spread — it is sized for the text, about
 *  90 characters of Newsreader at the lead size, and it grows with the A/A
 *  step — so the prose measures inside it (`measure`, `measure-paper`) are
 *  lifted: kept, each line would stop short of the column's edge and leave a
 *  gutter inside the column. `!` because `.measure-paper` is unlayered CSS in
 *  globals.css, which outranks any utility. Below xl every measure holds.
 *
 *  The first block's own top gap is dropped, so whatever opens the column —
 *  the claim's band, the skim deck, a TL;DR — starts level with the plate. */
export const COLUMN_CLASS =
  "xl:flex xl:flex-col xl:min-w-0 xl:self-stretch xl:[&_.measure]:max-w-none! xl:[&_.measure-paper]:max-w-none! xl:[&>:first-child>:first-child]:mt-0 xl:[&>:first-child>:first-child>:first-child]:mt-0";
