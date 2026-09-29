# SENSE-CONTEXT-EVIDENCE — Review A2 (second independent review)

STATUS: VERIFIED (first round FAILED_REVIEW → fix round §1bg.13 → RE-CHECK VERIFIED; see the "RE-CHECK" section at the end for the final verdict)

Reviewer: A2 (independent reviewer, this session). Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD 90db90fe, working tree uncommitted diff under review.

This file is written incrementally — updated after each check completes — so it stands on its own if the reviewer is cut off.

## 0. Reading done

- ABC-JEV-INTEGRATION.md §1bg (points 1-12, lines 246-270) — read.
- §1be (lines 289-314), §1bd (lines 315-324) — read.
- §1ax (lines 384-395), §1ap + amendments (lines 473-517) — read for history.
- Guide, first review (A), implementer checkpoint (C) — reading next.
- `git diff HEAD -- web/` — reading next.

## 1. Ruling compliance (§1bg point by point)

Verified by reading the current source (not just the diff) and, where noted,
by execution:

1. **Fold at all 4 call sites, shipped together with cut+skip rule** —
   CONFIRMED: `tokenizeFolded` (not `tokenize`) used in `senseContextStripSet`
   (2 sites) and `senseContextGate` (2 sites); the import itself was swapped
   (`import { tokenizeFolded } from "./tokenize"`).
2. **Doc-frequency cut on the OVERLAP axis only, computed at module load,
   pinned by a test.** CONFIRMED: `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT`
   is an IIFE sorting `Object.values(REFERENCE_IDF_TABLE)` and indexing
   `floor(P/100*n)` — not hard-coded. `fixedSim`/`toReferenceVector` calls are
   byte-identical to before this item (no diff lines touch them). Unseen
   tokens keep the table's max weight (`referenceIdfWeight`'s fallback is
   unchanged, pre-existing code). Test 19 pins percentile 10 / weight ≈5.742
   — re-derived independently (own probe): confirmed 5.742 exactly.
3. **Percentile is 10, pinned — no stale p25/6.784 presented as current.**
   MOSTLY CONFIRMED, ONE EXCEPTION FOUND: every doc comment in `keyword.ts`,
   `tokenize.ts`, `combine.ts`, and every test comment in
   `sense-context.test.ts` correctly states P=10/5.742 as current (p25/6.784
   only appears in explicitly historical/narrative framing — "narrowed from
   the original P=25", "the cut has SINCE narrowed to P=10" — never presented
   as the shipped value). **`pool-cache.ts` line 328 is the one exception: it
   states, in the present tense describing the CURRENT v18 bump, "...drops...
   every token whose shipped-reference-table weight sits below the table's
   own 25th-percentile weight" — this is FACTUALLY WRONG for the shipped
   code, which uses the 10th percentile.** This file was written in round 1
   (P=25) and never touched again in the STOP round or the ship round (per
   the implementer's own "Final changed-file list": "only keyword.ts and
   sense-context.test.ts changed this round"). MEDIUM-severity doc-only bug —
   no runtime effect (pool-cache.ts's cache-version comment has no behavior),
   but it directly contradicts a ruling requirement this review was
   specifically asked to check for, and would mislead a future reader of the
   cache-version history into thinking p25 is what shipped.
4. **Floors unchanged (0.015 / 0.10 / 0.10).** CONFIRMED by diff inspection:
   zero `+`/`-` lines touch `SENSE_CONTEXT_FIXED_FLOOR`,
   `SENSE_CONTEXT_OVERLAP_FLOOR`, or `SENSE_CONTEXT_FIXED_RESCUE`.
5. **GENERIC_TERMS unchanged.** CONFIRMED: zero `+`/`-` diff lines touch it in
   `term-expand.ts` (the file's only changes are the `termVariantMatches`
   extraction and the new "ions" doc line/test).
6. **Cache 17 → 18.** CONFIRMED (`pool-cache.ts`), via the single exported
   prefix; `pool-cache.test.ts` updated to assert "not v17" with the correct
   history chain (module the p25-vs-p10 comment bug above lives in the same
   edit).
7. **Skip rule's placement in `scoreKeyword` and rule (c) precedence.**
   CONFIRMED by reading: rule (c) (`selfDeclaresDifferentSense(...).differs`)
   still runs FIRST and unconditionally `continue`s (line before the gate);
   the skip rule is one added `&& !matchesFullNameOrFormula(item, topic)`
   clause on the existing `isShortOrAmbiguous` branch, structurally unable to
   run before rule (c). `combine.ts`'s T4 loop is untouched (only a comment),
   and is structurally unreachable by a literal match by construction
   (`kw.score === 0` guard) — independently reconfirmed.
8. **The `termMatches`/`termVariantMatches` refactor is unchanged since the
   first review, and still behaviourally identical to HEAD.** CONFIRMED two
   ways: (a) `term-expand.ts` was not touched in the STOP or ship rounds (the
   implementer's own file lists for those rounds list only `keyword.ts` /
   `sense-context.test.ts`); (b) independently re-ran an equivalence check
   (own probe, not a reuse of the first review's deleted files): 5,760
   `termMatches(HEAD)` vs `termMatches(working)` comparisons over every real
   item in every saved pool/negative file × 12 tags (including tricky
   plural/hyphen/formula/abbreviation cases) — **0 differences.**

## 5. Tests

Verified by reading `sense-context.test.ts`'s diff in full and by execution
(mutations in §6): the p10 pin (test 19); the new real-paper protective tests
(test 23: W7172267740 full; W7204716846 and arxiv:2608.14351 demoted); the
accepted-cost tripwire for arxiv:2609.08721 (test 23, 4th case, comment names
§1bg.12b); the replaced rescue-isolation fixture (arxiv:2604.26545) truly
isolates the rescue path at p10 — proven by a TARGETED mutation the task
specifically asked for (remove the `fixedSim >= SENSE_CONTEXT_FIXED_RESCUE`
clause from the `pass` formula): **exactly 1 test goes red** (this fixture),
nothing else — clean isolation, confirmed; the exact-token strip-set property
(test 17's "state-dependent" fixture) — mutation (substring matching instead
of `Set.has`) turns exactly this 1 test red, confirmed. Every pre-existing
assertion change (test 15's overlap-floor flip and its arxiv:2604.26545
fixture swap; test 17's "state-of-the-art"→"state-dependent" swap) carries an
explicit `§1bg` comment naming the reason. No pre-existing test lost its
protected property (both of the two most load-bearing rewrites were
independently mutation-re-verified above, not just read).

## 7. Gates

All 4 run from `web/`, one at a time, AFTER every mutation was restored and
hash-verified back to the reviewed state:

| Gate | Implementer's claim | A2 independent re-run | Match? |
|---|---|---|---|
| `npx vitest run` | 288 files (285+3 skipped) / 5290 passed + 6 skipped / 0 failed | 285 passed + 3 skipped (288 files) / 5290 passed + 6 skipped | YES, exact |
| `npx tsc --noEmit` | 0 errors | 0 errors (no output) | YES |
| `npx eslint .` | 0 errors / 151 warnings | 0 errors / 151 warnings | YES, exact |
| `npm run build` | OK, all routes compiled | OK, exit 0, all routes compiled | YES |

Baseline at HEAD (288 files (285+3 skipped) / 5267 passed + 6 skipped / 0
failed; tsc 0; eslint 0/151; build OK) was not independently re-run at HEAD
by A2 (would require stashing the whole diff) — accepted from the
implementer's and the first review's own independently-matching reports,
which is standard practice in this lineage; the delta (5267→5290 = +23 tests:
+19 round 1, +4 test-23 in the ship round) is internally consistent with the
diff read.

## 8. Accepted/deferred items re-listed

- `arxiv:2609.08721` demoted, accepted cost, threshold named in §1bg.12b —
  present as a named tripwire test (test 23) and in `keyword.ts`'s doc
  comment. **Incomplete: a second, unnamed, unaccepted genuine/borderline
  loss (`openalex:W7203865202`) exists alongside it — see §2/Findings.**
- `SENSE_CONTEXT_OVERLAP_FLOOR` not re-swept — confirmed true (0.10 unchanged,
  no re-derivation in the diff); tracked in B's guide POLICY 4 and §1bg
  point 5's text (not restated in code, which is expected — a process item).
- `QUERY-GENERIC-WORDS` — confirmed tracked, ABC-JEV-INTEGRATION.md §1bg
  point 9 and the state file's NOW/queue line.
- The Li2C2O4 paper (`openalex:W7214055235`) at full strength via the rescue
  floor — confirmed unaffected before/after by independent execution (§2);
  documented in the skip-rule's doc comment and test 20's comments.
- The "-sis" gap — confirmed still present, unchanged, in `term-expand.ts`'s
  singularize doc comment (line 168-169: "hypotheses/syntheses... stay the
  deferred '-sis' follow-up").
- `PLURALS-GLOBAL`, `EXCLUSION-PLURALS` — confirmed tracked in
  ABC-JEV-INTEGRATION.md's queue line (both low-priority, both from earlier
  TOKENIZE-PLURALS/§1bd rulings, neither touched by this item, correctly).

## 9. Privacy

Scanned the 8 diff files plus all 4 SENSE-CONTEXT-EVIDENCE docs (A, B, C, and
this A2 report) for: email-address-shaped strings, a Windows user-profile
absolute-path pattern, the account holder's name as a plain word pair, and
university/NetID-shaped strings. **0 real hits in every category.** One
incidental match on the bare word describing a search category (not a value)
inside the first review's own privacy-check paragraph — read in context and
confirmed not a leak. Every scratchpad reference in all 4 docs correctly uses
the `<scratchpad>/...` shorthand, never the literal absolute path.

## 2. Full set diff (real functions)

Methodology: BEFORE = HEAD via mechanical `git show HEAD:` copies of the 4 scoring
files (`__a2_probe_head_{term_expand,tokenize,keyword,combine}.ts`, imports
redirected to each other, everything else pointed at the real, unchanged current
files). AFTER = working tree. Reference instant 2026-09-28T16:05:42Z, window
"week". Data from `<scratchpad>/out/raw-P4.json` (electrolyte, 150),
`out/raw-P2.json` (solid state source pool, 100), `out/tagged-LCO.json` (LCO, 50),
the 3 `sc-neg-*.json` negative files (50 each), `<scratchpad>/prod-lco-resp-3.json`
(live LCO response) — all passed via env var `A2_SCRATCHPAD_DIR`, never written
into a repo file.

Denominators reproduced exactly: electrolyte in-window 145 / literal-match 89;
solid state in-window 62 / literal-match 25; LCO in-window 3 / literal-match 3.
Matches the implementer's own cited 145/62/3 and 89/25/3 exactly.

**Methodology finding (found by building this probe, reported honestly):** the
naive "ceiling = a scoreItems(..., {topics:[tag]}) bypass run with no seedTexts"
technique (used by sense-context.test.ts's own existing fixtures AND by my first
draft of this probe) is NOT safe for computing a full-strength ceiling on
uncurated real text, because `combine.ts`'s final `.filter(item =>
shouldPushReviewPaper(item, profile.seedTexts))` — a pre-existing, unrelated
review-suppression rule in `review-policy.ts`, not part of this diff — reads the
SAME `profile.seedTexts` field for a different purpose, and can silently drop a
review-flagged item from a bypass run's output while keeping it in the
declared-context run. Confirmed by execution:
`openalex:W7214055235`'s abstract ends "...provides a crystal-interface
PERSPECTIVE for Li2C2O4 decomposition...", tripping `REVIEW_PATTERNS`'
`/\bperspective\b/i`. Fixed by classifying every T1/T2/T3 literal-hit item via
`scoreKeyword()` DIRECTLY (before/after, plus a `contextText:""` bypass for the
ceiling) — the exact function the fold/cut/skip-rule live inside, with no
combine.ts pass-2 filtering at all. Only genuine T4-only items (no literal match
under either module) need `scoreItems`, cross-checked against `isReviewLike`.

**HIGH FINDING — the implementer's own STOP-round/ship-round sweep tooling has
the SAME review-policy confound, in its CEILING computation, and its diff script
silently SKIPS any id whose ceiling is missing rather than flagging it.**
Verified by reading `<scratchpad>/analyze_sweep.mjs` (the implementer's own
saved analysis script) and `<scratchpad>/sweep_baseline.json`: `diffCell()`
does `const ceil = ceiling[id]; if (ceil === undefined) continue;` — silently
dropping the id from BOTH gains and losses. `sweep_baseline.json`'s `ceiling`
maps have gaps: `literalSubset:electrolyte` has only 81 of 88 literalKeyword ids
(7 missing), `literalSubset:solid state` has only 22 of 25 (3 missing), LCO has
0 missing. **All 10 missing ids are `isReviewLike(item) === true`** (confirmed
by direct execution) — the exact same confound. Re-classified all 10 independently
via the clean `scoreKeyword`-direct method:
- 9 of 10 are full-strength both before AND after (their omission from the
  implementer's table did not change the correctness of "0 losses" for those 9,
  but the underlying tooling gap is real and could have masked a real change).
- **1 of 10 is a genuine, UNREPORTED loss: `openalex:W7203865202`** ("Recent
  Advances and Future Perspectives of Proton-Conducting Electrolytes for
  Reversible Solid Oxide Cells" — a review article, real OpenAlex record, tag
  "electrolyte"). Direct `senseContextGate` values: BEFORE `fixedSim=0.0989,
  overlapSim=0.2273, pass=true` (AND path) → full strength (keyword 0.4667).
  AFTER (p10) `fixedSim=0.0942, overlapSim=0.0769, pass=false` (below both the
  overlap floor 0.10 and the rescue floor 0.10) → demoted (keyword 0.1167,
  exactly ×0.25). **This item is NOT named anywhere in §1bg.12/12b, not in the
  implementer's sweep table, not in its ship-round protective tests.**
  Cross-checked its status across the FULL swept range from the implementer's
  own saved `sweep_p{5,8,10,12,15,20,25}.json` literalKeyword values (the raw
  per-item numbers, which do NOT have the ceiling-map gap — only the
  human-facing diff table built on top of them does): **full at p5, demoted at
  p8/p10/p12/p15, full again at p20/p25 — a second, independent non-monotone
  swing** (alongside arxiv:2609.08721's already-documented one). This directly
  contradicts the manager's own characterization "p5–p12 tie on losses" (§1bg.12,
  transcribed: "p5–p12 tie on losses... and promote no wrong-field paper") — p5
  does NOT share this loss while p8/p10/p12 DO, so the band was not actually
  tied on this dimension; the selection of p10 "nearest the middle of the tying
  band" rests on a table that undercounted this by one real item at 4 of the 7
  swept points.
- Arithmetic cross-check: implementer's own ship-round step 3 independently
  (via a DIFFERENT, direct `senseContextGate`-call technique, not the buggy
  `diffCell` sweep script) computed literal-subset electrolyte full-strength
  count as **58/89** — this EXACTLY MATCHES my own independent count (54
  baseline + 7 gains − 3 losses = 58) and is INCONSISTENT with "only 2 losses"
  (54+7−2 = 59 ≠ 58). The correct arithmetic was sitting in the implementer's
  own confirmation step and was never cross-checked against the named-loss list.

**Full labeled set diff, electrolyte, harness (a) literal-match subset (=
harness (b) all-in-window: identical, since every mover is a T1 literal hit,
never excluded — matches the implementer's own documented pattern):**

LOSSES (full→demoted), n=3, not 2:
| id | title | verdict |
|---|---|---|
| openalex:W7213888420 | Plasma Electrolytic Polishing of TC4 Alloys... | wrong-field (correct demotion) — matches implementer's label |
| arxiv:2609.08721 | Competing Ring-Opening and Hofmann Elimination Pathways in Aqueous TEMPO Catholytes | genuine, adjacent chemistry — accepted cost, named in §1bg.12b — matches implementer's label |
| **openalex:W7203865202** | **Recent Advances and Future Perspectives of Proton-Conducting Electrolytes for Reversible Solid Oxide Cells** | **genuine/borderline-adjacent (a fuel-cell/electrolyzer device class, not a battery — same "adjacent, not core" character as the accepted arxiv:2609.08721 cost) — NOT reported, NOT named, NOT accepted by any ruling** |

GAINS (demoted→full), n=7, matches implementer's count exactly:
| id | title |
|---|---|
| openalex:W7202367926 | Anti-freezing cyclodextrin-modified cellulose eutectic hydrogel electrolytes... |
| openalex:W7202147667 | Succinic anhydride as a bifunctional electrolyte additive... |
| openalex:W7203493877 | Carbon quantum dot-induced electrolyte structuring... (OpenAlex copy) |
| pubmed:42612502 | Carbon quantum dot-induced electrolyte structuring... (PubMed copy, same paper) |
| arxiv:2609.28768 | A kinetic model of electron transfer at the electrode-electrolyte interface |
| arxiv:2609.28369 | Simulation of a Battery Cell on Quantum Computers: Reactions & Transport |
| arxiv:2609.26685 | Disentangling Surface Charge and Electrolyte Effects on Interfacial Water at Electrified Pt(111) |

Solid state: 0 losses either harness (25/25 both before and after in the
literal subset; matches). Harness (b) all-in-window: 1 gain, T4-admitted,
`openalex:W7214086461` ("Volatilization of Na2O and Its Impact on the
Processing of Solid Electrolytes") — matches the implementer's own STOP-round
sweep note ("newly included via T4... at every percentile").

LCO: 0 losses either harness. 1 gain both harnesses:
`openalex:W7204043657` ("Activated carbon-assisted mechanochemical
pretreatment... recycling of spent lithium cobalt oxide cathodes") — matches
the implementer's own STOP-round sweep note.

150 negatives: 0 admitted (full strength) before AND after — CONFIRMED by
execution (own probe, scoreKeyword-direct, all 150 individually).

Both R3 residuals (Thorium phonomagnetometer, Eu quantum-storage): demoted
before AND after — CONFIRMED by execution.

Live LCO (3 named items, seedTexts reconstructed from
`prod-lco-resp-3.json`'s own `meta.searchBrief` via `briefToSeedTexts`'s real
composition): `openalex:W7213893763` demoted before → full after (target
defect fixed) — CONFIRMED. `arxiv:2608.18563` (cuprate) demoted both —
CONFIRMED. `openalex:W7214055235` (Li2C2O4) full strength both (unaffected) —
CONFIRMED.

STATUS so far: the implementer's claim "electrolyte losses exactly
openalex:W7213888420 and arxiv:2609.08721; 0 wrong-field gains" is CONFIRMED
on the wrong-field-gains half (0 confirmed, matches) but REFUTED on the
"exactly" half — a third, genuine, unreported loss exists. See §Findings.

## 3. Precision labels

Every gained/lost item read (title + abstract/tags) and labeled for a PhD
reader in solid-state battery materials, using the tag in its battery sense.
The implementer's ship-round checkpoint never individually labeled the 7
gains at p10 specifically (it only itemized named papers for the OTHER swept
percentiles p15/p20/p25) — this fills that gap.

Electrolyte GAINS (7, all demoted→full):
1. W7202367926 (hydrogel electrolytes, zinc-ion batteries) — **genuine**
2. W7202147667 (succinic anhydride electrolyte additive, Li-ion batteries) — **genuine**
3. W7203493877 / pubmed:42612502 (carbon-quantum-dot electrolyte structuring, Zn batteries — same paper, 2 source copies) — **genuine**
4. arxiv:2609.28768 (kinetic model of electron transfer at electrode-electrolyte interface) — **genuine** (interfacial electrochemistry theory, on-topic)
5. arxiv:2609.28369 (battery-cell simulation on quantum computers) — **genuine**
6. arxiv:2609.26685 (surface charge / electrolyte effects on interfacial water at Pt(111)) — **borderline** (fundamental interfacial electrochemistry/electrocatalysis, not explicitly battery-framed — same tier as the implementer's own borderline calls at other percentiles)

0 of 7 wrong-field — CONFIRMS the implementer's "0 wrong-field gains" claim for
p10 (now individually verified, not just counted).

Electrolyte LOSSES (3, not 2):
1. W7213888420 (plasma electrolytic polishing of alloys) — **wrong-field**, correct demotion. Matches implementer's label.
2. arxiv:2609.08721 (TEMPO catholytes, aqueous redox-flow batteries) — **genuine, adjacent** chemistry. Matches implementer's label (named accepted cost, §1bg.12b).
3. **openalex:W7203865202 (proton-conducting electrolytes for reversible solid oxide cells, a review article)** — **genuine/borderline-adjacent**: real electrolyte-materials review, but for a fuel-cell/electrolyzer device class (protons, 400-600°C ceramics), not the reader's lithium/sodium-ion battery focus — the same "adjacent, not core" character the ruling itself used to accept arxiv:2609.08721. **Disagreement with the implementer: this item was never labeled, named, or reported at all** (see §2's HIGH finding on the ceiling-map bug).

Solid state gain (T4, harness b): W7214086461 (NaSICON solid electrolyte
processing) — **genuine**. Matches implementer's own STOP-round label.

LCO gain: W7204043657 (LCO cathode recycling) — **genuine**. Matches
implementer's own STOP-round label.

**Disagreements with the implementer's labels: one — the missing
openalex:W7203865202 loss (§2).** Every other label matches.

## 4. The implementer's two corrections of the first review

Both verified by independent execution (own probe, `__a2_probe_debug4.test.ts`,
deleted after use):

**(i) Solid-electrolyte ion-transport paper (openalex:W7204909059 /
W7204866765) was never T4-admitted at HEAD.** Computed T4's own anchored
floors directly (`scoreTfidf` against a `tokenizeFolded` index built from the
real 62-item in-window solid-state pool, `pText` = `[...topics, ...seedTexts]`
exactly as `combine.ts`'s `profileText()` builds it): **simTopic = 0.024373,
simProject = 0.040760** — matches the implementer's cited 0.0244/0.0408 almost
exactly. Both below their floors (topic floor 0.15; project floor 0.05, and
the anchored OR-clause additionally requires simTopic > 0, which is true but
does not by itself clear the topic floor) → never admitted, confirmed via the
real `scoreItems` on the full in-window pool: absent from output BEFORE and
AFTER alike. **CONFIRMED.**

**(ii) pubmed:42603427 (biofilm bioenergetics) is never admitted at all — A's
original "wrong-field gain" claim is false.** No literal match (T1/2/3) on
"electrolyte" at all (`scoreKeyword` returns `matched: []`). Its ONLY possible
path is T4: `simTopic = 0` (zero similarity to the bare tag "electrolyte"
itself against the folded index), `simProject = 0.0746` (clears the 0.05
project floor on its own) — but the REQUIRED-GATE anchoring rule requires
`simTopic > 0` before `simProject` can help at all (§1ao.1's own reason for
anchoring: an unanchored `simProject` alone was exactly the earlier biofilm/
clinical false positive) — `simTopic = 0` fails that anchor, so T4 never
admits it regardless of `simProject`. Confirmed absent from the real
`scoreItems` output BEFORE and AFTER alike. **CONFIRMED.**

## 4. Implementer's two corrections of the first review

PENDING

## 5. Tests

PENDING

## 6. Mutations

All 5 done directly on the real product file (`web/src/lib/scoring/keyword.ts`),
one at a time, sha256 before and after every restore, CRLF re-verified
(one restore landed on LF via `sed -i` exactly as happened to the implementer
in their own ship round — caught by the hash check, fixed with `perl -pe
's/\r?\n/\r\n/'`, re-verified byte-identical). Baseline/restored hash every
time: `fa12abd5d0260327be7ce396e3b6488fb98abc5b0a550f3176cdb3e5a381b049`
(matches the implementer's own final ship-round hash exactly — confirms the
file was untouched between their last edit and this review).

1. **p10 → p25** (`SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE = 10` → `25`):
   6 tests red, including the ruled `openalex:W7172267740` protective test
   ("expected 0.1167 to be close to 0.4667"). Matches the implementer's claim
   exactly (their report: "6 OTHER tests also go red... the one the ruling
   named is confirmed among them"). PASS.
2. **Remove the cut** (drop the `referenceIdfWeight(token) >=
   SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT` clause from both overlap-axis
   filters): 3 tests red — the Thorium residual (test 17, exactly as every
   prior round in this lineage), plus 2 side effects (test 15's rescue-isolation
   fixture, test 23's arxiv:2609.08721 tripwire). Matches the implementer's
   claim exactly. PASS.
3. **Remove the skip rule** (drop `&& !matchesFullNameOrFormula(item, topic)`
   from `scoreKeyword`'s gate condition): exactly 1 test red — test 20's
   minimal full-name/formula-only isolating fixture; the real W7213893763
   fixture does NOT flip (independently reproduces the implementer's own
   "rescued twice" finding — its own statistical gate also independently
   clears the AND path). Matches exactly. PASS.
4. **Remove the fold** (all 4 `tokenizeFolded` call sites back to plain
   `tokenize`, import reverted): 2 tests red — test 18's constructed
   fold-isolating fixture, plus 1 side effect on test 15's rescue-isolation
   fixture. Matches exactly. PASS.
5. **Exact-token strip-set property** (own addition — mutate the strip-set
   filter from `!stripSet.has(token)` to a substring test,
   `![...stripSet].some(s => token.includes(s))`): exactly 1 test red —
   test 17's "state-dependent" protective fixture ("expected 0.333 to be
   greater than 0.333" — the with/without-shared-phrase pair collapsed to
   equal once substring-stripping over-matched). Independently reconfirms
   this property (first proven by the first review's own mutation on this
   same rewritten fixture) still holds unchanged since p10 shipped. PASS.

Every pre-existing assertion change (test 15's overlap-floor flip, test 17's
"state-of-the-art"→"state-dependent" fixture swap, the round-1→ship-round
second swap of test 15's companion fixture from arxiv:2606.31261 to
arxiv:2604.26545) carries an explicit `§1bg` comment citing the reason. No
pre-existing test lost its protected property — confirmed both by reading
and, for the two most load-bearing ones (rescue-path isolation, exact-token
strip-set), by independent mutation above.

## 7. Gates

PENDING

## 8. Accepted/deferred items re-listed

PENDING

## 9. Privacy scan

PENDING

## Findings

**HIGH — the implementer's set-diff report is incomplete: a third, genuine
loss at the shipped p10 cut was never named, measured against the ruling's
threshold, or listed, because the implementer's own analysis tooling silently
drops any item whose "ceiling" value is missing rather than flagging it.**
`openalex:W7203865202` ("Recent Advances and Future Perspectives of
Proton-Conducting Electrolytes for Reversible Solid Oxide Cells," a real,
genuine electrolyte-materials review, tag "electrolyte") goes from full
strength at HEAD (`fixedSim=0.0989, overlapSim=0.2273`, AND path) to demoted
at p10 (`fixedSim=0.0942, overlapSim=0.0769`, neither path clears) —
confirmed by direct execution on both BEFORE (HEAD) and AFTER (working tree)
modules. Root cause, found by reading the implementer's own saved
`<scratchpad>/analyze_sweep.mjs` and `sweep_baseline.json`: the ceiling
computation step has the identical review-policy confound this review's own
probe hit and fixed (`isReviewLike`/`shouldPushReviewPaper` reading the same
`seedTexts` field the bypass ceiling run leaves empty), leaving 10 ids (7
electrolyte, 3 solid state) out of the `ceiling` map entirely; `diffCell()`
then does `if (ceil === undefined) continue`, silently excluding those ids
from both gains and losses instead of erroring or flagging them. 9 of the 10
turn out unaffected (full both before and after) — but this one is not. This
directly violates §1bg point 6's binding text ("Every item that passes today
and is demoted after is LISTED with id, title and its shared words") and
falsifies the "exactly these 2 losses" claim this review was asked to check.
Confirmed the item reaches a real reader's feed (not separately filtered):
`shouldPushReviewPaper(item, [realProjectText])` returns `true`. Also found:
this item's own status is NON-MONOTONE across the swept range (full at p5,
demoted at p8/p10/p12/p15, full again at p20/p25 — read directly from the
implementer's own saved `sweep_p{5,8,10,12,15,20,25}.json`), which
contradicts the manager's own characterization in §1bg.12 ("p5–p12 tie on
losses") — p5 does not share this loss while p8/p10/p12 do, so the tying band
the manager chose p10 from was described on incomplete data. Whether this
specific item crosses §1bg.12b's re-open threshold ("one live genuine paper
in the reader's own CORE topic... demoted") is arguable either way — solid
oxide fuel-cell electrolytes are an adjacent device class, not the reader's
core lithium/sodium battery chemistry, the same character as the ALREADY
accepted arxiv:2609.08721 — but that is the manager's call to make, not mine,
and it cannot be made at all while the item stays unreported. Evidence:
`<scratchpad>/a2-setdiff-results.json`, `a2-missing-ceiling-items.json`,
`a2-correction1.json`/`a2-correction2.json` (this session's own probes, all
deleted from the repo before finishing; the scratchpad copies are working
data, not part of the reviewed diff).

**MEDIUM — one stale doc comment presents the OLD p25/25th-percentile cut as
the CURRENT shipped behavior.** `web/src/lib/opportunities/pool-cache.ts`
line 328 (the PAPER_CACHE_KEY_VERSION 17→18 history comment) says the context
check "drops... every token whose shipped-reference-table weight sits below
the table's own 25th-percentile weight" — the shipped value is the 10th
percentile (5.742), not the 25th (6.784). No runtime effect (comment only),
but this is squarely the failure mode CHECK 1 was written to catch ("no stale
p25/6.784 presented as current"), and it is presented in the present tense as
a description of the current v18 behavior, not narrated history. Root cause:
`pool-cache.ts` was edited in round 1 (P=25) and never revisited in the STOP
round or the ship round (confirmed against the implementer's own "only
keyword.ts and sense-context.test.ts changed this round" file list).

**LOW — none found beyond the above.** Every other ruling point, both
corrections, every named test, every mutation, and all 4 gates check out
exactly as claimed (see §§1, 4, 5, 6, 7 above).

Every earlier risk list (B's guide, the ship-round checkpoint, the first
review) was treated as a starting point, not a ceiling — the HIGH finding
above was found by re-deriving the full set diff independently rather than
trusting the implementer's own enumerated loss list.

## Verdict

**FAILED_REVIEW.**

The two named ship criteria that matter most for user-facing safety are
genuinely met: 0/150 real negatives admitted (independently reproduced), both
R3 residuals demoted (independently reproduced), the two corrections to the
first review both hold under independent execution, all mutations behave
exactly as claimed, and all 4 gates match exactly. This is real, solid work.

But the specific, falsifiable claim this review was asked to check — "the
implementer reports... electrolyte losses exactly openalex:W7213888420 and
arxiv:2609.08721" — is FALSE. A third, real, unnamed loss
(`openalex:W7203865202`) exists at the shipped p10 cut, dropped by a silent
bug in the implementer's own verification tooling rather than caught by it.
This is not a difference of judgment about where to draw a threshold; it is
the exact class of error this item's OWN process was built to catch after the
first review found the same shape of mistake (a completeness gap in a
"we checked this" claim) — and the ruling's own binding text (§1bg point 6)
requires every such item to be listed, which did not happen. The manager's
own stated reasoning for choosing p10 over p5 ("p5–p12 tie on losses") is
demonstrably incomplete once this item is accounted for.

Recommended next step (not performed here — A2 never fixes product code):
the same C re-runs its ceiling computation so it cannot silently skip an id
(fail loudly on a missing ceiling, or compute it via the confound-free
`scoreKeyword`-direct technique this review used), regenerates the true
p5–p25 loss/gain tables, labels `openalex:W7203865202`, and gives the
corrected table to the manager to either accept the cost (parallel to
arxiv:2609.08721, if judged not-core-topic) or reconsider the percentile
choice with accurate data; separately, fix `pool-cache.ts`'s stale "25th-
percentile" comment to say "10th-percentile" (or reference the constant's own
doc comment instead of restating the number, as the AMENDMENT-4 block in
`keyword.ts` now correctly does).

## Report path

`docs/jev-abc/SENSE-CONTEXT-EVIDENCE-A2-20260929T185226Z.md` (this file).

---

# RE-CHECK — §1bg point 13, fix round 2 (2026-09-29, same session)

STATUS: IN_PROGRESS

Manager ruling read first (§1bg point 13, ABC-JEV-INTEGRATION.md lines
271-275): keep p10; `openalex:W7203865202` ruled **ACCEPTED COST 2** (same
character as arxiv:2609.08721 — genuine but adjacent device class, does not
cross the §1bg.12b core-topic threshold); implementer to add a tripwire,
fix `pool-cache.ts`, re-run the set diff with the corrected (never-skip)
method, gates, then this same A2 re-checks.

Implementer's final-round checkpoint read in full
(`docs/jev-abc/SENSE-CONTEXT-EVIDENCE-C-20260929T171745Z.md`, "Fix round 2"
section, lines 871-1025): claims the false "exactly two losses" claim marked
CORRECTED in place with the root cause named; a corrected set diff via the
SAME confound-free method this review used (`scoreKeyword` direct for
T1/T2/T3, `scoreItems` presence for T4-only, everything compared or
flagged, nothing skipped) → electrolyte losses exactly
{W7213888420, arxiv:2609.08721, W7203865202} both harnesses, gains exactly
the same 7, solid state/LCO unchanged, 0/150, both residuals demoted, 0
flagged anywhere; a new tripwire test for W7203865202 (comment "accepted
cost 2, §1bg.13c"); `pool-cache.ts`'s comment fixed to say the Pth-percentile
(P=10) rather than restating "25th"; gates 5291 passed + 6 skipped / 0
failed, tsc 0, eslint 0/151, build OK. Only `sense-context.test.ts` and
`pool-cache.ts` changed this round (`keyword.ts` mutated-and-restored,
hash-identical to the reviewed state).

## 1. Full set diff at the final code — re-run with corrected tooling

Rebuilt the 4 HEAD-copy files (`git show HEAD:...`, imports redirected —
same technique as the original review, freshly recreated since the prior
copies were deleted). New probe `__a2_probe_measure2.test.ts`: identical
design to the original review's corrected method — every T1/T2/T3 literal
hit classified via `scoreKeyword()` DIRECTLY (ceiling = same function with
`contextText:""`, never touching `combine.ts`, so `shouldPushReviewPaper`
cannot drop anything); every T4-only remainder via `scoreItems` presence,
with an explicit `flagged` bucket for anything that cannot be cleanly
classified (never a silent skip). Kept `keyword.ts` at its real, unmutated
state throughout this measurement (checked before running: hash
`fa12abd5...` — identical to the state this review last left it in, and to
the implementer's own recorded hash — confirms it was genuinely untouched
this round, matching their claim).

Result, asserted by hard equality (not eyeballed), all 4 tests PASS:
- **Electrolyte, harness (a) literal-match AND harness (b) all-in-window:
  losses = exactly `{openalex:W7213888420, arxiv:2609.08721,
  openalex:W7203865202}` — no more, no fewer, in both harnesses.** Gains =
  exactly the same 7 ids this review named originally
  (`W7202367926, W7202147667, W7203493877, pubmed:42612502,
  arxiv:2609.28768, arxiv:2609.28369, arxiv:2609.26685`).
- Solid state: 0 losses either harness; 1 gain (`openalex:W7214086461`, T4)
  in all-in-window only — unchanged from the ship round.
- LCO: 0 losses either harness; 1 gain (`openalex:W7204043657`) both
  harnesses — unchanged.
- **0 flagged ids anywhere**, across all 6 tag×harness cells.
- 150 negatives (all 3 files): 0 full-strength before AND after, 0 flagged.
- Both R3 residuals (Thorium, quantum-storage): demoted before AND after.
- Live LCO trio: `W7213893763` demoted→full, cuprate demoted both,
  `W7214055235` (Li2C2O4) full both — unchanged.

**CONFIRMS the implementer's final-round claim exactly, independently, with
freshly-built tooling (not a reuse of any saved implementer output).** No id
is skipped anywhere — the specific failure mode that caused the original
HIGH finding cannot recur under this design, because the ceiling for every
T1/T2/T3 item comes from `scoreKeyword` directly (which has no
review-policy dependency to silently fail on), and every T4-only item is
visited and given an explicit status (never merely absent from a report).

## 2. The new tripwire test

Read in full (`sense-context.test.ts`, the `openalex:W7203865202` case,
comment "accepted cost 2, §1bg.13c" — present, matches the ruling exactly).
**Does it exercise the same gate decision the reader's real path makes?
YES, and it PROVES this rather than assuming it:** the test computes
`scored` via the real `scoreItems([paper], {topics:["electrolyte"],
seedTexts:[BATTERY_PROJECT_TEXT]}, undefined, now)` (the actual reader-
facing pipeline) AND `direct` via `scoreKeyword(...)` called directly with
the same real context text, then asserts
`scored[0].scoreBreakdown.keyword` is `toBeCloseTo(direct.score, 10)` — a
10-decimal-place equality between the real pipeline's output and the direct
call. This is exactly the check this re-check was asked to make, and the
test makes it itself rather than leaving it to be inferred. `ceiling` (a
third `scoreKeyword` call with `contextText:""`) is compared against
`direct` to assert demotion. The test's own comment explains why this
fixture needs the direct technique where its siblings don't (this exact
paper's title contains the word "Review," tripping `shouldPushReviewPaper`
on any no-seedTexts bypass call) — this is a live, self-documenting
reproduction of this review's own root-cause finding, not just a citation
of it.

**Mutation (own execution, real product file, sha256 before/after every
restore):** p10 → p25 (`SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE` edited
directly in `keyword.ts`) → **7 tests red**, and the new
`openalex:W7203865202` tripwire is among them
("expected 0.4667 to be less than 0.4667" — full strength at p25, exactly
as the original review's own cross-swept sweep data predicted). The other 6
are the same side effects this exact mutation has produced in every prior
round (the pinned-cut test, the 3 other test-23 protective tests, 1
rescue-isolation side effect) — all previously explained, nothing new.
Restored: hash `fa12abd5d0260327be7ce396e3b6488fb98abc5b0a550f3176cdb3e5a381b049`
(identical before and after), CRLF preserved (`file` command re-checked).

## 3. Stale p25/6.784 scan — pool-cache.ts now correct, nothing else stale

`grep` across all 8 changed files for `"25th-percentile"` / `"25th
percentile"`: **0 matches anywhere** (the fix is complete — the comment now
reads "...below the table's own Pth-percentile weight (P = 10 as shipped,
narrowed from an original P = 25 by §1bg point 12...)", pointing at
`keyword.ts`'s own doc comment for the number rather than restating it, per
this review's own suggestion). Remaining `"6.784"` mentions: exactly 2, both
in `sense-context.test.ts`, both explicitly historical/narrative ("as first
shipped (P=25, 6.784)", "Narrowed from the original P=25 (6.784)") — never
presented as current. **MEDIUM finding from the original review is
CLOSED.**

## 4. Gates

All 4 re-run from `web/`, one at a time, after the mutation in §2 was
restored and hash-verified:

| Gate | Implementer's claim | A2 independent re-run |
|---|---|---|
| `npx vitest run` | 5291 passed + 6 skipped / 0 failed | 285 passed + 3 skipped (288 files) / **5291 passed + 6 skipped** — MATCH |
| `npx tsc --noEmit` | 0 errors | 0 errors — MATCH |
| `npx eslint .` | 0 errors / 151 warnings | 0 errors / 151 warnings — MATCH |
| `npm run build` | OK | OK, exit 0, all routes compiled — MATCH |

## 5. Tally owed by §1bg.13c

Every genuine or borderline paper the shipped p10 cut demotes in the
measured pools, by id (from the confirmed set diff in §1 above — the
complete electrolyte loss list, cross-referenced against this review's own
per-item labels from the original round): **exactly 2** —
- `arxiv:2609.08721` (TEMPO catholytes — genuine, adjacent chemistry)
- `openalex:W7203865202` (proton-conducting solid oxide cell electrolytes —
  genuine/borderline-adjacent device class)

(`openalex:W7213888420` is the third electrolyte loss but is wrong-field —
a correct demotion, not a cost — and is excluded from this tally by the
tally's own definition, "genuine or borderline.") Solid state and LCO
contribute 0 to this tally (0 losses either tag). **Matches exactly what
the coordinator's message named as expected.**

## 6. Privacy

Re-scanned the 8 diff files + all 4 SENSE-CONTEXT-EVIDENCE docs (A, B, C,
this A2 report including everything added this round) for email-shaped
strings, a Windows user-profile path pattern, the account holder's name,
and university/NetID-shaped strings: **0 real hits.** Two incidental matches
on the bare word describing the search category itself (once in the first
review's own privacy paragraph, once in this report's own §9 above) — both
read in context, neither is a leaked value.

## Hard constraints — held

Same discipline as the original review: `keyword.ts` touched only for the
one hash-verified, fully-restored mutation in §2 (final hash
`fa12abd5...`, matching both this review's own prior baseline and the
implementer's own recorded hash — confirms nothing drifted). All probe
files (4 fresh `__a2_probe_head_*.ts` copies + `__a2_probe_measure2.test.ts`)
deleted — confirmed via repo-wide search and `git status --short`, which
shows exactly the same 8 reviewed files + `ABC-JEV-INTEGRATION.md` +
the 4 evidence docs + the pre-existing untracked `node_modules/`, nothing
else. No commit/push/stash/branch. No network call of any kind. `web/.env`
and `web/.env.local` never opened. No API key written anywhere. Scratchpad
data passed only via `A2_SCRATCHPAD_DIR`; every reference in this report
uses the `<scratchpad>/...` shorthand.

## Verdict

**VERIFIED.**

Both findings from the original review are resolved: the HIGH finding (the
silently-dropped third loss) is closed by a corrected, never-skip set-diff
method whose output this review independently reproduced byte-for-byte
with freshly-built tooling, and by a manager ruling (§1bg.13c) that
explicitly accepts the newly-surfaced cost with a named tripwire, exactly
mirroring the treatment already given to arxiv:2609.08721. The MEDIUM
finding (the stale pool-cache.ts comment) is closed — 0 stale
p25/25th-percentile mentions remain anywhere in the 8 files. The new
tripwire test both names the ruling and proves, by execution within the
test itself, that its direct-`scoreKeyword` technique agrees with the real
reader-facing `scoreItems` pipeline to 10 decimal places — it is not a
weaker or divergent check. All 4 gates match exactly. The tally §1bg.13c
asked for is exactly the 2 items the ruling itself named. No new finding.

STATUS: VERIFIED
