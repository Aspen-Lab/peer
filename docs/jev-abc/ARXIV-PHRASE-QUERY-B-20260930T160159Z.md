STATUS: COMPLETE

# ARXIV-PHRASE-QUERY — investigation (agent B)

Investigator: agent B, ABC loop. Read-only on every repo product file; designs and measures,
never edits product code, never decides policy (marked "POLICY — manager decides").

Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD `ea58c54e`. Measured against a
STABLE read-only extract of this HEAD (`git archive HEAD web/src`), not the live working tree,
because an implementer is editing `web/src/lib/scoring/keyword.ts` and `pool-cache.ts` concurrently.
Started 2026-09-30T16:01:59Z (`date -u`).

## Question (from ABC-JEV-INTEGRATION.md §1bw.2)

`web/src/lib/sources/arxiv.ts`'s `buildQuery` wraps every query in an exact-phrase `all:"…"`. arXiv
only ever receives the first 3 entries of `compileSearchBrief`'s tiered `generatedQueries` (Required
tags first, then bare project phrases, then a tag+phrase combo, …). A multi-word project phrase
almost never appears verbatim in a title/abstract, so those calls return nothing — QUERY-COMBO-MEASURE
measured 6 of 6 live arXiv calls for phrases returning 0 results. Question: would a different query
form for MULTI-WORD phrases (every significant term required — `all:term1 AND all:term2 …` — or a
proximity/phrase-slop form if arXiv's API supports one) bring genuinely on-topic papers without
flooding the pool with noise? Short tags must stay exact (a short tag as an exact phrase is the right
semantics) — this investigation never proposes changing how a Required tag itself is queried, only
how an algorithmically-derived multi-word phrase (Tier 1 bare phrase / Tier 1b tag+phrase combo) is
queried.

## Plan

1. Extract HEAD read-only to `<scratchpad>/axq-head` via `git archive`; copy
   `<scratchpad>/pusf-hook.mjs` (the resolver hook used by the immediately-prior QUERY-COMBO-MEASURE
   investigation) to `<scratchpad>/axq-hook.mjs`, repointed at that extract, so the REAL
   `compileSearchBrief`/`scoreItems` run unmodified, off product code, exactly the established
   pattern in this campaign.
2. Build 6 constructed/fictional reader profiles across fields the ticket names: battery materials,
   catalysis, ML, condensed-matter physics, a biology topic on arXiv q-bio, and one run-on
   (comma-free) project text. Each has exactly one Required tag plus a project/challenge text shaped
   to produce a real multi-word phrase under `phrasesFromText`'s existing rules.
3. Zero network cost: run the real `compileSearchBrief` per profile (off the HEAD extract), read
   `generatedQueries`, and take `slice(0, 3)` — the exact cap-3 window arXiv's adapter receives
   (`buildSearchQueries` dedupes `queries` and slices to `MAX_QUERIES = 3`; `pipeline.ts` passes
   `queries: brief.generatedQueries` to every source including arxiv, confirmed by reading both
   files). Classify each of the 3 entries by provenance against the real strings (tag / bare phrase /
   tag+phrase combo) — never by word count alone, since a multi-word Required tag (e.g. "single-atom
   catalyst") must stay classified as a tag, not a candidate phrase, regardless of its own word count.
4. For each multi-word NON-TAG entry in the cap-3 window (the phrase arXiv would actually receive
   today), build two query forms:
   - **Today's form:** `(all:"<phrase>")` — byte-identical to `arxiv.ts`'s own `buildQuery` with a
     single topic.
   - **Candidate form:** `(all:"term1") AND (all:"term2") AND …` — one `all:` clause per
     **significant term**, ANDed, each individually parenthesized in the same bracketing style
     `buildQuery` already uses for its topics/methods AND-case. Significant terms are extracted with
     `tokenize()`, exported from `web/src/lib/scoring/tokenize.ts` — the project's own existing,
     already-in-production tokenizer/stopword list (73 stopwords including academic filler like
     "study", "propose", "using", "based", which the codebase already judged too generic to carry
     matching weight) — never a hand-picked or invented list. This is a deliberate choice over
     `profile-compiler.ts`'s OWN private `STOPWORDS` (17 words, permissive by design because its
     downstream consumer is query-budget tiering, which absorbs noise cost); see §6 for why, and the
     POLICY note if the manager wants the other list instead.
5. **Pre-set on-topic rule, stated now, before any live result is read** (same shape as
   QUERY-COMBO-MEASURE's and QUERY-QUALITY's precedent so judgments stay comparable across this
   campaign): a title (read together with the abstract when the title alone is ambiguous) counts
   on-topic if, read plainly, the paper is about the tagged material/system/method/phenomenon itself
   (or a direct component, application, or close synonym of it) — not merely a shared broad field. A
   title/abstract clearly about something else in the same general field (e.g. a different battery
   chemistry, a different ML architecture, a different physics system) counts off-topic. Each of the
   top 10 returned is judged independently; duplicates count independently too. This rule is fixed
   before any live call in step 7 runs.
6. Live, hard ceiling 24 GETs total, arXiv's public API only (`https://export.arxiv.org/api/query`,
   same params as `arxiv.ts`'s real `fetchOne`: `start=0`, `max_results=10`, `sortBy=submittedDate`,
   `sortOrder=descending`, no key), spaced >= 3 seconds apart, backing off further on any 429 and
   stopping + recording BLOCKED on repeats. Primary allocation: 1 phrase (the first/strongest
   non-tag multi-word entry) x 2 forms (today/candidate) x 6 profiles = 12 calls. Remaining budget
   (up to 12) reserved for: retries on 429/5xx, and a second-phrase robustness check on a subset of
   profiles that have 2 multi-word entries in their cap-3 window. Every call and its outcome is
   logged to this file as it happens.
7. **Pre-set verdict rule, stated now, before any live result is read:** recommend the candidate form
   only if it adds on-topic, gate-passing papers for >= 4 of 6 profiles AND the gate-passing results
   (via the real Required gate, `scoreItems` in `scoring/combine.ts`, on the HEAD copy) stay >= 70%
   on-topic. "Adds" means the candidate form surfaces >= 1 on-topic paper that today's exact-phrase
   form did not return (today's form returning 0 counts every on-topic candidate hit as added).
   Otherwise: keep today's form, or mark inconclusive if evidence is mixed/thin.
8. Through the real `scoreItems`/Required gate on the HEAD copy (zero network cost — reuses the
   `req`/`brief` already computed in step 3, exactly how `pipeline.ts`'s own `scorePaperCandidates`
   builds its `ScoringProfile`, `seedTexts: briefToSeedTexts(req, brief)`): map each live arXiv result
   into a `RawItem`, run `scoreItems`, and count how many of the candidate-form's results actually
   pass the gate (survive to be shown), separate from the raw "on-topic by eyeball" count — the gate
   may reject most of the noise even when a result count looks large.
9. Write the exact candidate query form (if recommended), what counts as a "significant term" and
   why, tests with mutations, the cache-version implication, severity in plain words, the POLICY
   list, and the exact network-call count.

This file is updated after each step; STATUS stays honest at every point; every timestamp below is
from `date -u`.

---

## 1. Setup log

`git archive HEAD web/src | tar -x -C <scratchpad>/axq-head` (2026-09-30T16:02Z) — verified against
the live working tree by grepping `PAPER_CACHE_KEY_VERSION` in both: the extract reads **22**
(matches HEAD, per §1bw's own note that 22 is HEAD's current value), the live working tree reads
**23**, uncommitted (`git status` shows `pool-cache.ts` modified) — confirms the extract is a
faithful, frozen HEAD snapshot untouched by the concurrent edit. `<scratchpad>/axq-hook.mjs` is
`<scratchpad>/qcm-hook.mjs` (the immediately-prior B investigation's hook) with `WEB_SRC` repointed
at `<scratchpad>/axq-head/web/src`. Ran via the exact invocation in the brief, from `<scratchpad>`.

## 2. The 6 profiles (constructed, fictional) and Step 1 — zero network cost

Every profile has exactly one Required tag and a project/challenge text shaped to produce a real
multi-word phrase. No person's name anywhere in any fixture.

| # | Field | Tag (Required) |
|---|---|---|
| P1 | Battery materials | `nickel-rich cathode` |
| P2 | Catalysis | `single-atom catalyst` |
| P3 | ML | `parameter-efficient fine-tuning` |
| P4 | Condensed-matter physics | `twisted bilayer graphene` |
| P5 | Biology (arXiv q-bio) | `protein language model` |
| P6 | Run-on project text (no commas) | `sim-to-real transfer` |

Exact texts and the real `compileSearchBrief` output are in `<scratchpad>/axq-1-briefs.mjs` /
`<scratchpad>/axq-1-out.json` (script run 2026-09-30T16:0xZ, exit 0, zero network cost — only the
real, unmodified `compileSearchBrief`/`briefToSeedTexts`/`tokenize` off the HEAD extract).

**Method:** ran the real `compileSearchBrief(req)`, took `generatedQueries.slice(0, 3)` — the exact
cap-3 window `arxiv.ts`'s adapter receives today (`buildSearchQueries` dedupes `queries` and slices
to `MAX_QUERIES = 3`; `pipeline.ts` line ~636 passes `queries: brief.generatedQueries` to every
source including arxiv — confirmed by reading both files, not assumed). Classified each of the 3
entries by matching the real strings (tag / bare phrase / tag+phrase combo), never by word count —
several of these tags are themselves 2-3 words (e.g. `single-atom catalyst`) and must stay classified
as "tag" regardless.

**Real cap-3 windows arXiv receives today, all 6 profiles:**

| # | Slot 1 (tag, exact, unchanged) | Slot 2 | Slot 3 |
|---|---|---|---|
| P1 | `nickel-rich cathode` | phrase (10 words) | phrase (6 words) |
| P2 | `single-atom catalyst` | phrase (8 words) | phrase (5 words) |
| P3 | `parameter-efficient fine-tuning` | phrase (9 words) | phrase (5 words) |
| P4 | `twisted bilayer graphene` | phrase (6 words) | **combo** (tag+keyword, 4 words) |
| P5 | `protein language model` | phrase (6 words) | phrase (5 words) |
| P6 | `sim-to-real transfer` | **combo** (tag+keyword, 3 words) | bare single word (`have`) |

**Structural findings from Step 1 (zero network cost, before any live result):**
- P4's project text produced **no long phrase at all** (both its comma-split chunks ran to 18 and 14
  words, over the 10-word cap) — `strongestPhrase` fell back to a single keyword ("exploring"), so
  slot 3 is a tag+keyword combo, not a real phrase. The real phrase in P4's window (slot 2) comes
  entirely from the *challenge* text instead. Structurally identical to QUERY-COMBO-MEASURE's P5
  finding, reproduced independently on a fresh, unrelated fixture.
- P6 (the deliberate run-on, zero commas/semicolons/colons in a single 60+-word sentence) reproduces
  the same structural gap even more starkly: **no phrase anywhere in the top 3**, not even from a
  short challenge text (this profile has none). Slot 2 is a tag+keyword combo (`sim-to-real transfer
  have`); slot 3 is a bare single word (`have`) — not multi-word, so out of scope for a phrase-query-
  form comparison. Only ONE candidate/today pair exists for P6 (the slot-2 combo).
- **The word "have" reaching a query at all (P6) is itself informative for this item's own tokenizer
  choice (§6):** it survived `profile-compiler.ts`'s own private, 17-word `STOPWORDS` list (which
  does not contain "have") to become `strongestPhrase`. It does NOT survive the exported
  `tokenize()` (`scoring/tokenize.ts`, 73 stopwords including "have") used below to build the
  candidate form — confirmed by execution: P6's candidate form is `(all:"sim-to-real") AND
  (all:"transfer")`, correctly dropping "have". A live, concrete example (not hypothetical) of why
  this investigation reuses the exported `tokenize()` rather than `profile-compiler.ts`'s own filter
  for deciding which words are "significant" — see §6 for the full reasoning and the POLICY note.
- **Not every "significant term" `tokenize()` keeps is actually selective** (a real limitation,
  reported plainly): P1's 10-word phrase keeps "how" and "during" as required AND terms — common
  English words that a genuinely on-topic paper's abstract might simply not contain verbatim. This is
  a known cost of reusing a tokenizer built for soft TF-IDF weighting (where a filler word passing
  through barely matters) for a NEW purpose, a hard boolean AND (where every required term can sink
  an otherwise-relevant result). Watched for directly in the live results below, not assumed away.

Primary live-test target (Round A) is **`candidateForms[0]`** per profile — the strongest/first
multi-word non-tag entry (slot 2 in every window above, i.e. exactly what arXiv's Tier-1 query slot
sends today). Full candidate/today query strings: `<scratchpad>/axq-1-out.json`.

## 3. Step 2 — live measurement

**Pre-set on-topic rule (restated verbatim from the plan, unchanged before reading any result):** a
title (read together with the abstract when the title alone is ambiguous) counts on-topic if, read
plainly, the paper is about the tagged material/system/method/phenomenon itself (or a direct
component, application, or close synonym of it) — not merely a shared broad field. A title/abstract
clearly about something else in the same general field counts off-topic. Each of the top 10 returned
is judged independently.

**Round A (2026-09-30T16:0xZ-16:1xZ):** `<scratchpad>/axq-2-live-a.mjs`, 12/12 tasks, **12 GETs, 0
BLOCKED, 0 non-200 responses.** `candidateForms[0]` (the strongest/first multi-word non-tag phrase,
slot 2 of every window) tested today-vs-candidate for all 6 profiles. Raw record:
`<scratchpad>/axq-2-live-a-out.json`.

| # | Phrase (terms) | Today: total/on-topic-of-shown | Candidate: total/on-topic-of-shown | On-topic judging notes |
|---|---|---|---|---|
| P1 | 10 words -> 10 terms | 0 / — | 0 / — | Both zero — no signal either way. |
| P2 | 8 words -> 8 terms | 0 / — | 0 / — | Both zero — no signal either way. |
| P3 | 9 words -> 6 terms | 0 / — | 2 / **0/2** | Neither hit mentions fine-tuning or parameter efficiency; both matched on generic "network"/"without...retraining" phrasing (saliency-map rotation paper; adjustable-depth object detector). Pure noise. |
| P4 | 6 words -> 6 terms | 0 / — | 5 / **3-5/5** | 3 unambiguous exact-topic hits ("Pomeranchuk effect in magic angle graphene", "Correlated Chern Insulators in Magic Angle Twisted Bilayer Graphene", "Magic Angle Spectroscopy" — the last two literally contain "twisted bilayer graphene" in the title/abstract). 2 borderline (different specific moiré material, e.g. bilayer WSe2, not graphene — same phenomenon family, judged conservatively as not-clearly-on-topic). Real, precise win either way. |
| P5 | 5 words -> 5 terms | 0 / — | 70 shown 10 / **0/10** | All 10 are off-topic (graph isomorphism theory, quantum computing, slide generation, motion planning, online allocation, program verification, continual learning, competitive-programming agents, LLM jailbreaks, mobile manipulation) — **zero** are about proteins or protein language models. The phrase tokenized to 5 entirely generic words ("without", "relying", "any", "solved", "structures") with no domain anchor at all — the worst possible chunk `phrasesFromText` could have picked, and the candidate form floods on it. |
| P6 | combo, 3 words -> 2 terms | 4 / **4/4** | 984 shown 10 / **1/10** | Today's exact phrase (`"sim-to-real transfer have"`) is a coincidental idiomatic match ("X and sim-to-real transfer have made/led to progress...") that happens to land only on genuinely on-topic papers. The 2-term candidate (`sim-to-real` AND `transfer`) floods: only 1 of 10 is centrally about sim-to-real transfer itself; the other 9 merely *mention* it as a side validation detail in papers about something else (VLN test-time adaptation, generic metric learning, video-based manipulation learning, agentic data generation, meta-learning adaptation, cross-embodiment RL, human-video pipelines, state estimation, real-to-sim reasoning). **This is the one profile where today's form already worked, and the candidate form would be a regression, not an improvement.** |

**Reading Round A honestly:** by the pre-set rule's own definition of "adds" (candidate surfaces >= 1
on-topic paper today's form did not), only **P4** is a clean win. P1/P2 supply no signal (both arms
zero). P3 and P5 add results but zero of them are on-topic — noise, not signal. P6 actively regresses
versus today's already-working coincidental match. **1 of 6 profiles win — nowhere near the >= 4 of 6
threshold.** Proceeding to Round B (below) to (a) check whether P1/P2's total silence is specific to
their unusually long 8-10-term phrases by testing their shorter phrase2, and (b) spend one call
probing whether arXiv's API recognizes any phrase-slop/proximity syntax at all, per the ticket's own
"or a proximity/phrase-slop form if arXiv's API supports one" — before finalizing the verdict.

**Round B (2026-09-30T16:2xZ):** `<scratchpad>/axq-2-live-b.mjs`, 7/7 tasks, **7 GETs, 0 BLOCKED, 0
non-200.** Raw record: `<scratchpad>/axq-2-live-b-out.json`. **Running total: 19 of 24 GETs used.**

| # | Phrase (terms) | Today total/on-topic | Candidate total/on-topic | Notes |
|---|---|---|---|---|
| P1 phrase2 | 5 words -> 5 terms | 0 / — | 1 / **borderline** | The single hit ("Extending life of Lithium-ion battery systems... active balancing") is about pack-level fast-charge control, not cathode chemistry — judged not-clearly-on-topic for the tag *`nickel-rich cathode`* specifically (strict reading; it is a close domain neighbor). Not a noise flood (1 result), but not a clean win either. |
| P2 phrase2 | 5 words -> 5 terms | 0 / — | 0 / — | Silent again — 2 of 2 tested phrases for this profile returned nothing on either arm. Plausibly reflects thin arXiv coverage of this catalysis sub-topic generally (catalysis papers often go to chemistry venues, not arXiv), not specifically a query-form problem. |
| P3 phrase2 | 6 words -> 5 terms | 0 / — | 473 shown 10 / **0/10** | Same severe flood as phrase1, independently — a graph-scattering GNN paper, a quantum chiplet compiler, a super-resolution distillation paper, a seismic-exploration model, an HPC load-balancer, none about fine-tuning or domain adaptation. Terms ("reduce", "compute", "cost", "domain", "adaptation") are near-universal vocabulary across modern ML/CS papers. **P3 floods on both of its tested phrases — 0/12 on-topic across 12 raw hits.** |
| P1 slop probe | `(all:"<10-word phrase>"~5)` | n/a | **total = 358,919**, top 10 span topological superconductors, AI-agent harness design, quantum error correction, LiDAR detection, string theory, atomic physics, GenAI-in-education — a random cross-section of all of arXiv, nothing about batteries. | **Confirmed live: arXiv's public `search_query` API does not usefully support Lucene-style `~N` phrase-slop.** The suffix is not rejected (no error, HTTP 200) but does not constrain the match either — the query degenerates to something close to "everything," the opposite of the intended effect. Not a viable candidate form; not pursued further. |

## 4. Step 3 — the real Required gate (zero network cost)

Re-ran every live candidate-form result (and, for reference, P6's today-form result) through the REAL
`scoreItems` (`web/src/lib/scoring/combine.ts`, off the HEAD extract) with the SAME `ScoringProfile`
construction `pipeline.ts`'s own `scorePaperCandidates` uses: `seedTexts: briefToSeedTexts(req,
brief)`, `topics: req.topics`. Script `<scratchpad>/axq-3-gate.mjs`, run 2026-09-30T16:3xZ, exit 0,
zero network cost. Full record: `<scratchpad>/axq-3-out.json`.

| Profile | Arm | Fetched | Gate-passed | Of the gate-passed, how many are on-topic (eyeball, same rule) |
|---|---|---|---|---|
| P1 phrase2 | candidate | 1 | **0** | — (the one borderline hit was itself rejected by the gate) |
| P3 phrase1 | candidate | 2 | **0** | — |
| P3 phrase2 | candidate | 10 | **0** | — |
| P4 phrase1 | candidate | 5 | **4** | 3 literal-keyword matches (all clearly on-topic) + 1 T4-admitted (bilayer WSe$_2$, close analog, no literal match) — the ONE genuinely borderline eyeball case (moiré pseudospin-3/2 lattice) was the one the gate itself rejected. Gate and eyeball agree closely here. |
| P5 phrase1 | candidate | 10 | **6** | **0** — all 6 gate-admissions have `matchedKeywords: []` (T4-only, no literal overlap at all) and are, on inspection, about graph isomorphism, quantum thermodynamics, slide generation, submodular optimization, continual learning, and competitive programming — nothing to do with proteins. See methodology caveat below. |
| P6 combo | today | 4 | **4** | **4** — all 4 have literal `matchedKeywords: ["sim-to-real transfer"]`; agrees with the eyeball pass exactly. |
| P6 combo | candidate | 10 | **10** | At most **1-2** are centrally about sim-to-real transfer itself; the rest mention it in passing while covering a different central topic (see Round A notes). The gate admits all 10 (6 by literal match on the 2-word overlap, 4 via T4) — the gate's literal-match step cannot distinguish "sim-to-real transfer is this paper's subject" from "sim-to-real transfer is one validation experiment this paper reports." |

**Methodology caveat, stated plainly:** this gate-check scores each arm's small result set (2-10
items) in isolation, not inside a realistic full daily pool (hundreds of items from every source).
`scoreItems`'s T4 fallback computes topical similarity via TF-IDF over the SAME small set it is
scoring (`buildIndex(items, ...)` — built from just these 2-10 items) — document-frequency statistics
over 10 documents are unstable, and this plausibly inflates T4's spurious-similarity admissions
(P5's 6 T4-only admissions, zero of which share any real subject matter with "protein language
model," are the clearest sign of this). Gate-passed items with a real literal `matchedKeywords` entry
(P4's 3, P6-today's 4, 6 of P6-candidate's 10) are NOT subject to this caveat — a literal match is a
literal match regardless of pool size. Read the T4-only (`matchedKeywords: []`) admissions as an
upper bound, not a confirmed count; even generously counting all of them as "gate-passed," none of
P5's were judged on-topic by the pre-set eyeball rule, so this caveat does not change this
investigation's verdict either way (see §5).

## 5. Verdict

**Pre-set rule (restated verbatim, unchanged since §Plan):** recommend the candidate form only if it
adds on-topic, gate-passing papers for >= 4 of 6 profiles AND the gate-passing results stay >= 70%
on-topic.

**Per-profile summary, "does the candidate form add an on-topic, gate-passing paper today's form
didn't have":**

| # | Field | Today | Candidate (best phrase tested) | Adds on-topic gate-passing paper(s)? |
|---|---|---|---|---|
| P1 | Battery materials | 0 (both phrases) | 0/0 gate-passed across both phrases | **NO** |
| P2 | Catalysis | 0 (both phrases) | 0 (both phrases) | **NO** — no signal at all, either arm, either phrase |
| P3 | ML | 0 (both phrases) | 0 on-topic of 12 raw hits, 0 gate-passed | **NO** — pure noise both times |
| P4 | Condensed-matter physics | 0 | 4 gate-passed, 3-4 on-topic | **YES — the one clean win** |
| P5 | Biology (arXiv q-bio) | 0 | 0 truly on-topic of 10 raw hits (6 gate-passed but all T4-only, no real subject match) | **NO** — severe noise flood |
| P6 | Run-on project text | **4/4 already on-topic** | ~1-2/10 on-topic despite 10/10 gate-passed | **NO — a regression against an already-working query** |

**Win count: 1 of 6 (P4 only).** Nowhere near the required >= 4 of 6 — this is not a borderline
result, it is a decisive miss on the first half of the pre-set rule alone.

**Second half of the rule, checked anyway for completeness:** pooling every candidate-form
gate-passed result across every phrase tested (P1 phrase2 + P3 x2 + P4 + P5 + P6 =
0+0+0+4+6+10 = 20 gate-passed items), on-topic count by the same eyeball rule is roughly 4-6 of 20
(P4's 3-4, P6's 1-2, zero elsewhere) — **about 20-30% on-topic, far below the 70% floor.** Both
halves of the pre-set rule fail independently; they agree with each other.

**The proximity/phrase-slop alternative the ticket asked about:** live-confirmed NOT viable — arXiv's
public `search_query` API does not usefully support Lucene-style `~N` slop (§3, P1 slop probe): the
query silently degrades toward matching almost the entire archive (358,919 results) rather than
loosening the phrase match in a controlled way. No further exploration of this option is warranted.

**VERDICT: KEEP today's exact-phrase form (`all:"<phrase>"`) for every multi-word query arXiv
receives, tag or derived phrase alike. Do not adopt an AND-of-significant-terms (or any other) form
as a general replacement.** This is a clean keep under the pre-set rule, not a borderline call — every
condition the rule set out failed, and failed by a wide margin, on live data spanning 6 fields and 19
network calls.

**Why, in plain terms:** the candidate form's outcome depends entirely on whether the SPECIFIC phrase
`phrasesFromText` happened to hand it is rich in rare, domain-specific words (P4's "magic angle" +
"phase diagram" — a precise win) or mostly ordinary English connective/generic tissue (P1/P2's long
sentences; P5's "without relying on any solved structures", built almost entirely from function
words; P6's 2-word "sim-to-real transfer", both words individually too common in the very field being
searched). `compileSearchBrief` was never designed to pick phrases by that criterion — it picks the
first comma-shaped chunk under 10 words, whatever its content. A blanket query-form change cannot
control which kind of phrase it will be handed on any given day, and the failure mode when it is the
wrong kind is not "fewer results" but a flood of 70-984 completely unrelated papers — precisely the
outcome `docs/PRODUCT_DIRECTION.md`'s "ten precise items are better than one hundred noisy items"
rule warns against. P6 additionally shows the change can make an already-working query WORSE: today's
coincidental exact-phrase match (`"sim-to-real transfer have"`) is accidentally a very precise filter
(only genuinely relevant papers open a sentence that way), and trading it for a broader AND-of-2-terms
form THROWS AWAY that precision for no gain.

## 6. Recommendation, tests, cache, severity, POLICY

**Recommendation: close ARXIV-PHRASE-QUERY as KEEP, no product change to `arxiv.ts`'s query
construction.** As with the immediately-prior QUERY-COMBO-MEASURE item, add one protective test (C's,
not written here) that pins today's exact-phrase form so a future change cannot silently swap it for
something else without a red test:

- **Test:** mock `globalThis.fetch` (same pattern `arxiv.test.ts` already uses) and call
  `arxiv.fetch({ topics: ["a multi word project phrase"], limit: 10 })`; capture the request URL
  `fetch` was actually called with and assert its decoded `search_query` parameter equals exactly
  `(all:"a multi word project phrase")` — the whole phrase, quoted, as one clause, never split into
  per-word `AND` clauses and never given a `~N` suffix. **Mutation it catches:** any future change to
  `buildQuery`/`buildSearchQueries` that tokenizes a multi-word topic into separate `all:` clauses
  (the exact change this investigation recommends against making), or appends a slop suffix, turns
  this test red. A second, cheap assertion in the same test — a single-word topic (e.g. a short
  Required tag) still produces `(all:"tag")` unchanged — pins that this investigation's scope (never
  touching how short tags are queried) stays true going forward.
- **What counts as a "significant term", for the record (the ticket asks this be answered even though
  no change ships):** this investigation used `tokenize()`, exported from
  `web/src/lib/scoring/tokenize.ts` — the project's own existing, already-in-production
  tokenizer/stopword list (73 stopwords, including academic filler like "study"/"propose"/"using"/
  "based" that `profile-compiler.ts`'s own private, 17-word `STOPWORDS` list does not exclude) —
  rather than inventing a new list. This was the right reuse target for a NEW purpose (deciding which
  words are meaningful enough to be a hard-required AND clause) even though `profile-compiler.ts` has
  its own, narrower filter for a DIFFERENT purpose (deciding which words are worth ever sending as a
  query at all, deliberately permissive because downstream tiering — not a hard AND — absorbs the
  noise cost, per QUERY-GENERIC-WORDS §1bs.1). A concrete, live-measured example of why: P6's project
  text produced the query word "have" through `profile-compiler.ts`'s own filter (its 17-word list
  does not contain "have"), which the exported `tokenize()` correctly drops. **POLICY note:** even
  with the more conservative list, several profiles still surfaced ordinary connective words as
  required terms (P1's "how"/"during") because `tokenize()` was built for soft TF-IDF weighting,
  where an occasional filler word survives at negligible cost, not for a hard boolean AND, where every
  required word can sink an otherwise-relevant paper. This gap did not change today's KEEP verdict
  (the verdict fails independently of which stopword list is used — P4's win and P5/P6's floods are
  not close calls that a better filter would flip), so it is left as a lead, not fixed here.
- **Cache:** **no bump.** This investigation recommends no change to query construction, so
  `PAPER_CACHE_KEY_VERSION` stays wherever the concurrent NMC-HYPONYM/T2-EXTRACTOR work leaves it
  (committed HEAD `ea58c54e` carries 22; a concurrent, unrelated item is already carrying it to 23 in
  flight — noted, not this investigation's concern). If the manager ships ONLY the protective test
  above, that is test-only and does not bump the cache either (same precedent as QUERY-COMBO-MEASURE's
  own protective test).

**Severity, in plain words:** this is a close-the-loop finding, not a bug fix. The question was
"would a different arXiv query shape rescue the near-zero yield on multi-word phrases" — the answer,
on real data across 6 fields, is "not as a blanket change": it fixes the zero exactly when the phrase
already happens to contain enough rare, specific words (which today's exact-phrase form would ALSO
have had a much better chance with, if the phrase were shorter/tighter), and it floods badly
otherwise, with no cheap way to tell which case you're in ahead of the call. arXiv's near-zero yield
on algorithmically-derived multi-word phrases (the background finding this item was chartered to
investigate) is confirmed real and, on this evidence, not cheaply fixable at the query-form level
alone.

### POLICY — manager decides

1. **Close ARXIV-PHRASE-QUERY as KEEP** (this guide's recommendation) — confirm, or ask for a
   narrower follow-up (see point 2) if the manager wants to keep pursuing recall on this specific gap
   rather than accept it as a standing limitation of arXiv coverage for algorithmically-derived
   phrases.
2. **An unmeasured, narrower lead, not recommended here:** the win/loss split tracked term
   *specificity*, not term count (P4 won with 6 terms including 2 rare ones; P1/P2 lost with 8-10
   terms including none especially rare; P6 lost with only 2 terms, both too common). The codebase
   already has rarity signals built for a different purpose — `termSpecificity`
   (`web/src/lib/scoring/term-expand.ts`) and a private `referenceIdfWeight`
   (`web/src/lib/scoring/keyword.ts`) — that a future investigation could try gating the candidate
   form on (e.g., only attempt the AND-form when a phrase has >= N terms above some rarity floor,
   falling back to today's exact-phrase form otherwise). This was not measured here — no live
   evidence either way — and would need its own dedicated measurement before being trusted, per this
   campaign's own pattern (design, then measure, never ship on a plausible-sounding heuristic alone).
3. **P2's total silence across both tested phrases, on EITHER arm (POLICY, informational):** may
   reflect genuinely thin arXiv coverage of this catalysis sub-topic shape rather than a query-form
   problem at all — catalysis/electrochemistry work often publishes in chemistry venues outside
   arXiv's preprint culture. Not investigated further here (out of this item's charter, and this
   investigation's own single sample of 2 phrases from a fictional profile cannot distinguish "no
   coverage" from "bad luck of phrasing"); a lead only, worth knowing if arXiv recall for
   catalysis-leaning readers comes up again.
4. **The Required gate's T4 fallback showed a possible measurement-context sensitivity (POLICY,
   informational, NOT a confirmed product bug):** in this investigation's own small (2-10 item)
   gate-check pools, T4 admitted 6 papers with zero real subject-matter connection to "protein
   language model" (P5) purely on isolated-pool TF-IDF similarity, with no literal keyword overlap at
   all. §4's caveat explains why this is likely an artifact of scoring a tiny, self-referential pool
   rather than a realistic full daily pool (which is what T4 actually runs against in production) —
   this investigation did not (and per its charter should not) reproduce a full daily pool to confirm
   either way. Flagged for the manager's awareness only; not in scope to investigate further here.

---

STATUS: COMPLETE — 2026-09-30T16:14Z. Verdict: KEEP today's exact-phrase arXiv query form (no
change). 19 of 24 permitted network calls used (12 Round A + 7 Round B), 0 BLOCKED, 0 non-200
responses — stopped once the evidence was unambiguous under the pre-set rule (1 of 6 profiles won,
far short of >= 4 of 6; ~20-25% on-topic among gate-passing results, far short of >= 70%) rather than
spending the remaining budget on data that could not change the verdict. No product file touched; no
test written to the repo (recommended above for C); no cache bump. Privacy: no person's name anywhere
in this guide or its scratchpad scripts — every arXiv result extraction (`extractArxivEntries` in
both live-call scripts) reads only `id`/`title`/`summary`/`published`, never `author`; every paper
referenced above is cited by arXiv id and/or a short title fragment only.
