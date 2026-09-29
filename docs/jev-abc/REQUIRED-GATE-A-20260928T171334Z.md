# REQUIRED-GATE — fresh A review — 2026-09-28T17:13:34Z

STATUS: COMPLETE — VERDICT: VERIFIED (see bottom for full verdict + ranked findings)

Role: independent reviewer (A) in the ABC loop. Did not write this code. Measuring whether REQUIRED-GATE is correctly implemented against §1an+AMENDMENT (user decision) and §1ao+ADDENDUM (manager rulings), on real data. Never fixing code.

Context read:
- ABC-JEV-INTEGRATION.md §1an (BINDING, user's decision) + AMENDMENT (tag-as-unit, mention definitions i/ii/iii)
- §1ao (BINDING rulings on B's POLICY list) + ADDENDUM (16:55Z, anchored T4 re-measurement + cache/ranking/opt-in-flag rulings, "go" sent)
- §1c (BINDING product/privacy — project/challenge meaning primary; no automatic literal required-topic gate for non-keyword channels; explicit exclusions/date controls/Tier 0 usefulness preserved)
- §4 "EMPTY-HOME diagnosed" — root cause of the whole item: literal whole-phrase gate matched 0/29 candidates for "solid-state battery electrolyte" in a 1-week window
- §5 REQUIRED-GATE row: C phase 2 DONE; manager's UNVERIFIED concern about simProject using full profileText vs B/C's project-only text — this is my check 2

Guides: docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md, docs/jev-abc/REQUIRED-GATE-C-20260928T163436Z.md — reading next.

## Check 0 — snapshot

`git status --short` at start of my review:
```
 M ABC-JEV-INTEGRATION.md
 M web/src/app/page.tsx
 M web/src/app/welcome/page.tsx
 M web/src/lib/feed/paper-daily-cache.test.ts
 M web/src/lib/opportunities/channel-candidate-cache.test.ts
 M web/src/lib/opportunities/channel-candidate-cache.ts
 M web/src/lib/opportunities/pool-cache.test.ts
 M web/src/lib/opportunities/pool-cache.ts
 M web/src/lib/opportunities/private-paper-cache.test.ts
 M web/src/lib/opportunities/private-paper-cache.ts
 M web/src/lib/scoring/combine.ts
 M web/src/lib/scoring/keyword.ts
?? docs/jev-abc/REQUIRED-GATE-A-20260928T171334Z.md   (this file)
?? docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md
?? docs/jev-abc/REQUIRED-GATE-C-20260928T163436Z.md
?? node_modules/
?? web/src/lib/scoring/required-gate.test.ts
```

## Check 1 — code review against the rulings

Verified by reading `web/src/lib/scoring/keyword.ts`, `combine.ts`, and by grep/diff against forbidden files:

- **T1 unchanged**: `git diff -- web/src/lib/scoring/term-expand.ts web/src/lib/scoring/tfidf.ts web/src/lib/scoring/tokenize.ts web/src/lib/feed/senses.ts` all EMPTY — confirmed untouched, not just claimed.
- **T2/T3 behind `extendedRequiredMatch`, events/jobs unaffected**: grepped every `scoreKeyword(` call site in `web/src`. The flag is set `true` in exactly ONE place — `combine.ts:172` (the Required-topics call) — and nowhere else: not `combine.ts`'s softTopics call (line 252), not `events/scoring.ts`'s 4 calls, not `jobs/scoring.ts`'s 4 calls, not `term-expand.test.ts`'s ~10 calls. Confirmed by grep, not by reading C's claim alone.
- **T4 tag-anchored formula**: `combine.ts` lines 216-244 implement exactly `simTopic >= FLOOR_TOPIC OR (simTopic > 0 AND simProject >= FLOOR_PROJECT)` (§1ao.1), margin `= max over the admitting paths of (sim-floor)/(1-floor), clamped [0,1]` (ADDENDUM b) — both verified by reading the code line-for-line, matches exactly.
- **Weights**: `REQUIRED_TAG_T2_GROUNDING=0.85`, `REQUIRED_TAG_T3_GROUNDING=0.6`, `REQUIRED_TAG_T4_WEIGHT=0.3` all named/exported constants, matching §1ao.3. T4's formula has one addition beyond the ruling's literal text: a `/1.5` normalization (`Math.min(1, (WEIGHT*specificity*margin)/1.5)`), which C flagged in its phase-1 plan as "interpretation note for the manager/fresh-A to confirm." Reviewed: this is defensible, not a deviation that weakens the ruling's intent — it makes T4's ceiling (0.2×specificity) LOWER relative to T1 than a literal reading would (0.3×specificity), i.e. MORE conservative, and the invariant the ruling actually tests for (T1 full-strength > T4 full-strength at equal specificity) holds either way. LOW note, not a finding.
- **Gate line untouched**: `combine.ts`'s drop condition (now line 248) is byte-identical to before C's changes (`(literalMustTopics.length > 0 || selectedSenseConcepts.length > 0) && kw.score === 0 && !admittedByNonLiteralChannel`) — only what `kw` holds when it runs changes. Confirmed by reading.
- **Exclusions / bare conflict-sem strip / sense evaluation / non-literal-channel bypass all run first, unchanged**: confirmed by reading `combine.ts`'s Pass-1 loop order — exclusions (line 163) and `minPublishedAt` (164) before `scoreKeyword`; `literalMustTopics`'s conflict/sem strip (149-151) before the T2/T3-extended `scoreKeyword` call; `admittedByNonLiteralChannel` (192-198) computed before the T4 block and used unchanged in the gate line. All confirmed unchanged in logic, only re-flowed to accommodate `let kw` reassignment.
- **T4-only adds NOTHING to matched/matchedKeywords (§1ao.8)**: `kw = { ...kw, score: bestT4Score }` only overwrites `score`, `matched` stays whatever it was (empty, since T4 only runs when `kw.score===0` meant nothing matched). Confirmed by reading, and independently confirmed by mutation M-MATCHED (check 3).
- **Cache version single source of truth (ADDENDUM a)**: `pool-cache.ts` — `PAPER_CACHE_KEY_VERSION` 6→7, `CACHE_KEY_VERSION=6` (events/jobs) unchanged, new export `PAPER_POOL_KEY_PREFIX = \`peer-pool-v${PAPER_CACHE_KEY_VERSION}-papers-\`` (derived, not hand-copied). `private-paper-cache.ts` imports it, both `get`/`set` guards use `key.startsWith(PAPER_POOL_KEY_PREFIX)` (confirmed no `"peer-pool-v6-papers-"` literal remains anywhere in product code — grepped). `channel-candidate-cache.ts` diff is comment-only (confirmed by `git diff`, `SCOPE_KEY_PREFIX="peer-channels-v1-"` unchanged). Test files: `pool-cache.test.ts`'s papers-key assertion now derives from `PAPER_POOL_KEY_PREFIX`; its 3 remaining `v6` literals (lines 316/351-352/371) are confirmed-by-reading arbitrary opaque keys for single-flight coalescing logic (`SharedPoolCache`, no real prefix-guard), correctly left alone; `private-paper-cache.test.ts` derives its "current version" key from the constant and adds a new "rejects a stale v6" test that also asserts the Supabase client is NEVER called (strong test); `paper-daily-cache.test.ts` derives its assertion from the constant too. All verified by reading, not assumed.
- **Copy (§1ao.7)**: both strings verified VERBATIM against the ruling by `git diff`: welcome/page.tsx → "Peer looks for papers about these topics, even when they use different words, and ranks the closest matches first."; page.tsx digestContextHint → "each paper below relates to at least one — name the one it relates to in your sentence". `llm/providers/types.ts` and `field-kit.tsx` correctly untouched (already accurate, confirmed by reading in B's guide, not re-verified word-for-word by me since ruling says "only if it still promises literal matching" and it doesn't).
- **`itemText` claim (T2/T3 structurally inert today)**: read `keyword.ts`'s `itemText()` — for `scope:"all"` (what `combine.ts` uses) the haystack is `title + item.abstract + tags.join(" ")`; T2 reads `item.title+item.abstract` directly, T3 reads `item.tags` directly — both are subsets of what T1's `termMatches` already searches in this scope, so anything T2/T3 can find, T1 already found on the same item. CONFIRMED by reading and by the mutation-immune structural comment in the code itself; C's isolation test (using `scope:"titleAndSummary"`, which swaps `abstract` for a different `gateText` field but does NOT change what T2 reads) is a genuine, correctly-reasoned isolation for T2 only, not T3 (nothing excludes tags from T1's haystack in any scope) — matches C's own honest documentation exactly.

**LOW notes (not findings)**: (1) `simProject` is recomputed identically inside the per-tag loop in `combine.ts` (it does not depend on `topic`) — wasted but harmless CPU, a simplification opportunity, not a bug. (2) "one T4 contribution per item, not summed per-tag" (C's phase-1 latitude decision) is a reasonable minimal reading of an ambiguous ruling; affects ranking quality for multi-tag-corroborated papers only, never admission correctness.

## Check 5 — `web/src/lib/dashboard/prepare-pool.ts` (§1ao.9)

Read in full (159 lines). It calls `runFeedPipeline` (line 132) — the exact same function every other papers surface (the live feed route, test-digest, send-test-email, scheduled digests) calls, which internally reaches `scorePaperCandidates` → `scoreItems`, i.e. the fixed gate. It has **no separate/copied gate logic of its own** — confirmed by reading the whole file; its only product-specific behavior is profile-fetching, ledger-exclusion reading, and building the `runFeedPipeline` request (aiTier 0, empty seed arrays, per its own P6/P8 accepted-cost comments, unrelated to this task). **Conclusion: it inherits the REQUIRED-GATE fix automatically, for free, through `runFeedPipeline`.** Matches B's guide §1.3 item 5 and C's claim.

## Check 3 — tests + mutations

Ran from `web/`: `npx vitest run src/lib/scoring/required-gate.test.ts src/lib/opportunities/pool-cache.test.ts src/lib/opportunities/private-paper-cache.test.ts src/lib/opportunities/channel-candidate-cache.test.ts src/lib/feed/paper-daily-cache.test.ts` → **5 files, 65 tests, all passed.**

Mutations (each: mutate → run affected files → restore → sha256-verify against the step-0 hash immediately below; every restore verified exact-match):

| Mutation | Change | Result |
|---|---|---|
| M-T4 | `combine.ts`: `if (literalMustTopics... && kw.score===0)` → `if (false && ...)` (disables T4 branch) | **CAUGHT.** NASICON regression test AND the ranking end-to-end test both fail — the original 0/29 bug reproduces exactly as intended. |
| M-FLOOR | `combine.ts`: `REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT` 0.05 → 0.0 | **PARTIALLY CAUGHT — see finding F1 below.** Only the trivial `expect(REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT).toBe(0.05)` literal-constant assertion fails. The biofilm REJECTION test's own outcome does **not** change (ran the whole `src/lib/scoring/` directory under this mutation: 84/85 pass, only the constant check fails) — biofilm's `simTopic=0` means the anchor's `simTopic > 0` requirement rejects it independent of `FLOOR_PROJECT`'s value, so the floor's actual protective behavior is untested by execution, only its literal value is pinned. |
| M-RANK | `combine.ts`: `REQUIRED_TAG_T4_WEIGHT` 0.3 → 10 | **CAUGHT** (strongly — both the constant-relationship check and the end-to-end T1-vs-T4 fixture fail). |
| M-SEM | `combine.ts`: `literalMustTopics` ternary → always `mustTopics` (removes bare conflict/sem strip) | **CAUGHT** (strongly — both the pre-existing `admission.test.ts` sense-provenance test AND the new SEM-wrong required-gate test fail). |
| M-BYPASS | `combine.ts`: gate line drops `&& !admittedByNonLiteralChannel` | **CAUGHT** (strongly — pre-existing `admission.test.ts` "retains semantic/seed/citation/topic-field... rejects no-channel misses" test fails exactly as predicted). |
| M-MATCHED | `combine.ts`: T4 reassignment also pushes `...literalMustTopics` into `matched` | **CAUGHT** (strongly — both the NASICON `matchedKeywords` assertion and the ranking-fixture `matchedKeywords` assertion fail). |
| M-CACHE | `private-paper-cache.ts`: both guards reverted to hard-coded `"peer-pool-v6-papers-"` | **CAUGHT** (strongly — both `private-paper-cache.test.ts` tests fail exactly as predicted). |

Final hashes after all 7 mutation/restore cycles — **all equal the step-0 snapshot** (re-verified below in one batch).

SHA256 (step-0 snapshot, restore target for check 3 mutations):
```
23a97c998fae658b2545cb8ce27e828d24b5645e8eece426464f97d60e2e2c4a  web/src/lib/scoring/keyword.ts
00891d85a4fa399048090fac8bd5c1a0a829303eb4ac92b2765baef2c42693aa  web/src/lib/scoring/combine.ts
7df66fb476ff30cd1edee288559a428454cc245a2f1141d345ffa625f20cc43d  web/src/lib/scoring/required-gate.test.ts
7474e96068158ce58d5189ab2899d8fa4d55aaa325f3de6b90e35051dbb7cd90  web/src/lib/opportunities/pool-cache.ts
d7761baed644ac89248898a98b4222ad83385fff04a0fef3bfc222aed4f35cd1  web/src/lib/opportunities/pool-cache.test.ts
0f8d55c027c4e3f9146c7a79ff216594bfa67aa78b09f6dcd81890971285e3b4  web/src/lib/opportunities/private-paper-cache.ts
0cd0b4796f5b4cd68fd2610bef6c31ad2b86cd9cb95ee11917b8bd7d51b38901  web/src/lib/opportunities/private-paper-cache.test.ts
eaf0c9dbad71b3979ee4af19136dfef8708205a778ffb1ba44162ba97a65b12e  web/src/lib/opportunities/channel-candidate-cache.ts
816d9722bd07bc7c559127e910319bc611b5f07ec1f24ac1106c64de372cd0b3  web/src/lib/opportunities/channel-candidate-cache.test.ts
d30a7564e435dd68cfbe79bc2a293e70ffc1df8b51755478955fc3092bb74a73  web/src/lib/feed/paper-daily-cache.test.ts
ff887eda7a8cf7d02a138e1808001ec3aee103f3ce4756c774dd1cb2437a23c8  web/src/app/welcome/page.tsx
bdfd30293d0f9803fa8b08b10c42379166d06cf24bf3d7ca43bb25f6923b9c74  web/src/app/page.tsx
```

Re-verified identical after all 7 check-3 mutation/restore cycles — confirmed byte-for-byte, same command, same output.

## Check 2 — the manager's specific concern: `simProject` uses `pText` (full profile text), not project-text-alone

Confirmed in code first (`combine.ts`): `pText = profileText(profile)` (line 138) where `profileText()` (lines 39-46) = `[...profile.topics, ...methods, ...venues, ...seedTexts].join(" ")` — i.e. `pText` **does** include the Required tags themselves, mixed with methods/venues/seedTexts. `simProject = scoreTfidf(item.id, pText, index)` (line 222) is computed once per item, constant across the inner per-tag loop (it doesn't depend on `topic`). B and C's saved scratchpad measurements used a hand-written project/challenge persona paragraph ALONE (`BATTERY_PROJECT`), never mixed with the tag strings — so the manager's concern is real and precisely stated: the shipped `pText` is structurally different from what was measured.

**Method**: wrote a new script (`analyze5-pText-check.mjs`, scratchpad, zero new external calls — reused B's saved `out/raw-*.json`/`out/tagged-*.json` and the exact same TF-IDF/termMatches primitives C's own `analyze4-anchored-t4.mjs` uses) that recomputes P1/P2/P-LCO/P4 admission under the anchored T4 rule for **three** query-text variants: (a) project-text-ALONE (= B/C's original measurement, reproduced as a sanity cross-check — P1 17/27, P2 56/62, P-LCO 3/3, P4 91/145, all match C's phase-1 numbers exactly, confirming my script's primitives behave identically); (b) **pText-style = tags + the same persona text** (the manager's own instructed proxy, since `profile.methods/venues/seedTexts` are not populated in this synthetic dataset — the tags are the only concretely-known additional ingredient of the real `pText`); (c) tags-ALONE, no persona (a supplementary variant I added, not explicitly requested but free given the same index — simulates a real sparse/new-user profile with empty methods/venues/seedTexts, i.e. exactly the profile shape in the original EMPTY-HOME diagnosis, where `profileText()` degenerates to just the topics).

**Result — (a) vs (b), the manager's exact instructed comparison**:

| Profile | Admission differs? | Total (project-only) | Total (tags+project) |
|---|---|---|---|
| P1 long tags | **0 items differ** | 17/27 | 17/27 |
| P2 short tag | **0 items differ** | 56/62 | 56/62 |
| P-LCO | **0 items differ** | 3/3 | 3/3 |
| P4 wrong-sense trap | **0 items differ** | 91/145 | 91/145 |

**Zero admission differences across all four real-paper profiles.** The biofilm false positive specifically is rejected under BOTH variants, for a structural reason independent of which project-text variant is used: its `simTopic=0` against tag "electrolyte", and the anchored rule requires `simTopic > 0` before `simProject` can admit anything — so no value of `simProject` (computed either way) can let it in. The reason (b) doesn't otherwise diverge from (a) in this sample: B's hand-written `BATTERY_PROJECT` persona already shares nearly all its vocabulary with the tags it was written to accompany (solid-state, battery, sodium-ion, cathode, electrolyte, materials all appear in both), so adding the tag strings on top changes the TF-IDF query only marginally.

**Supplementary result — (a) vs (c), tags-only/no-persona (the sparse-profile case)**: 3 items differ total, none off-topic. P1: 2 items flip IN→OUT (both genuinely on-topic NASICON/polymer-electrolyte papers lost — the tags-alone query is narrower/stricter here, a false-negative-direction change, not a safety issue). P2: 1 item flips OUT→IN ("Propelling metal sulfide cathodes toward all-solid-state batteries" — genuinely on-topic, a reasonable admit). **No off-topic admission in either direction, in either variant.**

**Honest limits of this measurement**: small sample (4 profiles, one fetch each); the persona text was hand-written to closely track the same battery vocabulary as the tags, which likely understates how much a real, more heterogeneous `methods`/`venues`/`seedTexts` mix (e.g. journal names, a saved paper from a tangential subfield) could shift `simProject` in a real account — that scenario is not directly testable without B/C making a second round of external calls to build a realistically messy profile, which is outside this review's budget. Within what IS measurable from the saved data, using the manager's own instructed proxy: **the concern does not materialize as an off-topic admission.** Also noted structurally: for a single-Required-tag profile with empty methods/venues/seedTexts, `pText` degenerates to exactly the tag text, making `simProject == simTopic` and collapsing T4's two-axis design to one axis with an effective floor of `min(FLOOR_TOPIC, FLOOR_PROJECT) = FLOOR_PROJECT = 0.05` — not wrong (confirmed no off-topic admission results from it in variant (c) above) but worth the manager knowing the two-axis design has no independent-corroboration benefit in that common cold-start shape.

Script and full per-item JSON output saved: scratchpad `analyze5-pText-check.mjs` / `out/A-pText-check.json`.

## Check 4 — live, signed-out, real pipeline (3 of ≤6 requests used)

Dev server was already running at `http://localhost:3000` (confirmed reachable, `GET /` → 200; never started/stopped/restarted it). All 3 requests via `curl -X POST`, saved to scratchpad `out/A-live{1,2,3}.json`.

**Request 1** `{"topics":["solid-state battery electrolyte"],"aiTier":0}` → HTTP 200, **7 items**, same 7 titles C reported (independently reproduced, not just re-read from C's checkpoint). Every item has `matchedKeywords: []` (correctly — none contain the literal phrase; all admitted via T4). Judgement: all 7 genuinely on-topic (battery/electrolyte research: Na-S battery electrolyte, solid-state Li metal batteries, hydride electrolyte, battery electrolyte viscosity, polymer electrolyte blends x2, solid-state thin-film batteries). `meta` confirms `project:""`, `challenge:""` for this anonymous request — i.e. a real signed-out call's `pText` is close to my check-2 "tags-only" variant, not a rich persona — reinforcing that variant's relevance.

**Request 2** `{"topics":["solid electrolyte"],"aiTier":0}` → HTTP 200, **10 items** (no regression, matches the manager's original probe of 57 passed/10 returned). All `matchedKeywords: ["solid electrolyte"]` (T1 literal, unchanged code). 9/10 clearly battery-related; 1/10 ("...NH3 sensor based on Cu-doped Bi4V2O11 solid electrolyte...") is a gas-sensor paper — a legitimate literal match on a genuinely broader materials-science usage of "solid electrolyte" (used in sensors/fuel cells too, not just batteries) — pre-existing T1 behavior, not something this task changed or could fix given the tag has no battery-specific qualifier.

**Request 3** `{"topics":["solid state","LCO"],"aiTier":0}` → HTTP 200, **10 items**. Checked every `matchedKeywords` claim against the FULL (untruncated) abstract text — **zero false claims found** (every named tag genuinely appears, including two items with the identical title but different OpenAlex ids — `openalex:W7213392907`/`W7213327263`, an apparent preprint/published-version dedup miss, pre-existing and unrelated to this task — both verified to genuinely contain "LiCoO2 (LCO)" and "All-solid-state batteries" in their own full abstracts). Per-item judgement:

| # | Title (short) | Matched via | On-topic? |
|---|---|---|---|
| 1 | Solid State Microwave Devices | solid state (literal, correct sense, electronics field) | Different field, not a false match |
| 2 | Rhizosphere...Lithium Cobalt Oxide...Plant Injury | LCO (literal, genuinely about LCO as a substance) | Borderline/adjacent (environmental science), legitimately about the tag |
| 3 | Solid-state quantum memory | solid state (literal, correct sense, quantum-computing field) | Different field, not a false match |
| 4, 7 | LaCl3-based solid electrolytes...LCO cathodes (2 near-dup records) | solid state + LCO (both literal, verified in full abstract) | Clearly on-topic |
| 5 | Ta 5d-Orbital...LiCoO2 Cathodes | LCO (literal) | Clearly on-topic |
| 6 | MD-Predicted Ionic Conductivity in Solid Electrolytes | solid state (literal, "solid-state batteries" in closing sentence) | Clearly on-topic |
| 8 | Measurement-Only Dynamical Phase Transitions in Spin-1 Chains | solid state | **Off-topic — genuine wrong-sense/substring artifact** (see finding below) |
| 9 | Cr:YAG ceramics...solid state reaction sintering | solid state (literal, correct sense: solid-state synthesis) | Different field (ceramics/optics), not a false match |
| 10 | Breaking the passivation-conduction deadlock...LiCoO2 | LCO (literal) | Clearly on-topic |

**Finding (LOW-MEDIUM, live, freshly observed — not a regression from this diff)**: item 8's abstract never discusses materials/batteries at all (a quantum-spin-chain physics paper) — it matched because the phrase **"valence-bond-solid state"** (in "...an explicitly dimerized valence-bond-**solid state**...") contains "solid" immediately followed by "state" as literal adjacent tokens purely because the compound adjective "valence-bond-solid" happens to end in "solid," right before the following noun "state." `termMatches` is a pure contiguous-substring/word-boundary check with no phrase-boundary awareness, so it cannot distinguish "solid state" as a standalone unit from "solid" + "state" landing next to each other across a compound-word boundary ("valence-bond-solid" + "state"). This is **pre-existing T1 (`termMatches`) behavior, confirmed unchanged by this diff** (`git diff -- term-expand.ts` empty, check 1) — not a REQUIRED-GATE regression. But it IS a live, real (not constructed) counter-example to B's guide statement "zero live instances found this week" for the single-literal-word/phrase wrong-sense gap (guide §1ao.2) — worth surfacing to the manager as fresh evidence for the queued SENSE-CONTEXT item, since B's "zero instances" claim was specifically about the tag "electrolyte", not "solid state", and this shows the gap is live and real for at least one other generic Required tag. Does not affect the VERDICT (explicitly out of this item's ruled scope, §1ao.2), but is reported as required ("does its title/abstract actually relate to a Required tag... your judgement").

**Live tally**: 3 requests, 27 items examined total. Zero false `matchedKeywords` claims found anywhere. Zero off-topic T4-only admissions (all 7 T4-only items in request 1 genuinely on-topic). One off-topic item overall (request 3, item 8), admitted via literal T1 (unchanged code), not via any new T2/T3/T4 mechanism.

## Check 6 — gates (from `web/`)

All four re-run independently (not re-read from C's checkpoint), no Windows file lock encountered, dev server never touched:

- `npx vitest run`: **277 passed + 3 skipped (280 files) / 5021 passed + 6 skipped (5027 tests) / 0 failed.** Exact match to the expected baseline and to C's claim.
- `npx tsc --noEmit`: **0 errors** (no output).
- `npx eslint .`: **0 errors, 151 warnings.** Exact match.
- `npm run build`: **OK** — compiled successfully, TypeScript finished, all 29 routes generated. Same one pre-existing Turbopack NFT-tracing warning about `next.config.ts`/`pdf-text.ts`/the upload route C reported (unrelated to any file this item touched — upload/PDF file tracing, not scoring/cache/copy).

## Check 7 — scope

`git status --short` (below) shows exactly: the 12 change-list files, the manager's state file (`ABC-JEV-INTEGRATION.md`, read-only for me), the three `docs/jev-abc/REQUIRED-GATE-{A,B,C}-*.md` files (B's and C's untouched by me; A is this checkpoint), and pre-existing untracked `node_modules/`. **Clean.**

## Accepted-cost tally (§1ao.1 — owed by every A that measures real pools)

Counted every anchored-T4-**only** admit (i.e. qualifies via T4 alone, no T1/T2/T3 evidence for any tag) across all four of B's saved real pools, by re-deriving the full list from saved data (not just the first-10 sample in C's report) and reading each one's title/abstract myself:

| Profile | T4-only admits (anchored) | Off-topic (my judgement) |
|---|---|---|
| P1 long tags | **13** | **0 clearly off-topic; 1 borderline** (see below) |
| P2 short tag | 0 | — |
| P-LCO | 0 | — |
| P4 wrong-sense trap | 0 | — |
| **Total** | **13** | **0 / 13 clearly off-topic** |

12 of the 13 are unambiguously on-topic on reading (solid-state electrolyte/battery interfaces, polymer electrolytes, sodium-ion cathode materials — e.g. "Enabling Sodium Compensation... in NVP Cathodes", "Data-driven discovery... cathode materials for sodium-ion batteries"). The 1 borderline case — "Physics-Grounded Materials Artificial Intelligence for Reliable Materials Discovery" (`openalex:W7202124485`, `simTopic=0.134`, just under `FLOOR_TOPIC=0.15`) — is a general AI-for-materials-science Perspective piece, NOT primarily about batteries, but its full abstract explicitly names *"solid-state electrolytes in solid-state battery"* as one of three worked examples (alongside catalysis and hydrogen storage). Judged **borderline-relevant, not off-topic** — it genuinely touches the Required tag, just as one of several examples rather than its main subject, and it sits appropriately near the bottom of the admitted set by construction (low `simTopic`), which is exactly the "ranks low" behavior §1ao.1 asks for. **Result: 0/13 clearly off-topic, well under the named retune threshold (≥3 off-topic in a sample of ≥50).**

## Final `git status --short` (2026-09-28T17:34:34Z)

```
 M ABC-JEV-INTEGRATION.md
 M web/src/app/page.tsx
 M web/src/app/welcome/page.tsx
 M web/src/lib/feed/paper-daily-cache.test.ts
 M web/src/lib/opportunities/channel-candidate-cache.test.ts
 M web/src/lib/opportunities/channel-candidate-cache.ts
 M web/src/lib/opportunities/pool-cache.test.ts
 M web/src/lib/opportunities/pool-cache.ts
 M web/src/lib/opportunities/private-paper-cache.test.ts
 M web/src/lib/opportunities/private-paper-cache.ts
 M web/src/lib/scoring/combine.ts
 M web/src/lib/scoring/keyword.ts
?? docs/jev-abc/REQUIRED-GATE-A-20260928T171334Z.md
?? docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md
?? docs/jev-abc/REQUIRED-GATE-C-20260928T163436Z.md
?? node_modules/
?? web/src/lib/scoring/required-gate.test.ts
```

## VERDICT: VERIFIED

The rulings (§1an+AMENDMENT, §1ao+ADDENDUM) are implemented correctly and precisely, confirmed by reading every touched file, not by trusting C's or B's claims. The manager's specific concern (check 2) does not materialize as an off-topic admission in any measured real-paper sample, under either the manager's own instructed proxy or a supplementary sparse-profile variant. 6 of 7 mutations are strongly caught by 1-2 tests each; the 7th (M-FLOOR) reveals a real test-coverage gap (ranked MEDIUM below), not a live behavioral defect — independently confirmed safe by the accepted-cost tally (0/13 off-topic T4-only admits) and by 3 fresh live requests (0 false `matchedKeywords`, 0 off-topic T4-only admissions). Gates match exactly. Scope is clean.

### Ranked findings

- **MEDIUM — F1: `FLOOR_PROJECT`'s actual protective behavior is untested by execution, only its literal value is pinned.** Mutating `REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT` from 0.05 to 0.0 and re-running the ENTIRE `src/lib/scoring/` test directory (85 tests) fails exactly one assertion — a direct `expect(REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT).toBe(0.05)` literal-value check. The biofilm-rejection test's own outcome is unchanged, because the anchored rule's `simTopic > 0` gate already fully protects that fixture independent of the floor's value (biofilm's `simTopic=0`). No current fixture sits in the boundary zone where `FLOOR_PROJECT`'s actual VALUE (as opposed to its literal string) determines the outcome (`simTopic` small-but-positive, `simProject` near 0.05). A future change that broke the floor's real behavior (wrong variable, flipped comparison, off-by-one) would only be caught by an assertion that reads the same constant it's testing — not a meaningful regression guard. Not a live defect today (accepted-cost tally: 0/13 off-topic at the current value). Recommend: a small follow-up test with a fixture near the boundary (`simTopic` ~0.05-0.10, `simProject` ~0.04-0.06) whose admission genuinely flips with the floor — does not need to block this commit.
- **LOW — F2: live, fresh (not constructed) counter-example to B's "zero live wrong-sense instances this week."** Check 4's third live request surfaced a real quantum-physics paper ("Measurement-Only Dynamical Phase Transitions in Spin-1 Chains") admitted via literal T1 on the Required tag "solid state," because the unrelated phrase "valence-bond-**solid state**" contains "solid" and "state" as literal adjacent tokens across a compound-word boundary. Pre-existing `termMatches` behavior, confirmed byte-identical/unchanged by this diff, explicitly out of THIS item's scope (§1ao.2, queued as SENSE-CONTEXT) — not a regression, not blocking. Worth handing to whoever picks up SENSE-CONTEXT as fresh evidence, since B's guide specifically said "zero live instances found this week" for the tag "electrolyte" (a different tag).
- **LOW — F3: T4's ranking formula has one interpretation beyond the ruling's literal text (an extra `/1.5` normalization), self-flagged by C for confirmation.** Reviewed: makes T4 rank even lower relative to T1 than a literal reading of §1ao.3 would, i.e. more conservative/safer, and the invariant the ruling actually tests for (T1 full-strength > T4 full-strength at equal specificity) holds under either reading (mutation-verified, check 3 M-RANK). No action needed.
- **LOW — F4 (informational, not a code issue): two near-duplicate OpenAlex records with the identical title** ("...LaCl3-based solid-state electrolytes...", ids `W7213392907`/`W7213327263`) appeared as separate items in live check 3 — a pre-existing dedup-miss (near-identical abstracts differ by minor formatting: "25 degree signC" vs "25 degreesC"), unrelated to REQUIRED-GATE. Both independently verified to genuinely contain "LiCoO2 (LCO)" and "All-solid-state batteries" — their `matchedKeywords` claims are truthful either way.

STATUS: COMPLETE

