STATUS: COMPLETE

# SENSE-CONTEXT — B investigation guide

Role: B (investigator). Ruling queue: §1ao.2 (design lead), §5 row SENSE-CONTEXT (ABC-JEV-INTEGRATION.md).
Never edit product code. This file is the only repo file this role writes.

## 0. Scope recap (from §1ao.2 + §1an AMENDMENT, condensed)

A literal (T1) or near-literal (T2/T3) hit on a short/ambiguous Required tag can admit a wrong-domain
paper: "electrolyte" in a clinical paper, "solid state" in a condensed-matter/quantum-physics paper
(REQUIRED-GATE-A's F2, live, real: "valence-bond-**solid state**" admitted a quantum-spin-chain paper),
"LCO" meaning "light cycle oil" in petroleum. The user's rule ② requires the MEANING to match, not just
the characters. Design lead (§1ao.2, a lead the manager can overrule, not a ruling): for a short/ambiguous
tag, a T1/T2/T3 hit must ALSO show context agreement with the reader's declared context EXCLUDING the
tag's own tokens (cosine between the paper and [project/challenge text + the reader's OTHER tags], tag
tokens stripped from both sides); no declared context → today's behaviour (unchanged).

This item was explicitly NOT fixed by REQUIRED-GATE (§1ao.2: "Do NOT add catalog entries to senses.ts
now... It needs its own measurement before shipping"). REQUIRED-GATE shipped T1-T4 (union of matching
techniques that ADD candidates); SENSE-CONTEXT is the first mechanism in this lineage that can REJECT
a candidate T1/T2/T3 already matched — a structurally different kind of check, composing alongside
senses.ts rather than replacing it.

Status markers below: [ ] not started, [x] done, this section appended incrementally.

## 1. Path enumeration

Search patterns used (ripgrep via the Grep tool, scope `web/src`, no head_limit / unlimited results
unless stated — so "nothing else matches" claims below are exhaustive for that literal pattern):
`scoreItems\(`, `scorePaperCandidates\(`, `runFeedPipeline\(`, `softTopics`, `resolveSenseEvidence\(`,
`scoreItems|from ["']@/lib/scoring/combine`, plus reading `combine.ts`, `keyword.ts`, `term-expand.ts`,
`senses.ts`, `tfidf.ts`, `tokenize.ts`, `profile-compiler.ts` in full, and `types.ts` (scoring +
feed) for the `ScoringProfile`/`FeedRequest`/`SearchBrief` shapes.

### 1.1 The gate itself — identical call graph to REQUIRED-GATE, re-verified not re-assumed

SENSE-CONTEXT operates on the EXACT SAME gate as REQUIRED-GATE (docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md
§1, re-verified this session rather than trusted blindly, since REQUIRED-GATE-C only touched
`combine.ts`/`keyword.ts`/cache files — confirmed by REQUIRED-GATE-A's `git diff` checks — so the
surrounding call graph could not have moved):
- **`web/src/lib/scoring/combine.ts`** `scoreItems` (129–313) — the drop gate, now line **248**:
  `if ((literalMustTopics.length > 0 || selectedSenseConcepts.length > 0) && kw.score === 0 && !admittedByNonLiteralChannel) continue;`
  Exclusions (163) and `minPublishedAt` (164) run before it; `literalMustTopics`'s bare-`conflict`/`sem`
  strip (149–151) runs before `scoreKeyword`; T4 (216–245) runs after `scoreKeyword`, before the gate line.
- **`web/src/lib/feed/pipeline.ts`** `scorePaperCandidates` (1280–1309) — the ONE wrapper into `scoreItems`
  for every papers caller. Three call sites, line numbers re-confirmed by grep this session (unchanged
  from REQUIRED-GATE-B): **898** `buildPaperPool` (build time), **1268** `retryFailedSources` (background
  source-retry rescore), **1962** `runFeedPipeline` (read-time rescore on the cached pool — the path that
  runs on every home-page load).
- **5 production callers of `runFeedPipeline`**, all inherited automatically, re-confirmed by grep
  (`runFeedPipeline\(` across `web/src`, non-test files only): `web/src/app/api/feed/route.ts` (144, 251,
  327 — live dashboard; Tier 0 or 2 by entitlement, Tier 0 for signed-out), `web/src/app/api/profile/
  send-test-email/route.ts:199` (Tier 0 hardcoded), `web/src/app/api/test-digest/route.ts:177` (Tier 0),
  `web/src/app/api/jobs/dispatch-digests/route.ts:326` (Tier 0, the scheduled/cron digest — every emailed
  digest runs Tier-0 SENSE-CONTEXT, once shipped, with no model), `web/src/lib/dashboard/prepare-pool.ts:132`
  (an independent reimplementation of the ledger-aware feed read, per its own header comment — still
  funnels through `runFeedPipeline` → `scorePaperCandidates` → `scoreItems`, so it inherits SENSE-CONTEXT
  for free, exactly as REQUIRED-GATE-A's Check 5 confirmed for REQUIRED-GATE).
- **Events/jobs do NOT call this gate** (re-confirmed: grep `scoreItems|from ["']@/lib/scoring/combine`
  across `web/src` returns only `combine.ts`, `pipeline.ts`, and scoring tests — never
  `web/src/lib/events/scoring.ts` or `web/src/lib/jobs/scoring.ts`). They share the same underlying
  `termMatches` primitive through their own parallel gate (`passesRequiredGate`,
  `web/src/lib/opportunities/shared.ts:195`), and their `scoreKeyword` calls never set
  `extendedRequiredMatch` (re-confirmed reading `keyword.ts`'s own doc comment on that flag), so they
  don't even get T2/T3 today, let alone a hypothetical SENSE-CONTEXT check. REPORT ONLY — §1ao.6 already
  left "whether events/jobs adopt the same union, now/later/never" as an OPEN POLICY item for the
  manager; carried forward unchanged here (6.6), not re-litigated.
- **Tier 1/2 rerank** (`feed/rerank.ts`, `feed/tier2-rerank.ts`): re-confirmed no dependency on the
  literal-match promise (REQUIRED-GATE-B 1.5) — reranks whatever already passed the gate. Unaffected.
- **The "every paper matches" promise copy**: REQUIRED-GATE's ADDENDUM (§1ao.7) already shipped the
  qualification-screen framing on `/welcome` and the digest hint. SENSE-CONTEXT doesn't change the
  PROMISE — a context-rejected paper simply isn't shown (or ranks low, see §4.5), which is still
  consistent with "Peer looks for papers about these topics... and ranks the closest matches first." No
  further copy change is required by this item; confirmed-no-change, not silently skipped.

### 1.2 Where the reader's "declared context" text actually comes from (new tracing for this task)

REQUIRED-GATE-B's enumeration never needed to trace this (T1–T3 are pure text matches; T4 reused
whatever `pText` already was). SENSE-CONTEXT's design lead (§1ao.2) explicitly needs "project/challenge
text + the reader's OTHER tags," so this is traced fresh:

- **`pText`** (`combine.ts:138`, `profileText(profile)`, 39–46) = `[...profile.topics, ...profile.methods,
  ...profile.venues, ...profile.seedTexts].join(" ")` — built ONCE per `scoreItems` call, already reused
  by T4's `simProject` axis (line 222). This is the natural, zero-new-plumbing reuse point.
- **`profile.seedTexts`** is passed in as `seedTexts: briefToSeedTexts(req, brief)`
  (`pipeline.ts:1296`). `briefToSeedTexts` (`profile-compiler.ts:211–218`) = `req.seedTexts ∪
  brief.currentProjectSummary ∪ brief.activeQuestions ∪ brief.generatedQueries`:
  - `brief.currentProjectSummary` = `project || req.seedTexts.join(" ")` (172, 197), where `project =
    req.intent?.project ?? req.project` — this is the Profile page's **Project** field text
    (`profile.currentProject`, wired in `store/feed.ts:460`; the field itself is `EditRow label="Project"`
    in `web/src/app/profile/page.tsx:1825`, placeholder "What specific project are you working on right now?").
  - `brief.activeQuestions` = phrases from `challenge` (the Profile page's **Challenges** field,
    `profile.currentChallenges`, `EditRow label="Challenges"` at `profile/page.tsx:1838`) plus
    `req.seedTexts` (174–177).
  - `brief.generatedQueries` (`projectQueries`, 128–164) ALSO folds in `...topics` directly (`baseQueries`
    includes `...topics` at line 146, plus topic×method and topic×projectTerm combinations) — so `pText`/
    `seedTexts` ALREADY contain every Required tag's own text mixed into the project/challenge phrasing.
    This is exactly why REQUIRED-GATE-A's Check 2 found `pText` "does include the Required tags
    themselves" — and exactly why the design's "excluding the tag's own tokens" stripping step (§1ao.2)
    is not optional decoration: without it, a tag's own words appear on BOTH sides of the cosine (the
    paper, because T1/T2/T3 just matched it; the context, because `generatedQueries` echoes every topic
    verbatim), which would inflate agreement for exactly the wrong-domain papers this check exists to
    catch. Measured, not just argued — see §3.5.
- **`profile.softTopics`** (Explore tags) — traced by grep (`softTopics` across `web/src`, ~100 hits read).
  **Finding: NOT wired into the papers `ScoringProfile` at all.** `scorePaperCandidates`
  (`pipeline.ts:1280–1309`)'s object literal passed to `scoreItems` sets exactly `topics, methods, venues,
  seedTexts, preferenceLedger, negativeTopics, legacyNegativeTopics, sourceWeights, admissionChannels,
  exclusions, selectedSenseConcepts` — there is no `softTopics` key. So `combine.ts:152`'s `const
  softTopics = profile.softTopics ?? []` is **always `[]`** for every papers-pipeline call; the
  `softKw`/`softBonus` machinery (152, 252, 286) is live code but is only ever exercised by
  `events/scoring.ts` and `jobs/scoring.ts`, whose OWN pipelines (`jobs/pipeline.ts:83,128`,
  `events/pipeline.ts:89,154`) DO pass `softTopics: req.softTopics` — papers' own pipeline never does.
  **Consequence**: "the reader's OTHER tags" (§1ao.2) can only mean the OTHER entries in `profile.topics`
  today for papers — Explore/softTopics is not a live context source without new plumbing outside
  `combine.ts`/`keyword.ts` (flagged as POLICY 6.3, matching the pattern REQUIRED-GATE flagged for
  similarly out-of-file-scope plumbing).
- **Net integration point**: since `pText` already is project + challenge + methods + venues + ALL
  topics (including the one under test), reusing `pText` verbatim as the "declared context" and then
  stripping ONLY the current tag's own tokens automatically leaves the project/challenge text AND every
  OTHER Required tag's text intact — no separate "collect the other tags" code is needed. Zero new
  context-collection plumbing; the only new code is the stripping + a second cosine (§4.1).
- **"No declared context" (cold start)**: when `profile.topics` has only the one tag under test AND
  `methods`/`venues`/`seedTexts` are all empty (a brand-new reader with one Required tag and nothing
  else), `pText` reduces to exactly that tag's own text — stripping the tag's tokens leaves an EMPTY
  string. Measured directly (§3.4): `scoreTfidf`/cosine against an empty query always returns exactly
  `0` (confirmed in `tfidf.ts`'s `cosine()`: `if (a.size === 0 || b.size === 0) return 0`). **This is
  why the real implementation must explicitly detect "context text is empty" and BYPASS the check
  (today's behaviour), not merely let the natural `0` fail a positive floor** — a `0` from a genuinely
  empty query and a `0` from a real, populated context text that happens to share zero vocabulary with
  the paper are indistinguishable by value alone, but must be treated oppositely.

### 1.3 How `senses.ts` already handles SEM/conflict, and why SENSE-CONTEXT composes rather than duplicates

Re-confirmed this session by reading `senses.ts` in full and grepping `resolveSenseEvidence\(` across
`web/src`: it is called from **exactly one product site**, `keyword.ts:204`, inside `scoreKeyword`,
driven by `opts.selectedSenseConcepts?? []` (203) — a field **separate from** `topics`, the Required-tag
array SENSE-CONTEXT's per-topic loop would iterate. The two never overlap in what they read, by
construction already present in shipped code:
- `literalMustTopics` (`combine.ts:149–151`) actively **strips** the bare literals `"conflict"`/`"sem"`
  out of the topics array whenever `selectedSenseConcepts.length > 0` — so a tag with an explicit,
  user-selected sense is REMOVED from the per-topic T1–T4 loop entirely and handled exclusively by
  `resolveSenseEvidence`'s finite catalog (5 entries: `hr.role_conflict`, `compliance.conflict_of_interest`,
  `software.dependency_conflict`, `statistics.structural_equation_modeling`,
  `materials.scanning_electron_microscopy`).
- SENSE-CONTEXT's new check would live INSIDE the per-topic loop over `literalMustTopics`
  (`keyword.ts:182–202`, where T1/T2/T3 already run) — it therefore **can never fire on a sense-selected
  tag**, because that tag is already gone from the array it iterates. No double-gating, no need for an
  explicit exclusion check — the composition is structural, not something C needs to add code for.
- The partition this leaves: an ambiguous tag WITH a catalogued, user-selected sense → `senses.ts`
  exclusively (5-entry finite catalog, `requiresContext`/`contextMarkers`, unchanged). Every OTHER
  Required tag — including ambiguous ones with NO catalogued sense, which is most of them (confirmed
  live by REQUIRED-GATE-A's F2 "solid state" finding and this investigation's fresh real negatives for
  "electrolyte"/"LCO"/"solid state" below, none of which are in the 5-entry catalog) — falls through to
  the per-topic T1–T4 loop, where SENSE-CONTEXT's new check applies. **C must not let the new check read
  or touch `opts.selectedSenseConcepts` / `resolveSenseEvidence` at all** — they are already disjoint.

### 1.4 Composition with T4 — the one place a naive design would double-count OR under-protect

T4 (`combine.ts:216–245`) already computes a topical-similarity fallback (`simTopic`/`simProject`) for
items T1/T2/T3 missed entirely. The task brief's own framing ("T4 already context-aware via
simProject — avoid double penalties") anticipates one risk; **measurement below (§3.6) found a SECOND,
more serious one the brief didn't anticipate**: T4's `simTopic`-alone admission path (no `simProject`
needed at all, per the anchored OR) can independently re-admit the SAME wrong-domain papers a
context-check on T1 would reject — a structural backdoor, not a hypothetical. This is the single most
important composition finding in this guide; see §3.6 and §4.3.

### 1.5 Digests / prepare-pool / build-vs-read-time — inherited identically to REQUIRED-GATE

Nothing new to trace: since the check lives inside `scoreKeyword`'s per-topic loop and (per §4.3) a small
extension to T4's own admission test in `combine.ts`, every call site enumerated in §1.1 inherits it
automatically through the SAME `scorePaperCandidates` → `scoreItems` wrapper — exactly as REQUIRED-GATE-A's
Check 5 confirmed by reading `prepare-pool.ts` in full for REQUIRED-GATE (no separate/copied gate logic
of its own). The digest-adjacent Tier-0 routes (send-test-email, test-digest, dispatch-digests) were not
separately live-tested by REQUIRED-GATE-A (its Check 4 exercised `/api/feed` only) — they inherit by the
SAME call-graph argument (§1.1), not by a separate live confirmation; noted honestly rather than
overclaimed. **Same-day cache effect**: REQUIRED-GATE bumped
`PAPER_CACHE_KEY_VERSION` 6→7 specifically because pools are cached AFTER the build-time gate (§1ao.9
ADDENDUM). SENSE-CONTEXT changes admission again, so **C must bump this same version constant a second
time** (7→8) or an old-rule cached pool (built before this ships) would keep serving papers this check
would have rejected — flagged here so it isn't missed, not re-derived (mechanism identical to
REQUIRED-GATE's ADDENDUM (a)).

STATUS OF THIS SECTION: COMPLETE.

## 2. Which tags need the check?

Four options were named in the assignment; all four were measured (not assumed) against real fetched
candidates (full method in §3). Definitions used: a tag's "canonical form" = `canonicalize(tag)` (the
same normalization `term-expand.ts` already applies) split on spaces; "generic" reuses the EXISTING
`isGenericTerm`/`GENERIC_TERMS` set (`term-expand.ts:35–47,195–200`), not a new vocabulary.

### 2.1 Option A — every literal hit (no tag-shape filter)

**Rejected by measurement.** Applying the same stripped-context check to a LONG, unambiguous tag is not
merely unnecessary — it is actively harmful. Tested against `"solid-state battery electrolyte"` (4
content words) using B's own REQUIRED-GATE P1 positive pool (real, in-window OpenAlex/arXiv battery
papers that already passed T1 for this exact tag): stripping all four of the tag's own tokens from BOTH
the paper and the declared-context text leaves so little shared vocabulary that **only 1 of 4 genuine
T1-matched positives clears even a floor of 0.02, and 0 of 4 clear 0.05** (§3, "long-tag-collateral" row).
Mechanism: a long, specific tag IS most of a battery-domain project description's own vocabulary: once
you remove "solid," "state," "battery," and "electrolyte" from both sides, a genuinely on-topic paper and
the reader's own battery-persona context have almost nothing left in common to agree on. The tag's own
specificity was already the evidence; re-demanding independent agreement after removing that evidence is
circular in the wrong direction. Collateral cost of Option A: real, measured, severe (75–100% of genuine
matches lost for a long tag) for zero measured safety benefit (a 4-word tag essentially never literally
matches a wrong-domain paper by accident — no negative set was even findable for it).

### 2.2 Option B — single-token tags + abbreviations only

**Rejected by measurement.** This would protect `"electrolyte"` (1 token) and `"LCO"` (abbreviation) but
explicitly EXCLUDE `"solid state"` (2 tokens, not a listed abbreviation). That is a decisive miss: "solid
state" is not a hypothetical — it is the ONE **live** (not constructed) failure REQUIRED-GATE-A's F2
finding surfaced this same week, a real quantum-spin-chain physics paper admitted via literal T1 through
"valence-bond-**solid state**." This investigation's own fresh fetch (§3) confirms it is not a fluke: 48
of 50 real "valence bond solid state" condensed-matter/quantum-physics papers literally T1-match the tag
"solid state." Option B would leave 100% of this confirmed-real failure mode completely unprotected.

### 2.3 Option C — canonical form is short (≤ 2 tokens) or all-generic

**Recommended, measured.** Covers exactly the three tags this investigation found real evidence for:
`"electrolyte"` (1 token), `"solid state"` (2 tokens), `"LCO"` (1 token after canonicalize). Measured
collateral on the LONG tag (§2.1): correctly exempt (a 4-token tag is never ≤ 2). The "or all-generic"
clause extends the rule to a multi-word tag built ENTIRELY from `GENERIC_TERMS` words (e.g. a
hypothetical 3-word "data analysis systems") that would otherwise slip past the ≤2-token cut — reuses
the existing `isGenericTerm`/`GENERIC_TERMS` set, no new vocabulary; **not separately measured against
real candidates this round** (no real Required-tag example of this shape was found or fetched — flagged
honestly as reasoned-not-measured, POLICY 6.7) since every 1–2 token generic case is already covered by
the token-count clause alone (a 2-word all-generic tag like "materials characterization" is already
≤ 2 tokens). Practically, the "all-generic" clause only ever adds 3+-token, all-generic tags — a narrow,
low-priority edge case.

**Precision note on "canonical form," measured to matter**: the token count must be taken on the tag AS
THE READER TYPED IT (`canonicalize(tag)`, before abbreviation expansion), not on its expanded equivalents.
`"LCO"` canonicalizes to one token ("lco") and is short; if a reader instead typed the full
`"lithium cobalt oxide"` (3 tokens) as their own Required tag text, Option C exempts it — a deliberate,
defensible asymmetry: the reader who chose to spell out the long form gave the system more disambiguating
text already, matching §2.1's finding that long/specific phrasing doesn't need the check.

### 2.4 Option D — literal hit is not in the title (abstract-only mentions only)

**Rejected by measurement, as a standalone filter.** Measured what fraction of each REAL negative set's
T1 hits land in the TITLE (where Option D would NOT protect, since it only gates abstract-only mentions):

| Tag (negative set) | T1-hit negatives | Hit is IN THE TITLE | Option D leaves unprotected |
|---|---|---|---|
| electrolyte (clinical) | 34 | **19 (56%)** | over half |
| solid state (quantum physics) | 48 | **21 (44%)** | nearly half |
| LCO (petroleum) | 17 | **2 (12%)** | a minority, but nonzero |

Sample title-hit negatives Option D would wave through untouched: *"Electrolyte disorders related
emergencies in children"*; *"Entanglement in a Valence-Bond Solid State"*; *"Detailed compositional study
of the Light Cycle Oil (LCO) solvent extraction products"*. The user's own original canonical example —
a constructed clinical *"Serum electrolyte imbalance in critically ill patients..."* title — is ITSELF a
title-position hit (REQUIRED-GATE-B §2.4's fixture), so Option D would fail to protect against the exact
case that motivated this whole item. Title-vs-abstract position remains useful as a RANKING signal
(the existing `groundingWeight`, unchanged) but is not a valid substitute for a domain check — the two
axes are orthogonal, not the same question.

### 2.5 Decision

**Ship Option C.** Rule: for each Required tag, if `canonicalize(tag).split(" ").length <= 2` OR every
token in it is in `GENERIC_TERMS`, the tag is "short/ambiguous" and SENSE-CONTEXT's check (§4) applies to
any T1/T2/T3 match AND to T4's admission of that tag (§3.6, §4.3). Any other (long/specific) tag is
exempt — behaves exactly as REQUIRED-GATE shipped it, unchanged.

STATUS OF THIS SECTION: COMPLETE.

## 3. Measured by execution

### 3.1 Method, sources, and the external-call ledger

**8 external calls total** (of the 25 allowed), zero 429s, no source retired:
- `sc-fetch-negatives.mjs` (scratchpad): OpenAlex `works?search="valence bond solid state"` (1 call, 50
  results — real negative set for tag `"solid state"`); OpenAlex `works?search="light cycle oil"` (1
  call, 50 results — real negative set for tag `"LCO"`, the petroleum sense named in the task brief);
  PubMed `esearch` for `"serum electrolyte imbalance"` (1 call, 50 ids) + `efetch` abstracts+MeSH for
  those ids (1 call) — real negative set for tag `"electrolyte"`, a DELIBERATELY clinical query (unlike
  REQUIRED-GATE-B's generic `"electrolyte"` query, which happened to skew 100% battery on PubMed this
  week — this query targets the classic wrong-sense trap directly, for real, not by construction).
- 4 calls total for the LCO/solid-state/electrolyte-clinical negative sets above; no further fetches
  needed — REQUIRED-GATE-B's saved positive pools already covered every positive set: a preliminary check
  (`check-solid-state-p1.mjs`, zero new calls) found 12 of 30 items in the saved P1a/P1b pool already
  literally T1-match `"solid state"` (11 survive the in-window filter, §3.3's table), so no new positive
  fetch was needed for that tag either.
- All fetches used the product's real User-Agent-style courtesy header, `mailto` param on OpenAlex, and
  the same query-construction/date-window conventions REQUIRED-GATE-B's scripts used (verified by reading
  those scripts in full before reuse, not re-derived from scratch).
- **Reused verbatim, zero new calls**: REQUIRED-GATE-B/C's saved `out/raw-P1a.json`, `raw-P1b.json` (long
  tags, positive/collateral test), `raw-P4.json` + `tagged-P4-pubmed-full.json`
  (electrolyte positives, merged for full abstract coverage — `raw-P4.json`'s own PubMed entries are
  title-only from `esummary`; `tagged-P4-pubmed-full.json` is the `efetch`-enriched replacement with real
  abstracts+MeSH for the same 50 PubMed ids, fetched by B in the prior item), `tagged-LCO.json` (LCO
  positives, real recycling/cathode papers, 730-day window per B's own precedent since these are evergreen
  not news-driven).
- Scripts and raw/derived JSON are in the scratchpad (same directory REQUIRED-GATE used):
  `sc-fetch-negatives.mjs`, `sc-analyze.mjs`, `sc-strip-compare.mjs`, `sc-option-d-check.mjs`,
  `sc-floor-test-search.mjs`, `check-solid-state-p1.mjs`, outputs under `out/sc-*.json` and
  `out/sc-neg-*.json`. All primitives (`canonicalize`, `expandTerm`, `termMatches`, `tokenize`,
  `buildIdf`/`toTfidf`/`cosine`) are verbatim ports re-checked against the real files read in full this
  session (not just copied from the prior item's scripts unverified).
- Project/challenge persona text reused VERBATIM from REQUIRED-GATE-B for comparability (a CONSTRUCTED
  plausible battery-materials-PhD persona, not any real user's private profile text): *"PhD research on
  solid-state battery materials, focused on lithium and sodium-ion cathode and electrolyte interfaces for
  electric-vehicle batteries. Improving ionic conductivity and interfacial stability between solid
  electrolytes and electrode materials while suppressing dendrite growth."* Per the task brief, extended
  with "other tags" `["Li ion battery", "cathode"]` (concatenated, exactly matching §1ao.2's "project/
  challenge text + the reader's OTHER tags" — see §1.2 for why reusing `pText` makes a separate
  "other tags" collection step unnecessary in the real implementation).

### 3.2 The stripped-context mechanism, exactly as measured

`simContextStripped(item, tag, contextText)`:
1. `stripSet` = every token (via the product's own `tokenize()`) of every canonical variant in
   `expandTerm(tag)` (so an abbreviation tag's long-form tokens are ALSO stripped — measured effect of
   this choice vs. a narrower literal-only strip in §3.5).
2. Item side: take the item's ALREADY-BUILT TF-IDF vector from the pool's shared index (no re-tokenizing;
   `TfidfIndex.itemVectors` is a public field, per `tfidf.ts`), drop every entry whose token is in
   `stripSet`.
3. Context side: tokenize `contextText`, drop tokens in `stripSet`, build its TF-IDF vector against the
   SAME index's `idf` map (exactly how `scoreTfidf`'s query side already works).
4. Cosine the two. This reuses `tfidf.ts`'s exported `TfidfIndex` shape without modifying `tfidf.ts`
   itself — see §4.1 for the exact integration point recommended for C.

### 3.3 Main measured table — positives kept / negatives rejected, 3 thresholds, real candidates

All three tags are "short/ambiguous" under Option C (§2.5). Positives = real, in-window candidates that
already T1-match the tag (pulled from REQUIRED-GATE-B's saved fetches). Negatives = real, freshly-fetched
wrong-domain candidates that ALSO literally T1-match the tag (§3.1) — i.e. exactly the set SENSE-CONTEXT
must operate on, since only a literal/T2/T3 "matched" push is at risk (§1.3). One shared TF-IDF index per
tag test (positives ∪ negatives together), matching production's one-index-per-scoring-call behaviour —
this is deliberate: it is the realistic scenario where a wrong-domain paper reaches the SAME candidate
pool as genuine hits, exactly like REQUIRED-GATE-B's biofilm-in-P4 finding.

| Tag | Positives (T1-hit, in-window) | Negatives (T1-hit, real) | floor=0.02 kept/rejected | floor=0.05 kept/rejected | floor=0.08 kept/rejected |
|---|---|---|---|---|---|
| electrolyte | 101 | 35 | pos 75/101 (74%), neg 34/35 (97%) | pos **53/101 (52%)**, neg 35/35 (100%) | pos 32/101 (32%), neg 35/35 (100%) |
| solid state | 11 | 48 | pos 11/11 (100%), neg 45/48 (94%) | pos **10/11 (91%)**, neg 48/48 (100%) | pos 7/11 (64%), neg 48/48 (100%) |
| LCO | 35 | 17 | pos 34/35 (97%), neg 14/17 (82%) | pos **30/35 (86%)**, neg 16/17 (94%) | pos 21/35 (60%), neg 17/17 (100%) |

**No single floor is uniformly best across all three tags** — the same honest conclusion REQUIRED-GATE-B
reached for `FLOOR_PROJECT` (§3.2 of that guide). At floor=0.05: "solid state" separates almost perfectly
(cosine distributions do not overlap at all — max negative 0.028, positives range 0.039–0.203); "LCO" is
good but not perfect (1 of 17 negatives still slips through, see below); "electrolyte" pays a real,
measured collateral cost (nearly half of genuine matches lose their literal-match evidence at 0.05).
Full sorted cosine distributions saved in `out/sc-report-*.json` (`posSimDistribution`/`negSimDistribution`).

**Sample titles lost/kept at floor=0.05** (shortest fragment that makes the point; public titles only):
- electrolyte, POSITIVES LOST: *"Composite Electrolytes from Molecular Crystals and Polymer Gels..."*
  (sim=0.041); *"Integrating complexing agents into organic anion electrolytes... Mg-air batteries"*
  (sim=0.045). NEGATIVES REJECTED (all 35): none slip through at 0.05.
- solid state, POSITIVES LOST (only 1): *"Engineering glasses and glass-ceramics: A
  processability-to-application readiness selection framework"* (sim=0.039 — a defensible loss; its
  "solid state" hit is a passing mention, not the paper's subject). NEGATIVES REJECTED: all 48.
- LCO, NEGATIVE STILL KEPT (1 of 17): *"New materials as FCC active matrix components for maximizing
  diesel (light cycle oil, LCO)..."* (sim=0.058 — a self-declared "(LCO)" abbreviation paper that happens
  to share enough generic materials-science vocabulary with the battery persona to clear the floor; a
  genuine, measured miss, not a bug). POSITIVES LOST (5 of 35, sample): *"Direct and Sustainable
  Regeneration of Spent LiCoO2 Cathodes Using an Eco-Friendly Deep Eutectic Solvent..."* (sim=0.037).

### 3.4 Cold start (tags only, no declared context) — confirmed, not assumed

For all three tags, ALL rows (positives and negatives alike) produced `simContextStripped === 0` when
`contextText = ""` (`coldStartAllZero: true` in every saved report). This is `tfidf.ts`'s own `cosine()`
short-circuit (`a.size===0||b.size===0 → return 0`), confirming §1.2's implementation warning: **the real
code must detect "no declared context" explicitly and bypass the check (today's behaviour), never apply
a floor to this trivial, always-0 value** — a naive `simContextStripped >= floor` with no bypass would
reject 100% of matches for every short/ambiguous tag whenever a reader has declared no project/challenge/
other-tags text, which is a plausible, common state for a new signed-up reader with only one Required
topic so far.

### 3.5 Does stripping the tag's own tokens actually matter? Measured, not assumed

Comparison at floor=0.02 (where the effect is clearest since more borderline cases are near the boundary):

| Tag | Negatives rejected, STRIPPED | Negatives rejected, UNSTRIPPED (tag tokens left in) |
|---|---|---|
| electrolyte | 34/35 | 27/35 |
| solid state | 45/48 | 44/48 |
| LCO | 14/17 | 14/17 |

Stripping catches 7 MORE wrong-domain "electrolyte" negatives at floor=0.02 than leaving the tag's own
tokens in would (positive retention is comparable either way — 75/101 stripped vs 81/101 unstripped, a
small cost for a real safety gain). The effect is smaller for "solid state"/"LCO" in this sample but
never negative. **Confirms the design lead's stripping instruction is load-bearing, not cosmetic** —
without it, a wrong-domain paper that merely repeats the ambiguous tag's own word gets partial credit for
"agreeing" with a context that (via `pText`'s `generatedQueries`, §1.2) also repeats that same word.

**A smaller, measured nuance on WHICH tokens to strip**: stripping via the tag's full `expandTerm()`
(so an abbreviation's long-form tokens are also removed — e.g. "LCO" also strips "lithium"/"cobalt"/
"oxide") vs. stripping only the tag's own literal canonical tokens (e.g. "LCO" strips only "lco") was
compared at floor=0.05:

| Tag | literal-only strip (pos kept / neg rejected) | full-expandTerm strip (pos kept / neg rejected) |
|---|---|---|
| electrolyte | 56/101 / 35/35 | 53/101 / 35/35 |
| LCO | 31/35 / 16/17 | 30/35 / 16/17 |
| solid state | 10/11 / 48/48 | 10/11 / 48/48 |

The difference is small (1–3 items, never changes negative rejection) — a minor tuning knob, not an
architectural fork. **Recommendation**: strip via full `expandTerm()` for consistency with how "this tag"
is defined everywhere else in the codebase (T1/T2/T3 all use `expandTerm`-based equivalence); the
literal-only variant is a documented, cheap fallback if the manager wants marginally higher positive
retention (POLICY 6.4).

### 3.6 The T4 backdoor — measured, and the most important finding in this guide

Per §1.4: does T4's `simTopic`-alone admission path (no `simProject` required, per the anchored OR
already shipped in `combine.ts:226-236`) independently re-admit the SAME wrong-domain papers a
context-check on T1 would reject? Measured directly: for every real T1-hit negative, computed `simTopic
= cosine(item, tag-alone)` under the SAME shared index, and checked it against the EXISTING, shipped
`REQUIRED_TAG_SIMILARITY_FLOOR_TOPIC = 0.15`.

| Tag | T1-hit negatives | ALSO clear FLOOR_TOPIC=0.15 via simTopic alone | Sample |
|---|---|---|---|
| electrolyte | 35 | 2 (6%) | *"Electrolyte disorders related emergencies in children"* (simTopic=0.173) |
| solid state | 48 | 7 (15%) | *"Entanglement in a Valence-Bond Solid State"* (simTopic=0.167); *"Negativity in the generalized Valence Bond Solid state"* (simTopic=0.188) |
| LCO | 17 | **7 (41%)** | *"Separation of aromatic components from light cycle oil by solvent extraction"* (simTopic=0.216); *"Light Cycle Oil Upgrading to High Quality Fuels..."* (simTopic=0.157) |

**This is real, not hypothetical**: for LCO, 41% of the exact wrong-domain negatives this check is meant
to catch would sail straight through T4's OWN existing floor, completely independent of anything
SENSE-CONTEXT does to T1/T2/T3's `matched` push. Mechanism: `simTopic` is cosine against the tag's OWN
short text alone (e.g. just the word "electrolyte" or "LCO"); a wrong-domain paper that uses the ambiguous
word heavily (a petroleum-refining paper about "light cycle oil" repeats "light cycle oil"/"LCO" densely)
concentrates enough of ITS OWN TF-IDF vector on that one term to clear a topic-alone floor that was never
designed to ask "but does this paper's OTHER content agree with the reader's domain" — that question is
exactly what `simProject` was for, but the anchored OR (`simTopic >= FLOOR_TOPIC` on its own, no
`simProject` needed) bypasses it entirely. **Consequence: gating T1/T2/T3's `matched` push alone, without
also gating T4's admission of the SAME short/ambiguous tag, would leave the feature meaningfully broken
for exactly the tags it targets** — see §4.3 for the recommended fix (extend the SAME stripped-context
gate to T4's admission test, scoped to short/ambiguous tags only, so long/specific tags' T4 path is
completely untouched and REQUIRED-GATE's "avoid double penalties" intent is honoured where it actually
applies).

### 3.7 REQUIRED-GATE-FLOOR-TEST boundary fixture (REQUIRED-GATE-A finding F1)

REQUIRED-GATE-A's F1 asked for "a fixture near the boundary (`simTopic` ~0.05–0.10, `simProject`
~0.04–0.06) whose admission genuinely flips with `FLOOR_PROJECT`" — REQUIRED-GATE-C's own tests never
had one. Searched B's saved real pools (zero new calls) for candidates straddling `simProject≈0.05` with
`0 < simTopic < FLOOR_TOPIC`. Found TWO real, usable candidates in the SAME pool (P4, tag "electrolyte"),
both genuinely on-topic battery papers:
- **Admits at FLOOR_PROJECT=0.05**: *"Simulation of a Battery Cell on Quantum Computers: Reactions &
  Transport"* — `simTopic=0.0362`, `simProject=0.0508` (clears 0.05 by a hair; would be REJECTED if
  `FLOOR_PROJECT` moved up past 0.0508).
- **Rejects at FLOOR_PROJECT=0.05**: *"Predictive Simulation of Interphases on Li Metal Surface"* —
  `simTopic=0.1398` (close to but still under `FLOOR_TOPIC=0.15`), `simProject=0.0476` (just under 0.05;
  would be ADMITTED if `FLOOR_PROJECT` moved down to ≤0.0476).

Both are real OpenAlex/arXiv candidates already in the repo's own investigation trail (`out/raw-P4.json`),
not constructed. Handed to C as the fixture pair for the boundary test (§5.2) — this is the ONE test in
this guide whose PASS/FAIL is a direct, mechanical function of `REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT`'s
literal value (parameterize on the named constant, not a hard-coded `0.05`, exactly as REQUIRED-GATE-B's
own test 5 was written for `FLOOR_PROJECT`'s first use).

STATUS OF THIS SECTION: COMPLETE.

## 4. Recommended design

### 4.1 The exact rule

For each Required tag in `literalMustTopics` (the same array T1–T4 already iterate, `keyword.ts:182` /
`combine.ts:216-218`):

1. Compute `isShortOrAmbiguous(tag)` = `canonicalize(tag).split(" ").length <= 2` OR every token is in
   `GENERIC_TERMS` (§2.5). Long/specific tags skip everything below — byte-identical to today.
2. If `isShortOrAmbiguous(tag)` is false → unchanged (T1/T2/T3/T4 exactly as REQUIRED-GATE shipped).
3. If true, compute `contextText = pText` (the SAME string `combine.ts:138` already builds once per
   call — no new collection code, §1.2) and check `isDeclaredContextEmpty = tokenize(contextText,
   minus this tag's stripSet).length === 0`. If empty → **bypass, today's behaviour** (§3.4) — a T1/T2/T3
   match counts fully, and T4 uses its existing, unmodified floors.
4. Otherwise compute `simContextStripped = scoreStrippedCosine(item.id, contextText, index, stripSet)`
   once per (item, tag) pair, reusing the pool-wide `index` `combine.ts:137` already built (§3.2's
   mechanism; `stripSet` from `expandTerm(tag)`, §3.5).
5. **Gate T1/T2/T3's `matched` push**: in `keyword.ts`'s per-topic loop, a T1/T2/T3 hit on a
   short/ambiguous tag only counts (pushes to `matched`, adds to `raw`) if `simContextStripped >=
   SENSE_CONTEXT_FLOOR`. Below the floor: see §4.5 (drop vs. demote).
6. **Gate T4's admission of the SAME tag** (§3.6, §4.3): T4's existing anchored OR
   (`simTopic>=FLOOR_TOPIC OR (simTopic>0 AND simProject>=FLOOR_PROJECT)`) additionally requires
   `simContextStripped >= SENSE_CONTEXT_FLOOR` when the tag is short/ambiguous. Long/specific tags'
   T4 path is completely untouched (§4.3).
7. Nothing here touches `opts.selectedSenseConcepts` / `resolveSenseEvidence` (§1.3) — fully disjoint.

### 4.2 Threshold, with the measured evidence and its honest limits

**No single value cleanly separates every good case from every bad one, exactly the same honest
conclusion REQUIRED-GATE-B reached for `FLOOR_PROJECT` (its §3.2).** At `SENSE_CONTEXT_FLOOR = 0.05`
(§3.3): "solid state" separates near-perfectly (91% positives kept, 100% negatives rejected); "LCO" is
good (86% kept, 94% rejected); "electrolyte" pays a real cost (only 52% of genuine literal matches keep
their evidence). At `0.02`: all three keep the large majority of positives (74–100%) while rejecting most
but not all negatives (82–97%). Recommend shipping **`SENSE_CONTEXT_FLOOR = 0.02`** as the starting
constant — it protects against the confirmed real failure modes (§3.3, §3.6) while keeping collateral
damage on genuine "electrolyte" matches to roughly a quarter rather than half — but this is explicitly a
POLICY call (6.1), stated with the same honesty B gave `FLOOR_PROJECT`: the manager may prefer 0.05 for
stronger protection at a real, measured cost to "electrolyte" specifically, or a PER-TAG floor (not
measured this round — a single global constant was what was asked for and measured; per-tag tuning would
need either a labelled validation pass per tag or a heuristic like "shorter tag → higher floor," neither
built here).

### 4.3 Composition with T4 (extends §1.4/§3.6) — the backdoor fix

REQUIRED-GATE's own instinct to "avoid double penalties" was correct for `simProject` (T4's existing
project-similarity axis already asks a context-agreement-shaped question, and re-asking it with the new
stripped check WOULD be close to redundant for that axis alone). **But measurement (§3.6) found T4's
OTHER axis — `simTopic` alone, no `simProject` required — is a real backdoor for short/ambiguous tags
specifically** (up to 41% of real wrong-domain negatives for "LCO" clear it on their own). The
recommended fix is scoped narrowly, so it only closes the hole it found without widening anything else:
- For a **long/specific** tag (the overwhelming majority of T4's real usage, per REQUIRED-GATE-A's
  accepted-cost tally of 13 T4-only admits, all on long tags): T4 is **completely unchanged**. This is
  where "avoid double penalties" fully applies and is honoured.
- For a **short/ambiguous** tag: T4's admission (whichever axis fires) additionally requires
  `simContextStripped >= SENSE_CONTEXT_FLOOR`. This is not double-penalizing the SAME evidence twice —
  `simTopic`/`simProject` ask "does this paper look like it's about the tag/project AT ALL" (computed
  UNSTRIPPED, the tag's own words count fully); `simContextStripped` asks a DIFFERENT question, "excluding
  the tag's own words, does the rest of the paper agree with the reader's OTHER declared context" — that
  second question is precisely what was missing for the LCO/solid-state/electrolyte backdoor cases.

### 4.4 Exclusions and §1c's non-literal-channel bypass — unaffected, re-confirmed

Both run BEFORE anything in §4.1: exclusions (`combine.ts:163`) and `minPublishedAt` (164) filter before
`scoreKeyword` is even called; `admittedByNonLiteralChannel` (192-198, checked at the gate line 248) is
computed independently and, per §1c, still short-circuits the WHOLE T1–T4-plus-SENSE-CONTEXT evaluation
exactly as it does today — a semantic/positive-seed/citation/topic-field-admitted item is never subject
to this check at all, unchanged.

### 4.5 Drop vs. demote — partially measured, partially reasoned (as instructed, "measure both if you can")

**Directly measured**: DROP (§3.3's tables ARE the drop numbers — a below-floor match contributes
nothing, `matched`/`raw` unchanged as if the tag never matched; if it was the item's ONLY qualifying
evidence and T4 also fails post-§4.3, the existing gate line naturally rejects the whole item with zero
new code at the gate itself — exactly how REQUIRED-GATE's own T2/T3 extension worked, §1ao's design).

**Not independently pool-re-ranked this round (time/budget) — reasoned from the existing formula instead**:
DEMOTE would keep the tag in `matched` (so the card can still explain itself) but at a reduced grounding
multiplier, mirroring the EXISTING precedent of T2's `×0.85`/T3's `×0.6`/T4's margin-scaled `×0.3`
(`keyword.ts:68-69`, `combine.ts:37`) — e.g. a `SENSE_CONTEXT_GROUNDING` constant around `0.3-0.4`,
scaled by how far below the floor `simContextStripped` sits (same shape as T4's own margin scaling,
`combine.ts:237-241`). Arithmetically (using the shipped `raw += termSpecificity(tag) * grounding`
formula, unchanged): a demoted single-tag match would score below a full T1 match, below a T2/T3 match,
and roughly in T4's own range — i.e. it would still surface, but consistently near the bottom of an
otherwise-qualifying pool, never displacing a confident match. This is consistent with REQUIRED-GATE's
own stated philosophy for T4 ("ranks low by construction," §1ao.1) rather than a new invention.

**Recommendation**: DEMOTE, not DROP, as the default — for the same reason REQUIRED-GATE preferred T4
"ranks low, does not hide" over an outright miss: a context-check on a Tier-0 lexical proxy is
necessarily uncertain (§3.3 shows real, non-trivial false-reject rates, especially for "electrolyte" at
higher floors), and hiding a possibly-genuine paper is a stronger, less reversible claim than ranking it
last. **This is a POLICY call (6.2)**, not a ruling — I did not build a full `scoreItems` pool-ranking
simulation to verify DEMOTE's real position among a mixed pool end-to-end (would need re-running the
FULL scoring formula — recency/source/preference/policy penalties, not just the keyword term — across a
realistic mixed pool); what's verified is the arithmetic placement within the keyword term alone, honestly
labelled as such.

### 4.6 Composed default (both POLICY calls resolved the recommended way)

A short/ambiguous Required tag's T1/T2/T3 hit, when `simContextStripped < SENSE_CONTEXT_FLOOR` (and
context is non-empty): stays in `matched` (the card can still say which tag it relates to — §1ao.8's
"never state a false match" principle is preserved, since the tag genuinely IS present, just
context-unconfirmed) but contributes at a reduced `SENSE_CONTEXT_GROUNDING` rather than full/T2/T3
grounding; T4's admission of that same tag additionally requires the SAME floor with no reduced-grounding
fallback (T4 already has no textual evidence to point to, §1ao.8 — if it also fails the context check
there is nothing left to soften). No declared context → full bypass, byte-identical to today. Long/
specific tags → byte-identical to today.

STATUS OF THIS SECTION: COMPLETE.

## 5. Test plan for C

### 5.1 Unit tests (new)

1. **Short/ambiguous detection.** `"electrolyte"` (1 token) → true; `"solid state"` (2 tokens) → true;
   `"LCO"` (canonicalizes to 1 token) → true; `"solid-state battery electrolyte"` (4 tokens) → false;
   a constructed 3-token all-generic tag (e.g. `"data analysis systems"`, every word in `GENERIC_TERMS`)
   → true (the "or all-generic" clause, §2.3 — unmeasured against real candidates, but the unit logic
   itself is directly testable).
2. **Cold-start bypass, byte-identical to today (explicitly requested protective test).** A profile with
   Required tag `"electrolyte"` only, `methods`/`venues`/`seedTexts`/other topics all empty (so `pText`
   reduces to exactly the tag's own text and stripping empties it, §1.2/§3.4) — a real battery-electrolyte
   title (e.g. reuse a genuine P4 positive, §3.3) still qualifies at FULL T1 grounding, `matched` unchanged
   from today's output. Assert this by literally comparing against `scoreKeyword`'s output with
   `extendedRequiredMatch` on but the new check absent/bypassed — same score.
3. **Genuine positives keep their literal-match evidence (explicitly requested protective test).** Reuse
   3–5 real fixtures from §3.3's positive samples (e.g. *"Enhancing Interfacial Stability Between
   NASICON-Type Solid-State Electrolyte and Lithium Metal Anode..."* for tag `"solid state"`,
   battery-persona context declared) — still qualify at the recommended floor (0.02, §4.2).
4. **The constructed clinical fixture now behaves DIFFERENTLY from REQUIRED-GATE's baseline (this is the
   flip REQUIRED-GATE-B's own §4.1 test 6 predicted, fixture originally from that guide's §2.4: "qualifies
   via T1 — same as today's baseline... UNLESS the manager takes POLICY 5.2's senses.ts extension, in
   which case this test flips").
   That extension was never taken (§1ao.2: "Do NOT add catalog entries to senses.ts now"); SENSE-CONTEXT
   is the mechanism that flips it instead.** Reuse the exact fixture: *"Serum electrolyte imbalance in
   critically ill patients: a retrospective cohort study"*, Required tag `"electrolyte"`, battery-persona
   context declared, no selected sense → per §4.6, DEMOTED (stays in `matched`, reduced grounding) or
   DROPPED depending on which way POLICY 6.2 resolves; write the assertion for whichever the manager
   picks, and say explicitly in the test's own comment that this is the documented behaviour change from
   REQUIRED-GATE's baseline.
5. **Real, live "solid state" negative (REQUIRED-GATE-A's F2 finding, not constructed).** Fixture built
   from the real title+abstract *"Measurement-Only Dynamical Phase Transitions in Spin-1 Chains"*
   (contains "...an explicitly dimerized valence-bond-**solid state**...") — Required tag `"solid state"`,
   battery-persona context declared → demoted/dropped per §4.6, NOT full-grounding admission.
6. **Real "LCO" negative (petroleum).** Fixture from this investigation's fetch, e.g. *"Separation of
   aromatic components from light cycle oil by solvent extraction"* — Required tag `"LCO"`, battery-persona
   context declared → demoted/dropped. **Protective sibling**: the real T2-fixture positive from
   REQUIRED-GATE-B §2.4 (*"...composite lithium cobalt oxide cathodes (LCO)..."*) with the SAME context →
   still qualifies (confirms the check doesn't collaterally break T2's own real fixture).
7. **T4 backdoor closed (§3.6/§4.3 — the single most important regression test in this guide).** Fixture
   *"Electrolyte disorders related emergencies in children"* (no literal T1 hit needed for this specific
   test's point — construct/confirm it has NO other qualifying tag either), Required tag `"electrolyte"`,
   battery-persona context declared. Under REQUIRED-GATE's UNMODIFIED T4 formula this item's `simTopic
   =0.173` clears `FLOOR_TOPIC=0.15` alone — assert it does NOT qualify once T4's short/ambiguous gate
   (§4.3) is wired in, and assert (via a mutation, §5.3) that REMOVING that gate reproduces the admission.
8. **Long/specific tag completely unaffected (protective, explicit).** Reuse a REQUIRED-GATE fixture for
   tag `"solid-state battery electrolyte"` — score with and without SENSE-CONTEXT's code path present;
   assert byte-identical `kw.score`/`matched` (proves the short/ambiguous gate, not the check itself, is
   what's exempting it — §2.1's collateral-damage finding must never reach a long tag).
9. **SEM sense case entirely unchanged (explicitly requested protective test).** Reuse REQUIRED-GATE-B's
   real §2.5 fixtures (`out/raw-P3-true.json`/`out/raw-P3-wrong.json`, hand a representative slice to C)
   under a `materials.scanning_electron_microscopy` selected sense — true-sense set still resolves
   `exactAlias`, wrong-sense set still resolves `conflict`, completely independent of anything in this
   guide (§1.3's structural disjointness — `literalMustTopics` already strips bare `"sem"` once a sense is
   selected, so SENSE-CONTEXT's code path never even sees it).
10. **Exclusions stay hard.** A candidate matching a short/ambiguous tag under T1 (context-agreeing or
    not) AND an excluded term is still dropped — exclusions run before any of this (§4.4).
11. **Ranking order.** At equal `termSpecificity`, a full T1 match (context-agreeing) outranks a demoted
    context-uncertain match of the same tag (§4.5's arithmetic), mutation-tested (§5.3).
12. **REQUIRED-GATE-FLOOR-TEST boundary fixture (§3.7, closes REQUIRED-GATE-A's F1 gap).** The two REAL
    candidates found in B's own saved pool: *"Simulation of a Battery Cell on Quantum Computers: Reactions
    & Transport"* (`simTopic=0.0362`, `simProject=0.0508`, admits at `FLOOR_PROJECT=0.05`) and
    *"Predictive Simulation of Interphases on Li Metal Surface"* (`simTopic=0.1398`, `simProject=0.0476`,
    rejects at `FLOOR_PROJECT=0.05`). Write BOTH as one parameterized test reading
    `REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT` from the export (never a hard-coded `0.05`), so changing the
    constant flips a real behavioural assertion — directly satisfying F1's own request ("a fixture whose
    admission genuinely flips with the floor"). This is a REQUIRED-GATE test, not a SENSE-CONTEXT one, but
    both tags used (`"electrolyte"`) are short/ambiguous, so it belongs in the same test file addition and
    C should land it alongside this item's own tests, either tag long or short does not matter for what
    F1 was actually testing (whether `FLOOR_PROJECT`'s VALUE — not just its existence — is exercised).

### 5.2 Fixture data note

Every real title/abstract cited above is already saved, unmodified, in the scratchpad
(`out/sc-neg-electrolyte-clinical-pubmed.json`, `out/sc-neg-solid-state-openalex.json`,
`out/sc-neg-lco-openalex.json`, plus REQUIRED-GATE-B's `out/raw-P4.json`/`out/tagged-P4-pubmed-full.json`/
`out/raw-P1a.json`/`out/tagged-LCO.json`) — C should pull exact title/abstract text from these files
rather than retype from this guide's shortened excerpts, to avoid transcription drift.

### 5.3 Mutation targets for the later A

- Force `isShortOrAmbiguous` to always return `false` (treat every tag as long) → tests 4, 5, 6, 7 must
  ALL start wrongly admitting at full grounding — proves the tag-shape gate (§2) is load-bearing, not
  the context check alone.
- Delete the context-check call entirely (short/ambiguous tags behave like long ones) → same as above,
  the single most direct regression to REQUIRED-GATE's exact baseline gap this item exists to close.
- Remove the cold-start bypass (apply the floor even when `contextText` strips to empty) → test 2 must
  fail (starts wrongly rejecting a no-context reader's genuine match) — proves bypass is real code, not
  incidental to the floor's own arithmetic.
- Remove T4's short/ambiguous context gate only, leaving T1/T2/T3's gate intact (§4.3) → test 7 must fail
  while tests 4/5/6 (T1-path) still pass — isolates the T4 backdoor fix as independently load-bearing,
  exactly the composition risk §3.6 measured.
- Set `SENSE_CONTEXT_FLOOR` to `0` → tests 4/5/6/7 wrongly pass (admit) → must fail, proving those tests
  are sensitive to the threshold rather than vacuous.
- Set `SENSE_CONTEXT_FLOOR` to `1.1` (unreachable) → test 3 (genuine positives) must fail → proves the
  floor is a real, two-sided threshold, not a one-way trapdoor.
- Replace the `expandTerm`-based `stripSet` with an empty set (no stripping) → re-run the electrolyte
  floor=0.02 negative-rejection assertions (§3.5's measured 34→27 delta) — at least one specific negative
  fixture must flip from rejected to admitted, proving stripping is exercised, not decorative.
- If DEMOTE is the shipped design (§4.5/6.2): remove the reduced-grounding path (context-failing tags
  drop straight to 0 contribution / full removal from `matched`) → test 4/5/6 must change from "demoted,
  ranks low" to "absent from `matched`" — confirms which behaviour actually shipped, since both are
  plausible-looking passes without this mutation.
- REQUIRED-GATE-FLOOR-TEST (test 12): change `REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT` from `0.05` to `0.0`
  → the *"Predictive Simulation of Interphases..."* fixture must flip from rejected to admitted — this is
  the exact gap REQUIRED-GATE-A's F1 reported (mutating the constant caught only a literal-value assertion,
  never a real behavioural one); this fixture closes it.

STATUS OF THIS SECTION: COMPLETE.

## 6. POLICY — manager decides

1. **Exact `SENSE_CONTEXT_FLOOR` value.** Measured starting point 0.02 (§4.2); 0.05 gives stronger
   protection (100% negative rejection on 2 of 3 tags) at a real, measured cost specifically to
   "electrolyte" (drops to 52% positive retention). No single value is clean across all three measured
   tags — ship 0.02 and accept the residual negative-admission rate this measured (§3.3), ship 0.05 and
   accept losing roughly half of genuine "electrolyte" matches' literal-match evidence, or build per-tag
   tuning (not measured this round).
2. **Drop vs. demote (§4.5).** Recommended: demote (reduced grounding, stays in `matched`, ranks low —
   consistent with T4's own "ranks low by construction" precedent). This is a recommendation reasoned from
   the existing scoring formula, not verified by a full pool-ranking simulation (time/budget) — the
   manager may prefer the simpler DROP (closer to how a below-floor T4 candidate is already invisible
   today) if simplicity outweighs the "don't hide, rank low" philosophy here.
3. **Whether "the reader's OTHER tags" should also include Explore/softTopics.** Measured/traced fact
   (§1.2): `profile.softTopics` is NOT wired into the papers `ScoringProfile` today at all (only
   events/jobs get it) — reusing `pText` (recommended, §4.1) only ever reaches OTHER Required topics,
   methods, venues, and seedTexts, never Explore tags. Wiring Explore tags in as additional context would
   need new plumbing in `pipeline.ts`'s `scorePaperCandidates` (outside `combine.ts`/`keyword.ts`'s
   current file scope) — not built or measured this round.
4. **Strip-set: full `expandTerm()` vs. literal-tag-tokens-only (§3.5).** Recommended: full `expandTerm()`
   for consistency with T1/T2/T3's own definition of "this tag." Measured difference is small (1-3 items
   across the three tags, never changes negative rejection) — the manager may prefer literal-only for
   marginally higher positive retention if simplicity or predictability is valued over consistency.
5. **`SENSE_CONTEXT_GROUNDING`'s exact multiplier**, if DEMOTE (policy 2) ships. Reasoned by analogy to
   the existing T2 (`×0.85`)/T3 (`×0.6`)/T4 (margin-scaled `×0.3`) constants (§4.5) — not measured/tuned
   against real ranking outcomes this round, exactly the same honesty REQUIRED-GATE-B gave its own T2/T3/T4
   weights (its POLICY 5.3).
6. **Whether events/jobs (`passesRequiredGate`) ever adopt any of T1–T4 or SENSE-CONTEXT.** Carried
   forward unchanged from REQUIRED-GATE's own open POLICY item (§1ao.6) — re-confirmed still true and
   still undecided this session (§1.1); not re-measured, papers-only assignment.
7. **The "all-generic multi-word tag" extension to Option C (§2.3).** Reasoned (reuses the existing
   `GENERIC_TERMS` set, adds no new vocabulary) but not measured against a real candidate this round — no
   live or constructed example of a 3+-token all-generic Required tag was found. Ship the extension now on
   reasoning alone, or defer it until a real case surfaces (narrow, low-priority either way).
8. **Whether to fold the REQUIRED-GATE-FLOOR-TEST boundary fixture (§3.7/§5.1 item 12) into this item's own
   C turn**, as recommended, or spin it out as its own tiny follow-up — it closes a gap in REQUIRED-GATE's
   OWN test coverage (REQUIRED-GATE-A's F1), not a SENSE-CONTEXT feature, but both real fixtures happen to
   use a short/ambiguous tag ("electrolyte") so they sit naturally in the same test file addition.
9. **Cache version bump (§1.5).** Mechanical consequence of shipping any admission change, same mechanism
   REQUIRED-GATE used (`PAPER_CACHE_KEY_VERSION` 6→7) — this item would need 7→8. Flagged for the
   manager's sign-off the same way REQUIRED-GATE's ADDENDUM (a) ruled on it, not a new kind of decision.
10. **Per-tag floor tuning vs. one global constant.** The task asked for and this guide measured ONE
    global `SENSE_CONTEXT_FLOOR` across all three tags (policy 1's table). A per-tag or per-tag-length
    floor (e.g. 1-token tags get a lower bar than 2-token tags, since "electrolyte" alone measurably needs
    more room than "solid state") was not built or measured — flagged as a possible future refinement if
    policy 1's single-constant trade-off proves unsatisfying in production.

STATUS OF THIS SECTION: COMPLETE.

---

STATUS: COMPLETE
