# TOKENIZE-PLURALS — A (independent review)

STATUS: VERIFIED

Reviewer: A (fresh, no authorship of the diff). Repo: D:/local files on this PC/Github/Peer/peer, branch Jev-integration-and-sorting-filtering-enhancement, HEAD 57186e30. Working-tree diff under review only (uncommitted).

Scope per §1be (overrides §1bd where they differ): plural folding ONLY at the Required-gate T4 comparison (combine.ts builds a second, folded TF-IDF index for T4's simTopic/simProject via tokenizeFolded). tokenize() itself, the pool-wide ranking index, rerank.ts, the reference table, and the short-tag context check (keyword.ts senseContextGate / senseContextStripSet) are NOT folded. singularize is exported and hardened (protected words, protected suffix, zzes/zes split, plain "-s" guard > 4, "-ses" strips 2 only for "-sses", same-length "sis" irregular target so analyses → analysis). PAPER_CACHE_KEY_VERSION 16 → 17.

This file is updated after each check below. Treat any check not yet updated as not yet run.

## Progress log

- 15:28Z — file created, starting reads (ABC-JEV-INTEGRATION.md §1bd/§1be/§1ap read; B guide / C checkpoint / diff next).
- Read B guide (TOKENIZE-PLURALS-B-20260929T141359Z.md) and C checkpoint (TOKENIZE-PLURALS-C-20260929T141909Z.md) in full, and web/AGENTS.md (boilerplate Next.js notice, unrelated).
- Read the full diff for all 8 files by hand (tokenize.ts, tfidf.ts, combine.ts, term-expand.ts, term-expand.test.ts, required-gate.test.ts, pool-cache.ts, pool-cache.test.ts). Check 1 mostly done — see below.

## Checks

1. Ruling compliance — DONE, see Findings/evidence below. PASS on every sub-check.
2. Independent re-measurement (real functions) — DONE, exact match. See table below.
3. Judge newly admitted papers (3 in P1, 1 in P2) — DONE, see below.
4. Fold-rule census over reference-idf.json — DONE, exact match + independent deeper review.
5. analyses/isGenericTerm side effect — DONE, confirmed by execution.
6. Mutations (T4 fold removal; "-ses" strip-2 regression) — DONE, both mutations independently reproduced and restored with hash proof.
7. Gates (vitest, tsc, eslint, build) — DONE, all 4 match expected numbers exactly.
8. Re-list deferred/accepted items — DONE, all tracked except one small documentation gap (see below).
9. Privacy scan — DONE, clean.

## Check 1 — ruling compliance (evidence)

- `git status --short web/` and `git diff HEAD --stat -- web/` both show exactly the 8 ruled files (pool-cache.ts, pool-cache.test.ts, combine.ts, required-gate.test.ts, term-expand.test.ts, term-expand.ts, tfidf.ts, tokenize.ts).
- `git diff HEAD --quiet -- web/src/lib/scoring/keyword.ts web/src/lib/scoring/sense-context.test.ts` exits 0 — byte-identical to HEAD. PASS.
- `git diff HEAD --quiet -- web/src/lib/feed/rerank.ts` and `-- web/src/lib/scoring/reference-idf.json` both exit 0 — untouched. PASS.
- GENERIC_TERMS: diff for term-expand.ts is a single hunk starting at line 81 (after IRREGULAR_INFLECTIONS); GENERIC_TERMS (lines 35-47) has no diff lines, confirmed still spelled "materials"/"systems" (plural, HEAD's original spelling). PASS.
- tokenize(): only change to tokenize.ts is a new top-of-file import and a new function `tokenizeFolded` appended after `normalizePhrase`; the body of `tokenize()` itself has zero diff lines. PASS.
- Cache-key consumer check: `private-paper-cache.ts` imports `PAPER_POOL_KEY_PREFIX` from pool-cache.ts (not a hardcoded literal) — grep for `peer-pool-v` in non-test src files finds only that one export site plus two pre-existing, stale DOCUMENTATION comments in `channel-candidate-cache.ts` referencing "v7" — that file is untouched by this diff (not one of the 8) and the staleness pre-dates this item (already stale at v16); not a finding against this change. PASS for the ruling's actual ask (single exported prefix, no hardcoded literal consumer).
- Doc comments: read every comment touched in the diff (tokenize.ts's `tokenizeFolded`, tfidf.ts's `buildIndex`/`scoreTfidf` params, combine.ts's `foldedIndex`/T4 block, pool-cache.ts's v17 history, pool-cache.test.ts's version chain, term-expand.ts's `singularize`). Every one states T4-only scope, explicitly lists the SENSE-CONTEXT context check / tokenize() / rerank.ts / reference table as unchanged, and names the accepted under-folds (gases→"gase", biases→"biase", lenses→"lense"). None claims the context check is folded. PASS.
- Cache version: `PAPER_CACHE_KEY_VERSION` 16 → 17 confirmed in pool-cache.ts diff, with a correctly scoped (T4-membership-only) history comment. PASS.

## Check 2 — independent re-measurement (own probe, not C's)

Built my own probe from scratch (`web/src/lib/scoring/__a_probe_tokenize_plurals.test.ts`, temporary, name starts `__a_probe_`), reading real saved data from `<scratchpad>/out/` via env var `A_PROBE_OUT_DIR` (never written into any repo file). Called the real exported `scoreItems` (combine.ts), `senseContextGate` (keyword.ts), `dropStale` (feed/freshness.ts) — no reimplementation of any scoring logic. Reference instant `2026-09-28T16:05:42Z`, tag/seedText shapes reconstructed from BATTERY_PROJECT_TEXT (required-gate.test.ts) and REQUIRED-GATE-B's §2.4 table (topics verbatim: P1 `["solid-state battery electrolyte","sodium-ion battery cathode materials"]`, P2 `["solid electrolyte"]`, P-LCO `["LCO"]`, P4 `["electrolyte"]`; context-check positives = the same-size pool per tag: electrolyte→P4 pool, LCO→P-LCO pool, solid state→P2 pool, matched by inWindow count 145/3/62 respectively).

**AFTER (current working tree, unmutated) — ran first:**

| Pool | inWindow | qualified | Expected (task) | Match |
|---|---|---|---|---|
| P1 | 27 | 20 (incl. W4416056717, W7197006276, W7201986330) | 20/27, same 3 ids | EXACT |
| P2 | 62 | 57 (incl. W7203555874) | 57/62, same id | EXACT |
| P-LCO | 3 | 3 | 3/3 | EXACT |
| P4 | 145 | 88 | 88/145 | EXACT |

| Context tag | Positives pass | Negatives pass | Expected | Match |
|---|---|---|---|---|
| electrolyte | 57/145 | 0/50 | 57/145, 0/50 | EXACT |
| LCO | 2/3 | 0/50 | 2/3, 0/50 | EXACT |
| solid state | 51/62 | 0/50 | 51/62, 0/50 | EXACT |

**BEFORE (temporary mutation — combine.ts's T4 block pointed back at the plain, unfolded `index` instead of `foldedIndex`/`tokenizeFolded`):**

| Pool | inWindow | qualified | Delta vs AFTER |
|---|---|---|---|
| P1 | 27 | 17 | +3 |
| P2 | 62 | 56 | +1 |
| P-LCO | 3 | 3 | +0 |
| P4 | 145 | 88 | +0 |

Context-check numbers under the mutation: identical to AFTER on all three tags (57/145, 2/3, 51/62, 0/50 negatives each) — correct, since this mutation only touches combine.ts's T4 block, not keyword.ts (which is untouched HEAD code regardless of this mutation).

**Set diff, AFTER vs BEFORE admitted ids (computed by script, not by eye):** P1 added exactly `{W4416056717, W7197006276, W7201986330}`, removed `{}`. P2 added exactly `{W7203555874}`, removed `{}`. P-LCO and P4: added `{}`, removed `{}`. **Zero admissions dropped anywhere; the exact named ids are the only ones that moved. §1be's escape clause (P1/P2 gains must survive without the context fold, no admission may drop) does NOT fire.**

While the mutation was live, ran `required-gate.test.ts` in the same command: exactly the 2 named-paper tests (`plural-only-fast-ion-transport`, `plural-only-raman-llzo`) went red (`expected [] to deeply equal [...]`), 16 passed + 2 failed within that file — matches C's step-6 mutation report exactly. This doubles as independent confirmation for check 6's first mutation.

Restored combine.ts (2 lines) immediately after. `sha256sum` before mutating: `4e6093e28eb51ffd46ccd06f74653d8cb656d558dd3eae982f5d0ef666cd6421`; after restoring: `4e6093e28eb51ffd46ccd06f74653d8cb656d558dd3eae982f5d0ef666cd6421` — **identical**.

## Check 3 — judge each newly admitted paper (own read, real title/abstract pulled from saved data)

**P1 (+3):**

1. `openalex:W4416056717`, "Microstructural insights into fast ion transport in solid electrolytes via multiscale modeling" — **genuine**. Multiscale modeling (ML potentials + MD + finite element) of ion transport and grain-boundary effects in argyrodite (Li6PS5X) solid electrolytes for all-solid-state batteries — this is exactly the reader's declared subject (solid-state battery electrolyte materials).
2. `openalex:W7197006276`, "Raman Signatures of Lithium Ion Dynamics in LLZO Garnet Electrolytes..." — **genuine**. LLZO garnet is a textbook solid-state-battery electrolyte material; the paper studies Li-ion transport via Raman/MD in exactly that material class.
3. `openalex:W7201986330`, "Ionic Liquid Electrolytes for Extreme Temperature Conditions: Challenges and Perspective" — **debatable, I agree with B's call but for a sharper reason**: the abstract explicitly frames itself against "solid-state" — it is about LIQUID ionic-liquid electrolytes, explicitly contrasted with "conventional carbonate- or ether-based electrolytes," for extreme-temperature applications. The Required tag is specifically "solid-state battery electrolyte." On a strict reading this is the wrong electrolyte class for that tag (liquid, not solid), so I'd lean slightly further than B toward calling it a borderline false admission for the tag AS WORDED — though it remains squarely inside the reader's stated broader research area (battery electrolyte interfacial stability), which is why T4 (similarity, not literal-keyword) is the mechanism that caught it and why it never claims a matched keyword (`matchedKeywords: []`, confirmed by the required-gate.test.ts fixture and by §1ao.8's "never state a false match" rule).

**P2 (+1):**

4. `openalex:W7203555874`, "Propelling metal sulfide cathodes toward all-solid-state batteries: Insights and advances" — **genuine, with an honest caveat**: title-only (no abstract in the saved record, confirmed by reading the raw file directly — `abstract` is `undefined`), and it never uses the word "electrolyte" at all, so this is not a literal match for the tag "solid electrolyte" — it is admitted purely through T4's project-text similarity (shared "cathode"/"battery"/"all-solid-state" vocabulary), exactly as B's guide describes. Judged against the task's own stated bar ("on-topic for a PhD reader in solid-state battery materials," not "literally contains the tag word"), a review of solid-state-battery cathode materials is on-topic for this reader — cathode/electrolyte interface work is explicitly part of the reader's declared project text. I call this genuine for the reader's overall research direction, while flagging (as B did) that it is admitted by similarity alone, not tag evidence — which is exactly what T4 is for and exactly why it correctly carries no `matchedKeywords`.

Net: 3 of 4 clean, 1 (`W7201986330`) legitimately debatable — same paper B flagged, independent read agrees it's a coin-flip, leaning slightly toward "wrong electrolyte class for the literal tag" rather than rounding it in.

## Check 4 — independent census of `singularize` over reference-idf.json (own script, not C's)

Wrote a second temporary probe (`web/src/lib/scoring/__a_probe_census.test.ts`) that imports the real exported `singularize` and the real `reference-idf.json` (17,489 keys, confirmed by direct read) and independently recomputes the whole-table census from scratch (own collision/shape logic, not copied from C's checkpoint).

**Headline numbers — exact match to C's reported AFTER row:** changed (fold ≠ self) = **2891**, collisions (fold = another real key) = **2151**. (C's checkpoint reports the identical 2891/2151.)

**Named-pair verification (all confirmed present, independently):** `https→http`, `abies→aby`, `adams→adam`, `stevens→steven`, `leurs→leur`, and all 6 decade tokens (`1950s→1950` … `2000s→2000`) — all TRUE.

**Manager's 3 hand-named groups, independently re-verified:**
- All 9 of the named "46-wrong" sample (phases, cases, responses, increases, decreases, causes, releases, pulses, databases) now correctly collide with their real singular key. PASS.
- All 5 named false merges are fixed: `doses→dose`, `bases→base`, `courses→course`, `rises→rise` collide on the CORRECT target now (confirmed NOT on the old false targets dos/bas/cours/ris); `loses→lose` no longer collides at all ("lose" isn't a table key). PASS.
- All of the "right under the old rule" accepted under-folds (`gases→gase`, `biases→biase`, `lenses→lense`, `focuses→focuse`, `viruses→viruse`) correctly stay unmerged. PASS.

**Structural sanity (own classification script, independent of C's):** classified every collision's transformation shape (irregular map / `ies→y` / `zzes→strip2` / `zes→strip1` / `sses|ches|shes|xes→strip2` / plain `-s→strip1`). Every one of the 2151 collisions fits a mechanically sensible shape except exactly one, `matrices→matrix` — which is the OTHER pre-existing irregular-map pair (not part of this diff's g/h fix, and obviously correct). Confirms C's "0 collisions fall outside a known shape" claim (my classifier's 1 "unknown" is a labeling artifact of my own script, not a real anomaly — matrices/matrix is a legitimate irregular pair).

**Independent search for abbreviation false merges (the task's specific risk: "doses→dos collided with the density-of-states abbreviation" class)** — checked whether any collision's TARGET equals one of ~40 common materials-science/electrochemistry abbreviations (sem, tem, xrd, eis, dft, soc, dos, cv, bms, sei, cei, xps, tga, dsc, afm, stm, icp, xrf, nmr, ftir, ocv, etc.): **zero hits.** No abbreviation-collision risk of the fixed doses-class remains anywhere in the table under the current rule.

**Exhaustive read of every short-target collision (≤4 chars, 278 of them — matches C's 278 exactly) plus every 5-6-char-target collision (622, a wider and more exhaustive band than C's 1-in-15 sample of the longer tail):** read all ~900 pairs by eye. Every one is a legitimate English plural/singular or verb-conjugation pair EXCEPT the same small, already-named risk category C flagged — a handful of proper nouns whose "-s" form is also someone's name: `abies→aby`, `adams→adam`, `stevens→steven` (C's), plus 3 more of the identical shape found independently in the 5-6-char band: `carlos→carlo`, `edwards→edward`, `roberts→robert`; and 2 more foreign-language fragments of the identical shape to `leurs→leur`: `autres→autre` (French), plus `leurs→leur` itself. None of these connect two different SCIENTIFIC concepts (the actual risk this check exists to catch) — they are all "a common English/French/Spanish word or name that happens to end in -s" cases, harmless for Peer's actual Required-tag domain (technical topic phrases, not personal names). No new false-merge category found beyond what C already named.

**Consistent-mangling spot check (own script):** `focus/virus/modulus/genus/census/campus/corpus` (-us nouns) and `aqueous/porous/amorphous/nervous/gaseous/viscous/continuous` (-ous adjectives) and `series` all mangle to a nonsense stem (e.g. `focus→focu`, `aqueous→aqueou`, `series→sery`) but **none of these mangled stems equals any OTHER real key in the table** — confirmed programmatically, not by spot-checking a few by hand. These are harmless self-only mangles exactly as the brief anticipated, never a false merge with an unrelated word.

**Assessment: LOW.** The `-ses`/`-sis` amendment (g/h) measurably fixed the 5 real false merges the manager found (doses/bases/courses/rises/loses) and my own independent, wider search (278 + 622 = 900 pairs read by eye, plus a full 2151-pair structural and abbreviation-target sweep by script) found no additional false merge in the fixed rule beyond the same low-relevance proper-noun/foreign-word category C already disclosed.

## Check 5 — the `analyses` -> `isGenericTerm` side effect

Traced every caller by grep (own search, cross-checked against C's list): `term-expand.ts` `termSpecificity` (line 304, `isGenericTerm` is called internally); `keyword.ts` `isShortOrAmbiguous` (line 258) and `senseContextGate`'s overlap axis (lines 394-395); `preferences/upload-concepts.ts` `isAcceptableSingleToken`/`isAcceptableCandidate` (lines 57, 72); `opportunities/shared.ts` line 202 (jobs/events specificity filter). Same 5 call sites C named — confirmed independently, not just re-read from the checkpoint.

**Executed directly** (temporary probe `__a_probe_analyses.test.ts`, real exported `isGenericTerm`/`termSpecificity`, deleted after use):
- `isGenericTerm("analyses")` = **true** (post-fix); `termSpecificity("analyses")` = **0.3**, exactly equal to `termSpecificity("analysis")` = **0.3**. **Consistent, and arguably corrects a pre-existing asymmetry**: before this item, the plural and singular spellings of the same underlying concept scored differently (0.7 vs 0.3) purely because `GENERIC_TERMS` only ever listed the singular form and nothing resolved a plural query back to a listed singular entry — that gap is now closed for this one word, not newly introduced.
- `isGenericTerm("material")` = **false**, `isGenericTerm("materials")` = **true** — confirms by execution (not just by diffing source) that `GENERIC_TERMS`'s revert to HEAD's plural spelling is truly behaviourally inert: the pre-existing singular/plural asymmetry for "material"/"system" (the one §1be point 4 warned would flip if GENERIC_TERMS were RE-SPELLED to singular) is unchanged from HEAD, because the diff does not touch GENERIC_TERMS at all.
- Context-check measurement (check 2, same probe, real `senseContextGate`) already confirmed the pass/fail counts stayed EXACTLY at baseline (57/145, 2/3, 51/62, 0/50×3) on the real measured pools — direct empirical confirmation that this side effect moved no verdict in the tested data, not just C's claim re-read.
- One real pool fact I checked independently that C's report didn't spell out: the literal word "analyses" DOES appear in several measured items (1 in raw-P1b, 2 in raw-P2, 2 in raw-P4, 3 in tagged-LCO, 3 in the electrolyte-clinical negatives — checked by grep over the raw saved JSON) but **never** in `BATTERY_PROJECT_TEXT` (the context text) — so it could never have been part of the overlap axis's intersection (a token absent from the context side can't be shared), which is the structural reason the side effect is inert here, not merely coincidence.
- `upload-concepts.ts`: executed the exact boolean expression `isAcceptableCandidate` uses (`!tokens.every(t => STOP.has(t) || isGenericTerm(t))`, confirmed neither "data" nor any analys- word is in the real `STOP` set by reading it) for `["data","analyses"]` vs `["data","analysis"]`: **both now `false` (rejected)** — before this item, `["data","analyses"]` would have evaluated `true` (accepted) while `["data","analysis"]` was already `false`, since `"data"` is itself a direct `GENERIC_TERMS` member. This is a real, concrete, user-visible behaviour change for resume/CV concept extraction (a phrase spelled "data analyses" now gets filtered exactly like "data analysis" already was) — narrow (needs that exact 2-word phrase with nothing else salvaging it) and, in my judgment, **not wrong** — it removes a grammatical-number-dependent inconsistency rather than introducing a new one. `["statistical","analyses"]` stays accepted either way (verified `true`), since "statistical" isn't generic — most real candidate phrases are unaffected.
- `opportunities/shared.ts` line 202: same mechanism (filters `analyses` out of `specificScoped` if a reader's matched Required tag were literally the word "analyses") — did not build a full jobs/events fixture for this (low-likelihood: a reader would need a Required tag that is exactly the bare plural noun "analyses", an unusual topic tag), but the underlying primitive (`isGenericTerm("analyses") === true`) is the same one already confirmed by direct execution above, so the mechanism is not in question, only its real-world likelihood of firing.

**Assessment: LOW.** Real, named, execution-confirmed side effect, reaches 5 call sites as C said; every reachable consequence I could concretely construct or measure is either inert (context check, confirmed on real data) or a minor consistency fix rather than a regression (upload-concepts.ts). No HIGH/MEDIUM finding here.

## Check 6 — mutations (both, restored with sha256 proof)

**Mutation 1 (done inline during check 2): T4 fold removed** — combine.ts's 2 `scoreTfidf` calls in the T4 block pointed back at the plain `index` instead of `foldedIndex`/`tokenizeFolded`. `required-gate.test.ts` result: exactly the 2 named-paper tests (`plural-only-fast-ion-transport`, `plural-only-raman-llzo`) went red (16 passed, 2 failed within that file) — matches C's own mutation report exactly. Hash before: `4e6093e28eb51ffd46ccd06f74653d8cb656d558dd3eae982f5d0ef666cd6421`; after restore: same. **Identical.**

**Mutation 2: the "-ses" strip-2 regression reintroduced** — term-expand.ts's narrowed regex `(?:(?:ch|sh|x)es|sses)$` reverted to the old, broader `(?:ch|sh|x|s)es$` (i.e., "put the 's' back into the '-ses' strip-2 branch," exactly as instructed). Hash before: `ece96fb8cdb37ebec2a05cbcedb32a903d69895ac4cf0230c153c1fa49cf9fb3` (matches C's own pre-mutation hash from its checkpoint, confirming the file hasn't moved since). Ran `term-expand.test.ts`: **5 of 58 tests went red** — the gases tripwire, `phases`/`cases`/`responses` (plain "-ses" fixtures), and `doses` (the never-"dos" false-merge regression test) — matching C's report exactly ("5 of 58 tests went red"). Restored the 1 line; hash after: same as before. **Identical.** Re-ran `term-expand.test.ts` + `required-gate.test.ts` together post-restore: 76/76 passed.

Neither mutation failed to turn something red — both are load-bearing, real regression tests, not decorative.

## Check 7 — gates (from web/, one at a time, after deleting all 3 temporary probe files and confirming `git status`/`git diff --stat` show exactly the original 8 files again)

| Gate | Result | Matches expected? |
|---|---|---|
| `npx vitest run` | 288 files (285 passed + 3 skipped) / **5247 passed + 6 skipped / 0 failed** | YES — exact match to C's reported 5247+6/0 |
| `npx tsc --noEmit` | 0 errors (exit 0) | YES |
| `npx eslint .` | 0 errors / 151 warnings | YES — matches baseline exactly |
| `npm run build` | OK, all routes compiled, exit 0 (re-ran to double check the exit code specifically) | YES |

All 4 gates pass and match the task's expected numbers exactly.

## Check 8 — every deferred/accepted item, re-listed and checked for a live tracking home

| Item | Named where | Status |
|---|---|---|
| Context-check fold (the naive version this item built, then reverted) → **SENSE-CONTEXT-EVIDENCE** | ABC-JEV-INTEGRATION.md §5 ledger row "SENSE-CONTEXT-EVIDENCE" (NOT_STARTED, "B next after TOKENIZE-PLURALS is committed", §1be.6); the 3 concrete paired positive/negative/end-to-end tests are copied verbatim into TOKENIZE-PLURALS-C's checkpoint under "Deferred specs for SENSE-CONTEXT-EVIDENCE" | TRACKED |
| Accepted under-folds `gases→"gase"`, `biases→"biase"`, `lenses→"lense"` | Named explicitly in term-expand.ts's doc comment above `singularize`, AND pinned by a named regression test (`gases -> "gase"` tripwire, term-expand.test.ts, comment cites "§1be AMENDMENT g" and warns what it means if it ever starts asserting "gas" again) | TRACKED |
| `"ions"` not folded (plain "-s" length>4 guard; `ion`/`ions` both real, unmerged reference-table keys, confirmed by direct read of reference-idf.json and by executing `singularize("ions") === "ions"`) | **Not named anywhere** — not in term-expand.ts's doc comment (which names only gases/biases/lenses), not in a test, not in the ABC-JEV-INTEGRATION.md ledger | **GAP — see Findings (LOW)** |
| The "-sis" gap (`hypotheses`/`syntheses`/etc. not irregular-mapped, so T1's `inflectedForms` still mis-pluralizes them; separately, `singularize` only special-cases the existing `analyses`/`analysis` pair, nothing else "-sis") | term-expand.ts's doc comment ("hypotheses/syntheses stay the deferred '-sis' follow-up (§1bd point 2)"); ABC-JEV-INTEGRATION.md §1bd point 2 ("term-expand's '-sis' gap → follow-up (low)"); folded into the §5 ledger row "PLURALS-GLOBAL / EXCLUSION-PLURALS" 's own description ("term-expand misses the '-sis' word class") | TRACKED |
| **PLURALS-GLOBAL** (Option A's wider, global fold — pool-wide topicality index + rerank.ts — needs its own ranking-quality pass) | ABC-JEV-INTEGRATION.md §5 ledger row "PLURALS-GLOBAL / EXCLUSION-PLURALS" (NOT_STARTED, low, §1bd.1) | TRACKED |
| **EXCLUSION-PLURALS** (combine.ts's `normalizePhrase`-based exclusion/negative-topic substring match is plural-blind by construction — confirmed this diff does not touch `topicMatchesItem`/`isProtectedRequiredTopic`, the only 2 callers of `normalizePhrase`) | Same §5 ledger row (§1bd.5) | TRACKED |
| `rerank.ts` inheriting whichever option ships | N/A — moot: Option B ships, and Option B's whole point is that `rerank.ts` stays untouched (confirmed byte-identical to HEAD in check 1); nothing to inherit | N/A, correctly not an open item |

## Check 9 — privacy scan

Scanned all 8 changed files plus both TOKENIZE-PLURALS docs (B guide, C checkpoint) for: the literal absolute scratchpad path (which carries the Windows account name), any `C:\Users\<name>`-shaped path, any email-address-shaped string, the specific known account email/name fragments, and university/student-id-shaped strings. Ran each as a separate targeted search over exactly those 10 files (search patterns described in words here, not reproduced literally, per instruction). **Zero hits in every category.**

Separately confirmed every scratchpad reference in the B guide and C checkpoint already uses the safe `<scratchpad>/…` shorthand (5 occurrences checked, none is the literal path) — and confirmed my own report file (this one) does the same throughout.

**Assessment: clean, no privacy finding.**

## Findings

1. **LOW — `"ions"` is a real, verified accepted under-fold that is not documented anywhere.** `ion` and `ions` are both real, separate keys in the shipped `reference-idf.json` (weights 5.605 / 5.868, confirmed by direct read); `singularize("ions")` returns `"ions"` unchanged (confirmed by direct execution — the plain "-s" rule's `length > 4` guard excludes any 4-letter plural). Unlike `gases`/`biases`/`lenses`, which get an explicit doc-comment name and a dedicated regression test, this one is invisible in the diff, the tests, and the ABC-JEV-INTEGRATION.md ledger — a future reader has no way to learn about it short of re-deriving it. Low severity because the under-fold itself is safe (conservative, same "accepted cost" shape as the named ones, no false merge), and "ion"/"ions" is common electrochemistry vocabulary so it is a real, if minor, T4-recall gap for any Required tag whose only mismatch with a candidate paper is exactly this word's grammatical number. Suggested fix (not mine to make): either name it alongside gases/biases/lenses in the doc comment, or fold it into PLURALS-GLOBAL's write-up so a future length-guard change doesn't silently drop it.
2. **LOW — one P1 admission (`openalex:W7201986330`) is debatable** (check 3): the tag says "solid-state," the paper is explicitly about liquid ionic-liquid electrolytes. Already disclosed by B and C as "debatable"; my independent read agrees it's genuinely a coin-flip, leaning slightly toward "wrong electrolyte class for the tag as literally worded." Not a defect in the diff — T4 is a similarity fallback by design, correctly carries no `matchedKeywords`, and this is the kind of marginal case the mechanism is expected to sometimes produce.
3. **LOW — a handful of proper-noun/foreign-word fold collisions beyond the ones C already named**, found during my own independent, wider read of the 5-6-character collision band (622 pairs, fully read): `carlos→carlo`, `edwards→edward`, `roberts→robert` (same shape as C's `adams→adam`/`stevens→steven`), and `autres→autre` (same shape as C's `leurs→leur`). Same risk category C already disclosed, not a new one; harmless for Peer's actual Required-tag domain (technical topic phrases, not personal names).
4. **LOW — `upload-concepts.ts`'s `isAcceptableCandidate` now rejects the 2-word phrase "data analyses"** where before this item it would have been accepted (while "data analysis," singular, was already rejected) — confirmed by executing the exact boolean expression. Judged not wrong: it removes a grammatical-number-dependent inconsistency rather than introducing one.

No HIGH or MEDIUM finding. Every check that could be run, was run, by execution, and matched the task's expected numbers exactly.

## Verdict

**VERIFIED**

All 9 checks complete. Ruling compliance is exact (the 8 files, byte-identical keyword.ts/sense-context.test.ts, untouched rerank.ts/reference-idf.json, unchanged tokenize(), correctly-scoped doc comments, cache bump 16→17). My own from-scratch probe reproduces every one of the task's "expected after" numbers exactly (P1 20/27 incl. the 3 named ids, P2 57/62 incl. the named id, P-LCO 3/3, P4 88/145, context check 57/145 & 2/3 & 51/62 with 0/50 negatives on each tag) and the "before" numbers via an independent mutation (P1 17/27, P2 56/62, P-LCO 3/3, P4 88/145) — the escape clause does not fire, zero admissions dropped anywhere. Both required mutations turn exactly the predicted tests red and both restores are hash-verified identical. My own independent whole-table census matches C's 2891 changed / 2151 collisions exactly and a wider manual read (900 pairs across the ≤4 and 5-6 char bands, versus C's 278 + a 1-in-15 sample) found no new false-merge class beyond the low-relevance proper-noun/foreign-word one C already disclosed, and specifically zero collisions onto any known domain abbreviation (the exact risk class the fixed doses→dos bug belonged to). All 4 gates match the task's expected numbers exactly. Privacy scan clean. The only findings are LOW severity, already substantially disclosed by B/C or genuinely marginal, none blocking.

Report path: `docs/jev-abc/TOKENIZE-PLURALS-A-20260929T152804Z.md`
