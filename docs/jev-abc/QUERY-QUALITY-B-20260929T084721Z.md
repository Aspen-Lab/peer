STATUS: DONE

# QUERY-QUALITY — investigation (agent B)

Investigator: agent B, ABC loop. Never edits product code; this file is the only repo file this agent writes (plus one temporary probe test file, written and deleted during this investigation, never part of any diff).
Branch Jev-integration-and-sorting-filtering-enhancement, HEAD bda38077 (working tree: ABC-JEV-INTEGRATION.md pre-modified, node_modules/ untracked — neither touched by this investigation).
Started: 2026-09-29T08:47Z.

## Summary (written first, expanded below)

Confirmed by direct execution of the real code (temporary probe, deleted): after the ABBREV-RECALL fix (tags now lead `generatedQueries`), the very next query slot on **every** source, for **every** project text tried (3/3 fixtures), is not a phrase at all — it is the reader's **entire, verbatim, multi-sentence project paragraph** used as one search string. `dblp`/`pubmed` (`MAX_QUERIES=2`) get nothing else: their whole non-tag query budget is that one paragraph. `openalex`/`semantic_scholar`/`arxiv` (`MAX_QUERIES=3`) get one more slot, filled by a single generic word ("research", "studies", "building" depending on the fixture) picked because it happens to be the first ≥4-letter non-stopword token in the text — not because it means anything. The root cause is `phrasesFromText` (`profile-compiler.ts:104-126`): it only splits text into phrase-sized chunks on `. ; : \n` or " - ", never on commas; real, detailed project prose almost never has a sub-10-word run between those separators, so its "long phrase" branch is empty in practice (0/3 fixtures produced one) and every non-tag query slot falls back to either the raw paragraph or a bare single word. "fulltext" (as prior docs wrote it) is **not a literal string anywhere** — it is shorthand for this raw-paragraph query; confirmed both by grep (no such literal exists in code or the fixture) and by running the real code and reading the actual ~290-character string back out of `generatedQueries[1]`. Live-measured on the given fixture (real `scoreKeyword`, the real Required-gate function, keyless OpenAlex, 14-day window): the wasted generic-word slot ("research") pulled from a pool of **117,064** in-window candidates and **0 of a real 25-result sample qualified** for tag "LCO" (topics: agriculture, medicine, linguistics, an asphalt study). A well-formed tag query ("LiCoO2") pulled from a pool of 28 and **10/10 qualified**; a well-formed phrase ("lithium cobalt oxide") pulled from 20 and **4/10 qualified**. My own live comparison of the raw-paragraph query and of fixtures B/C was cut short by a 429 after 2 of my allowed ≤12 calls (recorded as BLOCKED, not evidence either way) — the local (no-network) measurement of what gets sent is complete and identical in structure for all 3 fixtures.

---

## 1. Path enumeration (file:line)

**Step 1 — text in.** `web/src/lib/feed/profile-compiler.ts:132-133`, `compileSearchBrief`'s callee `projectQueries`: `project`/`challenge` are read from `req.intent?.project`/`req.intent?.challenge` (preferred) or the legacy `req.project`/`req.challenge` fields, via `textValue`.

**Step 2 — `phrasesFromText` (104-126), the shared extractor.**
- `106-109`: `chunks = text.split(/[.;:\n]|(?:\s+-\s+)/)` — splits ONLY on period/semicolon/colon/newline or " - ". **Commas are not a boundary.** Filtered to `part.length >= 4` (character count of the whole chunk, not word count).
- `111-113`: `longPhrases = chunks.filter(part => part.split(/\s+/).length <= 10).slice(0, ceil(max/2))` — a chunk only survives as a "phrase" if it has ≤10 words. A real, detailed research sentence between two periods routinely runs 15-25 words, so this branch is starved by construction whenever the writer used normal prose with commas instead of short, period-separated fragments.
- `115-123`: `keywords` — lowercases the WHOLE text, strips everything except `[a-z0-9+\-/.\s]` (this also strips **all non-ASCII text — see POLICY 4**), splits on whitespace, keeps tokens `length >= 4` and not in the 16-word `STOPWORDS` set (`70-88`), dedupes, takes the first `max`.
- `125`: `cleanList([...longPhrases, ...keywords]).slice(0, max)` — long phrases would lead if any existed; in practice (see §2) none did, in any of 3 fixtures, so the returned list is 100% single words.

**Step 3 — `projectQueries` assembles `projectTerms` (128-140).**
```
134-140: projectTerms = cleanList([
  project,                        // <-- the ENTIRE raw paragraph, verbatim, as ONE query
  ...phrasesFromText(project, 5), // <-- up to 5 single words (see Step 2)
  challenge,                      // <-- same problem if challenge is set
  ...phrasesFromText(challenge, 5),
  ...seedTexts.flatMap(seed => phrasesFromText(seed, 5)),  // same extractor, same defect
])
```
Line 134 (`project,`) is the literal source of what earlier docs called `fulltext` — confirmed by execution (§2): `generatedQueries[1]` is byte-identical to the fixture's full input string, not the word "fulltext". Line 137 (`challenge,`) is the same problem for the challenge field, currently untriggered only because the fixtures used have no separate challenge text.

**Step 4 — assembly order (already fixed by ABBREV-RECALL §1av, unchanged by this investigation).** `153-159`: `baseQueries = [...exactSenseQueries, ...topics, ...projectTerms, ...topic×method combos, ...topic×projectTerms.slice(0,3) combos]`. Tags lead; `projectTerms` (Step 3) is the very next block, so its first two entries (raw paragraph, then one single word) are always the first two things the truncation below sees after the tags.

**Step 5 — per-adapter truncation (all pre-existing, none touched by ABBREV-RECALL or this item).**
| Source | `MAX_QUERIES` (file:line) | `buildSearchQueries` (file:line) |
|---|---|---|
| openalex | 3 (`openalex.ts:11`) | `112-121`; `source = queries.length>0 ? queries : topics`, dedup, `.slice(0, MAX_QUERIES)` at `120` |
| semantic_scholar | 3 (`semantic-scholar.ts:7`) | `139-141`, same shape |
| arxiv | 3 (`arxiv.ts:8`) | `150-152`, same shape |
| dblp | 2 (`dblp.ts:7`) | `121-123`, same shape |
| pubmed | 2 (`pubmed.ts:7`) | `179-181`, same shape |

`queries` = `brief.generatedQueries`, wired at `pipeline.ts:635` (`buildPaperPool` calling every source's `.fetch({..., topics: req.topics, queries: brief.generatedQueries})`) — confirmed unchanged from ABBREV-RECALL-B's own trace, re-checked at current HEAD.

**Net, confirmed live (§2) for every one of 3 fixtures with 1 Required tag:** `openalex`/`semantic_scholar`/`arxiv` send `[tag, <entire raw paragraph>, <one single generic word>]`; `dblp`/`pubmed` send `[tag, <entire raw paragraph>]` — their whole non-tag budget.

**Learned terms and seed texts (the task's other two entry points):**
- Seed texts (`req.seedTexts`) go through the exact same `phrasesFromText` call (line 139) — same defect, not a separate mechanism.
- Learned terms (`uploadInterestTerms`, `web/src/lib/preferences/ledger.ts:338-341`) are a **different, already-fine** mechanism: up to 3 short curated labels (`entry.label`) from the reader's own upload/feedback history, net-positive-weighted, already atomic phrases — not run through `phrasesFromText` at all. They are appended in `compileSearchBrief:197-201` (`cleanList([...projectQueries(...).slice(0, learned.length?7:15), ...learned.map(term => coreTopics[0] ? `${coreTopics[0]} ${term}` : term)])`), so on a signed-in reader with upload history they compete for the same downstream `MAX_QUERIES` truncation as everything above — freeing slots upstream (§3) also gives these already-good terms a better chance of survival, as a side benefit, not a new problem.

---

## 2. Measured cost

### 2a. What each source sends today — 3 fixtures, via the real `compileSearchBrief` (temporary probe, local only, no network)

Fixture A is the given fixture (`BATTERY_PROJECT_TEXT`, reused verbatim from `profile-compiler.test.ts`/`sense-context.test.ts`). Fixtures B and C are **constructed** by this investigation for this measurement only (not reused from any product fixture).

| Fixture | Project text (abridged) | Tag | `generatedQueries[0..2]` (what matters — everything after is truncated away on every source) |
|---|---|---|---|
| A | "PhD research on solid-state battery materials, focused on lithium and sodium-ion cathode and electrolyte interfaces for electric-vehicle batteries. Improving ionic conductivity…dendrite growth." | LCO | `["LCO", <full 290-char paragraph>, "research"]` |
| B | "Our lab studies capacity fade in nickel-rich NMC811 cathodes paired with silicon-graphite composite anodes under fast-charging protocols. We are especially interested in how electrolyte additives…lithium plating at high charge rates." | silicon anode | `["silicon anode", <full 240-char paragraph>, "studies"]` |
| C | "I'm building a research plan on sodium-ion batteries for grid-scale energy storage, looking at hard-carbon anode materials and Prussian-blue analogue cathodes. The main challenge is…cycling stability." | Prussian blue | `["Prussian blue", <full 280-char paragraph>, "building"]` |

Per-source result, all 3 fixtures, identical structure:
- `openalex` / `semantic_scholar` / `arxiv` (slice 3): **[tag, entire raw paragraph, one generic word]**
- `dblp` / `pubmed` (slice 2): **[tag, entire raw paragraph]** — 100% of their non-tag budget

Every one of the 5 "long phrase" candidate chunks (2 sentences × ~3 fixtures) exceeded the 10-word cap; **0 of 3 fixtures produced a single multi-word phrase query** — confirmed by reading the actual `generatedQueries` arrays, not inferred.

### 2b. Live qualify-rate comparison (keyless OpenAlex, `from_publication_date:2026-09-15`, matching the pipeline's own default "week" window computed the same way `openalex.ts:144-150` does it)

Call ledger (of the allowed ≤12; stopped per the standing rule): **2 calls made, then stopped** — call 1 (`search=research`, fixture A's own wasted 3rd slot) → HTTP 200; call 2 (`search=<fixture A's full raw paragraph>`) → **HTTP 429** ("Anonymous search is temporarily rate-limited…"). Per the standing instruction, no further new calls were made (calls 3-12 not attempted) — this is recorded as **BLOCKED**, not as evidence that the raw-paragraph query performs any particular way. Both saved under `<scratchpad>/qq-01-A-word-research.json` and `<scratchpad>/qq-02-A-fulltext.json`.

To still get a same-fixture, same-tag comparison point, I reused (zero new calls) two already-saved keyless OpenAlex responses from the sibling ABBREV-RECALL-B investigation earlier in this same session (`<scratchpad>/abbrev-recall/oa-1-licoo2.json`, `oa-3-licobaltoxide.json`; same date window). Those investigations counted only totals and eyeballed titles; **this investigation is the first to run the actual fetched candidates through the real, exported `scoreKeyword` Required-gate function** (`web/src/lib/scoring/keyword.ts:492`, called exactly as `combine.ts:197-204` calls it: `grounded:true, extendedRequiredMatch:true` — T1/T2/T3, lexical, Tier 0, no model key; T4's topical-similarity fallback needs a pool-wide TF-IDF index and is out of scope for a single-item probe, so these qualify-counts are a conservative lower bound, not the full production number) via `openAlexWorkToRawItem` (`web/src/lib/utils/openalex.ts:104`, also real/exported).

| Query (today's slot) | In-window total | Sampled | Qualify for "LCO" | Sample of what qualified / didn't |
|---|---|---|---|---|
| **"research"** (today's actual wasted 3rd slot, fixture A) | 117,064 | 25 | **0 / 25 (0%)** | *African Journal of Agricultural Research*, *Journal of Medicinal Plants Research*, *International Journal of Corpus Linguistics*, an asphalt/turf-crumb note — nothing battery-related |
| "LiCoO2" (well-formed tag query, reused) | 28 | 10 | **10 / 10 (100%)** | *"…4.5 V LiCoO2"*, *"…5 V LiCoO2 Operation in Zr-Based Halide Solid-State Batteries"* |
| "lithium cobalt oxide" (well-formed phrase, reused) | 20 | 10 | **4 / 10 (40%)** | 2 genuine LCO cathode papers qualify; 2 qualifying hits are a plant-toxicology use of LCO nanoparticles (a known, separately-tracked wrong-sense gap, not this item's problem — SENSE-CONTEXT, §1ao ruling 2); rejects include adjacent-but-not-LCO-specific lithium-ion recycling papers |

**What this shows, and its limit:** today's actual wasted slot returned a firehose (117k candidates) with a measured 0% qualify rate on a real 25-item sample; a modest well-formed phrase, even an imperfect one, did an order of magnitude better (40-100%). What it does **not** show: how the raw full-paragraph query itself performs (BLOCKED by the 429) — I recommend C re-run that one specific comparison (a handful of its own calls) before/while implementing, since it's the single highest-value slot to fix and I could not close the loop on it myself.

---

## 3. Design options, costs, and recommendation

**Option S — a stop-list of generic single words.** The task's own suggestion, with its own warning: a hand-picked list (`"research", "study", "focused", "building", "looking", …`) blocks exactly the words seen in these 3 fixtures and nothing else — any new filler verb ("investigating", "exploring", "examining", "developing"…) slips through untouched. This is an open class (English research-description filler words are not enumerable) — a closed list is a whack-a-mole that needs updating forever and gives false confidence. **Not recommended as the primary fix.** If used at all, it should be a small, clearly-commented backstop under a structural fix (below), not the fix itself.

**Option P — minimum phrase length (structural, not a word list).** Instead of asking "is this specific word bad," ask "is this a real phrase at all" — require ≥2 content words before something is sent as its own query; a lone word is only ever used as a last-resort filler when literally nothing else is available. This sidesteps the open-class problem entirely (it's a count, not a list) and is directly supported by §2b's numbers: the single word scored 0%, the multi-word phrase scored 40-100%.
- *Cost:* low. `phrasesFromText`'s own ordering already puts `longPhrases` before `keywords` (line 125) — the bug is that `longPhrases` is empty in practice, not that the ordering is wrong. Enforcing a minimum length mostly just means: stop falling back to single words as eagerly once real phrases exist (see Option N below, which is what actually makes them exist).

**Option N — widen the phrase splitter so real phrases actually survive (the fix Option P needs to have teeth).** Split `phrasesFromText`'s chunks on commas too (and optionally coordinating "and"/"while"/"between"), not just `. ; : \n` / " - ". Re-running fixture A's text by hand through this rule turns the one 21-word run-on clause into pieces like "solid-state battery materials", "lithium and sodium-ion cathode", "electrolyte interfaces for electric-vehicle batteries" — each well under even a tightened word cap, so they survive `longPhrases` without needing any other change.
- *Cost:* low-medium. Touches the one shared function `activeQuestions`/`niceToHave`/`materialsOrDatasets` also read (`compileSearchBrief:184-186,210,213`) — a phrasing change here also changes what a reader sees as "your active questions" on their own profile page, not just retrieval (**POLICY 3**). Needs regression tests across terse (one short sentence, no punctuation) and verbose fixtures so short profiles don't regress to empty.

**Option F — stop sending the raw full project/challenge text as a literal query at all.** Remove `project`/`challenge` themselves from `projectTerms` (`profile-compiler.ts:134,137`) — keep them ONLY where they already separately live for context (`briefToSeedTexts`/`currentProjectSummary`, `profile-compiler.ts:207,221-228`, untouched by this option). This is the single highest-value change: §2a shows it occupies the very first non-tag slot on **every** source, **every** fixture, and is the **entire** non-tag budget for `dblp`/`pubmed`.
- *Cost:* very low mechanically (a 2-line removal). The one real risk: OpenAlex's `search` param treats an unquoted >5-word query as a fuzzy relevance search, so the raw paragraph might occasionally do better than a single generic word by sheer breadth — this is exactly the comparison my 429 blocked (§2b). Recommend C measure it with a handful of its own calls before shipping this as an unconditional removal.

**Option D — drop a single word once a multi-word phrase already covers it.** Once Option N produces real phrases, avoid also separately queueing the individual words already inside one of those phrases (e.g., don't send both "solid-state battery materials" and bare "battery" and bare "materials" as three separate, redundant slots). A light dedupe layer on top of N, not a separate mechanism.
- *Cost:* low; mostly bookkeeping (check substring containment before adding a bare keyword).

### Recommendation

Ship **F + N** together in one C pass (same file, same function, small combined diff — avoids a half-fixed intermediate state where the raw-paragraph query is gone but nothing better has replaced it yet): stop sending the verbatim full text as a query (**F**), and widen the chunk splitter so real 2-6 word phrases actually get produced and lead the list, exactly as `phrasesFromText`'s existing `[...longPhrases, ...keywords]` order already intends (**N**). Fold in **D** (skip a bare keyword once a surviving phrase already contains it) as a small addition to the same change, since it falls out of N almost for free. Do **not** add Option S's word list — N+P together remove the need for it (single words become a rare last resort, not the default), which is a more robust fix for an open class than trying to enumerate it.

**What must not change (verified, not assumed):**
- Tags lead `baseQueries` (ABBREV-RECALL §1av) — this option only changes what's inside `projectTerms`, not `baseQueries`'s own assembly order (`profile-compiler.ts:153-159`, untouched).
- P1 exact-sense queries (`exactSenseQueries`, line 152) stay first — untouched.
- Tight focus (`controls.focus === "tight"`, lines 161-171) — untouched; still filters/prepends the same way, just over a better-quality `projectTerms`.
- The zero-topic tight lane (`topics.length === 0` branch, line 163-164) — untouched; still returns `baseQueries` (built from the now-better `projectTerms`) unfiltered.
- Learned terms' own mechanism (`ledger.ts:338-341`) — untouched; only benefits from freed slots (§1).

**Tests C must write:**
1. `phrasesFromText`: a realistic comma-heavy, multi-clause sentence (reuse `BATTERY_PROJECT_TEXT` or this guide's fixtures B/C) yields real 2-6 word phrases, not only single words — assert at least one multi-word entry.
2. `projectQueries`/`generatedQueries` no longer contains a string equal to the full, verbatim input `project` (or `challenge`) text — while `briefToSeedTexts(...)` and `brief.currentProjectSummary` **still** contain it (protects the other, legitimate consumer of the raw text).
3. Protective: a short, terse, punctuation-free project text (e.g. 5-8 words, no commas or periods) still produces a sensible non-empty query list — don't let the wider splitter regress the trivial case to nothing.
4. Protective: `solid state`/`electrolyte`-shaped profiles (where the project text already contains the tag's own words) keep working at least as well as today (ABBREV-RECALL's own protective case).
5. Redundancy (Option D): when a surviving phrase contains a candidate bare keyword, the bare keyword is not also separately queued.
6. Mutation: revert the comma-splitting regex to today's `.;:\n`/" - " only — test 1 must go red. Revert the raw-text removal — test 2 must go red.
7. Live acceptance (not automated CI, a manual A/C step like this investigation's own §2b): re-run the same fixture-A "LCO" comparison against the NEW phrase-based queries `phrasesFromText` now actually produces, and confirm the qualify rate is meaningfully above the measured 0% baseline — closing the gap my 429 left open.

---

## 4. POLICY — manager decides

1. Ship **F+N(+D)** as recommended, vs. a narrower first step (F alone, since it's the cheaper, more strongly-evidenced half) — F alone still leaves every source's remaining slots as single generic words (today's `openalex`/`S2`/`arxiv` 3rd slot), so I'd recommend against shipping F without N, but it is a smaller, faster-to-review increment if the manager wants to split the work.
2. Whether to authorize C to spend a small number of its own keyless OpenAlex calls specifically to close the gap my 429 left (the raw-paragraph query's own real yield) before removing it unconditionally — I recommend yes (a handful of calls, same discipline: stop at first 429).
3. `phrasesFromText` also feeds user-visible profile copy (`activeQuestions`/`niceToHave`/`materialsOrDatasets`), not only retrieval queries — widening the splitter (Option N) will also change what a reader sees listed as "your active questions." Worth a quick product-copy glance, not just a retrieval-metric check.
4. Found in passing, not investigated further (out of this item's scope): `phrasesFromText`'s keyword regex (`profile-compiler.ts:118-119`, `[^a-z0-9+\-/.\s]`) strips **all non-ASCII characters**, so a Chinese-language project/challenge description would lose almost everything in the single-word path (the chunk/long-phrase path is unaffected, since it doesn't character-filter). Given the product's own default UI/response language is Chinese, this may be worth a dedicated follow-up item — the manager's call whether to open one.
5. Sequencing with the existing **QUERY-BUDGET** follow-up (§1av point 6 — reserving/raising `MAX_QUERIES` so tags don't crowd out project context): both touch the same region of `profile-compiler.ts`; no correctness dependency either direction, but doing them in the same C pass could be more efficient than two separate sequential edits to the same function. Purely a scheduling call.
6. Whether a short (≤ ~8-word), already phrase-shaped project text should still be allowed through as one literal query (a floor on Option F: "only suppress the raw text when it's long/multi-sentence") rather than always excluding it. I did not build this floor into the recommendation above (kept the rule simple — never send the multi-sentence blob) — flagged as a possible refinement, not decided here.
7. Cache: this change alters which candidates get fetched (pool membership), same class of change as every prior item in this loop — C bumps `PAPER_CACHE_KEY_VERSION` again (currently `14`, `pool-cache.ts:273`, single exported prefix) the same way ABBREV-RECALL/LCO-FORMULA/REQUIRED-GATE each did.
