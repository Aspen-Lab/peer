// The reading spread: from xl the paper's page is two columns — the plate,
// title and decision in a panel on the left, the paper's words and Peer's
// additions in a reading column on the right. Below xl it is today's one
// column, byte for byte.
//
// Plain module, no directive, so `loading.tsx` (a Server Component) can
// import the strings and lay its mat in the panel column with no JS.
//
// One query in two places: `useSpread` chooses the DOM structure with
// `SPREAD_QUERY`, and the classes below carry `xl:` for the same width
// (Tailwind's `--breakpoint-xl: 80rem`, `node_modules/tailwindcss/theme.css`,
// not overridden in `globals.css`). If the CSS and the React re-render
// disagree for one frame during a window resize, the wrappers degrade to
// plain blocks instead of a half-applied grid. Keep the two in step.
//
// The flip is keyed to the window, not the article's width: a container
// query would re-place the whole page every time the sidebar toggles at
// 1024–1279, and a shell action must never move the decision.

export const SPREAD_QUERY = "(min-width: 80rem)";

// Ruling 21 (round 7, item 7-07): the pixel breakpoints and page-width caps
// this reader's spread is built from, in one place so the CSS
// (`page-container.tsx`'s `spread` variant calc pair, pinned against these
// by that file's own test) and Fit's own zoom formula (`reading-prefs.ts`'s
// `fitZoom`) cannot drift apart the way they did before A7b-01/A7b-02 (round
// 7, closing) — those found Fit's old *measured* 1x width going stale after
// "Larger/Smaller text" and non-zoom-invariant after a resize while already
// fitted. `fitZoom` now *computes* the 1x width from these numbers instead
// of measuring a live DOM element.
//
// 1280px/1536px are Tailwind's own default `xl`/`2xl` breakpoints (80rem/
// 96rem at the browser's default 16px root — `SPREAD_QUERY` above is the
// same 80rem as a media-query string); restated here as plain numbers
// because `fitZoom` needs them as arithmetic, not as a CSS breakpoint.
export const XL_BREAKPOINT_PX = 1280;
export const TWO_XL_BREAKPOINT_PX = 1536;

// The spread's 1x page-width cap at each breakpoint: `page-container.tsx`'s
// `spread` variant reads `1000px` directly at xl
// (`calc(1000px*var(--reading-scale,1))`) and `640px+560px` = `1200px` at
// 2xl at the default (1x) reading scale
// (`calc(640px+560px*var(--reading-scale,1))` — a fixed panel share plus a
// flexible column share, not a flat `1200px*scale`, per S20's own comment on
// that file). `fitZoom` evaluates the same pair (TWO_XL_PANEL_PX +
// TWO_XL_COLUMN_PX * scale) so Fit lands on 85% at every A/A step.
export const XL_CAP_PX = 1000;
export const TWO_XL_CAP_PX = 1200;
// At 2xl the cap is a linear pair, not a plain multiple: the panel's share
// (640px) is fixed and only the 560px reading track scales with the A/A
// step — `calc(640px + 560px * var(--reading-scale, 1))` in page-container.
// TWO_XL_CAP_PX is that pair at 1x (640 + 560). fitZoom uses the pair.
export const TWO_XL_PANEL_PX = 640;
export const TWO_XL_COLUMN_PX = 560;

/** The article's padding. From xl the 48px masthead sits in flow above the
 *  article, and 48 + 16 = the panel's sticky top (4rem), so the stuck position
 *  is the first-paint position and the panel never slides. (It was pt-16 when
 *  the shell was a fixed sidebar that took no height.) */
export const PAGE_CLASS = "px-5 sm:px-6 py-8 sm:py-12 xl:pt-4";

/** 5/7 columns at xl, where the reading column lands on the measure with a
 *  rag margin and no more.
 *
 *  From 2xl the reading column stops growing — the measure does not get wider
 *  because the window did, and at 1920 the old proportional grid put a fifth
 *  of the page inside the column as empty gutter. The track is fixed at 560px
 *  there and every extra pixel goes to the panel, so a wide screen buys a
 *  bigger figure and a title with more room, not a longer line. */
export const SPREAD_GRID =
  "xl:grid xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] 2xl:grid-cols-[minmax(0,1fr)_calc(560px*var(--reading-scale,1))] xl:gap-x-16 2xl:gap-x-24 xl:items-start";

/** The left panel: pinned while the reader scrolls the column (`reader-panel`
 *  in `globals.css`). */
export const PANEL_CLASS = "xl:min-w-0 xl:self-start xl:reader-panel";

/** The reading column: a flex column so the Next row can take the free space
 *  on a page shorter than the panel; `-mt-2` sets the abstract's first
 *  cap-height on the plate's top edge. */
export const COLUMN_CLASS = "xl:flex xl:flex-col xl:min-w-0 xl:self-stretch xl:-mt-2";
