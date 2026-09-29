# HOME-READING-LAYOUT — A checkpoint

STATUS: VERIFIED

Item: HOME-READING-LAYOUT (ABC-JEV-INTEGRATION.md §1ag). Branch
`Jev-integration-and-sorting-filtering-enhancement`. Reviewing C's checkpoint
`docs/jev-abc/HOME-READING-LAYOUT-C-20260928T030405Z.md` (fix: `ReadingStrip`
gets a new optional `className` prop, wired at the call site to
`"flex-auto min-w-0"`; `ReadingStrip` also changed from module-private to
`export`ed). I implemented nothing in this item; verifying only. Files in
scope for judgment: `web/src/app/page.tsx`, `web/src/app/page.test.tsx`. Dev
server already running on http://localhost:3000 (user's — not restarted, not
stopped). Using a dedicated in-app browser tab, not the user's browser.

## Snapshot (before touching anything)

```
git status --porcelain -- web/src/app/page.tsx web/src/app/page.test.tsx
 M web/src/app/page.tsx
?? web/src/app/page.test.tsx

SHA256:
0c2440bd593768cc25e5893a0477f6e143dd9b774a0ad351897c2c05aacd14f8  web/src/app/page.tsx
8b6a967266118ffb74823863325bcfa3266d446e205a3db586d01a465b89b319  web/src/app/page.test.tsx

Current branch: Jev-integration-and-sorting-filtering-enhancement
```

## Read first (done)

- ABC-JEV-INTEGRATION.md §1ag (line 270): user's screenshot — "YOUR READING"
  band ~120px column, tiny graph, word-by-word legend, no upload/search pair
  visible on that row, "it was not like this before". Manager's UNVERIFIED
  reading: shrink-to-fit flex item + `LibraryGraph`'s own ResizeObserver
  clientWidth measurement. Ruling: C reproduces first, gives the strip a real
  width without breaking the empty-library case (640c55ec), finds out why the
  pair looked invisible, screenshots desktop+phone, tests where feasible.
- C's checkpoint (`HOME-READING-LAYOUT-C-20260928T030405Z.md`) read in full.
  Claims to verify: (1) reproduced the collapse at 117px/1440px light + dark +
  375px phone with `getBoundingClientRect`; (2) upload+search pair was NOT
  missing, just easy to miss (measured 36x36 / 280x36, right edge matches
  row's right edge, 640c55ec's contract held even in the broken state); (3)
  first attempt `flex-1` regressed at phone width (pair overlapping a 0px-wide
  band) — root-caused to `flex-1`'s zero flex-basis defeating `flex-wrap`'s
  per-line fit test — corrected to `flex-auto` + `min-w-0`; (4) tests added in
  `page.test.tsx` render just the exported `ReadingStrip` to static markup
  (no jsdom/ResizeObserver in this repo's node test env); (5) gates all green,
  270 files / 4899 tests passed.
- `git show 640c55ec -- web/src/app/page.tsx`: confirmed — that commit added
  `ml-auto` to the pair's wrapper div only, nothing to `ReadingStrip`.
- `git show origin/main:web/src/app/page.tsx`: confirmed byte-for-byte
  structural match to C's "before" description — row is
  `<div className="mt-6 flex flex-wrap items-start justify-between gap-x-6
  gap-y-4">`, `ReadingStrip` called with NO `className`/width prop at all
  (`<ReadingStrip papers={papers} readerTopics={...} />`), and
  `ReadingStrip` itself renders `<Band label={READING_STRIP.heading}
  gap="none">` — also no className. So on main, the band has always been a
  bare shrink-to-fit flex item with no width override; this branch's
  pre-fix `page.tsx` was byte-identical in this region (per the manager's
  own evidence note in §1ag), so the bug is inherited from main, not
  introduced by this branch — consistent with C's account, not yet
  independently reproduced live (next section).

## Checks

Plan: reproduce old collapse via devtools reasoning + live measurement,
verify fixed layout at 1440px and 375px (both themes), verify empty-library
contract, confirm the pair's visibility/sizing, mutation-test the vitest
file, run full gates, then clean up seeded data.

Browser setup: opened a fresh dedicated tab (`tab-2`) at localhost:3000, not
the tool's default "seed" tab (already in use by a concurrent agent) and not
`tab-3` (another concurrent agent's tab, seen navigating to /profile during
this session). C's `seed:layout-repro-1` was NOT present in this shared
browser's localStorage when I started (`peer-feed`.state.library was already
`{}`, version 3) — either C cleaned it up or something else reset it; either
way I seeded my own entry under the same id (same shape as C's and as
`page.test.tsx`'s mock: `LibraryEntry` with `id/title/venue/readAt/filed/
terms`), confirmed against `web/src/lib/library/graph.ts`'s real interface
first.

## Check 1 — reproduce the old collapse: PASS (verified by reading, not by
executing a broken build — see rationale)

`git show origin/main:web/src/app/page.tsx`: confirmed byte-for-byte —
`<ReadingStrip papers={papers} readerTopics={...} />` (NO className/width
prop existed on this component at all on main) inside
`<div className="mt-6 flex flex-wrap items-start justify-between gap-x-6
gap-y-4">`, and `ReadingStrip` itself rendered `<Band label={...}
gap="none">` with no className either. `git show 640c55ec` confirms that
commit touched ONLY the pair's wrapper div (`ml-auto`), never `ReadingStrip`.
This matches C's account exactly: a bare flex item with no width control,
whose child `LibraryGraph` sizes itself from its own wrapper's
`clientWidth` via `ResizeObserver` (confirmed in
`web/src/components/charts/library-graph.tsx`) — a shrink-to-fit / min-content
trap. I did not re-inflict this on the live app (would require editing the
tracked file, forbidden by my rules); reasoning from origin/main's markup
plus C's own executed repro (117px/1440px, screenshotted, `getBoundingClientRect`-
measured) is accepted as sufficient reproduction evidence, cross-checked
against independent code reading rather than taking C's word for it.

## Check 2 — fixed layout at 1440px, light + dark: PASS (own measurements)

Seeded library (1 read entry) + real 10-paper starter feed, tab-2 fronted,
1440x900:
- Light: row `x=100,w=1232`; band (`ReadingStrip`'s section) `x=100,y=196,
  w=884,h=403`, computed `flexGrow=1,flexShrink=1,flexBasis=auto,minWidth=0px`,
  className exactly `"flex-auto min-w-0"`. `884 = 1232 - 324(pair) - 24(gap-x-6)`
  — exact. `.cropmarks` wrapper and its `<svg>` both exactly `884x371`
  (matches the `w<520 ? … : min(440,max(300,w*0.42))` formula: `884*0.42=371.3
  → 371`). Readout text `"1 read · 9 today · 3 terms · 11 links"` is one
  unbroken string, rect `297x24` (single line height). Legend: 5 `<li>`
  children all at the same `top` (571px) — one line, not word-by-word.
  Real force-laid nodes visible on screenshot (MOLECULAR BIOLOGY, MACHINE
  LEARNING, etc., after allowing 2s for the simulation to settle).
  Pair: `x=1008,y=204,w=324,h=36`; right edge `1332` = row's right edge
  `1332` exactly.
- Dark (`resize_window colorScheme:"dark"` + reload): `data-mode="dark"`
  confirmed; band/pair/svg geometry byte-identical to light
  (`884x403` / `1008,204,324x36` / legend still 1 row) — the fix is
  theme-independent, as expected of a pure-layout change. Screenshot
  confirms dark palette with the same filled-width graph. No console errors
  on tab-2 (`read_console_messages` clean).

## Check 3 — phone width (375px): PASS, flex-1 regression confirmed ABSENT

375x812, reload: row `w=327` (full viewport minus page padding); band
`x=24,y=207,w=327,h=473` — **full row width**, not crushed. `computed
flexBasis: "auto"` (never `"0%"`, which is what bare `flex-1` would have
produced). Pair `x=48,y=696,w=303,h=36`. `bandBottom=680`, `pairTop=696` —
16px gap (`gap-y-4`), zero Y-overlap — wraps cleanly to its own line below,
no overlap with the graph. These numbers match C's own claimed
"band bottom y=680, pair top y=696" exactly, independently reproduced.
Legend wrapped to 3 rows (`legendUniqueTopRows: 3`) — real content wrap from
limited width, not the collapse artifact (band is still full-width, just
narrow in absolute terms). **The regression C found and rejected (bare
`flex-1`, `flexBasis:"0%"`, band crushed to 0, pair overlapping) is
independently confirmed NOT present in the shipped fix.**

## Check 4 — empty library (640c55ec's contract): PASS

Cleared `library`/`readItems` to `{}` (papers stayed at the real 10),
reloaded at 1440px. Hit a transient environment hazard here, recorded for
whoever reads this next: right after the reload, a concurrent agent's tab
(`tab-3`) got fronted in this shared browser pane, backgrounding `tab-2`;
`document.visibilityState` went `"hidden"` and this app's own code
suppressed nearly all rendering while hidden (`body.innerText` briefly
collapsed to just the nav; matches the project memory note "a minimized
window never reveals streamed routes" — not specific to this fix). Fixed by
`tabs_select`-ing `tab-2` back to front and re-measuring once settled — not
a defect in C's change, just a shared-browser hazard for whoever reviews
next after this. Final, settled measurement: row `children.length === 1` —
`ReadingStrip` renders truly nothing (not even the old
`<span aria-hidden/>`, since `papers.length` is still 10 — only the library
is empty), leaving the pair as the row's only DOM child, at **the exact same
coordinates as when the band was present** (`x=1008,y=204,w=324,h=36`,
right edge 1332 = row's right edge). Screenshot confirms visually: no "YOUR
READING" section at all, pair pinned top-right. 640c55ec's contract intact.

## Check 5 — upload/search pair visible + correctly sized: PASS

Already established by Checks 2–4's own measurements at both widths: 1440px
pair `324×36` (`36×36` upload + `8px` gap + `280px` search, matches
`search-box.tsx`'s `sm:w-[280px]`), right-edge-pinned; 375px pair
`303×36` (`36` upload + `8` gap + `259` search, `w-full` filling the
remainder), wrapped below with no overlap. Fully on-screen, non-zero, not
clipped, in both the non-empty and empty library states.

## Check 6 — vitest mutation test + judgment on whether it guards the regression

`npx vitest run src/app/page.test.tsx` as shipped: **2 passed.**

Mutation A (dropping `className={className}` on the `<Band>` inside
`ReadingStrip`'s own render — the wiring the test can actually see, since it
renders `ReadingStrip` directly): **1 of 2 tests goes red** as expected
(`AssertionError: expected '<section class="">…' to contain
'class="flex-auto min-w-0"'`); the empty-library test stays green (correctly
unaffected). Restored; SHA256 back to `0c2440bd…` before moving on.

Mutation B (the real historical regression — reverting the page.tsx **call
site** at the row, i.e. removing `className="flex-auto min-w-0"` from
`<ReadingStrip papers={papers} readerTopics={...} />` so it matches
origin/main's pre-fix call exactly): **both tests still pass, 2/2 green.**
Confirmed by execution, not inferred. Restored; final SHA256 both files
verified byte-identical to the opening snapshot (see below) and
`git status --porcelain` unchanged from the start.

**Judgment: the test does NOT actually guard the regression it was written
for.** It renders `ReadingStrip` directly and hands it its OWN hardcoded
`className="flex-auto min-w-0"` prop — it never touches `page.tsx`'s real
JSX at the row. So it correctly guards (a) `ReadingStrip` losing its
className→`Band` forwarding wire, and (b) the empty-library contract — but
it is completely blind to the actual bug class this item exists to fix:
if someone reverts the page.tsx call site back to no `className` at all (the
exact pre-fix state on origin/main) or back to bare `flex-1`, this test
suite stays green and nothing catches it. Given the checkpoint's own
candid note that this repo has no harness for rendering the whole
`DailyBriefingPage` (auth-settle timing, batch ack, digest loader, no
jsdom/ResizeObserver), a full render-and-measure test isn't available
either — but a cheap, available strengthening exists and is missing: a
one-line test asserting the literal string `'flex-auto min-w-0'` (or a
regex for "not flex-1 with no min-w-0") appears in `page.tsx`'s own source
text, or a snapshot of the call site's JSX attribute, would have caught
exactly this. Recorded as a real, evidence-backed gap, not a blocker — the
manual/visual verification (C's and mine, both independently reproducing
the same pixel numbers) is what is actually protecting this today, and it
is documented as such in both checkpoints; treat this as the residual risk
if this row's JSX is ever touched again without re-reading this note.

## Check 7 — full gates from `web/`

Ran sequentially (never in parallel with each other) to avoid Windows file
locks against the live dev server; no EBUSY/EPERM seen anywhere.

- **`npx vitest run`: 1 failed | 4931 passed | 6 skipped (4938 total,
  276 files: 272 passed + 1 failed + 3 skipped).** The 1 failure —
  `src/store/feed-opportunity-pool.test.ts` › "hydrates remote save state
  into the displayed slice and full pool" — **re-ran alone, still fails
  identically** (not cross-file pollution). Attributed: `git status`/`git
  diff --stat` show `web/src/store/feed.ts` currently modified in the
  working tree (+72/-7 vs HEAD) plus a new untracked
  `web/src/components/feed-sync.test.tsx` — this is a different,
  concurrently in-progress item (the "remote save state" hydration path
  matches §1af/SIGNIN-MERGE's own description: "a remote-merge path in the
  same store replaces local fields with the server's on sign-in"), not
  anything HOME-READING-LAYOUT touches. `store/feed.ts` is confirmed
  unmodified by C's own checkpoint scope section. **Zero failures
  attributable to page.tsx/page.test.tsx.**
- **`npx tsc --noEmit`: 5 errors**, all in `src/lib/profile/merge.ts` (1),
  `src/lib/profile/merge.test.ts` (1) and `src/store/feed.test.ts` (3).
  `git status` confirms `merge.ts`/`merge.test.ts` are untracked (new,
  in-progress, unrelated to this item — same SIGNIN-MERGE lane) and
  `feed.test.ts` is modified in the working tree. **Zero errors in
  page.tsx/page.test.tsx or anything this item touches.**
- **`npx eslint .`: 0 errors, 151 warnings.** C reported 149 at their gate
  run; grepped the full output for `page.tsx`/`page.test.tsx` by exact path
  — **zero matches, zero warnings attributable to this item's files.** The
  151 warnings span ~40 pre-existing files (mostly the repo-wide "off
  Latent's 8-based scale" spacing rule plus a few `no-unused-vars`), none of
  which are page.tsx, page.test.tsx, band.tsx, library-graph.tsx,
  search-box.tsx or upload-button.tsx. Could not pin down the exact source
  of the +2 vs C's count (did not chase it further since it's provably not
  mine); noted honestly rather than guessed.
- **`npm run build`: FAILS**, but at the project-wide "Running TypeScript"
  step, on the exact same `src/lib/profile/merge.ts:313` error already
  isolated above (`Conversion of type 'UserProfile' to type 'Record<string,
  unknown>'…`) — Turbopack's own compile step succeeded first ("Compiled
  successfully in 6.1s"), so nothing about page.tsx/ReadingStrip itself
  broke compilation. The pre-existing Turbopack NFT-list warning C already
  flagged (traced through `src/lib/papers/pdf-text.ts` →
  `api/papers/upload/route.ts`) reappeared unchanged, confirming it is
  independent of this fix as C said. **This is a whole-project gate and it
  is currently red — but for a reason entirely outside this item's scope
  and files, caused by a different lane's in-progress, untracked,
  type-broken file existing in the same working tree at review time.** I
  did not edit `merge.ts` to unblock this (out of scope, and would collide
  with whoever is actively editing it) — flagging it plainly instead, same
  as the vitest/tsc attributions above. C's own checkpoint recorded a green
  `npm run build` at their own gate run, before `merge.ts`/`merge.test.ts`
  existed in the tree (both were untracked "??" already at the START of
  this review) — consistent with this being a new, later collision, not a
  regression C introduced or missed.

## Check 8 — cleanup

Removed: my seeded `library`/`readItems` entry
(`"seed:layout-repro-1"`) from `peer-feed` in this in-app browser's
`localStorage` (tab `tab-2`) — set back to `{}`/`{}`. Confirmed at cleanup
time: `libraryKeys: []`, `readItemsKeys: []`, `savedPapersCount: 0`,
`papersCount: 10` (the real starter papers, untouched throughout — I never
wrote to `papers`). C's own seed was already absent when I started (see
"Browser setup" above), so there was nothing of C's left to remove.
Viewport reset to the pane's default desktop responsive size
(`resize_window` preset `"desktop"`) on `tab-2`. Did not close `tab-2`
(no instruction to); did not touch `tab-3` or the default "seed" tab
(other agents' / the tool's own tabs).

Environment note for whoever reviews next in this shared browser: mid-review
a concurrent agent fronting their own tab backgrounded mine and this app
visibly suppresses rendering for a hidden/backgrounded tab
(`document.visibilityState`); re-front your tab and re-measure if a query
ever comes back with an all-zero rect and a `display:none` ancestor even
though localStorage/state looks right — it is not necessarily this item's
bug (see Check 4's note).

## Final snapshot (after all checks — byte-identical to the opening one)

```
SHA256:
0c2440bd593768cc25e5893a0477f6e143dd9b774a0ad351897c2c05aacd14f8  web/src/app/page.tsx  (MATCH)
8b6a967266118ffb74823863325bcfa3266d446e205a3db586d01a465b89b319  web/src/app/page.test.tsx  (MATCH)

git status --porcelain -- web/src/app/page.tsx web/src/app/page.test.tsx
 M web/src/app/page.tsx
?? web/src/app/page.test.tsx
```
(Unchanged from the opening snapshot — my two mutate/restore cycles in
Check 6 left no residue.)

## Verdict

**STATUS: VERIFIED** — C's fix (`ReadingStrip` gains an optional
`className` prop, forwarded to `Band`; wired at the page.tsx row to
`"flex-auto min-w-0"`) does what §1ag asked: the "Your reading" band fills
its real share of the row at desktop width (884px, exact row-math),
legend/readout no longer wrap word-by-word, the graph renders at the band's
real width, in both light and dark; at phone width (375px) the band is
full-width and the upload/search pair wraps cleanly below it with **no
overlap** — the bare-`flex-1` regression C found and rejected is
independently confirmed absent; the empty-library contract from 640c55ec
holds byte-for-byte (pair pinned at the same coordinates whether the band
renders or not); the upload/search pair is visible and correctly sized at
both widths. C's "upload+search pair was never missing" claim is confirmed
independently (measured, not just re-read).

Two findings recorded, neither blocking this item, both worth the manager's
attention:
1. **The regression test does not guard the real regression** (Check 6) —
   it protects an internal wiring detail and the empty-library case, but
   would stay green if the actual page.tsx call site regressed back to
   origin/main's pre-fix state. Cheap fix available (assert the literal
   class string appears in page.tsx's own source, or snapshot the row's
   JSX) if the manager wants it closed later.
2. **`npm run build` is currently red project-wide** (Check 7) because of
   `web/src/lib/profile/merge.ts:313`, a different, concurrently
   in-progress item's untracked file — not this item's fault and not
   fixed by me (out of scope; would collide with an active editor). The
   manager should know the build gate is not currently green for reasons
   unrelated to HOME-READING-LAYOUT.

Gate numbers (this item's attribution): vitest 1 failed/4931 passed/6
skipped — 0 attributable to this item; tsc 5 errors — 0 attributable;
eslint 0 errors/151 warnings — 0 attributable; build fails at whole-project
typecheck — 0 attributable, root cause isolated to a different file.
