STATUS: VERIFIED

# QUERY-QUALITY — Agent A independent review

Reviewing (uncommitted): web/src/lib/feed/profile-compiler.ts (+ test), web/src/lib/opportunities/pool-cache.ts (+ test).
Branch Jev-integration-and-sorting-filtering-enhancement, HEAD bda38077.

Binding rulings: ABC-JEV-INTEGRATION.md §1ay (F+N only, ≤6-word literal rule, cache 14→15, no stop-list), §1av (tags first), P1 exact-sense queries must not change.

Checks to perform, appended as completed:
1. Rulings-by-reading
2. C's consumer enumeration
3. Real effect (fixture + 2 constructed project texts, before/after query slots)
4. Tests real / pinned lanes still pinned
5. Mutation test (raw text as query -> red test -> restore, hash-verified)
6. Full gates (vitest, tsc, eslint, build)
7. Reality check against local dev server (<=2 POST /api/feed)
8. Privacy sweep

## 1. Rulings by reading — PASS

Read §1ay directly in ABC-JEV-INTEGRATION.md (lines 245-253) and the actual diff (`git diff` on all 4 changed files, not C's prose description).

- **(F) 6-word literal rule:** `MAX_LITERAL_QUERY_WORDS = 6`; `literalQueryIfShort` returns the trimmed text only when `split(/\s+/).length <= 6`, else `undefined`. Matches ruling exactly: "never send a raw project/challenge text longer than 6 words as a query" (>6 excluded) and "a text of 6 words or fewer is already a phrase and stays as one query" (<=6 included). `cleanList` already drops `undefined`/empty entries (pre-existing `(raw ?? "").trim()` guard at line 94) — confirmed no signature change was needed, verified by reading `cleanList`.
- **(N) commas:** chunk-split regex changed from `/[.;:\n]|(?:\s+-\s+)/` to `/[.,;:\n]|(?:\s+-\s+)/` — comma added, nothing else touched (word-cap `<=10` for `longPhrases`, `max` cap unchanged). Matches ruling.
- **No stop-list:** confirmed no new word list added anywhere in the diff. The pre-existing `STOPWORDS` set (lines 70-88, 16 entries: about/after/against/also/and/are/between/from/into/that/the/their/this/through/using/with/without) is untouched by the diff (not in the `git diff` output) and predates this ruling — it filters grammatical function words for the single-keyword fallback, not "generic domain words" (Option S, rejected). Correct not to touch it.
- **Cache 14->15 via single exported prefix:** `PAPER_CACHE_KEY_VERSION` 14->15 (pool-cache.ts diff, one-line change) drives `PAPER_POOL_KEY_PREFIX = `peer-pool-v${PAPER_CACHE_KEY_VERSION}-papers-`` (line 293, unchanged code, already derives from the constant — confirmed this is the only place `PAPER_POOL_KEY_PREFIX` is defined, by reading the full file). New explanatory paragraph appended to the existing comment chain in the same style as v7..v14. `pool-cache.test.ts`'s diff is comment-only (verified via `git diff`: only the historical-chain comment text changed, no assertion lines touched).
- **§1av (tags first) not disturbed:** `baseQueries` assembly order (`exactSenseQueries, topics, projectTerms, ...`) is byte-identical in the diff — 0 lines touched in that block. **P1 exact-sense queries:** `exactSenseQueries` line and its position are untouched.

No discrepancy between the ruling text and the shipped diff.

## 2. C's consumer enumeration — PASS (independently re-derived, not just re-read)

Own greps (not copied from C's file):
- `phrasesFromText` calls: 5 hits, all inside `web/src/lib/feed/profile-compiler.ts` (lines 161,163,164,210,211 in the current file) — matches C's table exactly, zero other callers anywhere in `web/src`.
- `generatedQueries` readers outside profile-compiler.ts: `pipeline.ts:635` and `:1217` (`.fetch()` queries param, retrieval only), `pipeline.ts:727` (folded into `semanticQueryText` alongside `brief.project`/`brief.challenge` raw fields — read directly, confirmed by my own `Read` of that block), test files only otherwise (`profile-compiler.test.ts`, `upload-concepts.test.ts`, a comment in `sense-context.test.ts`). No `.tsx`/`.jsx` hit.
- `activeQuestions`/`niceToHave`/`materialsOrDatasets`: only readers are `tier2-rerank.ts:107,109` (LLM prompt JSON context) and `rerank.ts:61-62` (numeric `overlapScore`, 0..1) — both non-literal-display, matches C's claim.
- Own separate grep for `activeQuestions|niceToHave|materialsOrDatasets|generatedQueries|currentProjectSummary` across `*.tsx`/`*.jsx` in `web/src`: **zero matches** — confirms no UI component renders any of these fields as text.
- Own check of `FeedPipelineResult` (pipeline.ts): `extends FeedResponse { finalPool?: ScoredItem[] }` — no `brief` field, confirming the `SearchBrief` object itself is never returned to a client. Grepped `web/src/app` for `SearchBrief`/`compileSearchBrief`: zero hits (no API route touches it directly).

Escape clause correctly not triggered. C's enumeration is accurate.

## 3. Real effect — before/after query slots (battery fixture + 2 A-constructed fixtures)

Method: one temporary probe `web/src/lib/feed/qq-a-probe.test.ts` (created, run twice, deleted — see below), calling the real `compileSearchBrief` and printing `generatedQueries.slice(0,2)` (= what dblp/pubmed send) and `.slice(0,3)` (= what openalex/semantic_scholar/arxiv send); confirmed this slicing matches the real adapters' own `buildSearchQueries` truncation by reading `openalex.ts:111-120` and `dblp.ts:121-123` directly (both do `dedupe → slice(0, MAX_QUERIES)` over `queries` when `queries.length>0`, order-preserving; no other transform that would reorder these specific fixtures' outputs). "Before" = HEAD content of `profile-compiler.ts` (`git show HEAD:...`), written in as a temporary mutation, probe run, then the fixed content restored (see hash proof after check 5, they share one restore). Fixtures: **A** = the given `BATTERY_PROJECT_TEXT` (tag "LCO"); **B** and **C** below are constructed by me, distinct in domain and wording from B's/C's own fixtures:
- **B** (perovskite PV, tag "MAPbI3"): "I'm a postdoc studying perovskite solar cell stability, focusing on halide segregation, interfacial defects, and encapsulation strategies for long-term outdoor operation. The main challenge is correlating accelerated aging tests with real-world degradation rates."
- **C** (NLP, tag "mBART"): "My research group works on transformer-based language models for low-resource machine translation, particularly data augmentation, cross-lingual transfer, and evaluation metrics for morphologically rich languages. We want more efficient fine-tuning methods that need less labeled data."

| Fixture | BEFORE first2 (dblp/pubmed) | BEFORE first3 (+openalex/S2/arxiv) | AFTER first2 | AFTER first3 |
|---|---|---|---|---|
| A battery/LCO | `[LCO, <290-char raw paragraph>]` | `[..., "research"]` | `[LCO, "PhD research on solid-state battery materials"]` | `[..., "research"]` |
| B perovskite/MAPbI3 | `[MAPbI3, <253-char raw paragraph>]` | `[..., "postdoc"]` | `[MAPbI3, "I'm a postdoc studying perovskite solar cell stability"]` | `[..., "focusing on halide segregation"]` |
| C NLP/mBART | `[mBART, <244-char raw paragraph>]` | `[..., "research"]` | `[mBART, "particularly data augmentation"]` | `[..., "cross-lingual transfer"]` |

**Judgment: genuinely better, with one confirmed residual.** BEFORE, every fixture's dblp/pubmed budget (2 slots) was `[tag, entire raw paragraph]` — 100% of the non-tag budget spent on a string the ruling's own live measurement showed returns almost nothing usable (B/C's OpenAlex probe: the raw paragraph query returned 1 in-window candidate that didn't even qualify). AFTER, that same slot is a real, short, on-topic phrase in all 3 fixtures. For openalex/S2/arxiv's 3rd slot: fixtures B and C now get a real multi-word phrase where they used to get a bare generic word ("postdoc", "research") — a genuine improvement, not just noise removal. **Fixture A (the exact fixture the binding ruling's own numbers are drawn from) still sends "research" as its 3rd slot, unchanged** — same generic single word B measured at 117,064 in-window candidates / 0 of 25 sampled qualifying. Cause, traced by hand through the real function: `BATTERY_PROJECT_TEXT`'s only comma sits in its first clause; both remaining sentence-chunks are >10 words, so only ONE `longPhrase` (6 words) is produced, `phrasesFromText(project, 5)` fills the other 4 of its 5 slots from single keywords ("research","solid-state","battery","materials"), and "research" — first in text order — lands right after the one real phrase, inside the first-3 window once the tag consumes slot 0. This is not a defect against the ruling (Option S — a word stop-list — was explicitly rejected by the manager, and Option P/D — a minimum-phrase floor / redundancy dedupe that would suppress a lone leftover word — were explicitly not ordered shipped); it is a real, measured, honest residual worth flagging for the manager as a possible QUERY-BUDGET/Option-P follow-up. **Finding QQ-A-1 (MEDIUM)** — see ranked findings below.

Probe file `web/src/lib/feed/qq-a-probe.test.ts`: created, run against HEAD content, run again against fixed content, then deleted — confirmed removed (`git status` shows only the 2 expected modified files under `web/src/lib/feed/`, no untracked probe).

## 4. Tests real; pinned lanes really pinned — PASS, with one judgment call worth flagging

- **Tests are real**, not fabricated: independently ran `npx vitest run src/lib/feed/profile-compiler.test.ts` → 15/15 pass (matches C's report). Read every new assertion myself (not just C's description) — they assert on the real `compileSearchBrief` return value, no mocking of the function under test.
- **Tags-first lane** (`describe("compileSearchBrief tag-first intent lanes"...)`, lines 14-143) and **P1 exact-sense queries** (the `exactSenseQueries`-only tests inside that same block, e.g. `toEqual(["scanning electron microscopy"])`): confirmed via my own `git diff` on the test file — **zero lines touched** in that entire block. Confirmed in the source diff too: `exactSenseQueries` construction and its position (first) in `baseQueries` is untouched.
- **Tight focus / zero-topic lane — mechanism unchanged, pinned VALUES deliberately rewritten:** the ruling's Tests item ("tight focus and the zero-topic lane unchanged... pin today's outputs where they must not move") reads, in context, as protecting the lane's *filtering mechanism* (zero-topic still returns `baseQueries` unfiltered; tight-focus-with-topic still substring-filters), not as freezing the literal string array forever — those two pinned tests exist specifically to snapshot `projectTerms`'s content flowing through `baseQueries`, and `projectTerms`'s content is the exact thing F+N changes by design. Freezing the old literal array (which contains the full raw paragraph) would be **impossible** to satisfy simultaneously with shipping F. C's diff rewrites both pinned arrays with a comment explaining exactly this, and the filtering code itself (`focusQueries` assembly, `profile-compiler.ts` tight/zero-topic branch) has **zero lines changed** in the diff — only the input values changed, not the mechanism. I independently verified the new pinned values are correct (not fudged) by hand-tracing `phrasesFromText`/`literalQueryIfShort` against `BATTERY_PROJECT_TEXT` myself (see check 3's fixture-A trace) and by the fact that my own from-scratch probe run against the fixed code (check 3) produced the identical array for the same inputs. Judged: correct interpretation, correctly executed — flagged as **LOW** (informational, not a defect) so the manager can confirm the reading.
- No existing lane was weakened: `avoid`, `mustInclude`, `sourceMix`, `niceToHave`/`materialsOrDatasets` construction — all untouched in the diff (confirmed by re-reading the full `git diff` output, not just C's file-list summary).

## 5. Mutation — independently reproduced (not just re-read from C)

Performed my own mutation, separate from C's (C's own mutation record is evidence of C's process, not of mine):
1. Edited `projectTerms` back to raw `project`/`challenge` (undoing F only, leaving N intact) via a targeted `Edit`.
2. Ran `npx vitest run src/lib/feed/profile-compiler.test.ts` → **5 of 15 red**, exact names: both ABBREV-RECALL pinned-array tests, plus 3 of the 4 QUERY-QUALITY tests ("never sends the whole raw project paragraph...", "...challenge paragraph...", "6-word floor..."). The 4th QUERY-QUALITY test ("splits comma-separated clauses...") correctly **stayed green** — it only exercises N, not F, so this is the expected, correct fingerprint of an F-only mutation, not a coincidence.
3. Edited back to `literalQueryIfShort(...)` for both call sites.
4. Verified restore two ways: (a) `git diff -- web/src/lib/feed/profile-compiler.ts` after restore is **byte-identical** (`diff` against a copy of the pre-mutation patch taken earlier, zero output) to the diff captured before any mutation in this review; (b) `sha256sum` of the file immediately before this mutation and immediately after restoring both equal `4145d440ad62edc20bbe31439540ee4984eec921048b8c2f44e0eecb01d48705`. (Note: this differs from the pristine-checkout hash `54345f22d72ed6438605e9666bb457467fe648f9a0386ac8f2c918389f4b39ff` that C reported and that I also measured before touching the file — that's a CRLF-vs-LF line-ending artifact of round-tripping the file through the `Write` tool during check 3's HEAD/fixed swap, not a content difference; `git diff` byte-identity, which normalizes line endings the same way `git` does everywhere else in this review, is the authoritative proof and it matches exactly both times.)
5. Re-ran the suite: **15/15 green again**, confirmed.

## 6. Full gates from web/ — all PASS, all match C's reported numbers exactly

- `npx vitest run` → **Test Files 283 passed | 3 skipped (286); Tests 5152 passed | 6 skipped (5158)**. 0 failed.
- `npx tsc --noEmit` → **0 errors** (no output).
- `npx eslint .` → **0 errors / 151 warnings**.
- `npm run build` → `✓ Compiled successfully in 6.1s`, all 29 routes generated, no errors.

Every number matches C's checkpoint exactly. Ran independently, not copied from C's report.

## 7. Reality check — live local dev server (1 of the ≤2 allowed signed-out POSTs used)

Dev server was already running at `http://localhost:3000` (confirmed with a plain GET before touching `/api/feed`; never started or stopped it, never read its log). Sent **1** signed-out `POST /api/feed` (no cookies, no auth header) with the exact body from `<scratchpad>/lco-req.json` (`{topics:["LCO"], project: BATTERY_PROJECT_TEXT, topN:10}`) → **HTTP 200**, saved to `<scratchpad>/a-live-resp-1.json`, parsed locally (never copied into the repo).

- **`meta.searchBrief.generatedQueries` in the live response** = `["LCO","PhD research on solid-state battery materials","research","solid-state","battery","materials","LCO PhD research on solid-state battery materials","LCO research","LCO solid-state"]` — byte-identical to check 3's "AFTER" trace for the same fixture. Confirms the running dev server is genuinely serving the current, fixed, uncommitted code (hot-reloaded), not a stale build — a useful independent confirmation that my earlier mutate/restore cycles on this file (checks 3 and 5) left it in the correct end state.
- **Items returned:** 10 (`beforeDedup:93, afterDedup:87, returned:10`). `meta.fetched`: `{openalex:51, semantic_scholar:0, arxiv:34, dblp:0, pubmed:8}`; `meta.errors`: `semantic_scholar` hit its own 8s source-timeout (transient, external, unrelated to this diff — its query construction is the same `generatedQueries` list openalex reads), `dblp` failed the same pre-existing "returned HTML not JSON" parse error visible in the OLD saved baseline too (pre-existing and out of scope, not touched by this diff).
- **On-topic count:** read all 10 titles + tags (not just titles). **7/10 clearly on-topic** (items 0,1,2,3,5,7,8 — all explicitly LiCoO2/lithium-cobalt-oxide cathode papers). **2/10 are known, separately-tracked wrong-sense classes** already documented elsewhere in this loop, not caused by this diff: item 4 (rhizosphere/plant-injury LCO-nanoparticle soil toxicology — the same wrong-sense gap B's guide cites at §1ay's own summary) and item 6 (Li2C2O4, a different compound — the exact confusion §1ax/SENSE-CONTEXT-R3 already tracks). **1/10 (item 9, "Magnetism and Electrical Conduction in... Cuprate La2CuO4+δ", tags=`["cond-mat.supr-con"]` only, source=arxiv) is off-topic and unexplained by any prior doc** — a live, concrete instance consistent with finding QQ-A-1 below (arxiv's 3rd query slot, "research", is generic enough to plausibly surface an unrelated condensed-matter paper); I did not chase its exact retrieval/admission path further since that crosses into Required-gate/ranking territory outside this item's scope.
- **Compared with `<scratchpad>/lco-resp.json`** (the earlier saved baseline): that file is a stale, pre-loop snapshot (`returned:0` — it predates REQUIRED-GATE, both SENSE-CONTEXT rounds, ABBREV-RECALL, LCO-FORMULA and DEDUP-ANGEW, all of which shipped since) with its own `generatedQueries` still showing tags-LAST and the full raw paragraph — so it is not a clean isolated A/B for QUERY-QUALITY specifically (check 3's controlled HEAD-vs-fixed trace already provides that). Useful only as a coarse sanity check: `dblp:0` in both (same pre-existing parse error, confirms it's not a regression from this diff); `arxiv` unchanged (34 vs 34); `openalex` up (35→51); `pubmed` down (20→8, plausibly just because the query content changed from the raw paragraph to a real short phrase — a different query naturally returns a different candidate count from a live, ever-changing external index; not itself evidence of a problem).

Did not spend the 2nd allowed call — the 1st answered every question this check asks (live confirmation of the fixed queries, item/on-topic counts, per-source counts vs. baseline); consistent with this loop's own standing discipline of stopping once the question is answered rather than spending the full allowance.

## 8. Privacy sweep — PASS

Grepped all 4 changed/new product files plus this review file itself for the user's email, the Windows account name (both its long and its short 8.3 form), any `C:\Users...`/`C:/Users...` path, and `AppData` — **zero matches**. `git status` at the end of this review shows only the expected diff (the 4 product files + `ABC-JEV-INTEGRATION.md`, pre-modified, not part of this item) plus this review's own new file — no stray probe files, no copied fetched data, no temp artifacts left in the repo; everything transient (the HEAD-content snapshot, both diff captures, the live response) was written only under the scratchpad. C's own checkpoint self-reports that its temporary probe (while it existed, now confirmed deleted) briefly wrote a literal scratchpad path — including the Windows account name — to disk via `writeFileSync`, a letter-of-the-constraint slip C flagged plainly; I found no trace of it in the current working tree or diff (my own grep above covers this).

---

## Ranked findings

**MEDIUM — QQ-A-1: the ruling's own motivating "wasted generic-word slot" is only partially closed, for project texts shaped like the fixture the ruling's numbers are drawn from.** When a project/challenge text produces only one comma/period-split chunk under `phrasesFromText`'s pre-existing ≤10-word cap (its other sentences all run longer), the remaining query slots still fall back to bare single keywords exactly as before, and for the 3-query sources (openalex/semantic_scholar/arxiv) that generic word can still land inside the live per-source window once a Required tag takes slot 0. Reproduced on `BATTERY_PROJECT_TEXT`+tag "LCO" — the exact fixture B measured 117,064 candidates / 0-of-25 qualify for — both before AND after this fix, the 3rd openalex/S2/arxiv slot is the literal word `"research"` (check 3 table). Live-confirmed too: the real dev server's actual 10 returned items for this exact request include one unrelated cuprate-superconductor paper (check 7) consistent with this residual. **Not a violation of §1ay** — the ruling ships F+N only, explicitly rejects a stop-list, and does not order the minimum-phrase-floor or redundant-keyword options B also scoped (Option P/D) — but the manager should know the fix is a partial, not full, close of the problem as measured, and may want to prioritize B's own flagged QUERY-BUDGET/Option-P follow-up sooner rather than later.

**LOW — QQ-A-2: pinned-test reinterpretation, judged correct, worth an explicit sign-off.** The two ABBREV-RECALL "byte-identical" mutation-guard tests were rewritten with new literal arrays (not kept frozen). I judge this the only possible correct choice — freezing them is mutually exclusive with shipping F, since they snapshot exactly the `projectTerms` content F changes — and verified the new values by hand-tracing the real algorithm myself (check 3), not just trusting C's "computed by direct execution" claim. Flagging only because the ruling's own wording ("tight focus and the zero-topic lane unchanged... pin today's outputs where they must not move") is ambiguous between "the lane's filtering mechanism" (untouched, confirmed) and "these literal strings" (necessarily changed) — worth an explicit manager sign-off for the record, not a rework.

**LOW — QQ-A-3: process note, already self-flagged by C, no residual trace found.** C's checkpoint discloses that its own temporary probe briefly wrote a literal scratchpad path (embedding the Windows account name) to disk before deleting the probe file. Never staged or committed; my own privacy sweep (check 8) independently confirms no trace remains anywhere in the current diff or working tree. Recorded here only so the manager sees it was disclosed and independently checked, not because I found a new problem.

**No HIGH findings.**

---

STATUS: VERIFIED


