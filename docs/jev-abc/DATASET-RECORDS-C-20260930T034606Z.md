# DATASET-RECORDS — C implementation

STATUS: IMPLEMENTED_PENDING_REVIEW (round 2 fix complete)

**Role:** C (implementer). Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD 347416f8 at start.

## Plan

0. Measure the review-detection side effect BEFORE any edit: sample <=40 distinct OpenAlex ids
   from the saved scratchpad pools (`<scratchpad>/out/*.json` + `<scratchpad>/prod-lco-resp-*.json`),
   fetch each one's real `type` live, and compute how many would newly count as a review through
   `isReviewLike` once `workType` carries `type`. Escape (STOPPED_ESCAPE) if more than ~5 of 40 flip.
1. Confirm the OpenAlex `type` vocabulary (one docs page or a few API GETs) and rule each observed/
   documented type kept or dropped, one line each.
2. Implement:
   a. `web/src/lib/utils/openalex.ts` — add `type` to the `OpenAlexWork` interface; `workType`
      prefers `type`, falls back to `type_crossref`; add a shared excluded-type check.
   b. 3 adapters (`openalex.ts`, `openalex-topic.ts`, `openalex-semantic.ts`) — add `type` to each
      `select`; apply the post-fetch filter before/at the `.map(openAlexWorkToRawItem)` step.
   c. `web/src/lib/utils/canonical-identity.ts` — additive Figshare `.vN` version-DOI alias,
      following `dualEditionDoiAlias`'s pattern, scoped to the `10.6084` registrant only.
   d. `web/src/lib/opportunities/pool-cache.ts` — `PAPER_CACHE_KEY_VERSION` 18 -> 19, extend the
      doc-comment chain the same way v14-v18 each did.
3. Tests per the guide's Task 4 list; new `review-policy.test.ts` (none exists yet).
4. Mutation-test each of the three named changes by hand (temporarily revert, confirm the named
   test goes red, restore, verify sha256 + line-endings identical to before).
5. Run the 4 gates one at a time (`npx vitest run`, `npx tsc --noEmit`, `npx eslint .`,
   `npm run build`) and compare against the stated baseline (292 files / 5435 passed + 6 skipped /
   0 failed; tsc 0; eslint 0/151; build OK).
6. Finish this checkpoint with IMPLEMENTED_PENDING_REVIEW (or STOPPED_ESCAPE) plus every required
   table/proof.

## Log

- Read ABC-JEV-INTEGRATION.md §1bl (binding ruling) and §1aw (DEDUP-ANGEW pattern this item follows).
- Read the B guide (docs/jev-abc/DATASET-RECORDS-B-20260930T030544Z.md), web/AGENTS.md,
  docs/PRODUCT_DIRECTION.md.
- Read every named source file (openalex.ts adapter + helper, openalex-topic.ts, openalex-semantic.ts,
  sources/types.ts, review-policy.ts, canonical-identity.ts, feed/dedup.ts, feed/paper-identity.ts,
  pool-cache.ts) and the existing test files/conventions they'd need to match.
- Confirmed `identityForRawItem` (paper-identity.ts) passes `item.metadata?.doi` straight into
  `canonicalPaperKey`, so a new alias only needs to be added inside `canonicalPaperKey`'s `aliasSet`
  (exactly where `dualEditionAlias` is added) — no `dedup.ts` change needed, matching ruling §1bl.3's
  "additive" framing and DEDUP-ANGEW's original (pre-AMENDMENT) shape. A DEDUP-ANGEW-style survivor
  preference was NOT ruled for this item (no equivalent finding was made) and is not being added;
  noted as a lead in the findings section below, not invented as scope.
## Step 0 — review-detection side-effect measurement (COMPLETE, no STOP)

Method: read-only script `<scratchpad>/c-dataset-sample.mjs` walked every pool-shaped array in
`<scratchpad>/out/*.json` + `<scratchpad>/prod-lco-resp-*.json` (same pool-detection shape as B's own
`b-dataset-measure.mjs`) and collected every DISTINCT OpenAlex work id seen (403 distinct ids across
44 pool snapshots). Took a deterministic, evenly-spaced sample of exactly 40 of the 403 (reproducible,
not cherry-picked). `<scratchpad>/c-dataset-review-effect.mjs` then made 40 unauthenticated
`GET https://api.openalex.org/works/<id>?select=id,title,type` calls (one per sampled id; every
request URL recorded to `<scratchpad>/c-dataset-review-effect-requests.json`; full per-item results in
`<scratchpad>/c-dataset-review-effect-results.json`; summary in
`<scratchpad>/c-dataset-review-effect-summary.json`). For each item, computed today's `isReviewLike`
(text-only, since `workType` is a dead field in production today) vs. the post-fix version (workType =
the live `type`), reusing `review-policy.ts`'s exact `REVIEW_PATTERNS`/logic.

Result: **40/40 requests succeeded, 0 errors.** Real `type` distribution in the sample: article 35,
peer-review 2, preprint 1, conference-abstract 1, dissertation 1. **Only 1 of 40 (2.5%) newly counts as
a review** — openalex:W7214235000, `type: "peer-review"`, title "Decision letter for \"A Novel
Amorphization Strategy Unlocks Fast Ionic Transport in Low-Cost Halide Solid Electrolytes for
High-Loading All-Solid-State Batteries\"" (a referee decision letter, not itself review-of-a-field
content; its `isReviewLike` flip is arguably correct, not a false positive). The other sampled
`peer-review`-typed item was already text-flagged pre-fix (its own title independently matched a
REVIEW_PATTERNS regex), so it does not newly change.

1 of 40 is well under the "more than a handful (>5 of 40)" STOP threshold in §1bl.4 — **not stopping**,
proceeding with implementation. Side note: both `peer-review`-typed items in this sample will in any
case never reach `isReviewLike` at all once the type-exclusion filter (below) ships, since `peer-review`
is one of the confirmed-dropped types — the measured side effect is therefore moot in practice for this
specific sample, but is reported exactly as measured per the ruling's own terms (workType's effect on
review detection, independent of the exclusion decision).

## Step 1 — OpenAlex `type` vocabulary check (COMPLETE)

Network: one additional unauthenticated API GET (separate from Step 0's 40, as the ruling allows for
this check) — `GET https://api.openalex.org/works?group_by=type` — returned OpenAlex's own live,
authoritative count of every `type` value present anywhere in the whole Works corpus today (raw
response saved at `<scratchpad>/c-dataset-type-vocab.json`). The OpenAlex docs site
(docs.openalex.org) has been restructured/redirects to help.openalex.org, whose new location for this
specific field enumeration could not be found by URL guessing, so the `group_by` aggregation was used
instead — arguably stronger evidence than a docs page, since it reflects the type values OpenAlex
actually assigns in production, not just what's documented.

25 distinct `type` values exist. Decision rule applied: keep everything the ruling already named to
keep (article/review/preprint/book-chapter; the 4 named borderline types); for the rest, drop ONLY a
type that is a non-textual/administrative artifact with no existing softening mechanism elsewhere in
the codebase (the same shape as the reproduced `dataset` bug) or is explicitly named in the ruling's own
example list; keep anything that is itself written prose (even non-primary-research prose), since
`review-policy.ts`'s existing text-pattern heuristic already softens (demotes, never hard-excludes) most
review-shaped prose once workType is revived, and Peer's own standing policy for review-shaped content
is demotion, not exclusion (SCORE-ZERO, §1at: "reviews still rank lower," not "reviews are excluded").

| type | kept/dropped | reason |
|---|---|---|
| article | KEEP | ruled explicitly |
| review | KEEP | ruled explicitly |
| preprint | KEEP | ruled explicitly |
| book-chapter | KEEP | ruled explicitly |
| conference-abstract | KEEP (lead) | ruled explicitly borderline |
| book | KEEP (lead) | ruled explicitly borderline |
| dissertation | KEEP (lead) | ruled explicitly borderline |
| report | KEEP (lead) | ruled explicitly borderline |
| dataset | DROP | the reproduced bug; ruled explicitly |
| conference-paper | KEEP | a full paper presented/published at a conference — same character as "article", not the short "conference-abstract" |
| paratext | DROP | journal-issue front/back matter (covers, indexes, masthead) — structural, not research content; named example |
| peer-review | DROP | referee report / decision letter about ONE manuscript's review, not research content; named example; confirmed live in Step 0's own sample ("Decision letter for...") |
| erratum | DROP | a correction notice for an earlier paper, not new research; named example |
| retraction | DROP | a notice withdrawing an earlier paper — same administrative-notice family as erratum (not itself named, but identical character) |
| libguides | DROP | a librarian's how-to-research guide page, not scholarly content; named example |
| supplementary-materials | DROP | raw extra files attached to a paper, not standalone content; named example |
| software | DROP | a registered code/software artifact (e.g. a Zenodo/GitHub release) — the same non-textual-artifact shape as `dataset`, no existing softening mechanism |
| grant | NOT ADDED | named as a candidate by the guide, but does NOT appear in OpenAlex's live `type` vocabulary (confirmed via the group_by call covering the whole corpus) — not acted on since unconfirmed to exist |
| letter | KEEP (new lead, flagged) | ambiguous: in physics/materials science this is very often a legitimate short-format PAPER genre (e.g. Applied Physics Letters, a leading venue in this exact research field) as well as sometimes an editor's letter — dropping risks losing real, on-topic papers; NOT added |
| data-paper | KEEP | a written, peer-reviewed paper describing a dataset (e.g. Scientific Data) — a real paper genre, distinct from the `dataset` artifact type itself |
| software-paper | KEEP | a written, peer-reviewed paper describing a software tool (e.g. JOSS/SoftwareX) — a real paper genre, distinct from the `software` artifact type itself |
| reference-entry | KEEP (new lead) | an encyclopedia/handbook entry — similar in character to book-chapter (kept); not confirmed "plainly not a paper" to the same standard as the 8 dropped types |
| standard | KEEP (new lead) | a technical/industry standard document — a formal document like report/dissertation (kept), not confirmed "plainly not a paper" |
| other | KEEP (new lead) | OpenAlex's own unclassified catch-all — content unknown, cannot be "plainly" anything; excluding an unknown bucket risks real papers OpenAlex simply failed to classify |
| editorial | KEEP (new lead) | written prose commentary (like "perspective", already one of review-policy.ts's own existing text patterns) — Peer's standing policy demotes review-shaped prose rather than hard-excluding it; not confirmed "plainly not a paper" |
| book-review | KEEP (new lead) | written prose critique of a book — many carry "review" in the title and are therefore already caught by the existing text-based review-demotion heuristic; same demote-not-exclude reasoning as editorial |

Excluded set to ship: `{"dataset", "paratext", "peer-review", "erratum", "retraction", "libguides", "supplementary-materials", "software"}` (8 types). New leads for a future POLICY call (not acted on): letter (caution — do not drop), reference-entry, standard, other, editorial, book-review.

## Implementation (COMPLETE)

Changed files (all additive; nothing pre-existing removed or rewritten beyond the two named preference/filter lines):

1. `web/src/lib/utils/openalex.ts` — added `type?: string | null` to `OpenAlexWork`; added `EXCLUDED_OPENALEX_TYPES` (the 8-type set above), `effectiveOpenAlexType`, and exported `isExcludedOpenAlexType`; `metadata.workType` now `cleanDisplayTextOrUndefined(w.type ?? w.type_crossref)` (was `w.type_crossref` only).
2. `web/src/lib/sources/openalex.ts` — `select` gained `type`; `fetchOne` now does `works.filter((w) => !isExcludedOpenAlexType(w)).map(openAlexWorkToRawItem)` (was a plain `.map`).
3. `web/src/lib/sources/openalex-topic.ts` — same `select`/filter change (filter runs before the existing `.slice(0, limit)`, so an excluded record never counts against the limit).
4. `web/src/lib/sources/openalex-semantic.ts` — same `select`/filter change, same filter-before-slice order.
5. `web/src/lib/utils/canonical-identity.ts` — added `FIGSHARE_VERSION_DOI_RE` + `figshareVersionDoiAlias` (mirrors `dualEditionDoiAlias`, scoped to the `10.6084` registrant and a literal trailing `.v<digits>`); wired into `canonicalPaperKey` the same way (`figshareAlias` computed from `doiValue`, added to `aliasSet` unconditionally, right after the DEDUP-ANGEW alias). No change to `dedup.ts` or `paper-identity.ts` — the alias reaches dedupe automatically via the existing `identityForRawItem` -> `clusterCanonicalWorks` path, confirmed by the mutation test below.
6. `web/src/lib/opportunities/pool-cache.ts` — `PAPER_CACHE_KEY_VERSION` 18 -> 19; doc-comment chain extended with a `v19 —` paragraph in the same style as v14-v18.

New/changed tests (all additive; zero pre-existing assertions weakened or deleted):

- `web/src/lib/utils/openalex.test.ts` (NEW) — `workType` prefers `type`/falls back to `type_crossref`/undefined-when-neither/casing passthrough; `isExcludedOpenAlexType` table-driven over all 8 dropped types and 17 kept types (`it.each`), case-insensitivity, `type_crossref` fallback for the filter too, untyped-record safety, and a pinned-set tripwire.
- `web/src/lib/sources/openalex.test.ts` — new describe block: dataset-typed work excluded; article+preprint survive; `type` present in `select`; the exact O2-LCO-DATA base/.v4 pair (both `type: "dataset"`) reproduced end-to-end through the adapter, resolving to `[]`.
- `web/src/lib/sources/openalex-topic.test.ts` / `openalex-semantic.test.ts` — same 3-test pattern each (dataset excluded; article+preprint survive; `type` in select).
- `web/src/lib/utils/canonical-identity.test.ts` — new describe block mirroring the DEDUP-ANGEW section: versioned->base alias; no self-alias on an already-base DOI; wrong registrant untouched; two unrelated Figshare works never cross-alias; the hyphen-joined/dotless false-positive guards; case/prefix-insensitivity.
- `web/src/lib/feed/dedup.test.ts` — new top-level describe block: merges the real O2-LCO-DATA ids/DOIs (both arrival orders); two unrelated Figshare DOIs stay apart; a Zenodo versioned-looking pair stays apart (out of scope).
- `web/src/lib/scoring/review-policy.test.ts` (NEW — no test file existed for this module before) — `isReviewLike`: a `workType: "review"` item is detected even with a bland title/abstract; `workType: "article"` is not; compound values ("Systematic Review", "REVIEW") match case-insensitively; unrelated workTypes (preprint/dataset/book-chapter/conference-paper) don't false-positive; the pre-existing text-pattern fallback still works when `workType` is absent; the two signals are independent. Plus `shouldPushReviewPaper` sanity checks confirming policy is unchanged (demoted, not excluded).

### Mutation proof (all 3 performed by hand, one at a time; sha256 + `git ls-files --eol` identical before/after every restore)

| # | Mutation | Command | Result | Restored, verified |
|---|---|---|---|---|
| 1 | Dropped the `.filter((w) => !isExcludedOpenAlexType(w))` call in `sources/openalex.ts` | `npx vitest run src/lib/sources/openalex.test.ts` | Exactly 2 red (the dataset-exclusion test + the reproduced-pair test); 10 other tests in the same file stayed green | sha256 `736454bf...832927` matches pre-mutation; `w/crlf` unchanged |
| 2 | Dropped the `if (figshareAlias) aliasSet.add(figshareAlias);` line in `canonical-identity.ts` | `npx vitest run src/lib/utils/canonical-identity.test.ts src/lib/feed/dedup.test.ts` | Exactly 5 red (3 unit alias tests + 2 end-to-end merge tests); 84 other tests across both files stayed green | sha256 `7f7f68ee...56b04a` matches pre-mutation; `w/lf` unchanged |
| 3 | Reverted `workType: cleanDisplayTextOrUndefined(w.type ?? w.type_crossref)` to `w.type_crossref`-only in `utils/openalex.ts` | `npx vitest run src/lib/utils/openalex.test.ts` | Exactly 2 red (the `type`-preference test + a casing test exercising the same line); all `isExcludedOpenAlexType` tests in the same file stayed green (proves the filter is independently implemented, not coupled to this line) | sha256 `c226ab8c...748fccbaa0` matches pre-mutation; `w/crlf` unchanged |

### Gates (all 4, run from `web/`, one at a time, at the final state)

| Gate | Command | Result |
|---|---|---|
| Tests | `npx vitest run` | **294 files (291 passed + 3 skipped) / 5503 tests (5497 passed + 6 skipped) / 0 failed.** Baseline was 292 (289+3)/5441 (5435+6)/0 failed — delta is exactly +2 files (2 new test files: `utils/openalex.test.ts`, `scoring/review-policy.test.ts`) and +62 tests, all newly added by this item (individually tallied against every touched/new test file's own count); zero pre-existing tests removed, weakened, or newly failing. |
| Types | `npx tsc --noEmit` | 0 errors (no output), matches baseline. |
| Lint | `npx eslint .` | **0 errors, 151 warnings** — exact match to baseline; none of the 151 warnings are in any file this item touched (spot-checked: the one file edited after the full run, `sources/openalex.test.ts`, lints clean on its own too). |
| Build | `npm run build` | Succeeded — "Compiled successfully", TypeScript pass finished, all 29 static pages generated, every route listed. The one Turbopack warning printed ("Encountered unexpected file in NFT list", `next.config.ts` -> `lib/papers/pdf-text.ts` -> `app/api/papers/upload/route.ts`) is pre-existing and unrelated — that import trace never touches any file this item edited. |

### Final file list

Production (6): `web/src/lib/utils/openalex.ts`, `web/src/lib/sources/openalex.ts`, `web/src/lib/sources/openalex-topic.ts`, `web/src/lib/sources/openalex-semantic.ts`, `web/src/lib/utils/canonical-identity.ts`, `web/src/lib/opportunities/pool-cache.ts`.
Tests, modified (4): `web/src/lib/sources/openalex.test.ts`, `web/src/lib/sources/openalex-topic.test.ts`, `web/src/lib/sources/openalex-semantic.test.ts`, `web/src/lib/utils/canonical-identity.test.ts`, `web/src/lib/feed/dedup.test.ts` (5, corrected count).
Tests, new (2): `web/src/lib/utils/openalex.test.ts`, `web/src/lib/scoring/review-policy.test.ts`.
Docs (1, this file): `docs/jev-abc/DATASET-RECORDS-C-20260930T034606Z.md`.

No repo file outside this list was touched. `git status --short` at completion shows exactly these entries plus the two items that were already present/modified before this session started (`ABC-JEV-INTEGRATION.md`, already `M` at session start and never touched by C; `docs/jev-abc/DATASET-RECORDS-B-...md` and `node_modules/`, already untracked at session start). No `__c_dataset_probe_*` file was ever created under `web/src/` — every measurement script and its output stayed in `<scratchpad>/` (named `c-dataset-sample.mjs`, `c-dataset-review-effect.mjs`, and their `.json` outputs), the same pattern B's own investigation used, so no probe-file deletion or extra `git status` proof is needed for those.

Round 1 STATUS: IMPLEMENTED_PENDING_REVIEW (superseded — see fix round 2 below, per the fresh A's §1bl.8 AMENDMENT)

## Fix round 2 — §1bl.8 AMENDMENT (fresh A FAILED_REVIEW, one HIGH finding)

Fresh A (docs/jev-abc/DATASET-RECORDS-A-20260930T041130Z.md): everything in round 1 confirmed
compliant (type table, side-effect sample, alias, mutations, gates all independently reproduced).
One HIGH finding: `web/src/lib/affiliation/openalex.ts`'s `fetchCitationNeighborhood` feeds the SAME
scored Papers candidate pool (the advisor citation neighbourhood at build time, pipeline.ts ~712-717/
853-867; the liked-paper "positive seed" citation neighbourhood at read time, pipeline.ts ~1547-1562/
2038-2050) via its own `WORK_SELECT` (`type_crossref` only) with zero `isExcludedOpenAlexType`
filtering anywhere. Proven by A via an executed, deleted temporary probe test.

Ruling (§1bl.8 AMENDMENT, binding): (a) enumerate EVERY OpenAlex fetch under web/src/lib, mark each
"feeds the Papers candidate pool" or not, in a table, file:line; (b) every pool-feeding select fetches
`type`; (c) apply the exclusion at ONE pipeline choke point every OpenAlex-derived candidate passes
before dedup+scoring (both build-time pool incl. advisor neighbourhood, and read-time seeds), keyed on
source "openalex" + metadata.workType via the existing `isExcludedOpenAlexType` — keep the adapter-level
filters too, as defence in depth; (d) tests per entry path (adapter / advisor-neighbourhood / liked-paper
seed), each dataset-typed, excluded; each article-typed, kept; mutation removing the choke point turns
the neighbourhood+seed tests red while the adapter test stays green.

Plan: (1) grep-enumerate every OpenAlex touch point under web/src/lib; (2) read pipeline.ts at the cited
line ranges to find the exact choke point; (3) add `type` to affiliation/openalex.ts's WORK_SELECT;
(4) apply the filter at the pipeline choke point; (5) tests; (6) mutation proof (hash+eol verified);
(7) gates against this round's baseline (294 files/291+3 skipped, 5503/5497+6 skipped, 0 failed; tsc 0;
eslint 0/151; build OK). No network this round (none needed — no new type-vocabulary question).

### Enumeration — every OpenAlex fetch under web/src/lib (ruling point a)

Method: grep for `api.openalex.org`, `openAlexWorkToRawItem` (every call site), `OPENALEX_API`/
`OPENALEX_WORKS_API`/`OPENALEX_TOPICS_API`-shaped constants, and `openalex.org` more broadly across
`web/src`, then read each hit's surrounding code to trace where its output goes.

| # | File:function | What it does | Feeds the Papers candidate pool? | Notes |
|---|---|---|---|---|
| 1 | `sources/openalex.ts:64-110` (`fetchOne`, the `openalex` adapter) | Primary keyword-search channel | **YES** — build-time `fetchPromise` → `allItems` (pipeline.ts:781-797) → `paperItems` → `dedupItems` | Round 1: `type` fetched, `isExcludedOpenAlexType` filter applied right after fetch. |
| 2 | `sources/openalex-topic.ts:78-125` (`fetchOpenAlexTopicField`) | Read-time topic-field channel | **YES** — `fetchTopicFieldLeg` (pipeline.ts:1565-1576) → `channelItems` → `poolItemsWithSeeds` → `dedupItems` | Round 1: filtered. |
| 3 | `sources/openalex-semantic.ts:86-126` (`fetchOpenAlexSemantic`) | Build-time semantic-search channel AND read-time seed-similarity leg (one function, two call sites) | **YES** — build-time `semanticPromise` (pipeline.ts:737-742) and read-time `fetchOpenAlexSeedSimilarityLeg` (pipeline.ts:1515-1545) | Round 1: filtered; both call sites covered by the one adapter-level filter. |
| 4 | `affiliation/openalex.ts:304-343` (`fetchCitationNeighborhood`) | Advisor citation neighbourhood (build time) AND liked-paper seed-citation leg (read time) — one function, two call sites | **YES — THE GAP** — build-time `affiliationPromise` (pipeline.ts:712-717, merged into `allItems` at 853-867) AND read-time `fetchSeedCitationsLeg` (pipeline.ts:1547-1562, merged into `channelItems` at 1623-1626 inside `fetchChannelLegs`, then into `poolItemsWithSeeds` at 2038-2050) | Fixed this round: `type` added to `WORK_SELECT`; no adapter-level filter added here by design — the new pipeline choke point (below) catches it instead. |
| 5 | `affiliation/openalex.ts:228-274` (`fetchAdvisorSeeds`) | Resolves an advisor's own recent works, ranks them by relevance to the reader's project, returns ONLY `{workIds: string[], texts: string[]}` (bias text + anchor ids for #4 above) | **NO** — the RawItems it builds internally (line 258, to rank/extract text) are discarded; only strings leave the function, and those strings are consumed as INPUT to #4 (citation-neighbourhood anchors) and as scoring bias text, never pushed into `allItems`/dedupe/scoring themselves | Gets `type` fetched for free once `WORK_SELECT` is fixed (harmless — this function never reads `workType`). Not filtered, and correctly so: an advisor's dataset-shaped OpenAlex work can still be a legitimate citation-neighbourhood ANCHOR ("find papers that cite this") even though the dataset itself must never appear as a feed item — a different question this item does not need to answer. |
| 6 | `papers/fetch-by-id.ts:12-51` (`fetchOpenAlexPaper`) | Single-work lookup backing `/papers/[id]`, the reading page | **NO — deliberately exempt** | A saved/linked dataset record must still open; this is "does this specific requested record exist," not a candidate-pool admission decision. Untouched, confirmed unfiltered before and after this item. |
| 7 | `papers/enrich.ts` (`fetchSemanticScholarText`) | Abstract backfill, used by #6 | **NO** | Doesn't call OpenAlex at all — hits Semantic Scholar, using an OpenAlex id only as a cross-reference key. |
| 8 | `app/api/papers/search/route.ts` | Manual reader-driven search (`/search`) | **NO** | Hits `api.openalex.org` directly but builds its own response shape by hand (its own local `OpenAlexWork` interface/mapping) — never imports or calls `openAlexWorkToRawItem`, never touches `RawItem`/`paperItems`/`dedupItems`/scoring. An architecturally separate, explicit-query feature. |
| 9 | `app/api/topics/suggest/route.ts` | OpenAlex concept/topic autocomplete for the profile-setup UI | **NO** | Different endpoint entirely (`/autocomplete/concepts`) — doesn't fetch works at all. |
| 10 | `evaluation/live-channels/seed-resolution.ts`, `topic-resolution.ts` (+ `runner.ts`, `live-channels-gate.ts`) | Offline benchmark/measurement harness for this ABC campaign's own agents | **NO** | Confirmed by each file's own header comment ("reimplements... not reusable [from production]... this runner doesn't need"); never reached by a real Peer user. |

Also checked and ruled out as false positives from the broader `openalex`/`OPENALEX` grep: `events/sources/eventweb.ts`
(only EXCLUDES `"openalex.org"` as a domain from its own unrelated web-search results — an events feature, never
fetches OpenAlex), `sources/_fetch.ts` (a doc comment mentioning `OPENALEX_API_KEY` as an example of the generic
header pattern the shared `sourceFetch` wrapper supports — not itself an OpenAlex-specific call site), and every
`*.test.ts` file the grep matched (test-only, not production entry points).

**Conclusion: exactly one gap (#4), exactly as the fresh A found.** No sixth path exists.

### Fix (ruling points b + c)

1. `web/src/lib/affiliation/openalex.ts` — `WORK_SELECT` gained `,type` (kept `type_crossref` too, same
   fallback shape as the 3 adapters). No filter added in this file — see its own new DATASET-RECORDS
   test section, which explicitly pins that this file deliberately does NOT filter itself.
2. `web/src/lib/utils/openalex.ts` — new exported `isExcludedOpenAlexRawItem(item: RawItem): boolean`,
   keyed on `item.source === "openalex"` + `item.metadata.workType` (lowercased), reusing the same
   `EXCLUDED_OPENALEX_TYPES` set round 1 shipped. Returns `false` immediately for any non-openalex
   source — explicitly guards against DBLP/PubMed's own, unrelated `workType` vocabularies (PubMed's
   `pubtype` legitimately includes a value literally named "Dataset" per B's original investigation;
   this must never be caught by an OpenAlex-scoped fix).
3. `web/src/lib/feed/dedup.ts` — THE single pipeline choke point: `dedupItems`'s very first line now
   reassigns `items = items.filter((item) => !isExcludedOpenAlexRawItem(item))` before anything else
   runs (identity computation, clustering, survivor selection). Every current pipeline.ts call site of
   `dedupItems` (build-time `paperItems`, read-time `poolItemsWithSeeds`/`poolItemsWithRollover` merges,
   and any other existing or future merge point) is protected automatically and identically, regardless
   of which channel produced a given candidate — chosen over adding a 4th/5th adapter-level filter
   specifically so a future channel nobody remembers to filter can't reopen this exact gap.

### Tests (ruling point d)

- `web/src/lib/affiliation/openalex.test.ts` (new DATASET-RECORDS section, 4 tests): `type` present in
  both `fetchCitationNeighborhood`'s and `fetchAdvisorSeeds`'s select; `metadata.workType` populated
  from the fetched `type`; and an explicit, commented PINNING test that a dataset-typed item survives
  THIS function unfiltered (the deliberate architecture — filtering happens downstream).
- `web/src/lib/utils/openalex.test.ts` (new `isExcludedOpenAlexRawItem` section, 11 tests, `it.each`
  table-driven): excludes an openalex dataset; keeps an openalex article/untyped item; case-insensitive;
  never excludes a non-openalex item even sharing a coincidental workType string (PubMed "Dataset" /
  DBLP "dataset"); never excludes any of arxiv/semantic_scholar/dblp/pubmed/web/hn regardless of workType.
- `web/src/lib/feed/dedup.ts` test file (new top-level section, 7 tests) — one dataset-typed +
  one article-typed case for EACH of the three entry-path shapes (adapter: `admissionChannel: "keyword"`;
  advisor-neighbourhood and liked-paper-seed: both `admissionChannel: "citation"`, matching the real
  shape both real pipeline.ts call sites give their output — documented as mechanically identical at
  this level, tested as two separately-named cases to cover both real call sites explicitly), plus one
  mixed-pool test proving only the openalex dataset is dropped while a same-workType-string PubMed item
  and a kept openalex article both survive.

### Mutation proof (round 2)

Removed THE choke point — the `items = items.filter((item) => !isExcludedOpenAlexRawItem(item))` line
(plus its guard) at the top of `dedupItems` — by hand, restored, hash + PowerShell byte-level
CRLF/bare-LF count verified identical before/after.

| Check | Result |
|---|---|
| `npx vitest run src/lib/feed/dedup.test.ts` (mutated) | **4 failed, 49 passed** — exactly the 4 tests that assert a dataset-typed item is EXCLUDED (adapter/advisor/seed/mixed-pool); every "kept type survives" test, every pre-existing DEDUP-ANGEW/Figshare-alias test, everything else stays green |
| `npx vitest run` on the 3 round-1 adapter test files + `affiliation/openalex.test.ts` (mutated) | **63 passed, 0 failed** — confirms the adapter tests stay green under this exact mutation, because they test the real adapter functions end-to-end and never call `dedupItems` at all |
| Restore | sha256 (Bash) identical: `d42f69b7...78c57aa`. PowerShell byte-level count: 0 CRLF / 279 bare-LF, unchanged from pre-mutation. |

`affiliation/openalex.ts` and `utils/openalex.ts` were also hash/eol-verified after their own (non-mutated,
implementation-only) edits this round: `894bb35b...978b585` (357 CRLF / 0 bare-LF) and
`577ede40...b99ae5` (297 CRLF / 0 bare-LF) respectively — both Bash `sha256sum` and PowerShell
`Get-FileHash` agree.

### Gates (round 2, from `web/`, one at a time, final restored state)

| Gate | Result | vs. this round's baseline (294/291+3 skipped, 5503/5497+6 skipped, 0 failed; tsc 0; eslint 0/151; build OK) |
|---|---|---|
| `npx vitest run` | **294 files (291 passed + 3 skipped) / 5525 tests (5519 passed + 6 skipped) / 0 failed** | +22 tests, all new this round (4 affiliation + 11 utils + 7 dedup — individually tallied), 0 files added (no new test files this round), 0 pre-existing tests touched |
| `npx tsc --noEmit` | 0 errors | unchanged |
| `npx eslint .` | 0 errors, 151 warnings | exact match, no new warnings |
| `npm run build` | Succeeded, all 29 routes generated, same pre-existing unrelated NFT-tracing warning | unchanged |

### Final file list, round 2

Production (3, on top of round 1's 6): `web/src/lib/affiliation/openalex.ts`, `web/src/lib/utils/openalex.ts`
(further edited), `web/src/lib/feed/dedup.ts` (further edited).
Tests: `web/src/lib/affiliation/openalex.test.ts` (extended), `web/src/lib/utils/openalex.test.ts`
(extended), `web/src/lib/feed/dedup.test.ts` (extended) — no new test files this round.

`git status --short` at completion also shows `docs/jev-abc/DATASET-RECORDS-A-20260930T041130Z.md`
(the fresh A's review, not created by me) and `docs/jev-abc/EMAIL-DEST-UX-B-20260930T041204Z.md` (a
different, concurrent B investigation in this same checkout, unrelated to this item and not touched by
me) — both pre-existing/external, neither created or modified by this round's work. No
`__c_dataset_probe_*` file was created under `web/src/` this round (none was needed — every new
assertion could be written directly against the real exported functions).

STATUS: IMPLEMENTED_PENDING_REVIEW (round 2)
