# QUERY-GENERIC-WORDS — B investigation

STATUS: COMPLETE (2026-09-30T09:28:47Z)
Started: 2026-09-30T09:08:11Z (UTC, `date -u`)
Role: B (investigator). Read-only on every repo product file. No network. No commit/push/stash/checkout/worktree/branch. No vitest/tsc/eslint/build. No file under `web/`.

## 0. Scope, source, and method (read this before the tables below)

Item born at ABC-JEV-INTEGRATION.md §1bg point 9: a single generic word from the
reader's Project / Challenge text (e.g. "research", "focused") becomes its own
entry in `profile-compiler.ts`'s `phrasesFromText` single-word (keyword) tier,
which feeds both the paper-source queries (`pipeline.ts`) and the seed texts
behind the context check (`keyword.ts`). Lead (not a decision, per the item's
own wording): the same reference-table document-frequency cut already used on
the context check's overlap axis (`SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE
= 10`, `reference-idf.json`) might apply to this tier too. New observation
carried into this brief: a year ("2024") and a unit ("500Wh/kg") also become
keyword queries in plain English text — this guide checks that.

**Stability of the measurement.** Two files this investigation reads
(`web/src/lib/feed/profile-compiler.ts`, `web/src/lib/scoring/term-expand.ts`)
are being mutation-tested live in this same checkout by another agent, so the
working tree can show either file in a temporarily-mutated state at any
moment. Per this item's own instructions, every measurement below runs
against a READ-ONLY extraction of HEAD (`490d67b3`), never the live checkout:

```
git archive HEAD web/src | tar -x -C <scratchpad>/qgw-head
```

A resolver hook (`<scratchpad>/qgw-hook.mjs`, copied from an earlier
investigation's `<scratchpad>/pusf-hook.mjs` and repointed at the extracted
copy) lets Node's native TS loader follow this repo's `@/` alias and
extensionless imports against that extracted copy only, so the whole import
graph (`profile-compiler.ts` → `senses.ts`, `intent.ts`,
`@/lib/preferences/ledger`; `keyword.ts` → `term-expand.ts`, `tokenize.ts`,
`reference-idf.json`, `@/lib/feed/senses`) resolves to HEAD files exclusively.
Confirmed by `git status` at the start of this investigation that
`profile-compiler.ts` and `term-expand.ts` are indeed dirty in the live tree
right now (so this precaution is not theoretical), while `pipeline.ts` and
`keyword.ts` are currently clean — HEAD is used uniformly anyway, for one
internally-consistent snapshot.

**This item's fix is English-only per the manager's own framing** ("for
English text HEAD is the right baseline"). The separate NON-ASCII-TEXT item
(§1bo, in progress elsewhere in this session) is fixing non-ASCII handling in
the same functions; nothing here depends on its outcome, and nothing here
should be read as covering CJK/accented text.

**Architecture established by reading before executing anything** (so the
questions below can cite line numbers instead of re-deriving this each time):

- `phrasesFromText(text, max)` (profile-compiler.ts :104-133) returns
  `cleanList([...longPhrases, ...keywords]).slice(0, max)`. `longPhrases` are
  chunks split on `. , ; : \n` or `" - "`, trimmed, length ≥ 4 chars, word
  count ≤ 10, capped to `ceil(max/2)`. `keywords` are EVERY token of the
  **whole original text** (not just leftover text) — lowercased, non-
  `[a-z0-9+\-/.\s]` characters blanked (so digits, `+ - / .` survive inside a
  token), split on whitespace, kept when length ≥ 4 and not in the 17-word
  `STOPWORDS` set (about/after/against/also/and/are/between/from/into/
  that/the/their/this/through/using/with/without) — deduped, capped to `max`.
  Only `STOPWORDS` gates this tier; the separate, smaller `GENERIC_TERMS` list
  in `term-expand.ts` (materials/energy/transport/modelling/simulation/
  interface/design/analysis/systems/data/characterization — 11 words, used
  only for match-gating/specificity, never consulted here) does **not**
  filter query or seed-text generation at all. That gap is one plain
  candidate explanation for why "materials" (a `GENERIC_TERMS` member) still
  reaches `generatedQueries` today, confirmed below by execution.
- Callers: `projectQueries` calls `phrasesFromText(project, 5)` and
  `phrasesFromText(challenge, 5)` (plus per-seed-text calls); `activeQuestions`
  (in `compileSearchBrief`) calls `phrasesFromText(challenge, 8)` and
  `phrasesFromText(seedTexts.join(". "), 8)` **directly, with no tier
  reordering** — this is the cleanest existing probe for "every single-word
  entry the tier produces" (Q1), and is what this guide uses.
- The already-shipped QUERY-QUALITY (§1ay) and QUERY-BUDGET (§1az) fixes are
  live at HEAD: a project/challenge text over 6 words is never itself a
  literal query (`literalQueryIfShort`, `MAX_LITERAL_QUERY_WORDS = 6`);
  `phrasesFromText` splits on commas too; and `projectQueries` builds
  `baseQueries` in explicit tiers — Tier 0 topics + exact-sense queries,
  Tier 1 bare phrases, Tier 1b one `${tag} ${strongestPhrase}` combo per tag,
  **Tier 2 bare single-word `projectTerms` entries (where a bare generic word
  or a bare number/unit token lives today)**, Tier 3 the remaining
  topic+method / topic+term combinations (:153-234). This item's job is
  entirely about what populates Tier 2 and about `activeQuestions`/seed
  texts — it does not touch the tier order itself.
- `brief.generatedQueries` (after `compileSearchBrief`'s own
  `.slice(0, learned.length ? 7 : 15)` plus any learned terms) is handed to
  **every one of the five paper sources unchanged** (`pipeline.ts` :636,
  :1284: `queries: brief.generatedQueries`); each source's own
  `buildSearchQueries` dedupes and slices to ITS OWN cap from the FRONT of
  that same shared, ordered list: openalex/arxiv/semantic-scholar cap = 3
  (fixed); dblp/pubmed cap = `effectiveQueryCap(topics.length)` = 2 for 0-2
  Required tags, rising to at most 5. Position in `generatedQueries` is
  therefore exactly what determines whether a given entry (generic word,
  number, unit, or otherwise) reaches a source at all.
- The context check's `contextText` (`keyword.ts`'s `senseContextGate`) is
  built by `combine.ts`'s `senseContextText(profile)` from
  `profile.methods + profile.venues + profile.seedTexts` (never
  `profile.topics`). `profile.seedTexts` is `briefToSeedTexts(req, brief)` =
  `req.seedTexts + brief.currentProjectSummary + brief.activeQuestions +
  brief.generatedQueries`. Two things follow, checked by execution below
  rather than assumed: (a) `currentProjectSummary` is the RAW project text
  verbatim (or `req.seedTexts.join(" ")` as fallback) when `project` is
  non-empty — so every token of the raw project sentence is already in
  `contextText` regardless of what `phrasesFromText` does; the CHALLENGE
  field has no equivalent raw pass-through, so its tokens reach `contextText`
  **only** via `activeQuestions`' call to `phrasesFromText(challenge, 8)`.
  (b) The context check's OWN overlap axis already drops every token below
  the shipped `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT` (p10, §1bg) —
  a mechanism that already exists independently of anything this item ships.
  This matters directly for Q4 (avoid cutting twice).

## 1. Plan

1. Build the corpus: every English project/challenge string from existing
   test fixtures (harvested by grep across the test suite) + ≥ 25 constructed
   English texts spanning battery materials, catalysis, biology, CS/ML, and
   social science, short and long, with years/units/formulas/acronyms mixed
   in. Fictional test text only, no person's name anywhere (PRIVACY).
2. Write one Node script, run through `<scratchpad>/qgw-hook.mjs` against
   `<scratchpad>/qgw-head`, that for every corpus entry calls the REAL
   `compileSearchBrief` (a) as `challenge` alone with `max=8` to observe
   `phrasesFromText` in isolation (`activeQuestions`), (b) as `project` alone
   with 0 topics to observe the Tier-2 budget path, and (c) as `project` with
   1 representative Required tag to observe Tier 2 demotion. Dump every
   single-word entry produced, classified.
3. Answer Q1 (inventory + classification) and Q2 (trace: query position,
   budget eviction, seed-text effect) from that dump.
4. Extend the script to recompute `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT`
   at p5/p8/p10/p12/p15/p20/p25 (same formula `keyword.ts` uses) and apply
   each cut to the SAME single-word entries, plus a separate numeric/unit
   filter, plus combinations — set-diff every cut against the uncut baseline,
   over the whole corpus. Answer Q3.
5. Answer Q4 (query list vs. seed texts vs. both) from the architecture notes
   above plus the Q3 set diffs.
6. Answer Q5 (tests + cache version) and Q6 (severity) from the above.
7. Finalize: STATUS COMPLETE, tables, recommendation, POLICY list, search
   scope.

Process note: this file is updated after each question closes, with a fresh
`date -u` timestamp on every edit, so STATUS is honest at every moment if
this investigation stalls or is resumed by a different agent.

## 2. Corpus — 2026-09-30T09:23:57Z

Built in `<scratchpad>/qgw-corpus.mjs`. 26 texts harvested verbatim from
existing test fixtures across the suite (grep for `project:`/`challenge:`
string literals under `web/src`, HEAD) + 36 constructed English texts (≥ 25
required) across battery materials, catalysis, biology, CS/ML, and social
science — short and long, several with a year, a joined unit+number token, a
chemical formula, or a model/version name mixed in, per the manager's new
observation. All fictional; no person's name anywhere. 62 texts total.

Every probe below runs the REAL, unmodified `compileSearchBrief` /
`briefToSeedTexts` (HEAD, via `<scratchpad>/qgw-hook.mjs` against
`<scratchpad>/qgw-head`) — nothing in this section or Q2 is hand-derived.

## 3. Q1 — inventory and classification (by execution)

**Method.** `phrasesFromText` itself is a private, unexported function, so it
is observed through the cleanest existing export that calls it with no tier
reordering: `compileSearchBrief({ topics: [], challenge: TEXT })
.activeQuestions`, which is exactly `cleanList(phrasesFromText(TEXT, 8))`
whenever `project`/`seedTexts` are empty (confirmed by reading
profile-compiler.ts :244-247, and confirmed live — see §0). A "single-word
entry" is operationally any output string containing no whitespace — this
matches the item's own framing (a single generic word becoming "its own
entry") and is what a source adapter actually sends as one query string,
regardless of whether it reached the output via the chunk/phrase path (a
short clause with only one word in it) or the flat keyword scan; the report
below states which path produced each case where it matters (Q2).

**Headline result.** All 62/62 corpus texts (100%) produced at least one
bare single-word entry — this is not an edge case, it is the typical case.
147 distinct single-word strings were observed across the corpus.

**Classification totals** (every token classified; method: reference-table
weight — `reference-idf.json`, same table and formula the shipped
`SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT` uses — as corroborating evidence,
plus a semantic read of the word against the field(s) it appeared in;
conservative rule: a genuinely arguable word is always called "domain", never
"generic", so the safety check in Q3 is the strict direction):

| category | count |
|---|---|
| generic | 65 |
| domain | 72 |
| year | 2 |
| number | 2 |
| unit | 6 |
| **total** | **147** |

**Full list, sorted by reference-table weight ascending within each category**
(weight in parentheses; low weight = common in the shipped general-science
sample, high weight = rare/unseen — `8.17` is the table's own maximum,
assigned to every token the table never saw at all, which includes every
chemical formula and model name below):

```
GENERIC (65):
research(2.91), model(3.16), studies(3.24), first(3.27), among(3.50),
lower(3.81), range(3.92), energy(3.93), improve(4.10), materials(4.15),
second(4.16), measured(4.18), behavior(4.21), temperature(4.21),
formation(4.27), aims(4.39), reduce(4.45), long(4.46), comparison(4.49),
developing(4.51), scale(4.56), detection(4.58), outcomes(4.62),
stability(4.64), understand(4.78), load(4.80), accuracy(4.80),
project(4.83), target(4.84), improving(4.92), compare(4.94), cost(4.96),
focuses(5.05), term(5.08), focused(5.13) [the item's own §1bg.9 example],
challenge(5.16), examines(5.17), below(5.24), operating(5.24),
private(5.28), interface(5.44), explores(5.53), investigates(5.55),
studying(5.63), supports(5.66), remote(5.83), utilization(5.83),
avoid(5.90), investigating(5.90), designing(6.09), false(6.09),
comes(6.22), outputs(6.63), builds(6.87), brand(7.07), persisted(7.07),
unrelated(7.32), legacy(7.32), stabilize(7.32), tries(7.88), stays(8.17),
study(8.17), positives(8.17), under(8.17), work(8.17)

DOMAIN (72):
protein(4.29), reduction(4.31), training(4.67), resistance(4.72),
gene(4.81), capacity(4.85), activation(5.09), metal(5.14),
distributed(5.26), oxygen(5.28), conversion(5.28), diversity(5.28),
pathways(5.30), parameter(5.32), degradation(5.40), heterogeneous(5.83),
organizational(5.83), productivity(5.90), catalysts(5.97), cycles(6.05),
electrolyte(6.18), retention(6.22), suppression(6.22), elisa(6.22),
trust(6.38), methane(6.50), interfaces(6.63), silicon(6.63),
benchmark(6.70), employee(6.78), turnover(6.78), workplace(6.78),
interfacial(6.87), latency(6.87), electrolytes(6.97), solid-state(7.07),
battery(7.07), lithium(7.07), yeast(7.07), anomaly(7.07), cathode(7.19),
amplification(7.19), sulfide(7.32), cycling(7.32), anode(7.32),
catalysis(7.32), pipeline(7.32), editing(7.66), splicing(7.66),
crispr(7.88), zebrafish(7.88), embryos(7.88), sodium-ion(8.17),
cathodes(8.17), dendrite(8.17), fast-charging(8.17), fade(8.17),
anodes(8.17), pt/c(8.17), zeolite(8.17), cfdna(8.17), folding(8.17),
transformer(8.17), pipelines(8.17), morale(8.17), hires(8.17),
licoo2(8.17), nmc811(8.17), brca1(8.17), gpt-3.5(8.17), gpt-4(8.17),
lifepo4(8.17)

YEAR (2):   2023(6.38), 2024(6.38)
NUMBER (2): 1000(6.18), 99.9(8.17)
UNIT (6):   500wh/kg(8.17), 500Wh/kg(8.17) [case variant, see note below],
            -40c(8.17), 3.7v(8.17), 45ma(8.17), 175b(8.17)
```

Full machine-generated dump: `<scratchpad>/qgw-q1-dump.json` (per-text),
`<scratchpad>/qgw-q1-distinct-tokens.tsv` (distinct tokens), classification
source `<scratchpad>/qgw-classify.mjs`, cut analysis
`<scratchpad>/qgw-q3-report.json`.

**Four notes earned by execution, not anticipated going in:**

1. **The manager's new observation is confirmed for plain English text, and
   it is pre-existing (not new in this branch).** A bare year ("2024") and a
   joined unit+number token ("500Wh/kg") both become their own single-word
   entries, exactly as the NON-ASCII-TEXT probe found — `battery target
   500Wh/kg by 2024` (0 tags) produces `generatedQueries = ["battery target
   500Wh/kg by 2024", "battery", "target", "500wh/kg", "2024"]`, i.e. the
   bare year and the bare unit token are BOTH sent to every source as their
   own query. This runs through the exact same `[^a-z0-9+\-/.\s]` keyword
   regex phrasesFromText has had since it was written — nothing about
   QUERY-QUALITY/QUERY-BUDGET/SENSE-CONTEXT-EVIDENCE touched it.
2. **The existing length ≥ 4 filter already screens out short
   numbers/units** — "20", "ohm", "cm2" (all 2-3 characters) never reach the
   keyword tier at all, only "2024"-shaped 4-digit years and longer joined
   unit tokens do. Worth knowing before designing a filter: the gap is
   narrower than "every number leaks", specifically 4+-character numeric/
   unit tokens.
3. **Unrelated, pre-existing defect found while building the corpus, not
   part of this item's own charter but directly adjacent to the "numbers and
   units" question this item was asked to check:** the PHRASE/chunk tier
   (`longPhrases`, profile-compiler.ts :114) splits on every literal `.`,
   including the decimal point inside a number — `measured at 3.7V and
   45mA` yields the corrupted phrase fragments `"measured at 3"` and `"7V
   and 45mA"` (two wasted query slots) instead of one clean sentence;
   `Compare GPT-4 and GPT-3.5 outputs` similarly splits GPT-3.5's own
   version number into `"...GPT-3"` / `"5 outputs"`. The KEYWORD tier is
   unaffected (it treats `.` as a token character, so its own parallel
   extraction of "99.9"/"3.7v"/"45ma" is correct) — only the phrase-chunker
   is decimal-blind. This is a genuine, separate, execution-confirmed
   correctness bug, orthogonal to the generic-word question. POLICY —
   manager decides whether to fold a decimal-aware chunk-delimiter into this
   item or spin it out as its own follow-up; not fixed here (read-only).
4. **A casing inconsistency, minor:** the same joined unit token appears as
   `"500Wh/kg"` (original case) when the WHOLE text collapses to one chunk
   (the phrase-path preserves case) versus `"500wh/kg"` (lowercased) when it
   is extracted as one keyword among several in a longer text (the keyword
   path always lowercases). Cosmetic; noted for completeness, not scored as
   a domain/generic/number/unit/other case on its own.
5. **`STOPWORDS` (17 words) is narrower than it looks**: "under" and
   "below" are plain prepositions that read like they should be stopwords
   and are not, so they leak through as generic single-word entries (both
   observed, both classified "generic" above). Separately, `GENERIC_TERMS`
   (term-expand.ts's own, different, 11-word list — materials/energy/
   transport/modelling/simulation/interface/design/analysis/systems/data/
   characterization) is **never consulted by `phrasesFromText` at all**; three
   of its members (`materials`, `energy`, `interface`) showed up in this
   corpus as generic entries this tier does nothing to stop, confirming the
   architecture note in §0.

## 4. Q2 — trace: query position, budget eviction, seed-text effect

**4.1 — Does a bare word ever outrank a phrase from the SAME request?
Measured: no, 0/62.** The already-shipped QUERY-BUDGET tiering (§1az; live
at HEAD) builds `baseQueries` with every phrase (Tier 1) and every
tag+phrase combo (Tier 1b) placed structurally ahead of every bare
single-word `projectTerms` entry (Tier 2) — this is baked into the
construction order, not just the final sort, so it cannot be defeated by
word choice or sentence shape. Across all 62 corpus texts, at both 0 and 1
Required tag, `firstMultiWordPhraseIndex >= cap` while a bare word sat
inside the cap window never once occurred (`<scratchpad>/qgw-run1.mjs`'s
`budgetTrace`). **The originally-suspected failure mode (§1bg.9's own
framing) is already closed by QUERY-BUDGET.** What follows is what actually
still happens — three distinct, real, executed mechanisms, none of them the
one originally suspected.

**4.2 — Mechanism A: Tier 1b degrades into "tag + generic word" when no real
phrase exists, and then fills a privileged slot with it.**
`strongestPhrase = projectTerms[0]` (profile-compiler.ts :210) has no
multi-word check — when a project/challenge text has no comma/period/
semicolon/colon/" - " to chunk on (a plain run-on sentence) and is over 10
words, `longPhrases` is empty and `projectTerms[0]` silently becomes
whichever bare keyword appears first in the sentence. Tier 1b then builds
`${tag} ${projectTerms[0]}` — a real, degraded combo, not a hypothetical.
Measured on 6 run-on-sentence corpus texts (1 per field), all with 1
Required tag:

| corpus id | field | Tier 0 (tag) | Tier 1b combo (as shipped) | cap=3 window (openalex/arxiv/S2) | cap=2 window (dblp/pubmed) |
|---|---|---|---|---|---|
| c-cat-4 | catalysis | heterogeneous catalysis | **heterogeneous catalysis research** | [tag, combo, "research"] | [tag, combo] |
| c-bio-4 | biology | gene editing | **gene editing project** | [tag, combo, "project"] | [tag, combo] |
| c-cs-4 | CS/ML | large language models | **large language models project** | [tag, combo, "project"] | [tag, combo] |
| c-soc-4 | social science | organizational behavior | **organizational behavior research** | [tag, combo, "research"] | [tag, combo] |
| c-batt-6 | battery | solid-state battery | solid-state battery **studies** | [tag, combo, "studies"] | [tag, combo] |
| c-batt-4 | battery | solid-state battery | solid-state battery **9 percent over 500 cycles at room temperature** (a decimal-chunker artifact, see Q1 note 3) | [tag, combo, combo2] | [tag, combo] |

For dblp/pubmed (cap 2, the common case), **both of the reader's only two
query slots go to the bare tag and this degraded combo — every field-search
adapter these two sources run receives zero genuine content beyond the tag
itself**, on any project/challenge text with no salvageable comma/period
clause. This is real and current at HEAD, not constructed to fail.

**4.3 — Mechanism B: single-word entries are ordered by SENTENCE POSITION,
not specificity — a genuinely useful, specific word can be ranked behind
several generic ones, or dropped from the tier's own `max` cap entirely
before it is ever ranked.** Cleanest measured case, `c-cat-4`:

> text: *"This research explores heterogeneous catalysis on zeolite supports
> and focuses on improving selectivity for propylene while suppressing coke
> formation during extended runs at elevated temperature"*

`phrasesFromText(text, 8)` (the widest call site) returns exactly:
`["research", "explores", "heterogeneous", "catalysis", "zeolite",
"supports", "focuses", "improving"]` — **"propylene" and "coke" (the two
most specific, most useful words in the whole sentence — the actual named
reactant and byproduct) never make it into the tier's output at all**,
because the `max=8` cap on the keyword scan (profile-compiler.ts :122-130)
is a first-N-in-sentence-order cap, and 8 less-specific words (two of them,
"heterogeneous"/"catalysis", only redundant echoes of the Required tag
itself) appear earlier in the sentence and fill every slot first. Within
the surviving 5-slot `generatedQueries` (1 tag, max=5 for the project path),
"zeolite" — the one clearly domain-specific word that DID survive the
`max` cap — still lands at position 6 of 9, past every source's cap
(largest is 5): `["heterogeneous catalysis", "heterogeneous catalysis
research", "research", "explores", "heterogeneous", "catalysis",
"zeolite", "heterogeneous catalysis explores", "heterogeneous catalysis
heterogeneous"]`. Three purely-generic or tag-redundant entries
("research", "explores", and the tag's own words echoed bare) outrank it
solely because they appear earlier in the sentence. Same shape, independently
reproduced: `c-bio-4` drops "chaperone"/"cellular"/"nutrient" entirely and
ranks "protein"/"folding"/"pathways" (domain) behind "project"/
"investigates"/"tries"/"understand" (4 of 8 slots spent on pure filler);
`c-cs-4` drops "memory"/"overhead"/"batch"/"nodes" and spends a slot on
"aims"; `c-soc-4` drops "cohesion"/"communication"/"departments"/
"pandemic" and spends 2 of 8 slots on "tries"/"understand".

**4.4 — Mechanism C: bare years/units occupy a slot with ~0 selectivity as
a query, confirmed reaching the actual per-source send list.** From Q1:
`battery target 500Wh/kg by 2024` (0 tags) → `generatedQueries = ["battery
target 500Wh/kg by 2024", "battery", "target", "500wh/kg", "2024"]` — all 5
entries are within every source's cap (3 or 2), so openalex/arxiv/
semantic-scholar all receive the bare string `"2024"` as one of their 3
queries. A source search API given a bare 4-digit year as a query term
returns whatever full-text-mentions-this-year turns up — no topical
selectivity at all (the same shape of harm QUERY-QUALITY originally measured
for "research": 117,064 in-window, ~0% qualify, though this was not
re-measured live here — no network, per the hard constraints; flagged as a
follow-up live measurement for the manager, below).

**4.5 — Seed-text / context-check effect.** `senseContextText` (combine.ts
:71-77) builds `contextText` from `profile.methods + profile.venues +
profile.seedTexts`, and `profile.seedTexts` is `briefToSeedTexts` = `req.seedTexts
+ currentProjectSummary + activeQuestions + generatedQueries`. Two
asymmetric paths, confirmed by execution (not just read):
- **Project text**: `currentProjectSummary` is the RAW project sentence
  verbatim (profile-compiler.ts :267) whenever `project` is non-empty — so
  every token of the raw project text is ALREADY in `contextText`
  regardless of anything `phrasesFromText` does. Measured: `project:
  "Reduce interfacial resistance below 20 ohm cm2 by 2024"` → `seedTexts =
  ["Reduce interfacial resistance below 20 ohm cm2 by 2024", "reduce",
  "interfacial", "resistance", "below"]` — note **"2024" is present in the
  raw sentence (first entry) but ABSENT from the tier's own contribution**
  (the `max=5` cap for the project path fills on `[wholePhrase, reduce,
  interfacial, resistance, below]` before reaching the year) — the SAME
  underlying token is in `contextText` either way, just via a different
  entry.
- **Challenge text**: there is no raw pass-through — `currentProjectSummary`
  only ever holds `project` or, as a fallback, `req.seedTexts.join(" ")`,
  never `challenge`. The SAME text as `challenge` (not `project`) instead
  gives `seedTexts = ["Reduce interfacial resistance below 20 ohm cm2 by
  2024", "reduce", "interfacial", "resistance", "below", "2024"]` — here
  "2024" IS present, because `activeQuestions` calls `phrasesFromText(
  challenge, 8)` (a wider cap than the query path's 5). **So for challenge
  text specifically, the query list and the context seed text are two
  separate extractions at two different `max` values (5 vs. 8) — a fix
  applied only at one call site would leave the other exposed; a fix
  applied inside `phrasesFromText` itself covers both by construction (see
  Q4).**
- **Downstream in the context check itself**, this mostly does not matter
  today: `senseContextGate`'s OVERLAP axis already drops every token below
  `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT` (p10, keyword.ts :481-504,
  §1bg) — a generic word reaching `contextText` is already excluded from
  that axis independent of anything this item does. The FIXED-table cosine
  axis (`fixedSim`) does still see it, weighted by `referenceIdfWeight`
  (low for a generic word) rather than dropped — a continuous down-weight,
  not a gate, so its marginal effect on `fixedSim` is small and never a
  binary pass/fail flip by itself. No case was found, in this read-only
  investigation, where a generic word or bare number in seed text changes a
  real `senseContextGate` verdict — this is an architecture-level
  conclusion from reading the gate's own pass condition (keyword.ts :506-508),
  not a live pass/fail probe (no `RawItem` fixtures were constructed for
  this; flagged in the search-scope note at the end).

**4.6 — A fourth, code-confirmed-but-not-executed mechanism, noted for
completeness, not measured to the same rigor (no `preferenceLedger` fixture
was built in this corpus):** `compileSearchBrief` caps `projectQueries`'
own output to 7 (not 15) specifically when the reader has learned
preference terms (`uploadInterestTerms`), so those terms always start
immediately after position 7 in `generatedQueries` (profile-compiler.ts
:257-261) — regardless of what fills positions 1-7, a source's cap (max 5)
never reaches them. Mechanism A/B above (generic words and degraded Tier 1b
combos filling positions 1-7) are exactly the kind of low-value filler that
can occupy that budget instead of a phrase, meaning a reader's own learned
terms may never reach a source on a run-on-sentence project text. Read from
the code; not independently executed here. Flagged as a lead, not a
measured finding.

## 5. Q3 — candidate fixes, measured by set diff — 2026-09-30T09:25:59Z

Method: every candidate below is applied, as a standalone filter function
(`<scratchpad>/qgw-run3-cuts.mjs`), to the REAL 147 distinct single-word
strings captured in Q1 (real execution, not reimplemented) — this is the
same grid-sweep-over-real-output method this campaign's earlier B
investigations used for the context check's own cut (e.g.
`<scratchpad>/c2-part3-grid.mjs`, `percentile_check.mjs` from the
SENSE-CONTEXT-EVIDENCE investigation). No candidate filter here is shipped
code; each is a proposed, unshipped rule being measured against real
strings. Full machine output: `<scratchpad>/qgw-q3-report.json`.

**(a) Reference-table document-frequency cut, at several percentiles.**
Exact same formula the shipped `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT`
uses (sorted ascending table weights, cut at `floor(P/100 * n)`) — this
report's own p10 recomputation matched the shipped constant exactly
(5.742) as a correctness check before running the rest.

| cut | cut weight | tokens removed | **domain words removed** | generic words removed | generic words still KEPT |
|---|---|---|---|---|---|
| p5  | 5.110 | 41 | **7**: resistance, capacity, reduction, activation, gene, protein, training | 34 | 31 |
| p8  | 5.531 | 56 | **15**: + degradation, metal, oxygen, conversion, pathways, parameter, distributed, diversity | 41 | 24 |
| p10 | 5.742 | 60 | **15** (same as p8) | 45 | 20 |
| p12 | 5.937 | 67 | **18**: + heterogeneous, productivity, organizational | 49 | 16 |
| p15 | 6.224 | 73 | **21**: + electrolyte, catalysts, cycles | 51 | 14 |
| p20 | 6.561 | 81 | **26**: + retention, suppression, methane, elisa, trust | 52 | 13 |
| p25 | 6.784 | 85 | **29**: + interfaces, silicon, benchmark | 53 | 12 |

**Verdict on (a): no percentile is clean.** Even the gentlest cut tested
(p5) removes 7 real domain words outright — including `gene` (a bare
biology term, weight 4.81, below even p5's 5.11) and `protein` (4.29, below
p5 too). This is the same honest result §1bg.12 reached for the
context-check axis at p25 (and had to narrow to p10 to reduce, never
eliminate) — here it does not clear even at p5, so narrowing the percentile
further cannot produce a clean cut; the corpus shows domain-word loss is
already present at the gentlest point tested. Every percentile also leaves
real generic-word residue behind (12-31 generic words survive even the
harshest cut, e.g. `tries`, `stays`, `work`, `under`, `builds`, `brand`,
`legacy` — see full lists in `qgw-q3-report.json`), because the table's
weight measures "how rare in general-science abstracts", not "how
informative as a search term" — a casual word formal scientific writing
avoids (`tries`, `stays`, `brand`) scores artificially HIGH (rare in that
corpus), not low.

**(b) Numeric / year / unit filter.** Definition (mirrors the brief's own
wording): remove a token that (i) has no letters at all (`99.9`, `1000`), a
special case of which is (ii) a 4-digit year (`2023`, `2024`), or (iii)
starts with a digit (optional sign/decimal) followed by unit-shaped letters
— `/^[+-]?\d+(?:\.\d+)?[a-z°]+(?:\/[a-z]+)?$/i` — which is what separates a
UNIT token (`500Wh/kg`, `3.7V`, `45mA`, `-40C`, `175B` — all START with a
digit) from a DOMAIN FORMULA that merely contains one (`LiCoO2`, `NMC811`,
`GPT-4`, `Pt/C`, `LiFePO4`, `BRCA1` — all START with a letter).

**Verdict on (b): clean.** Removes exactly the 10 number/year/unit tokens
(`2024`, `2023`, `99.9`, `1000`, `500wh/kg`, `500Wh/kg`, `-40c`, `3.7v`,
`45ma`, `175b`) and nothing else — 0 domain words, 0 generic words. Every
chemical formula and model/version name in the corpus survives untouched,
confirmed by execution (`kept year/number/unit` list is empty; the domain
list contributed 0 removals).

**(c) Combinations.** Percentile cut + numeric filter together removes
exactly the union of (a)'s and (b)'s removals at that percentile — the
numeric filter never adds a NEW domain-word loss on top of (a)'s (confirmed:
`p5+numeric`'s removed-domain list is identical to `p5` alone, and likewise
at every other percentile), because the two filters operate on disjoint
token shapes (letters-only-generic-or-domain vs. digit-first-or-no-letters).
Combining does not make (a) any cleaner — it inherits every domain-word loss
(a) has on its own.

**Why the SAME mechanism that is safe on the context check is NOT safe
here, stated plainly.** On the context check's overlap axis (§1bg), a token
below the cut is only down-weighted on ONE of two axes — the fixed-table
cosine (`fixedSim`) still sees every token, so nothing is ever fully
invisible, and that axis is what the item's own `SENSE_CONTEXT_FIXED_RESCUE`
floor leans on as a safety net. Applied to THIS tier, a token below the cut
would never become a query string or a seed-text entry AT ALL — an absolute,
binary loss with no second axis to catch it. The same table, applied to a
qualitatively different kind of decision (soft re-weighting of an already-
admitted signal vs. hard exclusion of a candidate before it exists),
carries a categorically worse risk here — which is exactly what the
measurement above shows in practice (domain-word loss starting at the
gentlest percentile, not narrowing to zero the way §1bg.12 eventually did
for its own, different, use of this table).

**A hand-curated generic-word stoplist was considered and is not
recommended**, consistent with the STANDING ruling already on this campaign's
books for this exact tier: QUERY-QUALITY (§1ay.1) explicitly rejected "a
stop-list of generic words (an open class in a closed list)" when it first
touched this same function. This investigation's own classification (Q1)
happens to separate cleanly into a 65-word generic list with zero domain
overlap FOR THIS CORPUS — but a hand list only ever covers the fields it was
built against; the same 65 words would very likely under-cover a reader in
a sixth field this corpus never sampled, silently, with no error. Not
recommended for the same reason §1ay.1 already gave it.

**Recommendation (the least-bad option, per the brief's own framing when no
cut is clean): ship (b) alone.** It is measured clean (0 domain-word cost,
0 generic-word cost — it simply is not designed to catch generic words, only
numbers/years/units), it directly answers the manager's new observation,
and it costs nothing else in the corpus. Do NOT ship (a) at any tested
percentile for this tier — the least-bad percentile (p5) still costs 7 real
domain words including a plain biology noun (`gene`) that no researcher
would consider "generic". POLICY — manager decides whether the residual
generic-word noise (not a number/unit, still present after (b) alone — see
the "KEPT generic words" columns above) is worth a different kind of fix.

**A lead, not measured to the brief's set-diff rigor, offered because it
falls directly out of the Q2 findings and costs nothing to state:** Mechanism
A and Mechanism B (§4.2, §4.3) are not vocabulary problems, they are
ORDERING problems — `projectTerms[0]` should require a real multi-word
phrase before Tier 1b builds a combo from it (closes Mechanism A: no
domain-word cost, since nothing is removed, a degraded combo is simply not
built when no real phrase exists), and the keyword tier could sort by
`referenceIdfWeight` (rarest-first) before applying its own `max` cap, the
same table this section already measures, instead of by sentence-of-
appearance order (closes Mechanism B: `propylene`/`coke`/`chaperone`-shaped
words stop being silently dropped by the cap, because nothing is removed —
words are only re-ordered, so a domain word can only move earlier, never
disappear). Neither idea was measured here (no set diff applies to a
re-order — nothing is removed) and neither is part of this item's own
scope; recorded as a POLICY / follow-up lead only.

## 6. Q4 — where the fix belongs — 2026-09-30T09:28:47Z

**Answer: inside `phrasesFromText` itself (one function, one change), not
as two separate cuts at the query-list and seed-text call sites.**

`phrasesFromText` is the single, shared function both consumers call (§0);
the recommended fix (Q3(b), the numeric/year/unit filter) belongs inside its
own keyword-extraction step (profile-compiler.ts :122-130, alongside the
existing `length >= 4` / `STOPWORDS` checks), so both the query path
(`projectQueries`, max=5) and the seed-text path (`activeQuestions`,
max=8) are fixed by construction, from one edit, rather than needing to be
kept in sync by hand at two call sites. §4.5 measured a real case where
this distinction matters: a challenge-typed year reaches `activeQuestions`
(max=8) but not that SAME text's contribution to `generatedQueries`
(max=5) — a fix applied only where queries are read out, rather than where
the tier itself produces candidates, would leave the seed-text path
exposed.

**"Avoid cutting twice" is satisfied, not violated, by fixing the shared
function.** The context check's own document-frequency cut
(`SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_WEIGHT`, keyword.ts, §1bg) is a
DIFFERENT layer, already shipped, operating on a DIFFERENT signal: it
down-weights a token's contribution to the OVERLAP axis of an
ALREADY-FETCHED candidate's relevance score. This item's fix operates
earlier and on a different question entirely: whether a token becomes a
QUERY STRING (sent to a source) or a SEED-TEXT ENTRY at all. These are not
two cuts on the same thing — one governs sourcing (this item), the other
governs scoring (§1bg, untouched by this item). §4.5 already found, by
reading the gate's own pass condition, that a generic word reaching
`contextText` today is already excluded from the overlap axis regardless —
so removing it one step earlier (inside `phrasesFromText`) changes nothing
about `senseContextGate`'s existing, correct behavior; it only stops
sending a few additional near-useless strings as actual search queries,
which is where §4.2-§4.4 found the real, measurable cost. Concretely:
**no change is needed, or recommended, inside `keyword.ts` or `combine.ts`
for this item** — the entire fix is scoped to one function in
`profile-compiler.ts`.

## 7. Q5 — tests and cache — 2026-09-30T09:28:47Z

**Tests** (paired with the mutation each one catches; all constructible from
this investigation's own corpus, no new fixtures needed beyond what
`qgw-corpus.mjs` already has):

1. A bare 4-digit year in Project text never becomes its own
   `generatedQueries` entry, while a real phrase/tag from the same text
   still does (e.g. a `c-edge-1`-shaped fixture: `"battery target 500Wh/kg
   by 2024"`). Mutation: drop the year branch of the filter → red.
2. A number+unit token (`"500Wh/kg"`, `"3.7V"`, `"45mA"`, `"-40C"`) never
   becomes its own entry. Mutation: drop the number+unit branch → red.
3. **The same test also asserts a chemical-formula/model-name alnum token
   (`"LiCoO2"`, `"NMC811"`, `"GPT-4"`, `"Pt/C"`) STILL becomes its own
   entry** — proving the filter does not over-match. Mutation: broaden the
   filter to "any token containing a digit" (the too-easy wrong
   implementation) → this half goes red while (1)/(2) stay green,
   distinguishing "too narrow" from "too broad" failures.
4. A short numeric/unit fragment under 4 characters (`"20"`, `"ohm"`,
   `"cm2"`) behaves exactly as today (already excluded by the pre-existing
   length filter, Q1 note 2) — a pin, so this change cannot accidentally
   interact with the unrelated length gate.
5. **The shared-function placement itself is tested directly**: the SAME
   year/unit fixture, passed as `challenge` instead of `project`, shows no
   bare year/unit in `brief.activeQuestions` / `briefToSeedTexts` output
   either. Mutation: apply the filter only inside `projectQueries` (the
   query-list call site) rather than inside `phrasesFromText` itself → this
   test goes red while test (1) stays green — proves Q4's placement, not
   just the filter's own logic.
6. **Every existing pinned array in `profile-compiler.test.ts` (the
   `BATTERY_PROJECT_TEXT` tight-focus and QUERY-BUDGET tests) stays
   byte-identical** — none of them contain a bare number/year/unit token
   (confirmed by inspection of the exact pinned arrays, §0/Q1), so this is
   a regression guarantee to state in the checkpoint (the full suite passing
   unmodified), not a new test to write.
7. **Cache:** a test pinning `PAPER_CACHE_KEY_VERSION`'s value, matching
   the project's existing convention of pinning derived constants (e.g. the
   DF-cut percentile in keyword.ts) — so a future bump is a deliberate,
   visible diff.

**Cache implication.** Query generation and seed-text generation both
change for any reader whose Project/Challenge text contains a year, a
joined unit+number token, or a bare decimal — so this needs its own
`PAPER_CACHE_KEY_VERSION` bump, same reasoning as every prior item in this
chain (§1ay §1az §1bg §1bl §1bo each bumped it once). **Numbering note, read
directly rather than assumed:** at HEAD (`490d67b3`) `PAPER_CACHE_KEY_VERSION`
is **19** (`web/src/lib/opportunities/pool-cache.ts` :357 in the extracted
copy); the LIVE working tree (uncommitted) already shows **20** — matching
this item's own brief, which independently states "currently 20 in the
working tree." That gap is not this investigation's own change; it is
presumably the in-flight NON-ASCII-TEXT item's bump (§1bo.5 rules 19→20),
still uncommitted alongside `profile-compiler.ts`/`term-expand.ts` at the
time of this read. **POLICY — sequencing, not this investigation's call:**
this item's own bump should be one past whatever `PAPER_CACHE_KEY_VERSION`
is at the moment ITS OWN C round starts, which depends on ship order
against NON-ASCII-TEXT (both touch the same constant) — stating "21" here
would be guessing at a number that depends on a queue position this
investigation has no visibility into after this read; the state file's own
queue is the source of truth for order.

## 8. Q6 — severity, plain words — 2026-09-30T09:28:47Z

This is a real, confirmed waste, but a quiet one — not a broken feature, and
not something a reader would notice as broken. When someone writes a short
sentence about their project, single plain words from that sentence — words
like "research" or "project" or a bare year like "2024" — get sent out as
their own separate searches, standing next to the good, specific searches
the app also builds from the same sentence. A search for just "2024" or
just "research" does not tell a paper database anything useful, so that
search slot comes back mostly noise. The app's most recent fix (already
live) already stopped the worst version of this — a wasted slot can no
longer shove aside a genuinely good search from the SAME sentence. What is
left is narrower: (1) on a sentence with no natural pauses (no commas),
several of these throwaway words can still fill both of the reader's search
turns on two of the five sources, so those two sources search almost
nothing specific that day; (2) the app picks which words to keep by where
they sit in the sentence, not by how useful they are — so on a long
sentence, the ONE specific word that matters most (the actual chemical, the
actual gene, the actual named thing) can lose its spot entirely to five
throwaway words that just happened to come first; (3) a bare year or a bare
unit number is exactly as useless a search as a bare generic word, and nothing
in the app currently stops either one. None of this makes the app show a
wrong or harmful result — the worst case is a quieter day of results than
the reader's sentence deserved, on the days their sentence happens to be
phrased as a run-on with an early filler word. **Severity: LOW-MEDIUM.**
The numeric/year/unit half is cheap, clean, and worth fixing regardless of
anything else. The generic-word half is real but already substantially
reduced by prior work, and the remaining shape of the problem (word
ordering, not word choice) does not have a clean, safe, one-line fix — see
Q3.

## 9. STATUS: COMPLETE — 2026-09-30T09:28:47Z

**Summary of the per-cut set-diff results (Q3, full detail above):**

| candidate | clean? | domain words lost (least-bad point) |
|---|---|---|
| (a) reference-table cut, p5 | No | 7 (resistance, capacity, reduction, activation, gene, protein, training) |
| (a) reference-table cut, p8-p10 | No | 15 |
| (a) reference-table cut, p12 | No | 18 |
| (a) reference-table cut, p15 | No | 21 |
| (a) reference-table cut, p20 | No | 26 |
| (a) reference-table cut, p25 | No | 29 |
| (b) numeric/year/unit filter | **Yes** | 0 |
| (c) any percentile + numeric filter | No (inherits (a)'s loss) | same as that percentile's (a) |

**Recommendation.** Ship (b), the numeric/year/unit filter, inside
`phrasesFromText`'s keyword-extraction step (profile-compiler.ts), so both
`projectQueries` and `activeQuestions` are fixed from one change (Q4). Do
not ship the reference-table percentile cut (a) for this tier at any tested
percentile — every one measured costs real domain vocabulary, starting at
the gentlest cut tested, unlike its safe, already-shipped use on the
context check's overlap axis (a soft de-weight with a cosine safety net,
not an absolute removal — Q3). Do not adopt a hand-curated generic-word
stoplist either, consistent with the standing §1ay.1 ruling against exactly
that shape of fix. Bump `PAPER_CACHE_KEY_VERSION` by one past whatever it
is when this item's own implementation round starts (currently 19 at HEAD /
20 in the live working tree — see Q5's sequencing note).

**POLICY list (every item in this guide needing the manager's decision, not
this investigator's):**

1. **(Q3)** Whether the residual generic-word noise left after shipping the
   numeric/unit filter alone (real words like `research`/`project`/`tries`
   still reaching queries and seed texts, since no clean removal filter
   exists for them) is worth a different kind of fix — and if so, whether
   to pursue the re-ordering lead below (§5's final paragraph) as its own
   measured follow-up.
2. **(Q3)** Whether to pursue the re-ordering lead (sort the keyword tier by
   `referenceIdfWeight` before applying its own `max` cap, and require
   `projectTerms[0]` to be a real phrase before Tier 1b uses it) as a
   follow-up item — not measured to this brief's set-diff rigor, costs
   nothing to state, directly closes Mechanism A (§4.2) and Mechanism B
   (§4.3).
3. **(Q1 note 3)** The phrase-chunker's decimal-point blindness (`"3.7V"` /
   `"99.9%"` / `"GPT-3.5"` split mid-number into two corrupted phrase
   fragments) — a separate, pre-existing correctness bug found while
   building this corpus. Fold into this item's implementation round, or
   spin out as its own follow-up item.
4. **(Q2 §4.6)** Whether the `preferenceLedger`/learned-terms interaction
   (generic-word filler in positions 1-7 potentially keeping a reader's own
   learned terms out of every source's cap window on a run-on-sentence
   project text) is worth its own measured follow-up — read from the code,
   not executed in this investigation.
5. **(Q2 §4.4)** A live, network-based re-measurement of a bare-year/bare-
   unit query's qualify rate (the same shape of measurement QUERY-QUALITY
   ran for "research": 117,064 in-window, ~0% qualify) — not possible here
   (no network, a hard constraint of this investigation); offered as a
   follow-up if the manager wants the numeric-filter's benefit quantified
   the same way QUERY-QUALITY's was, though the filter is recommended
   regardless given it costs nothing measured.
6. **(Q5)** The exact next `PAPER_CACHE_KEY_VERSION` integer depends on ship
   order against the in-flight NON-ASCII-TEXT item, which also bumps this
   same constant — a queue/sequencing decision, not this investigation's.

**Search scope, for every "not found" / "never" claim above** (so a "not
found" reads as "not found by this search", never as an unqualified
absolute): every claim about which files call `phrasesFromText`,
`activeQuestions`, `generatedQueries`, `niceToHave`, or `materialsOrDatasets`
is from `grep -rl` across the full `<scratchpad>/qgw-head/web/src` tree
(the complete HEAD source tree, not a subset); the claim that no UI
component reads `SearchBrief` is from the same grep, scoped to
`web/src/components` and `web/src/app`; the claim that `pool-cache.ts` has
no LIVE dependency on `phrasesFromText` (only a comment) is from reading
its full import list and every line matching that name; the STOPWORDS/
GENERIC_TERMS membership claims are from reading both literal source arrays
in full (profile-compiler.ts, term-expand.ts), not a partial scan; the
"no UI/reader-visible surface" claim for `activeQuestions`/`niceToHave` is
from tracing every listed caller (`rerank.ts`, `tier2-rerank.ts`) to its own
callers one level further (a Tier-0/1 ranking bonus and a Tier-2 LLM
prompt payload respectively; neither reaches `reason.ts`, the module that
builds reader-facing explanation text) — not a full transitive closure of
the whole codebase. Every quoted `generatedQueries`/`activeQuestions`/
`seedTexts` array in this guide is copied verbatim from real
`compileSearchBrief`/`briefToSeedTexts` output (`<scratchpad>/qgw-q1-dump.json`
and the direct smoke-test transcripts in this session), never hand-derived
or approximated. No `senseContextGate` pass/fail outcome in §4.5 was
executed directly (no `RawItem` fixture was built for it in this
investigation) — that paragraph's conclusion is from reading the gate's own
pass condition (keyword.ts :506-508), stated as such, not claimed as
measured.

**Guide:** `docs/jev-abc/QUERY-GENERIC-WORDS-B-20260930T090811Z.md` (this
file). Corpus, hook, and every analysis script referenced above are in
`<scratchpad>/` (`qgw-corpus.mjs`, `qgw-hook.mjs`, `qgw-head/`,
`qgw-run1.mjs`, `qgw-classify.mjs`, `qgw-run3-cuts.mjs`,
`qgw-q1-dump.json`, `qgw-q1-distinct-tokens.tsv`, `qgw-q3-report.json`).
