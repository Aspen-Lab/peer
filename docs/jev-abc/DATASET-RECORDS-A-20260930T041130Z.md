# DATASET-RECORDS — A (independent review)

STATUS: VERIFIED (round 2 — see "RE-CHECK" section below; round 1 STATUS was FAILED_REVIEW on one HIGH finding, superseded)

Reviewer: A (independent reviewer agent)
Repo: D:/local files on this PC/Github/Peer/peer
Branch: Jev-integration-and-sorting-filtering-enhancement
HEAD: 347416f80510c5f9745fe43f6bd66a4884b3c2e3 (PROFILE-SYNC-RETRY-TEST, VERIFIED and committed — confirmed §1bl.7 process ordering)
Started (UTC): 2026-09-30T04:11:30Z
Round 1 finished (UTC): 2026-09-30T04:31:03Z
Round 2 (RE-CHECK) finished (UTC): 2026-09-30T04:52:27Z

Read first: ABC-JEV-INTEGRATION.md §1bl (binding), docs/jev-abc/DATASET-RECORDS-B-20260930T030544Z.md, docs/jev-abc/DATASET-RECORDS-C-20260930T034606Z.md, web/AGENTS.md, docs/PRODUCT_DIRECTION.md, `git diff HEAD -- web/`, plus web/src/lib/utils/openalex.test.ts and web/src/lib/scoring/review-policy.test.ts (the two new test files).

## Verdict

**FAILED_REVIEW — one HIGH finding, proven by execution.** Everything the ruling explicitly directed for the three named OpenAlex adapters is implemented correctly, tested correctly, and passes every gate. But the ruling's own stated goal ("the Papers feed drops clearly non-paper OpenAlex types after fetch") is not actually achieved system-wide: a fourth/fifth real entry point into the exact same scored candidate pool — the advisor/citation-neighborhood channel in `web/src/lib/affiliation/openalex.ts` — was never touched, has no filter, and was not identified by either B's investigation or C's implementation. Proven by code trace plus an executed, now-deleted temporary probe test. See Finding 1 below.

---

## 1. Ruling compliance, point by point (§1bl.1–7)

| # | Ruling text (paraphrased) | Verdict | Evidence |
|---|---|---|---|
| 1 | Fetch OpenAlex's own `type` in every adapter's select + `OpenAlexWork`; `workType` prefers `type`, falls back to `type_crossref` | COMPLIANT | Diff: `type` added to `OpenAlexWork` interface and to all 3 adapters' `select` strings; `workType: cleanDisplayTextOrUndefined(w.type ?? w.type_crossref)`. Confirmed by reverting this line (mutation 3 below) — exactly 2 tests go red, restored, sha256 identical. |
| 2 | Papers feed drops clearly non-paper types after fetch, no new query param; excluded set starts at {dataset} plus documentation-confirmed non-paper types; article/review/preprint/book-chapter kept; borderline (conference-abstract/book/dissertation/report) kept as a lead; dropped record never labeled | **COMPLIANT for the 3 named adapter files, NOT COMPLIANT as a property of "the Papers feed" as a whole** | Filter applied post-fetch, pre-map, no new `filter=` param, in all 3 adapters (confirmed in diff + reproduced by mutation 1). C's 25-type table correctly keeps article/review/preprint/book-chapter and the 4 named borderline types; no label added (mapper.ts/types/index.ts/paper-card.tsx untouched, confirmed). **However** — see Finding 1: a real, live path into the same candidate pool (`web/src/lib/affiliation/openalex.ts`) is untouched and unfiltered, so "the Papers feed" does not actually have this property everywhere records enter it. |
| 3 | Figshare `.vN` version-DOI alias in canonical-identity.ts, DEDUP-ANGEW pattern, additive, Zenodo out of scope | COMPLIANT | `figshareVersionDoiAlias` mirrors `dualEditionDoiAlias` exactly; only adds to `aliasSet`, never changes `key`; scoped to `10.6084` registrant only. Verified by execution — see §5 (alias cases) and mutation 2/4 below. |
| 4 | Review-detection side effect measured BEFORE editing (≤40 GETs, recorded); "Avoid reviews"/review-demotion tests still pass; every changed item listed; STOP if more than a handful flip | COMPLIANT | C's Step 0: 40/40 GETs succeeded, recorded, 1/40 flips (moot — also excluded by type). Independently re-measured on a disjoint 30-id sample (see §3): 2/30 flip, one moot (also excluded), one a genuine correct catch. Confirmed the 5 test files that exercise `isReviewLike`/`shouldPushReviewPaper` (`pipeline.score-zero.test.ts`, `rerank.test.ts`, `scoring/negative-penalty.test.ts`, `scoring/review-policy.test.ts`, `scoring/sense-context.test.ts`) are NOT among the suite's 3 skipped files (verified: the only `describe.skip`/`skipIf` blocks in the whole suite are environment-gated — no live Postgres, no live network opt-in, no local Python — none related to reviews) and all pass in the full run (0 failed). |
| 5 | `PAPER_CACHE_KEY_VERSION` 18 → 19; DBLP/PubMed types and other repos' version conventions are leads, not shipped | COMPLIANT | Confirmed in diff; doc-comment chain extended in the same style as v14–v18; `sources/dblp.ts`/`sources/pubmed.ts` untouched (not in diff). |
| 6 | Required tests (dataset excluded; preprint+review survive; type-preference+fallback; alias merges the pair and leaves unrelated DOIs apart; review detection through workType); mutations (drop filter → dataset test red; drop alias → merge test red) | COMPLIANT | All test categories present and read in full. Both named mutations reproduced independently — see §6. |
| 7 | Process: C starts only after PROFILE-SYNC-RETRY-TEST's gates finish (one writer at a time) → fresh A → local commit | COMPLIANT | HEAD (347416f8) IS the PROFILE-SYNC-RETRY-TEST commit; its own commit message records an independent A VERIFIED with the exact baseline (292 files/5435+6/0 failed) that both my task brief and C's checkpoint cite. All DATASET-RECORDS work is uncommitted on top of that HEAD — confirms ordering. |

---

## 2. The excluded set (8 types)

**Vocabulary check (1 of the allowed 2 GETs used):** `GET https://api.openalex.org/works?group_by=type` (recorded: `<scratchpad>/a-vocab-group-by-type.json`) → `groups_count: 25`, and the 25 listed key_display_names are exactly: article, dataset, book-chapter, conference-paper, other, dissertation, preprint, book, paratext, conference-abstract, reference-entry, report, book-review, libguides, peer-review, editorial, review, erratum, letter, standard, supplementary-materials, software, retraction, data-paper, software-paper. This matches C's table exactly, entry for entry; **"grant" is absent**, confirming C's claim that it was correctly NOT added. 1 GET used, 1 held in reserve (not needed).

**Per-type judgment (independent), the 8 dropped types:**

| Type | My judgment | Reasoning |
|---|---|---|
| dataset | Correct drop | Raw data, not prose; the reproduced bug itself. |
| paratext | Correct drop | Journal front/back matter — structurally never research content. |
| **peer-review** | Correct drop | A referee report/decision letter about one manuscript's review process — administrative correspondence, not a research finding. Confirmed live in both C's sample and my own independent sample ("Decision letter for ..." — a paper TITLE referenced inside an administrative record, not itself a paper). Some journals (e.g. eLife) publish full review histories, but a specialist who wants that reads it from the original paper's own page, not as a new daily-feed item. |
| erratum | Correct drop | A short notice correcting an earlier paper — not new research. |
| **retraction** | Correct drop, with a named gap | A bare notice that some other paper was withdrawn is not itself something to read in a 10-item daily forecast — it teaches nothing about the science, and `docs/PRODUCT_DIRECTION.md`'s "ten precise items are better than one hundred noisy items" cuts toward not spending a slot on it. The real, useful version of "tell me a paper in my field was retracted" is a different feature — flagging retraction status on papers the reader has ALREADY saved/read — which this item correctly does not invent. C's table names this reasoning implicitly ("same administrative-notice family as erratum"); worth being explicit that this is an accepted, correctly-scoped-out gap, not an oversight. |
| libguides | Correct drop | Librarian how-to pages — not scholarly content. |
| supplementary-materials | Correct drop | Raw attached files, not standalone reading content; the parent paper is the thing to show. |
| software | Correct drop | Registered code/software release — same non-textual-artifact shape as dataset. |

No exceptions found. The borderline KEEP set (conference-abstract, book, dissertation, report) and the new-lead KEEPs (letter, reference-entry, standard, other, editorial, book-review, data-paper, software-paper, conference-paper) all match the ruling's explicit instructions or are conservatively, correctly left alone pending more evidence (letter's reasoning — Applied Physics Letters is a real venue in this exact field — is specifically good judgment).

---

## 3. Review-detection side effect — independent sample

Built an independent sample disjoint from C's own 40 ids: scanned the same scratchpad pools (`<scratchpad>/out/*.json` + `prod-lco-resp*.json`), found 407 distinct OpenAlex ids (C found 403 — my scan didn't exclude B's "derived sample" subsets, a safe superset), removed C's 40, deterministically sampled 30 of the remaining 367 (lexicographically evenly spaced — a different selection method than C's insertion-order spacing, for independence). Script/output: `<scratchpad>/a-sample-other-ids.mjs` / `.json`.

Fetched `type` for all 30 (unauthenticated `GET /works/<id>?select=id,title,type`, one request per id, 120ms apart; every URL recorded at `<scratchpad>/a-other-types-requests.json`; results at `<scratchpad>/a-other-types-results.json`). **30/30 succeeded, 0 errors.**

Type distribution: article 25, peer-review 1, review 1, dissertation 1, dataset 1, other 1.

Applying the real `isReviewLike` logic (REVIEW_PATTERNS + the workType branch, copied verbatim from `review-policy.ts`) to title-only (matching C's own method, since this GET didn't fetch abstract either):

- **2/30 newly flip** to review-detected via the revived `workType`:
  - `openalex:W4410387926`, type `peer-review`, "Decision letter for..." — **moot**: also caught by `isExcludedOpenAlexType` (peer-review is dropped), so it never reaches scoring either way. Same pattern C found in their own sample.
  - `openalex:W4414564266`, type `review`, "High energy density lithium battery systems: from key cathode materials to pouch cell design" — a genuine review article with no signal word in the title. **This is the correct, intended catch** — the entire reason for reviving `workType` is to catch exactly this case (a real review whose title doesn't self-identify). It is demoted, not excluded, per unchanged `shouldPushReviewPaper` policy — still shown if it matches the reader's own project text.
- `openalex:W7212231591` (the real O2-LCO-DATA base record) appears in this independent sample too — correctly flagged `wouldBeExcluded: true`, a direct live cross-check of the fix against the actual reported bug.
- **0 genuine papers wrongly dropped or wrongly suppressed.** No article-typed item was excluded; the only two type-based exclusions in this sample are the dataset itself and the peer-review decision letter, both correct.

Combined with C's 1/40 (disjoint ids, 70 total distinct ids checked between us): 3/70 ≈ 4.3%, consistently well under the "more than a handful" STOP threshold, and every flip is either moot or correct-by-design.

---

## 4. Scope of the filter — FINDING 1 (HIGH)

**Claim to check:** the filter must affect only feed candidate lists; every other OpenAlex read path (single-work lookup, reading page, enrichment, advisor/affiliation code) must be unaffected (a previously-saved dataset must still open).

**Single-work lookup / reading page** (`web/src/lib/papers/fetch-by-id.ts`, backing `/papers/[id]`): calls `openAlexWorkToRawItem` directly, NOT touched by the diff, no filter applied. **Correct** — a dataset the reader saved earlier still opens; this file is deliberately exempt, matching the ruling's design (exclusion is a feed-candidacy decision, not a "does this record exist" decision).

**Enrichment** (`web/src/lib/papers/enrich.ts`'s `fetchSemanticScholarText`, used by fetch-by-id.ts to backfill missing abstracts): unrelated to `type`, untouched, no impact.

**Manual search** (`web/src/app/api/papers/search/route.ts`, backing `/search`): hits OpenAlex directly but builds its own response shape — never calls `openAlexWorkToRawItem`, never touches `RawItem`/`paperItems`/dedupe/scoring. Architecturally a distinct feature (a reader's own explicit query), correctly out of scope; not part of "the Papers feed."

**Evaluation harness** (`web/src/lib/evaluation/live-channels/*`): confirmed by reading its own header comment to be an offline benchmark/measurement runner used by this ABC campaign's own agents, deliberately reimplemented separately from production code, never reached by a real Peer user. Correctly out of scope.

**Advisor/affiliation code — the actual gap.** `web/src/lib/affiliation/openalex.ts`'s `fetchCitationNeighborhood`:
- has its OWN `WORK_SELECT` constant (line 34-35), **still `type_crossref`-only**, not touched by this diff at all;
- calls `openAlexWorkToRawItem` directly at two call sites (`fetchAdvisorSeeds`'s ranking map, and `fetchCitationNeighborhood`'s own return), with **no `isExcludedOpenAlexType` filtering anywhere in the file**.

This function is not a side path — it feeds the exact same scored, deduped candidate pool the three fixed adapters feed, confirmed by code trace in `web/src/lib/feed/pipeline.ts`:
- **Build time:** `affiliationPromise` (pipeline.ts:712-717) calls `fetchCitationNeighborhood` whenever a reader has a configured advisor with seed works; its result (`affiliationItems`) is pushed into `allItems` at line 867 with the pipeline's own comment directly above it: *"Merge advisor neighborhood papers into the candidate pool. They're OpenAlex works, so they flow through dedup + scoring like any other source."* `allItems` becomes `paperItems` (line 890-892) → `dedupItems` (893) → scoring → the shown feed.
- **Read time:** `fetchSeedCitationsLeg` (pipeline.ts:1547-1562) calls the same `fetchCitationNeighborhood` for the "positive seed" citation-neighborhood channel (fed whenever a reader has liked ≥1 paper with a resolvable OpenAlex id — not a rare configuration, this is the core feedback loop `docs/PRODUCT_DIRECTION.md` names as a first-class feature). Its output becomes part of `channelItems` → `poolItemsWithSeeds` (pipeline.ts:2047-2050) → `dropStale` → `scorePaperCandidates` → the shown feed.

**Proved by execution**, not just by reading: wrote a temporary probe (prefix `__a_dataset_probe_`, per the review's own constraints) at `web/src/lib/affiliation/__a_dataset_probe_citation-gap.test.ts`, mocking `fetch` to return a single `type: "dataset"` work through `fetchCitationNeighborhood`. Ran via `npx vitest run` — **1 passed**: the dataset-typed item survives unfiltered (`items` equals `["openalex:W_DATASET_PROBE"]`, not `[]`). Deleted immediately after; `git status --short | grep -i probe` → no output (clean, confirmed).

**Why this is HIGH, not a lead:** the entire point of this item is to stop a non-paper OpenAlex record (the exact O2-LCO-DATA shape) from occupying a Papers-feed slot. This proves that goal is not met for a real, broadly-reachable, already-shipped path — any advisor's citation neighborhood, or any reader's own liked-paper citation neighborhood, can surface a dataset, a peer-review decision letter, a retraction notice, etc. exactly as before this fix, with zero protection. Neither B's investigation (Task 1's "every build-time and read-time path... is equally exposed" claim lists only `fetchOne`/the source-retry path/`dedupItems`' 4 merge points — it never examines `affiliation/openalex.ts`, despite that file sharing the same `openAlexWorkToRawItem` conversion B's own claim hinges on) nor C's implementation (which only touched the 3 files B named) caught this. This matches this campaign's own established bar for a HIGH, review-blocking finding (c.f. §1bi.8's "record present, PDF gone" and "transient ≠ permanent" — both HIGH because they left the item's own target bug class reachable through an unaddressed path).

**Suggested fix shape (not applied — reviewers don't fix product code):** add `type` to `affiliation/openalex.ts`'s `WORK_SELECT` and apply `isExcludedOpenAlexType` at both `openAlexWorkToRawItem` call sites in that file, the same pattern already used in the 3 adapters; add the same 3-test pattern (dataset excluded, article+preprint survive, `type` present in select) to `affiliation/openalex.test.ts`.

---

## 5. The alias — executed cases

All from the real, restored source (not mutated at time of running), via `npx vitest run` on `canonical-identity.test.ts` + `dedup.test.ts` as part of the full suite (§7) — every one of these passed:

- Merges the real O2-LCO-DATA pair (base `10.6084/m9.figshare.33608659` + versioned `...v4`) into 1 survivor via `dedupItems`, both arrival orders.
- Two unrelated Figshare DOIs (`.../11111` vs `.../22222.v1`) stay apart (2 results, not merged).
- A Zenodo versioned-looking pair (`10.5281/zenodo.99999` vs `...v2`) stays apart — confirms Zenodo is genuinely out of scope, not merely undocumented.
- Unit level: a versioned DOI gets exactly one extra `doi:` alias to its base sibling's own key; an already-base DOI gets no alias; wrong registrant (Zenodo, exact `.vN` shape) gets no alias; two different Figshare works never cross-alias; a hyphen-joined (`-v4-experiment`) or dotless (`v4`, no dot) suffix — which only LOOKS version-like — correctly gets no alias (accepted, safe-direction miss, as designed); case/prefix-insensitivity (`HTTPS://DOI.ORG/... .V4`) still resolves and aliases correctly.
- **Additivity confirmed structurally**: the alias is added to `aliasSet` only, `key` is always `doiCandidate` itself (verified by reading `canonicalPaperKey`'s full body in the diff) — never changes which record is `key`, only what it can be found by.

---

## 6. Mutation proof (4 mutations — the 3 named in the ruling + 1 I added per the review brief)

All performed by hand, one at a time, from the real starting state; sha256 (Bash `sha256sum`) + `git ls-files --eol` + an independent byte-level scan via PowerShell (counting literal CRLF vs bare-LF byte sequences) confirm exact restoration every time.

| # | Mutation | File | Test run | Result | Restore proof |
|---|---|---|---|---|---|
| 1 | Dropped `.filter((w) => !isExcludedOpenAlexType(w))` in `fetchOne` | sources/openalex.ts | `openalex.test.ts` | **2 failed, 10 passed** (matches C's own claim exactly) | sha256 `736454bf...832927` ✓; PowerShell: 163 CRLF / 0 bare-LF, unchanged |
| 2 | Dropped `if (figshareAlias) aliasSet.add(figshareAlias);` | canonical-identity.ts | `canonical-identity.test.ts` + `dedup.test.ts` | **5 failed, 84 passed** (matches C exactly) | sha256 `7f7f68ee...56b04a` ✓; PowerShell: 0 CRLF / 332 bare-LF, unchanged |
| 3 | Reverted `workType` to `w.type_crossref`-only | utils/openalex.ts | `openalex.test.ts` (utils) | **2 failed, 31 passed** (matches C exactly) | sha256 `c226ab8c...748fccbaa0` ✓; PowerShell: 264 CRLF / 0 bare-LF, unchanged |
| 4 | **NEW — widened `FIGSHARE_VERSION_DOI_RE` from `10\.6084` to any registrant (`\d+\.\d+`)** | canonical-identity.ts | `canonical-identity.test.ts` + `dedup.test.ts` | **2 failed, 87 passed**: exactly "does not alias when the registrant is not 10.6084..." and "leaves a non-Figshare (e.g. Zenodo) versioned-looking DOI pair unmerged..." | sha256 `7f7f68ee...56b04a` ✓ (same file, second mutation, independently restored and re-verified) |

Mutation 4 is a **negative finding — no gap**: the ruling asked me to check whether widening the alias's registrant scope is actually caught by a test ("if none does, that is a finding"). It is: exactly the two tests built for this purpose catch it, cleanly, with no collateral failures. The registrant scoping is properly pinned.

Final sweep after all 4 mutations: all 6 changed production files' sha256 match their pre-mutation values exactly, `git status --short -- web/src` shows the identical M/?? set present at session start (no stray files, no leftover mutation).

---

## 7. Gates (run from `web/`, one at a time, at the fully-restored state)

| Gate | Command | Result | vs. stated baseline (292/5435+6/0, tsc 0, eslint 0/151, build OK) | vs. C's claim (294/5497+6/0, tsc 0, eslint 0/151, build OK) |
|---|---|---|---|---|
| Tests | `npx vitest run` | **291 passed + 3 skipped (294 files) / 5497 passed + 6 skipped (5503 tests) / 0 failed** | +2 files, +62 tests, all new | **Exact match** |
| Types | `npx tsc --noEmit` | 0 errors | unchanged | **Exact match** |
| Lint | `npx eslint .` | **0 errors, 151 warnings**; grepped full output for every DATASET-RECORDS-touched filename — zero hits | unchanged | **Exact match** |
| Build | `npm run build` | "Compiled successfully", all 29 routes generated, 1 pre-existing Turbopack "unexpected file in NFT list" warning (confirmed identical text to C's description, unrelated to any touched file) | unchanged | **Exact match** |

Also independently confirmed: the vitest suite's 3 fully-skipped files and their tests are all pre-existing, environment-gated (`describe.skipIf` on live-Postgres/live-network-opt-in/local-Python availability) — none relate to reviews or OpenAlex; the 5 test files that exercise review-demotion (`pipeline.score-zero.test.ts`, `rerank.test.ts`, `scoring/negative-penalty.test.ts`, `scoring/review-policy.test.ts`, `scoring/sense-context.test.ts`) all ran and passed.

---

## 8. Privacy scan

Searched the 6 changed production files, the 7 modified/new test files, and the 3 DATASET-RECORDS docs (B guide, C checkpoint, this file) for: email-address-shaped strings, Windows user-profile path fragments, and the specific known account email. Also read both B's and C's prose in full for any embedded personal names (including paper/dataset author names), since the check specifically calls those out.

Result: **clean.** The only email-shaped string found is the pre-existing, already-at-HEAD placeholder outbound contact address the app itself sends to OpenAlex's polite pool (same literal value in all 3 adapters, unchanged by this diff) — not a person's address. No Windows user-profile path fragment anywhere in scope. No match for the account holder's actual email. No paper/dataset author name appears anywhere — every OpenAlex GET in this review and in both B/C's own investigations requested `title`/`type`/`doi` only, never `authorships` content beyond the adapters' pre-existing production field lists, and the one place "author" is discussed in prose (B's guide, describing the pre-existing weak-link matching rule) is abstract algorithm description, not an actual name.

---

## Findings summary

- **HIGH (Finding 1, §4 above):** `web/src/lib/affiliation/openalex.ts`'s `fetchCitationNeighborhood` is a live, broadly-reachable, unaddressed entry point into the same Papers-feed candidate pool the three fixed adapters feed. It still requests only `type_crossref`, never `type`, and applies no `isExcludedOpenAlexType` filtering — so a dataset, peer-review decision letter, retraction notice, etc. reached via a reader's configured advisor or via their own liked-paper citation neighborhood is exactly as unprotected as before this fix. Proven by code trace (pipeline.ts:712-717, 853-867, 1547-1562, 2038-2050) and by an executed, deleted temporary probe test. Neither B nor C identified this path.
- No other HIGH or MEDIUM findings. LOW/informational: dropping `retraction`/`erratum` means no "a paper you already read was later retracted" signal — judged acceptable, correctly named as a separate future feature rather than invented here; not a defect.
- All 7 ruling points independently confirmed compliant on their own terms (Finding 1 is about the ruling's underlying goal, not about C failing to do what was explicitly asked of the 3 named files).
- Alias, mutations (4, including 1 not in the original ruling), gates, and privacy all clean, all executed.

## Report path

docs/jev-abc/DATASET-RECORDS-A-20260930T041130Z.md (this file)

---

## RE-CHECK — round 2 (§1bl.8 AMENDMENT)

STATUS: VERIFIED

Read: ABC-JEV-INTEGRATION.md §1bl point 8 (the AMENDMENT, line 266) and the master-table row (line 3264); the round-2 section of docs/jev-abc/DATASET-RECORDS-C-20260930T034606Z.md (lines 174-304); the full round-2 diff (`web/src/lib/affiliation/openalex.ts`, `affiliation/openalex.test.ts`, `feed/dedup.ts`, `feed/dedup.test.ts`, plus the round-2 additions inside `utils/openalex.ts` and the already-untracked `utils/openalex.test.ts`). No network used this round (none of my checks required an OpenAlex GET).

Round-2 shape, confirmed by reading: `affiliation/openalex.ts`'s `WORK_SELECT` gained `type` (no filter added in this file, by design). `utils/openalex.ts` gained `isExcludedOpenAlexRawItem(item: RawItem)`, keyed on `item.source === "openalex"` + lowercased `item.metadata.workType`, reusing the same `EXCLUDED_OPENALEX_TYPES` set. `feed/dedup.ts`'s `dedupItems` now runs `items = items.filter((item) => !isExcludedOpenAlexRawItem(item))` as its literal first statement (before `identityForRawItem`/clustering/anything else), with an early return if that empties the array.

### 1. Coverage by execution

Not satisfied with reading the new tests — chained the REAL functions myself (temp probe, prefix `__a_dataset_probe_`, at `web/src/lib/feed/__a_dataset_probe_choke-point-e2e.test.ts`, deleted after; `git status --short | grep -i probe` → no output, confirmed clean):

- **Advisor/citation-neighborhood path:** real `fetchCitationNeighborhood` (mocked fetch returning one dataset-typed + one article-typed OpenAlex work) → its raw output still contains BOTH items (confirms this file itself does not filter, the round-2 design choice) → piped into the REAL `dedupItems` → result contains only the article. **Pass.**
- **Adapter path** (sanity re-check, already proven round 1): real `fetchOpenAlexSemantic` → the dataset is already gone after the adapter's own round-1 filter → piped into the REAL `dedupItems` → still just the article (redundant protection, as designed). **Pass.**
- **Liked-paper seed-citation path:** not a separate code path to probe — confirmed by reading `pipeline.ts`'s `fetchSeedCitationsLeg` (line 1547-1562) that it calls the identical `fetchCitationNeighborhood` function used above, with different arguments (ids resolved from positive seeds rather than an advisor's seed works). Filtering behaviour cannot differ by call-site arguments; the advisor-path proof above exercises the exact same function body.

Both probe assertions passed on the first run. Combined with the existing, now-independently-executed suite (`dedup.test.ts`'s 7-test choke-point section, §4 below) this confirms: dataset-typed items on all three named entry paths never reach the scored feed; article-typed items on all three do.

### 2. Scope — every caller of `dedupItems`

`grep -rn "dedupItems(" src --include="*.ts" --include="*.tsx"` (excluding test files) returns exactly 5 call sites, **all inside `web/src/lib/feed/pipeline.ts`**: line 893 (build-time main pool), 1345 (cache-refresh merge), 1860 (offline-retry merge), 2022 (rollover merge), 2049 (read-time seeds merge). No other file in the codebase calls `dedupItems` — confirmed by the grep itself, not by trusting the checkpoint.

Checked each of the coordinator's named "other callers" directly:
- **Manual search** (`app/api/papers/search/route.ts`): does not call `dedupItems` — confirmed round 1 and re-confirmed now (not in the grep results). It builds its own response shape by hand and never touches `RawItem`. **It does not lose datasets, and never did** — a manual search still shows a matching dataset record if OpenAlex returns one. This is consistent with the ruling: the ruling's own scope is "the Papers feed" (passive candidate lists), and B's guide never named search; an explicit, reader-typed query is a different feature by design, unaffected either before or after this item.
- **Events, jobs, tooling**: not in the grep results — no call site.
- **The email dispatcher** (`app/api/jobs/dispatch-digests/route.ts`): does NOT call `dedupItems` directly, but DOES call `runFeedPipeline` (confirmed: `import { runFeedPipeline } from "@/lib/feed/pipeline"`, used at line 519) — the same function whose internals reach `dedupItems`. **This is correct and intended**, not a finding: the daily email is another rendering of the same daily recommendation pool docs/PRODUCT_DIRECTION.md describes, so it should get the same non-paper exclusion, and does, automatically, by going through the shared pipeline.
- **The reading page** (`/papers/[id]` via `papers/fetch-by-id.ts`): does not call `dedupItems` (single-item lookup, no list to deduplicate) — unaffected, confirmed round 1 and unchanged this round.

**Judgment on hiding a type filter inside a function named `dedupItems`:** acceptable to ship, with one LOW note. It is not hidden in the sense that matters most — it has a 13-line doc comment immediately above the filter line explaining exactly what it does, why, and pointing at `isExcludedOpenAlexRawItem`'s own cross-referencing doc comment in `utils/openalex.ts`; and it is directly tested (7 tests naming every entry-path shape, §4 below) plus now independently proven end-to-end by me. It is also an explicit, deliberate ruling requirement (§1bl.8.c: "the exclusion is applied at ONE pipeline choke point"), chosen specifically because a single choke point every current and future caller passes through is more robust against a "6th unfiltered path" than a 4th/5th per-channel copy — a reasonable engineering trade-off, not a shortcut. **The LOW finding:** `export function dedupItems(...)` itself carries no function-level doc comment (checked directly — nothing sits above the signature at line 159), so a maintainer who greps the signature, hovers it in an editor, or reads only the function's name would see nothing suggesting it also excludes records outright rather than only merging duplicates; the explanation exists but only becomes visible once you read into the body. Not a correctness or trust issue (documented in-body, tested, ruling-mandated) — a discoverability polish item, worth a one-line addition (e.g. "Deduplicates AND drops excluded OpenAlex types — see isExcludedOpenAlexRawItem") if anyone touches this function next, not worth a fix round on its own.

### 3. The cross-source guard

Ran the specific guard tests directly (`npx vitest run src/lib/utils/openalex.test.ts src/lib/feed/dedup.test.ts -t "never excludes|cross-source|coincidental|mixed pool"`): **10 passed, 0 failed.** Covers: a PubMed item with `workType: "Dataset"` (the literal, real PubMed `pubtype` value B's original investigation found) is not excluded; a DBLP item with `workType: "dataset"` is not excluded; a 6-source parametrized sweep (arxiv/semantic_scholar/dblp/pubmed/web/hn) with `workType: "dataset"` forced on each is never excluded regardless of source; the mixed-pool test proving a same-string-coincidence PubMed item survives alongside a dropped OpenAlex dataset in the same call. `isExcludedOpenAlexRawItem`'s own first line (`if (item.source !== "openalex") return false;`) is the structural guarantee; the tests exercise it directly.

### 4. Mutations (round 2)

Baseline hashes recorded before touching anything; both Bash `sha256sum` and an independent PowerShell byte-level CRLF/bare-LF scan agree throughout.

| # | Mutation | File | Test run | Result | Restore proof |
|---|---|---|---|---|---|
| 1 | Removed the choke point (`items = items.filter(...)` + its early return) from `dedupItems` | feed/dedup.ts | `dedup.test.ts` | **4 failed, 49 passed.** Precise correction to the coordinator's shorthand: ALL FOUR "dataset is excluded" assertions in the new §1bl.8 describe block go red — including the "adapter entry path" one, since that sub-test hand-builds a `RawItem` and calls `dedupItems` directly with no other protection layer, so it has no defence once the choke point is gone. What stays green: the three "kept type survives" tests in that same block (nothing to exclude), and — separately run — all 3 round-1 adapter test files + `affiliation/openalex.test.ts` (**63 passed, 0 failed**), because those files test the adapters' own independent round-1 filter and never call `dedupItems` at all. Matches C's own claimed counts exactly. | sha256 `d42f69b7...78c57aa` ✓ (Bash + PowerShell agree); PowerShell: 0 CRLF / 279 bare-LF, unchanged |
| 2 | Dropped `,type` from `affiliation/openalex.ts`'s shared `WORK_SELECT` | affiliation/openalex.ts | `affiliation/openalex.test.ts` | **2 failed, 18 passed** — both "sends `type` in ... select parameter" tests (`fetchCitationNeighborhood` AND `fetchAdvisorSeeds`, since they share one `WORK_SELECT` constant); exceeds the coordinator's "a test red" minimum. The "populates metadata.workType from the fetched type" test stays green, correctly — it mocks the response body directly, so it probes the mapping logic, not the request URL, and is unaffected by this particular mutation. | sha256 `894bb35b...978b585` ✓ (Bash + PowerShell agree); PowerShell: 357 CRLF / 0 bare-LF, unchanged |

Final sweep: all 3 round-2-touched production files' sha256 match their pre-mutation values exactly (Bash and PowerShell agree byte-for-byte); `git status --short -- web/src` shows exactly the expected M/?? set, no stray files.

### 5. Gates (round 2, from `web/`, one at a time, fully restored state)

| Gate | Result | vs. C's round-2 claim (294/291+3 skipped, 5525/5519+6 skipped, 0 failed; tsc 0; eslint 0/151; build OK) |
|---|---|---|
| `npx vitest run` | **291 passed + 3 skipped (294 files) / 5519 passed + 6 skipped (5525 tests) / 0 failed** | Exact match |
| `npx tsc --noEmit` | 0 errors | Exact match |
| `npx eslint .` | 0 errors, 151 warnings; grepped full output for every round-2-touched filename — zero hits | Exact match |
| `npm run build` | "Compiled successfully", all 29 routes generated, same pre-existing unrelated Turbopack NFT warning | Exact match |

### 6. Privacy scan (round 2)

Searched all 6 round-2 changed/extended files (`affiliation/openalex.ts`, `affiliation/openalex.test.ts`, `feed/dedup.ts`, `feed/dedup.test.ts`, `utils/openalex.ts`, `utils/openalex.test.ts`) for: email-address-shaped strings, Windows user-profile path fragments, and the specific known account email — same method as round 1. Also re-read both new test sections in full for embedded person/author names.

Result: **clean.** Only the same pre-existing, unchanged app placeholder outbound address found (not personal). No Windows path fragments. No match for the account holder's email. No person or author name anywhere — the new test fixtures use only synthetic titles/ids ("O2-LCO-DATA", "A Fixture Work", "A Fixture Item", "A Paper Citing The Advisor's Work", etc.).

### RE-CHECK verdict

**VERIFIED.** The round-1 HIGH finding is closed: proven by my own independent end-to-end execution (not just by re-reading C's tests) that a dataset-typed record can no longer reach the scored feed through the advisor-neighbourhood or liked-paper-seed paths, while article-typed records still do. The enumeration of every OpenAlex fetch site is confirmed accurate and complete (re-derived independently via the same grep methodology, same conclusion: exactly one gap existed, now closed). Every `dedupItems` caller is inside the feed pipeline itself, so the fix's blast radius is exactly "the Papers feed," matching the ruling; manual search, the reading page, and the email dispatcher all behave exactly as they should (the email dispatcher correctly inherits the protection, by sharing the same pipeline). The cross-source guard holds under direct execution. Both required mutations reproduce exactly (with one precision correction to the coordinator's own shorthand, noted above — a real but harmless imprecision, not a discrepancy in substance). All 4 gates match. Privacy clean. One LOW, non-blocking finding: `dedupItems` itself carries no function-level doc comment surfacing its new exclusion behaviour (the explanation lives only inside the function body) — worth a one-line addition next time this function is touched, not worth its own fix round.
