STATUS: IMPLEMENTED_PENDING_REVIEW

# REQUIRED-GATE — C (implementer) checkpoint

Role: C (implementer). Rulings: ABC-JEV-INTEGRATION.md §1ao (binding), §1an + AMENDMENT, §1c.
Guide: docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md (STATUS COMPLETE).
Phase 1 (read-only + scratchpad re-measurement) is done. This file is my only write inside the repo
for phase 1. No product file has been touched.

## 1. Re-measured §1ao.1 TAG-ANCHORED T4 (phase 1 required step)

Rule re-measured: T4 admits when `simTopic >= 0.15` OR (`simTopic > 0` AND `simProject >= 0.05`),
vs B's unanchored `simTopic >= 0.15 OR simProject >= 0.05`. Ran entirely in the scratchpad
(`C:/Users/USER/AppData/Local/Temp/claude/D--local-files-on-this-PC-Github-Peer-peer/cbb72ccd-c5d2-41fc-9546-107a594bc7fa/scratchpad/analyze4-anchored-t4.mjs`,
a copy of B's `analyze3.mjs` with only the T4 predicate changed), reading B's saved
`out/raw-*.json`/`out/tagged-*.json` verbatim — **zero new external calls**. Output saved to
`out/T-report-anchored-*.json` / `out/T-all-reports-anchored.json`, alongside B's original
`out/T-report-*.json` (untouched).

| Profile | Pool/inWindow | T1 | +T2 | +T3 | +T4 ANCHORED | **Total anchored** | vs B unanchored total | Rejected (anchored) |
|---|---|---|---|---|---|---|---|---|
| P1 long tags | 30/27 | 4 | 0 | 0 | 13 | **17/27 (63%)** | 20/27 (74%) | 10 |
| P2 short tag | 100/62 | 56 | 0 | 0 | 0 | **56/62 (90%)** | 57/62 (92%) | 6 |
| P-LCO | 50/3 | 3 | 0 | 0 | 0 | **3/3 (100%)** | 3/3 (100%) | 0 |
| P4 wrong-sense trap | 150/145 | 91 | 0 | 0 | 0 | **91/145 (63%)** | 95/145 (66%) | 54 |

**ESCAPE CLAUSE CHECK (§1ao.1): NOT triggered.** P1 anchored = 17/27 (63%), which is ABOVE the
16/27 (60%) floor. Proceeding is authorized; both variants are reported above for the record anyway.

**Biofilm false positive (the case the ruling exists to fix): CONFIRMED REJECTED under anchoring.**
`pubmed:42603427`, "A proton-gated gold nanocluster platform for disrupting biofilm bioenergetics and
suppressing virulence in bacterial infections." — `simTopic=0`, `simProject=0.079`. Anchored rule
requires `simTopic > 0` before `simProject` can admit; this item's `simTopic` is exactly 0 against the
tag `"electrolyte"`, so it is rejected. All 4 of P4's unanchored-T4-only admits are removed by
anchoring (the other 3 — an Ag-nanoparticle MOF sodium-ion battery paper, a Zn/H co-insertion cathode
paper, a solid-state supercapacitor paper — are battery-adjacent but never mention "electrolyte"
either; excluding them looks like a precision improvement, not a loss).

**Honest caveat — 2 of P1's 3 anchor-removed items are genuine on-topic papers lost to the
already-known, already-deferred plural-blindness bug (§1ao.5/TOKENIZE-PLURALS), not to anchoring
being wrong.** `openalex:W4416056717` ("Microstructural insights into fast ion transport in **solid
electrolytes** via multiscale modeling") and `openalex:W7197006276` ("Raman Signatures of Lithium Ion
Dynamics in LLZO Garnet **Electrolytes**...") both say "electrolytes" (plural) but the tag is
"electrolyte" (singular); `tfidf.ts`/`tokenize.ts` do not stem, so the shared token never overlaps and
`simTopic` rounds to 0 — this is the exact mechanism guide §2.3 already documented, now hitting these
two items specifically. Anchoring's real, attributable-to-anchoring-itself cost in this sample is
closer to 1 defensible exclusion (P1's 3rd item, "Ionic Liquid Electrolytes for Extreme Temperature
Conditions" — debatable liquid-vs-solid relevance) + P2's 1 borderline exclusion (title never mentions
electrolyte at all) than "3 genuine losses" — reported honestly rather than rounded either direction.
This is evidence for, not against, taking TOKENIZE-PLURALS as a follow-up item; not a reason to change
the anchoring design here.

**Conclusion: proceed to phase 2 with the anchored T4 rule exactly as ruled in §1ao.1.**

## 2. RISK FINDING — the paper-pool cache version bump (§1ao.9) has a larger blast radius than a
   single-file constant change, and touches files outside my phase-2 allowed list

`PAPER_CACHE_KEY_VERSION` (the constant to bump, `web/src/lib/opportunities/pool-cache.ts:211`,
currently `6`) is **also hard-coded as the literal string `"peer-pool-v6-papers-"` in
`web/src/lib/opportunities/private-paper-cache.ts` at lines 134 and 158** — the guard on
`PrivatePaperPoolCache.get`/`.set`, the durable Supabase-backed store used for every **signed-in**
user's paper pool. That file is not in my allowed-file list (only "the pool-cache key/version file" —
singular, `pool-cache.ts` — is listed).

**If I bump the constant in `pool-cache.ts` alone:** `derivePoolCacheKey` starts producing
`peer-pool-v7-papers-...` keys, but `private-paper-cache.ts`'s guard still only accepts
`peer-pool-v6-papers-...`. Consequence for every signed-in user: `get()` always returns `null` (safe —
just forces a rebuild) but `set()` always silently no-ops (the guard fails before the Supabase call) —
so a freshly built pool is **never persisted** for a signed-in reader. Every single home-page load would
rebuild the day's pool from scratch (re-fetch all sources) instead of reading yesterday's cached build,
indefinitely, until this second file is also bumped. That's not a correctness bug (content stays
correct) but it is a real, silent performance/cost regression this task would introduce as a side
effect of fixing EMPTY-HOME — and it means the ruling's own goal ("old-rule pools are never served")
would be achieved for the private store only by accident (nuking the whole cache), not by clean
versioning.

**It also breaks the test suite in a way unrelated to my actual logic change**, because the same literal
`v6` is hard-coded into test assertions that call the real `derivePoolCacheKey`/pipeline (not just
private-paper-cache.ts's guard):
- `web/src/lib/opportunities/pool-cache.test.ts` lines **37, 46, 48, 84** — regex assertions like
  `/^peer-pool-v6-papers-.../` against `derivePoolCacheKey`'s real output. Would go red after the bump.
- `web/src/lib/feed/paper-daily-cache.test.ts` line **259** —
  `key.startsWith("peer-pool-v6-papers-")` against a real pipeline-derived key. Would go red.
- (Lines 310/345-346/365/460 of `pool-cache.test.ts`, and both hits in
  `channel-candidate-cache.test.ts`, use a `v6`-shaped string only as an arbitrary opaque example key
  for unrelated logic — single-flight coalescing, a different cache's prefix-refusal. These stay green
  and stay meaningful regardless of the real papers version; **no change needed there**, flagged only
  so the list above reads as complete, not partial.)
- `web/src/lib/opportunities/private-paper-cache.test.ts` lines **62, 66, 68, 70, 74** test the guard
  directly with hand-written keys (`"peer-pool-v6-papers-private"` expected accepted,
  `"peer-pool-v5-papers-unsafe"` expected rejected). These stay green even if `private-paper-cache.ts`
  is left unfixed (they'd just keep testing stale v6 behavior forever, masking the mismatch) — **only
  need updating if `private-paper-cache.ts` itself is fixed**, so the "accepted" example still
  represents the current version.

**What I need from the manager before or at "go":** either (a) add
`web/src/lib/opportunities/private-paper-cache.ts`, `web/src/lib/opportunities/pool-cache.test.ts`,
and `web/src/lib/feed/paper-daily-cache.test.ts` to my phase-2 allowed-file list (all three edits are
mechanical `6`→`7` text substitutions at the exact lines named above, zero logic changes — I'd also
touch `private-paper-cache.test.ts`'s 3 example-key lines for full hygiene, same mechanical kind), or
(b) explicitly accept deferring the durable-cache fix to a follow-up and tell me how to handle the two
test files that would otherwise go newly red (revert my bump entirely until the follow-up lands, which
re-opens EMPTY-HOME's private-cache path to serving old-rule pools for up to a day; or bump anyway and
report the 5 now-expected-red assertions as known, not part of my baseline). I recommend (a): the total
diff is ~10 lines across 4 files, all substitutions I've already located, no design judgment required,
and it's the only option that actually satisfies §1ao.9's stated intent for signed-in users too.

## 3. Implementation plan (phase 2 — will not start until "go")

### 3.1 keyword.ts — extend `scoreKeyword` with T2 and T3, gated behind a new opt-in flag

New named constants: `REQUIRED_TAG_T2_GROUNDING = 0.85`, `REQUIRED_TAG_T3_GROUNDING = 0.6`.

New opt flag on `scoreKeyword`'s `opts` (exact name TBD at edit time, e.g. `qualifyByTagConcept`):
**default `undefined`/false.** Reason this is necessary and not just convenient: `scoreKeyword` is a
SHARED function — besides `combine.ts`'s 2 calls, it is called 4 times each from
`web/src/lib/events/scoring.ts` and `web/src/lib/jobs/scoring.ts` (confirmed by grep), feeding
`passesRequiredGate` (`web/src/lib/opportunities/shared.ts`), which ruling §1ao.6 says stays
UNCHANGED. If T2/T3 ran unconditionally inside `scoreKeyword`, they would silently change
events/jobs' `matched`/`score` too, even though nothing in events/jobs code is being touched — a real
regression the guide's own path enumeration (1.4) flagged as a shared-primitive risk without fully
resolving it. The new flag is passed `true` only from `combine.ts`'s REQUIRED-topics call (not its
`softTopics` call — softTopics is a ranking bonus, not the qualification screen). Every existing
caller (events/scoring.ts, jobs/scoring.ts, term-expand.test.ts's ~10 direct `scoreKeyword(...)`
calls) omits the flag and is therefore byte-for-byte unaffected — this is what makes guide test 1 hold.

Inside the per-topic loop (`keyword.ts:66-75`), when the flag is on and T1 (`termMatches`) misses for
a topic: try T2 (self-declared abbreviation pair in the item's own raw title+abstract, extracted once
per item — porting B's measurement-validated regexes from `analyze3.mjs`'s `selfDeclaredPairs`
verbatim, since they're already proven against real data including the LCO/LIXS edge case in guide
§2.4) — on hit, push `topic` to `matched`, `raw += termSpecificity(canonicalTopic) *
REQUIRED_TAG_T2_GROUNDING`. Else try T3 (`termMatches` against each of `item.tags`, reusing
`expandTerm`/`termMatches` as-is — so the existing `["lco","lithium cobalt oxide"]` abbreviation
group already carries T3 for that case with zero new vocabulary, per guide §3.1) — on hit, same
push/raw pattern with `REQUIRED_TAG_T3_GROUNDING`. `term-expand.ts` itself is not modified.

### 3.2 combine.ts — T4 (tag-anchored similarity), wired around the untouched gate line

New named constants (exported, grep-able per §1ao.1): `REQUIRED_TAG_SIMILARITY_FLOOR_TOPIC = 0.15`,
`REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT = 0.05`, plus `REQUIRED_TAG_T4_WEIGHT = 0.3` for the ranking
formula. Import `termSpecificity` from `./term-expand` (already imported `canonicalize` from there;
`scoreTfidf`/`buildIndex` already imported from `./tfidf` — no edits to either of those files, just
using their existing exports).

In `scoreItems`'s Pass-1 loop: change `const kw = scoreKeyword(...)` to `let kw = ...` (so it can be
reassigned before the gate line runs) and pass the new T2/T3 opt flag `true`. Immediately after, when
`literalMustTopics.length > 0 && kw.score === 0` (i.e. T1/T2/T3 found nothing for every required
tag — cheap to only compute T4 in this branch, and this is exactly "T4 only ever ADDS candidates"),
compute for each tag in `literalMustTopics`: `simTopic = scoreTfidf(item.id, tag, index)`,
`simProject = scoreTfidf(item.id, pText, index)` (reusing the SAME `index`/`pText` already built once
per call at lines 121-122 — no new index, per guide §3.1's cost note). Anchored admission:
`simTopic >= FLOOR_TOPIC || (simTopic > 0 && simProject >= FLOOR_PROJECT)`. Take the best-margin
qualifying tag; **interpretation note for the manager/fresh-A to confirm**: the ruling's formula
`0.3 × termSpecificity × min(1, (sim − floor)/(1 − floor))` doesn't say which floor/sim pair to use
when the two branches differ — I use whichever branch actually cleared (simTopic/FLOOR_TOPIC if the
first branch fired, else simProject/FLOOR_PROJECT), and treat the whole expression as a `raw`-scale
contribution run through the SAME `/1.5` normalization `scoreKeyword` uses internally (for consistent
magnitude with T1/T2/T3), i.e. `kw = { ...kw, score: Math.min(1, (REQUIRED_TAG_T4_WEIGHT *
termSpecificity(tag) * margin) / 1.5) }`. `matched` is left exactly as-is (empty) — **T4 adds nothing
to `matched`/`matchedKeywords`** (§1ao.8; `generateReason` already has a `tfidf > 0.2` fallback
sentence for an empty-`matched` item, confirmed by reading `reason.ts` — no change needed there).
Under this scaling, a full-strength T1 hit (`termSpecificity/1.5` up to 0.667) always exceeds a
full-strength T4-only hit (`0.3×termSpecificity/1.5` = `0.2×termSpecificity`) at equal specificity —
the invariant test (guide test 10) holds by construction. **The literal gate line at `combine.ts:177`
is not edited** — only what `kw` holds when that line runs changes.

Scope decision (stated plainly, within the ruling's latitude, not fully pinned down by it): T4 is
computed once per item across all required tags (best-margin tag wins), and only when NO tag already
has T1/T2/T3 evidence — i.e. one T4 contribution per item, not summed per-tag. This keeps the change
minimal and avoids double-counting; if the manager wants T4 to also add score for OTHER tags beyond
whichever one first opens the gate, that's a small extension, not a redesign, but I'm not doing it by
default since neither the guide nor §1ao specify per-tag stacking precisely enough to implement with
confidence.

### 3.3 Cache version bump

`web/src/lib/opportunities/pool-cache.ts`: `PAPER_CACHE_KEY_VERSION` 6 → 7, with a doc-comment line
next to the existing version-history comment (matching the existing style at lines 197-210) citing
§1ao.9 and explaining why (old-rule pools must not be served after this change). Plus whatever the
manager authorizes from §2 above.

### 3.4 Copy (§1ao.7) — exact edits

1. `web/src/app/welcome/page.tsx:300` — replace the clause "every paper in your feed must match one of
   these" with "Peer looks for papers about these topics, even when they use different words, and
   ranks the closest matches first." (kept as its own sentence). Line 138's code comment ("Topics is
   the one gate...") is about onboarding completeness (still true — a Required topic is still needed
   to finish onboarding; only literal-text matching is going away), not this promise — left unchanged,
   not one of the three locations the ruling names.
2. `web/src/app/page.tsx:206` — `digestContextHint` template: "every paper below matches at least one
   — name the matching one in your sentence" → "each paper below relates to at least one — name the
   one it relates to in your sentence" (verbatim from §1ao.7).
3. `web/src/lib/llm/providers/types.ts:75` — **no change.** Confirmed by reading it: it already says
   "even when the paper's title doesn't contain that word," so it already anticipates non-literal
   qualification (matches guide §1.6 item 3's own conclusion). Ruling says "only if it still promises
   literal matching" — it doesn't.
4. `field-kit.tsx:613-616` caption — confirmed unchanged, already says "Matches on these topics score
   higher, but results without them can still appear." No edit (ruling says stays; guide §1.7 already
   flagged this as the correct framing the code needs to catch up to).
5. Home empty state (`briefing/copy.ts`/`empty-reason.ts`) — no edit (naming the cause is the separate
   queued EMPTY-STATE-REASON item, §1ao.7).

### 3.5 Tests — one new file, `web/src/lib/scoring/required-gate.test.ts`

Per the hard constraint ("their tests or one new test file next to them"), all 9 new cases go in one
new file next to `keyword.ts`/`combine.ts`, following `admission.test.ts`'s existing `item()` fixture
idiom (extended with `abstract`/`tags` overrides):
1. (No new test — existing `term-expand.test.ts`/`admission.test.ts`/`ranking.test.ts` run unmodified
   as part of the gate step; confirmed none of their ~15 `scoreKeyword` calls pass the new opt flag,
   so T1-only behavior is preserved for all of them by construction.)
2. T2 fires on the verified real LCO/LIXS abstract (guide §2.4) + protective sibling (unrelated
   abbreviation pair, e.g. "XUV spectroscopy (LIXS)" alone, must NOT qualify tag "LCO").
3. T3 fires on `item.tags = ["Lithium cobalt oxide"]` for tag "LCO" + protective sibling
   (`tags: ["Unrelated Concept"]` does not qualify).
4. T4 admits the real NASICON paraphrase fixture from guide §2.4 (`simTopic≈0.024, simProject≈0.178`)
   for tag "solid-state battery electrolyte" — direct regression test for the original 0/29 bug.
5. T4 rejects the real biofilm fixture (confirmed in §1 above: `simTopic=0, simProject=0.079`) for tag
   "electrolyte" against the battery project text — written parameterized on
   `REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT`/`_TOPIC` per the guide's instruction, so it is the mutation
   target for "floorProject → 0.0 must wrongly pass."
6. Wrong-sense trap (constructed clinical "Serum electrolyte imbalance..." fixture) — documents TODAY's
   baseline (qualifies via T1, unchanged), comment naming the queued SENSE-CONTEXT item, per §1ao.2.
7. SEM sense case — small real-data slice from B's `out/raw-P3-true.json`/`out/raw-P3-wrong.json`,
   `materials.scanning_electron_microscopy` selected sense, confirms `senses.ts` unaffected (same
   `selectedSenseConcept` helper `admission.test.ts` already uses).
8. Exclusions stay hard even when T1 (or T4) would otherwise admit.
9. Honest empty result: no T1/T2/T3/T4 evidence at all → rejected; a pool with zero qualifiers returns
   empty, not padded.
10. Ranking order: at equal `termSpecificity`, a T1-qualified item outranks a T4-only-qualified item
    (the mutation target for removing the T1-over-T4 gap).

### 3.6 Gates (from `web/`, after edits)

`npx vitest run` (baseline given in the "go" message — watching specifically for the pool-cache/
paper-daily-cache assertions per §2 above), `npx tsc --noEmit` (expect 0), `npx eslint .` (expect 0
errors, ≤151 warnings, add none), `npm run build` (expect OK). Any Windows EBUSY/EPERM file lock stops
that step only, reported, server never touched.

### 3.7 Live check plan (signed-out, ≤6 requests)

`POST http://localhost:3000/api/feed` `{"topics":["solid-state battery electrolyte"],"aiTier":0}` —
expect >0 papers (was 0 before this fix, per the EMPTY-HOME diagnosis). Then
`{"topics":["solid electrolyte"],"aiTier":0}` — expect ~57/62-ish no-regression count. Report exact
counts and titles.

## 4. Escape-clause status

Phase-1 anchoring check: **passed, not triggered** (§1 above). No existing test/caller found that
depends on literal-only behavior in a way the guide didn't anticipate, EXCEPT the events/jobs
`scoreKeyword` sharing risk (§3.1 above), which has a clean fix (opt-in flag) rather than requiring a
stop. The cache-version blast radius (§2) is a stop-and-report for that one sub-part only — not a
reason to halt the whole item — pending the manager's choice of (a)/(b).

STATUS: READY_TO_EDIT — waiting for the manager's "go". No product file modified. Scratchpad-only
artifacts: `analyze4-anchored-t4.mjs`, `out/T-report-anchored-*.json`, `out/T-all-reports-anchored.json`
(all outside the repo).

---

## PHASE 2 — go received, implemented

Go received from the manager with binding rulings on all 4 phase-1 questions: (1) anchored T4 accepted
as measured; (2) cache-version single-source-of-truth design specified (export `PAPER_POOL_KEY_PREFIX`,
allowed-file list expanded to the cache cluster); (3) T4 ranking-margin formula clarified (max over
admitting paths); (4) T2/T3 opt-in flag approved. Implemented exactly per those rulings plus the phase-1
plan. Baseline gates given: vitest 279 files (276 passed+3 skipped)/5004 passed+6 skipped/0 failed; tsc
0; eslint 0 errors/151 warnings; build OK.

### Per-file summary

**`web/src/lib/opportunities/pool-cache.ts`** — `PAPER_CACHE_KEY_VERSION` 6 → 7. New export
`PAPER_POOL_KEY_PREFIX = \`peer-pool-v${PAPER_CACHE_KEY_VERSION}-papers-\`` (single source of truth,
derived not hand-copied). Doc comments updated citing §1ao.9.

**`web/src/lib/opportunities/private-paper-cache.ts`** — imports `PAPER_POOL_KEY_PREFIX` from
`./pool-cache`; both hard-coded `"peer-pool-v6-papers-"` guard checks (`get`/`set`) now read
`key.startsWith(PAPER_POOL_KEY_PREFIX)`. This is the fix for the phase-1 risk finding: without it,
every signed-in user's durable pool cache would have silently stopped persisting.

**`web/src/lib/opportunities/pool-cache.test.ts`** — imports `PAPER_POOL_KEY_PREFIX`. The papers-key
assertion in "keeps papers on a DAILY key..." now derives its expected prefix from the constant instead
of hard-coding `v6`. "no longer produces a v5-shaped key" rewritten to assert `not.toMatch(/^peer-pool-v5-/)`
per-surface instead of a blanket `v6` match (papers is now v7; events/jobs stay v6 — those assertions
were left untouched per the manager's "events/jobs key assertions stay as they are").

**`web/src/lib/feed/paper-daily-cache.test.ts`** — imports `PAPER_POOL_KEY_PREFIX`. Test renamed
"...rebuilds only inside the v7 private scope"; its assertion now checks
`key.startsWith(PAPER_POOL_KEY_PREFIX)`. The v5-stale-key fixture/assertion is untouched (still means
"an old/unsafe version must be rejected" — correctly stays a literal).

**`web/src/lib/opportunities/private-paper-cache.test.ts`** — imports `PAPER_POOL_KEY_PREFIX`. The
"qualifies both reads and writes..." test now uses `` `${PAPER_POOL_KEY_PREFIX}private` `` (derived —
"means the current version") instead of a hard-coded `v6` string; its v5-rejection assertion is
untouched (explicit old literal, correctly kept). Added ONE new test per the manager's instruction:
"rejects a stale v6 papers key now that the prefix has moved to v7" — get/set both return
null/no-op and never call `fake.from`, i.e. the durable store is never touched for a v6 key.

**`web/src/lib/opportunities/channel-candidate-cache.ts`** / **`.test.ts`** — comment-only /
example-key-only changes (no behavior change, confirmed by the unchanged `SCOPE_KEY_PREFIX =
"peer-channels-v1-"` and its own independent guard logic). Comments that named the literal
`"peer-pool-v6-papers-"` string now reference `PAPER_POOL_KEY_PREFIX` (with the current value spelled
out parenthetically) instead of a string that would go stale on the next papers-only bump. The test's
"own prefix guard" example key now derives from the imported constant rather than a hard-coded literal.

**`web/src/lib/scoring/keyword.ts`** — new exported constants `REQUIRED_TAG_T2_GROUNDING = 0.85`,
`REQUIRED_TAG_T3_GROUNDING = 0.6`. New functions `selfDeclaredAbbreviationPairs` (private),
`matchesSelfDeclaredAbbreviation` (T2, **exported** for direct testing — see finding below),
`matchesSourceTag` (T3, **exported**, same reason). `scoreKeyword` gained an `extendedRequiredMatch`
opt (default off) — when true, a topic that misses T1 also tries T2 then T3 before counting as a miss.
Default-off keeps `web/src/lib/events/scoring.ts` and `web/src/lib/jobs/scoring.ts` (4 `scoreKeyword`
calls each, feeding `passesRequiredGate`) byte-for-byte unaffected, satisfying §1ao.6 structurally
rather than by convention — this sharing risk was not spelled out in the guide; found while implementing.

**`web/src/lib/scoring/combine.ts`** — new exported constants `REQUIRED_TAG_SIMILARITY_FLOOR_TOPIC =
0.15`, `REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT = 0.05`, `REQUIRED_TAG_T4_WEIGHT = 0.3`. `scoreItems`'s
Pass-1 `const kw = scoreKeyword(...)` became `let kw = scoreKeyword(..., { extendedRequiredMatch: true
})`; a new block computes T4 (tag-anchored, margin = max over whichever of simTopic≥FLOOR_TOPIC /
(simTopic>0 AND simProject≥FLOOR_PROJECT) actually admitted, clamped [0,1], per the manager's ruling 3)
only when `literalMustTopics.length > 0 && kw.score === 0`, and reassigns `kw` before the gate line.
**The gate line at (now) 248 is untouched, character-for-character**, matching the hard constraint.
T4-only never touches `kw.matched`.

**`web/src/app/welcome/page.tsx`** — one sentence: "every paper in your feed must match one of these"
→ "Peer looks for papers about these topics, even when they use different words, and ranks the closest
matches first." (verbatim per §1ao.7).

**`web/src/app/page.tsx`** — `digestContextHint`: "every paper below matches at least one — name the
matching one in your sentence" → "each paper below relates to at least one — name the one it relates to
in your sentence" (verbatim per §1ao.7).

**Not touched (confirmed correct, not an oversight):** `web/src/lib/llm/providers/types.ts` (already
says "even when the paper's title doesn't contain that word" — already accurate); `field-kit.tsx`
caption (already correct); home empty state (separate queued EMPTY-STATE-REASON item); `term-expand.ts`/
`tfidf.ts`/`tokenize.ts`/`senses.ts`/events-jobs code (explicitly forbidden, and none needed editing).

### FINDING — T2 and T3 can never independently admit a candidate T1 would not also admit, given
`itemText()`'s existing haystack composition (found while implementing, not anticipated by the guide)

Implemented T2/T3 exactly as ruled — this is not a deviation — but verified (by hand, then empirically
via a scratchpad probe script, then confirmed it matches B's own measurement) that **T2 and T3, as
specified, are structurally subsumed by T1 for admission purposes**:
- T1's haystack (`itemText()`, unchanged, pre-existing) already folds `item.tags` into EVERY scope, and
  folds `item.abstract` into the default "all" scope combine.ts uses. T2 extracts self-declared pairs
  from that same title+abstract text; T3 reads that same `item.tags`. Because `termMatches` is a
  word-bounded substring search, a match found within a SUBSTRING of the haystack (what T2/T3 check)
  is, by construction, also found within the FULL haystack (what T1 checks) for the same item/tag pair.
  Confirmed empirically: every constructed probe that made T2 fire also made T1 fire on the same item;
  T3 can NEVER be isolated at all (tags are in T1's haystack in every scope, not just "all").
- This exactly explains why B's own real-data measurement found **T2adds = 0 and T3adds = 0 in all
  four profiles, every time** (docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md §2.4) — not a
  small-sample coincidence, a structural certainty given the current code.
- **Consequence for THIS item**: T1 (unchanged) + T4 (new) are the entire practical reason EMPTY-HOME
  is fixed. T2/T3 are correctly implemented, harmless, spec-compliant, and become load-bearing the
  moment `itemText`'s composition or T1's scope usage ever changes — but they change ZERO observable
  behavior today. Recorded here so a future investigator does not have to re-discover it.
- **Consequence for testing**: an admission-level test through `scoreItems`/`scoreKeyword`'s public
  surface cannot be mutation-sensitive to "delete the T2/T3 branch" as guide §4.2 asks, because T1
  always independently admits the same fixture. Resolved by exporting `matchesSelfDeclaredAbbreviation`
  and `matchesSourceTag` for DIRECT unit testing (each carries a doc comment explaining exactly this),
  plus one isolation test that exploits `scope: "titleAndSummary"` (which swaps `abstract` out of T1's
  own haystack but NOT out of T2's, since T2 always reads `item.title`+`item.abstract` directly) to
  make T1 structurally unable to see a pair that T2 still finds — a genuine, reproducible T2-only
  admission, used in required-gate.test.ts's "isolates T2 as the SOLE admitting technique" test. No
  equivalent isolation exists for T3 (nothing excludes tags from T1's haystack in any scope), so T3's
  test instead directly documents the redundancy rather than pretending to isolate it.

### Tests

New file `web/src/lib/scoring/required-gate.test.ts`, 16 tests, all passing:
- T2: real-fixture mechanism-correctness test (LCO/LIXS, honest note on T1 redundancy) + protective
  sibling + the scope-based isolation test described above (genuinely mutation-sensitive).
- T3: real-ish fixture "fires" test + protective sibling + a test that explicitly documents (rather
  than hides) that T3 can never be isolated from T1 for the same item.
- T4: admits the real NASICON paraphrase (verified empirically to have `simTopic≈0.065 < FLOOR_TOPIC`
  but `simProject≈0.337 ≥ FLOOR_PROJECT` in this fixture's own small pool — anchored branch 2 fires;
  T1/T2/T3 all miss, confirmed no contiguous phrase match) with `matchedKeywords: []`; rejects the real
  biofilm false positive (`simTopic=0`) in the SAME pool as a genuinely-admitted battery paper (proves
  the floor isn't rejecting everything); a constant-parameterization test.
- Wrong-sense-trap baseline (constructed clinical "Serum electrolyte imbalance..." fixture, documents
  T1 still qualifies it today, comment naming SENSE-CONTEXT — flips to rejection if that item ships).
- SEM sense case on two REAL OpenAlex abstracts (one from each of B's saved `raw-P3-true.json`/
  `raw-P3-wrong.json`), confirming `senses.ts` needs no change.
- Exclusions stay hard; a zero-qualifier pool returns empty, never padded.
- Ranking order: a direct constant check (T2/T3/T4 multipliers all < 1, i.e. below T1's effective unit
  weight) PLUS an end-to-end fixture (scattered-but-not-contiguous tag words → T4-only, high margin
  ≈0.89) showing `scoreBreakdown.keyword` for the T1 item strictly exceeds the T4-only item's — asserted
  on the keyword breakdown specifically, not the final blended rank (which also mixes in tfidf
  topicality/recency/source and legitimately can favor either item on those unrelated axes — verified
  by running the test both ways; the blended-rank version was flaky and it was removed as a poor test of
  the actual §1ao.3 invariant, not because it passed test 10's spirit).

Plus 1 new test in `private-paper-cache.test.ts` (the "v6 now rejected" case, per the manager's ruling 2).

All real-paper fixtures are short excerpts (title + the minimum abstract text needed) from B's saved
public-source data, per the guide's own instruction; the constructed wrong-sense fixture is a short,
generic, non-creative title already used in the guide/rulings text.

### Gates (from `web/`)

- `npx vitest run`: **277 passed + 3 skipped (280 files) / 5021 passed + 6 skipped (5027 tests) / 0
  failed.** Delta from baseline: +1 file (required-gate.test.ts), +17 tests (16 new + 1 in
  private-paper-cache.test.ts) — exactly accounted for, no other file's test count moved.
- `npx tsc --noEmit`: **0 errors** (no output).
- `npx eslint .`: **0 errors, 151 warnings** — identical count to baseline; no new warnings added.
- `npm run build`: **OK** — compiled successfully, typechecked, all 29 routes generated. One PRE-EXISTING
  Turbopack warning about `next.config.ts`/`pdf-text.ts`/the upload route's file tracing appeared; it is
  unrelated to every file this item touched (upload/PDF code, not scoring/cache/copy) and almost
  certainly predates this change — not investigated further as out of scope.

### Live check (signed-out, dev server already running at localhost:3000, 2 of ≤6 requests used)

1. `POST /api/feed {"topics":["solid-state battery electrolyte"],"aiTier":0}` → **HTTP 200, 7 items**
   (was 0 before this fix — the exact EMPTY-HOME symptom). Titles, all genuinely on-topic: "Redox-Pathway
   Reconstruction in Carbonate Electrolyte to Achieve Durable Na─S Battery", "Oxygen-Vacancy-Mediated
   Triple Synergy in Gd-Doped Ceria Fillers Enables Dendrite-Free Solid-State Lithium Metal Batteries",
   "High-Performance All-Solid-State Silicon-Sulfur Batteries Enabled by Li4(BH4)3I Hydride Electrolyte",
   "Frequency-dependent shear and bulk viscosity of aqueous and non-aqueous lithium battery
   electrolytes", "Synthesis of Ladder and Flexible Polysulfonimides... Succinonitrile-Polymer
   Electrolyte Blends", "Molecular Bridging Creates an Interconnected Coordination Network for
   Continuous Li+ Hopping in Polymer Electrolytes", "Thermal Spray as a Scalable Alternative Processing
   Route for Solid-State Thin-Film Batteries".
2. `POST /api/feed {"topics":["solid electrolyte"],"aiTier":0}` → **HTTP 200, 10 items** (capped at the
   display limit — matches the manager's own earlier probe of "67 in window, 57 passed, 10 returned";
   no regression). All titles genuinely on-topic (solid electrolytes/Li-ion batteries).

### Final `git status --short`

```
 M ABC-JEV-INTEGRATION.md                                    (manager's file, not touched by C)
 M web/src/app/page.tsx
 M web/src/app/welcome/page.tsx
 M web/src/lib/feed/paper-daily-cache.test.ts
 M web/src/lib/opportunities/channel-candidate-cache.test.ts
 M web/src/lib/opportunities/channel-candidate-cache.ts
 M web/src/lib/opportunities/pool-cache.test.ts
 M web/src/lib/opportunities/pool-cache.ts
 M web/src/lib/opportunities/private-paper-cache.test.ts
 M web/src/lib/opportunities/private-paper-cache.ts
 M web/src/lib/scoring/combine.ts
 M web/src/lib/scoring/keyword.ts
?? docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md          (B's guide, not touched by C)
?? docs/jev-abc/REQUIRED-GATE-C-20260928T163436Z.md          (this checkpoint)
?? node_modules/                                             (pre-existing, unrelated)
?? web/src/lib/scoring/required-gate.test.ts
```

Every touched file is inside the manager's expanded allowed-file list. No forbidden file
(`term-expand.ts`, `tfidf.ts`, `tokenize.ts`, `senses.ts`, events/jobs code) was touched. No git command
that changes state was run. No server was started, stopped, or restarted — the shared dev server at
localhost:3000 was only read via HTTP for the live check.

STATUS: IMPLEMENTED_PENDING_REVIEW — ready for a fresh A.
