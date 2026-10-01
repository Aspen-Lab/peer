# PROFILE-LISTS — C implementation (PROFILE-UNSYNCED-FIELDS §1bp.2/§1bp.3 + LIST-REMOVAL-SYNC §1bq)

STATUS: IMPLEMENTED_PENDING_REVIEW (all three parts; see each part's own section below)

Implementer: C. Repo: D:/local files on this PC/Github/Peer/peer
Branch: Jev-integration-and-sorting-filtering-enhancement, HEAD fccb313a at start.
Started: 2026-09-30T09:20:01Z (`date -u`).

One change, three ordered parts, gates after each: PART 1 (§1bp.2, feed-intent
staleness) → PART 2 (§1bq, three-way list merge + lost-update mitigation, one
change) → PART 3 (§1bp.3, device-only hint lines).

Read first (all read before writing this plan): ABC-JEV-INTEGRATION.md §1bk
(whole, lines 324-336), §1bp (264-272), §1bq (255-262);
docs/jev-abc/PROFILE-UNSYNCED-FIELDS-B-20260930T074850Z.md;
docs/jev-abc/LIST-REMOVAL-SYNC-B-20260930T082019Z.md;
docs/jev-abc/PROFILE-SYNC-A-20260930T023227Z.md; web/AGENTS.md. Code read in
full: web/src/lib/profile/merge.ts, web/src/components/profile-sync.tsx,
web/src/store/profile.ts, web/src/lib/feed/intent.ts,
web/src/app/api/profile/route.ts, the relevant section of
web/src/app/profile/page.tsx (~1860-2130), and all four existing test files
(merge.test.ts, profile-sync.test.tsx, store/profile.test.ts read in full;
route.test.ts read in relevant part — rowFixture + list-mapping tests).

## PART 1 plan — §1bp.2 feed-intent staleness

**Enumeration by grep (not the guide's list alone)** — every `set()` call in
store/profile.ts that writes an `INTENT_LIST_FIELDS`/`INTENT_SINGLE_FIELDS`
key (researchTopics, softTopics, preferredMethods, currentProject,
currentChallenges — dislikedTopics has no setter, confirmed, zero matches):
`updateTopics` (:438), `updateSoftTopics` (:441), `updateMethods` (:485),
`updateCurrentProject` (:496), `updateCurrentChallenges` (:502), **and
`followTerm` (:580), which the investigation guide's own POLICY list did NOT
mention** — it writes `softTopics` directly, independently of
`updateSoftTopics`, to support the reading-page "follow this term" control.
Grep confirmed no other `set()` call in the file touches any of these five
field names. This is exactly the gap the brief warned "not from the guide's
list alone" about.

**Fix shape chosen:** option (a) from the guide's POLICY note — every one of
these 6 set-call-sites adds `feedIntent: undefined` to the same `set()`,
mirroring `mergeProfileAtSignIn`/`mergeProfileFromBackup`'s existing
`touchedIntentInputs` pattern. `hydrateFromRemote` is NOT changed (per the
brief: "may keep installing the server's card").

**Guard test shape chosen: table-driven**, over the 6 real set-call-sites
found by the grep above (not a single choke point — these are 5 independently
named setters plus one incidental one; forcing them through a shared wrapper
would be a bigger, riskier restructor than the bug needs). The table lives in
store/profile.test.ts and is the enumeration itself, so a reviewer changing
the set of intent-input setters sees the same list in both merge.ts's
INTENT_LIST_FIELDS/INTENT_SINGLE_FIELDS and this test.

**Tests:**
- store/profile.test.ts: table-driven — each of the 6 set-call-sites clears
  a pre-installed stale `feedIntent`; `followTerm`'s own no-op path (already
  following) makes no change at all, so nothing to invalidate.
- route.test.ts (reuses the existing `rowFixture` + imports `useProfileStore`
  from `@/store/profile` and `remoteProfilePayload` from
  `@/components/profile-sync`): control (no hydrate — edit reaches the push
  as it always did); addition after `hydrateFromRemote` installs a defined
  card (new topic reaches the push, `profilePatchToRow`'s row, and a fresh
  `profileRowToProfile` GET); removal after hydrate (removal reaches the
  push/row/GET, never silently kept).

**Mutation:** drop `feedIntent: undefined` from `updateSoftTopics` → red
(table-driven test + the route.test.ts addition/removal tests).

## PART 2 plan — §1bq three-way list merge + lost-update mitigation (one change)

**(a) `threeWayMergeList(remote, local, base)`** — new exported function in
merge.ts, next to `unionStrings`. Same normalized key (`trim().toLocaleLowerCase()`).
Per-item rule: `keep = (inRemote && inLocal) || (!inBase && (inRemote || inLocal))`
— algebraic form of the guide's 7-row table, verified by hand against all 7
rows. Order: remote's own order first (filtered by `keep`), then local's new
items in local's order — mirrors `unionStrings` exactly. With no base
(undefined/empty), `baseKeys` is empty so `keep` reduces to `inRemote ||
inLocal` for every item — algebraically identical to `unionStrings`, verified
against the *existing* "unions list fields" test in merge.test.ts (which
calls `mergeProfileAtSignIn` with no `lastSynced` arg) by hand-tracing both
functions on that exact test's inputs — same output. `mergeProfileAtSignIn`'s
LIST_FIELDS loop now looks up each field's own baseline from `lastSynced`
(same `hasOwnProperty` pattern `dirtySingleValueFields` already uses) and
calls `threeWayMergeList` instead of `unionStrings` directly — gated by (b)
below. `unionStrings` itself is UNCHANGED (still used by
`mergeProfileFromBackup`, deliberately not three-way, see (a) continued).

**(b) "no information" gate — binding, manager addition.** Before merging a
LIST_FIELDS key, `mergeProfileAtSignIn` now checks `Array.isArray(remote[key])`
in addition to the existing `hasOwnProperty` check; when remote's value is
missing or not an array, the key is left OUT of `patch` entirely (local stays
exactly as it is — not even a plain union, since a plain union against an
empty-coerced remote would already be safe by itself, but skipping keeps the
"no info" case textually obvious and matches "preferredJournals" which was
already skipped this way via `hasOwnProperty` alone). Read route.ts to state
how each of the 7 LIST_FIELDS columns maps a null/absent value:

| Field | route.ts source | When "no information" (not an array) happens |
|---|---|---|
| researchTopics | `intent ? intent.requiredConcepts : row.research_topics` | Only if the DB column itself were null despite its NOT NULL type contract (defensive; not normally reachable) |
| softTopics | `intent?.preferredConcepts` (ONLY derived from a feed_intent card) | **Every row with no feed_intent card** — `intent` is `undefined`, so this key is `undefined` even though `hasOwnProperty` is true (the object literal always assigns it) |
| preferredMethods | `intent ? intent.methods : row.preferred_methods` | Same defensive-only case as researchTopics |
| locationPreferences | `row.location_preferences` (not derived from intent) | Defensive-only |
| authorisedCountries | `row.authorised_countries ?? []` | Never — always coerced to `[]` |
| dislikedTopics | `intent ? intent.exclusions.map(...) : row.disliked_topics ?? []` | Never — always coerced to `[]` in the no-intent branch |
| preferredJournals | **not present in the returned object at all** (no column) | **Always** — `hasOwnProperty` is already false, caught by the existing gate even without the new Array.isArray check |

So the new `Array.isArray` check's real, reachable effect is `softTopics` on
any row without a feed_intent card — exactly the case the manager's addition
warns would otherwise be wiped.

**(c) Pull-before-push, extracted as `pullMergeAndPush`** (profile-sync.tsx,
next to `nextSyncBaselines`) — injected dependencies (`getRemote`, `readLocal`,
`applyPatch`, `push`, `setBaselines`, `markPushFailed`, `clearPushFailed`,
`getLastPushed`), tested with fakes, no DOM needed. Sequence: `await
getRemote()` → if it fails, `markPushFailed()` and stop (never push blind) →
**no await from here to applyPatch** — `readLocal()` (fresh, not a closed-over
value) → `planReconcile(local, remote, lastSynced)` (same function `onSession`
uses — one merge path, two call sites) → `applyPatch(patch)` synchronously →
`push(pushPayload)` (routes through `reconcilePushPayload`/
`remoteProfilePayload`, so `feedIntent` is always recomputed fresh — never a
bare list key) → on success, `setBaselines(nextSyncBaselines(true, merged,
...))`, same as `onSession`'s own "nothing to push still counts as a
confirmed sync" rule.

**Scope decision — only a list-carrying push pulls first, not every push**,
stated as required: scalars are last-write-wins by design (§1bk) and never
merge, so pulling first would add a network round trip to every debounced
scalar edit for no safety benefit; only list fields merge (three-way), so
only they carry the lost-update risk this mitigation closes. The debounced
push effect checks `LIST_FIELDS.some(key => patch has key)` and only then
calls `pullMergeAndPush`; otherwise the existing direct `pushRemote(patch)`
path is untouched.

**Wiring constraint found while reading the existing tests:**
profile-sync.test.tsx's "ProfileSync's closures actually use nextSyncBaselines"
source-text check requires the debounced-push closure's own source text to
contain **exactly one** literal `setLastSynced(` call. If the pull-before-push
dependency object were built inline inside that closure, its `setBaselines`
callback's own `setLastSynced(...)` call would be a SECOND literal occurrence
in the same marked region and redden that pre-existing test. Fix: the deps
object is built by a separate, named top-level function
(`listPullDeps(lastPushedRef)`), so the closure's own source only ever
contains `pullMergeAndPush(listPullDeps(lastPushedRef))` — zero new
`setLastSynced(` text inside the marked region, existing test unaffected. New
source-text check added confirming the closure actually calls
`pullMergeAndPush` when `carriesListChange` is true.

**(d) Tests** — merge.test.ts (`threeWayMergeList` table, all 7 LIST_FIELDS
generalized, case/whitespace, order, bootstrap-equals-union, no-info gate for
softTopics/preferredJournals, stale-unedited-device-cannot-shrink);
profile-sync.test.tsx (`pullMergeAndPush` with fakes — the Q3 race WITH the
mitigation, a failed pull never pushes blind, nothing-to-push still advances
baselines, the long-open-tab two-device scenario chaining
`planReconcile`/`pullMergeAndPush` against a real in-memory "account"); the
`reconcilePushPayload` doc comment ("union changed" → "merge changed") and
`listUnionChanged`'s own comment get a one-line addendum, no logic change
(guide proved it already handles shrinkage generically). Store version 5 → 6,
`singleValueSnapshot` widened to fold in LIST_FIELDS too (guide's literal
design — "no new mechanism") — this DELIBERATELY inverts
merge.test.ts's existing `expect(snap).not.toHaveProperty("researchTopics")`
assertion; changed with the required comment tag, not deleted. New
store/profile.test.ts persistence round-trip test for a list-field baseline
surviving a reload under v6.

**Tally line owed to the reviewer (§1bq.3):** the residual window between
`pullMergeAndPush`'s own GET and its PUT (another push landing in that gap)
is an ACCEPTED COST, unchanged from the guide's own framing — not eliminated,
narrowed. Lost-update reports so far: 0 (this is the first mitigation
shipping, not a report-driven follow-up).

## PART 3 plan — §1bp.3 device-only hint lines

Exact sentence "Saved on this device only." next to the "Preferred journals"
ChipInput (page.tsx ~2020-2035, inside its existing hint paragraph's sibling,
same `text-micro leading-snug text-text-faint/70` utility classes already
used one line above it — no new style/component) and next to the "Deep
report" Toggle (~2103-2127, same `text-caption`/`text-micro` hint idiom
already used in that EditRow for its conditional "Sign in first" line, made
unconditional since this field is always device-only regardless of AI
availability). Test: profile/page.test.tsx gets a new source-text check
(mirrors the existing pattern in papers/[id]/page.test.tsx and this
project's own convention for page copy) pinning both exact lines are present
and reachable from each field's own call site.

## Gates baseline (HEAD fccb313a, as stated in the brief, not yet independently re-run by me)

294 files (291 + 3 skipped) / 5625 passed + 6 skipped / 0 failed; tsc 0
errors; eslint 0 errors / 151 warnings; build OK.

## PART 1 — IMPLEMENTED_PENDING_REVIEW (2026-09-30T09:29Z, `date -u`)

Changed files:
- web/src/store/profile.ts — 6 set-call-sites (`updateTopics`, `updateSoftTopics`,
  `updateMethods`, `updateCurrentProject`, `updateCurrentChallenges`,
  `followTerm`) now also set `feedIntent: undefined` in the same `set()`.
- web/src/store/profile.test.ts — new table-driven describe
  "intent-input setters invalidate a stale feedIntent (§1bp.2)" (6 cases +
  1 no-op-path case = 7 tests).
- web/src/app/api/profile/route.test.ts — new imports
  (`defaultProfile`, `useProfileStore`, `remoteProfilePayload`) + new describe
  "PROFILE-UNSYNCED-FIELDS (§1bp.2) — feed-intent staleness, through the real
  store" (3 tests: control/addition/removal, through the real store +
  remoteProfilePayload + profilePatchToRow + profileRowToProfile).

Tests added: 10 (7 + 3). Full suite: 294 files (291+3 skipped) / 5635 passed
+ 6 skipped / 0 failed — exactly baseline's 5625 + 10 new, 0 failed.

Mutation proof: dropped `feedIntent: undefined` from `updateSoftTopics` only.
Before: sha256 85D3BC52AA7A1C547BF1FB4099B4881EC27FEC3820851F95171391F2E15B8080
(store/profile.ts). Result: exactly 3 tests red — the table-driven
"updateSoftTopics (softTopics)" case, and BOTH the addition and removal
route.test.ts tests (the removal one because the stale card's old topic
survives instead of being cleared; the addition one because the new topic
never reaches the recomputed card). Restored; sha256 after restore:
85D3BC52AA7A1C547BF1FB4099B4881EC27FEC3820851F95171391F2E15B8080 — byte-identical.
Line endings unchanged (`git ls-files --eol` still shows `w/crlf` for
store/profile.ts, `w/crlf` for route.test.ts, `w/crlf` for
store/profile.test.ts — all as before).

Gates (run from web/): `npx vitest run` → 294 files (291+3 skipped) / 5635
passed + 6 skipped / 0 failed. `npx tsc --noEmit` → 0 errors. `npx eslint .`
→ 0 errors / 151 warnings (byte-identical count to baseline). `npm run build`
→ compiled successfully, same route list, same pre-existing NFT-list
Turbopack note (unrelated, matches baseline description). All 4 gates green
on the first attempt, no retry needed.

Decision made and stated: table-driven guard (not a single choke point) —
reasoning in the PART 1 plan section above. `followTerm` found by grep, not
in the investigation guide's own list — the exact gap the brief's "not from
the guide's list alone" instruction anticipated.

## PART 2 — IMPLEMENTED_PENDING_REVIEW (2026-09-30T09:44Z, `date -u`)

Changed files:
- web/src/lib/profile/merge.ts — new exported `threeWayMergeList` (next to
  `unionStrings`); `mergeProfileAtSignIn`'s LIST_FIELDS loop now looks up
  each field's own baseline from `lastSynced` and calls `threeWayMergeList`,
  gated by `Array.isArray(remote[key])` (the §1bq.2 "no information" rule);
  `singleValueSnapshot` widened to also fold in LIST_FIELDS keys;
  `listUnionChanged`'s doc comment updated (no logic change).
- web/src/store/profile.ts — persist version 5 → 6, new `// v6:` comment;
  no transform code (matches the guide's own "no new mechanism" design).
- web/src/components/profile-sync.tsx — new `fetchRemoteForSync` (distinct
  `ok`-discriminated GET, next to `fetchRemote`); new exported
  `PullBeforePushDeps`/`PullMergeAndPushOutcome`/`pullMergeAndPush` (next to
  `nextSyncBaselines`); new top-level `listPullDeps` (kept OUTSIDE the
  debounced-push closure — see wiring-constraint note below); the debounced
  push effect now computes `carriesListChange` and routes through
  `pullMergeAndPush(listPullDeps(lastPushedRef))` before the ordinary push
  path; `reconcilePushPayload`'s doc comment updated ("union genuinely added
  something new" → "merge genuinely changed").
- web/src/lib/profile/merge.test.ts — new `threeWayMergeList` describe (8
  tests, the full decision table + case/whitespace + order + bootstrap =
  union + stale-unedited-cannot-shrink); new `mergeProfileAtSignIn — three-way
  list merge` describe (6 tests: this-device removal sticks, device-2 adopts
  a removal instead of resurrecting it, addition still reaches an unedited
  device, softTopics-no-card no-info gate, preferredJournals second+third
  load, all-7-LIST_FIELDS table-driven); `mergeProfileFromBackup` +1 test
  (restores an item present ONLY in the backup — the opposite direction from
  the three-way merge, pins that backup restore is NOT routed through it);
  `singleValueSnapshot`'s existing assertion CHANGED (see below) +1 new test.
- web/src/components/profile-sync.test.tsx — new `pullMergeAndPush` describe
  (6 tests: WITH the mitigation / never a bare list key, a failed pull never
  pushes blind, nothing-new-for-a-list still completes+advances baselines,
  first-ever sync with no account row, a push failure after a successful
  pull, the long-open-tab two-device scenario chaining the real
  `planReconcile` + `pullMergeAndPush`); +1 new source-text check (the
  debounced-push closure routes a list-carrying patch through
  `pullMergeAndPush` before the ordinary push path).
- web/src/store/profile.test.ts — +2 tests (a list-field `lastSynced` entry
  survives a reload under v6; a real v5 `lastSynced`, scalars only, survives
  the v5→v6 upgrade untouched).

CHANGED assertion (not deleted/weakened — deliberately inverted, per
LIST-REMOVAL-SYNC §1bq.1): merge.test.ts's `singleValueSnapshot` test used
to assert `expect(snap).not.toHaveProperty("researchTopics")`; now asserts
`expect(snap.researchTopics).toEqual(["x"])`, with the comment "LIST-REMOVAL-SYNC
(§1bq.1) — CHANGED: ... deliberately overturned, not weakened: the new
assertion is strictly more specific."

Design decisions stated:
- (b) no-information gate: `Array.isArray(remote[key])`, stated per-field in
  the plan section above by reading route.ts — the only REACHABLE case is
  softTopics on a row with no feed_intent card (preferredJournals is already
  caught by the pre-existing `hasOwnProperty` check alone, since it's never
  an own key on `remote` at all).
- (c) scope: only a list-carrying push pulls first, not every push — reasoning
  restated in the code comment at the `carriesListChange` check.
- (c) wiring constraint found and resolved: `listPullDeps` is a NAMED
  top-level function specifically so the debounced-push closure's own
  source text keeps exactly one literal `setLastSynced(` call, satisfying
  profile-sync.test.tsx's pre-existing "closures actually use
  nextSyncBaselines" source-text check unmodified.
- (d) `pullMergeAndPush`'s "synced-no-push-needed" status exists (mirrors
  `onSession`'s identical "nothing to push still counts as a confirmed
  sync" structure) but is NOT reachable with a real `defaultProfile`-shaped
  profile, the same finding PROFILE-SYNC-A's own Check 3 already made for
  `onSession`'s pushPayload (several no-server-column fields, e.g.
  eventRequiredTopics/deepReportEnabled/onboardedAt, are always present).
  The test for this exercises the REACHABLE half (a list with nothing new
  is excluded from the payload) rather than asserting a literal `{}`.
- Tally line for the reviewer (§1bq.3): the residual window between
  `pullMergeAndPush`'s own GET and its PUT is an ACCEPTED COST, unchanged in
  kind from the guide's own framing. Lost-update reports so far: 0.

Tests added: 18 (merge.test.ts) + 7 (profile-sync.test.tsx) + 2
(store/profile.test.ts) = 27 (net +26 over Part 1's count, since one
existing merge.test.ts assertion was changed in place, not added).
Full suite: 294 files (291+3 skipped) / 5661 passed + 6 skipped / 0 failed.

Mutation proof (4 mutations, each: Edit tool change → targeted vitest run →
confirm exact red set → Edit tool revert → sha256 match):
1. Reverted `mergeProfileAtSignIn`'s LIST_FIELDS loop from `threeWayMergeList`
   back to plain `unionStrings` (ignoring `base`). Before/after sha256 of
   merge.ts: 56A1F916183239071E3534DC7B69F7944576D5D083A192154CAC690A87F65E44
   (matched exactly after restore). Result: exactly 3 tests red — merge.test.ts's
   "device 2 ... adopts the removal instead of resurrecting it", and
   profile-sync.test.tsx's "WITH the mitigation" + "long-open-tab" (both of
   which exercise the real mergeProfileAtSignIn transitively through
   planReconcile/pullMergeAndPush).
2. Dropped the `Array.isArray(remote[key])` "no information" gate (mutation
   the ruling names directly: "treat undefined as [] → red"). Same sha256
   restored exactly. Result: exactly 1 test red — the softTopics-no-card
   test (preferredJournals's own test does NOT redden from this specific
   mutation alone, because it is already protected by the pre-existing
   `hasOwnProperty` check — stated as a finding, not a gap: the ONE
   REACHABLE case this gate protects today is softTopics on a card-less
   row, exactly as the "how each list column maps a null value" table
   above states).
3. `pullMergeAndPush`: changed `planReconcile(local, pulled.profile,
   lastSynced)` to `planReconcile(local, null, lastSynced)` (drop the
   pull). Before/after sha256 of profile-sync.tsx:
   427B420D8F92026140804C1D4BEA4E053D320A6097F22AF8740D82047804D530 (matched
   exactly after restore). Result: exactly 3 tests red — "WITH the
   mitigation", the "nothing new for a list" test, and "long-open-tab" —
   reproducing Q3 Part 2's regression exactly (device 1's concurrent
   addition is lost).
4. `pullMergeAndPush`: changed the push call from `deps.push(pushPayload)`
   to `deps.push({ researchTopics: merged.researchTopics })` (a bare list
   key). Same sha256 restored exactly. Result: exactly 1 test red — "WITH
   the mitigation", failing specifically on the feedIntent-echo assertion
   (`pushedPayloads[0].feedIntent?.requiredConcepts`), exactly as the
   ruling names.

Gates (run from web/, after all mutations restored): `npx vitest run` → 294
files (291+3 skipped) / 5661 passed + 6 skipped / 0 failed. `npx tsc --noEmit`
→ 0 errors (one real finding fixed along the way: a null-safety error in my
own new test, `baselineCalls[0].lastSynced.researchTopics` → `?.`). `npx
eslint .` → 0 errors / 151 warnings (one real finding fixed along the way:
an unused `LIST_FIELDS` import in profile-sync.test.tsx, removed). `npm run
build` → compiled successfully, same route list. All green. Line endings
verified unchanged after every mutation/restore cycle and again at the end
(`git ls-files --eol`): merge.ts/merge.test.ts stayed `w/lf`; profile-sync.tsx/
store/profile.ts/store/profile.test.ts/route.test.ts stayed `w/crlf`;
profile-sync.test.tsx stayed `w/lf`.

## PART 3 — IMPLEMENTED_PENDING_REVIEW (2026-09-30T09:50Z, `date -u`)

Changed files:
- web/src/app/profile/page.tsx — one line, "Saved on this device only.", next
  to the "Preferred journals" ChipInput (inside its own field `<div>`, after
  the existing hint paragraph, same `text-micro leading-snug text-text-faint/70`
  idiom — spacing values adjusted from the copied `mt-1.5 px-0.5` to
  `mt-2 px-1` to stay on the project's own 8-based spacing scale, see finding
  below) and next to the "Deep report" Toggle (inside its EditRow, after the
  existing conditional "Sign in first" hint, made unconditional — same
  `text-micro leading-relaxed text-text-faint` idiom already used there). No
  new component, no new className pattern.
- web/src/app/profile/page.test.tsx — new source-text describe (3 tests: the
  sentence appears exactly twice verbatim; each occurrence is reachable from
  its own field's call site — "Preferred journals" / `aria-label="Deep
  report"` — before the next EditRow starts).

Finding (LOW, fixed inline, not left as a gate diff): my first draft copied
the Preferred-journals hint's exact className (`mt-1.5 px-0.5 ...`), which
introduced a NEW eslint warning (151 → 152) — this repo's own
`no-restricted-syntax` design-lint rule already flags that same off-scale
spacing on the PRE-EXISTING sibling paragraph immediately above (confirmed:
that line is already warned in the current tree, untouched by me, out of
this item's scope to fix). Adjusted my own new paragraph's spacing to the
rule's own suggested on-scale values (`mt-1.5→mt-2`, `px-0.5→px-1` — a 2px
difference each, per Tailwind's default rem scale) so my addition introduces
no new warning; verified eslint back to exactly 151/151 after the fix. The
pre-existing sibling's own warning is unchanged and untouched (not this
item's scope).

Tests added: 3. Full suite: 294 files (291+3 skipped) / 5664 passed + 6
skipped / 0 failed (Part 2's 5661 + Part 3's 3).

Mutation proof (not explicitly named in the brief for this part, done anyway
for consistency with every other part's proof standard): removed the
Preferred-journals paragraph only. Before/after sha256 of page.tsx:
2D95A97C41A202C440838D83A8D4372C518141CF72C1ACA27417AA4D01D5F9D7 (matched
exactly after restore — the first restore attempt via Edit missed that the
explanatory comment had been left behind by the removal edit; caught by the
sha256 check before moving on, fixed, re-verified). Result: exactly 2 tests
red — "appears exactly twice in the page, verbatim" and "the line next to
Preferred journals is reachable..."; the Deep-report test stayed green,
correctly isolated.

Gates (run from web/): `npx vitest run` → 294 files (291+3 skipped) / 5664
passed + 6 skipped / 0 failed. `npx tsc --noEmit` → 0 errors. `npx eslint .`
→ 0 errors / 151 warnings (byte-identical to baseline, after the spacing
fix above). `npm run build` → compiled successfully, same route list. All
green. Line endings verified unchanged (`git ls-files --eol` — page.tsx
stayed `w/crlf`, page.test.tsx stayed `w/lf`).

## Summary across all three parts

Final state (HEAD still fccb313a, nothing committed — per the hard
constraints, no commit/push/stash performed):
- `npx vitest run` → 294 files (291 passed + 3 skipped) / 5664 passed + 6
  skipped / 0 failed (baseline 5625 passed + 6 skipped; net +39 new tests:
  10 Part 1 + 26 Part 2 (net, one assertion changed in place) + 3 Part 3).
- `npx tsc --noEmit` → 0 errors (baseline 0).
- `npx eslint .` → 0 errors / 151 warnings (baseline 0 errors / 151
  warnings — byte-identical count; two real findings surfaced and fixed
  along the way, both disclosed above: an unused import in
  profile-sync.test.tsx, and an off-scale spacing value in my own new
  page.tsx paragraph).
- `npm run build` → compiled successfully, same route list, same
  pre-existing NFT-list Turbopack note (unrelated).
- 9 product/test files changed, listed under each part above. No test
  deleted or weakened. Exactly one pre-existing assertion CHANGED (merge.test.ts's
  `singleValueSnapshot` test), tagged "LIST-REMOVAL-SYNC (§1bq.1)" with the
  reasoning inline, deliberately inverted (not weakened — strictly more
  specific) per the design ruling itself.
- No network call made at any point (all tests are pure-function/fake-based;
  `npm run build`/`vitest`/`tsc`/`eslint` are local toolchain runs, not
  product network calls). No `.env`/`.env.local` opened or printed. No API
  key written anywhere. No person's name introduced anywhere in code, tests,
  or this checkpoint — every test value is fictional
  (`construction-user-*`-style ids, generic topic/journal-label strings).
- No commit, push, stash, checkout, worktree, or branch operation performed.
- Nothing under `web/src/__c_profile_probe_*` was ever created — no cleanup
  needed. No temp file outside the scratchpad/docs/jev-abc scope was created.
- The read-only investigator's scratchpad scripts (referenced, never
  executed by me) were only read as background context for this checkpoint's
  own plan section, never run.

Decisions made and reasons (all restated from each part's own section
above, gathered here for the reviewer):
1. Part 1 guard: table-driven test over the 6 real set-call-sites (found by
   grep, including `followTerm`, which the investigation guide's own list
   missed), not a single choke point — smaller, less risky diff than
   restructuring 5 independent setters through a shared wrapper.
2. Part 2(b) no-information gate: `Array.isArray(remote[key])`; the only
   REACHABLE case today is softTopics on a feed_intent-card-less row
   (preferredJournals is already protected by the pre-existing
   `hasOwnProperty` check alone, since route.ts never assigns it as an own
   key at all).
3. Part 2(c) scope: only a push carrying a LIST_FIELDS change pulls first —
   scalars are last-write-wins by design and never merge, so pulling first
   for them would cost a network round trip with no safety benefit.
4. Part 2(c) wiring: `listPullDeps` is a named top-level function (not an
   inline closure) specifically to avoid reddening the pre-existing
   "closures actually use nextSyncBaselines" source-text test, which counts
   literal `setLastSynced(` occurrences inside the debounced-push closure's
   own source text.
5. Part 2 tally for the reviewer (§1bq.3): lost-update reports so far: 0.
   The residual pull→push window is an ACCEPTED COST, unchanged in kind
   from the guide's own framing — narrowed by this change, not eliminated.
6. Part 3: reused the page's existing two hint idioms verbatim in wording
   and structure; adjusted only spacing utility VALUES (not the pattern) to
   stay on-scale per this repo's own design-lint rule, disclosed above.

## Progress log

- [x] Read binding docs + code + existing tests, wrote this plan
- [x] PART 1 implemented, tested, mutation-proven, gates green
- [x] PART 2 implemented, tested, mutation-proven, gates green
- [x] PART 3 implemented, tested, mutation-proven, gates green
- [x] Final report (this checkpoint + the SubagentHandback message)

## Note: HEAD advanced during this session (not by me)

Partway through, `git log` showed HEAD moving from the brief's stated
fccb313a to a new commit aee9f7fb ("docs(abc): state after NON-ASCII-TEXT;
four investigations and their rulings") — external, docs-only (
ABC-JEV-INTEGRATION.md + the four docs/jev-abc/*-B-*.md investigation files
that were untracked at my start), touching no file under web/. I performed
no commit, push, stash, checkout, worktree, or branch operation myself (hard
constraint honored throughout) — `git status --short` at the end of this
session shows exactly my 9 changed web/ files plus this checkpoint,
untouched by that external commit.
