STATUS: IMPLEMENTED_PENDING_REVIEW

# EMPTY-STATE-REASON — implementation (agent C)

Binding inputs read: ABC-JEV-INTEGRATION.md §1bb (rulings, 2026-09-29T15:4xZ) and the guide
docs/jev-abc/EMPTY-STATE-REASON-B-20260929T113729Z.md (COMPLETE, 12 empty paths, waterfall,
travel design, 12 tests). HEAD at start: 7aa542d8, branch Jev-integration-and-sorting-filtering-enhancement,
working tree clean except ABC-JEV-INTEGRATION.md (not mine) and this new file.

## Plan

### Server (pipeline.ts)
- Add `FeedEmptyReasonCode` type + `FeedMeta.emptyReasonCode?: FeedEmptyReasonCode` in
  `web/src/lib/feed/types.ts` (declared once, per guide §3).
- New private helper `computeEmptyReasonCode(sourceStatus, inWindowCount, scoredCount)` in
  pipeline.ts, colocated near `everySourceFailed`/`errorsFromSourceStatus` (~line 1040-1064):
  waterfall sources-unreachable -> no-results -> no-required-match -> already-delivered
  (exhaustive 4-way if/else, always resolves — satisfies "never guess/throw" by construction).
- Call it at the tail of `runFeedPipeline` (~line 2121), only when `returned.length === 0`,
  using `pool.sourceStatus`, `inWindow.length`, `scored.length` (all already in scope, already
  fresh on every read per guide §3). Added to the returned `meta` via the same conditional-spread
  idiom already used for `rrf`/`finalPool`. No cache/pool changes; no cache version bump.

### Server (route.ts) — FINDING, not in the original task bullet list
Read the full ledger-aware path. `runLedgerAwareFeed`'s mint branch (no existing batch for
today) ALSO funnels its response through `frozenFeedResponse()` (via `resolveServedItems` since
`prepareBatch` already stored `result.items` as `servedItems`), which today hard-codes its own
`meta` object and does NOT carry over any field from the live pipeline `result.meta` (documented
in its own comment: "does NOT carry over fetched/errors/searchBrief/aiTierUsed diagnostics").
Ruling 3 ("live requests only now") + the guide's option (a) explicitly require the FIRST MINT
of a signed-in reader's empty day to show the reason — so this is a required wiring fix, not a
policy re-decision: thread `emptyReasonCode` through `frozenFeedResponse`'s new optional 6th
param, passed ONLY at the mint call site, and ONLY when `wonMintRace` is true (mirrors the
existing, already-documented invariant a few lines above it — a losing racer's own pipeline
diagnostics must never be attached to the WINNER's frozen batch; same reasoning already governs
why `fetched`/`errors`/etc. are excluded from `frozenFeedResponse` at all). The "existing batch"
replay call site passes nothing (stays structurally absent) — matches "a replayed batch ... shows
today's generic copy" exactly, with zero schema change (no DashboardBatch column), matching
option (a) "no schema change, no migration".

### Client
- `empty-reason.ts`: `EmptyReason` widens to `"intent-required" | "error" | "empty" |
  FeedEmptyReasonCode` (kept `"empty"` explicit — the guide's own shorthand type recipe in §3
  drops it by accident; test 11's "absent/unrecognized reasonCode still returns empty" and the
  existing `emptyReason(base) === "empty"` test both require the literal string to survive, so
  omitting it would break an existing test). `emptyReason()` gains optional `reasonCode` input,
  checked after `feedError`, before the `"empty"` fallback.
- `store/feed.ts`: `RealFeedResult.emptyReasonCode?: FeedMeta["emptyReasonCode"]`, forwarded in
  `fetchRealFeed` from `data.meta?.emptyReasonCode`. New `FeedState.emptyReasonCode:
  FeedMeta["emptyReasonCode"] | null`, initial state `null`, reset to `null` in the SAME
  pre-lane conditional block that already resets `feedError` (`wantsPapers ? {...} : {}`), and
  set in the SAME `set()` call as `papers`/`papersLoading` (the `paperUpdate` object) from
  `realFeed.emptyReasonCode ?? null` — same atomicity discipline as `renderedBatchId`.
- `page.tsx`: read `emptyReasonCode` from the store, pass as `reasonCode` into `emptyReason()`;
  widen `BriefingEmpty`'s `reason` prop type to the full `EmptyReason`; EXPORT `BriefingEmpty`
  (was module-private) so it is directly render-testable, mirroring how `ReadingStrip` is already
  exported for exactly this purpose in page.test.tsx — zero behavior change.
- `briefing/copy.ts`: `BRIEFING_EMPTY` gains 4 new keys (`sources-unreachable`, `no-results`,
  `no-required-match`, `already-delivered`), each `{title, line}` only (the action buttons are
  proven, by reading BriefingEmpty's JSX, to always read from the fixed `.error`/`.empty` entries
  regardless of `reason` — ruling 6 "buttons stay wired exactly as today" holds by construction,
  not by a new conditional). Exact copy: ruling §1bb.1's 4 quoted strings, split at the first
  sentence boundary into title/line (matches the guide-draft-title match for 3 of 4 entries and
  the manager's visible pattern of shortening guide's draft LINE for the other 2). ASSUMPTION
  FLAGGED for A/manager: ruling gave no second sentence for `already-delivered`; guide's own
  draft line for it ("Every match for today was already in your feed. Check back after it
  refreshes, or widen your topics.") was never contradicted, so it is reused verbatim rather than
  invented. This is a copy-wording gap, not a fact needed to compute a code, so it is not an
  ESCAPE-CLAUSE stop — flagged here for visibility instead.

### Tests (target: guide's 12, adapted where the ruling fixed a POLICY choice the guide had left
open; extra protective tests added where reading the real code found a real risk)
1. pipeline: sources-unreachable (single source rejects).
2. pipeline: no-results (all sources resolve empty).
3. pipeline: no-results (stale — everything outside the freshness ceiling).
4. pipeline: no-required-match (no topic overlap).
5. pipeline: no-required-match (topic overlap but reader's own exclusion term hits).
6. pipeline: already-delivered via excludeIds, and via ledgerExclusions (2 cases).
7. pipeline: precedence — partial source failure + 0 in-window => no-results, not
   sources-unreachable; gate-then-excluded => already-delivered, not no-required-match (2 cases).
8. route: ADAPTED to the actually-ruled option (a) "live-only" (no DashboardBatch persistence):
   (a) first mint of an empty day carries the live emptyReasonCode; (b) a same-day replay of an
   EXISTING batch never carries it, even though the original mint's own pipeline computed one —
   this is the correct behaviour of "live-only", not the guide's literal "returns the identical
   code on replay" wording, which describes option (b) (persisted on DashboardBatch), the option
   NOT ruled. (c) extra: a request that LOSES the mint race must not leak its own pipeline's code
   onto the winner's frozen response.
9. pipeline: non-empty regression — `items.length > 0` => `meta` has no `emptyReasonCode` key.
10. store: mocked /api/feed 200 with `items: []` + `meta.emptyReasonCode` => store field is set;
    field omitted => store field stays null, no crash.
11. empty-reason.ts: each of the 4 codes returned verbatim; feedError beats reasonCode;
    intentRequired beats reasonCode; isLoading/papersCount>0 beats reasonCode regardless of
    reasonCode; absent/unrecognized reasonCode => "empty" (named test, the literal
    stay-silent-rather-than-guess contract).
12. copy.ts: the 4 new BRIEFING_EMPTY entries carry the exact ruled text. Attempted: export
    BriefingEmpty + render it (renderToStaticMarkup, mirroring page.test.tsx's existing
    ReadingStrip pattern) to prove the two action buttons render identically for every non-error
    code and the Try-again/Edit pair is untouched for "error" — will fall back to a source-text
    check (page.test.tsx already has this exact fallback pattern for this exact "no harness for
    the whole page" situation) if Link/router rendering proves unworkable in this test environment.

### Mutations (restore by editing back; prove by hash)
- Swap the `no-results`/`no-required-match` checks in `computeEmptyReasonCode` => a precedence
  test (item 7) goes red; restore; hash the file before/after to prove byte-identical restore.
- Remove the `emptyReasonCode` line from the store's `paperUpdate` => the store test (item 10)
  goes red; restore; hash before/after.

### Gates
Run from web/, one at a time, BEFORE the first edit and AFTER: `npx vitest run`, `npx tsc --noEmit`,
`npx eslint .`, `npm run build`. Baseline expected: 286 files (283 + 3 skipped) / 5165 passed + 6
skipped, tsc 0, eslint 0 errors / 151 warnings, build OK.

## Log
- 12:01Z — checkpoint created, plan above written before any edit.
- 12:0xZ — BEFORE gates, all matched the expected baseline exactly:
  `npx vitest run` -> 283 passed + 3 skipped (286 files) / 5165 passed + 6 skipped.
  `npx tsc --noEmit` -> 0 errors.
  `npx eslint .` -> 0 errors, 151 warnings.
  `npm run build` -> succeeded, same route list.
  Starting edits.
- 12:2xZ — Core implementation edits done, `npx tsc --noEmit` clean (0 errors) after all of them:
  - web/src/lib/feed/types.ts — `FeedEmptyReasonCode` + `FeedMeta.emptyReasonCode?`.
  - web/src/lib/feed/pipeline.ts — `computeEmptyReasonCode()` helper (colocated with
    `everySourceFailed`/`errorsFromSourceStatus`) + call site at the tail of `runFeedPipeline`,
    conditional-spread into `meta` (same idiom as `rrf`/`finalPool`).
  - web/src/app/api/feed/route.ts — `frozenFeedResponse()` gained an optional 6th param;
    threaded through ONLY at the mint call site and ONLY when `wonMintRace` is true (see the
    FINDING in the plan above); the "existing batch" replay call site is untouched (stays
    structurally absent).
  - web/src/lib/feed/empty-reason.ts — `EmptyReason` widened (`FeedEmptyReasonCode` imported
    from types.ts, `"empty"` kept explicit); `emptyReason()` gained `reasonCode`, checked after
    `feedError`, before the `"empty"` fallback.
  - web/src/store/feed.ts — `RealFeedResult.emptyReasonCode`, forwarded in `fetchRealFeed`;
    `FeedState.emptyReasonCode`, initial `null`, reset alongside `feedError` pre-lane, set in the
    same `set()` call as `papers` on success.
  - web/src/app/page.tsx — reads `emptyReasonCode` from the store, passes it as `emptyReason()`'s
    `reasonCode`; `BriefingEmpty` exported (was module-private, zero behavior change) and its
    `reason` prop widened to the full `EmptyReason`.
  - web/src/lib/briefing/copy.ts — `BRIEFING_EMPTY` gained the 4 new `{title, line}` entries per
    §1bb.1's exact wording; `no-results` reuses `empty`'s title/line via shared named constants
    (byte-identical, not retyped) per the ruling's "(today's words)".
  Next: tests.
- 12:1xZ — New file web/src/lib/feed/empty-reason-code.test.ts (10 pipeline-level tests: 1
  sources-unreachable, 2 no-results, 2 no-required-match, 2 already-delivered, 2 precedence, 1
  non-empty regression). FINDING while building fixtures (confirmed by running the tests, not
  assumed): `buildPaperPool` (pipeline.ts) runs the SAME Required-gate scoring at BUILD time,
  against the SAME `req`, before anything is cached — so inside one black-box fresh-build call, a
  gate-failing or reader-excluded candidate never survives into `pool.items` at all, and
  "gate rejected it" collapses into the same observable shape as "nothing was ever fetched"
  (both read as `inWindow.length === 0` -> no-results). First draft of the no-required-match
  tests got "no-results" instead — confirmed the fixtures were wrong, not the production code, by
  reading `buildPaperPool`'s own return statement (`items: tier2.items.slice(...)` where
  `tier2.items` traces straight back through `rankedForJudgment`/`tier1Ranked` to the build-time
  gated `scored`). Fixed by using two real, already-existing pipeline mechanisms that ARE
  observable from outside a single build: (1) `rolloverCandidates` — merged in at READ time,
  after the cache read, never through the build-time gate (used for the topic-mismatch case); (2)
  a two-call same-cache read where the SECOND call's `req` adds a reader exclusion that
  `derivePoolCacheKey` (confirmed by reading it) does not include in the pool's identity, so it's
  a genuine cache hit whose read-time-only re-score is what drops the candidate (used for the
  exclusion variant). All 10 tests pass: `npx vitest run src/lib/feed/empty-reason-code.test.ts`.
  Next: empty-reason.test.ts, feed.test.ts (store), route.test.ts, copy/render tests.
- 12:2xZ — empty-reason.test.ts extended (test 11, 8 new cases via `it.each` + 4 named tests; 12
  total in file). FINDING + FIX: `emptyReason()`'s first draft only checked `if (input.reasonCode)`
  (truthiness), which would have RENDERED an unrecognized/future code verbatim instead of falling
  back to "empty" — caught by actually running the "unrecognized reasonCode" test before trusting
  it, not assumed. Fixed by adding `FEED_EMPTY_REASON_CODES` (a runtime-checkable array twin of
  the type, in types.ts) and validating membership, not just truthiness, in `emptyReason()`. All
  12 pass.
- 12:3xZ — store: 3 new tests in feed.test.ts (capture in the same set() as papers; stays null and
  never crashes when the server sent none; cleared before a new load so a later failure never
  shows a stale reason). Full file: 111/111 pass (108 pre-existing + 3 new), nothing else broken.
- 12:4xZ — route.test.ts: 3 new tests, adapted to the ACTUALLY-ruled option (a) "live-only" (see
  the FINDING in the plan section — the guide's literal test-8 wording describes persisted-on-
  DashboardBatch option (b), which was not ruled): (1) first mint carries the live code; (2) a
  same-day replay never carries it, even though the mint's own pipeline computed one; (3) EXTRA —
  a request that loses the mint race (constructed deterministically via individually-mocked
  ledger methods, not a real `Promise.all` race, since a real race's winner is genuine
  non-determinism the existing "(16m-batch/d)" test already only checks for consistency, never a
  specific winner) never leaks its own code onto the winner's frozen response. Full file: 73/73
  pass (70 pre-existing + 3 new).
  Next: copy.ts data test + BriefingEmpty render test (test 12), then mutations, then final gates.
- 12:5xZ — Test 12, two parts: (1) new web/src/lib/briefing/copy.test.ts (6 tests) pins the exact
  ruled title/line text for all 4 new codes, proves `no-results` is byte-identical to `empty` (not
  retyped), and that `error`/`empty` are untouched. (2) Exported `BriefingEmpty` from page.tsx
  (zero behavior change) and added a render describe block to page.test.tsx (7 tests, same
  `renderToStaticMarkup` pattern this file already established for `ReadingStrip` — this repo has
  no @testing-library/react anywhere, confirmed by re-reading this file's own header comment, so
  static-markup rendering is the idiomatic, already-precedented choice, not testing-library):
  6 parameterized cases (one per EmptyReason value that isn't "error") each assert the right
  title text AND that the SAME Refresh/Widen-topics pair renders, proving ruling §1bb.6 by
  actually rendering, not just by reading the JSX; 1 case proves "error" still renders its own
  distinct Try-again/Edit-topics pair. FINDING, caught by running the tests rather than trusting
  them: my first draft's expected strings used straight ASCII apostrophes inside full sentences
  ("Couldn't reach..."), which React's `renderToStaticMarkup` escapes to `&#x27;` in text content
  — 3 tests failed on a markup/assertion mismatch, not a real bug. Fixed by matching
  apostrophe-free substrings instead (the existing `error` entry's copy uses a typographic ’
  U+2019, which is not an HTML-reserved character and needed no such change). All 10 tests in the
  file pass (3 pre-existing + 7 new).
  All new/extended test files now green individually. Next: mutations, then full gate suite.
- 13:0xZ — Mutations, both restored and hash-verified byte-identical:
  1. pipeline.ts `computeEmptyReasonCode`: swapped the no-results/no-required-match steps.
     Hash before: A4EE168DF38FA0F5F1B8BC01BF8579DA1D3F215C647AFA8FF3190E2D931FEA9E. 3 tests in
     empty-reason-code.test.ts went red (both "no-results" tests + the sources-unreachable
     precedence test), all failing the same way (expected "no-results", got "no-required-match").
     Restored; hash after: A4EE168DF38FA0F5F1B8BC01BF8579DA1D3F215C647AFA8FF3190E2D931FEA9E
     (identical). Re-ran: 10/10 green again.
  2. store/feed.ts: removed the `emptyReasonCode: realFeed.emptyReasonCode ?? null,` line from
     the papers-lane `paperUpdate`. Hash before:
     3AD3857ECE9B2C4B707120F1E45D48345E61831D2E01120E5AEDAE7E9F2261F0. 2 of the 3 new store
     tests went red (the capture test and the stale-clearing test; the third — "stays null when
     the server sent none" — correctly still passed, since removing the forwarding line still
     leaves the field null in that specific case). Restored; hash after:
     3AD3857ECE9B2C4B707120F1E45D48345E61831D2E01120E5AEDAE7E9F2261F0 (identical). Re-ran:
     111/111 green again.
  No existing test was deleted or weakened at any point. Next: full gate suite (AFTER).
- 13:1xZ — AFTER gates, all from web/:
  `npx vitest run` -> 285 passed + 3 skipped (288 files) / 5202 passed + 6 skipped (baseline
  5165 + 6 skipped; +37 new tests, all in files touched by this item, accounted for exactly:
  10 empty-reason-code.test.ts (new) + 8 empty-reason.test.ts + 3 feed.test.ts (store) +
  3 route.test.ts + 6 copy.test.ts (new) + 7 page.test.tsx = 37).
  `npx tsc --noEmit` -> 0 errors (same as baseline).
  `npx eslint .` -> 0 errors, 151 warnings (identical to baseline — no new warnings).
  `npm run build` -> succeeded, identical route list to baseline.
  `git status --short` reviewed: every change is one of the 11 files listed in the plan above,
  plus this checkpoint and the 2 new test files; `ABC-JEV-INTEGRATION.md`, the B guide file and
  `node_modules/` were already dirty/untracked before this session started (per the task's own
  git-status snapshot) and were not touched by me. No env file opened, no personal name/email/
  profile path written anywhere, no state-changing git run.

STATUS: IMPLEMENTED_PENDING_REVIEW. Ready for a fresh A.

## Fix round (manager, 2026-09-29T16:5xZ)

Fresh A FAILED_REVIEW (docs/jev-abc/EMPTY-STATE-REASON-A-20260929T122243Z.md) on one HIGH: the
manager's own §1bb.1 copy for `no-required-match` — "None of today's papers matched your Required
topics." — can be false, because that code also covers papers removed by the reader's own
declared exclusions (combine.ts, before the gate) and by the review-paper filter (after a genuine
topic match), so a paper that DID match can still land in this bucket. Everything else A checked
held (code vs ruling, route.ts wonMintRace gating, 37 real tests, both mutations reproduced
independently, gates, a live local check) — see the §1bb CORRECTION for the full text. The
already-delivered line C reused from B's draft was separately signed off (LOW, no change needed).

Ruled fix, implemented verbatim, nothing else in the copy touched:
- `no-required-match` title: "None of today's papers matched your Required topics." ->
  "None of today's papers passed your Required topics and filters."
- `no-required-match` line: "Try a broader topic in Profile." -> "Try a broader Required topic in
  Profile."

Changed: web/src/lib/briefing/copy.ts (the one entry, plus a comment recording why). Tests
rewritten (not deleted) to pin the new text: web/src/lib/briefing/copy.test.ts (the
"no-required-match" case renamed and its expected strings updated) and web/src/app/page.test.tsx
(the `it.each` row's matched substring updated from "matched your Required topics." to "Required
topics and filters."). Grepped web/src for every remaining occurrence of the old strings after
editing: none left outside explanatory comments recording the history of the change.

Gates re-run from web/, one at a time, after the copy fix:
- `npx vitest run` -> 285 passed + 3 skipped (288 files) / 5202 passed + 6 skipped, 0 failed —
  identical totals to the pre-fix-round run (same tests, updated expectations, all green).
- `npx tsc --noEmit` -> 0 errors.
- `npx eslint .` -> 0 errors, 151 warnings (unchanged).
- `npm run build` -> succeeded, same route list.

Nothing BLOCKED, no escape clause triggered, no state-changing git, no env file opened, no
personal string written.

STATUS: IMPLEMENTED_PENDING_REVIEW
