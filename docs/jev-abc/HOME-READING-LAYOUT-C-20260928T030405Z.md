# HOME-READING-LAYOUT — C checkpoint

STATUS: IMPLEMENTED_PENDING_REVIEW

Item: HOME-READING-LAYOUT (ABC-JEV-INTEGRATION.md §1ag). Branch
`Jev-integration-and-sorting-filtering-enhancement`. Dev server already
running on http://localhost:3000 (user's — not restarted, not stopped).
Repro/verification used a separate, dedicated in-app browser tab
("tab-1"), not the user's browser and not signed in — opened after
noticing the tool's default tab ("seed") was already mid-navigation from
what looks like another concurrent agent in this same ABC round
(GOOGLE-SIGNIN/SIGNIN-MERGE/TAB-ICON-THEME checkpoints all landed within
the same few minutes; `git status` shows their in-progress edits to
`layout.tsx`, `account-section.tsx`, `use-auth-user.ts`, `privacy/page.tsx`,
`tab-icon.ts`, none of which overlap the files this item touches).

## Read first (done)

- ABC-JEV-INTEGRATION.md §1ag — user's screenshot: "YOUR READING" band is a
  ~120px column, tiny graph, word-by-word legend; no upload/search pair on
  that row; manager's UNVERIFIED reading: the strip is a shrink-to-fit flex
  item in `flex flex-wrap items-start justify-between`, while `LibraryGraph`
  measures its own container's `clientWidth` via `ResizeObserver`.
- `web/src/app/page.tsx` — the row (~316-329): `ReadingStrip` /
  `UploadButton` + `SearchBox` pair. `ReadingStrip` (~408-468) builds the
  graph and renders `<Band label="Your reading" gap="none"><LibraryGraph/></Band>`,
  returns `null` when `graph.counts.read + graph.counts.saved === 0`.
- `web/src/components/charts/library-graph.tsx` — `wrapRef` div (the
  outermost element, `"relative cropmarks grain bg-surface shadow-card
  overflow-hidden"`) has **no explicit width class**. A `ResizeObserver`
  effect (~line 264) measures `el.clientWidth` and sets `size`; the `<svg>`
  is only rendered once `size` is set, at exactly that measured width;
  before that, a `<div style={{height:320}} aria-hidden />` placeholder
  (also no width) stands in. Height formula: `w<520(NARROW) ? min(560,
  max(380, w*1.35)) : min(440, max(300, w*0.42))`.
- `web/src/components/ui/band.tsx` — `Band`'s `<section>` has no width
  class either; it forwards `className` (merged via `cn`/tailwind-merge) —
  usable to inject a width utility from the call site. Not edited (kept
  generic; the width belongs to this one call site's row).
- `web/src/components/briefing/{search-box,upload-button}.tsx` — the pair:
  `UploadButton` is a fixed `h-9 w-9` square; `SearchBox`'s `<form>` is
  `w-full sm:w-[280px]` (i.e. on a phone it wants 100% of its own small
  flex wrapper, not a fixed px value).
- `git log -p -S"justify-between" origin/main -- web/src/app/page.tsx`:
  commit 640c55ec "keep the upload + search pair on the right when
  ReadingStrip is empty" added `ml-auto` to the pair's wrapper div, because
  `ReadingStrip` renders nothing (`null`) for an empty library and a lone
  child under `justify-between` sits at flex-start. Before that (commit
  9be179ec, "feat: library graph"), the same slot held `ReadingCalendar` +
  `LibraryLegend` in a *different* row (`flex flex-wrap items-end
  justify-between gap-x-10 gap-y-5`) — `ReadingCalendar` does not measure a
  container width via ResizeObserver, so this collapse could not happen
  with the old chart. `LibraryGraph`'s container-relative sizing is what
  introduced the possibility, and it only renders once `graph.counts.read +
  saved > 0` — i.e. only after a reader has actually read/kept something.
  Consistent with "it did not look like this before": before the user had
  reading history, this band never rendered at all.
- `web/AGENTS.md` → read Next's own docs before code edits; no
  App-Router-specific API used in the fix.

## Step 0 — reproduction (confirmed by execution)

Seeded this automation browser's `localStorage["peer-feed"]` (anonymous,
not the user's browser/account) with one fake `LibraryEntry` (id
`seed:layout-repro-1`, `terms: ["battery materials"]`, `readAt:
"2026-09-01"`) plus matching `readItems`/one fake `papers[0]` entry —
shape read from `store/feed.ts`'s `partialize`/`version: 3` and
`lib/library/graph.ts`'s `LibraryEntry` interface. `<StoreHydrator/>`
(`store-hydrator.tsx`) rehydrates from `localStorage` on mount
(`skipHydration: true` + `persist.rehydrate()` in an effect), so a
reload was enough to pick it up. The app's own auto-load then usually
replaced the single fake "today" paper with the real 10-paper starter
sample (`papers.length` still > 0 either way) while keeping the seeded
`library`/`readItems` — both are fine for reproducing this bug; only a
full fetch failure (an occasional live-rate-limit empty result, seen once
mid-session and unrelated to this bug) would suppress the row entirely.

**Confirmed, both by screenshot and by exact `getBoundingClientRect()`
measurements, at 1440px light:**
- Row (`.mt-6.flex.flex-wrap...`) width 1232px, at x=100.
- Band section (`ReadingStrip`'s `<section>`, class was `""` before the
  fix): **117px** wide, 412px tall.
- `LibraryGraph`'s `.cropmarks` wrapper: same 117×380 (matches the height
  formula exactly for `w=117<520`).
- Readout text wrapped to 3 lines ("1 READ · 0" / "TODAY" / "3 TERMS" /
  etc. depending on state) instead of one line — this is the "word-by-word
  legend" the user saw; `LibraryLegend`'s five items each landed on their
  own line too, for the same reason (its `flex flex-wrap` container was
  only 117px wide).
- Same collapse in dark theme (screenshot taken).
- At 375px phone width the collapse was less total (~232px measured) but
  still not full-width, with the legend still wrapping more than
  necessary.

**Upload + search pair:** measured, NOT missing. At 1440px: upload button
`36×36` at x=1008,y=204; search form `280×36` at x=1052,y=204; pair's
right edge (1332) = row's right edge exactly (640c55ec's contract holds).
Both fully on-screen, non-zero size, not clipped or covered by anything.
Conclusion: the pair was never actually invisible in the DOM/layout at any
width I tested — the user's "no pair visible" almost certainly reads off a
screenshot where a ~117px sliver of graph dominates attention and the pair
sits far away in the top-right corner of a very wide, very tall (412px)
box, easy to miss without measuring; fixing the collapse (below) also
fixes this — the pair now sits directly beside a graph that fills the row,
not stranded in a corner. This is the "or show it IS visible and the
screenshot was misleading" branch — recorded, not swept under the rug: A
should re-check this call.

## Fix

`web/src/app/page.tsx`:
1. The `ReadingStrip` element at the row (papers.length > 0 branch) now
   gets `className="flex-auto min-w-0"`, forwarded through a new optional
   `className` prop on `ReadingStrip` straight to `Band`'s own existing
   `className` prop (`Band`/`band.tsx` untouched — it already merges
   `className` via `cn`).
2. `ReadingStrip` is now `export`ed (was module-private) so the regression
   test below can render it directly, the same pattern
   `saved/page.test.tsx` already uses for `SavedPageView` — no other
   behaviour change.

**First attempt used bare `flex-1` (Tailwind's `flex: 1 1 0%`) — WRONG,
caught by the phone-width check before this was called done:**
at 375px it made the upload/search pair overlap the (now 0px-wide) graph
instead of wrapping below it, confirmed by `getComputedStyle`:
`flexBasis: "0%"`, `bandRect.w: 0`, `pairDivRect` sharing the same row/y as
the crushed band. Root cause: `flex-wrap`'s own per-line-fits test uses
each item's flex-basis as its "hypothetical size" for that test — a `0%`
basis tells that test "this item needs no room", so the browser stopped
wrapping the pair to its own line (it used to, when the item's implicit
basis was its auto/content size, ~130px from the "Your reading" label) and
instead squeezed both onto one line, leaving the flex-grow'd band nothing
to grow into and `min-w-0` letting it collapse the rest of the way to
zero. **Fixed by switching to `flex-auto` (`flex: 1 1 auto`)** — same
grow/shrink behaviour, but the basis starts from the label's own content
size, so the phone-width wrap decision is exactly what it was before this
item ever touched the file; `min-w-0` is kept so the band can still shrink
below the label's width on some in-between width that DOES fit both on one
line. Verified by execution after the switch (see below), not just by
re-reading the CSS.

## Before / after (screenshots, in-browser, not committed)

- **1440×900, light, before:** narrow ~117px "YOUR READING" column, 3-line
  stacked readout, 5-line stacked legend, big empty gap, pair small in the
  top-right corner.
- **1440×900, light, after:** band 884px wide (= 1232 row − 324 pair − 24
  gap, exact), graph fills it with real force-laid nodes/chips visible
  ("MOLECULAR BIOLOGY", "MACHINE LEARNING", …), readout one line ("1 read ·
  9 today · 3 terms · 11 links"), legend one line, pair unchanged at the
  right, now visually part of the same row instead of stranded.
- **1440×900, dark, after:** same shape, dark palette, one line
  readout/legend, pair visible top-right. (confirmed both before and after)
- **375×812, light, before:** collapsed graph ~232px of ~279px available,
  legend still wrapping more than content requires, pair correctly wrapped
  below on its own line (this narrower case was never as broken as
  desktop).
- **375×812, light, after `flex-1` (rejected):** band crushed to 0px wide,
  pair overlapping the "Your reading" label — a regression, caught before
  finishing.
- **375×812, light, after `flex-auto` (final):** band 327px = full row
  width, readout one line ("1 read · 9 today · 3 terms"), legend wraps to
  3 sensible lines (real wrap from limited width, not the collapse
  artifact), pair correctly wrapped to its own line below with a normal
  16px (`gap-y-4`) gap, no overlap — measured: band bottom y=680, pair top
  y=696.
- **Empty-library regression check (papers.length>0, library/readItems
  cleared):** `ReadingStrip` renders nothing, band absent entirely, pair
  still pinned at the row's right edge via `ml-auto` — 640c55ec's contract
  intact.

## Tests

`web/src/app/page.test.tsx` (new — this repo has no harness for rendering
the whole `DailyBriefingPage`/default export, per the existing P4-S5b-FIX2
comment in page.tsx: it depends on auth-settle timing, batch
acknowledgement, the paper digest loader and other effects nothing in this
repo mocks today; jsdom/ResizeObserver are also not available —
`vitest.shared.ts` runs `environment: "node"`). Followed
`saved/page.test.tsx`'s existing pattern instead: mock `@/store/feed`,
`@/store/profile`, `next/navigation`, then `renderToStaticMarkup` just the
now-exported `ReadingStrip` and assert on its class string / null output.
Confirmed RED before the fix (`ReadingStrip` not exported →
`Element type is invalid: ... got: undefined`), GREEN after both the
`flex-auto`/`min-w-0` classes and the `export` were added. Two cases:
band carries `class="flex-auto min-w-0"` when the library is non-empty;
renders literally nothing when it is empty (regression guard for
640c55ec).

## Gates (from `web/`)

- `npx vitest run src/app/page.test.tsx` — red before the fix (import
  error), green after.
- `npx vitest run` (full suite) — **270 files passed, 3 skipped; 4899
  tests passed, 6 skipped; 0 failed.**
- `npx tsc --noEmit` — clean, no output.
- `npx eslint .` — **0 errors, 149 warnings — baseline unchanged** (same
  count as before this change; the 6 pre-existing warnings visible in the
  tail of the run are all in unrelated files).
- `npm run build` — succeeds; all 30 static pages generated; one
  pre-existing Turbopack warning ("Encountered unexpected file in NFT
  list", traced through `src/lib/papers/pdf-text.ts` →
  `api/papers/upload/route.ts`) — unrelated to this change (neither file
  touched here), present independent of this fix.

## Scope

Only `web/src/app/page.tsx` (edited) and `web/src/app/page.test.tsx`
(new). `band.tsx`, `library-graph.tsx`, `search-box.tsx`,
`upload-button.tsx`, `store/feed.ts` read-only, confirmed unmodified in
`git status`. Did not touch `layout.tsx` or any theme-favicon component
(TAB-ICON-THEME C's lane) — confirmed via `git status` those are already
modified/untracked by someone else, untouched by this session. No commits,
no push, no `.env*` opened, no writes into `peer-followup`.
