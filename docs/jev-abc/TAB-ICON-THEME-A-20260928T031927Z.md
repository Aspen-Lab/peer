# TAB-ICON-THEME — Agent A (reviewer) — checkpoint

STATUS: FAILED_REVIEW

## Task

Independent review of ABC-JEV-INTEGRATION.md §1ae (the browser-tab icon must
follow Peer's own colour setting — mode + accent — like the masthead Mark).
Verifying C's checkpoint `docs/jev-abc/TAB-ICON-THEME-C-20260928T025417Z.md`.
I implemented nothing; I did not edit `web/src/lib/tab-icon.ts`,
`web/src/components/tab-icon-sync.tsx`, or `web/src/app/layout.tsx` except
for two temporary, immediately-reverted mutations for Check 6's mutation
testing (SHA256-verified byte-identical afterward).

Branch `Jev-integration-and-sorting-filtering-enhancement`.

## Snapshot (before any check)

`git status --porcelain` (five target files):
```
 M web/src/app/layout.tsx
?? web/src/components/tab-icon-sync.tsx
?? web/src/lib/tab-icon.test.ts
?? web/src/lib/tab-icon.ts
```
(`web/src/app/icon.svg` — clean, no entry, matches C's claim it is untouched.)

SHA256 (start of review, and again at the very end — unchanged):
```
821b3ecf1bb0dcbfc7e9fde8ad8e80e73f61a621227e99b672a3206e5fb8843e  web/src/lib/tab-icon.ts
b1430e7dd6c633bfd15c767d64f5748824888edd92f2f52170ee94271a06082a  web/src/lib/tab-icon.test.ts
63ec2b38118fa9cd3f972563360bdd863d6eeb77ffa69ea42548e7f910f877f5  web/src/components/tab-icon-sync.tsx
e71b804144094cb81a193911bc89b7314389071a4809fa174eb7ce6652e0cca0  web/src/app/layout.tsx
aab945c64d00d11c32602120eab1ae07a2f01740291e84655cc39a68725b9aa4  web/src/app/icon.svg
```

`git diff -- web/src/app/layout.tsx` confirmed: exactly a 2-line addition
(import `TabIconSync`, mount `<TabIconSync />` beside `<ThemeSync />`),
matching C's claim.

## Summary verdict

**FAILED_REVIEW.** The token-matching, geometry, mode-following, and
initial-mount hydration-race logic are all correctly implemented and
well-tested (Checks 1, 2's static parts, 4, 6). But the core acceptance bar
of §1ae — "exactly one effective icon — no duplicate or flickering links" —
is violated in ordinary use: after navigating between routes (or, later in
the same session, on any fresh load at all), a **second** `<link
rel="icon">` appears in the document and never goes away. It sits *after*
our maintained one in `<head>` order, our code only ever repaints the
*first* match, and per standard browser favicon-resolution the *last* link
usually wins — meaning the fix likely stops being visible to the user after
the very first navigation, silently, with no error anywhere. This is a
different bug from the one C found and fixed (the mount-time hydration
race, which IS fixed — confirmed live); it was found by exercising this
review's own Check 5 (route navigation), which C's own checkpoint never
exercised. See Checks 3 and 5 for full repro steps and evidence.

## Checks

### Check 1 — Same tokens as the masthead: PASS

- `readMarkTokens` (`web/src/lib/tab-icon.ts:56-63`) reads exactly
  `--color-heading` and `--color-accent` via `getComputedStyle(document.documentElement)`.
  Masthead's `Mark()` (`web/src/components/shell/masthead.tsx:83-91`) resolves
  the sheet through `fill="currentColor"` on an element whose ancestor
  (`Link` at line 146) carries the Tailwind v4 utility class `text-heading` —
  confirmed in `globals.css`'s `@theme` block that `--color-heading` is
  declared inside `@theme`, which is what makes Tailwind v4 generate the
  `text-heading` utility (`color: var(--color-heading)`) automatically; the
  corner via `fill="var(--color-accent)"` directly. Same two tokens, same
  cascade, confirmed by both static reading and live `getComputedStyle`
  results (matches C's Step 0 numbers exactly: ember/system →
  `#1d1d1d`/`#ff520d`).
- No second hard-coded palette in production code: grepped
  `web/src/lib/tab-icon.ts` and `web/src/components/tab-icon-sync.tsx` for
  hex literals — none found outside comments. The only hard-coded hex table
  (`ACCENT_SEEDS`) lives in the test file as the oracle, mirrored from
  `globals.css`'s own values, not shipped.
- Geometry identical to `icon.svg`: `iconMarkup()`'s `rect x="4" y="4"
  width="56" height="56"` and the two corner `path d="M30 4h30v10H30z"` /
  `"M50 4h10v30H50z"` are character-identical to `web/src/app/icon.svg` and to
  masthead `Mark()`'s own JSX. viewBox/width/height (0 0 64 64 / 64 / 64)
  also match.

### Check 2 — Live behaviour, fresh loads: PARTIAL FAIL (see Check 3/5 — a second link appears after normal use, not on first mount)

Fresh-load evidence (in-app browser-tab automation, separate from the
user's own browser, `http://localhost:3000`):
- Load 1 (initial): `linkCount: 1`, `dataMode: system`, `dataAccent: ember`,
  tokens `#1d1d1d`/`#ff520d` — matched. Pane was backgrounded at that instant
  (`document.visibilityState: "hidden"` — the automation pane itself wasn't
  on-screen); href stayed the static `/icon.svg?...` until the pane became
  visible (confirmed by taking a screenshot), at which point it painted
  correctly to the data: URL within that same check. This is a live,
  unplanned confirmation of the named hydration-race trade-off (see Check 3).
- Loads 2–5 (F5 reloads): `linkCount: 1` every time, including one checked
  with no delay at all and one after a 3 s wait. Href correctly became the
  data: URL matching current tokens each time. No duplicate on any of these
  five fresh loads.
- Profile → Appearance card, live clicks (not synthetic attribute writes):
  Dark → sheet `#f3f3f3`/corner `#ff6a2b` (ember/dark, exact globals.css
  match). Violet swatch (still dark) → corner `#a078f0` (exact). Sage swatch
  → corner `#4aa87d` (exact). Auto (system) + sage, OS scheme emulated dark
  via `resize_window colorScheme` → repainted unprompted to `#f3f3f3`/`#4aa87d`
  (matchMedia listener fired correctly). Explicit Light + sage, OS scheme
  toggled dark→light→dark via emulation → href stayed **byte-identical**
  across every toggle (confirmed it does not even re-run, not just "same
  colour by coincidence") — correctly ignores OS scheme in a fixed mode.
  `linkCount` stayed 1 through all of this same-page interaction.
- Appearance setting restored at the end to the exact state found at start:
  `data-mode=system`, `data-accent=ember`, `localStorage['peer-profile']
  .state.profile.colorTheme === "system:ember"`. Viewport colour-scheme
  emulation cleared back to default (`resize_window preset: desktop`).

**But** — see Check 3/5: after ordinary navigation between routes, a second
`<link rel="icon">` appears and persists. So "exactly one link after load"
holds only for the first several seconds of the very first mount; it does
not hold for the rest of a normal session. Downgrading this check to a
partial fail because of that, even though every individual number matched
the oracle when a link was actually addressed.

### Check 3 — Hydration race: the mount-time race is fixed; a SEPARATE, worse duplication exists — FAIL (new finding, not the one C fixed)

Judged the two-rAF deferral itself first, on its own terms: reasonable and
correctly implemented. Five fresh mounts (Check 2) never produced a
duplicate at mount time, including a mount where the pane was genuinely
backgrounded for multiple tool round-trips (stronger than C's own ~19 s
hidden-tab test) and still painted correctly, once, with no duplicate, the
moment it became visible. I did not re-mutate `tab-icon.ts` in the live repo
to force-reproduce the ORIGINAL bug (a synchronous revert would hot-reload
the shared dev server that other concurrent agents and the user depend on,
for a transient window) — the alternative this review's own brief allows
("or at least confirm across repeated fresh loads that a duplicate link
never appears") was used instead, and it passes for mount-time.

However, **a duplicate link does appear live, reliably, after ordinary use**
— this is a different trigger than the one C characterized and fixed, found
by following this review's own Check 5 (route navigation):

**Repro (confirmed twice, independently, in two separate fresh browser
tabs):**
1. Load `/` fresh. `document.querySelectorAll('link[rel~="icon"]').length`
   → 1 (as above).
2. Click an in-app nav link to a different route (e.g. **Search**), then
   back. No manual DOM/attribute poking — ordinary use.
3. From that point on, `document.head.querySelectorAll('link[rel~="icon"]')`
   → **2**, and it does not recover: it stays at 2 across further reloads
   (`F5`), across further route changes, for the rest of that browser
   session. Verified the raw server HTML is NOT the source — `curl` against
   `http://localhost:3000/` at the same moment still returns exactly one
   `<link rel="icon">` (byte-checked); the second element is inserted
   client-side, after React/Next's own runtime is running.
4. Order matters: the correctly-themed, our-own-code-maintained data: URL
   link is **first** in `<head>`; Next's freshly (re-)inserted, plain,
   never-mutated `/icon.svg?icon.0btq77qbt3irj.svg` link lands **second**,
   after it. `paintTabIcon()` uses `document.querySelector` (singular) —
   confirmed live that once the duplicate exists, only the FIRST link
   keeps getting repainted on further theme changes (tested: switched to
   Dark/Rose afterward — index 0 correctly became `#f3f3f3`/`#f0559a`; index
   1 stayed the untouched static href, permanently). Per standard favicon
   link resolution (last one in document order usually wins in Chromium),
   the colour the user actually sees in their real tab is very likely the
   **plain default icon.svg rendering** from that point on — i.e., normal
   navigation can silently and permanently undo this entire feature for the
   rest of the page's life, with no error, console warning, or visual
   glitch to signal it. (Caveat: I cannot screenshot the browser's actual
   tab strip through this tooling, so "which link the chrome actually
   displays" is inferred from standard resolution order, not directly
   observed — flagging the inference rather than overclaiming it.)
5. Also reproduced the identical outcome (`linkCount: 2` immediately) on a
   brand-new, never-before-used browser tab's very first load, later in the
   same dev-server session — so this is not confined to one tab's own
   navigation history; something session/cache-scoped is involved. Ruled
   out: a service worker (`navigator.serviceWorker.getRegistrations()` →
   `0`, both tabs); the server itself (`curl` stays at 1 throughout, checked
   repeatedly). A `?_rsc=...` background request (Next App Router's own
   client-side payload re-fetch) was observed firing shortly after a plain
   reload in the network log, which is a plausible carrier for Next
   re-asserting its own head tag independently of our mutation, but I did
   not chase this further into Next's internals — per this role's brief
   ("measure gaps, not causes"), the reproduction and impact are reported
   here for B to trace the exact mechanism.
- **Named trade-off judged separately (mount-time backgrounded tab):**
  reasonable and correctly scoped — confirmed live (Check 2, load 1) that a
  hidden pane simply delays the first correct paint until actually viewed,
  with no duplicate and no error either way. This part of C's design is
  sound; it is not what the FAIL above is about.

### Check 4 — Fallback: PASS

`curl http://localhost:3000/` (no JS at all — the same content a no-JS
client or pre-hydration paint would see) → single `<link rel="icon"
href="/icon.svg?icon.0btq77qbt3irj.svg" sizes="any" type="image/svg+xml"/>`.
Fetched that exact href directly, also via `curl` (no JS): `Content-Type:
image/svg+xml`, body byte-for-byte identical (`diff`) to the repo's
`web/src/app/icon.svg`. The static fallback is untouched and serves
correctly regardless of the new client logic.

### Check 5 — Cleanup / no duplicate across the running page: FAIL

This is where the Check 3 finding was actually found: navigating between
routes (Search → Saved → Profile, and plain `/`) produced
`document.head.querySelectorAll('link[rel~="icon"]').length === 2`, not 1.
Root layout (and `<TabIconSync/>` with it) does not unmount across
client-side navigations in this app (confirmed: only one `icon.svg`-shaped
file exists anywhere under `web/src/app/`, via `find`, so no route can
register a competing icon of its own) — so this is not a per-navigation
observer/listener leak in the sense of "N navigations → N observers"; it is
the single new-link-insertion problem above, which happens once and then
persists. The observer/media-listener cleanup itself is correctly covered
by two dedicated, passing unit tests (`disconnects the observer and removes
the media-query listener on unmount`; `cancels the pending first-paint
frames on unmount before they fire` — both in `web/src/lib/tab-icon.test.ts`
and confirmed green in Check 6) — I did not find a way to unmount
`TabIconSync` live in this app to double it with DOM evidence (nothing in
the app unmounts the root layout short of a full navigation, which reloads
everything), so that half of Check 5 rests on the unit tests, labelled
accordingly rather than claimed as live-verified.

### Check 6 — Tests: PASS (unit level), with a noted ceiling

`npx vitest run src/lib/tab-icon.test.ts` → **38 passed**, matches C's number
exactly.

Two mutations applied directly to the live `web/src/lib/tab-icon.ts`,
restored immediately after each, final state re-verified byte-identical by
SHA256 (`821b3ecf1bb0dcbfc7e9fde8ad8e80e73f61a621227e99b672a3206e5fb8843e` —
matches the Snapshot section above, before and after both mutations):
1. **Paint synchronously** (removed the two-rAF deferral, called
   `paintTabIcon()` immediately in `startTabIconSync`): turned exactly the
   two mount-race tests red (`defers the first paint across two animation
   frames…`, `cancels the pending first-paint frames…` — both failed with
   the link already painted when the test expected `""`). Reverted; hash
   confirmed unchanged; full 38/38 green again before the next mutation.
2. **Create+append a new link instead of updating** (`paintTabIcon` now
   calls `document.createElement("link")` and appends instead of mutating
   `link.href`): turned red both no-duplicate tests (`never creates a second
   link…`, `never creates or appends a second link across mount...`) —
   failed loudly (a thrown `TypeError` in the stub, since `createElement` is
   an un-implemented spy there) rather than a quiet assertion miss, which is
   if anything a stronger catch. Reverted; hash confirmed unchanged; full
   38/38 green again.

**Noted ceiling (relevant to Check 3/5's FAIL above):** these are
`vi.stubGlobal` unit tests against a single mocked `<link>` in Vitest's Node
environment — there is no real Next.js router or React reconciliation
anywhere in this test file (by design, matching the repo's established
pattern). They thoroughly pin this module's OWN behaviour, but structurally
cannot catch Next's own runtime re-inserting a competing link, because
Next's runtime never runs in this test at all. The live-session duplicate
found in Check 3/5 is real and reproducible, but it is not something this
test suite could ever have caught — worth stating plainly rather than
treating "38/38 green" as covering the live finding.

### Check 7 — Scope: PASS

`git status --porcelain` for the five files under review matches C's own
"Files changed" list exactly: `web/src/lib/tab-icon.ts` (new),
`web/src/lib/tab-icon.test.ts` (new), `web/src/components/tab-icon-sync.tsx`
(new), `web/src/app/layout.tsx` (modified — `git diff` confirmed exactly the
claimed 2-line addition, nothing else), `web/src/app/icon.svg` (untouched,
clean). Full repo `git status --porcelain` shows a much larger set of
concurrently modified/new files (`web/src/app/api/profile/route.ts`,
`web/src/app/profile/page.tsx`, `web/src/store/feed.ts`,
`web/src/components/account/*`, `web/src/app/page.tsx`,
`web/src/lib/profile/merge.ts`, several `docs/jev-abc/*-B-*`/`*-C-*`
checkpoints, etc.) — all attributed to other items' concurrent agents per
the brief, not evaluated here.

### Check 8 — Gates (from `web/`)

1. **`npx vitest run`** (full suite): **1 failed | 4940 passed | 6 skipped
   (4947 tests)**, 276 files (272 passed, 1 failed, 3 skipped). The one
   failure — `src/store/feed-opportunity-pool.test.ts` › "hydrates remote
   save state into the displayed slice and full pool" (an `isSaved`
   boolean assertion, plus a `[zustand persist middleware] storage
   currently unavailable` warning) — re-ran in isolation
   (`npx vitest run src/store/feed-opportunity-pool.test.ts`): still 1
   failed/7 passed, confirming it's real and reproducible but located in
   `web/src/store/feed.ts`/`feed.test.ts`, both concurrently modified per
   `git status` and unrelated to icons/theme — attributed to that
   in-progress item, not scored against TAB-ICON-THEME. Zero failures in
   any of the five reviewed files. (Baseline drift from C's own 273-file/
   4905-test number is fully explained by other concurrent items' new test
   files, the same pattern C's own checkpoint already described for its own
   gate run.)
2. **`npx tsc --noEmit`**: **6 errors**, all outside scope —
   `web/src/lib/profile/merge.ts:313` (TS2352), `merge.test.ts:79` (TS2322),
   and `web/src/store/feed.test.ts:813,825,900` (TS2304, `Cannot find name
   'Paper'`, ×3). `merge.ts`/`.test.ts` are untracked new files and
   `feed.test.ts` is modified per `git status` — both belong to other
   concurrently in-progress items. Zero errors touch `tab-icon.ts`,
   `tab-icon.test.ts`, `tab-icon-sync.tsx`, or `layout.tsx`.
3. **`npx eslint .`**: **149 problems (0 errors, 149 warnings)** — identical
   count to C's stated baseline; grepped the full output for "tab-icon":
   zero matches. This item added no new warnings or errors.
4. **`npm run build`**: **failed to type-check, 3 attempts, on a moving,
   unrelated target — never on this item's files.** Turbopack's own
   compilation stage (`✓ Compiled successfully`) succeeded all 3 times —
   this stage resolves and bundles every import, including
   `layout.tsx → tab-icon-sync.tsx → tab-icon.ts`, so a broken import or
   syntax error in any of my 4 files would have shown up here and did not.
   The subsequent `Running TypeScript…` phase failed each time, on a
   different concurrently-edited file each time: attempt 1,
   `web/src/app/profile/page.tsx:233` ("Cannot find name
   'SyncStatusNotice'" — that file is `M` per `git status`, alongside
   `account-section.tsx`/`use-auth-user.ts`, both also `M`, clearly another
   item's in-progress account/profile work); attempts 2 and 3 (identical),
   `web/src/lib/profile/merge.ts:313` — the same TS2352 already seen in
   gate 2, an untracked new file belonging to another item. Did not retry
   further once the failure stabilized on a known, already-attributed,
   out-of-scope error — this gate is currently blocked by other agents'
   live edits, not by anything in this item. Recommend the manager re-run
   `npm run build` once those other items settle; I cannot produce a
   "N/N pages generated" number right now through no fault of this item's
   own files.

## Files touched by this review

Only `docs/jev-abc/TAB-ICON-THEME-A-20260928T031927Z.md` (this file, new).
`web/src/lib/tab-icon.ts` was temporarily mutated twice for Check 6's
mutation testing and restored byte-identically both times (SHA256-verified,
see Snapshot and Check 6). No other file was written to. No commits, no
pushes, no `.env`/`.env.local` opened, `peer-followup` never touched. Both
extra browser tabs opened for testing were closed at the end; the
Appearance colour-theme setting was restored to `system:ember` (its
starting value) before finishing.

## Recommendation for B

Trace why a second `<link rel="icon">` gets inserted client-side after
ordinary route navigation (and, once it has happened once in a dev-server
session, on subsequent fresh loads too) when the SSR HTML only ever emits
one. Working hypothesis, not confirmed: Next App Router's client-side
metadata/head-tag reconciliation (possibly tied to its background `?_rsc=`
payload re-fetch/router-cache restore) re-asserts its own version of the
file-based `icon.svg` metadata tag, unaware that `tab-icon.ts` mutated the
original node's `href` out-of-band; since the mutated node no longer
matches what Next thinks it rendered, Next inserts a fresh one instead of
reusing it. A fix needs to keep the effective link count at 1 for the
*whole* session, not just at mount — options worth B evaluating: observe
`document.head` itself for added `link[rel~="icon"]` children (not just
`data-mode`/`data-accent` attribute changes on `<html>`) and remove/merge
any extras as they appear; or find and use whatever mechanism Next exposes
for a client component to own a metadata-managed tag exclusively so Next
stops re-asserting it. Either way, the fix needs a test that can actually
exercise Next's router (not just the current Node-environment unit tests,
which cannot see this bug by construction — noted in Check 6).
