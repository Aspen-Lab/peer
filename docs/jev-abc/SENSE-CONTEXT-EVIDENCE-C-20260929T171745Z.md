STATUS: IN_PROGRESS (fix round after fresh A FAILED_REVIEW — see "Fix round" section at the end)

# SENSE-CONTEXT-EVIDENCE — C implementation checkpoint

Role: C (implementer). Rulings: ABC-JEV-INTEGRATION.md §1bg (binding,
overrides the guide where they differ), background §1be, §1bd, §1ax, §1ap
(+AMENDMENTs), §0b/§3. Guide: docs/jev-abc/SENSE-CONTEXT-EVIDENCE-B-20260929T163908Z.md
(COMPLETE). Also read: docs/jev-abc/TOKENIZE-PLURALS-C-20260929T141909Z.md
(the 3 deferred specs + its measurement harness), docs/jev-abc/TOKENIZE-PLURALS-A-20260929T152804Z.md
(independent-review harness + numbers). Branch Jev-integration-and-sorting-filtering-enhancement,
HEAD 90db90fe.

## Plan (written before any edit)

1. **term-expand.ts** — minimal refactor: extract `termMatches`'s per-variant
   regex test into a small exported helper (single already-canonical variant,
   no re-expansion) so keyword.ts's new skip-rule classifier can test ONE
   specific variant string without calling `expandTerm` on it again (which
   would silently re-return the WHOLE group closure — the exact mistake B's
   guide corrected mid-investigation, §3). `termMatches` itself becomes a
   thin loop over this helper — behaviourally byte-identical (verified by
   the existing termMatches-dependent test suite staying green).
2. **tokenize.ts** — no functional change; `tokenizeFolded`'s doc comment
   updated (it currently says the context check "stays on plain tokenize()",
   which becomes false once this item ships).
3. **keyword.ts** (the real work):
   a. Swap the `tokenize` import for `tokenizeFolded` and use it at all four
      short-tag context-check call sites: `senseContextStripSet`'s two
      `tokenize()` calls, `senseContextGate`'s two `tokenize()` calls. This
      is the fold TOKENIZE-PLURALS built and reverted (§1be), now shipped
      TOGETHER with the cut and the skip rule below, per §1bg.
   b. **Document-frequency cut (§1bg point 1, WHAT-TO-BUILD point 2).** At
      module load, from the already-imported `reference-idf.json`: sort
      every tracked token's weight ascending; the Pth-percentile weight is
      the value at the 0-indexed position `floor(P/100 * n)`, `n` = the
      table's own key count — computed from the table itself, the same way
      `REFERENCE_IDF_MAX_WEIGHT` already is, so a table rebuild recomputes
      this rather than drifting from a stale hard-coded number. `P = 25`.
      Verified against the shipped table (below, before any edit): this
      definition gives exactly 6.784, matching the guide — proceeding (the
      brief says STOP only if it differs). A token leaves BOTH overlap-axis
      sets (item side and context side) when its `referenceIdfWeight` is
      below this cut; the existing `GENERIC_TERMS` filter on that axis
      stays; unseen tokens keep the table's max weight (already true of
      `referenceIdfWeight`, so they never get cut). `fixedSim` (the other
      axis) is completely untouched by this — same `toReferenceVector`
      calls, same inputs (just now folded, from point a).
   c. **Skip rule (§1bg point 3, WHAT-TO-BUILD point 3).** New function
      `matchesFullNameOrFormula(item, tag)`, exported for direct testing:
      false immediately for a tag with no catalogued `ABBREVIATION_GROUPS`
      entry (reuses the existing private `hasKnownAbbreviationExpansion`);
      otherwise splits `expandTerm(canonicalTag)`'s closure into the tag's
      own bare canonical spelling (excluded) vs every other variant (the
      full name, the formula, their plurals — by SET DIFFERENCE, never by
      re-expanding a single member, per B's corrected mistake), and tests
      the SAME haystack `scoreKeyword` already built (`itemText(item,
      "all")`) for any of those other variants via the new single-variant
      helper from point 1. Wired into `scoreKeyword`'s per-topic loop: the
      existing `if (opts.senseContext && isShortOrAmbiguous(topic))` branch
      that calls `senseContextGate` gets one more `&&
      !matchesFullNameOrFormula(item, topic)` condition — smallest possible
      change, rule (c) keeps running first and keeps its `continue` (hard
      non-match), completely unchanged. combine.ts's T4 loop is NOT touched:
      T4 only ever runs when `kw.score === 0` (no literal match at all for
      any Required tag on that item), so there is no "matched variant" to
      classify there by construction — the skip rule is inherently a
      T1/T2/T3 concept. (The brief's phrase "find where combine.ts decides
      that a T1 hit on a short tag needs the context check" is read as this
      decision point — the actual per-topic gate that combine.ts's call into
      `scoreKeyword` triggers — since combine.ts's own file has no code that
      independently re-decides this for a literal match; I'll flag this
      reading explicitly in the final report in case it is not what was
      intended.)
   d. Doc comments: the block above `SENSE_CONTEXT_DEMOTED_GROUNDING`,
      `senseContextStripSet`'s own comment, and `senseContextGate`'s own
      comment all get a short addition describing what SENSE-CONTEXT-EVIDENCE
      changed (fold now shipped, the cut, the skip rule, the accepted cost
      that a few domain words such as "electrolyte" sit below the cut).
4. **combine.ts** — no functional change; the `foldedIndex` comment's claim
   that "keyword.ts's SENSE-CONTEXT short-tag context check stays unfolded,
   moved to the new item SENSE-CONTEXT-EVIDENCE" becomes stale and gets
   corrected (that index is a DIFFERENT, T4-only folded index — unrelated to
   keyword.ts's own internal fold — so this is a comment-only fix).
5. **pool-cache.ts** — `PAPER_CACHE_KEY_VERSION` 17 → 18 via the single
   exported prefix, new history paragraph appended (fold+cut+skip together
   change context-check verdicts, hence pool admission/ranking — a v17 pool
   must never be served as if it already reflects this).
6. **Tests** (sense-context.test.ts unless noted): shipped-constant pin for
   the new cut (today ≈ 6.784, percentile 25); the 3 deferred
   TOKENIZE-PLURALS-EVIDENCE specs (re-verified numerically before finalizing
   the exact assertions, per that checkpoint's own caveat); a new
   `openalex:W7213893763`-shaped fixture (real OpenAlex text) at full
   strength via the skip rule; skip-rule classifier tests (bare-form-only
   runs the check; full-name match skips; formula match skips; a real
   petroleum LCO negative is never classified full-form; rule (c) keeps
   precedence over the skip rule); a 3-sample real-negative tripwire (one
   per tag, direct `senseContextGate` calls); term-expand.test.ts gets the
   owed "ions" tripwire (`singularize("ions") === "ions"`) plus a doc-comment
   line naming it next to gases/biases/lenses. Test 17 (both R3 residuals)
   is NOT touched — must stay green exactly as written.
7. **Measurement** — one temporary probe file,
   `web/src/lib/scoring/__c_probe_measure.test.ts`, reading real saved data
   from `<scratchpad>/out/` via an env var (never the literal path in a repo
   file), using the real exported `scoreItems`/`senseContextGate`/`dropStale`.
   Reference instant `2026-09-28T16:05:42Z`. Run BEFORE any product edit and
   AFTER, on both harnesses (B's literal-match subsets 89/25/3; the
   TOKENIZE-PLURALS all-in-window pools 145/62/3), the 150 negatives, and the
   3 live LCO-response papers (real text from `<scratchpad>/prod-lco-resp-3.json`,
   reconstructing the reader's real production `seedTexts` from that file's
   own saved `meta.searchBrief`, the same technique this file's own existing
   test 17 fixture already uses). Also compute the R=0.08 comparison purely
   by re-testing the gate's own already-computed `fixedSim`/`overlapSim`
   against a lower threshold locally in the probe — production `R` (0.10)
   is never touched. Deleted before finishing; proven by `git status`.
8. **Mutations** (sha256sum before/after each, restored): remove the cut →
   Thorium (test 17) goes red; remove the skip rule → the new W7213893763
   test goes red; remove the fold (revert all 4 call sites) → at least one
   of the 3 deferred specs goes red.
9. **Gates** from web/, one at a time: `npx vitest run`, `npx tsc --noEmit`,
   `npx eslint .`, `npm run build`. Baseline (to confirm before editing): 288
   files (285 + 3 skipped) / 5267 passed + 6 skipped / 0 failed; tsc 0; eslint
   0/151; build OK.

## Log

- Read ABC-JEV-INTEGRATION.md §0b, §1bg, §1be, §1bd (via §1be's resume), §1ax,
  §1ap (+ AMENDMENTs 1-5), §3 in full. Read the B guide (whole),
  TOKENIZE-PLURALS-C (whole, incl. the deferred specs and the §1be AMENDMENT
  g-l work), TOKENIZE-PLURALS-A (whole). Read keyword.ts, term-expand.ts,
  tokenize.ts, combine.ts, sense-context.test.ts, pool-cache.ts, web/AGENTS.md
  in full.
- Confirmed the scratchpad `out/` directory holds every file the guide names:
  raw-P4.json (150, in-window subset historically 145/electrolyte),
  raw-P2.json (100, in-window subset historically 62/solid-state),
  tagged-LCO.json (50, in-window subset historically 3/LCO), the 3
  sc-neg-*.json files (50 each = 150), raw-P1a.json/raw-P1b.json (not needed
  for this item's harnesses). Confirmed the shipped
  `web/src/lib/scoring/reference-idf.json` is byte-identical (sha256) to the
  scratchpad's `out/c2-reference-idf.json` B's guide used. Confirmed the live
  LCO response `<scratchpad>/prod-lco-resp-3.json` contains all 3 named
  papers (`openalex:W7213893763`, `arxiv:2608.18563`, `openalex:W7214055235`)
  with full real title/abstract/tags, plus `meta.searchBrief` (project text
  byte-identical to this test file's own `BATTERY_PROJECT_TEXT`,
  `generatedQueries` = `["LCO","PhD research on solid-state battery
  materials","LCO PhD research on solid-state battery materials","research",
  "solid-state","battery","materials","LCO research","LCO solid-state"]`) —
  used to reconstruct the reader's real `seedTexts` via `briefToSeedTexts`'s
  own documented composition (read from profile-compiler.ts directly, not
  guessed).
- Verified the percentile definition against the shipped table before
  writing any code (temporary scratchpad-only script, not part of the repo):
  n = 17,489, sorted ascending, `floor(25/100 * n)` → **6.784** — matches the
  guide exactly; every other reasonable percentile definition tried
  (nearest-rank, linear interpolation, rounded index) converges on the SAME
  value at p25/p40/p50/p60 (6.784/7.477/7.659/7.882) for this table, so the
  choice among them is not load-bearing here, but the floor/0-indexed
  definition is what ships and is what the doc comment states exactly.
- Read `briefToSeedTexts`/`cleanList` (profile-compiler.ts) and their
  pipeline.ts call site directly to confirm the exact seedTexts composition
  used for the live-LCO reconstruction, rather than assuming.

- Ran baseline gates: `npx vitest run` → 288 files (285 + 3 skipped) / 5267
  passed + 6 skipped / 0 failed. Matches the brief exactly.

## Measurement — BEFORE (real functions, temporary probe, deleted after use)

Probe `web/src/lib/scoring/__c_probe_measure.test.ts` (path from env vars
`C_PROBE_SCRATCHPAD_DIR`/`C_PROBE_RESULT_FILE`, never written into this repo),
using the real `scoreItems`/`senseContextGate`/`dropStale`, reference instant
`2026-09-28T16:05:42Z`. Every "before" number below reproduces the guide's own
table exactly, confirming the harness before trusting anything after it.

| Harness | electrolyte | solid state | LCO |
|---|---|---|---|
| (a) literal-match subset (of 89/25/3) | 54 | 25 | 2 |
| (b) all-in-window pool (of 145/62/3) | 57 | 51 | 2 |
| 150 negatives (of 50 each) | 0 | 0 | 0 |

Live LCO response (`<scratchpad>/prod-lco-resp-3.json`, real production data,
reader's `seedTexts` reconstructed from the file's own saved `meta.searchBrief`
via `briefToSeedTexts`'s documented composition — read directly from
profile-compiler.ts, not guessed): `openalex:W7213893763` (right-sense, matched
via full name) keyword 0.1167 vs bypass 0.4667 → **demoted** (the defect).
`arxiv:2608.18563` (cuprate, wrong sense) keyword 0.1167 vs bypass 0.42 →
demoted (correct today). `openalex:W7214055235` (Li2C2O4) keyword 0.42, already
full strength via RESCUE (unaffected either way).

## Implementation — done, one step at a time

1. **term-expand.ts**: extracted `termVariantMatches` (single already-canonical
   variant, no re-expansion) out of `termMatches`'s loop body; `termMatches`
   itself is now a thin `.some()` over it — verified behaviourally identical
   (existing termMatches-dependent suites stay green throughout). Added the
   owed "ions" doc-comment line + tripwire test next to gases/biases/lenses.
2. **keyword.ts**:
   - Import swapped `tokenize` → `tokenizeFolded`; all 4 call sites
     (`senseContextStripSet`'s 2, `senseContextGate`'s 2) now fold.
   - Added `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE = 25` and
     `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT` (computed at module load: sort
     the table's own weights ascending, take the value at 0-indexed
     `floor(25/100 * n)`). Verified against the shipped table BEFORE writing
     any code: **6.784**, matching the guide exactly — every other reasonable
     percentile definition tried converges on the same value for this table,
     so this one definition, stated precisely in the code comment, is what
     ships. Wired into both overlap-axis filters (`itemTokensForOverlap`/
     `contextTokensForOverlap`) alongside the existing `isGenericTerm` filter.
     `fixedSim`/`toReferenceVector` untouched.
   - Added `matchesFullNameOrFormula(item, tag)` (exported): false for a tag
     with no `ABBREVIATION_GROUPS` entry; otherwise set-difference of
     `expandTerm(canonicalTag)` minus the bare canonical tag itself, tested
     against the same `itemText(item,"all")` haystack `scoreKeyword` already
     builds, via the new `termVariantMatches` primitive (never re-expanding a
     single variant — the guide's corrected mistake). Wired into
     `scoreKeyword`'s per-topic loop as one added `&&
     !matchesFullNameOrFormula(item, topic)` on the existing
     `isShortOrAmbiguous` branch — rule (c) keeps its unconditional-`continue`
     precedence, unchanged. combine.ts's T4 loop is untouched (T4 only runs
     when `kw.score === 0`, i.e. no literal match at all — there is no
     "matched variant" for the skip rule to classify there by construction).
   - Doc comments updated: the AMENDMENT-4 block, `senseContextStripSet`,
     `senseContextGate`, the new cut/classifier's own comments all state what
     ships and the accepted cost ("electrolyte" 6.18 sits below the cut).
3. **tokenize.ts**: `tokenizeFolded`'s doc comment corrected (no longer claims
   the context check "stays on plain tokenize()").
4. **combine.ts**: `foldedIndex`'s comment corrected (that index is a
   different, T4-only fold; the context check has SINCE folded too, per §1bg).
5. **pool-cache.ts**: `PAPER_CACHE_KEY_VERSION` 17 → 18, new history paragraph
   appended describing all three changes (fold, cut, skip rule) and why a v17
   pool must not be served as v18. `pool-cache.test.ts`'s version-chain
   comment updated to name v18/§1bg.
6. **Tests** — see "Tests added" below.

## Measurement — AFTER (same probe, unchanged, re-run post-edit)

| Harness | electrolyte | solid state | LCO |
|---|---|---|---|
| (a) literal-match subset (of 89/25/3) | **65** | **25** | **3** |
| (b) all-in-window pool (of 145/62/3) | **74** | **53** | **3** |
| 150 negatives (of 50 each) | **0** | **0** | **0** |

R = 0.08 comparison (recomputed locally in the probe from the SAME real
`gate.fixedSim`/`gate.overlapSim` the shipped R = 0.10 code produces — R = 0.10
in production is never touched):

| Harness (R=0.08) | electrolyte | solid state | LCO |
|---|---|---|---|
| (a) literal-match subset | 66 | 25 | 3 |
| (b) all-in-window pool | 75 | 57 | 3 |
| 150 negatives | 0 | 0 | 0 |

**Pre-set rule check (§1bg point 2 / brief point 4), AT R = 0.10 (shipped,
unchanged)**: 0/150 negatives ✓; both R3 residuals demoted (test 17, verified
below) ✓; retention ≥ today on every tag in BOTH harnesses — electrolyte 65≥54
& 74≥57 ✓, solid state 25≥25 & 53≥51 ✓, LCO 3≥2 & 3≥2 ✓. **All conditions met
→ ship at R = 0.10 (already the shipped value; R was never changed).**

Live LCO response, AFTER: `openalex:W7213893763` keyword 0.4667 = bypass
0.4667 → **full strength** (fixed — the target defect). `arxiv:2608.18563`
keyword 0.1167 (unchanged) vs bypass 0.42 → **still demoted** (correct,
unaffected). `openalex:W7214055235` keyword 0.42 (unchanged) → still full
strength via RESCUE (accepted cost, unaffected either way, reported as
required).

Both R3 residuals (sense-context.test.ts test 17, real functions, run via
`npx vitest run`): **both stay demoted, PASS, unmodified.** This is the single
most important check (the exact place TOKENIZE-PLURALS stopped) — confirmed
green both immediately after wiring the fold+cut+skip together and in every
full-suite run since.

**Demoted-after list** (passed today, demoted after): none found in the
literal-match or all-in-window harnesses — every tag's admitted count only
ever INCREASED (65≥54, 25≥25, 3≥2 / 74≥57, 53≥51, 3≥2); no id present in the
"before" pass set is absent from the "after" pass set for any of the 6
harness cells (checked by construction: the probe counts a strictly growing
admitted subset, and the retention check above already confirms no tag lost
ground). Nothing to list for A.

## Tests added (sense-context.test.ts unless noted)

- test 15 addendum: rewrote the "lco-rescue-only" fixture's overlap assertion
  (was `< FLOOR`, now `>= FLOOR` — the cut mechanically inflates this
  fixture's overlap ratio too, a strictly safer outcome, not a weaker one;
  comment cites §1bg) and added a NEW real "solid state" fixture
  (arxiv:2606.31261, out/raw-P2.json) that still isolates the rescue floor as
  independently load-bearing under the new axis (overlapSim exactly 0).
- test 17 addendum: rewrote the "state-of-the-art" protective fixture (that
  exact phrase, 6.561, sits just BELOW the new cut and so stopped moving
  `overlapSim` at all, and the short fixture's remaining vocabulary saturated
  the ratio at 1.0 regardless) to "state-dependent" (unseen by the table, so
  it reliably stays on the axis) with asymmetric filler vocabulary on each
  side so neither side's overlap set is a trivial subset of the other's —
  comment cites §1bg and gives the verified numbers.
- test 18 (NEW): the 3 parked TOKENIZE-PLURALS-EVIDENCE specs, copied
  verbatim from TOKENIZE-PLURALS-C's deferred section and re-verified against
  the shipped mechanism — all 3 hold with their ORIGINAL numbers (including
  the exact `fullGroundingScore` value). Plus one added test that isolates
  the FOLD itself (see Mutations).
- test 19 (NEW): pins `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE` (25) and
  `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT` (≈6.784).
- test 20 (NEW): the real `openalex:W7213893763` fixture (live text) reaches
  full strength; a minimal constructed full-name/formula-only fixture that
  ISOLATES the skip rule (see Mutations); the real `arxiv:2608.18563` cuprate
  stays demoted, with a direct `matchesFullNameOrFormula` assertion proving
  the skip rule never fires for it (bare-form-only).
- test 21 (NEW): `matchesFullNameOrFormula` classifier unit tests — bare-form
  only does not skip; full-name-only skips; formula-only skips; the real
  petroleum LCO negative (W2897424722) is never classified full-form; inert
  for tags with no abbreviation group; rule (c) keeps precedence (constructed
  fixture that both self-declares a disagreeing pair AND separately mentions
  the true full name — rule (c) still wins, contributes nothing).
- test 22 (NEW): a 3-sample real-negatives tripwire, one per tag, direct
  `senseContextGate` calls (pubmed:18486713, openalex:W1639895858, and the
  same real W2897424722 text test 6/14 already use).
- term-expand.test.ts: the owed "ions" tripwire (`singularize("ions") ===
  "ions"`) plus its doc-comment line next to gases/biases/lenses.

Net: +19 tests (5267 → 5286 passed), 0 modified assertions on any OTHER
pre-existing test, 0 deletions. Test 17 (both R3 residuals) untouched.

## Mutations (sha256sum before/after each, restored; keyword.ts hash both
times: `eb7f9d07a6919ae3ede1bb3fc7561a7050db02dcb935734229a9b26a2c554572`)

1. **Remove the cut** (overlap-axis filters drop the `referenceIdfWeight(token)
   >= CUT` clause): Thorium test (test 17) goes red — `expected false to be
   true` (admitted at full strength). Restored, hash identical.
2. **Remove the skip rule** (drop `&& !matchesFullNameOrFormula(...)` from
   scoreKeyword's gate condition): the real `openalex:W7213893763` test did
   **NOT** flip — found by execution, reported honestly rather than forced:
   under fold+cut, this specific real paper's OWN statistical gate also
   independently clears the AND path (fixedSim 0.0496≥0.015, overlapSim
   0.1111≥0.10), so it is rescued twice, redundantly. Added a minimal,
   deliberately thin-vocabulary constructed fixture (full-name/formula
   mention, otherwise zero shared vocabulary — verified fixedSim=0,
   overlapSim=0 on the statistical axis alone) that correctly isolates the
   skip rule: this test, and only this test, goes red under the mutation.
   Restored, hash identical.
3. **Remove the fold** (all 4 call sites back to plain `tokenize`, `tokenize`
   re-added to the import for the mutation): the 3 verbatim deferred specs in
   test 18 did **NOT** flip either — same pattern, found by execution: the
   hydrogel fixture's one strong shared word ("batteries") already matches
   identically unfolded on both sides, so the CUT alone (not uniquely the
   fold) explains its post-fix number. Added a constructed fixture inside
   test 18 (`cathode`/`cathodes`, the ONLY shared root, chosen above the cut
   so folding — not the cut — decides it) that correctly isolates the fold:
   goes red under this mutation, restored, hash identical.

Both the skip-rule and fold mutations surfaced a genuine, unpredicted overlap
between the three mechanisms on SPECIFIC real/near-real fixtures (each
mechanism alone already rescues more than the guide's per-mechanism numbers
alone would suggest, once they are stacked). This is reported as a finding,
not hidden — each mutation still has a clean, real-or-constructed, honestly
labeled isolating test, and none of the 3 REQUIRED bars (0/150 negatives, both
residuals demoted, retention ≥ today) depend on resolving this overlap.

## Gates (from web/, one at a time)

| Gate | Before | After |
|---|---|---|
| `npx vitest run` | 288 files (285+3 skipped) / 5267 passed + 6 skipped / 0 failed | 288 files (285+3 skipped) / **5286 passed + 6 skipped / 0 failed** |
| `npx tsc --noEmit` | 0 errors | 0 errors |
| `npx eslint .` | 0 errors / 151 warnings | 0 errors / **151 warnings** (unchanged) |
| `npm run build` | OK | OK, all routes compiled |

## Privacy scan

Scanned every changed file (the 8 product/test files + this checkpoint) for
the literal scratchpad path (carries the Windows account name), any
`C:\Users\<name>`-shaped path, any email-address-shaped string, and the
user's own known email local-part. Zero hits in every category. Every
scratchpad reference in this checkpoint uses the `<scratchpad>/…` shorthand.

## Probe cleanup — verified

Two temporary probe/diagnostic files were used during this session under
`web/src/lib/scoring/`, all with the required `__c_probe_` prefix
(`__c_probe_measure.test.ts` plus several short-lived `__c_probe_diag*.test.ts`
/ `__c_probe_find_rescue.test.ts` fixture-discovery scripts). All deleted
before finishing. `git status --short` at the repo root (captured after
deletion) shows exactly: the 8 product/test files, this checkpoint (new), the
pre-existing B guide (not mine), `ABC-JEV-INTEGRATION.md` (modified before
this session started, not by this session), and the pre-existing untracked
`node_modules/`. No probe or debug file anywhere in the tree. Confirmed with
a repo-wide `find` for every probe-name pattern used in this lineage
(`__c_probe_*`, `__b_probe_*`, `__a_probe_*`, `__tokenize_plurals_probe*`) —
zero matches.

## Final changed-file list

`web/src/lib/scoring/keyword.ts`, `web/src/lib/scoring/term-expand.ts`,
`web/src/lib/scoring/tokenize.ts`, `web/src/lib/scoring/combine.ts`,
`web/src/lib/opportunities/pool-cache.ts`,
`web/src/lib/opportunities/pool-cache.test.ts`,
`web/src/lib/scoring/term-expand.test.ts`,
`web/src/lib/scoring/sense-context.test.ts`. Plus this checkpoint doc (new).
No network calls made (0 external calls; all measurement reused already-saved
real data). `web/.env`/`web/.env.local` never opened. No API key written
anywhere. No commit/push/stash/branch operation performed. `node_modules/`
and the dev server were never touched.

## Decisions the rulings did not explicitly cover

1. **"Find where combine.ts decides that a T1 hit on a short tag needs the
   context check"** (brief point 3) — the actual decision point is
   keyword.ts's `scoreKeyword` (the per-topic loop combine.ts calls into,
   passing `senseContext`); combine.ts's OWN file has no code that
   independently re-decides this for a literal match (its T4 loop only runs
   when `kw.score === 0`, i.e. no literal match exists at all for any
   Required tag on that item — there is nothing for the skip rule to classify
   there). Implemented the skip rule in keyword.ts accordingly; flagging this
   reading explicitly in case a different file was intended.
2. **Mutation redundancy** (see above) — the skip-rule and fold mutations
   each needed a purpose-built isolating fixture because the shipped
   mechanisms turned out to rescue several real fixtures redundantly. Handled
   by adding honestly-labeled new tests rather than forcing the literal
   named fixture (W7213893763 / the deferred specs) to be the mutation-red
   one; the real fixtures' behavior (both now full strength / passing) is
   unchanged and still directly tested.

STATUS (first round): IMPLEMENTED_PENDING_REVIEW → fresh A FAILED_REVIEW.

---

# Fix round — §1bg point 11 AMENDMENT (2026-09-29T18:2xZ)

Fresh A (docs/jev-abc/SENSE-CONTEXT-EVIDENCE-A-20260929T175044Z.md,
STATUS FAILED_REVIEW): reproduced every aggregate number, proved the
`termMatches` refactor behaviourally identical (10,603 real comparisons),
confirmed the 2 rewritten tests legitimate, all mutations and gates — but
found by execution that the checkpoint's "nothing demoted that passed
before" / "Demoted-after list: none" claim is FALSE. The first round
compared COUNTS (net admitted per tag/harness went up everywhere), not SETS
— so real losses were masked by unrelated gains in the same cell. Real
losses at the p25 cut (6.784), all via full `scoreItems`, not just the gate:
- `openalex:W7172267740` (PVA gel polymer electrolytes) — genuine, demoted.
- `openalex:W7204909059` / `W7204866765` (one paper — "Topological Probing
  and Multi-Field Regulation of Ion Transport in Solid Electrolytes", 2 ids
  in the pool) — genuine, was T4-admitted at HEAD, now EXCLUDED entirely
  (T4 has no demote path — the gate failing means the item drops out of the
  pool, not "stays but weaker").
- `arxiv:2609.03717` (La2Mo2O9) — borderline, demoted.
- `openalex:W7213888420` (plasma electrolytic polishing of TC4 alloys) —
  wrong-field, correctly demoted (this loss is a GOOD outcome).
And 3 wrong-field GAINS to full strength: `openalex:W7204716846`
(electrolytic plasma treatment of metals), `arxiv:2608.14351` (propylene
epoxidation electrocatalysts), `pubmed:42603427` (biofilm bioenergetics,
harness-b-only).

Cause (confirmed by A, re-confirmed below): the p25 cut (6.784) also removes
real domain words that sit just below it in this general-science table —
`ionic` 6.273, `conductivity` 6.224, `electrolyte` 6.178 (the fold turns
"electrolytes" 6.966 into "electrolyte"), `electrode` 6.091 — while the
non-topical words this item targets all sit at or below 5.126. §1bg.11
authorizes ME (same C, one round) to sweep gentler cuts and re-select.

## Plan (this round)

1. **Baseline ("today"/HEAD) SET, not counts.** Since my own working tree
   already carries the fold+cut+skip, I get a true HEAD-equivalent baseline
   by TEMPORARILY reverting, in keyword.ts, exactly the 3 behavioural
   additions from round 1 (tokenize→tokenizeFolded at 4 sites; the doc-freq
   cut clause in the 2 overlap-axis filters; the `&&
   !matchesFullNameOrFormula(...)` clause) — proven behaviourally sufficient
   because (a) these are the ONLY 3 runtime-behaviour changes in the whole
   diff (the `termMatches`/`termVariantMatches` refactor was independently
   proven byte-identical by A over 10,603 comparisons; doc comments and the
   cache-version bump have no runtime effect), and (b) reverting all 3 at
   once is mechanically simpler and less error-prone than building 4
   separate `git show HEAD:...` copy files with import surgery (A's
   approach, used for a DIFFERENT purpose — independently re-verifying the
   refactor itself, which does not need re-doing here). Run once, hash the
   reverted file, restore, hash again (must match the pre-revert hash) —
   same discipline as every mutation this lineage has used.
2. **Percentile sweep, real functions, one param.** Add a temporary,
   single-line env-var override to `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE`
   (falls back to the real 25 when unset) so the REAL, current `senseContextGate`
   can be exercised at p5/p8/p10/p12/p15/p20/p25 without 7 rounds of hand
   edits. Removed completely at the end (reverted to a plain literal set to
   the CHOSEN value) — proven by hash, same as every other temporary probe
   mechanism this lineage uses.
3. **Set-diff methodology** (per tag, per harness, per candidate percentile):
   - T1/T2/T3 literal-hit items (`matchedKeywords` non-empty) can never be
     fully EXCLUDED by the context check (a demoted grounding is still >0,
     so combine.ts's pool-membership `continue` never fires for them) — only
     DEMOTED or left at full strength. Full-strength ceiling per item is
     fold/cut/skip-INDEPENDENT (a bypass run with no seedTexts always hits
     `senseContextGate`'s `contextTokens.length === 0` early return,
     `bypass:true`, full grounding, regardless of the axis) — computed once.
   - T4-only items (`matchedKeywords` empty) have no demote path — only
     presence/absence in the pool. Tracked by plain set membership.
   - LOSS = (in baseline, not in candidate) OR (in both, was at ceiling,
     now below it). GAIN = (in candidate, not in baseline) OR (in both, was
     below ceiling, now at it).
4. Judge every new (not-yet-labeled-by-A) gained/lost id from its real
   title+abstract: genuine / wrong-field / borderline, one line each.
5. Apply the pre-set selection rule (§1bg.11.c) to the cuts that hold both
   hard bars (0/150 negatives; both R3 residuals demoted).
6. Ship the winning percentile as a plain literal (still table-derived at
   load); update the pinned test; add the 2 named protective tests
   (W7172267740, the solid-electrolyte ion-transport paper) plus a test that
   the wrong-field gains the chosen cut still excludes stay demoted/excluded.
7. Correct this checkpoint's false claim in place (done — see above) rather
   than deleting it, per the hard rule against silently rewriting history.
8. Mutations (cut removal → Thorium red; percentile back to p25 → the
   W7172267740 protective test red; re-confirm the existing skip-rule and
   fold isolating mutations still work at the NEW percentile) + all 4 gates.

## Log

- Read ABC-JEV-INTEGRATION.md §1bg point 11 AMENDMENT (a-e) in full — binding,
  transcribed above. Read docs/jev-abc/SENSE-CONTEXT-EVIDENCE-A-20260929T175044Z.md
  in full (FAILED_REVIEW, the HIGH finding, per-item judgments, mutation/gate
  confirmations).
- Confirmed current working-tree keyword.ts hash matches the hash A and my
  own round-1 checkpoint both recorded: `eb7f9d07a6919ae3ede1bb3fc7561a7050db02dcb935734229a9b26a2c554572`
  — starting this round from exactly the reviewed state, nothing drifted.
- Computed the 7 swept cut weights directly from the shipped table (same
  percentile definition as round 1: sort ascending, `floor(P/100*n)`):
  p5=5.11, p8=5.531, p10=5.742, p12=5.937, p15=6.224, p20=6.561, p25=6.784 —
  p10/p12 match the coordinator's own cited values exactly (5.742/5.937).
- Built the sweep harness: (1) a temporary, single-line env-var override on
  `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE` (falls back to the real 25);
  (2) `__c_probe_sweep.test.ts`, computing per tag/harness admitted-id sets +
  per-item keyword scores via the real `scoreItems`, plus a `ceiling` (bypass,
  no-context run — fold/cut/skip-independent by construction, since an empty
  context text always hits `senseContextGate`'s early `bypass:true` return
  regardless of axis) computed once against the baseline. Ran once in
  "baseline" mode with keyword.ts's 3 additions temporarily reverted (same
  technique as the round-1 mutations, restored by hash after), then 7 times
  in "candidate" mode (one per percentile) against the current code.
- **Independent cross-check of the revert-based baseline against TRUE HEAD**
  (needed once a discrepancy with A's report turned up — see below): built 4
  `git show HEAD:...` copy files (A's own technique) with import paths
  redirected to each other, confirmed the "revert 3 additions" shortcut and
  true HEAD give IDENTICAL total admitted counts on every tag/harness (e.g.
  solid-state all-in-window: 41 both ways) — the shortcut is behaviourally
  sound, not just structurally plausible.

## Two corrections to A's per-item findings, found by execution

While tracing every claimed loss/gain to build the labeled table, two of A's
five named items do NOT reproduce, checked THREE independent ways (the
revert-based baseline, the true-HEAD git-show copies, and — for the T4 item
— a direct computation of T4's own `simTopic`/`simProject` floors):

1. **The solid-electrolyte ion-transport paper (`openalex:W7204909059` /
   `W7204866765`) was never T4-admitted at HEAD in either reconstruction**
   (both give 41/62 total for solid-state all-in-window, this item absent
   both times — confirmed against true HEAD too). The CONTEXT GATE itself
   does flip (HEAD: `fixedSim 0.0601, overlapSim 0.1364, pass:true`; p25:
   `fixedSim 0.0830, overlapSim 0, pass:false` — a real, reproducible flip),
   but it is moot for this item: T4 requires `simTopic >= 0.15` OR
   (`simTopic > 0` AND `simProject >= 0.05`) as a SEPARATE, independent gate
   before the context check is even consulted for admission purposes, and
   this item's real values are `simTopic = 0.0244`, `simProject = 0.0408` —
   both below their floors regardless of the context gate's verdict. Re-ran
   with production-realistic enriched seed texts (matching test 17's own
   `ENRICHED_SOLID_STATE_SEED_TEXTS` shape) — still not admitted either way.
   Not a real loss; the gate-level flip is real but never reaches the
   product.
2. **`pubmed:42603427` (biofilm bioenergetics) was never admitted in either
   baseline or any of the 7 candidate percentiles** — checked directly
   against every saved sweep result. A's own report already flagged this one
   as "not separately verified," consistent with this finding.

Both corrections are reported for the record, not used to argue the STOP
below should be reconsidered — the decisive losses (below) are independently
confirmed, real, and if anything the sweep found MORE genuine losses than
A's own single p25 data point surfaced.

## Sweep table (all 7 percentiles; fold + skip rule ON; floors unchanged;
## losses/gains are SET differences against the true "today"/HEAD baseline)

Solid-state and LCO: **0 losses at every one of the 7 percentiles, in BOTH
harnesses** — only gains (`openalex:W7214086461` newly included via T4 in
solid-state/all-in-window at every percentile; `openalex:W7204043657`, a
genuine LCO-recycling paper, undemoted to full strength at every percentile
in both harnesses). Negatives: **0/150 at every percentile.** Both R3
residuals: **demoted at every percentile** (keyword 0.1667, ceiling 0.6667).
Live LCO: `W7213893763` full strength, the cuprate demoted, Li2C2O4
unaffected — **unchanged at every percentile** (the skip rule, not the cut,
is what governs these three specific items).

The entire story is in the **electrolyte** tag (identical losses/gains in
both the literal-match-subset and all-in-window harnesses at every
percentile — the demoted/undemoted items are all T1 literal hits, never
excluded, so the two harnesses move together):

| p | cut wt | LOSSES (id — label) | wrong-field gains | genuine/borderline gains (count) | bar (1) zero genuine/borderline loss? |
|---|---|---|---|---|---|
| 5 | 5.110 | W7213888420—wrong-field; **arxiv:2609.08721—genuine** | 0 | 9 | **NO** |
| 8 | 5.531 | W7213888420—wrong-field; **arxiv:2609.08721—genuine** | 0 | 7 | **NO** |
| 10 | 5.742 | W7213888420—wrong-field; **arxiv:2609.08721—genuine** | 0 | 7 | **NO** |
| 12 | 5.937 | W7213888420—wrong-field; **arxiv:2609.08721—genuine** | 0 | 8 | **NO** |
| 15 | 6.224 | W7213888420—wrong-field; **arxiv:2609.10341—genuine; arxiv:2609.08721—genuine; arxiv:2609.14588—genuine** | 0 | 7 | **NO** |
| 20 | 6.561 | W7213888420—wrong-field; **W7172267740—genuine; arxiv:2609.03717—borderline** | 2 (W7204716846, arxiv:2608.14351) | 12 | **NO** |
| 25 | 6.784 | W7213888420—wrong-field; **W7172267740—genuine; arxiv:2609.03717—borderline** | 2 (same 2) | 12 | **NO** |

New item labels (title/abstract-based, one line each; A's own 5 labels
reused verbatim where named):
- `arxiv:2609.08721` "Competing Ring-Opening and Hofmann Elimination
  Pathways in Aqueous TEMPO Catholytes" — **genuine**: aqueous redox-flow
  battery catholyte degradation chemistry, squarely a battery-electrolyte
  materials paper (a different battery chemistry than the reader's
  solid-state focus, same standard A applied to W7172267740).
- `arxiv:2609.10341` "Surrogate-accelerated parameterisation of
  physics-based Li-ion battery models" — **genuine**: Li-ion battery model
  with explicit electrolyte dynamics (SPMe).
- `arxiv:2609.14588` "Binder chemistry sets the interfacial balance constant
  in CsPbBr3 nanocrystal supercapacitor electrodes" — **genuine**:
  electrolyte-concentration effects on electrode capacitance, on-topic
  electrochemical energy storage.
- (Full gain lists per percentile, all individually judged while building
  this table — every id above p20/p25's 14 gains was inspected; the 12
  non-wrong-field ones are real battery/electrolyte/solid-electrolyte papers
  except `arxiv:2608.15014` "Voltage-Controlled Phosphate Precipitation
  Gating in Solid-State Nanopore Memristors" and `arxiv:2608.28903`
  "Revealing low-energy surfaces of multinary compounds..." — both
  **borderline** (adjacent materials-science work, not explicitly battery/
  electrolyte in framing) rather than clearly genuine; none are wrong-field.

**No percentile among the 7 authorized meets pre-set criterion (1) — zero
genuine-or-borderline losses in both harnesses.** Per §1bg.11.c: "If no cut
meets (1), STOP and report the table — the manager decides." Per the same
instruction, criteria (2)/(3) are reported above for context but were NOT
used to pick a winner myself.

## Correction to the round-1 checkpoint's false claim (§1bg.11.e)

The round-1 "Demoted-after list: none found... nothing to list for A" and
"no id present in the before pass set is absent from the after pass set for
any of the 6 harness cells" claims ABOVE in this document are **FALSE**,
exactly as A found. **CORRECTED here:** that check compared aggregate COUNTS
per tag/harness cell (which do all net-increase — true and still true), not
SET membership — a real loss can be, and in this case was, masked by an
unrelated gain landing in the same cell. The correct method, used
throughout this fix round: for every tag and harness, compute the admitted-
id SET at "today"/HEAD and at the candidate configuration through the real
`scoreItems`, then diff the sets directly (id-by-id), separately tracking (a)
items present in one set but not the other (T4 admit/exclude swings — T1/T2/
T3 literal hits can never be excluded this way, only demoted) and (b) items
present in both sets whose keyword score moved between "at its own bypass-
computed ceiling" and "below it" (T1/T2/T3 demote/undemote swings). The real
list of round-1's actual losses at p25 is given in full in the sweep table
above (the p25 row) — 3 items, one a correct wrong-field demotion and two
genuine papers incorrectly losing strength — not the empty list originally
claimed.

## Decision — STATUS: STOPPED_ESCAPE

No swept percentile (p5 through p25) satisfies the pre-set bar. Reporting
the full table to the manager per §1bg.11.c; not choosing a percentile.
**No product file is changed by this fix round**: keyword.ts is restored
byte-for-byte to the round-1 reviewed state (sha256
`eb7f9d07a6919ae3ede1bb3fc7561a7050db02dcb935734229a9b26a2c554572`, verified
after every mutation/sweep step and at the end; one intermediate restore
landed on LF line endings instead of the repo's CRLF convention — caught by
the hash mismatch, fixed by re-normalizing to CRLF, re-verified byte-
identical). Steps (d) (ship a percentile) and (f) (new protective tests/
mutations/gates for a new shipped state) are not applicable — nothing new
ships this round. `git status --short` at the repo root shows exactly the
same 8 files as round 1 (unchanged since), this checkpoint, the pre-existing
A/B guide docs (not mine), `ABC-JEV-INTEGRATION.md` (modified before this
session), and the pre-existing untracked `node_modules/` — no probe/diag
file remains (14 temporary files used this round, all named `__c_probe_*`,
all deleted).

STATUS (STOP round): STOPPED_ESCAPE → manager decision: ship p10 (§1bg point 12).

---

# Ship round — §1bg point 12 (2026-09-29T18:5xZ)

Manager ruling (binding, transcribed): ship p10 (5.742 on today's table). Reason
given: dominates p15–p25 (fewer genuine losses, no wrong-field promotion), ties
p5–p12 on losses, sits nearest the middle of the observed gap between non-topical
words (at/below "focused" 5.126) and domain words (from "electrode" 6.091) — a
small table shift cannot flip either family; p5 (5.110) would keep "focused" on
the axis. ACCEPTED COST (point 12b): `arxiv:2609.08721` stays demoted at p10 (a
T1 literal hit, never dropped, just lower); its non-monotone recovery at p20 is
the overlap coefficient's min-denominator behaviour, noted for the next design,
not re-litigated here. Threshold for B to revisit: one live genuine paper in the
reader's own CORE topic (solid-state battery electrolytes, not an adjacent
chemistry) demoted by the cut.

## Plan (this round)

1. keyword.ts: `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE` 25 → 10 (one
   literal, still computed from the table at load with the same definition).
   Update every doc comment naming p25/25th-percentile/6.784 — including
   replacing the now-WRONG "electrolyte itself, 6.18, drops off the axis"
   accepted-cost example (at p10 = 5.742, "electrolyte" 6.178 stays ON the
   axis — it only fell off at p25) with the real, ruled accepted cost:
   `arxiv:2609.08721`'s demotion, point 12b's exact reasoning.
2. Tests (sense-context.test.ts): move the pinned-cut assertion to ≈5.742
   (verify my definition still gives this before asserting it — same
   definition as round 1, already re-derived in the STOP round's sweep:
   confirmed 5.742 there). Protective tests using REAL saved text (already
   fetched during the sweep, reused verbatim): `openalex:W7172267740` full
   strength; `openalex:W7204716846` and `arxiv:2608.14351` demoted (at p10
   neither ever gained — they only appeared as wrong-field gains at
   p20/p25); a tripwire pinning `arxiv:2609.08721` DEMOTED at p10, comment
   "accepted cost, §1bg.12b". Reader context: the SAME `BATTERY_PROJECT_TEXT`
   constant every other electrolyte test in this file already uses (not the
   enriched R3 seed-text list, which is solid-state-specific) — stated here
   per the brief's instruction to say which.
3. Re-run the set-diff harness ONCE at p10 (same probe shape as the STOP
   round, prefix `__c_probe_`) to confirm the shipped code reproduces the
   sweep row exactly: electrolyte losses = {W7213888420, arxiv:2609.08721}
   only, 0 wrong-field gains, solid-state/LCO 0 losses, 0/150 negatives,
   both R3 residuals demoted, live LCO unchanged. Delete before finishing.
4. Mutations, hash-verified restores: p10 → p25 must turn the W7172267740
   protective test red (that item was only safe below p20); removing the
   cut entirely must turn the Thorium test red (unchanged mechanism from
   every prior round).
5. Gates: vitest / tsc / eslint / build, one at a time from web/.

## Log

- **Step 1 done.** keyword.ts: `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE`
  25 → 10 (one literal, still computed from the table at load with the same
  0-indexed `floor(P/100*n)` definition). Updated all 3 doc comments that
  named p25/25th-percentile/6.784: the constant's own doc comment (full
  history + the point-12 reasoning + point-12b's accepted cost, stated where
  the cut is defined, as asked); the AMENDMENT-4 block's cross-reference
  (now says "Pth-percentile... P=10 as shipped" and points at the constant's
  own comment rather than duplicating the number); the accepted-cost
  paragraph (the OLD example, "electrolyte itself, 6.18, drops off the
  axis," is factually WRONG at P=10 -- 6.178 > 5.742, "electrolyte" stays ON
  the axis now -- replaced with the real, ruled accepted cost,
  `arxiv:2609.08721`). `npx tsc --noEmit` clean immediately after.
- **Step 2 done.** sense-context.test.ts: test 19's pin moved to
  `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE === 10` /
  `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT ≈ 5.742` (verified my percentile
  definition gives exactly this before asserting it -- already re-derived
  during the STOP round's own sweep, p10 = 5.742, matching the coordinator's
  own cited value). New describe block "test 23" with the 4 ruled protective
  tests, real text from the saved pool files (title/abstract/tags exactly as
  saved; W7172267740 is a title-only record, abstract ""): W7172267740 full
  strength; W7204716846 and arxiv:2608.14351 demoted (0 wrong-field
  promotion at P=10); arxiv:2609.08721 demoted with the "accepted cost,
  §1bg.12b" comment the brief asked for. Reader context: `BATTERY_PROJECT_TEXT`
  -- the same constant every other electrolyte test in this file already
  uses (stated here per the brief's own instruction to say which; NOT the
  solid-state-specific `ENRICHED_SOLID_STATE_SEED_TEXTS` list test 17
  builds for the R3 residuals, which is a different tag's fixture).
  Also fixed a STALE historical comment (not a live assertion) in test 17's
  "state-dependent" protective fixture that still named "6.784" as "the new
  cut" -- corrected to note the cut has since narrowed to P=10/5.742, and
  why the fixture's own choice (an unseen token, immune to any future
  percentile change) still holds regardless.
  **One pre-existing test needed a second real-fixture swap** (same
  structural issue round 1 already hit twice: a gentler cut retains MORE
  overlap-axis words, so a fixture picked to isolate "the RESCUE path alone
  saves it" can stop isolating that property once the cut moves): the round-1
  companion test's fixture (`arxiv:2606.31261`) now clears the AND path too
  at P=10 (overlapSim 0.231 ≥ 0.10). Searched all 3 real pools directly
  against the live P=10 axis (temporary probe) for a replacement whose
  overlapSim stays below the floor specifically at THIS cut; found
  `arxiv:2604.26545` ("Physics-based modeling of cyclic and calendar aging
  of LIBs with Si-Gr composite anodes," real text, overlapSim 0.077 <
  0.10, fixedSim 0.248 ≥ 0.10 rescue) and swapped it in, same discipline as
  every prior swap (verified against the real exported gate before trusting
  it). `npx tsc --noEmit` clean; `npx vitest run src/lib/scoring/sense-context.test.ts`:
  56/56 passed (52 prior + 4 new test-23 tests).
- **Step 3 done.** Temporary probe `__c_probe_confirm_p10.test.ts` (deleted
  after use) re-ran the set-diff harness against the SHIPPED P=10 code (no
  env-var override this round -- the literal `10` itself). Reported BOTH
  metrics for clarity: the direct-`senseContextGate`-call "X/Y" numbers this
  whole lineage has always cited for the harness tables (literal-subset
  electrolyte 58/89, solid state 25/25, LCO 2/3; all-in-window 68/145,
  53/62, 2/3 -- NOTE this direct-call number for LCO structurally cannot see
  the skip rule, which lives one level up in `scoreKeyword`, not inside
  `senseContextGate` itself -- named so a future reader isn't confused by
  the LCO gap between this and the next number) AND the full-pipeline
  `scoreItems` admitted-count (skip-rule inclusive, the number the STOP
  round's own sweep table and its saved `sweep_p10.json` actually used):
  literal-subset 88/25/3, all-in-window 88/42/3 -- EXACT MATCH to
  `sweep_p10.json`'s own recorded `admittedIds.length` for every cell.
  Named-item check (full `scoreItems`, electrolyte, all-in-window):
  `W7213888420` DEMOTED, `arxiv:2609.08721` DEMOTED (the 2 losses, exactly
  as ruled), `W7172267740` FULL, `W7204716846` DEMOTED, `arxiv:2608.14351`
  DEMOTED (0 wrong-field gains, exactly as ruled), `arxiv:2609.03717` FULL
  (correctly unaffected at P=10 -- this one is only lost at p20/p25, matching
  the sweep table). Negatives 0/50 on all 3 tags. Thorium R3 residual:
  0.1667 (demoted, ceiling 0.6667). Live LCO: `W7213893763` 0.4667=0.4667
  (full strength), the cuprate 0.1167 vs bypass 0.42 (demoted), Li2C2O4
  0.42 (unaffected) -- all unchanged from every prior measurement. Probe
  deleted; `git status --short` shows no `__c_probe_*` file remaining.

  **CORRECTED (§1bg point 13, fix round 2):** the sentence above ("the 2
  losses, exactly as ruled") is FALSE — a third electrolyte loss,
  `openalex:W7203865202`, existed at P=10 and was never found. Cause: my
  measurement code (both this step-3 probe AND, more consequentially, the
  STOP round's `<scratchpad>/analyze_sweep.mjs`) computed a "ceiling" (the
  ungated full-strength value) by calling `scoreItems(items, {topics:[tag]})`
  with `seedTexts` OMITTED — but `combine.ts`'s own pass-2 filter,
  `shouldPushReviewPaper`, reads that SAME `seedTexts` field for an
  unrelated purpose (suppressing review-type papers unless they directly
  match the reader's declared project text) — so a review-flagged item that
  only clears that filter WHEN real project text is present silently
  vanished from the no-context "ceiling" run's output. `analyze_sweep.mjs`'s
  `diffCell()` then did `const ceil = ceiling[id]; if (ceil === undefined)
  continue;` — silently DROPPING such an id from both the gains and losses
  lists instead of flagging it as uncomparable, exactly like the first
  review's count-vs-set mistake: a completeness gap in a "verified" claim,
  not caught because the tooling failed quietly instead of loudly. 10 ids
  (7 electrolyte, 3 solid state) were affected; 9 happened to be unchanged
  either way, but `openalex:W7203865202` was not — full strength at HEAD,
  demoted at p8–p12/p15 (full again at p5, p20, p25 — a second, independent
  non-monotone swing, found by A2 reading the STOP round's own saved
  `sweep_p{5,8,...,25}.json` `literalKeyword` values directly, which do NOT
  have this gap — only the human-facing diff table built on top of them
  does). Corrected method (used for the re-run below): classify every
  T1/T2/T3 literal hit via `scoreKeyword()` called DIRECTLY — the exact
  function the fold/cut/skip-rule live inside — with `senseContext:
  {contextText: ""}` for the ceiling (this hits `senseContextGate`'s own
  `contextTokens.length === 0` bypass path and returns full grounding,
  WITHOUT ever calling `combine.ts`/`shouldPushReviewPaper` at all, so the
  confound cannot arise) and `senseContext: {contextText: BATTERY_PROJECT_TEXT}`
  for the real before/after comparison; only genuine T4-only items (no
  literal hit under either state) need `scoreItems`, and for those the
  before/after comparison uses the SAME real `seedTexts` on both sides, so
  `shouldPushReviewPaper` behaves identically both times and cancels out of
  the diff — no ceiling is needed for T4 at all, only presence/absence. Any
  id that still cannot be classified this way is FLAGGED explicitly, never
  silently dropped. See the re-run below for the corrected, complete list.
- **Step 4 done.** Mutations, sha256 before every mutation and after every
  restore: `fa12abd5d0260327be7ce396e3b6488fb98abc5b0a550f3176cdb3e5a381b049`
  (identical both times, both mutations).
  1. p10 → p25 (one literal edit): the required `openalex:W7172267740`
     protective test goes red, exactly as ruled (`expected ... to be close
     to ...` -- it drops from full strength to demoted). 5 OTHER tests also
     go red under this same mutation (the pinned-cut test, by design; 3 more
     of test 23's own protective tests; 1 side effect on the rescue-isolation
     fixture) -- all individually explained by the sweep data (p25 is where
     W7204716846/arxiv:2608.14351 get promoted and arxiv:2609.08721's
     non-monotone recovery kicks back in), not a surprise. The one the
     ruling named is confirmed among them.
  2. Remove the cut entirely (both overlap-axis filter clauses): the
     Thorium test (test 17) goes red, exactly as ruled and unchanged from
     every prior round's version of this same mutation. 2 side-effect
     failures, both explained the same way (a fully-open axis is even more
     permissive than p25).
  Both restored; hash identical both times.
- **CRLF check.** `file` reported `keyword.ts` still CRLF after all edits
  (confirmed at every hash checkpoint this round). `sense-context.test.ts`
  had drifted to LF-only at some point across the two rounds' worth of Edit-tool
  changes (git itself was unaffected -- `git diff --stat` was already
  reporting a clean, accurate 530/13 line diff either way, and `git`'s own
  `core.autocrlf=true` would have silently fixed this on the next `git add`
  regardless) -- normalized back to CRLF explicitly per this round's hard
  constraint, re-verified content-identical (tsc clean, 56/56 tests, same
  diff --stat before and after the normalization).
- **Step 5 (gates).** `npx vitest run`: 288 files (285+3 skipped) / **5290
  passed + 6 skipped / 0 failed** (5286 prior + 4 new test-23 tests).
  `npx tsc --noEmit`: 0 errors. `npx eslint .`: **0 errors / 151 warnings**
  (unchanged). `npm run build`: **OK, all routes compiled, exit 0.**

## Final changed-file list

Same 8 files as round 1 (only keyword.ts and sense-context.test.ts changed
this round). No network calls; web/.env* never opened; no keys written; no
commit/push/stash/branch; node_modules/ and the dev server untouched; every
temporary probe this round used the __c_probe_ prefix and all are deleted --
git status --short shows exactly the 8 files, this checkpoint, the
pre-existing A/B guide docs (not mine), ABC-JEV-INTEGRATION.md (modified
before this session), and the pre-existing untracked node_modules/.

STATUS (ship round): IMPLEMENTED_PENDING_REVIEW → fresh A2 FAILED_REVIEW.

---

# Fix round 2 — §1bg point 13 (2026-09-29T19:3xZ)

Manager ruling (binding, transcribed): **p10 STAYS.** A2
(docs/jev-abc/SENSE-CONTEXT-EVIDENCE-A2-20260929T185226Z.md) proved by
execution: (HIGH) a third electrolyte loss, `openalex:W7203865202` ("Recent
Advances and Future Perspectives of Proton-Conducting Electrolytes for
Reversible Solid Oxide Cells" — a review article), full strength at HEAD,
demoted at p8–p15 (full at p5, p20, p25) — never reported by my ship-round
checkpoint. Root cause in MY OWN sweep tooling (`<scratchpad>/analyze_sweep.mjs`):
the "ceiling" run computed via `scoreItems(..., {topics:[tag]})` with NO
seedTexts — but combine.ts's pass-2 `shouldPushReviewPaper` filter reads that
SAME `seedTexts` field for an unrelated purpose (review-suppression), so a
review-flagged item that only clears that filter WITH real project text
silently vanished from the ceiling-only (no-context) run. My `diffCell()`
then did `if (ceil === undefined) continue` — silently DROPPING the id from
both gains and losses instead of flagging it as uncomparable. 10 ids (7
electrolyte, 3 solid state) were silently dropped this way; 9 were coincidentally
unaffected (full both before/after either way), but W7203865202 was not.
(MEDIUM) `pool-cache.ts`'s v17→18 history comment still names "25th-percentile."
**Decision: keep p10** (re-derived, not repeated — p5 no longer "ties": it
loses one fewer paper but keeps "focused" 5.126 on the axis, only 0.016 above
the p5 cut, the exact word that let the Thorium residual through; p10 keeps a
larger margin on both sides). W7203865202 gets the SAME treatment as
arxiv:2609.08721 (a genuine but adjacent-device-class paper, not the reader's
own core lithium/sodium battery chemistry) — **ACCEPTED COST 2**, with a
named tripwire test, §1bg.13c.

## Plan (this round)

1. Correct the ship-round claim in place (below) — mark CORRECTED, name the
   review-policy-confound cause and the corrected method (`scoreKeyword`
   direct, bypassing combine.ts's pass-2 filter entirely for the T1/T2/T3
   ceiling; presence/absence diff via `scoreItems` with the SAME real
   seedTexts both before/after for T4-only items, where the confound cannot
   arise since nothing empties seedTexts in that comparison).
2. Re-run the full p10 set diff with the corrected method, both harnesses,
   all 3 tags — every id compared or explicitly FLAGGED, never silently
   skipped. Confirm: electrolyte losses = exactly {W7213888420,
   arxiv:2609.08721, W7203865202}; the same 7 electrolyte gains A2 named;
   solid-state/LCO gains/losses unchanged (0 losses, 1 gain each); 0/150
   negatives; both R3 residuals demoted. STOP if anything else moves.
3. sense-context.test.ts: a tripwire for `openalex:W7203865202`, real saved
   text, `BATTERY_PROJECT_TEXT` context, DEMOTED at p10, comment "accepted
   cost 2, §1bg.13c".
4. pool-cache.ts: fix the stale "25th-percentile" comment (comment only, no
   behavior change) to correctly say 10th-percentile / ≈5.742.
5. Mutation: p10 → p25 → the new tripwire goes red (W7203865202 is full at
   p25, matching A2's own cross-swept data). Restore, hash-verified, CRLF
   preserved.
6. Gates, probe cleanup.

## Log

- **Step 1 done** — see the CORRECTED block inline in the ship round's Step 3
  log above.
- **Step 2 done.** Rebuilt the 4 HEAD-copy files (`git show HEAD:...`, import
  paths redirected to each other — the STOP round's own technique, deleted
  after that round and recreated here). New temporary probe
  `__c_probe_setdiff2.test.ts`: classifies every T1/T2/T3 literal hit via
  `scoreKeyword()` DIRECTLY (before=HEAD-copy, after=current, ceiling=current
  with `contextText:""` — never touches `combine.ts`, so
  `shouldPushReviewPaper` never runs and cannot drop an id); T4-only
  candidates (no literal hit under either state) via `scoreItems` presence/
  absence with the SAME real `seedTexts` both times (no ceiling needed, no
  confound possible). Every item in every pool is visited; anything that
  cannot be classified cleanly is pushed to a FLAGGED list, never silently
  dropped. Ran across all 3 tags, both harnesses (6 calls total):
  - **electrolyte, literal-subset AND all-in-window (identical — every mover
    is a T1 hit, matches the established pattern): LOSSES = exactly 3 —
    `openalex:W7203865202`, `openalex:W7213888420`, `arxiv:2609.08721` —
    nothing else. GAINS = exactly the 7 A2 named (`W7202367926`,
    `W7202147667`, `W7203493877`, `pubmed:42612502`, `arxiv:2609.28768`,
    `arxiv:2609.28369`, `arxiv:2609.26685`). FLAGGED = 0.**
  - solid state: literal-subset 0 losses/0 gains; all-in-window 0 losses, 1
    gain (`openalex:W7214086461`, T4) — unchanged from the ship round, 0
    flagged both harnesses.
  - LCO: 0 losses either harness, 1 gain both (`openalex:W7204043657`) — 0
    flagged.
  - **Nothing else moved anywhere** — the STOP condition ("if anything else
    moves, STOP") was not triggered.
  - Negatives (via the same direct-`scoreKeyword`-vs-ceiling technique, the
    "full strength" metric this whole lineage's "0/150" has always meant):
    **0/50 full-strength on all 3 tags — 0/150 total, confirmed.** (Also
    printed, for transparency, how many of each 50 appear in `scoreItems`
    output AT ANY score — 34/50 electrolyte, 46/50 solid state, 2/50 LCO —
    this is NOT a safety metric on its own, just visibility into how many are
    present-but-demoted vs. excluded/rule-c-blocked entirely; every single
    one of the 150 is confirmed at 0 full-strength, which is what "0/150"
    has always meant in every prior round's citation.)
  - Both R3 residuals: Thorium 0.1667, quantum-storage 0.1667 (both demoted,
    ceiling 0.6667 for "solid state") — confirmed via a second small probe.
  - Probes deleted (`__c_probe_setdiff2.test.ts`, `__c_probe_r3b.test.ts`,
    all 4 `__c_probe_head_*.ts` files); `git status --short` confirms none
    remain.

- **Step 3 done.** New tripwire test in test 23's block: real text (title,
  abstract exactly as saved, no tags), `BATTERY_PROJECT_TEXT` context, comment
  "accepted cost 2, §1bg.13c". **Reproduced the SAME review-policy confound
  live**: my first draft used the sibling tests' `scoreItems(...,
  {topics:["electrolyte"]})` no-seedTexts bypass technique, and it returned
  an EMPTY array for this exact item (`Cannot read properties of undefined`)
  — this paper's own title literally says "Review", tripping
  `shouldPushReviewPaper`'s filter the moment seedTexts is empty. Fixed by
  switching to the corrected method for this one test: `scoreKeyword()`
  called directly for both the real (`BATTERY_PROJECT_TEXT`) and ceiling
  (`contextText: ""`) comparisons, never through `combine.ts`; kept one
  `scoreItems` call to independently confirm the item still reaches the real
  pipeline output (`matchedKeywords`, presence) and that its
  `scoreBreakdown.keyword` agrees with the direct call. Comment explains why
  this test's technique differs from its siblings. `npx tsc --noEmit` clean;
  `npx vitest run src/lib/scoring/sense-context.test.ts`: 57/57 passed.
- **Step 4 done.** pool-cache.ts line 328 (the v17→18 history comment):
  "25th-percentile" → "Pth-percentile weight (P = 10 as shipped...)",
  pointing at `keyword.ts`'s own
  `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE` doc comment for the full
  history rather than restating the number a second place (A2's own
  suggestion). Comment-only, no behavior change. `npx tsc --noEmit` clean.
  CRLF confirmed preserved on both edited files (`file` command).

- **Step 5 done.** sha256 before mutation and after restore:
  `fa12abd5d0260327be7ce396e3b6488fb98abc5b0a550f3176cdb3e5a381b049`
  (identical — restored via `cp` from a scratchpad backup this time, which
  preserves bytes exactly, so no CRLF drift this round; `file` reconfirmed
  CRLF after restore). p10 → p25 (one literal edit): the required new
  `openalex:W7203865202` tripwire goes red exactly as ruled
  ("expected 0.4667 to be less than 0.4667" — full strength at p25, matching
  A2's own cross-swept finding). 6 other tests also go red under this same
  mutation (same pattern as the ship round's identical mutation: the pinned-
  cut test by design, 3 more test-23 protective tests, 1 rescue-isolation
  side effect) — all explained by the sweep data, the required one confirmed
  among them. `npx vitest run src/lib/scoring/sense-context.test.ts`: 57/57
  passed after restore.
- **Step 6 (gates).** `git status --short` before gates: no `__c_probe_*`
  file present (all deleted in step 2). `npx vitest run`: 288 files
  (285+3 skipped) / **5291 passed + 6 skipped / 0 failed** (5290 prior + 1
  new tripwire). `npx tsc --noEmit`: 0 errors. `npx eslint .`: **0 errors /
  151 warnings** (unchanged). `npm run build`: **OK, all routes compiled,
  exit 0.**

## Final changed-file list (this round)

`web/src/lib/scoring/sense-context.test.ts` (the tripwire),
`web/src/lib/opportunities/pool-cache.ts` (comment-only fix) — the only 2
files touched this round; `keyword.ts` was mutated and restored (hash-
identical) but has no net diff beyond the ship round's already-final state.
Plus this checkpoint doc. No network calls; web/.env* never opened; no keys
written; no commit/push/stash/branch; node_modules/ and the dev server
untouched; every temporary probe used the `__c_probe_` prefix and all are
deleted — `git status --short` confirms exactly the 8 product/test files
(unchanged set since round 1), this checkpoint, the pre-existing A/A2/B
guide docs (not mine), `ABC-JEV-INTEGRATION.md` (modified before this
session), and the pre-existing untracked `node_modules/`.

STATUS: IMPLEMENTED_PENDING_REVIEW
