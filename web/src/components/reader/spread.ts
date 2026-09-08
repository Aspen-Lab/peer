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
  "xl:grid xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] 2xl:grid-cols-[minmax(0,1fr)_560px] xl:gap-x-16 2xl:gap-x-24 xl:items-start";

/** The left panel: pinned while the reader scrolls the column (`reader-panel`
 *  in `globals.css`). */
export const PANEL_CLASS = "xl:min-w-0 xl:self-start xl:reader-panel";

/** The reading column: a flex column so the Next row can take the free space
 *  on a page shorter than the panel; `-mt-2` sets the abstract's first
 *  cap-height on the plate's top edge. */
export const COLUMN_CLASS = "xl:flex xl:flex-col xl:min-w-0 xl:self-stretch xl:-mt-2";
