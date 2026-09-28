STATUS: COMPLETE — VERDICT: FAILED_REVIEW

# SENSE-CONTEXT — A review (fresh, post AMENDMENT 2 / Phase 3)

Role: A (independent reviewer). Never fixes code. Reviewing C's phase-3 implementation
(docs/jev-abc/SENSE-CONTEXT-C-20260928T180135Z.md) against ABC-JEV-INTEGRATION.md §1ap +
AMENDMENT + AMENDMENT 2, §1ao + ADDENDUM, §1an + AMENDMENT, §1c, and the §5 SENSE-CONTEXT row
(manager's "tally #1 confirmed" ruling — fresh A assigned to re-measure).

Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD b068dd47 at start.

## 0. Snapshot

`git status --short` at start:
```
 M ABC-JEV-INTEGRATION.md
 M web/src/lib/opportunities/pool-cache.test.ts
 M web/src/lib/opportunities/pool-cache.ts
 M web/src/lib/scoring/combine.ts
 M web/src/lib/scoring/keyword.ts
 M web/src/lib/scoring/required-gate.test.ts
?? docs/jev-abc/SENSE-CONTEXT-B-20260928T173815Z.md
?? docs/jev-abc/SENSE-CONTEXT-C-20260928T180135Z.md
?? node_modules/
?? web/src/lib/scoring/sense-context.test.ts
```

SHA256 of every change-list file (baseline, before any mutation testing):
```
9942dc9840767385d391f18fb51bf6c7f2b0cc3f7cbd6221146752f8f52dbeec  web/src/lib/scoring/keyword.ts
d47c409fd36d2f57d8e071e025d2523bb983f2622058e34430f0b592b52bd348  web/src/lib/scoring/combine.ts
f97a00730b2a43d020b18edc645799a578c55072d014fa659117a1c714e6b5eb  web/src/lib/scoring/required-gate.test.ts
e98755581e87501c30761669944e21de43d849c4da00f7eebeae9b1b5486d871  web/src/lib/scoring/sense-context.test.ts
1b212fa301469369e8df5ebe22c16773f511c1db29936452d087d6d5d135a480  web/src/lib/opportunities/pool-cache.ts
cb7311c15d0ddf4947f2e4265bf805fd6afd90993e097121eaa54a73a11e6d68  web/src/lib/opportunities/pool-cache.test.ts
```

Confirmed UNMODIFIED (`git diff --quiet`, exit 0 for all): `ranking.test.ts`, `term-expand.ts`,
`tfidf.ts`, `tokenize.ts`, `senses.ts`.

STATUS: check 0 DONE.

## 1. Code review

Read in full: `web/src/lib/scoring/keyword.ts`, `combine.ts` (current, post-diff), `term-expand.ts`,
`tokenize.ts`, `tfidf.ts` (read-only, confirmed unmodified), `web/src/lib/feed/senses.ts` (grep,
confirmed 5-entry finite catalog, `requiresContext`/`contextMarkers`, disjoint by construction),
`required-gate.test.ts`'s diff and SEM describe block, `sense-context.test.ts` in full (new file).

Findings from reading (all consistent with the rulings, no code-level contradiction found):
- `isShortOrAmbiguous` = Option C exactly (canonical token count <=2, or every token `isGenericTerm`).
  Traced `canonicalize`/`isGenericTerm`/`GENERIC_TERMS` in term-expand.ts — matches.
- `senseContextStripSet` uses `expandTerm(tag)` -> `tokenize()` per variant, matching §1ap.2's "every
  `expandTerm()` variant token... stripped from both sides."
- `senseContextGate`'s own `cosine()` is a verbatim algorithmic duplicate of `tfidf.ts`'s private
  `cosine()` (compared line by line — identical dot/norm/denom logic), operating on `TfidfIndex`'s
  public `idf`/`itemVectors` fields; `tfidf.ts` itself untouched (confirmed by `git diff --quiet`).
  Explicit bypass (`contextTokens.length === 0`) precedes any floor comparison — never a naive `0 >=
  floor`, matching §1ap.2's warned-against failure mode.
- `scoreKeyword`'s per-topic loop refactor (grounding computed once, demote applied after) is
  semantically identical to the pre-SENSE-CONTEXT code path whenever `opts.senseContext` is undefined
  (traced both branches by hand) — every OTHER caller (softTopics call in combine.ts, events/jobs'
  `scoreKeyword` calls) never passes `senseContext`, confirmed by reading combine.ts in full: only the
  Required-topics call (line ~206) passes it.
- `fullyDemoted` computation traced through 5 scenarios by hand (single demoted match; demoted + a
  second context-passing match; T4-only admission; a senses.ts sense match; sense match + a demoted
  literal match) — correct in all 5. Confirmed T4 can never fire alongside a T1-3 demoted match for the
  SAME item (DEMOTE keeps `kw.score > 0`, so `combine.ts`'s `kw.score === 0` gate for entering the T4
  block is never satisfied once any topic demotes) — matches C's own checkpoint claim.
- `combine.ts`: exclusions (163) and `minPublishedAt` (164) run before `scoreKeyword` (191) — confirmed
  by reading the full current file, matches §4.4/§1c. `workText` (methods+venues+seedTexts only, NO
  topics, NO softTopics) is used for BOTH the Required-topics `scoreKeyword` call (206) and the T4
  loop's `senseContextGate` call (264) — same context source for both gates, as AMENDMENT 2(i) requires.
  `senseContextPenalty` (346) multiplies `base` only, never `softBonus`/`preference.boost` (348) —
  matches the ruling's "never touching softBonus/preference.boost."
- **Judged C's test 7/12 substitutions (checklist item): sound, not a shortcut.** Verified independently
  (not just trusting C's narrative): B's guide's proposed test-7 fixture ("Electrolyte disorders related
  emergencies in children") DOES literally contain "electrolyte" in its own title — confirmed by reading
  the real saved text in `out/sc-neg-electrolyte-clinical-pubmed.json` — so under DEMOTE it would take
  the T1-demote path, never reach T4 (kw.score>0 already), making it structurally unable to test the T4
  gate as B's guide intended. C's replacement (a constructed item with "solid"/"state" scattered
  non-adjacently, verified by hand against `termMatches`'s contiguous-phrase regex: it truly cannot T1-
  match "solid state") is a legitimate, narrower substitute that actually exercises the T4 path. For test
  12: confirmed by direct reasoning that a single-word tag's T4 `simTopic>0` anchor requires the literal
  word present, which under the SAME tokenization basis T1 also uses would already satisfy T1 first —
  structurally makes B's original two-real-electrolyte-paper fixture untestable under DEMOTE, exactly as
  C found. C's substitute (the long, SENSE-CONTEXT-exempt tag) is explicitly pre-authorized by B's own
  guide text ("either tag long or short does not matter for what F1 was actually testing"). Both
  substitutions are judged sound.
- **Probed `isShortOrAmbiguous` directly (not just read) on the requested real tags** — see checkpoint
  §2 (folded into the temp scenario file, all confirmed via actual execution, not just code reading):
  "solid state"/"LCO"/"electrolyte"/"SEM"/"solid electrolyte"/"materials" -> true; "Li ion battery" (3
  tokens, none generic) -> **false, EXEMPT** — a mechanical consequence of the <=2-token line, worth the
  manager's explicit awareness alongside "solid electrolyte" (2 tokens, covered) as the shape of that
  boundary; "solid-state battery electrolyte" -> false, EXEMPT (already directly tested by C).
- Cache: `PAPER_CACHE_KEY_VERSION` 7->8 via the single exported constant, doc comment updated,
  `pool-cache.test.ts`'s prose-only comment updated to match — confirmed via diff.
- `required-gate.test.ts`'s rewritten clinical test states the new DEMOTE contract with an explicit
  §1ap.3 comment naming the flip, per the hard "never delete, rewrite with a comment" constraint —
  confirmed by reading the diff in full.

No code-level defect found in this pass. All findings from direct execution are in §2 below.

## 2. Tests by execution

Ran `sense-context.test.ts` + `required-gate.test.ts` + `ranking.test.ts` together: **3 files, 39
tests, all passed.** Ran `admission.test.ts` (also imports `combine.ts`): **3 tests passed.** No
combine-related test file found failing.

### Temporary scenario file

Wrote `web/src/lib/scoring/sense-context.review.tmp.test.ts` (own fixtures, mostly REAL titles/
abstracts pulled fresh from B's saved `out/sc-neg-*.json`/`out/raw-*.json`/`out/tagged-*.json` —
different items than C's own `sense-context.test.ts` fixtures, for independent evidence). Final run:
**12/12 passed** (after 2 rounds of fixing MY OWN test artifacts, detailed honestly below — neither was
a SENSE-CONTEXT defect). Deleted after this review (confirmed in §6/final `git status`).

**Scenario (a) — real negatives demoted, ranked below genuine context-passing papers:**
- electrolyte: 2 fresh real clinical negatives (PubMed "Electrolyte disorders and arrhythmogenesis",
  "Rehydration during Endurance Exercise") demoted correctly (`matchedKeywords=["electrolyte"]`, keyword
  score exactly at the demoted ceiling), ranked below a fresh real genuine positive. PASS.
- LCO: 2 fresh real petroleum negatives demoted correctly, ranked below a fresh real genuine positive.
  PASS — but see the review-policy finding below (a test-authoring pitfall I hit and fixed, not a
  SENSE-CONTEXT bug).
- solid state: neg-vbs-2/neg-vbs-3 (2 of 3 fresh real physics negatives) demoted correctly and ranked
  below every genuine paper AT EVERY POOL SIZE TESTED (2/4/7/20/27/77 items — `sim=0` throughout,
  rock-solid). neg-vbs-1 (a 3rd real physics negative, "Many-Body Spin Berry Phases...") did **NOT**
  demote in a 7-item pool (full/undemoted keyword score 0.6667) but DID correctly demote once the pool
  was grown to real B/C measurement scale (~80 items, using B's own saved files) — see FINDING 1 below.

**Scenario (b) — genuine positives with context >=0.05 keep full grounding:** fresh real positives for
all 3 tags (different items than C's own test 3) kept full/undemoted keyword scores. PASS.

**Scenario (c) — no declared work context -> bypass, byte-identical to pre-SENSE-CONTEXT:** a genuine
positive AND (stronger than C's own test 2, which only tried a genuine positive) a real WRONG-DOMAIN
physics paper both kept full/undemoted grounding with zero declared context — proves the bypass is
unconditional, not a coincidence of the specific fixture. PASS.

**Scenario (d) — two unrelated short tags, no project text -> no cross-demotion:** a diffusion-models
paper and a gene-therapy paper (both 2-token tags, real regression shape from ranking.test.ts, own
fixtures) both kept full grounding for their own tag. PASS — confirms AMENDMENT 2(i)'s fix directly,
independent of C's own ranking.test.ts assertion.

**Scenario (e) — SEM selected-sense case unaffected:** true-sense and wrong-sense real SEM papers
(same real items required-gate.test.ts uses) scored IDENTICALLY with vs. without a declared battery
project text (a stronger test than re-running the existing unmodified test: proves zero effect, not just
"still passes"). PASS.

### FINDING 1 (new, not in any prior checkpoint) — SENSE-CONTEXT's protection is pool-size-sensitive;
one confirmed real "solid state" negative escapes demotion entirely below a certain pool size

Measured directly (`senseContextGate` called directly at 6 pool sizes, same real item, same context
text, only the surrounding pool changed):

| Pool size | 2 | 4 | 7 | 20 | 27 | 77 (B/C's own) |
|---|---|---|---|---|---|---|
| neg-vbs-1 `simContextStripped` | 0.152 | 0.154 | 0.075 | 0.032 | 0.039 | 0.025 |
| vs. floor 0.05 | PASS (undemoted) | PASS | PASS | FAIL (demoted) | FAIL | FAIL |

neg-vbs-2 and neg-vbs-3 (the other 2 fresh real negatives) scored `sim=0` at EVERY pool size —
robustly protected regardless of pool composition. Only neg-vbs-1 sits in a pool-size-dependent boundary
zone. Mechanism: TF-IDF's IDF weighting is corpus-relative (confirmed by reading `tfidf.ts`'s
`buildIdf`) — the SAME paper's cosine similarity to the SAME context text shifts with what else is in
the scoring pool. This is the SAME property C's own checkpoint already flagged in miniature for the
REQUIRED-GATE-FLOOR-TEST boundary fixture ("pool-composition sensitivity inherent to TF-IDF... not a
defect"), but this is the first direct evidence it also applies to the CORE demotion mechanism's
real-negative-rejection guarantee itself, not just to one auxiliary test's fixture choice.

**Why this matters:** B/C's headline numbers ("45/48 rejected," "all 3 escapees resolved... 48/48
rejected," "escape clause does not trigger at 0.05") were all measured against B's specific ~78-98 item
fetched pools. This finding shows that guarantee is scale-dependent, not universal: the SAME real
wrong-domain paper that reliably demotes in a ~80-item pool reliably does NOT in pools below ~15-20
items. C's own phase-3 live check independently reported "today's real pool for this exact query
happens to have only 6 non-demoted 'solid state' matches" — i.e., real production pools are not always
large. Whether the FETCHED-CANDIDATE pool size (the actual `buildIndex(items)` input, before gating —
not the post-gate displayed count) typically lands above or below the ~15-20-item danger zone in
production is answered partially by the live check in §4 below, but not fully resolved by this review.
This is a real, measured residual, not a hypothetical — reported as a finding, not folded into
"VERIFIED," since it means the mechanism's protection is probabilistic/pool-shape-dependent rather than
the closer-to-absolute guarantee the checkpoint's language implies.

### FINDING 2 — the LCO title-declared "(LCO)" residual can outrank a genuine match, not just trail as a filler

The known, previously-flagged residual (real OpenAlex item, "New materials as FCC active matrix
components for maximizing diesel (light cycle oil, LCO)...", `simContextStripped=0.0584`, just above
the 0.05 floor — flagged by both B and C as "a genuine, measured miss, not a bug") was tested in a small
mixed pool against 2 genuine LCO positives. Result: **NOT demoted** (keyword score 0.4667, full
strength) and ranked **#2 of 3**, ABOVE one of the two genuine positives (`genuine-lco-cathode-2`, score
0.19 vs. the residual's 0.465) and below the other (`genuine-lco-highenergy`, score 0.656). This is the
first direct confirmation of the manager's open tally item ("the LCO case remains unconfirmed") — and it
shows the residual is not merely a low-ranked filler (the "accepted cost" framing in the verdict
criteria) but CAN outrank a genuine context-passing paper, at least in a small pool. Given FINDING 1's
pool-size-sensitivity result, this specific ranking outcome should also be read as pool-shape-dependent,
not necessarily fixed — but unlike neg-vbs-1 (whose sim sat close to the floor and clearly crossed it
with scale), B/C already measured this LCO item's sim (0.0584) as "never near either threshold," so it
is less likely to be a pure pool-size artifact and more likely a stable miss for this specific paper.

### Test-authoring pitfalls found and fixed (both MINE, neither a SENSE-CONTEXT defect — recorded for
honesty, per the hard constraint against silently routing around a problem)

1. My first LCO scenario-(a) fixture reused the real title "Light Cycle Oil Upgrading to High Quality
   Fuels and Petrochemicals: A Review" — this trips `web/src/lib/scoring/review-policy.ts`'s
   `isReviewLike()` (matches `/\breview\b/i`), which then requires >=0.45 seed-text overlap
   (`shouldPushReviewPaper`) to be shown AT ALL — a pre-existing, SENSE-CONTEXT-independent filter
   unrelated to this item. The item was dropped from `scored` entirely regardless of demotion, which
   looked like a false test failure. Swapped for a different same-set real LCO negative with no
   review-pattern title (confirmed by reading `review-policy.ts` in full). Read as a note for the
   record, not a product bug — `review-policy.ts` is out of this review's scope and untouched by C.
2b. Real items loaded directly from B's saved JSON lack a `metadata` field (the scratchpad fetch scripts
   only saved title/abstract/tags/id/source/publishedAt) — `scoreItems`'s preference-ledger step
   (`conceptsFromRawItem`, unrelated to SENSE-CONTEXT) throws on `item.metadata.preferenceSignals` when
   `metadata` is undefined. Fixed by backfilling defaults through the SAME `item()` helper used
   elsewhere in the temp file. Not a SENSE-CONTEXT-path issue (`buildPreferenceDocumentFrequency` runs
   before `scoreKeyword` in `combine.ts`, confirmed by reading the file).



## 3. Mutations

All 5 required mutations performed on the live `keyword.ts`/`combine.ts` (no permission denial
encountered — every edit went through normally), each followed immediately by running the affected
test file(s), then an explicit Edit restoring the original text, then a SHA256 check against the
baseline hash recorded in §0. All 5 restores verified byte-identical to baseline.

| # | Mutation | Tests run | Result |
|---|---|---|---|
| 1 | `senseContextStripSet` returns empty Set (no stripping) | sense-context.test.ts, required-gate.test.ts | **2 tests failed** (required-gate.test.ts's clinical-electrolyte test; sense-context.test.ts test 7) — CAUGHT |
| 2 | `SENSE_CONTEXT_FLOOR` 0.05 -> 0.0 | sense-context.test.ts, required-gate.test.ts | **5 tests failed** (constants test; tests 5, 6, 7) — CAUGHT |
| 3 | `senseContextPenalty` hardcoded to `1` (AMENDMENT 2(ii) final-score penalty removed) | sense-context.test.ts, required-gate.test.ts, ranking.test.ts | **0 tests failed — ALL 39 PASSED. NOT CAUGHT.** See FINDING 3 below. |
| 4 | `senseContextText` includes `...profile.topics` again | ranking.test.ts, sense-context.test.ts, required-gate.test.ts | **1 test failed** (ranking.test.ts "does not mistake a name-drop for a subject" — reproduces the exact phase-2 regression AMENDMENT 2(i) fixed) — CAUGHT |
| 5 | T4's short/ambiguous gate call replaced with `if (false)` (T4 gate removed, T1-3 gate untouched) | sense-context.test.ts, required-gate.test.ts, ranking.test.ts | **1 test failed** (sense-context.test.ts test 7 only; tests 4/5/6 T1-path still passed) — CAUGHT, correctly isolated |

Restore verification after all 5 mutations (final):
```
d47c409fd36d2f57d8e071e025d2523bb983f2622058e34430f0b592b52bd348  web/src/lib/scoring/combine.ts
9942dc9840767385d391f18fb51bf6c7f2b0cc3f7cbd6221146752f8f52dbeec  web/src/lib/scoring/keyword.ts
```
Both match §0's baseline exactly. `git diff --stat` on both files also matches the original (63/207
lines), confirming no residual mutation artifact.

### FINDING 3 — the "realistic mixed pool" test does not actually verify AMENDMENT 2(ii)'s own mechanism

Mutation 3 is explicitly named in this review's own brief ("remove the fullyDemoted final-score penalty
-> the realistic-pool test must fail") and in C's own checkpoint ("Confirms the mechanism, not just the
outcome: this item really is fully demoted (no rescue path left)..."). With the mutation applied — the
SECOND, final-combined-score `senseContextPenalty` multiplication hardcoded to `1` regardless of
`kw.fullyDemoted` — sense-context.test.ts's test 11 third `it` (the realistic 5-item pool: the real
spin-chain fixture + 4 genuine solid-state-battery papers) **still passes**: the spin-chain item still
ranks last and still scores below all 4 genuine papers, with or without AMENDMENT 2(ii)'s own code.

Why: the item's KEYWORD sub-score is already demoted by a SEPARATE, earlier mechanism (keyword.ts's own
`SENSE_CONTEXT_DEMOTED_GROUNDING`, shipped in phase 2, unaffected by this mutation) — in this SPECIFIC
5-item fixture, that alone (combined with the item's older `publishedAt`/arxiv source weighting) is
already enough to sink it below all 4 genuine papers, so the SECOND penalty this test claims to guard
has no room left to matter. This is consistent with, and explains, why C's OWN live check (checkpoint's
"LIVE CHECK — phase 3") needed a real ~10-item pool to demonstrate the rescue effect at all (score
0.6849 -> 0.1937 only visible against a REAL pool) — the unit test's small, hand-built pool does not
reproduce the conditions (a competitive real pool where keyword-level demotion alone is NOT sufficient)
that made AMENDMENT 2(ii) necessary in the first place.

**Assessment:** this is a test-coverage gap, not evidence the shipped mechanism is inert — the code
change is real (confirmed present in the diff, confirmed exercised in check 4's live requests below) and
C's own live evidence (0.6849 -> 0.1937) independently shows it has a real, substantial effect in a real
pool. What is specifically wrong is the checkpoint's claim that the unit test "confirms the mechanism" —
it does not; it would pass identically whether that mechanism exists or not. Reported as a ranked finding
(test-adequacy gap on the review's own required mutation), not folded silently into "gates green."


Temp scenario file deleted and confirmed gone from `git status --short` (checked immediately after
extracting evidence, before proceeding to gates).

## 4. Live, signed-out (4 of 4 budgeted requests used, all HTTP 200)

Saved: `out/A-live1-solidstate.json`, `out/A-live2-electrolyte.json`, `out/A-live3-longtag.json`,
`out/A-live4-lco.json` (scratchpad). Server was already running (verified with a plain GET to `/`, not
counted against the 4-request budget); never started/stopped/restarted.

### LIVE 1 — `{"topics":["solid state"],"project":"<battery sentence>","aiTier":0}`

Pool: 124 fetched, 121 after dedup (openalex 36, semantic_scholar 34, arxiv 34, pubmed 20, dblp 0/error).
10 returned.

| # | Title | kw | On-topic? | matchedKeywords honest? |
|---|---|---|---|---|
| 1-4,6-7 | (6 genuine solid-state-battery papers) | 0.6667 | YES | YES |
| 5 | Molecular-Dynamics-Predicted Ionic Conductivity...Solid Electrolytes | 0.2667 | YES | YES |
| 8 | NASICON fast ionic conductors self-driving lab | 0.2667 | YES | YES |
| **9** | **Measurement-Only Dynamical Phase Transitions in Spin-1 Chains** (arxiv:2609.26941) | **0.1667 (demoted)** | **NO — quantum-physics paper** | YES (genuinely contains "valence-bond-solid state") |
| **10** | **Defect-Induced Melting and Solid-State Amorphization** | **0.1667 (demoted)** | **NO — general condensed-matter melting theory, not battery-domain** | YES (genuinely contains "solid-state amorphization") |

Both wrong-domain items are fully-demoted (kw exactly at the demoted ceiling), ranked LAST (9th, 10th of
10), scoring 0.1764/0.1580 vs. the lowest genuine item's 0.6005 — a large, clean separation. **No genuine
context-passing paper ranks below either of them.** Neither `matchedKeywords` entry is false — both
papers genuinely contain the literal phrase "solid state" (§1ao.8's "never state a false match" holds;
SENSE-CONTEXT correctly does not touch whether the phrase is textually present, only its grounding
weight).

**Tally:** 2 distinct wrong-domain, fully-demoted papers confirmed in this one live top-10 — item 9
re-confirms the SAME real paper the manager's log already recorded as "tally #1 confirmed" (independently
re-observed in a FRESH live fetch, a different real candidate pool than C's own phase-3 run); item 10 is
a NEW, previously unrecorded wrong-domain instance for the "solid state" tag. Under a strict paper-count
reading of the §1ap AMENDMENT's stated threshold ("at 2 confirmed..."), this single live check already
provides 2 confirmed instances; under a per-TAG/scenario reading (tally #1 = "solid state," a separate
count for "LCO"), this remains within the "solid state" scenario and does not by itself confirm the "LCO
case." Reporting the raw fact for the manager's own bookkeeping/interpretation, not deciding it myself.

### LIVE 2 — `{"topics":["electrolyte"],"project":"<same>","aiTier":0}`

Pool: same 121-item pool. 9 returned, **all `matchedKeywords=["electrolyte"]`, all genuine battery/
solid-electrolyte papers by title — 0 wrong-domain.** Clean.

Side observation (confirmed NOT a SENSE-CONTEXT effect, noted for completeness, not chased further —
out of this review's scope): items 7-9 have `scoreBreakdown.combined: 0` despite positive
keyword/topicality/recency/source sub-scores (e.g. item 7: kw=0.4667 undemoted, topicality=0.875,
recency=0.571, source=1, yet combined=0). Confirmed unrelated to this item: kw is UNDEMOTED
(0.4667 = full grounding), so `kw.fullyDemoted` must be false and `senseContextPenalty=1` — the zero
must come from a different, pre-existing multiplier (`policyPenalty`/`legacyPenalty`/`preference.penalty`)
not touched by this diff. Not investigated further (out of scope for a SENSE-CONTEXT review); flagged for
the manager's awareness only.

### LIVE 3 — `{"topics":["solid-state battery electrolyte"],"aiTier":0}` (long tag, exempt, no project)

Pool: 96 items (different fetch — no project text changes the query). 7 returned, **all
`matchedKeywords=[]` (T4-only, correctly no false keyword claim per §1ao.8), all genuine on-topic
battery/electrolyte papers by title — 0 wrong-domain.** Matches prior A's/C's own repeated finding for
this exempt long tag. Clean.

### LIVE 4 — `{"topics":["LCO"],"project":"<same>","aiTier":0}`

Pool: 121 items (same as LIVE 1's fetch). **0 items returned.** `searchBrief.timeWindow: "week"` — a
1-week freshness window. B's own investigation already established LCO needs a much longer window (730
days) to find real candidates at all, since it called LCO papers "evergreen not news-driven" (§3.1 of
B's guide) — consistent with this being a genuine data-availability gap for a narrow, less-common tag
combined with a short freshness window, not a SENSE-CONTEXT rejection artifact. Cannot be fully confirmed
without deeper pipeline instrumentation (outside this review's scope/budget) but nothing here points to
the gate wrongly zeroing out real candidates — §1c's "do not pad with invalid fallback content" makes an
honest empty result the correct behaviour when nothing genuinely qualifies. Not evaluable for the
on-topic/matchedKeywords/tally checks (no items to check); does not add live evidence either way to the
open "LCO case" tally item.

## 5. Gates

- `npx vitest run` (from `web/`): **281 files (278 passed + 3 skipped), 5069 tests (5063 passed + 6
  skipped), 0 failed.** Matches the expected gate exactly.
- `npx tsc --noEmit`: **0 errors.**
- `npx eslint .`: **0 errors, 151 warnings** — confirmed via grep that none of the 151 warnings are in
  the change-list files.
- `npm run build`: **OK** — compiled successfully, all routes generated (including `/api/feed`).

No BLOCKED gates this round — every command and edit went through without a permission denial (contrary
to the brief's warning about earlier reviewers hitting "Modify Shared Resources" denials; none
encountered here, noted honestly either way).

## 6. Scope

Final `git status --short`:
```
 M ABC-JEV-INTEGRATION.md
 M web/src/lib/opportunities/pool-cache.test.ts
 M web/src/lib/opportunities/pool-cache.ts
 M web/src/lib/scoring/combine.ts
 M web/src/lib/scoring/keyword.ts
 M web/src/lib/scoring/required-gate.test.ts
?? docs/jev-abc/RELEASE-READINESS-A-20260928T201340Z.md
?? docs/jev-abc/SENSE-CONTEXT-A-20260928T195116Z.md
?? docs/jev-abc/SENSE-CONTEXT-B-20260928T173815Z.md
?? docs/jev-abc/SENSE-CONTEXT-C-20260928T180135Z.md
?? node_modules/
?? web/src/lib/scoring/sense-context.test.ts
```
Only the change-list files differ (all 6 hashes re-verified byte-identical to the section-0 baseline
after every mutation restore); the manager's state file and the SENSE-CONTEXT B/C docs are pre-existing,
not written by me; my own checkpoint is new, as instructed; the temp scenario file is confirmed deleted.
One file not mine or touched by me appeared during this session:
`docs/jev-abc/RELEASE-READINESS-A-20260928T201340Z.md` (timestamp after this review started) — almost
certainly a concurrent session/agent's own checkpoint for a different item running in parallel in the
same worktree; never opened or read, noted only so it isn't mistaken for something this review produced.
`node_modules/` untracked is pre-existing, not mine.

## VERDICT: FAILED_REVIEW

Most of the surface is solid: `ranking.test.ts` passes completely unmodified, scenarios (b)/(c)/(d)/(e)
all hold cleanly on independent real/constructed fixtures, no false `matchedKeywords` anywhere (live or
scenario), no genuine context-passing paper ever ranked below a fully-demoted filler, all 4 gates pass
with zero BLOCKED steps, and scope is clean. C's engineering (the refactor, the disjointness from
senses.ts, the T2/T4 composition, the cache bump, the honest test 7/12 substitutions) is careful and
mostly correct on direct inspection. But two concrete, measured gaps — both squarely inside what this
review's own brief asked to verify — keep this from VERIFIED:

**Ranked findings:**

1. **(Highest severity) FINDING 1 — the demotion mechanism does not reliably fire below a certain pool
   size; a real "solid state" wrong-domain paper is admitted at FULL, undemoted strength (not merely a
   ranked filler) in pools smaller than about 15-20 items, only demoting once the pool reaches roughly
   the scale B/C actually measured (about 80 items).** Directly measured on the SAME real paper across 6
   pool sizes (section 2's scenario (a) plus DIAGNOSTIC 2): similarity crosses the 0.05 floor somewhere
   between 7 items (0.075, still admits) and 20 items (0.032, demotes). This means the checkpoint's own
   headline claims ("48/48 rejected," "escape clause does not trigger at 0.05," "the tier that remains
   at max score is 100% genuine positives") are true only at the pool scale they were measured at, not
   universally — a caveat never stated anywhere in section 1ap or the C checkpoint. Today's live "solid
   state" pool (121 items, section 4) happened to be comfortably above the danger zone, so this did not
   surface in this round's live check — but nothing in the shipped design guarantees a real pool stays
   that large (a narrower or rarer tag, a quiet week, or a source outage easily produces a much smaller
   pool; LIVE 4 in section 4 shows a real query in this SAME session returning 0 candidates). This is
   exactly the failure mode the feature exists to close, reappearing conditionally instead of being
   eliminated. Not something I fixed or routed around — reported for the manager to rule on (e.g., a
   pool-size floor below which SENSE-CONTEXT falls back to a stricter default, or explicit acceptance of
   this as a further known residual).
2. **FINDING 3 — the unit test written specifically to regress-guard AMENDMENT 2(ii) (the FINAL-score
   penalty for a fully-demoted item) does not actually detect that mechanism's removal.** Mutation 3
   (section 3, explicitly requested by this review's own brief: "remove the fullyDemoted final-score
   penalty -> the realistic-pool test must fail") hard-coded the penalty to always be 1 and re-ran the
   full affected suite: **all 39 tests still passed**, including the specific test whose own comment
   claims it "Confirms the mechanism, not just the outcome." The keyword-level demotion (a separate,
   earlier mechanism) already sinks the fixture's spin-chain item below its 4 genuine papers in that
   small hand-built pool, leaving no room for the second penalty to matter there — which is also why the
   gap was invisible to C during implementation. The underlying code change is real and DOES have a
   measured, substantial live effect (C's own live check: score 0.6849 down to 0.1937 for the same real
   paper) — so this is a test-coverage gap, not proof the mechanism is inert — but it means AMENDMENT
   2(ii) currently ships without a test that would catch a future regression removing it.
3. **FINDING 2 — the previously-flagged LCO title-declared "(LCO)" residual is now confirmed, by direct
   measurement, to be able to outrank a genuine context-passing match, not merely trail as a low-ranked
   filler.** In a 3-item mixed pool it scored 0.465 (undemoted, full grounding) and ranked #2 of 3, above
   a genuine LCO positive scoring 0.19. This directly answers the manager's own open tally note ("the LCO
   case remains unconfirmed") with a concrete first data point — B/C's own measurement already showed
   this specific item's similarity (0.0584) sits well clear of the floor either way, so (unlike Finding
   1) this looks like a stable miss for this one paper rather than a pool-size artifact, but it was never
   before shown ranking ABOVE a genuine match specifically.
4. **Tally data for the manager's section 1ap AMENDMENT threshold (2 confirmed leads to B designing
   DROP/no-pad):** LIVE 1 (section 4) independently reproduced the previously-recorded "solid state"
   wrong-domain instance (arxiv:2609.26941, same real paper) AND found a second, new wrong-domain paper
   in the SAME live top-10 ("Defect-Induced Melting and Solid-State Amorphization") — both fully-demoted,
   both ranked strictly last, below every genuine match (the accepted-cost shape, not disqualifying by
   itself). Raw fact reported for the manager's own tally bookkeeping (paper-count vs. per-tag-scenario
   reading is the manager's call, not mine).
5. **Minor, not product bugs:** two test-authoring pitfalls I hit and fixed while building my own
   scenario file (`review-policy.ts`'s unrelated `isReviewLike` filter tripped by a title containing the
   word "Review"; real scratchpad JSON fixtures needing a `metadata` field backfill) — recorded in
   section 2 for honesty, not findings against C's diff. A pre-existing `scoreBreakdown.combined: 0`
   anomaly on 3 items in the LIVE 2 (electrolyte) response, confirmed unrelated to the SENSE-CONTEXT
   penalty (those items were undemoted) and not investigated further — flagged for awareness, out of this
   review's scope.

**What already holds, restated plainly:** the rulings' TEXT is faithfully implemented (Option C tag
test, stripping, floor, demote-not-drop, T4 gate, AMENDMENT 2(i)/(ii), cache bump, disjointness from
senses.ts) — 4 of 5 required mutations behaved exactly as predicted, every scenario except the pool-size
edge of (a) held on independent real data, and the live evidence shows the mechanism visibly working
(large score reductions, correct ranking, honest keyword claims) in today's actual pools. The two
findings above are about the LIMITS of that protection under conditions (small pools; a specific
minimal-pool unit test) nobody had previously measured or disclosed — exactly the kind of gap this
review exists to surface, not a claim that Phase 3 did nothing.

