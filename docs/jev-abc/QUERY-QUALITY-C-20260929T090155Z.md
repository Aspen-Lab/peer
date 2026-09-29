STATUS: IMPLEMENTED_PENDING_REVIEW

# QUERY-QUALITY — implementation (agent C)

Implementer: agent C, ABC loop. Branch Jev-integration-and-sorting-filtering-enhancement, HEAD bda38077 (working tree clean except ABC-JEV-INTEGRATION.md, not mine; docs/jev-abc/QUERY-QUALITY-B-...md and node_modules/ untracked, not mine to touch beyond reading the guide).
Started: 2026-09-29T09:01:55Z.

Binding rulings: ABC-JEV-INTEGRATION.md §1ay (this item), §1av (Required tags first — must not change), §1b (scope). Guide: docs/jev-abc/QUERY-QUALITY-B-20260929T084721Z.md.

---

## Step 1 — consumer enumeration (BEFORE any edit)

### Every caller of `phrasesFromText` (private, unexported, only used inside `web/src/lib/feed/profile-compiler.ts`)

| file:line | Context | Feeds |
|---|---|---|
| profile-compiler.ts:136 | `...phrasesFromText(project, 5)` inside `projectQueries` | `projectTerms` → `baseQueries` → `generatedQueries` |
| profile-compiler.ts:138 | `...phrasesFromText(challenge, 5)` inside `projectQueries` | same |
| profile-compiler.ts:139 | `...seedTexts.flatMap((seed) => phrasesFromText(seed, 5))` inside `projectQueries` | same |
| profile-compiler.ts:185 | `...phrasesFromText(challenge, 8)` inside `compileSearchBrief` | `activeQuestions` |
| profile-compiler.ts:186 | `...phrasesFromText(req.seedTexts?.join(". "), 8)` inside `compileSearchBrief` | `activeQuestions` |

No other file imports or calls `phrasesFromText` (grepped `web/src`, zero hits outside this file).

### Every downstream reader of the brief fields it feeds

`generatedQueries`:
- pipeline.ts:635 — `queries: brief.generatedQueries` passed to a source adapter's `.fetch()` → retrieval only (which papers get fetched), never rendered as literal text.
- pipeline.ts:727 — folded into `semanticQueryText` for the OpenAlex semantic channel (`fetchOpenAlexSemantic`) → retrieval only. (Note: this line also reads `brief.project`/`brief.challenge` directly, the full raw fields on `SearchBrief` — untouched by this change, see below.)
- pipeline.ts:1217 — second `.fetch()` call site (retry/claim path), same shape as 635 → retrieval only.
- profile-compiler.ts:226 — `...brief.generatedQueries` inside `briefToSeedTexts` → becomes seed text for downstream similarity, not literal display.
- profile-compiler.test.ts, upload-concepts.test.ts, rerank.test.ts — test assertions only.

`activeQuestions`:
- profile-compiler.ts:210 — folds into `niceToHave`.
- profile-compiler.ts:213 — filtered into `materialsOrDatasets` (regex on data/material/cathode/anode/electrolyte/benchmark words).
- profile-compiler.ts:225 — folds into `briefToSeedTexts`.
- rerank.ts:62 — `overlapScore(text, brief.activeQuestions)` → a 0..1 numeric score, never displayed.
- tier2-rerank.ts:107 — included in the JSON sent to the ranking LLM as `searchBrief.activeQuestions` context. The reader never sees this JSON; the LLM's own generated `reasons` text (separate output) is what's shown, and better-quality phrases can only make that reason text more accurate, not worse.

`niceToHave`:
- rerank.ts:61 — same, numeric score only.
- tier2-rerank.ts:109 — same, LLM context only.

`materialsOrDatasets`: defined (profile-compiler.ts:37,213) but **has no consumer anywhere else in web/src** — confirmed by grep. Currently dead beyond its own definition.

`currentProjectSummary`: NOT derived from `phrasesFromText` — it's `project || seedTexts.join(" ") || ""` (profile-compiler.ts:207), the raw text itself. Consumed by `briefToSeedTexts` (profile-compiler.ts:224) only. Untouched by this change (F only touches what goes into `projectTerms`/`generatedQueries`, never the `project`/`challenge`/`currentProjectSummary` fields on the brief itself).

**No `.tsx`/`.jsx` file anywhere in `web` references `activeQuestions`, `niceToHave`, `materialsOrDatasets`, `generatedQueries`, or `currentProjectSummary`** (grepped, zero matches) — confirmed no UI literally lists these as reader-visible text. No API route returns the `SearchBrief` object to a client either (`runFeedPipeline` uses `brief` internally only to build `FeedPipelineResult`, which holds paper items, not the brief).

### ESCAPE CLAUSE check

All reader-visible effects of this change are indirect: (a) which papers get fetched/shown (retrieval quality — the intended target of this fix, expected to improve per B's measured 0% vs 40-100% qualify-rate gap), (b) numeric ranking scores, (c) one LLM prompt's context for a separately-generated reason string. No field touched by `phrasesFromText` is rendered as literal reader-facing text anywhere in the app. **Escape clause does not trigger — proceeding.**

---

## Step 6a — gates BEFORE the first edit (from web/)

- `npx vitest run` → **Test Files 283 passed | 3 skipped (286); Tests 5148 passed | 6 skipped (5154)** — matches expected baseline exactly.
- `npx tsc --noEmit` → **0 errors** (no output).
- `npx eslint .` → **0 errors / 151 warnings** — matches expected baseline exactly.
- `npm run build` → **Compiled successfully**, TypeScript finished, all 29 routes generated. OK.

Baseline confirmed identical to the task's stated expectation. Proceeding to implementation.

---

## Step 2 — F + N implementation (web/src/lib/feed/profile-compiler.ts)

- **N**: `phrasesFromText`'s chunk-split regex widened from `/[.;:\n]|(?:\s+-\s+)/` to `/[.,;:\n]|(?:\s+-\s+)/` (added comma). Word cap (`<=10` for `longPhrases`) and the overall `max` cap are unchanged — ruling only asked for comma-splitting, not a new cap.
- **F**: added `literalQueryIfShort(text)` (const `MAX_LITERAL_QUERY_WORDS = 6`) — returns the trimmed text only when its whitespace-split word count is `<=6`, else `undefined`. `projectQueries`'s `projectTerms` now calls `literalQueryIfShort(project)` / `literalQueryIfShort(challenge)` instead of splicing in the raw `project`/`challenge` fields unconditionally. `cleanList` already tolerates `undefined` entries (pre-existing behavior), so no signature change needed.
- **Not shipped** (per §1ay ruling 1, which says "Ship F + N together" only): B's Option D (drop a bare keyword once a surviving phrase already contains it) and Option S (stop-list of generic words) — neither is in the binding ruling.
- `project`/`challenge`/`currentProjectSummary` fields on `SearchBrief` itself, `briefToSeedTexts`, and `pipeline.ts:727`'s semantic-channel query (which reads `brief.project`/`brief.challenge` directly) are untouched — F only changes what enters `projectTerms`, never the brief's own raw-text fields.

## Step 3 — cache version bump

`web/src/lib/opportunities/pool-cache.ts`: `PAPER_CACHE_KEY_VERSION` 14 → 15, with a new explanatory paragraph appended to the existing per-bump comment chain (matching the v7..v14 style already there), naming the pool-membership reason (queries changed, so a v14 pool may be missing candidates the corrected queries would fetch).
`web/src/lib/opportunities/pool-cache.test.ts`: updated the "papers is now vN..." historical-chain comment (line ~86) to lead with v15/QUERY-QUALITY. This is a comment, not an assertion — the actual assertions use the exported `PAPER_POOL_KEY_PREFIX` constant, so they update automatically. Confirmed no test hardcodes a hardcoded `peer-pool-v14-...` literal as a "current version" assertion (grepped `v14` across web/) — the only hardcoded `peer-pool-vN` literals in the test suite are old-version-rejection fixtures (v1, v5, v6, v7), deliberately unrelated to "current," left untouched per the standing instruction. `channel-candidate-cache.ts`'s own comment ("currently `peer-pool-v7-papers-`") is a pre-existing, already-stale historical note frozen since REQUIRED-GATE (7 bumps ago, never kept in sync since) — not part of the maintained chain, left as-is (out of this item's scope).
Ran `npx vitest run src/lib/opportunities/pool-cache.test.ts` immediately after the bump: all tests passed (uses `PAPER_POOL_KEY_PREFIX`, so it tracked the bump automatically).

## Step 5 (partial) — tests written, `profile-compiler.test.ts`

Rewrote the two ABBREV-RECALL pinned-array tests (zero-topic tight-focus lane; tight-focus-with-topic lane) with new arrays computed by direct execution against the new code (ran the suite, read the actual failure diff, copied the `Received` side verbatim — not hand-derived), and a comment crediting QUERY-QUALITY for the second rewrite of these same two tests. Added a new `describe("compileSearchBrief QUERY-QUALITY: ...")` block with 4 tests: (1) a long raw project paragraph never appears verbatim in `generatedQueries` (default/non-tight focus — the actual production default, unlike the two pinned tests above which are tight-focus only), (2) same for `challenge`, (3) a comma-heavy project text yields real multi-word (2-6 word) phrases and specifically contains two expected phrases, (4) the 6-vs-7-word floor boundary: a specially constructed pair of fixtures (both containing the same leading comma-split sub-phrase "silicon anode") isolates `literalQueryIfShort` from `phrasesFromText` — the 6-word fixture's FULL string is contained, the 7-word fixture's FULL string is not, while the shared derived sub-phrase survives on both sides.

All 15 tests (11 pre-existing + 4 new) pass: `npx vitest run src/lib/feed/profile-compiler.test.ts` → 1 file / 15 passed.

**Mutation, run by hand, proven by hash:**
1. Hashed the fixed `profile-compiler.ts`: `54345f22d72ed6438605e9666bb457467fe648f9a0386ac8f2c918389f4b39ff`.
2. Reverted `literalQueryIfShort(project)` / `literalQueryIfShort(challenge)` back to plain `project` / `challenge` (re-adding the raw text unconditionally — the exact bug this item fixes).
3. Re-ran the suite: **5 of 15 tests went red** — both rewritten pinned-array tests, and 3 of the 4 new QUERY-QUALITY tests (the comma-split-phrase test stayed green, correctly, since that mutation only touches F, not N).
4. Edited back to `literalQueryIfShort(...)` for both call sites.
5. Re-hashed: **54345f22d72ed6438605e9666bb457467fe648f9a0386ac8f2c918389f4b39ff** — byte-identical to step 1. Re-ran the suite: 15/15 green again.

---

## Step 4 — measurement (keyless OpenAlex, closing B's 429 gap)

Temporary probe: `web/src/lib/feed/query-quality-probe.test.ts` (written, run once via `npx vitest run src/lib/feed/query-quality-probe.test.ts`, then deleted — confirmed removed, never part of the diff). Hand-rolled its own `fetch()` call (not the production adapter's `fetchOne`, which always sends a `mailto`) so it is genuinely keyless: no `Authorization` header, no `mailto` param. Same fixture/tag/window as B (`from_publication_date:2026-09-15`, tag "LCO", battery project text = `<scratchpad>/lco-req.json`'s `project` field = `profile-compiler.test.ts`'s `BATTERY_PROJECT_TEXT`). Fetched data written only to `<scratchpad>/qq-c-measurement.json`, never into the repo.

Budget: 2 of my 8 allowed calls spent; stopped at the first 429 (2nd call), exactly as instructed — did not retry even though 6 calls remained, matching B's own discipline in the guide.

| Query (who sends it) | In-window total | Sampled | Qualify for "LCO" |
|---|---|---|---|
| **Old: whole raw paragraph** (today's slot 2, every source, every fixture) | **1** | 1 | **0/1** — the one hit ("Thermal Spray as a Scalable Alternative Processing Route for Solid-State Thin-Film Batteries") does not qualify |
| Old: bare word "research" (today's slot 3, 3-slice sources only) — **reused from B**, not refetched | 117,064 | 25 | 0/25 |
| **New: "PhD research on solid-state battery materials"** (new slot 2, all sources) | — | — | **BLOCKED (429)** on my 2nd call — "Anonymous search is temporarily rate-limited… retry in 33s." Per the standing rule, did not retry. Unmeasured this session, same as B's own gap. |
| Reference — well-formed tag "LiCoO2" — reused from B (sibling ABBREV-RECALL-B data, same window) | 28 | 10 | 10/10 |
| Reference — well-formed phrase "lithium cobalt oxide" — reused from B | 20 | 10 | 4/10 |

**Reading:** I could not close B's specific gap (the new phrase's own live qualify rate — blocked again by the same anonymous rate limit). But the old raw-paragraph query's own real behavior, unmeasured until now, turned out to be its own separate finding: OpenAlex's fuzzy/unquoted handling of a full, specific 40+-word paragraph returns almost nothing at all (1 in-window candidate, which doesn't even qualify) — not "too much noise" like the bare-word slot, but "too narrow to be useful," a different failure mode of the same underlying bug (sending unprocessed prose as a search string). Both of today's non-tag query shapes are confirmed empirically worthless, from opposite directions. The new phrase's own yield stays unmeasured live, but N's mechanism itself (comma-splitting producing real phrases) is independently verified by the unit tests in Step 5, and B's reused "LiCoO2"/"lithium cobalt oxide" references show real short phrases land in the 40-100% range B already established as the benchmark for "a real phrase works."

**Noted in passing, not acted on (out of this item's ruling):** `openalex.ts`'s own `quoteImportantTerms` only wraps a query in quotes when it has <=5 words; the new 6-word derived phrase ("PhD research on solid-state battery materials") is one word past that threshold, so OpenAlex still receives it unquoted (fuzzy search), the same as the old raw paragraph was. This is a pre-existing adapter quirk unrelated to `phrasesFromText`/`projectQueries`, not something §1ay's ruling asked me to touch — flagged here for the manager, not fixed.

Probe file confirmed deleted (`web/src/lib/feed/query-quality-probe.test.ts` no longer exists; `git status` shows it in neither the diff nor untracked).

**Process note (self-flagged):** the probe file, while it existed, needed a real filesystem path to call `writeFileSync` against, and I wrote the literal scratchpad path (which embeds the Windows account name) directly into that constant, instead of only ever writing `<scratchpad>/...` in repo files as the standing constraint requires. The file was never staged or committed and is now deleted (confirmed above), so nothing reached git history, but the letter of the constraint was broken for the several minutes the file existed on disk. Flagging this plainly rather than omitting it.

---

## Step 6b — gates AFTER all edits (from web/)

- `npx vitest run` → **Test Files 283 passed | 3 skipped (286)**; **Tests 5152 passed | 6 skipped (5158)** — 286 files matches baseline exactly (probe file was deleted before this run); tests = baseline 5148 + 4 new QUERY-QUALITY tests = 5152, exactly as expected. 0 failures.
- `npx tsc --noEmit` → **0 errors** (no output) — matches baseline.
- `npx eslint .` → **0 errors / 151 warnings** — matches baseline exactly (same warning set, spot-checked).
- `npm run build` → **Compiled successfully**, TypeScript finished, all 29 routes generated, same route list as baseline. OK.

All four gates match or exceed the stated baseline. No regressions.

---

## Final state

**Changed files** (`git diff --stat` from repo root):
- `web/src/lib/feed/profile-compiler.ts` (+24/-4): `phrasesFromText` chunk-split now includes commas (N); new `literalQueryIfShort`/`MAX_LITERAL_QUERY_WORDS` helper (F); `projectQueries` calls it instead of splicing `project`/`challenge` in unconditionally.
- `web/src/lib/feed/profile-compiler.test.ts` (+73/-4): rewrote 2 ABBREV-RECALL pinned-array tests (new QUERY-QUALITY-fixed values, computed by direct execution); added a new `describe` block with 4 QUERY-QUALITY tests.
- `web/src/lib/opportunities/pool-cache.ts` (+14/-1): `PAPER_CACHE_KEY_VERSION` 14 → 15, with a new explanatory paragraph in the existing per-bump comment chain.
- `web/src/lib/opportunities/pool-cache.test.ts` (+7/-7): updated the historical-chain comment (not an assertion) to lead with v15/QUERY-QUALITY.

**Not changed** (confirmed in scope review, Step 1): `SearchBrief.project`/`.challenge`/`.currentProjectSummary`, `briefToSeedTexts`, `pipeline.ts`'s three `generatedQueries`/semantic-channel call sites, `rerank.ts`, `tier2-rerank.ts`, `activeQuestions`/`niceToHave`/`materialsOrDatasets` construction (only their upstream INPUT quality changed, not their own logic), Option D (bare-keyword dedup against a surviving phrase) and Option S (stop-list) — neither shipped, per the ruling's "Ship F + N together" (D and S are not in the binding ruling).

**BLOCKED:** none. No permission denial encountered. The only unresolved item is the NEW phrase's own live OpenAlex qualify-rate (429 on my 2nd call) — recorded as an honest measurement gap in Step 4, not a BLOCKED implementation step; the fix itself is not gated on that number (the ruling authorized "up to 8 calls," not a mandatory successful measurement).

**Escape clause:** did not trigger (Step 1 enumeration found no reader-visible literal text sourced from `phrasesFromText`'s output anywhere in the app).

Ready for fresh A review.
