STATUS: COMPLETE

# REQUIRED-GATE — B investigation guide

Role: B (investigator). Ruling: §1an (ABC-JEV-INTEGRATION.md). Diagnosis: §4 "EMPTY-HOME diagnosed".
Never edit product code. This file is the only repo file this role writes.

## 0. Scope recap (from §1an, condensed)

Required is a QUALIFICATION screen, not a literal-text rule. A candidate qualifies when it is about
at least one Required topic by ANY of:
- (a) all content words of a Required phrase appear in title/abstract, any order/position
- (b) at least one content word appears AND same meaning as intended (wrong-sense must NOT qualify)
- (c) about the topic without using its words (semantic) — Tier 1/2 only, Tier 0 needs a proxy

After qualification, ORDER comes from additive scoring. Exclusions stay hard. Sense protections
(§1l finite sense IDs) stay. §1c non-literal channel admission stays. Tier 0 must work with no model key.

Status markers below: [ ] not started, [x] done, this section appended incrementally.

## 0a. AMENDMENT (mid-investigation, relayed by the manager from the user) — supersedes §1an 2(a)/(b) wording

After section 1 (path enumeration) and a first pass at section 2 was already running, the user issued a
binding correction that changes the unit of qualification:

1. **The unit is the Required TAG as a whole concept, never the words inside it.** Given tags
   `"solid state"`, `"Li ion battery"`, `"LCO"`, the keywords are exactly those THREE tags — `"solid"`,
   `"state"`, `"Li"`, `"ion"`, `"battery"` alone are NOT mentions of anything. My first-pass **O1
   ("all content words of a phrase, any order") is WRONG GRANULARITY and is DISCARDED** — splitting a
   tag into independent words was never what the user meant by "the keywords are the tags."
2. QUALIFY = at least ONE Required tag is mentioned, where a mention is any of:
   (i) the tag as a UNIT in title OR abstract, exact or standard variants (case, hyphen/space, plural)
   — this is **exactly today's `termMatches`/`expandTerm`**, unchanged;
   (ii) a semantic equivalent — synonym, full-name ↔ abbreviation, chemical formula;
   (iii) the paper's SUBJECT is that tag even when the title/abstract never uses its words.
3. Several tags matching is not required to qualify — it only earns more score. Order/position never
   matters. Title mentions may weigh more than abstract mentions (the existing `groundingWeight`).
4. Tier 0 must approximate (ii)/(iii) without a model. Sources to investigate and MEASURE: existing
   `expandTerm` abbreviation variants; the sense/alias vocabulary pattern in `senses.ts`; an abbreviation
   DEFINED INSIDE THE CANDIDATE'S OWN ABSTRACT (e.g. "lithium cobalt oxide (LCO)"); source-provided
   subject metadata actually carried on `RawItem` (OpenAlex keywords/topics/concepts, PubMed MeSH, arXiv
   categories — check what is really populated, not assumed); mention anywhere in the abstract (already
   part of (i)); topical similarity against the tag + project text. Every hand-curated alias table must
   be flagged as sampling an open class. A multi-word tag's words within a short span, any order (e.g.
   "batteries in the solid state" for "solid state") is a variant worth measuring but goes to **POLICY**,
   not the default recommendation.
5. Everything else in §1an stands unchanged (exclusions hard; SEM/sense protections; §1c admission; date
   window; delivered exclusions; Tier 1/2 may use a model and must degrade gracefully). Profiles are now
   expressed as TAG LISTS.

**Consequence for this guide**: section 2 below was re-planned around techniques **T1–T5** (replacing the
discarded O1/O2/O3 word-split design). T1 = today's unit-level `termMatches` (unchanged code). T2 =
abstract-declared abbreviation expansion (new). T3 = source-provided subject-tag match (new). T4 =
two-axis topical-similarity floor (tag-alone and project-alone, refined after a first attempt with one
blended query string produced false negatives — see 2.3). T5 = short-span any-order variant, POLICY-only.
Where a first-pass measurement under the discarded O1 design already produced a reusable candidate pool
(the same real papers, fetched once), it is reused for T1/T4/T5 to avoid re-spending the external-call
budget; this is noted per profile below.

## 1. Path enumeration

Search patterns used (ripgrep via the Grep tool, scope `web/src`, no head_limit / unlimited results
unless stated): `isGenericTerm`, `scoreItems\(`, `runFeedPipeline`, `scoreKeyword`, `termMatches`,
`Nothing new for these topics today`, `Required interests`, `matchedKeywords|relevanceReason`,
`Required` (in `web/src/components`), `<TopicsField`, `passesRequiredGate`, `admissionChannels`,
`matches (at least |your Required|one of)|every paper (below|shown)|at least one Required` (`-i`).
All of these returned small result sets (≤64 files) that were read in full; none were truncated by
a head_limit, so "nothing else matches" claims below are exhaustive for that literal pattern within
`web/src`. I did not grep `web/src/**/*.md` or files outside `web/src` (docs/tests outside src are
out of scope for a product-code gate).

### 1.1 The literal-phrase primitive (root cause, shared by everything below)

- **`web/src/lib/scoring/term-expand.ts`**
  - `expandTerm` (125–144): canonicalizes a Required topic **as one multi-word string** (spaces kept),
    then only inflects the LAST word and looks up whole-string abbreviation equivalents. It never
    splits a phrase into independent words.
  - `termMatches` (160–170): builds a regex from each `expandTerm` variant with the WHOLE phrase
    (spaces included) between `\b`-ish boundaries, and tests it against the canonicalized haystack.
    **This is the literal, contiguous, in-order whole-phrase match** the diagnosis names. A phrase
    matches only if every word appears, in that exact order, adjacent (single space) in the text.
  - `termOccurrences` (182–193): same regex, counts hits — used only for grounding weight, not gating.
  - `isGenericTerm` (195–200) / `termSpecificity` (203–210): a single generic word (`materials`,
    `energy`, `transport`, `modelling`, `simulation`, `interface`, `design`, `analysis`, `systems`,
    `data`, `characterization` — the fixed `GENERIC_TERMS` set, 35–47) gets specificity 0.3 instead of
    1/0.7/0.5, but **`isGenericTerm` is never called from `combine.ts`** (confirmed: 0 matches for
    `isGenericTerm` in `combine.ts`, `keyword.ts`, or `pipeline.ts`). A single-word generic Required
    topic that matches in the title (grounding 1) still produces `kw.score = min(1, 0.3/1.5) = 0.2 > 0`
    and passes today's gate. Only two OTHER callers use `isGenericTerm` for a real gate:
    `web/src/lib/preferences/upload-concepts.ts:57,72` (filters generic words out of learned upload
    concepts) and `web/src/lib/opportunities/shared.ts:202` (events/jobs gate, see 1.4).

### 1.2 The build-time and read-time paper scoring gate (papers surface)

- **`web/src/lib/scoring/keyword.ts`** `scoreKeyword` (56–94): for each Required topic, calls
  `termMatches(haystack, canonicalTopic)` once (whole-phrase). No match → topic contributes nothing.
  Also resolves `selectedSenseConcepts` evidence here (79–88) — sense-matched aliases add to `matched`
  independently of the literal Required-topic loop.
- **`web/src/lib/scoring/combine.ts`** `scoreItems` (113–242) — **the drop gate itself, line 177**:
  ```
  if ((literalMustTopics.length > 0 || selectedSenseConcepts.length > 0) && kw.score === 0 && !admittedByNonLiteralChannel) continue;
  ```
  `kw = scoreKeyword(item, literalMustTopics, {...})` (149) is computed from `profile.topics`
  (Required only — NOT softTopics, methods, or seedTexts: see `mustTopics = profile.topics` at 128).
  `admittedByNonLiteralChannel` (172–174) is true only if the item's `admissionChannels` (unioned from
  the item tag and `profile.admissionChannels[item.id]`, 168–171) contains `"semantic"`,
  `"positive-seed"`, `"citation"`, or `"topic-field"` — the four read/build-time non-literal channels
  tagged by `tagAdmissionChannel` in pipeline.ts (566–575; call sites 785, 855, 874, 1241, 1525, 1529,
  1533, 1537). A plain keyword-source candidate (the majority of the pool — every academic-source
  fetch is tagged `"keyword"` at 785/1241, which is NOT in the bypass list) gets NO bypass and lives
  or dies on `kw.score`. `literalMustTopics` (133–135) is `mustTopics` minus the bare literals
  `"conflict"`/`"sem"` when the user has an explicit `selectedSenseConcepts` selection (protects
  acceptance-2 sense disambiguation — unchanged by this task).
  Exclusions (147) and `minPublishedAt` (148) are checked BEFORE the gate, so "exclusions stay hard"
  already holds structurally and needs no change.
- **`web/src/lib/feed/pipeline.ts`** `scorePaperCandidates` (1280–1309) is the ONE wrapper around
  `scoreItems` — every caller in the papers pipeline goes through it, so a Tier-0 fix here reaches
  every call site below without touching `combine.ts`'s signature:
  1. **Build time**, `buildPaperPool` (580…), line **898**: `scorePaperCandidates(fresh, req, brief, false)` —
     scores the freshly-fetched, deduped, date-windowed candidate set once when a day's pool is first built.
  2. **Background source-retry rescore**, `retryFailedSources` (1174–1277), line **1268**:
     `scorePaperCandidates(merged, req, brief, false)` — re-scores the WHOLE merged pool (old + newly
     recovered items) with the SAME gate whenever a previously-failed source is retried.
  3. **Read-time rescore on the cached pool**, `runFeedPipeline` (1789…), line **1962**:
     `scorePaperCandidates(inWindow, req, brief, true)` — re-scores the cached day-pool (plus rollover
     candidates line 1929–1932, plus the four read-time channel items line 1956–1959) against the
     CURRENT request's Required topics EVERY time a user loads/refreshes, with `includePreferenceLedger:
     true`. **This is the path that produced the EMPTY-HOME symptom**: even though the day's pool was
     built once, every home-page load re-runs the same whole-phrase gate over it.
  A fourth reference exists only in a doc comment (1131, describing the same invariant), not a live call.

### 1.3 Every reader of `runFeedPipeline` (who inherits the gate)

`runFeedPipeline` (`web/src/lib/feed/pipeline.ts:1789`) is called from exactly these production
call sites (test files excluded; grepped `runFeedPipeline` across `web/src`, 29 files matched, of
which the non-test callers are):
1. `web/src/app/api/feed/route.ts` — the live dashboard feed, lines **144, 251, 327, 868** (multiple
   call shapes: cache build, ledger-aware rescore, and a fallback path). `aiTier` here comes from
   `entitledAiTier(requestedAiTier, gate.entitlement)` (708–726) — can be 0 or 2 depending on the
   signed-in user's plan/key; **signed-out defaults land on Tier 0** (no `aiProvider` possible without
   entitlement).
2. `web/src/app/api/profile/send-test-email/route.ts` — line **199**, hard-codes `aiTier: 0` (comment
   at 10: "mirroring api/test-digest's own budget precedent").
3. `web/src/app/api/test-digest/route.ts` — line **177**, hard-codes `aiTier: 0` (comment at 137).
4. `web/src/app/api/jobs/dispatch-digests/route.ts` — line **326**, hard-codes `aiTier: 0` at line 345
   (the scheduled/cron digest send path).
5. `web/src/lib/dashboard/prepare-pool.ts` — line **132**, the P4 ledger-aware prepare-ahead worker; its
   own comment (lines 7–13) calls this "an INDEPENDENT small reimplementation of
   `web/src/app/api/feed/route.ts`'s `runLedgerAwareFeed`" rather than a shared helper — so it is a
   fifth code path that inherits the SAME gate via `runFeedPipeline` → `scorePaperCandidates`, but
   would need its own review if the manager ever changes anything outside `combine.ts`/`keyword.ts`/
   `term-expand.ts` (this task's fix stays inside those three files, so `prepare-pool.ts` inherits the
   fix for free — noted for completeness only).
  **All four email/digest-adjacent routes (2,3,4) force Tier 0**, so this task's Tier-0 proxy is the
  ENTIRE qualification logic for every email a user ever receives, not just a fallback.

### 1.4 Events and jobs surfaces — report only, not decided here

Events and jobs do **not** call `combine.ts`'s `scoreItems` (confirmed: grepping `scoreItems|from
["']@/lib/scoring/combine` across `web/src` returns only `pipeline.ts`, `combine.ts` itself, and
scoring tests — `web/src/lib/events/scoring.ts` and `web/src/lib/jobs/scoring.ts` are not in that
list). But they share the SAME underlying literal-phrase primitive through a parallel, independently
authored gate:
- **`web/src/lib/opportunities/shared.ts`** `passesRequiredGate` (195–212): `true` if
  `requiredTopics.length === 0`, OR at least one **specific** (non-generic, via `isGenericTerm`) topic
  matched in the title+short-summary scope, OR at least 2 DISTINCT topics matched anywhere. This
  DOES use `isGenericTerm` (202) — unlike the papers gate — so events/jobs already protects against a
  lone generic-word match; papers currently does not (see 1.1).
- **`web/src/lib/events/scoring.ts`** lines **225–231**: builds `requiredScoped =
  scoreKeyword(facade, profile.topics, {scope: "titleAndSummary"})` and `requiredAnywhere =
  scoreKeyword(facade, profile.topics)`, then `if (!passesRequiredGate(...)) continue`.
- **`web/src/lib/jobs/scoring.ts`** lines **384–390**: identical shape.
- Because both call sites still build their `matched` arrays via `scoreKeyword` → `termMatches`
  (the same whole-phrase-contiguous primitive as papers), **a multi-word Required topic has the same
  literal-match weakness on events/jobs** — `passesRequiredGate`'s "≥2 distinct topics anywhere"
  branch is a DIFFERENT kind of leniency (corroboration across topics), not a fix for a single
  multi-word phrase needing its words in any order. I did not measure events/jobs execution (out of
  this task's scope — the ruling and the manager's assignment are papers-only); flagging the shared
  primitive is the full extent of "report, do not decide."
- The Required-topics EDITOR itself (`TopicsField` in `web/src/components/profile/field-kit.tsx`,
  552–620) is wired ONLY to `profile.researchTopics` at its two call sites
  (`web/src/app/welcome/page.tsx:307` and `web/src/app/profile/page.tsx:1786`) — i.e. it is the
  PAPERS Required-topic list. I found no second `<TopicsField>` instance for events/jobs topics in
  `web/src` (grep for `<TopicsField` returns exactly these 2 matches), so whatever list events/jobs
  reads as `profile.topics` is not user-editable through this component; not traced further.

### 1.5 Tier 1 / Tier 2 rerank — no dependency on the literal-match promise

- **`web/src/lib/feed/rerank.ts`** `applyTier1Rerank` (85–102): pure local re-scoring of whatever the
  gate already let through (`localScore`, 41–83) plus `diversify` (119–142). It has no notion of
  "every item already matches Required" — it just reranks the passed set. No change needed regardless
  of which Required-gate option ships.
- **`web/src/lib/feed/tier2-rerank.ts`** `applyTier2Rerank` (80–158): sends up to 50 already-gated
  items to an LLM with the system prompt at 95–102 ("Prefer papers that directly help the user's
  current project or open questions. Avoid broad, generic, old, or weakly related papers unless they
  are clearly useful."). This prompt does **not** assert "every candidate matches a Required topic" —
  it independently judges relevance. Not a consumer of the invariant; no change needed.

### 1.6 The "every paper matches" PROMISE — three copy/prompt locations

Grepped (case-insensitive) `matches (at least |your Required|one of)|every paper (below|shown)|at
least one Required` plus the two exact strings from the task brief — 6 hits total, 3 are the same
`sourceMix`/pipeline comment noise (not user-facing), leaving exactly three real promises:
1. **`web/src/app/welcome\page.tsx:300`** (onboarding wizard, user-facing copy): *"This is the heart
   of your briefing. Add at least one Required topic — every paper in your feed must match one of
   these."* — the strongest, most literal version of the promise, shown to every new user.
2. **`web/src/app/page.tsx:206`** (`digestContextHint`, sent to the CLIENT-SIDE per-load AI digest
   call): `` `Required interests (every paper below matches at least one — name the matching one in
   your sentence): ${profile.researchTopics.join(", ")}` ``.
3. **`web/src/lib/llm/providers/types.ts:75`** (`DIGEST_SYSTEM_PROMPT`, the SHARED system prompt used
   by every `DigestProvider` implementation, i.e. every server-side digest generation path too):
   *"RELEVANCE: every paper shown was selected because it matches one of the user's stated 'Required
   interests'... naturally name the specific interest/keyword the paper addresses... **even when the
   paper's title doesn't contain that word**."* — Note this ONE already anticipates non-literal
   matching ("even when the title doesn't contain that word"), so it is the least broken of the three;
   it becomes fully accurate once the gate allows non-literal qualification. (1) and (2) both assert
   literal/simple "matches" without that caveat and would overstate confidence for a (b)/(c)-qualified
   paper with no literal keyword hit at all.
   A related but structurally different comment: `web/src/app/welcome/page.tsx:138` — "Topics is the
   one gate: the feed needs at least one required topic..." (a CODE comment governing onboarding
   completeness logic, not shown to the user; still asserts the same "Topics = hard gate" framing).

### 1.7 Profile copy explaining Required

- **`web/src/lib/profile/topic-copy.ts:1-4`** `SURFACE_TOPIC_DESCRIPTIONS.papers` = `"Seeds your
  daily paper search."` — neutral, does not claim literal-only matching, needs no change.
- **`web/src/components/profile/field-kit.tsx:613-616`** — the caption under the Required column on
  BOTH `/welcome` and `/profile` (same `TopicsField` component, see 1.4): *"Matches on these topics
  score higher, but results without them can still appear."* **This is already the qualification-screen
  framing the user asked for — it is LIVE TODAY, on the Profile/Welcome UI, describing behavior the
  CODE does not currently implement** (today a Required-only miss is dropped entirely, not merely
  scored lower). This existing copy needs no wording change under the new design; it needs the code to
  finally match it. Only the welcome page's OTHER, stronger copy (1.6 item 1, same page, different
  component) contradicts it today.

### 1.8 The home empty-state copy

- **`web/src/lib/briefing/copy.ts:25-38`** `BRIEFING_EMPTY` — three buckets (`error`, `empty`,
  and `intent-required` reuses `empty`'s copy). The `empty` bucket (32–37): title *"Nothing new for
  these topics today."*, line *"Peer only sends what is new and relevant. Refresh to look again, or
  widen your topics."* — this is a FIXED string with no cause information.
- **`web/src/lib/feed/empty-reason.ts`** `emptyReason()` (26–36) is the ONLY function that decides
  which of the 3 buckets to show, and it is a coarse 3-way switch on `isLoading` /
  `papersCount` / `feedError` / `intentRequired` — **it has no branch, parameter, or signal for "a
  Required topic matched nothing this week"** vs. "sources returned nothing at all" vs. "everything
  was already delivered." Consumed at **`web/src/app/page.tsx:633`**:
  `` const copy = BRIEFING_EMPTY[reason === "intent-required" ? "empty" : reason]; `` and rendered via
  `web/src/components/ui/empty-state.tsx` (generic presentational component, no logic of its own).
  Making the empty state "name the cause" (the §4 open item) would need `runFeedPipeline`/the API
  response to surface a reason code through this chain — that is a copy + plumbing decision for the
  manager's POLICY list (§5), not something this investigation changes.

### 1.9 `matchedKeywords` / `relevanceReason` consumers (what a non-literal qualification could break)

- **`web/src/lib/scoring/reason.ts`** `generateReason` builds `relevanceReason` from `kw.matched`
  (called at `combine.ts:235`). Under options (b)/(c) a qualifying paper can have an EMPTY
  `kw.matched` (no literal Required-topic text hit at all) — `generateReason`'s fallback behavior for
  a zero-match item needs to keep producing a sane sentence; this file is small (2027 bytes) and
  should be read by C together with its test before shipping (not read line-by-line in this guide —
  flagged as a review point, not a blocker).
- **`web/src/lib/papers/plate-terms.ts`** (full file read, 1–163): `summaryExperimentKeywords =
  matchedKeywords ∪ item.tags` (per file header comment, 4–13) feeds the card's typographic plate.
  `allocatePlateTerms` (129–162) already tolerates an empty term list per paper — "A card can come
  back with an empty array — the caller falls back to the venue plate, which is always available"
  (doc comment, 126–127). **No change needed**: a (b)/(c)-qualified paper with empty `matchedKeywords`
  simply falls back to `item.tags` (OpenAlex concepts) or the venue plate, exactly like any paper
  today whose keywords got filtered out by `passesTermRules`/`subsumed`.
- Other readers of these two fields (`web/src/components/cards/paper-card.tsx`,
  `web/src/components/reader/title-block.tsx`, `web/src/lib/reader/recommendation.ts`,
  `web/src/lib/briefing/tile-lines.ts`, `web/src/types/index.ts`) were located by the grep in 1.6's
  search list (64 files total, most are tests/fixtures) but not individually read — they consume the
  already-degrading-gracefully `matchedKeywords`/`relevanceReason` fields and are downstream of
  `generateReason`, not a second gate; C should grep this same list before shipping to catch any
  UI that assumes `matchedKeywords.length > 0`.

### 1.10 Unchanged mechanisms confirmed structurally (no code path touches these)

- **Exclusions**: `combine.ts:147` runs before the gate, independent of `kw.score`. Unaffected by any
  option below.
- **Sense protections (acceptance 2)**: `web/src/lib/feed/senses.ts` — the finite catalog
  (`hr.role_conflict`, `compliance.conflict_of_interest`, `software.dependency_conflict`,
  `statistics.structural_equation_modeling`, `materials.scanning_electron_microscopy`, 9–14),
  `resolveSenseEvidence` (200–237) and `combine.ts`'s own `literalMustTopics` bare-`conflict`/`sem`
  strip (133–135) are independent of `termMatches`/`expandTerm` and are NOT modified by any option
  below — they run alongside the Required gate, not through it. §1l's rule ("plain ambiguous
  `conflict`/`SEM` without an explicit selected sense remains unresolved") is preserved by construction
  in every option because none of them touch `senses.ts` or the `literalMustTopics` filter.
- **§1c non-literal channel admission**: `admittedByNonLiteralChannel` (`combine.ts:172-174`) is
  additive to whichever gate option ships — it already bypasses today's literal gate and will
  continue to bypass whichever replaces it (the options below only change what happens when this is
  `false`).

STATUS OF THIS SECTION: COMPLETE.

## 2. Options measured by execution

### 2.1 Design (post-amendment): techniques T1–T5, tag is the unit

Per the amendment (0a), qualification is a UNION across techniques — a Required tag qualifies a paper
if ANY of T1–T4 fires (T5 is measured but kept out of the default union, POLICY-only):

- **T1 — unit-level literal match (existing code, UNCHANGED).** `termMatches(haystack, tag)` exactly as
  shipped today (`term-expand.ts`), i.e. condition (i): the tag as a whole, case/hyphen-space/plural
  variants via `expandTerm`. **No code change to `term-expand.ts` itself is needed** — the fix is what
  happens when this returns false, not this function.
- **T2 — self-declared abbreviation inside the candidate's OWN text (new).** Regex-extracts `<long
  form> (<ABBR>)` / `<ABBR> (<long form>)` pairs from the candidate's raw title+abstract (e.g. "lithium
  cobalt oxide (LCO)") and checks whether either side matches the Required tag (via the same
  `termMatches`/`expandTerm`, so an already-known abbreviation still benefits from plural handling
  etc.). Approximates condition (ii) for the specific, common case of a paper defining its own
  abbreviation — a Tier-0-safe, per-document signal, not a global synonym table.
- **T3 — source-provided subject metadata (new).** Checks the adapter-supplied `item.tags` (see 2.2 for
  what each source actually carries) against the tag via the same `termMatches`. Approximates condition
  (iii) — the source's own classification says what the paper is about, independent of its exact words.
- **T4 — two-axis topical-similarity floor (new, refined mid-measurement — see 2.3).** `simTopic =
  cosine(candidate, tag-alone)`, `simProject = cosine(candidate, project+challenge text alone)`, both
  via the product's own `tokenize`/TF-IDF/cosine (`tfidf.ts`, reused verbatim). Admits if `simTopic >=
  floorTopic OR simProject >= floorProject`. This is the Tier-0 proxy for the general case of condition
  (iii) when T2/T3 find nothing.
- **T5 — short-span any-order (POLICY, not in the default union).** All of a multi-word tag's non-generic
  content words present within an 8-token window, any order (e.g. "batteries in the solid state" for
  "solid state"), via a smallest-window-covering-k-lists scan. Measured but explicitly NOT folded into
  the recommendation without the manager's sign-off, per the amendment.
- Ranking (unchanged principle): a title-scope hit is worth more than an abstract-only one (existing
  `groundingWeight` in `keyword.ts` already does this and needs no change); several tags matching still
  only adds score, never required for qualification.

### 2.2 Method, sources, and the external-call ledger

Real candidates were fetched directly from public sources (no keys) rather than through the dev server,
because the API only returns the top 10 post-gate/post-rank items — useless for measuring admit/reject
at the CANDIDATE level. `POST /api/feed` itself was not called in this investigation (fetching sources
directly gave full candidate visibility for the same external-call cost; the manager's own prior probe
in §4 "EMPTY-HOME diagnosed" already exercised the live route end-to-end and is cited, not repeated).

**19 external calls total** (of the 30 allowed), all logged with URLs in the scratchpad scripts' output:
- OpenAlex `works?search=...`: 8 calls (2 hit a transient 429 on the SECOND round of fetches — for P1a
  and P2's tagged refetch — and I continued to the next query rather than fully retiring the source for
  the rest of the run; this is a minor deviation from "stop a source after a 429" I want to flag
  honestly. The immediately-following OpenAlex calls succeeded, so it was a transient per-request limit,
  not a hard block, but I should have paused that source rather than proceeding to the next query on it.)
- arXiv `export.arxiv.org/api/query`: 5 calls, all succeeded.
- Semantic Scholar `graph/v1/paper/search`: 2 calls, BOTH 429'd; the source was correctly marked dead
  and skipped for the rest of the run (P2, P4 did not get an S2 leg). S2's public unauthenticated rate
  limit is evidently under 2 requests in quick succession.
- PubMed `esearch`+`esummary`: 2 calls (one search, one summary batch). `efetch` (XML, abstracts+MeSH):
  1 call, batched for all 50 ids at once.
- Query strings used, verbatim: `"solid-state battery electrolyte"`, `"sodium-ion battery cathode
  materials"`, `"solid electrolyte"`, `electrolyte` (unquoted, single word), `"scanning electron
  microscopy"`, `"structural equation modeling"`, `"lithium cobalt oxide cathode"`.
- "In window" = `ageDays <= 60`, matching `staleAfterDays("week")` in `web/src/lib/feed/freshness.ts`
  (the actual ceiling for the default "week" freshness — NOT a literal 7 days; confirmed by reading that
  file). OpenAlex/PubMed fetches also applied the SAME `from_publication_date`/date-scoped-term filter
  Peer's own adapters apply for a "week" request (last 14 days at fetch time; see `openalex.ts`
  `publicationStartDate` and `pubmed.ts` `dateScopedQuery`, both read in full) — so the fetched pool's
  shape matches production, not just the post-hoc window filter.
- Project/challenge text used for T4 (a CONSTRUCTED plausible battery-materials-PhD persona, not any
  real user's private profile text): *"PhD research on solid-state battery materials, focused on
  lithium and sodium-ion cathode and electrolyte interfaces for electric-vehicle batteries. Improving
  ionic conductivity and interfacial stability between solid electrolytes and electrode materials while
  suppressing dendrite growth."*
- Scripts and raw/derived JSON are in the scratchpad
  (`C:/Users/USER/AppData/Local/Temp/claude/D--local-files-on-this-PC-Github-Peer-peer/cbb72ccd-c5d2-41fc-9546-107a594bc7fa/scratchpad/`,
  `measure.mjs`, `fetch2.mjs`, `analyze3.mjs`, `fetch-pubmed-abstracts.mjs`, `check-pubmed2.mjs`,
  `synthetic-electrolyte-sense.mjs`, outputs under `out/`) — not part of this guide's repo footprint.
- **What each source actually carries on `RawItem.tags` (checked by reading the adapters, confirmed by
  live data)**: OpenAlex → real subject concepts/topics/keywords (rich, usable for T3). arXiv → category
  codes only (e.g. `cond-mat.mtrl-sci`) — coarse subfields, not specific concepts; not fetched in this
  measurement's T3 pass (would not distinguish "LCO" from "solid electrolyte" anyway). **PubMed → in
  Peer's current adapter (`pubmed.ts`), `tags` is `pubtype` (e.g. "Journal Article"), NOT MeSH subject
  headings** — confirmed by fetching real MeSH data directly via `efetch` for this investigation: of 50
  PubMed candidates for the bare tag "electrolyte", **0 had "electrolyte" in their MeSH headings at
  all**, so MeSH would not even have been a usable T3 signal for this tag in this sample if it were
  wired up. This is a factual gap report on the adapter, not a proposal to change it.

### 2.3 A false start, corrected mid-measurement (reported for honesty, not hidden)

The first similarity-floor attempt scored each candidate against ONE blended string (tag + a long list
of project-ish words). Result on the P2 "solid electrolyte" pool: it REJECTED clearly on-topic papers,
e.g. *"Microstructural insights into fast ion transport in solid electrolytes via multiscale modeling"*
(obviously about solid electrolytes) scored 0.000 and was cut, because TF-IDF cosine against a long
blended string dilutes any single paper's overlap with the ONE relevant phrase inside it. Cutting the
already-passing baseline set from 56/62 to 28/62 on a floor of 0.08 was a false-negative regression, not
an improvement — recorded in `out/report-P2-solid-electrolyte.json` from the discarded first pass.
**Fix**: split into `simTopic` (tag alone) and `simProject` (project alone), OR them, and never let T4
SUBTRACT from what T1/T2/T3 already admit (T4 only ever ADDS candidates — see 2.1). Re-measured, this
recovered P2 to 57/62 (2.4). This also surfaced a second, smaller true limitation, kept as a caveat
rather than "fixed" given the time budget: the product's own `tfidf.ts`/`tokenize.ts` (reused verbatim,
not modified) does not stem plurals, so a candidate containing only "electrolytes" (plural) scores ZERO
overlap against a query containing only "electrolyte" (singular) unless another shared word carries the
cosine — e.g. one genuinely on-topic P1 candidate, *"Disentangling cation–polyanion coupling reveals
which anion motion dominates cation transport in solid electrolytes"*, scored `simTopic=0.000` for
exactly this reason and was correctly excluded ANYWAY because neither Required tag's literal phrase
(which also requires "battery"/"cathode"/"materials") appears in it either — a genuine boundary case,
not a regression, but the plural-blindness is a real, separate, small precision cost worth a one-line
fix (see POLICY / test plan).

### 2.4 Measured results per profile (T1–T5, floorTopic=0.15, floorProject=0.05)

| Profile | Tags | Pool / inWindow | T1 admits | +T2 adds | +T3 adds | +T4 adds | **Total qualify** | Rejected |
|---|---|---|---|---|---|---|---|---|
| P1 long tags | `["solid-state battery electrolyte", "sodium-ion battery cathode materials"]` | 30 / 27 | 4 | 0 | 0 | 16 | **20 (74%)** | 7 |
| P2 short tag | `["solid electrolyte"]` | 100 / 62 | 56 | 0 | 0 | 1 | **57 (92%)** | 5 |
| P-LCO | `["LCO"]` | 50 / 3† | 3 | 0‡ | 0‡ | 0 | **3 (100%)** | 0 |
| P4 wrong-sense trap | `["electrolyte"]` | 150 / 145 | 91 | 0 | 0 | 4 | **95 (66%)** | 50 |

† A 730-day fetch window was used for LCO (recycling/synthesis papers are evergreen, not news-driven);
only 3 of 50 fetched fell inside the 60-day "in window" ceiling used everywhere else. All 3 qualify.
‡ T2/T3 add 0 to the TOTAL only because T1 already caught all 3 in-window items; T2 and T3 DID
independently fire on 2 of those same 3 (see below) — the table counts marginal adds beyond earlier
techniques in the T1→T2→T3→T4 order, not whether a technique fired at all.

**P-LCO detail (the case the user specifically asked to measure)**, real OpenAlex abstracts:
- *"Activated carbon-assisted mechanochemical pretreatment: A sustainable approach for the recycling of
  spent **lithium cobalt oxide** cathodes"* — admitted via **T1** (tag "LCO" expands to "lithium cobalt
  oxide" through the EXISTING `ABBREVIATION_GROUPS` entry `["lco","lithium cobalt oxide"]` —
  `term-expand.ts:16` — this equivalence already ships today) **and T3** (OpenAlex concept tag matched).
- *"Cobalt recovery from **lithium cobalt oxide** cathode scraps via green solvents..."* — admitted via
  **T1** (same existing abbreviation entry) **and T2** (the abstract itself pairs the long form near an
  abbreviation-shaped token, confirming T2's regex fires on real text, not just in principle).
- *"Spatial heterogeneity of the fluorine-to-Lithium ratio as a descriptor of battery failure by
  laser-induced XUV spectroscopy (LIXS)"* — title alone has no "LCO"/"lithium cobalt oxide"; I initially
  suspected T2 mis-fired on the unrelated "XUV spectroscopy (LIXS)" pair in the TITLE. Checked by reading
  the full fetched abstract (`out/tagged-LCO.json`): it reads "...laser-induced XUV spectroscopy (LIXS)
  was used to map fluorine- and lithium-related emission lines in composite **lithium cobalt oxide
  cathodes (LCO)**..." — a SECOND, LCO-specific self-declared pair genuinely present in the abstract.
  T2's regex correctly reaches that pair (it scans the whole title+abstract, not just the first match),
  and separately T1 also matches directly on the literal phrase "lithium cobalt oxide" now confirmed
  present in the abstract. Both techniques fired for the right reason; my first-pass suspicion was
  unfounded, and this is now a good, verified unit-test fixture for C (4.2).

**P4 wrong-sense trap — the central safety measurement.** OpenAlex's "electrolyte" pool (95 admitted)
sampled clean: every admitted item I read (10 samples, `out/T-report-P4-*.json`) is genuinely battery/
electrochemistry-relevant ("Electrolyte Engineering... Aqueous Ammonium-Ion Batteries", "Gel Electrolytes
for Flexible Zinc-Air Batteries", "Stable Li Plating/Stripping in LiPF6-Cyclic Ether-Based Electrolytes").
**One false positive found under T4** (floorProject=0.05): *"A proton-gated gold nanocluster platform for
disrupting biofilm bioenergetics and suppressing virulence in bacterial infections"* — a biofilm/clinical
paper, admitted only because `simProject=0.079` narrowly cleared the 0.05 floor on generic scientific
vocabulary overlap (not battery-specific words). This shows **floorProject=0.05 is measurably too
permissive** at the margin — 0.079 would need a floor nearer 0.08–0.10 to exclude it, but P1's weakest
genuine positive samples sit at 0.056–0.062 (2.1's samples), so **no single floor value cleanly separates
every good case from every bad one in this sample size** — reported honestly rather than picking a number
that looks clean. See POLICY (5).

The PubMed half of the wrong-sense trap produced an unexpected, important, and fully honest result:
**fetching real abstracts + MeSH headings for all 50 PubMed "electrolyte" candidates (via `efetch`, 1
call) found that only 13 of 50 literally contain the word "electrolyte" anywhere in title+abstract — and
ALL 13 are genuinely battery/electrochemistry papers** ("Carbon quantum dot-induced electrolyte
structuring... zinc metal batteries", "Electrolyte Design for Fast-Charging Lithium-Based Batteries";
full list in `out/pubmed-full-analysis.json`). **Zero of the 50 had "electrolyte" in a MeSH heading.** The
37 rejected PubMed candidates that never literally say "electrolyte" (colorectal cancer, wound-healing
hydrogels, bacterial corrosion, biosensors, Cryptosporidium — full sample in guide section 2.2) were
correctly excluded by T1 alone. **This week's real PubMed sample did not surface the classic clinical
"serum electrolyte imbalance" trap the task brief anticipated** — but this is a fact about this specific
7-day PubMed snapshot, not proof the risk is absent. A synthetic construction (labelled as such, zero
external calls, `synthetic-electrolyte-sense.mjs`) confirms the gap is real in principle: the literal
text *"Serum electrolyte imbalance in critically ill patients: a retrospective cohort study"* passes T1
exactly as readily as a real battery-electrolyte title does — **T1 (and therefore T2/T3/T4, since they
only ADD to T1 in a union) provides ZERO protection against a genuinely wrong-sense literal hit on an
un-catalogued ambiguous single word.** This is NOT a regression — today's baseline has exactly the same
gap for any Required topic outside the 5-entry `senses.ts` catalog — but the user's own original example
for this whole task WAS "electrolyte in a clinical paper," so it is reported prominently rather than
buried. The same construction script proves the FIX PATTERN already exists and works: adding a 6th
`senses.ts` entry (`materials.electrolyte` vs. e.g. `clinical.electrolyte_imbalance`) with
`requiresContext`/`contextMarkers` in the exact shape already used for
`materials.scanning_electron_microscopy` correctly resolves both constructed titles to their right
domain, unmodified, via the EXISTING `resolveSenseEvidence` function. Whether to add it is POLICY (5).

### 2.5 P3 — SEM sense case (confirms the EXISTING, unmodified mechanism, real data)

Not affected by the T1–T5 redesign at all — `senses.ts`/`resolveSenseEvidence` sits alongside the
Required-tag gate, not inside it (§1l, confirmed unchanged in path enumeration 1.10). Measured directly
against real OpenAlex abstracts for `senseId = materials.scanning_electron_microscopy`:
- Query `"scanning electron microscopy"` (broad, cross-domain — biology, materials, etc.): 50 fetched,
  **47 resolve to `exactAlias`/`closeAlias`** (correctly admitted regardless of field, since the exact
  phrase is the alias itself). The 3 non-admitted were checked by hand: short abstracts where the phrase
  appears only as an SEM image-caption fragment truncated by OpenAlex's inverted-index reconstruction —
  a data-quality artifact of the reconstruction, not a logic error.
- Query `"structural equation modeling"` (the CANONICAL wrong sense of "SEM"): 50 fetched, **0 resolve
  to `exactAlias`/`closeAlias`** (correctly never admitted for the materials sense), **40 explicitly
  flagged `kind: "conflict"`** (correctly recognised as belonging to the OTHER catalogued sense,
  `statistics.structural_equation_modeling`) — this is `resolveSenseEvidence`'s `hasOtherSense` branch
  firing correctly on real text. The remaining 10 were short/truncated abstracts where neither sense's
  alias text survived reconstruction intact.
- **Conclusion**: the sense mechanism the manager asked me to protect (acceptance 2) needs no change and
  continues to work correctly against real, freshly-fetched papers under every option in this guide.

### 2.6 T5 (short-span any-order) — measured, kept POLICY-only

Across all four tag-list profiles, T5 (8-token window, any order) added **zero** candidates beyond what
T1–T4 already admitted. This does not mean it is useless in general (a larger/different sample could
behave differently, and it is a plausible net for the "batteries in the solid state" word-order-reversal
shape the user named), but in THIS measurement it earned its keep as a POLICY option, not evidence for
shipping it by default — recorded exactly as measured, not rounded up.

STATUS OF THIS SECTION: COMPLETE.

## 3. Recommended design

### 3.1 The rule

A candidate qualifies against a Required-tag list if, for ANY tag in the list, ANY of T1–T4 fires
(T5 excluded by default — POLICY 5.4). Exclusions, `literalMustTopics`'s bare-`conflict`/`sem` strip,
`selectedSenseConcepts` evaluation, and `admittedByNonLiteralChannel` all run exactly as today, all
BEFORE this check, all unchanged (path enumeration 1.10). The four-way union means a fix can be scoped
to `keyword.ts`/a small sibling helper without touching `combine.ts`'s gate line at all:

- Keep `combine.ts:177`'s `kw.score === 0` gate test **exactly as written**.
- Extend `scoreKeyword`'s per-topic loop (`keyword.ts:66-75`) so a topic can be "matched" by T1 (today's
  `termMatches`, unchanged), T2 (new: self-declared-abbreviation scan against the item's OWN raw
  title+abstract), or T3 (new: `termMatches` run against each of the item's OWN `tags` as a mini-haystack
  — reuses `expandTerm`, so the existing `["lco","lithium cobalt oxide"]` entry already carries T3 for
  that case with zero new vocabulary). Any of these pushes the topic into `matched` and contributes to
  `raw`/`kw.score`, so `kw.score === 0` naturally becomes false whenever T1, T2, or T3 fires — no gate
  code changes needed for those three.
- T4 (similarity floor) is the one technique that needs a new signal reaching the gate, because it is
  NOT a per-topic text match. The cheapest integration: `combine.ts` already builds `index =
  buildIndex(items)` once per call (line 121) BEFORE the Pass-1 filtering loop that contains the gate —
  so a `simTopic = scoreTfidf(item.id, tag, index)` / `simProject = scoreTfidf(item.id, pText, index)`
  pair (`pText` already exists at line 122, already includes the project/challenge text via
  `briefToSeedTexts`'s fold into `seedTexts` — profile-compiler.ts — confirmed by reading it) can be
  computed inside the SAME Pass-1 loop using the SAME pre-built index, at negligible extra cost, and
  folded into the same "does any topic have matched-or-similar evidence" check that decides
  `kw.score === 0`. This keeps the whole feature inside `combine.ts` + `keyword.ts`, touches no other
  file's gate logic, and is exactly why I recommend it over a parallel gate check.
- Ranking weight per technique (PROVISIONAL — see POLICY 5.3): T1 unchanged (`termSpecificity *
  groundingWeight`, full value). T2 same specificity, grounding capped (e.g. ×0.85) since it is an
  inferred equivalence, not a direct textual hit at the tag's own site. T3 lower (e.g. ×0.6) — a
  source's classification is decent evidence but not the paper's own words. T4 lowest, scaled by margin
  above the floor rather than flat (e.g. `0.3 × termSpecificity × min(1, (sim − floor) / (1 − floor))`),
  so a paper that barely clears the floor barely moves the score, and a strong T1 unit match on the same
  tag always outranks a T4-only qualification of equal specificity — this ordering must be a mutation
  test (4.2), not just a comment.

### 3.2 Thresholds, with the measured evidence behind them (PROVISIONAL — see POLICY 5.1)

`floorTopic = 0.15`, `floorProject = 0.05` were the values measured in 2.4–2.5. Evidence for and
against, stated plainly: at these floors, P1 (the ORIGINAL diagnosed case) went from 4/27 (15%) to 20/27
(74%) qualifying, and every T4-only sample I read by hand was genuinely on-topic (2.4). But the SAME
floors let one biofilm/clinical paper into the P4 "electrolyte" pool at `simProject=0.079` — narrowly
above 0.05 — while P1's weakest genuine positives sit at `simProject=0.056–0.062`, BELOW a floor that
would have excluded the biofilm paper. **My sample is too small to hand the manager a single clean
number**; I recommend either (a) shipping 0.05 while explicitly accepting the residual false-positive
rate this measured (roughly 1 miss in the ~20 T4-only admits I sampled across profiles) as a Tier-0 cost,
or (b) commissioning a larger labelled validation pass before picking a final constant. Either way the
constant should be named and grep-able (e.g. `REQUIRED_TAG_SIMILARITY_FLOOR_TOPIC` /
`..._FLOOR_PROJECT`), not inlined.

### 3.3 Interactions (all confirmed unchanged — path enumeration 1.10, re-confirmed against T1–T5)

- **Exclusions**: run in `combine.ts:147`, before any of T1–T4 are evaluated. Untouched.
- **Sense protections (acceptance 2)**: `senses.ts`/`resolveSenseEvidence` untouched; measured directly
  against real data in 2.5 and still correct. The `literalMustTopics` strip of bare `conflict`/`sem`
  (`combine.ts:133-135`) still runs before T1–T4 see the topic list, so a selected sense still fully
  overrides the ambiguous literal from independently opening the gate via T1/T2/T3/T4.
- **Generic words**: `isGenericTerm`/`termSpecificity` still weight ranking exactly as today; T1–T3 are
  unit-level (the whole tag, not its words), so a single generic-word TAG (e.g. a Required topic that is
  literally just "materials") is unaffected by this redesign in either direction — it was already able
  to open the gate alone today (path enumeration 1.1), and stays exactly that permissive. Not fixed,
  not worsened; flagged again as POLICY 5.1's sibling concern if the manager wants it tightened.
- **§1c non-literal channel admission**: `admittedByNonLiteralChannel` is checked first and short-circuits
  the whole T1–T4 evaluation when true, exactly as today.
- **Empty state honesty**: when NOTHING qualifies, the pool is empty exactly as it is today — this
  design does not fabricate placeholder content (§1c "never replace missed candidates with knowingly
  invalid fallback content"). What COULD improve (naming the cause instead of the generic "Nothing new
  for these topics today.") needs a reason code threaded from `runFeedPipeline`/the API response through
  to `emptyReason()`/`BRIEFING_EMPTY` (path enumeration 1.8) — a plumbing and copy decision, POLICY 5.7,
  not built here.

STATUS OF THIS SECTION: COMPLETE.

## 4. Test plan for C

### 4.1 Unit tests (new)

1. **T1 unaffected** — existing `term-expand.test.ts` / `admission.test.ts` / `ranking.test.ts` pass
   byte-for-byte unmodified (proves T1's code path, `term-expand.ts`, was not touched).
2. **T2 fires on a real self-declared abbreviation** — fixture built from the VERIFIED real abstract in
   2.4 ("...composite lithium cobalt oxide cathodes (LCO)..."), Required tag `"LCO"` → qualifies.
   **Protective sibling**: a fixture containing only an UNRELATED abbreviation pair ("XUV spectroscopy
   (LIXS)") and no LCO-related text anywhere → tag `"LCO"` does NOT qualify via T2 (guards against the
   false alarm I raised and then resolved in 2.4 — worth locking in as a real regression test).
3. **T3 fires on a source-provided subject tag** — fixture `item.tags = ["Lithium cobalt oxide"]`,
   Required tag `"LCO"` → qualifies (via the EXISTING `["lco","lithium cobalt oxide"]` abbreviation
   entry, reused for tag-to-tag matching). **Protective sibling**: `item.tags = ["Unrelated Concept"]` →
   does not qualify.
4. **T4 admits a real paraphrase** — fixture from 2.4's genuine P1 admit, "Enhancing Interfacial
   Stability Between NASICON-Type Solid-State Electrolyte and Lithium Metal Anode via Multifunctional
   Synergistic Interface Engineering" (no literal "solid-state battery electrolyte" phrase, `simTopic
   ≈0.024`, `simProject ≈0.178`), Required tag `"solid-state battery electrolyte"` → qualifies. This is
   also the direct regression test for the ORIGINAL bug (0/29 → now qualifies).
5. **T4 rejects the measured false positive** — fixture from 2.4, the biofilm/gold-nanocluster title,
   Required tag `"electrolyte"`, project text = the battery persona used throughout → does NOT qualify
   at the shipped floor (this test's PASS/FAIL is literally the floor value decision from POLICY 5.1 —
   write it parameterized on the named floor constant so changing the constant re-runs the same
   evidence).
6. **Wrong-sense trap, explicit** — the CONSTRUCTED fixture from 2.4, "Serum electrolyte imbalance in
   critically ill patients: a retrospective cohort study", Required tag `"electrolyte"`, no selected
   sense. Document the CURRENT expected result honestly (qualifies via T1 — same as today's baseline,
   see 2.4) UNLESS the manager takes POLICY 5.2's `senses.ts` extension, in which case this test flips to
   asserting rejection and becomes the acceptance test for that decision. Do not silently ship one
   behavior and assert the other.
7. **SEM sense case, real data** — reuse the exact real OpenAlex titles/abstracts fetched in 2.5 (saved
   in `out/raw-P3-true.json`/`out/raw-P3-wrong.json` — hand a small representative slice to C, since the
   full 100 rows are in the scratchpad, not the repo) as fixtures: the true-sense set must resolve
   `exactAlias`, the wrong-sense set must resolve `conflict`, under a `materials.scanning_electron_microscopy`
   selected sense with `topics: ["SEM"]`. Confirms `senses.ts` needs no change.
8. **Exclusions stay hard** — a candidate whose text matches a Required tag under T1 AND an excluded
   term is still dropped.
9. **Honest empty result** — a candidate with no T1/T2/T3 hit and `simTopic`/`simProject` both near 0
   (e.g. 2.4's "Sichuan's Advanced Manufacturing Industry Chain" reject sample) stays rejected; a profile
   whose real in-window pool has zero qualifiers returns an empty (not padded) result.
10. **Ranking order** — at equal `termSpecificity`, a T1-qualified item outranks a T4-only-qualified item
    (mutation-tested per 4.2).

### 4.2 Mutation targets for the later A

- Delete the T2 branch entirely → test 2 (and its protective sibling) must fail.
- Delete the T3 branch entirely → test 3 must fail.
- Delete the T4 branch entirely (or set `floorTopic`/`floorProject` to `1.1`, unreachable) → test 4 must
  fail — this is the single most important mutation, since it directly reproduces the original bug if
  T4 is ever silently dropped in a refactor.
- Set `floorProject` to `0.0` (admit everything) → test 5 must now WRONGLY pass, proving the test is
  sensitive to the threshold rather than vacuous.
- Remove the T1-over-T4 ranking weight gap (make them equal) → test 10 must fail.
- Remove `literalMustTopics`'s bare-`conflict`/`sem` strip (`combine.ts:133-135`) → a protective test
  pairing a selected SEM sense with a raw `"SEM"` literal topic in a wrong-domain paper must start
  wrongly qualifying (existing coverage — confirm it still catches this after the T1–T4 change).
- Remove the `admittedByNonLiteralChannel` bypass → an existing semantic-channel admission test
  (`admission-channels.test.ts` or similar) must fail, proving §1c admission still short-circuits T1–T4.

STATUS OF THIS SECTION: COMPLETE.

## 5. POLICY — manager decides

1. **Exact `floorTopic`/`floorProject` values.** Measured starting point 0.15/0.05 (3.2); 0.05 is
   measurably too permissive at the margin (one false positive found) while still being necessary to
   catch some genuine positives (P1's weakest true samples sit at 0.056–0.062, just above 0.05). No
   single value in my sample cleanly separates every good case from every bad one — ship 0.05 and accept
   the measured residual error rate, raise it and accept losing a few genuine positives, or commission a
   larger validation pass first.
2. **Whether to extend `senses.ts` with new domain-sense entries** (starting with `electrolyte`, the
   user's own original canonical wrong-sense example) using the exact `requiresContext`/`contextMarkers`
   pattern already used for SEM — proven to work on a construction in 2.4, not implemented. This is the
   ONLY mechanism in this guide that can make T1 itself refuse a wrong-sense literal hit; without it, a
   single ambiguous word outside the 5-entry catalog qualifies via T1 regardless of domain, EXACTLY like
   today's baseline (not a regression, but not the fix either, for that specific shape of tag).
3. **Ranking weight multipliers for T2/T3/T4** relative to T1 (3.1 proposes illustrative 0.85× / 0.6× /
   margin-scaled 0.3× — none measured/tuned; a reasonable starting guess, not evidence-backed).
4. **Whether T5 (short-span any-order) ships at all.** Measured zero marginal admits beyond T1–T4 across
   all four profiles (2.6) — plausibly still worth it for the user's own named example shape
   ("batteries in the solid state"), which I did not happen to sample; the user asked for it to be
   marked POLICY explicitly.
5. **Whether to fix `tokenize.ts`'s plural-blindness** (2.3) — a small, generically useful change, but it
   touches a shared primitive (`tfidf.ts`/`tokenize.ts`) also used by the EXISTING topicality/ranking
   score outside this task's scope, so its blast radius is larger than the Required gate alone.
6. **Whether events/jobs (`passesRequiredGate`, `web/src/lib/opportunities/shared.ts:195`) adopt the
   same T1–T4 union**, now, later, or never. Path enumeration 1.4 only established that they share the
   same underlying `termMatches` primitive and therefore the same multi-word-tag weakness — NOT measured
   here, out of this task's assignment (papers-only).
7. **Copy changes** (path enumeration 1.6–1.8): the `/welcome` copy ("every paper in your feed must
   match one of these") overstates the new design and should probably soften toward the
   ALREADY-CORRECT `field-kit.tsx` caption ("Matches on these topics score higher, but results without
   them can still appear.") which needs no change; the two LLM digest-prompt locations (`page.tsx:206`,
   `llm/providers/types.ts:75`) may want the same softening, though `types.ts:75` already anticipates
   non-literal matching and may need none; whether/how the home empty state (`briefing/copy.ts`,
   `emptyReason()`) should name the specific cause — needs a reason code threaded through the API
   response, a real plumbing change beyond this guide's file scope.
8. **Whether the UI should ever surface WHICH technique qualified a paper** (e.g. distinguish "matched
   your topic" from "matched your topic's known abbreviation") — touches `relevanceReason`/
   `matchedKeywords` consumers (path enumeration 1.9), currently degrade gracefully either way.
9. **Whether `web/src/lib/dashboard/prepare-pool.ts`** (path enumeration 1.3, item 5 — an independent
   reimplementation of the ledger-aware feed read, not a shared helper) needs its own explicit review
   pass once `combine.ts`/`keyword.ts` change, even though it inherits the fix automatically through
   `runFeedPipeline`.
10. **Process note, not a design choice**: in the supplementary OpenAlex fetch (`fetch2.mjs`, 2.2), I hit
    a 429 and continued to the next query on the same source rather than retiring it for the rest of
    that script's run, a minor deviation from "stop a source after a 429." The next two OpenAlex calls
    succeeded (a transient per-request limit, not a hard block), so no data quality issue resulted, but
    flagging it for the record rather than omitting it.

STATUS: COMPLETE
