STATUS: COMPLETE

# SENSE-CONTEXT-EVIDENCE — B investigation guide

Role: B (investigator), read-only on product code. Assignment: ABC-JEV-INTEGRATION.md
§1be point 6 (a-e), background §1be point 3, §1bd, §1ax, §1ap (+AMENDMENTs 1-5).
Branch Jev-integration-and-sorting-filtering-enhancement, HEAD 90db90fe. 0 external
network calls made (none were needed — every measurement below reuses already-saved
real data). No product file touched. Three temporary probe files were created under
`web/src/lib/scoring/` (`__b_probe_census.test.ts`, `__b_probe_grid.test.ts`,
`__b_probe_task3.test.ts`), run via `npx vitest run <file> --testTimeout=120000` from
`web/`, and deleted before this guide was finalized — confirmed by `git status --short`
at the repo root (see the end of this document).

## 0. The defect, confirmed by execution

The manager's reading was UNVERIFIED at assignment; it is now confirmed exactly as
described. `senseContextGate`'s overlap axis (`overlapCoefficient` in
`web/src/lib/scoring/keyword.ts`) counts every token that survives `tokenize()`
(60-word stopword list — no academic-connector words: "while", "focused", "research",
"improving", "between", "growth", "stability" are all absent) and is not in the
11-entry closed list `GENERIC_TERMS` (materials, energy, transport, modelling,
simulation, interface, design, analysis, systems, data, characterization — none of
those words either). So a reader's own filler words count as if they were topical
agreement. Measured directly: the SENSE-CONTEXT-R3 "Thorium-229 as a Phonomagnetometer"
residual shares exactly `{"while","focused"}` (weights 3.26 and 5.13 in the shipped
reference table — both far below typical domain words like "cathode" 7.19 or "battery"
7.07) with the reader's real, enriched context. Under today's SHIPPED, unfolded
`tokenize()` it is correctly demoted (overlapSim 0.0909 < the 0.10 floor). Once plural
folding is applied to the context check (the change TOKENIZE-PLURALS attempted and then
split out, §1be), the context token count shrinks and overlapSim crosses exactly to
0.1000 (inclusive `>=`) on those same two non-topical words — reproduced below,
byte-for-byte, through the real functions.

## 1. Evidence census

**Method.** In-window (`dropStale`, window "week", same reference instant every prior
guide in this lineage used, `2026-09-28T16:05:42Z`) real pools, real functions
(`scoreKeyword`, `senseContextGate`, `selfDeclaresDifferentSense`, `tokenize`,
`tokenizeFolded`, `expandTerm`, `isGenericTerm`, `canonicalize`), the shipped
`reference-idf.json` for word weights. Port validation done first: a from-scratch
reconstruction of the private `senseContextStripSet`/`cosine`/`toReferenceVector`
pieces, built only from exported primitives, reproduced the real `senseContextGate`'s
`fixedSim`/`overlapSim` to 10 decimal places on a sample before being trusted for
anything else.

**Pool provenance note (reported honestly, not silently smoothed over).** The task
named three pool files: `out/raw-P4.json` (electrolyte), `out/raw-P2.json`
(solid state), `out/tagged-LCO.json` (LCO), paired with the three `sc-neg-*.json`
negative sets. Using them with a direct in-window + literal-match count, electrolyte
(54/89 T1-hit-and-pass, historically cited 57/145) and LCO (2/3, exact match to the
historical citation) reconcile closely. Solid state does not: `raw-P2.json` was
originally fetched under REQUIRED-GATE for the tag `"solid electrolyte"`, and only 25
of its 62 in-window items literally contain the phrase "solid state" at all — nowhere
near the historically-cited "51/62"/"54/62". `SENSE-CONTEXT-B-20260928T173815Z.md`'s
own text traces its original solid-state positives to `raw-P1a.json`/`raw-P1b.json`
(the long-tag pool, 27 in-window), not P2 — later rounds' exact solid-state pool
provenance could not be reconstructed from what is currently in the scratchpad within
this item's budget (the scratchpad is reused and overwritten across many rounds).
Proceeding with the task's explicit file list as instructed; every "today" vs.
"naive fold" vs. "option" comparison below uses the SAME 89/25/3 literal in-window
positive sets and the SAME 35/48/2 negative sets (LCO negatives: 17 of 50 literally
match "LCO"; 15 of those are intercepted by the pre-existing rule (c) self-declared-
different-expansion check before ever reaching the context axis — confirmed via
`selfDeclaresDifferentSense`, matching SENSE-CONTEXT-R3-A's own reconciliation exactly
— leaving 2 that reach the axis), so every DELTA reported is internally consistent and
reproducible even where the absolute solid-state denominator does not match an older
citation.

**Per-item fixedSim/overlapSim/shared-words (today, shipped, unfolded).** Representative
rows (full data in each item's own probe run; not re-saved to the repo):

| Item | Tag | fixedSim | overlapSim | Pass? | Shared words (weight) |
|---|---|---|---|---|---|
| Thorium-229 phonomagnetometer (R3 fixture) | solid state | 0.02508 | 0.09091 | NO (correctly demoted, today) | focused (5.13), while (3.26) |
| Eu³⁺ quantum-storage (R3 fixture) | solid state | 0.03673 | 0.00000 | NO | *(none)* |
| openalex:W7213893763 "...Leaching of Lithium Cobalt Oxide..." (live, matched via full name) | LCO | 0.01142 | 0.08696 | **NO — demoted despite being right-sense** | batteries (7.19), while (3.26) |
| openalex:W7214055235 (Li₂C₂O₄, accepted residual) | LCO | 0.18248 | 0.26087 | YES (via RESCUE and AND both) | cathode (7.19), batteries (7.19), battery (7.07), interfacial (6.87), improving (4.92), stability (4.64) |
| arxiv:2608.25492 "...LiCoO2 Leaching..." (live, matched via formula) | LCO | 0.04419 | 0.13043 | YES (via AND) | cathode (7.19), battery (7.07), while (3.26) |
| arxiv:2608.18563 (La₂CuO₄ cuprate, wrong sense) | LCO | 0.00000 | 0.00000 | NO (correctly demoted) | *(none)* |

**How many admitted items depend on non-topical overlap words.** Of the items that
PASS today (unfolded): 54/89 electrolyte, 25/25 solid state, 2/3 LCO. Classifying each
pass by which floor path admitted it (`AND` = needs the overlap ratio; `RESCUE` =
fixedSim alone ≥ 0.10, overlap irrelevant; `BOTH` = clears both independently) shows the
overlap axis is load-bearing (an `AND`-only admission) for a real, non-trivial minority
— e.g. 3 of the 8 live full-strength LCO items above passed via `AND` alone (their
fixedSim never reached the rescue floor), and inspecting their shared-word lists shows
low-weight connector words ("while", "between") riding alongside genuinely topical ones
("cathode", "battery") in the SAME overlap ratio, undetectably mixed in — the axis
cannot today tell "this word is why the paper agrees" from "this word is just how
people write English." Every `RESCUE`-only pass (fixedSim already clears 0.10 on its
own) is UNAFFECTED by anything in the overlap axis and needs no fix.

**Negatives.** 0 of 150 real wrong-domain negatives pass today, on any tag, via any
path (35 electrolyte + 48 solid state + 2 LCO reach the axis at all; the other 65 are
rejected earlier — either no literal match, or, for 15 LCO petroleum papers, the
pre-existing self-declared-different-expansion rule). This safety margin is what every
option below is measured against.

## 2. Options — pool-independent, no new closed word list

Three shapes were designed and grid-measured, all built ONLY from real exported
primitives (`tokenizeFolded`, `expandTerm`, `isGenericTerm`, `singularize`) plus the
shipped `reference-idf.json` (already the fixed axis's own data source, so using it for
the overlap axis too adds no new artifact):

- **(i) Document-frequency cut.** A token leaves the overlap-axis token sets (both
  sides) entirely when its reference-table weight is below a cut `W` — the most common
  words of scientific English (by the table's own measured rarity) leave the axis,
  generalizing today's 11-word closed list into a continuous, data-derived rule with
  the identical shape (a word simply isn't counted).
- **(ii) Reference-weighted overlap.** Replace the raw count ratio
  `|intersection| / min(|A|,|B|)` with a rarity-weighted version,
  `Σ weight(shared) / Σ weight(smaller side)` — every word still counts, but a rare,
  specific word counts for much more than a common one, so two connector words can no
  longer single-handedly cross a floor built for a handful of true content words.
- **(iii) Existence gate.** Keep today's ratio unchanged, but ADD a second requirement:
  at least one of the shared words must itself be genuinely rare (weight ≥ a threshold).
  A structurally different shape from (i)/(ii) (an existence test, not a
  threshold-on-a-ratio) — it directly targets exactly the Thorium-229 shape (2 shared
  words, both common) without touching the ratio's own math.

**Grid.** Same procedure as `SENSE-CONTEXT-C2` task 3 (24 base points: 4×G1, 4×G2,
16×G3 over `F∈{0.015,0.02,0.025,0.03}`, `R∈{0.05,0.06,0.08,0.10}`), crossed with each
option's own parameter (docfreq-cut and existence swept at the reference table's
25th/40th/50th/60th weight percentiles — 6.784/7.477/7.659/7.882; weighted swept a
dedicated floor list 0.15/0.25/0.35/0.45) — 264 points total, plural fold ON
(`tokenizeFolded`) at all four context-check call sites (`senseContextStripSet`'s two,
`senseContextGate`'s two), `GENERIC_TERMS` kept at its shipped (reverted, plural)
spelling as the primary sweep. **Hard bar** (both required, not the older C2-style
partial bar): 0/150 negatives pass (measured across all 3 tags' reach-the-axis subsets)
AND both R3 residuals demoted. **144 of 264 points meet it** (48 per option; G1 never
meets it — matches every prior round's finding that the fixed axis alone cannot catch
the LCO-shaped residual). Selection: maximize the minimum positive retention across the
three tags among bar-meeting points (rule (b); rule (c)/(d) tie-breaks were not needed —
each option's winner was unique).

**Naive fold, for comparison (today's mechanism verbatim, tokenizer swapped to
`tokenizeFolded`, nothing else changed — this is exactly what TOKENIZE-PLURALS-C
built and reverted).** Reproduced: electrolyte 63/89 (70.8%), solid state 25/25 (100%),
LCO 2/3 (66.7%), 0/85 axis-reaching negatives — but the phonomagnetometer residual
FLIPS to admitted at full strength (fails the hard bar). Confirms the defect is real
under the actual grid harness, not just the one hand-checked fixture.

**Results table** (F=0.015, R=0.08 in every winning row; ruleShape G3 = `(fixed≥F AND
overlap-axis-pass) OR fixed≥R`):

| Configuration | electrolyte (of 89) | solid state (of 25) | LCO (of 3) | Min retention | 150 negatives | Both R3 residuals demoted |
|---|---|---|---|---|---|---|
| **Today (shipped, unfolded)** | 54 (60.7%) | 25 (100%) | 2 (66.7%) | 60.7% | 0 pass | yes (not even reached — no fold, no defect) |
| **Naive fold** (defect reproduced) | 63 (70.8%) | 25 (100%) | 2 (66.7%) | 70.8% | 0 pass | **NO — phonomagnetometer admitted** |
| (i) Doc-frequency cut, W=p25=6.784 | **66 (74.2%)** | 25 (100%) | **3 (100%)** | **74.2%** | 0 pass | **yes** |
| (ii) Weighted overlap, floor=0.15 | 55 (61.8%) | 25 (100%) | 3 (100%) | 61.8% | 0 pass | yes |
| (iii) Existence gate, W₂=p40=7.477 | 52 (58.4%) | 25 (100%) | 3 (100%) | 58.4% | 0 pass | yes |

All three options are SAFE (0/150 negatives, both residuals demoted at every one of
their 48 bar-meeting points, not just the winner shown). **Option (i) wins clearly** —
it beats even the (unsafe) naive fold on every tag, and its cost curve is well-behaved:
sweeping the cut from p25→p60 only ever loses electrolyte retention in one step
(66→52 at the p40 boundary; solid state/LCO stay perfect at every tested cut), so a
gentle cut (bottom quartile of the table's own measured word-rarity distribution) is
enough — nothing about the result depends on an aggressive cut. The words it removes at
the winning cut are precisely the manager's named list: while (3.26), research (2.91),
focused (5.13), improving (4.93), between (2.54), material (4.21) all fall below 6.784;
domain words the genuine passes actually rely on — cathode (7.19), battery (7.07),
interfacial (6.87), suppressing (7.88) — sit comfortably above it. One honest caveat:
"electrolyte" itself (6.18) also falls below this cut, so when checking a DIFFERENT
tag it would leave the axis too; this did not cost any measured retention (electrolyte
passes rely on multiple co-occurring domain words, not that one alone), but it is a
real, not hidden, edge of a table built from a general scientific sample rather than
this product's own vocabulary.

**GENERIC_TERMS singular respelling, measured both ways (§1be point 4).** At the
chosen point (option i, W=6.784, F=0.015, R=0.08), re-running every positive and
negative in all three pools with `GENERIC_TERMS` respelled to singular
("materials"→"material", "systems"→"system") produced **0 verdict flips** — confirms
TOKENIZE-PLURALS-C's own finding (this respelling never moved a measured number in the
shipped scope) extends to the new evidence-axis mechanism too. Swept only at the
winning point, not across the full 264-point grid (a deliberate scope decision, stated
plainly: re-running the entire grid a second time for a change already shown to be
inert would not have changed the recommendation).

**The 3 parked TOKENIZE-PLURALS-EVIDENCE tests**, run against the chosen point via the
gate mechanics directly (the literal product tests could not be run without editing
`sense-context.test.ts`, which is out of scope for B):
1. Hydrogel-electrolyte positive (openalex:W7202367926) — fixedSim 0.1195 ≥ rescue
   floor 0.08 → **passes** (was demoted pre-fix). Matches the spec's claim.
2. Clinical-electrolyte negative (pubmed:39215244-shaped) — fixedSim 0, overlap 0 →
   **still fails**. Matches the spec's claim.
3. The third spec's exact `fullGroundingScore` numeric assertion could not be verified
   without wiring the new gate into `scoreItems` (product code, out of scope) — the
   gate-level result (test 1 passing) is the precondition for it and holds; the exact
   number should be re-confirmed by whoever implements this, per the deferred spec's
   own note that the evidence-axis fix "may move this fixture's numbers again."

## 3. Expansion/formula matches (§1be point 6e)

**Design measured.** For a tag with a catalogued `ABBREVIATION_GROUPS` entry, split
`expandTerm(tag)`'s variants into the abbreviation's own bare form (exactly the
canonical short spelling — every cataloged abbreviation is a `KNOWN_SHORT_FORM`, which
`inflectedForms` structurally never pluralizes, so this is exact, not approximate) vs.
every other variant (the spelled-out full name, the chemical formula, and their trivial
plural forms). A hard-earned correction while building this: `expandTerm(anyMember)`
performs a full transitive-closure search over BOTH inflection AND abbreviation-
equivalence edges, so it returns the SAME whole-group set no matter which member you
start from — an early version of this classifier called `expandTerm(abbreviation)`
expecting just the abbreviation's own forms and silently got the whole group back,
wrongly tagging every bare "LCO" mention as also "matched via full name." Caught by the
negatives-safety check below (it should have been 0 and wasn't), fixed by comparing
against the SET DIFFERENCE instead. A candidate whose literal match includes at least
one full-name/formula-family variant skips the context check unconditionally for that
tag (same treatment a long/specific tag already gets).

**Measured effect (LCO — the only one of the 3 tags with both `isShortOrAmbiguous` and
an abbreviation group; "solid state"/"electrolyte" have no abbreviation group so this
mechanism is structurally inert for them):**
- **The target defect is fixed.** openalex:W7213893763 matched via the full name
  "lithium cobalt oxide" (present in both title and abstract) → skip rule fires →
  full strength, no longer demoted.
- **Safety: 0 of 150 real negatives, across all 3 tags, would ever be classified as a
  full-name/formula match for a tag they don't belong to** — none of the 50 petroleum
  "light cycle oil" papers, 50 clinical-electrolyte papers, or 50 physics "solid state"
  papers literally contains the string "lithium cobalt oxide" or "licoo2" (or an
  equivalent for the other 2 tags, which have no such alternate spelling at all).
- **Safety: the two R3 residuals stay demoted** — tag "solid state" has no
  `ABBREVIATION_GROUPS` entry, so the skip rule never applies to them; confirmed by
  direct classification (`fullNameOrFormula: false` for both).
- **Correctly does NOT rescue the known Li₂C₂O₄ residual** (openalex:W7214055235) —
  its text never spells out "lithium cobalt oxide" or "licoo2," only the bare
  joint coinage "NCO@LCO" → classified as bare-form-only → unaffected, stays an
  accepted cost exactly as before (still admitted via RESCUE, unrelated mechanism).
- **Correctly does NOT rescue the wrong-sense cuprate** (arxiv:2608.18563, "LCO" =
  La₂CuO₄ for that paper) — same reasoning, bare-form-only, stays demoted.
- **Retention**: LCO in-window T1-hit set improves from 2/3 (66.7%) to 3/3 (100%) — the
  SAME improvement option (i) independently found from the evidence-axis side, via a
  completely different mechanism (this is provenance-of-match, not overlap-word
  quality) — the two fixes are complementary, not redundant, and stacking them was not
  separately measured (see POLICY).

## 4. The seed-text lead (§1be point 3) — traced, not fixed

Confirmed by reading `web/src/lib/feed/profile-compiler.ts` and
`web/src/lib/feed/pipeline.ts`, and independently corroborated by the live evidence file
(`prod-lco-resp-3.json`'s own `meta.searchBrief.generatedQueries`, which already
contains, as separate array entries: `"research"`, `"solid-state"`, `"battery"`,
`"materials"`).

**Where they come from.** `profile-compiler.ts`'s private `phrasesFromText(text, max)`
(used inside `projectQueries`) extracts, from the reader's free-text project/challenge
paragraphs, both multi-word phrase chunks AND a separate list of single lowercase
keyword tokens (≥4 chars, filtered only against a small 17-word local stopword list —
`about/after/against/also/and/are/between/from/into/that/the/their/this/through/using/
with/without` — a completely different, smaller list than either `tokenize.ts`'s 60-word
STOPWORDS or the SENSE-CONTEXT `GENERIC_TERMS` set; "research", "focused",
"solid-state", "battery", "materials" pass through it untouched). `projectQueries`'s
"Tier 2" (the QUERY-BUDGET ordering, §1az) explicitly places these
"bare single-word projectTerms entries" into the query list — its own comment names
this exact case: `"this is where 'research' lives."` They flow into
`compileSearchBrief`'s `generatedQueries` field.

**They become BOTH things asked about, from the SAME array, confirmed by reading the
call sites:**
1. **Paper-source search queries** — `web/src/lib/feed/pipeline.ts:636` and `:1284`,
   `queries: brief.generatedQueries`, passed directly into every source adapter's
   `.fetch()` call (the literal text sent to OpenAlex/arXiv/PubMed/etc. as a search
   term).
2. **SENSE-CONTEXT's own context vocabulary** — `pipeline.ts:1387`,
   `seedTexts: briefToSeedTexts(req, brief)`, where `briefToSeedTexts` (same file)
   folds `brief.generatedQueries` directly into `profile.seedTexts`, which
   `combine.ts`'s private `senseContextText()` uses (unchanged since AMENDMENT 2(i))
   to build `workText` — the exact text the context check compares every paper
   against.

So a single word extracted from the reader's own project paragraph is not merely
"present in a longer paragraph that happens to also get compared" (which would already
be the base-rate defect under investigation) — it is independently REPEATED as its own
free-standing context-comparison unit, once per generic word, which is exactly the
shape `sense-context.test.ts`'s own committed test 17 fixture
(`ENRICHED_SOLID_STATE_SEED_TEXTS`) reconstructs by hand from real production shape,
and exactly what the live LCO response's own recorded `generatedQueries` array shows
happening today. This is reported for the record only, per the brief — no product file
was touched.

## 5. Recommendation, POLICY, and tests

### 5.1 Recommendation

Ship **option (i), document-frequency cut, at the reference table's 25th weight
percentile (6.784)**, combined with the **task-3 expansion/formula skip rule** for
tags carrying an `ABBREVIATION_GROUPS` entry. Together they: fix the phonomagnetometer-
shaped defect (both residuals demoted, matching the escape clause that stopped
TOKENIZE-PLURALS); improve genuine-paper retention over TODAY on every tag measured
(electrolyte 60.7%→74.2%, LCO 66.7%→100%, solid state unchanged at 100%); keep 0/150
real negatives passing; and add no new closed word list — the fix generalizes
`GENERIC_TERMS` into the SAME reference table the fixed axis already trusts, rather
than hand-curating a second list that would need its own maintenance. This clears the
way to re-fold `tokenizeFolded` into the context check (the change TOKENIZE-PLURALS
split out), recovering the +12 electrolyte / +3 solid-state genuine-paper gains that
item measured and could not safely ship alone.

### 5.2 POLICY — manager decides

1. **Ship option (i) vs. (ii)/(iii)/none.** (i) dominates on every measured axis; (ii)
   and (iii) are both safe but cost noticeably more genuine retention (61.8%/58.4% vs.
   74.2% minimum retention) — no reason found to prefer them over (i), but the manager
   may weigh (i)'s reliance on the reference table's OWN word-rarity distribution
   (built from a general OpenAlex sample, not this product's own vocabulary — the
   "electrolyte also falls below the cut" caveat in §2) differently.
2. **Ship the task-3 expansion/formula skip rule alongside it, as its own change, or
   defer it.** Both fixes are individually safe and independently measured; stacking
   them (both live in `scoreKeyword`'s per-topic loop and `combine.ts`'s T4 loop) was
   not measured together in this item — recommend a small joint-regression check
   before/if both ship in the same round, not a re-measurement of either alone.
3. **The re-fold decision itself** — this item only re-derives the axis so folding is
   SAFE; actually re-applying `tokenizeFolded` to the 4 context-check call sites
   (reverted by §1be) is a separate, explicit step the manager approves, mirroring how
   §1be split it out in the first place.
4. **`SENSE_CONTEXT_OVERLAP_FLOOR` itself (0.10) was not re-swept** — this item only
   changed what counts as a candidate for the ratio, not the ratio's own floor value;
   the grid re-confirmed 0.10 still works well with the new axis (F=0.015/R=0.08
   remains the winning combination) but did not test whether some OTHER
   OVERLAP_FLOOR value paired with option (i) does even better. Not measured; flagged
   as a possible, low-priority further-tuning follow-up, not a blocker.
5. **The reference table's suitability as a generic-word detector for THIS product**
   (vs. building a product-specific frequency table someday) is an accepted-cost
   question, not resolved here — recorded so it is a decision on record, matching
   `SENSE-CONTEXT-C2`'s own unresolved-POLICY convention for the table's other roles.
6. **Cache version bump** — if either fix ships, `PAPER_CACHE_KEY_VERSION` needs
   another bump (same single-exported-prefix mechanism every prior round in this
   lineage used) since both change context-check verdicts, hence pool
   admission/ranking. Not resolved here (implementer's job at ship time).

### 5.3 Tests the fix needs

1. **The phonomagnetometer regression, byte-exact**: the real R3 fixture, folded
   context, option (i) wired in — `senseContextGate(...).pass` must be `false`
   (currently the escape that stopped TOKENIZE-PLURALS); mutation (remove the
   doc-frequency cut) must turn it red.
2. **The quantum-storage regression** (the OTHER R3 fixture) — same shape, already
   demoted under RESCUE-path math regardless, but pin it anyway so a future floor
   change is caught.
3. **The paired 3 parked TOKENIZE-PLURALS-EVIDENCE specs**, verbatim from
   `docs/jev-abc/TOKENIZE-PLURALS-C-20260929T141909Z.md`'s "Deferred specs" section —
   re-confirm the exact `fullGroundingScore` numeric target once the real gate is
   wired (§2's own honest caveat: it was not independently re-verified here).
4. **The W7213893763 defect fixture, byte-exact** (the case this whole item exists
   for): real title/abstract text (public OpenAlex metadata), tag "LCO", asserting
   full-strength admission after BOTH fixes (or after each alone, as two separate
   assertions, since either one independently rescues it here — evidence-axis via
   fixedSim clearing rescue once "batteries"/"while" no longer inflate a competing
   metric, or the task-3 skip rule directly).
5. **A negatives tripwire**: assert 0 of a frozen sample of the 150 saved real
   negatives passes under the new axis — mutation (loosen the cut) must turn at least
   one red.
6. **A "-ses"/generic-word interaction tripwire**: since option (i) and the
   already-shipped plural-fold machinery both touch tokenization, one test asserting
   a word like "analyses" (already known to interact with `isGenericTerm`, per
   TOKENIZE-PLURALS-C's own mid-task addendum) does not unexpectedly change axis
   membership under option (i) — not found to be a problem here (0 respelling-driven
   flips, §2), but worth a named regression rather than trusting it silently.
7. **Task-3 classifier unit tests**: the bare-vs-full-name/formula split for LCO
   (protective: "LCO" alone → bare only; "lithium cobalt oxide"/"LiCoO2" → full-form;
   both → both), and the negatives-safety property (no petroleum/clinical/physics
   negative is ever classified full-form for a tag it doesn't belong to) as a
   permanent regression, not just this investigation's one-off check.
8. **Mutation coverage**: remove the doc-frequency cut (→ phonomagnetometer red);
   remove the task-3 skip rule (→ W7213893763 fixture red); restore both, proven by
   hash, per this lineage's established discipline.

## Probe cleanup — verified

Three temporary files were created under `web/src/lib/scoring/`:
`__b_probe_census.test.ts`, `__b_probe_grid.test.ts`, `__b_probe_task3.test.ts`. All
three were deleted before this guide was finalized. `git status --short` at the repo
root shows only `ABC-JEV-INTEGRATION.md` (modified before this item started, not by
this session) and this new guide file, plus the pre-existing untracked `node_modules/`
— no probe file, no other product file, appears anywhere in the diff.

STATUS: COMPLETE
