STATUS: IN_PROGRESS

# QUERY-DISLIKE — C (implementer)

Role: C (implementer). Branch Jev-integration-and-sorting-filtering-enhancement,
HEAD b5ffc8c1. The ONLY writer of repo product files until this checkpoint
reports done. Two items, two parts, disjoint files, per §1bs.7 / §1br.5:

- PART 1 — QUERY-GENERIC-WORDS (ABC-JEV-INTEGRATION.md §1bs), in
  web/src/lib/feed/profile-compiler.ts (+ pool-cache.ts's cache version).
- PART 2 — DISLIKE-CHANNEL (ABC-JEV-INTEGRATION.md §1br), in
  web/src/lib/scoring/combine.ts (+ only what grep proves dead elsewhere).

Read first (binding): ABC-JEV-INTEGRATION.md §1bs, §1br, §1bo.9(a) (folded
into §1bs.3), §1ay, §1az, §1at + its CORRECTION. Guides:
docs/jev-abc/QUERY-GENERIC-WORDS-B-20260930T090811Z.md,
docs/jev-abc/DISLIKE-CHANNEL-B-20260930T083933Z.md. AGENTS.md, web/AGENTS.md.

## Plan

### Part 1 — QUERY-GENERIC-WORDS (§1bs)

1. In `phrasesFromText`'s keyword step (profile-compiler.ts), add a token
   filter removing (i) a standalone 4-digit year 1900-2099, (ii) a
   number+unit token whose unit is in a closed, stated, commented list
   (bare "l"/"m" excluded so "316L" survives), (iii) a bare decimal with no
   letters ("99.9"). Every other token stays (bare non-year integers are an
   accepted cost, per the ruling).
2. Chunk splitter: never split on a period between two digits (lookaround
   regex), so "3.7V" / "99.9%" / "GPT-3.5" stay whole; every other period
   still splits as before.
3. §1bo.9(a): add em dash (U+2014), en dash (U+2013), ellipsis (U+2026) as
   chunk delimiters alongside the existing comma/semicolon/colon/newline.
4. pool-cache.ts: PAPER_CACHE_KEY_VERSION 20 -> 21, extending the doc chain
   with a v21 paragraph.
5. Tests in profile-compiler.test.ts for each case; re-run the guide's
   62-text corpus set diff against the new code (HEAD extracted read-only
   via `git archive HEAD web/src`, never stash/checkout/worktree); mutation
   proofs (sha256-verified restores, byte-exact, matching line endings).

### Part 2 — DISLIKE-CHANNEL (§1br)

1. Delete `negativePenalty` (x0.15) and `legacyDislikePenalty` (x0.65) from
   combine.ts, their call sites, and the now-provably-dead
   `isProtectedRequiredTopic` helper (grep-confirmed: only caller was
   `legacyDislikePenalty`). Remove the two now-dead `ScoringProfile` fields
   from scoring/types.ts and their wiring in feed/pipeline.ts
   (`scorePaperCandidates`), updating that function's stale doc comment.
   `profile.exclusions` / the hard-drop filter stay untouched. Request
   shapes (FeedRequest.negativeTopics) stay accepted — that field is a
   separate, still-alive input to profile-compiler.ts's `avoid` list and to
   intent.ts's exclusions fallback; only the dead ScoringProfile-level
   fields and combine.ts functions are removed.
2. Rewrite (never delete) negative-penalty.test.ts to the new contract
   (`profile.exclusions`, hard drop, absent not demoted) — comment
   "DISLIKE-CHANNEL (§1br)". Checked pipeline.score-zero.test.ts,
   admission.test.ts, test-digest/route.test.ts, channel-comparison.test.ts
   for overlap/impact first (by reading + grep): only negative-penalty.test.ts
   references the deleted ScoringProfile fields; the other three test a
   different layer (the real request-shape path through intent.exclusions,
   or a mocked runFeedPipeline call) and need no change.
3. No cache bump (score-identical for every real request, per the
   CORRECTION's own proof) — prove with a before/after run over the saved
   pools in <scratchpad>/out/ using the real scoreItems, real request shape
   (dislikes in exclusions, as every caller sends).
4. Tripwire test (new, in store/feed.test.ts — the only place
   `notInterestedPaper` can be exercised): pins that `notInterestedPaper`
   writes only to the preference ledger, never to `dislikedTopics`/any
   exclusion list. Doc comments at combine.ts's exclusion site and on
   `dislikedTopics` in types/index.ts. Mutation: make notInterestedPaper
   also append to dislikedTopics -> tripwire red (restore byte-exact).

### Process

Gates after each part from web/: `npx vitest run`, `npx tsc --noEmit`,
`npx eslint .`, `npm run build` (retry once on a network font fetch
failure). Baseline at HEAD b5ffc8c1: 294 files (291+3 skipped) / 5664
passed + 6 skipped / 0 failed; tsc 0 errors; eslint 0 errors / 151 warnings;
build OK.

No network; no peer.homes/localhost:3000/Supabase/any route; no commit/
push/stash/checkout/worktree/branch. Never open/print web/.env*. No API key
written anywhere. No person's name anywhere in anything written. Scratchpad
referred to only as "<scratchpad>/...". Temp files only in scratchpad,
docs/jev-abc/, or web/src/__c_qd_probe_* (deleted + git-status-proven
after). A read-only investigator runs concurrently (probes in scratchpad
only) — no collision expected since this C only writes profile-compiler.ts,
pool-cache.ts, combine.ts, scoring/types.ts, feed/pipeline.ts,
types/index.ts, and the listed test files.

## Progress log

- 2026-09-30T10:40:19Z — checkpoint created, plan above. Read-first docs and
  target source files done. Starting Part 1 implementation.
- 2026-09-30T10:58:03Z — **PART 1 (QUERY-GENERIC-WORDS, §1bs) IMPLEMENTED_PENDING_REVIEW.**

  Changed files:
  - web/src/lib/feed/profile-compiler.ts — added `isGenericNumericToken`
    (+ `LEADING_NUMBER`, `CLOSED_MEASUREMENT_UNITS`, `STANDALONE_YEAR`),
    wired into the keyword-tier filter chain; chunk-split regex changed to
    (a) never split a period between two digits (lookaround) and (b) treat
    em dash (U+2014), en dash (U+2013), ellipsis (U+2026) as delimiters.
  - web/src/lib/opportunities/pool-cache.ts — PAPER_CACHE_KEY_VERSION 20 ->
    21, doc chain extended with a v21 paragraph.
  - web/src/lib/feed/profile-compiler.test.ts — new describe block
    "QUERY-GENERIC-WORDS (§1bs)", 16 new test cases (year/unit/decimal
    removal x3 + the short-fragment pin + the required-survivor designation
    list via a 3-group it.each + the accepted-cost "1000" case + the
    decimal-chunk case + em-dash/en-dash/ellipsis x4 + the shared-function
    placement case (challenge -> activeQuestions/seedTexts) + a named
    byte-identical regression pin for the pre-existing QUERY-BUDGET/
    ABBREV-RECALL output). Added the `briefToSeedTexts` import. No
    pre-existing test deleted or weakened; none needed rewriting (verified
    no pinned array in this file already contained a bare number/year/unit
    token, by inspection, so this item's filter had nothing to touch there).
  - web/src/lib/opportunities/pool-cache.test.ts — the one pre-existing
    test asserting the exact papers cache-version prefix REWRITTEN (never
    deleted) from v20 to v21, comment "QUERY-GENERIC-WORDS (§1bs)"; the
    adjacent "not v5" test's running version-history comment extended with
    a v21 entry, same convention every prior bump in that comment used.

  Units-closed-list decided and stated (in-code comment,
  profile-compiler.ts): v, mV, A, mA, mAh, Ah, Wh, kWh, Wh/kg, W, kW, Hz, K,
  (bare "c" standing in for °C — see comment for why the degree sign never
  survives to this step), nm, µm, mm, cm, g, mg, kg, mL, µL, mM, µM, %, h,
  min, s, ms, ppm, eV, GPa, MPa, S/cm, B — the ruling's own example list
  verbatim; bare "l"/"m" deliberately excluded. "k" (Kelvin) and "c"
  (Celsius) are accepted-cost short letters, same spirit as the "1000" cost.

  Corpus set-diff (guide's own 62-text corpus, reused verbatim from
  <scratchpad>/qgw-corpus.mjs): fresh HEAD b5ffc8c1 extracted read-only via
  `git archive HEAD web/src | tar -x -C <scratchpad>/c-qgw-head` (never
  stash/checkout/worktree). Before: 147 distinct single-word tier entries.
  After (this round's live code): 141. REMOVED (7): -40c, 175b, 2024, 3.7v,
  45ma, 500wh/kg, 99.9 — every one classified YEAR/NUMBER/UNIT by the
  guide's own §3 table; 0 domain words removed, 0 generic words removed
  (cross-checked against the guide's own published 72-domain/65-generic
  lists programmatically). KEPT, as expected/required: "1000" (accepted
  cost, non-year bare integer, per §1bs.1 verbatim), "2023" and
  "500Wh/kg"(original case) — both survive ONLY via the untouched literal-
  query-passthrough / phrase-chunk paths for the two single-token corpus
  fixtures (c-edge-6 "2023", c-edge-7 "500Wh/kg") — correct, since the
  ruling scopes the filter to the keyword step alone. ADDED (1): "solid" —
  traced to c-batt-4: the decimal-chunk fix removes a corrupted, nonsense
  mid-sentence phrase fragment ("9 percent over 500 cycles at room
  temperature", produced by the OLD decimal-blind splitter) that used to
  occupy 1 of that call's 8 slots; with it gone the next genuine sentence
  word ("solid", part of "solid polymer electrolytes") fills the freed
  slot instead — a positive, explained side effect of fixing the Q1-note-3
  bug, not a defect. Full verdict: PASS, no domain or generic word lost.

  Mutation proofs (profile-compiler.ts, sha256-verified byte-exact restore
  before: 0bbdd2d67ba75d7981e612d7aefabf00a9092d1d319a3476f2e3787a2eb30ff6,
  same after each restore; LF line endings preserved throughout, confirmed
  no CR bytes introduced):
  1. Dropped the unit-list check (`return true` unconditionally) ->
     2 of 3 designation-survivor `it.each` cases went red (the two groups
     containing digit-first tokens: 18650/21700/7075/316L and
     1T-MoS2/4H-SiC; the letter-first LiCoO2/NMC811/GPT-4 group correctly
     stayed green, confirming the mutation's effect is real and scoped).
  2. Reverted the decimal-safe split back to splitting on every period ->
     the "never splits a chunk at a period between two digits" test went
     red (reproduced the exact corrupted fragment "Cells reached 3").
  3. Removed the dash/ellipsis delimiters from the split character class ->
     all 3 dash/ellipsis tests went red.
  All three restored byte-exact (sha256-verified) before proceeding.

  Gates (web/): `npx vitest run` — 291 passed + 3 skipped (294 files) /
  5679 passed + 6 skipped / 0 failed. `npx tsc --noEmit` — 0 errors.
  `npx eslint .` — 0 errors / 151 warnings (matches baseline exactly).
  `npm run build` — OK (compiled, typechecked, 29/29 static pages), no
  retry needed.

  Starting Part 2 (DISLIKE-CHANNEL, §1br) now.

- 2026-09-30T11:08:23Z — **PART 2 (DISLIKE-CHANNEL, §1br) IMPLEMENTED_PENDING_REVIEW.**

  Changed files:
  - web/src/lib/scoring/combine.ts — deleted `isProtectedRequiredTopic`,
    `negativePenalty` (×0.15), `legacyDislikePenalty` (×0.65) (grep-confirmed
    `isProtectedRequiredTopic` had no other caller); deleted their two call
    sites and the `policyPenalty`/`legacyPenalty` factors from the `combined`
    formula; `profile.exclusions`/the hard-drop filter left untouched. Added
    a doc comment at the exclusion site (`const exclusions = ...`) and a doc
    comment where the deleted functions used to live.
  - web/src/lib/scoring/types.ts — removed `negativeTopics`/
    `legacyNegativeTopics` from `ScoringProfile` (2 lines).
  - web/src/lib/feed/pipeline.ts — `scorePaperCandidates` no longer maps
    `req.negativeTopics` onto the two deleted `ScoringProfile` fields;
    rewrote its stale doc comment (it named `negativePenalty` by name).
  - web/src/lib/feed/types.ts — **correction found by `tsc`, not anticipated
    going in**: `FeedRequest extends ScoringProfile`, so `FeedRequest`'s own
    `negativeTopics` was INHERITED from `ScoringProfile`, not separately
    declared — deleting it from `ScoringProfile` broke 4 real, still-alive
    call sites (api/feed/route.ts:837, api/jobs/dispatch-digests/route.ts,
    api/test-digest/route.ts, profile-compiler.ts's `avoid`-list construction)
    that read/write `req.negativeTopics` for a SEPARATE, still-live mechanism
    (feeding `SearchBrief.avoid`, unrelated to `ScoringProfile`/combine.ts
    scoring). Fixed by giving `FeedRequest` its own `negativeTopics?:
    string[]` field (with a doc comment explaining the split) instead of
    inheriting it — `tsc --noEmit` went from 4 errors to 0 after this;
    `legacyNegativeTopics` had no such other caller (grep-confirmed) and
    needed no replacement anywhere.
  - web/src/types/index.ts — rewrote the `dislikedTopics` doc comment (the
    OLD comment was itself stale/inaccurate post-fix — it said "rank lower,"
    which is no longer what happens even if this field were ever written):
    now states the hard-drop behaviour, that no UI writes it today, and the
    required tripwire language verbatim ("a substring hard drop — never
    wire one-click feedback to it; reader 'less of this' goes through the
    preference ledger").
  - web/src/lib/scoring/negative-penalty.test.ts — REWRITTEN, NOT DELETED,
    to the new contract (`profile.exclusions`, hard drop, item absent —
    not demoted to ×0.15); same 3 scenarios/fixtures kept for continuity
    (including the review-shaped-item scenario's original point: only an
    actually-declared term excludes, never mere review-shapedness); every
    changed assertion commented "DISLIKE-CHANNEL (§1br)".
  - web/src/store/feed.test.ts — new tripwire describe block: calls the
    real `notInterestedPaper` + `commitDismiss` (store/feed.ts:2327/2857,
    unmodified) on a fictional fixture paper and asserts
    `profile.dislikedTopics` stays `[]` while `profile.preferenceLedger`
    gains a real negative entry — proving "writes only to the ledger,
    never to dislikedTopics" is not vacuous.

  Overlap check before touching tests (by reading + grep, per the ruling):
  pipeline.score-zero.test.ts (tests the real end-to-end `intent.exclusions`
  path through `runFeedPipeline`, never references the deleted functions by
  name — needed NO change, confirmed by the gate run), admission.test.ts
  (already covers `profile.exclusions` as a hard drop, different fixture
  domain — needed no change), test-digest/route.test.ts (tests the DIGEST
  ROUTE's own `FeedRequest` construction against a mocked `runFeedPipeline`,
  unrelated to `ScoringProfile` internals — needed no change),
  channel-comparison.test.ts (grep-confirmed: no reference to either
  field/function at all).

  No cache bump (PAPER_CACHE_KEY_VERSION stays 21, from Part 1) — proved
  score-identical instead, per the ruling. Before/after run over 27 real
  saved pool files in <scratchpad>/out/ (path passed only via the
  C_POOL_DIR environment variable, never hardcoded in the script), 806
  total items, 640 compared after exclusions (the rest were excluded
  identically on both sides), using the real, unmodified `scoreItems` via
  the same before(HEAD b5ffc8c1)/after(live tree) hook pair Part 1 used.
  Real request shape: for every pool, a dislike term derived from that
  pool's own first item's own title (guarantees a genuine, non-vacuous
  match per file, no hand-curation); the BEFORE profile carried
  `exclusions`+`negativeTopics`+`legacyNegativeTopics` together (the exact
  shape every real caller sent, per pipeline.ts's old wiring), the AFTER
  profile carries only `exclusions` (the real shape now). Several older
  saved fixtures predate `scoreItems`'s current required fields
  (`authors`/`url`/`metadata` missing) — backfilled identically on both
  sides before scoring (disclosed in the script; never conditioned on
  before/after, so it does not affect the comparison's fairness). Result:
  **0 score differences, 0 survivor-set differences** across all 640
  compared items.

  Mutation proofs (sha256-verified byte-exact restores; line endings
  preserved — feed.ts is CRLF in the working tree per `git ls-files --eol`,
  confirmed unchanged):
  1. store/feed.ts sha256 before:
     e2ed319b6ac272512a9745bca3921812e269c01ae379d40469669eda4d5c6cde.
     Made `notInterestedPaper` also append the dismissed paper's title to
     `useProfileStore`'s `profile.dislikedTopics` -> the tripwire test went
     red (`expected [ 'Dismissal tripwire fixture paper' ] to deeply equal
     []`). Reverted; sha256 after matches exactly; tripwire test green
     again.

  Gates (web/), re-run after an additional fix (below): `npx vitest run` —
  291 passed + 3 skipped (294 files) / 5680 passed + 6 skipped / 0 failed
  (+1 over Part 1's 5679, exactly the new tripwire test — negative-penalty
  rewrite kept the same test count, 3 -> 3). `npx tsc --noEmit` — 0 errors
  (see feed/types.ts fix above; first run surfaced 4 real errors, all
  resolved by that one type-level fix, not by touching any of the 4
  call sites). `npx eslint .` — 0 errors / 151 warnings (matches baseline
  exactly). `npm run build` — OK (compiled, typechecked, 29/29 static
  pages), no retry needed.

## STATUS: IMPLEMENTED_PENDING_REVIEW (both parts)

Both parts done as ruled, in two disjoint-file writes inside one session.
No pre-existing test deleted or weakened. Every changed assertion carries
its ruling comment. All mutations proven red and byte-exact restored. No
cache bump beyond Part 1's 20->21 (Part 2 proved score-identical, per the
ruling — no bump taken for it). No network call, no commit/push/stash/
checkout/worktree/branch operation, no `.env*` opened, no API key written,
no person's name written anywhere in code/tests/this file. Full `git
status` at the end shows exactly the 12 product/test files listed above
plus this checkpoint — nothing else under `web/`, no root-level temp
files, no `web/src/__c_qd_probe_*` left behind (none were ever created —
every experiment ran from `<scratchpad>/`). `ABC-JEV-INTEGRATION.md`
(pre-existing modification, not by this session) and
`docs/jev-abc/ACCOUNT-SWITCH-B-20260930T103019Z.md` (the concurrent
read-only investigator's own file) are visible in `git status` but were
not written by this C.
