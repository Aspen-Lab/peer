STATUS: VERIFIED

# ABBREV-RECALL — independent review (agent A)

Reviewer: agent A, ABC loop. Does not fix product code, does not propose designs; measures the
implementation against ABC-JEV-INTEGRATION.md §1av and reality; reports ranked findings with
evidence.

Branch Jev-integration-and-sorting-filtering-enhancement, HEAD 026e6ae7. Under review (uncommitted):
web/src/lib/feed/profile-compiler.ts (+test), web/src/lib/opportunities/pool-cache.ts (+test),
C's checkpoint docs/jev-abc/ABBREV-RECALL-C-20260929T005002Z.md.

Started: 2026-09-29T01:04:45Z.

This file is appended to as each check completes.

---

## Check 1 — Order matches the ruling; nothing else changed; cache version

**PASS.** `git diff -- web/src/lib/feed/profile-compiler.ts` (full diff reproduced below) shows the
ONLY functional change is the 3-line reorder inside `projectQueries`'s `baseQueries`, plus a new
comment block. Before: `[...projectTerms, ...exactSenseQueries, ...topics, ...combos]`. After:
`[...exactSenseQueries, ...topics, ...projectTerms, ...combos]` — exact-sense queries, then
Required tags, then project/challenge phrases, then the topic×method / topic×projectTerm
combinations, matching ruling §1av point 1 verbatim.

```
   const exactSenseQueries = exactCanonicalSenseQueries(req.intent?.selectedSenseConcepts ?? []);
   const baseQueries = [
-    ...projectTerms,
     ...exactSenseQueries,
     ...topics,
+    ...projectTerms,
     ...topics.flatMap((topic) => methods.slice(0, 3).map((method) => `${topic} ${method}`)),
     ...topics.flatMap((topic) => projectTerms.slice(0, 3).map((term) => `${topic} ${term}`)),
```

Nothing else changed: query texts (`projectTerms`/`phrasesFromText`/`cleanList` untouched), the
final cap (`.slice(0, controls.focus === "exploratory" ? 15 : 10)`, line 173, untouched), tight
focus (`focusQueries` ternary, lines 161-171, untouched), exploratory extras (untouched), the
zero-topic lane (`topics.length === 0 ? baseQueries : ...`, untouched), the learned-terms path
(`compileSearchBrief`'s `projectQueries(...).slice(0, learned.length ? 7 : 15)`, untouched — 0
lines changed in `compileSearchBrief`).

**Compared with origin/main:** `git show origin/main:web/src/lib/feed/profile-compiler.ts` has no
`exactSenseQueries` concept at all (P1 sense work is new on this branch, not present on main) and
`baseQueries = [...topics, ...projectTerms, ...combos]`. Stripping the (legitimately new, ruling-
sanctioned) `exactSenseQueries` prefix, the fixed branch's order is identical to main's:
`[...topics, ...projectTerms, ...combos]`. **No difference from the live site remains** in the
topics-vs-projectTerms relative order — the only remaining difference is the additive
`exactSenseQueries` prefix, which is pre-existing P1 work this item was never scoped to touch and
which the ruling explicitly places first.

**Cache:** `web/src/lib/opportunities/pool-cache.ts:245` `const PAPER_CACHE_KEY_VERSION = 11;`
(was 10), feeding the single exported prefix `web/src/lib/opportunities/pool-cache.ts:254`
`export const PAPER_POOL_KEY_PREFIX = \`peer-pool-v${PAPER_CACHE_KEY_VERSION}-papers-\`;` — no
second hardcoded literal. New v11 comment paragraph matches the v7-v10 style. Grep for
`peer-pool-v(9|10)-papers|PAPER_CACHE_KEY_VERSION\s*=\s*(9|10)` across `web/src` returned 0
matches — C's "no other file references a stale hardcoded papers-version literal" claim holds.
`pool-cache.test.ts`'s diff is comment-only (v10→v11 trail text), confirmed via `git diff`.

## Check 2 — Adapters: MAX_QUERIES and FIRST-n confirmed (file:line)

**PASS**, matches B's and C's citations exactly, independently re-grepped:
- `web/src/lib/sources/openalex.ts:11` `MAX_QUERIES = 3`; `buildSearchQueries` (112-121):
  `:113 const source = queries.length > 0 ? queries : topics;` → `:120 .slice(0, MAX_QUERIES)`.
- `web/src/lib/sources/semantic-scholar.ts:7` `MAX_QUERIES = 3`; `buildSearchQueries` (139-141),
  same shape.
- `web/src/lib/sources/arxiv.ts:8` `MAX_QUERIES = 3`; `buildSearchQueries` (150-152), same shape.
- `web/src/lib/sources/dblp.ts:7` `MAX_QUERIES = 2`; `buildSearchQueries` (121-123):
  `:122 const source = query.queries?.length ? query.queries : query.topics;` → slice(0,2).
- `web/src/lib/sources/pubmed.ts:7` `MAX_QUERIES = 2`; `buildSearchQueries` (179-181), same shape.

None of the 5 adapter files are in this change's diff (only `profile-compiler.ts` and
`pool-cache.ts` are touched) — the fix works purely by moving the tag earlier inside the
COMPILER's `queries` array (which every adapter already prefers wholesale over `topics` since
`queries.length > 0`), so the tag now survives each adapter's own front-N truncation. Confirms a
1-tag profile with project text now sends its tag to every source (verified both by the unit test
in Check 3 and live in Check 6).

**Residual note (not a defect in this diff — informational, LOW):** `exactSenseQueries` sits AHEAD
of `topics` per the ruling's own order. `web/src/lib/feed/senses.ts` has exactly 5 catalog entries
(`hr.role_conflict`, `compliance.conflict_of_interest`, `software.dependency_conflict`,
`statistics.structural_equation_modeling`, `materials.scanning_electron_microscopy`), so
`exactSenseQueries.length` is bounded at 5 (dedup by senseId). For dblp/pubmed (`MAX_QUERIES=2`),
a profile with 2+ selected senses would fill both slots with sense queries before any Required tag
is ever considered, for those two sources only — the same "crowded out" failure mode ABBREV-RECALL
fixes for project text, now possible via senses instead. Neither B nor C measured or tested this
interaction (C's checkpoint only analyzes the separate learned-terms 7-slot cut, not this one).
This is not a deviation from the ruling — the ruling explicitly orders exact-sense first — so not
ranked as a finding against the implementation; noted for the record and for the already-queued
QUERY-BUDGET follow-up (ruling §1av point 6).

## Check 3 — Tests

**PASS.** `git diff -- web/src/lib/feed/profile-compiler.test.ts` confirms:
- The rewritten test (`"puts the Required tag ahead of project phrases, and still includes the
  project text"`, describe block renamed `project-first` → `tag-first`) carries an explicit
  ABBREV-RECALL comment explaining the contract change, and is strictly no weaker than before:
  previously `generatedQueries[0]).toContain(...)`, now `.toBe("solid electrolyte")` (index 0 is
  now the tag, asserted exactly) AND a new `.toContain("Stabilize sulfide electrolyte
  interfaces")` line proving the project text still generates, just not first.
- 4 new tests in a new `ABBREV-RECALL` describe block (lines 153-215): 1-tag-within-cap (asserts
  "LCO" ∈ `slice(0,2)` AND ∈ `slice(0,3)`, i.e. within both adapter caps), 3-tags-before-any-
  project-phrase (asserts all 3 tag indices < the first non-tag, non-combo query's index), and two
  byte-identical HEAD-pinned guards (zero-topic tight lane; tight-focus-with-one-topic lane).
- **Nothing existing weakened:** the other 6 pre-existing tests (lines 39-142: sense-only exact
  phrase, HR sense in tight focus, materials sense in tight focus, senses+topic in tight focus,
  project/challenge terms in tight focus, empty-intent + topic-filtered tight focus) are
  byte-for-byte untouched by the diff — confirmed by `git diff` showing 0 changed lines in that
  range.
- **P1 sense guarantees still hold:** line 50 `expect(brief.generatedQueries).toEqual(["scanning
  electron microscopy"]); expect(...).not.toContain("SEM")` — a selected sense still emits only
  its exact canonical phrase, and the abbreviation form it deliberately excludes ("SEM") is still
  absent. Independently re-ran (Check 5) — still green.

## Check 4 — Mutation, independently reproduced (not trusting C's report)

**PASS**, reproduced first-hand rather than taking C's checkpoint on faith:
1. Hashed the working file before touching it: `sha256sum web/src/lib/feed/profile-compiler.ts` →
   `b1f4fb0128d32acab0bb66b9aa416b793565df69ca8f26cd19d02981c5f64181` — matches C's stated
   pre-mutation hash exactly, confirming the tree was in the claimed fixed state before I touched
   anything.
2. Edited `baseQueries` back to `[...exactSenseQueries, ...projectTerms, ...topics, ...combos]`
   (tags after project phrases — the ticket's exact regression).
3. `npx vitest run src/lib/feed/profile-compiler.test.ts` from `web/`: **3 of 11 red**, exactly
   the 3 C named — `puts the Required tag ahead of project phrases...` (`generatedQueries[0]`
   became the project fulltext again), `a 1-tag profile with project text keeps the tag within the
   adapters' MAX_QUERIES cut...` (`"LCO"` not in `slice(0,2)`), `a 3-tag profile with project text
   puts every tag before any project-only phrase` (tag index 6, not < 0). The 2 HEAD-pinned
   byte-identical guards and all 6 P1 sense tests stayed green, as expected (mutation-orthogonal).
4. Edited back to `[...exactSenseQueries, ...topics, ...projectTerms, ...combos]`.
5. Re-hashed: `b1f4fb0128d32acab0bb66b9aa416b793565df69ca8f26cd19d02981c5f64181` — **identical** to
   step 1, restoration proven byte-for-byte by an independently-computed hash, not copied from C's
   report. Re-ran the test file: 11/11 passed again.

## Check 5 — Full gates from web/ (run one at a time, not in parallel)

**PASS, all four match C's reported numbers exactly.**
- `npx vitest run`: **284 files (281 passed + 3 skipped) / 5123 tests (5117 passed + 6 skipped) /
  0 failed.**
- `npx tsc --noEmit`: **0 errors.**
- `npx eslint .`: **0 errors, 151 warnings.**
- `npm run build`: **compiled successfully**, full static/dynamic route table printed, no error
  lines (grepped for "error|failed"; the only hit was the route name `/auth/error`, a false
  positive).

## Check 6 — LIVE ACCEPTANCE (the ruling's bar)

Dev server at http://localhost:3000 confirmed already running (`GET /` → 200; not started, stopped,
or restarted; log never read). Sent all 3 of the allowed signed-out `POST /api/feed` requests,
body shape reused verbatim from `docs/jev-abc/SENSE-CONTEXT-A2-20260928T215456Z.md` Check 6:
`{"topics":["<tag>"],"project":"<BATTERY_PROJECT_TEXT>","topN":10}` for `<tag>` = "LCO", "LFP",
"solid state". All 3 returned HTTP 200 in 3.1-5.7s (fresh builds, not cache reads — matches the
cache-bump working as intended: nothing from before this fix's v11 bump was served stale).

### Per-source fetch counts vs. B's before-numbers (openalex 35, semantic_scholar 34, arxiv 34,
dblp 0, pubmed 20 — B's numbers were BYTE-IDENTICAL for LCO and LFP before the fix, proving the tag
had zero influence):

| tag | openalex | semantic_scholar | arxiv | dblp | pubmed |
|---|---|---|---|---|---|
| LCO | 35 (same) | 34 (same) | 34 (same) | 0 (same) | **10 (was 20)** |
| LFP | 35 (same) | 34 (same) | 34 (same) | 0 (same) | 20 (same) |
| solid state | 35 (same) | 34 (same) | 34 (same) | 0 (same) | 20 (same) |

openalex/semantic_scholar/arxiv (MAX_QUERIES=3) show identical totals to B's before-numbers by
coincidence of volume (3 queries' worth of results either way, now for different — tag-anchored —
search text); dblp is the pre-existing, unrelated `SyntaxError: Unexpected token '<'` quirk on
every request (tracked separately, DBLP-BOTWALL). **The meaningful signal is pubmed's LCO count
dropping to 10 while LFP/solid-state stay at 20**: pre-fix, pubmed's 2-query budget was tag-blind
(both tags got the identical generic queries, hence B's identical 20/20); post-fix, pubmed's
2-query budget is now `["LCO", "LCO <fulltext>"]` vs `["LFP", "LFP <fulltext>"]` — genuinely
different, tag-specific searches that return genuinely different volumes. This is independent,
functional proof the reorder is doing real work end to end, not just in `generatedQueries`.

`generatedQueries[0]` confirmed `"LCO"` / `"LFP"` / `"solid state"` respectively in all 3 raw
responses (saved: `<scratchpad>/abbrev-recall-a/resp-{lco,lfp,solidstate}.json`).

### LCO — 10/10 returned (was 0/~120 before this fix)

9/10 genuinely on-topic LiCoO2/lithium-cobalt-oxide battery-materials papers (judged by reading
title + abstract for the literal compound and battery-cathode context), full-strength T1 title or
multi-mention grounding. 1 borderline-on-topic: a paper on LCO leaching into soil causing plant
injury — correct compound, but environmental/agricultural domain rather than battery engineering;
counted on-topic for the tag, noted for domain nuance. **1/10 wrong-sense, shown at full strength
(undemoted, keyword=0.42, rank 6/10):** "Interfacial Catalytic Activation of Li₂C₂O₄ for Efficient
Cathode Prelithiation…" — this paper's OWN abstract coins "LCO" as its private shorthand for
"Li₂C₂O₄" (lithium oxalate, a prelithiation additive: "...NiCo₂O₄@Li₂C₂O₄ prelithiation agent
(NCO@LCO)..."), a different compound from the reader's intended LiCoO2 (lithium cobalt oxide,
cathode material). Not caught by rule (c) because the paper never spells out a rejectable
long-form word-run next to "(LCO)" — it is a joint two-abbreviation coinage ("NCO@LCO"), outside
rule (c)'s narrow, already-ruled scope (ABC-JEV-INTEGRATION.md §1ap AMENDMENT 4 ruling 4). 1/10
genuinely demoted to the bottom (keyword=0.11667, the SENSE_CONTEXT_DEMOTED_GROUNDING=0.25 value
for this tag's termSpecificity=0.7): a genuine LiCoO2-recycling/leaching paper.

### LFP — 10/10 returned (was 0/~120 before this fix)

5/10 clearly on-topic LFP-battery papers (aging/teardown/RUL-prediction/thermal-runaway/
degradation-data), full strength (keyword=0.4667, title match). 2/10 genuinely on-topic
(lithium-recovery-from-spent-LFP-batteries; a China LFP/NMC811 carbon-footprint LCA) but
**demoted to the bottom tier (keyword=0.11667)** — both have no abstract text from their source
(OpenAlex returned title-only), the likely cause: too little text for the context-similarity check
to find a confident battery-domain signal, a plausible false-demote of genuine papers rather than a
wrong-field catch. **3/10 wrong-field, correctly demoted to the very bottom (scores 0.144, 0.108,
0.087 — the 3 lowest of the batch):** "LFP" = Local Field Potential (neuroscience/electrophysiology
— hippocampal recordings, a deep-brain-stimulation implant, morphine place-preference), not Lithium
Iron Phosphate. Demotion here is working as designed: visible but sunk to last.

### solid state — 10/10 returned (unchanged shape from before; ruling's "does not regress from ~10
on-topic")

8/10 clearly on-topic solid-state-battery/electrolyte/materials papers, full strength. **2/10
likely wrong-field, shown at FULL STRENGTH — not demoted, ranked 8th and 9th of 10, ABOVE a
genuine on-topic paper ranked 10th:** "Broadband Quantum Optical Storage with…Eu³⁺ Complex"
(quantum-memory/quant-ph — "solid state" in the condensed-matter-physics sense) and "Thorium-229
as a Phonomagnetometer" (nuclear-physics magnetometry, tagged `cond-mat.mtrl-sci`). Both read by
title+abstract+arXiv category, neither is battery-adjacent. Grounding values (0.6, 0.4667) match
ordinary undemoted T1 tiers (tag-match / 2-abstract-mentions), not the demoted value (0.1667) —
these two were not caught by SENSE-CONTEXT's gate this time.

### Verdict against the ruling's pass bar

**PASS.** "LCO and LFP each return genuine on-topic papers" — both went from 0/~120 to genuine,
correct-compound papers as the clear majority of 10/10 in both batches; "'solid state' does not
regress from ~10 on-topic" — 10/10 returned, 8/10 unambiguously on-topic, consistent with pre-fix
counts (B/earlier reviews also saw ~9-10 of 10 on-topic with occasional physics residuals).

**Scope note (not an ABBREV-RECALL finding):** every wrong-field/false-demote observation above is
a SENSE-CONTEXT-mechanism outcome (keyword.ts/combine.ts, ABC-JEV-INTEGRATION.md §1ap) — `git diff
--stat` (Check 1) confirms this change touches only `profile-compiler.ts` and `pool-cache.ts`;
scoring/demotion code is byte-for-byte untouched by this diff. These are real, live, and directly
relevant to the standing SENSE-CONTEXT tally obligation every future A carries (§1ap point 7: report
demoted-in-top-N and wrong-field-at-full-strength counts; a 2-item threshold authorizes B to revisit
floors) — recorded here as data for the manager, ranked separately below, not scored against this
item's own pass/fail bar.

## Check 7 — Privacy sweep

**PASS.** Grepped every changed/new file for this item (`profile-compiler.ts`/`.test.ts`,
`pool-cache.ts`/`.test.ts`, B's guide, C's checkpoint, this review) for personal strings (the user's name, the Windows profile folder name, the user's email addresses, common mail domains, the GitHub handle) and absolute
Windows/scratchpad paths (`C:\Users`, `/c/Users`, `AppData\Local\Temp`) — **0 matches.** Every
scratchpad reference already uses the required `<scratchpad>/...` placeholder form (B's guide and
this review both do this correctly). Also swept `git diff -- ABC-JEV-INTEGRATION.md` (the
uncommitted portion) the same way — 0 matches. Never opened `web/.env`/`web/.env.local`; no env
value printed anywhere in this review.

---

## Findings (ranked)

**No HIGH or MEDIUM finding against this diff.** The reorder matches the ruling exactly, changes
nothing else, is tested (including a real mutation-verified regression net), passes all 4 gates
at C's reported numbers, and demonstrably fixes live recall for LCO and LFP without regressing
"solid state."

**MEDIUM (informational — for the manager, not a defect in this diff) — today's live pools trip
the standing SENSE-CONTEXT tally threshold.** ABC-JEV-INTEGRATION.md §1ap point 7 commits every
future A to report "(a) demoted items shown in a top N and how many are wrong-field, (b)
wrong-field items shown at full strength... Threshold: 2 confirmed full-strength wrong-field
papers in real top-N pools → B is authorized to revisit the combination/floors." Check 6 above
found, in ONE live "solid state" pool today: 2 full-strength (undemoted) wrong-field papers
ranked 8th/9th of 10, above a genuine on-topic paper ranked 10th ("Broadband Quantum Optical
Storage…Eu³⁺ Complex", quant-ph; "Thorium-229 as a Phonomagnetometer", cond-mat.mtrl-sci) — hits
the pre-set threshold by itself. Also found in "LFP": 1 full-strength wrong-sense hit in LCO
("Li₂C₂O₄" paper using "LCO" as its own different-compound shorthand) and 3/10 "LFP" = Local Field
Potential (neuroscience) items, correctly demoted this time. `git diff --stat` confirms none of
this traces to the ABBREV-RECALL diff (keyword.ts/combine.ts untouched) — ABBREV-RECALL made these
pools visible (they were unreachable at 0 results before the fix) but did not cause the mechanism
that admits or demotes them. Flagged per the existing policy's own reporting obligation, not as a
finding against this item.

**LOW (informational, not a deviation) — `exactSenseQueries` ordered ahead of `topics` per the
ruling could itself crowd out Required tags for dblp/pubmed.** `web/src/lib/feed/senses.ts` has 5
catalog entries, so a profile with 2+ selected senses could fill dblp/pubmed's `MAX_QUERIES=2` cap
with sense queries alone, before any Required tag is considered, for those two sources only — the
same failure shape ABBREV-RECALL just fixed for project text, now possible via senses. This is the
ruling's own specified order (exact-sense first), not something C deviated on, and is not measured
by any existing test or by C's own checkpoint (which only analyzed the separate learned-terms
7-slot cut). Worth a line in the already-queued QUERY-BUDGET follow-up (ruling §1av point 6).

**LOW (informational) — 2 genuine LFP papers were demoted, likely because they have no abstract
text.** "selective recovery of lithium from spent LFP batteries" and a China LFP/NMC811
carbon-footprint LCA both came back from OpenAlex title-only (`abstract: undefined`) and were
demoted to SENSE-CONTEXT's floor score alongside the genuinely wrong-field neuroscience papers —
a plausible false-demote of on-topic papers caused by thin source text, not a wrong-field catch.
Same SENSE-CONTEXT scope note as above; not caused by or fixable within this diff.

---

STATUS: VERIFIED
