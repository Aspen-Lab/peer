STATUS: VERIFIED (2026-09-30T11:41:45Z) — see full findings and rulings at
the end of this file.

# QUERY-DISLIKE — A (fresh, independent reviewer)

Role: A (reviewer). Branch Jev-integration-and-sorting-filtering-enhancement,
HEAD b5ffc8c1. Change under review: UNCOMMITTED, 12 files under web/src (see
checkpoint docs/jev-abc/QUERY-DISLIKE-C-20260930T104019Z.md). Covers
ABC-JEV-INTEGRATION.md §1bs (QUERY-GENERIC-WORDS) and §1br (DISLIKE-CHANNEL).
I did not write this change; I measure it against the binding rulings and
try to break it. No product code or test edits by me. Policy questions are
flagged "POLICY — manager decides", not answered.

Read done: §1bs, §1br, §1bo.9(a), §1ay, §1az, §1at + CORRECTION (all
binding); the C checkpoint (claims treated as unverified until reproduced);
both B guides (QUERY-GENERIC-WORDS, DISLIKE-CHANNEL).

Method set up: fresh read-only HEAD extraction at
`<scratchpad>/a-qd-head` (`git archive HEAD web/src | tar -x`, HEAD =
b5ffc8c1); two resolver-hook copies, `<scratchpad>/a-qd-hook.mjs` (live
working tree) and `<scratchpad>/a-qd-hook-head.mjs` (the HEAD extraction) —
both smoke-tested successfully against the real `compileSearchBrief` and
`scoreItems`.

## Plan

1. Adversarial Part-1 token table (required designations + my own harder
   tokens) through the real compileSearchBrief/briefToSeedTexts.
2. Decimal-chunk rule + dash/ellipsis delimiters + abbreviation behaviour.
3. PURE-ASCII byte-identical check: HEAD vs. live over the guide's 62-text
   corpus + my own texts; re-derive the corpus set diff.
4. Part 2: grep dead-code claims; hard exclusion untouched; backward
   compatibility of old request shapes (real route parsing); saved-pool
   score comparison; judge rewritten test + tripwire test.
5. Tests and mutations: diff every test file vs. HEAD; reproduce >=3
   mutations myself with sha256 before/after and byte-exact restore.
6. Cache: PAPER_CACHE_KEY_VERSION 21 via the single exported prefix.
7. Gates: vitest, tsc, eslint, build from web/.
8. Privacy scan of changed files + checkpoint.

Findings will be appended below as each check completes. This file is
updated after each check with a fresh `date -u` timestamp so STATUS stays
honest if this review stalls or is resumed.

## Progress log

- 2026-09-30T11:14:00Z — file created, plan above, read-first docs and
  method setup done. Starting check 1.
- 2026-09-30T11:26:01Z — Checks 1-3 done (Part 1, QUERY-GENERIC-WORDS).
  Details below; STATUS stays IN_PROGRESS, continuing to check 4 (Part 2).

## Check 1 — adversarial token survival (Part 1)

Method: real `compileSearchBrief` via `<scratchpad>/a-qd-hook.mjs` (live
tree), each token tested standalone AND embedded in a realistic sentence.

**All 10 ruling-named designations survive, standalone and embedded:**
18650, 21700, 7075, 316L, LiCoO2, NMC811, GPT-4, 1T-MoS2, 4H-SiC, CR2032.
Confirmed by execution, not by reading. A combined text containing all 10 at
once (`a-qd-7` in check 3's corpus) produced byte-identical output between
HEAD and the live tree — zero collateral impact when they appear together.

**My own harder tokens — verdict table:**

| token | verdict | why |
|---|---|---|
| 3D-printed | intended (kept) | letter-first after lowercasing check point, never reaches the unit-suffix branch |
| 28nm | **FINDING — harm** | number+`nm` suffix; `nm` is a real unit AND a common semiconductor process-node designation ("28nm process") — removed either way. Confirmed NOT removed on HEAD, removed on live (new side effect of this diff). Ruling's own closed list names `nm` verbatim, so this is inherited from the binding ruling, not a C deviation — POLICY. |
| 300K | **FINDING — harm** | number+`K`; K is temperature (correctly caught) but "300K" is also common informal shorthand for a large count/threshold. Same root cause as 28nm — ruling's own list, POLICY not deviation. |
| 1.5C | **FINDING — harm, notable** | number+`C`; a battery "C-rate" (1.5C = 1.5x capacity/hour), extremely common battery-science notation, removed because `c` stands in for Celsius in the closed list. Confirmed new vs. HEAD. Ruling-inherited, POLICY. |
| 0.1M | intended (kept) | bare "m" deliberately excluded from the unit list per the ruling ("bare L and M stay off so 316L survives") — this is a stated, deliberate accepted cost, not a bug. |
| 10wt% | intended (kept, is noise) | "wt%" isn't a literal member of the closed list (only bare "%"); a residual miss, not a harmful over-removal — consistent with the ruling's "every other token stays" philosophy. |
| 5mol% | intended (kept, is noise) | same as 10wt% |
| LiPF6 | intended (kept) | letter-first |
| EC:DMC | survives nowhere, PRE-EXISTING | colon delimiter + 2-char halves; identical on HEAD and live — not a new regression, out of scope |
| 3:7 | same as EC:DMC | pre-existing, unrelated to this diff |
| pH7 | doesn't reach the tier, PRE-EXISTING | 3 characters, pre-existing length>=4 gate on both HEAD and live |
| 18650-type | intended (kept) | suffix "-type" not a unit |
| NMC-811 | intended (kept) | letter-first |
| 1990s | **FINDING — harm, notable** | number+`s`; `s` (seconds) collides with the plural-decade suffix, so a plain decade reference ("battery research since the 1990s") is misclassified as "1990 seconds" and removed. Confirmed new vs. HEAD (HEAD kept it). Ruling-inherited (`s` is in the ruling's own list), POLICY. |
| 2030s | same bug as 1990s | confirmed new vs. HEAD |
| Li7La3Zr2O12 | intended (kept) | letter-first (LLZO garnet electrolyte formula) |
| H2O2 | intended (kept) | letter-first |
| CO2RR | intended (kept) | letter-first |
| 5G | not reachable, PRE-EXISTING | only 2 characters; length gate (unrelated to this diff) kills it before the numeric filter would ever run, on both HEAD and live |
| S/cm, mS/cm | intended (kept) | letter-first, no leading number (the filter only fires on a number+unit pair, not a bare unit) |
| v2.0 | intended (kept) | letter-first |
| Python3 | intended (kept) | letter-first |
| COVID-19 | intended (kept) | letter-first |
| IL-6 | intended (kept) | letter-first |
| p53 | not reachable, PRE-EXISTING | 3 characters, length gate, identical HEAD/live |
| BRCA1 | intended (kept) | letter-first |

Unit list: closed, stated in a code comment, matches the ruling's own list
verbatim (mapped and checked term-by-term). Case handling: keyword branch
lowercases before the filter runs, confirmed by reading and by execution.
The checkpoint's own claim ("°C is matched as bare 'c'") is accurate only
when the source text has NO degree sign — verified that text WITH "°" (e.g.
"40°C") never reaches this filter at all: "°" is stripped to whitespace by
the (pre-existing, unrelated) allowed-character regex first, splitting the
temperature into two sub-4-character fragments that the pre-existing length
gate already drops on both HEAD and live. Collateral is real (the whole
temperature reading vanishes) but is pre-existing and orthogonal to this
diff, not something it worsens.

## Check 2 — decimal chunk rule, dash/ellipsis, abbreviations

Confirmed by execution (HEAD vs. live) that "3.7V", "99.9%", "GPT-3.5",
"v2.0" all stay whole on live and are corrupted mid-number on HEAD (e.g. HEAD
splits "GPT-3.5" into "Compare GPT-3" / "5 and GPT-4..."). Sentence-final
period after a number still splits ("Testing concluded in 2024. Then the
team...") — confirmed on both HEAD and live (unchanged, correct). Em dash,
en dash, ellipsis all confirmed as delimiters on live and NOT on HEAD, across
4 separate constructions including "an English phrase splits at an em dash"
exactly as the ruling requires. Abbreviations ("e.g.", "et al."): confirmed
BYTE-IDENTICAL broken behavior on HEAD and live (still split mid-abbreviation
at every internal period; not something the ruling asked to fix) — **pre-existing,
unchanged**, correctly out of scope.

**FINDING (Part 1, MEDIUM-HIGH, the most significant of this review) — a
bare year/unit/decimal token immediately followed by a sentence-final period
is NOT removed.** Root cause: the keyword branch keeps "." as an allowed
in-token character (needed for legitimate decimals/versions like "3.7" or
"v2.0"), so a sentence like "...set for 2024. The team..." produces the
keyword token "2024." (period glued on). `STANDALONE_YEAR` is anchored
(`^...$`) and does not match a string with a trailing period; the
number+suffix check then sees suffix "." (not a real unit), so the token is
not removed either. Confirmed by execution for all 4 shapes: a bare year
("2024." survives), a number+unit ("4.2v." survives, "45ma." survives), and
a bare decimal ("99.9." survives — this is the ruling's own explicit
"decimal with no letters" case). Confirmed this reaches `activeQuestions`
(seed text / context check input) in every case, and reaches
`generatedQueries` (what real paper-source adapters receive) at a concrete
list position — with a short enough text it lands inside dblp/pubmed's or
openalex/S2/arxiv's actual cap window (demonstrated: `["Reached 99.9","...",
"reached","99.9."]`, position 4 of 5). None of the 16 new tests in
profile-compiler.test.ts cover this shape (verified by reading the full
diff) — every new test's number/unit/decimal token is either followed by a
comma, a closing paren, or end-of-string, never immediately by a
sentence-final period. This is a real gap in the fix's own coverage, not
covered by the ruling's own explicit scope discussion, and not a case the
guide's 62-text corpus exercised either (confirmed in check 3). Ending a
sentence on a bare fact-with-units before the next sentence is ordinary
English, so this is a plausible, not exotic, miss.

## Check 3 — PURE-ASCII byte-identical corpus diff (independent re-derivation)

Fresh HEAD extraction via `git archive HEAD web/src | tar -x` into
`<scratchpad>/a-qd-head` (HEAD = b5ffc8c1, confirmed via `git rev-parse
HEAD`); two resolver-hook copies (live tree / HEAD tree), both smoke-tested.
Ran the REAL `compileSearchBrief` (both `activeQuestions` via `challenge`
and `generatedQueries` via `project`, topics: []) over the guide's own
62-text corpus (imported as DATA from `qgw-corpus.mjs`, its ANALYSIS not
trusted) plus 14 of my own adversarial texts (76 total), once against HEAD
and once against the live tree, then diffed every text's output myself
(`<scratchpad>/a-qd-check3-collect.mjs`, `a-qd-check3-diff.mjs`).

**Result over the guide's original 62 texts: exactly 7 distinct tokens
removed — `-40c, 175b, 2024, 3.7v, 45ma, 500wh/kg, 99.9` — independently
re-derived, verbatim match to the checkpoint's own reported list. Zero
domain words lost, zero generic words lost, zero required-designation
losses.** Every other difference across the 62-text corpus is explained by
one of: (a) the decimal-chunk-safety fix replacing a corrupted 2-fragment
split with the correct whole phrase (a majority of the diff lines: c-batt-3,
c-batt-4, c-edge-2, c-edge-5, c-edge-8 all show this exact pattern); (b) a
keyword slot freed by a removal or a corrupted-fragment fix, letting one
more genuine word from later in the sentence into the fixed-size output
window (e.g. "solid" in c-batt-4 — matches the checkpoint's own disclosed
example exactly, independently reproduced — plus several more instances the
checkpoint did not individually enumerate: "focused", "parameter",
"cycles", "outputs"); (c) the dash/ellipsis fix converting one bare
whole-sentence chunk into several correctly-split, more specific phrases,
displacing bare single keywords in the output — a positive, intended
trade-off consistent with QUERY-BUDGET's existing philosophy (phrases
should rank ahead of bare words).

**FINDING confirmed via this same byte-diff (corroborates the chunk-path
gap suspected in check 1's adversarial testing) — MEDIUM:** my own text
`a-qd-6` ("Cathode synthesis route, 99.9%, purity requirement for the
powder.") shows `"99.9%"` **added** on live (absent on HEAD). Root cause,
traced: on HEAD, the OLD decimal-blind chunk splitter ALSO split inside
"99.9%" (on the internal period), producing two sub-4-character fragments
("99", "9%") that the pre-existing length gate silently dropped — so the
token never appeared at all pre-fix, by accident. On live, the new
decimal-safe splitter correctly stops treating that period as a delimiter,
so the comma-isolated chunk "99.9%" now survives WHOLE — but since it
arrives via the chunk/phrase path, not the keyword path, the new
`isGenericNumericToken` filter (wired only into the keyword branch, per
§1bs.1's own explicit scoping: "the filter lives in phrasesFromText's own
keyword step") never runs on it. Net effect: fixing the decimal-corruption
bug (§1bs.2) accidentally *un-fixes* §1bs.1's own goal for any bare
number+unit token that forms its own comma/dash/period-isolated clause — a
completely ordinary way to write a sentence (e.g. "Solid-state battery
study, 500Wh/kg, target for future devices."), independently confirmed with
4 separate constructions in check 1b, all showing the bare token reaching
both `activeQuestions` and `generatedQueries` (the latter within an actual
per-source cap window in a short-enough text). The checkpoint's own
corpus-diff writeup does not mention this pattern (its "KEPT" note only
discusses two SINGLE-TOKEN whole-text fixtures, c-edge-6/c-edge-7, calling
that narrow case "correct, since the ruling scopes the filter to the
keyword step alone" — it does not discuss the more general, more reachable
comma-isolated-clause-within-a-longer-text shape this review found, nor
that the decimal fix actively creates new instances of it).

Methodological note: this byte-diff approach, by construction, cannot catch
a token that was ALREADY unfiltered on HEAD and remains unfiltered on live
for a different reason (e.g. the sentence-final-period escape in check 2 —
"2024." survives on both HEAD and live, for unrelated reasons on each side,
so it never appears as a HEAD-vs-live difference at all). That finding
depended on check 2's adversarial testing, not this check — noted so the
two methods are understood as complementary, not redundant.

Continuing to check 4 (Part 2, DISLIKE-CHANNEL).

- 2026-09-30T11:37:08Z — Checks 4-5 done. Details below.

## Check 4 — Part 2 (DISLIKE-CHANNEL)

**Dead-code grep, whole `web/src` tree:** every remaining reference to
`negativePenalty`, `legacyDislikePenalty`, `isProtectedRequiredTopic`,
`legacyNegativeTopics` is inside a COMMENT (explaining the history) —
zero live calls, zero remaining `ScoringProfile` fields. Confirmed by
reading `combine.ts`, `scoring/types.ts`, `feed/pipeline.ts` diffs in full:
the deletions are exactly what the plan claimed, `profile.exclusions`/the
hard-drop filter is byte-for-byte untouched. `negativeTopics` still exists,
correctly, as its own field on `FeedRequest` (not inherited from
`ScoringProfile` any more, `feed/types.ts:74`) — grep confirms it is read
by 4 real call sites (`api/feed/route.ts`, `dispatch-digests/route.ts`,
`test-digest/route.ts`, `profile-compiler.ts:481`'s `avoid`-list
construction) — a separate, still-alive mechanism, exactly as claimed.

**Backward compatibility — proved by executing the real request parser,
not by reading.** `api/feed/route.ts`'s `POST` does `body = await
req.json()` with no schema/strict validation of any kind (confirmed by
reading the whole handler — nothing rejects an unrecognized or
legacy-shaped body). `normalizeFeedIntent` (`feed/intent.ts:178`) falls
back `raw.exclusions ?? raw.negativeTopics` for a legacy (no v1 "intent"
card) request. Executed directly (`<scratchpad>/a-qd-check4-backcompat.mjs`)
with a constructed OLD-shaped body — top-level `negativeTopics` array, no
`intent` card, exactly what a browser tab loaded before this deploy would
still send — result: **`{ ok: true, intent: { ..., exclusions: [{ kind:
"exclude-term", value: "porous scaffold" }] } }`** — accepted, not
rejected, and correctly converted into the live `exclusions` mechanism.
The daily-email builder (`dispatch-digests/route.ts`'s
`digestFeedRequestFromProfile`, UNCHANGED by this diff) is a thin wrapper
around the same `normalizeFeedIntent`, reading `exclusions: row.disliked_topics`
directly from the stored profile row — verified by reading in full; not
re-executed directly (the same private-paper-cache.ts import-chain
limitation the DISLIKE-CHANNEL guide itself hit and disclosed applies here
too — a TS "parameter property" the strip-only Node loader can't handle),
but the wrapper is a pure, trivial field-rename with no branching logic of
its own, so reading it is sufficient. **Verdict: an old client/job/digest
request is accepted, not rejected, after this deploy.**

**Saved-pool score comparison — re-run independently, not just re-read.**
Own script (`<scratchpad>/a-qd-check4-collect.mjs`, deliberately DIFFERENT
from the checkpoint's own `c-dch-collect.mjs`: derives each pool's dislike
term from the LAST title-bearing item's first 4 words, not the checkpoint's
first item / first 3 words), run twice via this review's own two hooks
(HEAD extraction, live tree) over the same 27 real saved pool files in
`<scratchpad>/out/` (path passed only via the `A_POOL_DIR` env var), using
the real, unmodified `scoreItems`. **Result: 0 score differences, 0
survivor-set differences, 686 items compared across 27 files** — same
headline finding as the checkpoint, independently reproduced with a
different dislike-term selection (so not simply re-running their exact
inputs).

**Judging the rewritten `negative-penalty.test.ts` (new contract, not
weakened):** read the full diff. Every assertion changed from "score ratio
≈ 0.15" to "item absent" — this is the CORRECT contract change, not a
weakening: the old assertion precisely tested a mechanism proven dead in
production (per §1at's own CORRECTION), while the new assertion tests the
mechanism that actually governs a reader's declared dislike today (the
hard drop). The third test's regression-guard purpose (a review-shaped
item is excluded only when a matching term is actually declared, never
merely for looking like a review — guarding against the exact SCORE-ZERO
regression class) is preserved intact under the new contract. Reasonable,
disclosed overlap-check against `admission.test.ts`/`pipeline.score-zero.test.ts`
(different fixture domains / different layers) — not pure duplication.

**Judging the tripwire test — reproduced by mutation (see check 5), goes
genuinely red, not vacuously green.** The test asserts `dislikedTopics`
stays `[]` AND separately asserts the ledger actually received a nonzero
negative entry (so the first assertion cannot pass merely because nothing
happened at all). It only checks `dislikedTopics` specifically, not a
generic "any exclusion list" — but the investigation's own exhaustive
search (re-verified by my own grep in this check) confirms `dislikedTopics`
IS the only such field in this codebase, so this is complete coverage, not
a narrow one.

## Check 5 — mutations (independently reproduced, sha256-verified,
byte-exact restored)

Baseline hashes captured before any mutation (all three matched the
checkpoint's own reported hashes exactly, confirming no drift since the
checkpoint was written): `profile-compiler.ts`
`0bbdd2d6...2eb30ff6`, `store/feed.ts` `e2ed319b...4d5c6cde`. Line endings
recorded via `git ls-files --eol` before touching anything:
`profile-compiler.ts` is LF in the working tree, `store/feed.ts` and
`combine.ts` are CRLF.

1. **Drop the unit-list check** (`return CLOSED_MEASUREMENT_UNITS.has(suffix)` →
   `return true`) → exactly 2 of the 3 designation-survivor `it.each` groups
   went red (the two digit-first groups: 18650/21700/7075/316L and
   1T-MoS2/4H-SiC/CR2032 — specifically because 316L/1T-MoS2/4H-SiC flip;
   18650/21700/7075/CR2032 individually stay correct but share a test with
   a flipped member); the letter-first LiCoO2/NMC811/GPT-4 group correctly
   stayed green (never reaches this branch at all). Restored; sha256
   confirmed byte-exact.
2. **Split on every period again** (removed the `(?<!\d)`/`(?!\d)`
   digit-lookaround, kept the dash/ellipsis delimiters untouched to isolate
   this specific rule) → the decimal-whole-chunk test went red, reproducing
   the exact corrupted fragment `"Cells reached 3"`. Restored; sha256
   confirmed byte-exact.
3. **Remove the dash delimiters** (dropped `–—…` from the
   split character class) → all 4 dash/ellipsis tests went red. Restored —
   **this restore initially produced a BYTE-DIFFERENT (though behaviorally
   identical) file**: my edit tool's parameter handling silently converted
   the typed `–`-style escape text into actual Unicode dash characters
   on write, while C's original source used the literal 6-character escape
   text specifically inside the regex (confirmed: en dash and ellipsis each
   appear exactly ONCE in the whole file, only on this line; em dash
   appears 39 times, the other 38 being ordinary prose punctuation in
   comments elsewhere in the file — converting only the regex line's 3
   characters, scoped precisely by line index via a raw Node script rather
   than the edit tool, fixed it). Caught by the sha256 check (functional
   tests alone passed throughout and would NOT have caught this), corrected,
   re-verified: sha256 now matches exactly, and `git diff`'s own blob hash
   (`f1fa2fba`) matches this review's very first, untouched reading of the
   diff at the start of this session. Noted here for transparency — this
   was an artifact of my own review tooling, not a defect in the reviewed
   change.
4. **Make `notInterestedPaper` also append to `dislikedTopics`**
   (`store/feed.ts`) → the DISLIKE-CHANNEL tripwire test in `feed.test.ts`
   went red with the exact error shape the checkpoint reported (`expected
   [ 'Dismissal tripwire fixture paper' ] to deeply equal []`). Restored;
   sha256 confirmed byte-exact.

Final `git status` after all 4 mutation cycles: exactly the same 12
modified product files as before check 5 began, nothing stray.

Continuing to checks 6-8 (cache, gates, privacy).

- 2026-09-30T11:41:45Z — Checks 6-8 done. All checks complete. Final verdict
  and rankings below.

## Check 6 — cache version

`PAPER_CACHE_KEY_VERSION = 21` (private constant, `pool-cache.ts:402`),
exported ONLY through `PAPER_POOL_KEY_PREFIX` (grep confirms no other file
references the raw number). One bump total (Part 1's 20→21; Part 2 correctly
took no bump, matching its own score-identical proof in check 4).
`pool-cache.test.ts`'s exact-version pin was REWRITTEN (v20→v21, not
deleted), and the running version-history comment was extended following
the same convention every prior bump used. Clean.

## Check 7 — gates (run myself, from web/)

- `npx vitest run`: 291 passed + 3 skipped (294 files) / **5680 passed + 6
  skipped / 0 failed**. Matches the checkpoint exactly. No retry needed.
- `npx tsc --noEmit`: **0 errors**.
- `npx eslint .`: **0 errors / 151 warnings**. Matches baseline exactly.
- `npm run build`: **OK**, 29/29 static pages, exit code 0, no retry needed
  (no network font fetch failure encountered).

All four independently reproduced, all match the checkpoint's claims and
the stated HEAD baseline (5664 passed at HEAD; this diff nets +16 tests,
5680).

## Check 8 — privacy scan

Scanned all 12 changed files' current full content plus the checkpoint
document for email-shaped strings, Windows user-profile paths (both long
and 8.3-short-name form), and secret-shaped strings (provider key
prefixes; `key`/`secret`/`token`/`password`-named assignments holding a
long base64/hex-shaped value). **Result: 0 matches, every category, every
file.** (Counts only, per the constraint — no matched text captured because
there was none.)

---

# FINDINGS, ranked by severity

## MEDIUM — a bare year/unit/decimal token immediately before a
sentence-final period is not removed (Part 1, §1bs.1)

The keyword branch keeps `.` as an allowed in-token character (needed for
legitimate decimals/versions). A sentence like "...set for 2024. The team
began..." produces the keyword token `"2024."` (period glued on).
`STANDALONE_YEAR` is anchored end-to-end and does not match a trailing
period; the number+suffix check then sees a non-unit suffix (`"."`), so
the token survives either way. Confirmed by execution for a bare year, a
number+unit ("4.2v.", "45ma."), and a bare decimal ("99.9." — the ruling's
own explicit case). Reaches `activeQuestions` (the context-check's seed
text) every time, and reaches `generatedQueries` at a real list position
that can fall inside an actual source's query cap on a short enough text
(demonstrated: `["Reached 99.9","...","reached","99.9."]`, position 4 of
5). None of the 16 new tests cover this shape; every test's token is
followed by a comma, a closing paren, or end-of-string, never a
sentence-final period. Not covered by the guide's 62-text corpus either.
Ending a clause on a fact-with-units is ordinary English, not an exotic
case. Likely a small, surgical fix (tolerate one trailing period, or strip
trailing punctuation before classifying).

## MEDIUM — a bare number+unit token isolated as its own
comma/dash-delimited clause survives whole, unfiltered (Part 1, §1bs.1 vs.
§1bs.2 interaction)

`isGenericNumericToken` is wired only into the keyword branch (per
§1bs.1's own explicit scoping), never into the chunk/phrase branch. A
text like "Solid-state battery study, 500Wh/kg, target for future
devices." splits on commas into a chunk that is JUST the bare unit token
("500Wh/kg"), which is long enough (>=4 chars, <=10 words) to survive
whole via `longPhrases`, reaching both `activeQuestions` and
`generatedQueries` (the latter within an actual per-source cap window on
a short text) exactly as un-filtered as before this diff. Directly
observed as a side effect of the decimal-chunk-safety fix itself in the
independent corpus re-derivation (check 3): `"99.9%"` in a text from this
review's own corpus went from silently destroyed (by the OLD
decimal-blind splitter, into two sub-length fragments) to surviving WHOLE
on live — fixing one bug un-fixes the other for this shape. The
checkpoint's own corpus-diff writeup discloses a narrower instance of this
(two single-token WHOLE-TEXT fixtures, c-edge-6/c-edge-7) and calls it
"correct, since the ruling scopes the filter to the keyword step alone" —
accurate as far as it goes, but doesn't surface how much more generally
reachable the pattern is (any comma/dash-isolated clause within a longer,
realistic sentence, not only a single-token whole text).

## MEDIUM, POLICY — ruling's own closed unit list collides with several
ordinary non-measurement usages (Part 1, §1bs.1)

C implemented the ruling's own example unit list verbatim and correctly
(independently verified term-by-term). That list's short, reused letter
suffixes cause real collateral removal of tokens that are not
measurements: `28nm` (semiconductor process-node designation, `nm` also
means nanometers), `1.5C` (battery C-rate — extremely common battery-
science notation, `C` also stands in for Celsius in this list), `300K`
(informal large-number shorthand, `K` also means Kelvin), and — the most
field-independent case — `1990s`/`2030s` (an ordinary decade reference in
ANY field, misread as "1990/2030 seconds" because `s` is in the list for
seconds). All four confirmed NEW relative to HEAD by direct execution (HEAD
kept every one; live removes every one). Since C followed the binding
ruling's own verbatim list, this is not an implementation deviation — it
is a real, execution-confirmed cost of the ruling's own design that the
guide's largely battery/chemistry-weighted corpus did not surface,
particularly the decade-suffix collision, which has nothing to do with
scientific field. **POLICY — manager decides** whether to narrow the list
(e.g. exclude `s` given the decade-suffix collision, or require a unit
suffix to be followed by a word boundary / not be immediately followed by
another letter) or accept as-is.

## LOW — residual noise not caught by the closed list (Part 1)

`10wt%`, `5mol%` (compound percent-based units common in materials
science) are not literal members of the closed list (only bare `%` is),
so they survive as noise. This is a miss, not a harmful over-removal —
consistent with the ruling's own "every other token stays, accepted cost"
philosophy — not a defect.

## LOW — process/cosmetic notes, no action needed

A Celsius value written WITH the actual degree sign (e.g. "40°C") never
reaches this filter at all — "°" is stripped to whitespace by a
pre-existing, unrelated regex, splitting the reading into two
already-too-short fragments before this diff's code ever runs. Confirmed
pre-existing (identical on HEAD and live), not something this diff
worsens. Two duplicate entries in the `CLOSED_MEASUREMENT_UNITS` Set
literal ("mm", "µm" each listed twice) are harmless (Set dedupes) but
could be tidied. This review's own corpus re-derivation (check 3) found
several more instances of the "a corrupted-fragment fix frees a keyword
slot for a genuine word" side effect than the checkpoint individually
named (it disclosed one, "solid"; this review found "focused", "lithium",
"parameter", "cycles", "outputs" too) — not a discrepancy, just a
coarser-vs-finer measurement granularity (the checkpoint's own "0 domain/
generic words lost" headline claim, re-derived independently, holds either
way).

## Part 2 (DISLIKE-CHANNEL, §1br) — no findings

Every check came back clean: dead-code grep exhaustive (zero live
references to any of the four removed identifiers); `profile.exclusions`
untouched; backward compatibility proved by executing the real,
unmodified request parser on a constructed old-shaped request body
(accepted, correctly converted); saved-pool score comparison independently
re-run with a different methodology than the checkpoint's own script (0
score differences, 0 survivor-set differences, 686 items across 27 files);
the rewritten unit test is a genuine new contract (testing the mechanism
that actually governs production behavior, not a weaker version of the
old one) with its original regression-guard intent preserved; the tripwire
test is non-vacuous and was independently reproduced to actually fail
under the exact mutation it claims to catch.

---

# STATUS: VERIFIED

Both parts comply with their binding rulings (§1bs, §1br, §1bo.9(a) folded
in). No required designation is lost; the hard exclusion is untouched; no
pre-existing test was deleted or weakened; backward compatibility and the
score-identical claim are independently proven by execution, not merely
read; every gate passes and matches the checkpoint's own numbers exactly.
The findings above are real, execution-confirmed, and worth the manager's
attention (two are concrete, fixable gaps in Part 1's own coverage; one is
a POLICY question about the ruling's own unit-list design) — but none of
them violate a required guarantee, none regress anything relative to
pre-diff behavior, and none reflect a deviation from what was actually
ruled. Recommend a fast, narrow follow-up for the two MEDIUM coverage gaps
(sentence-final-period escape; chunk-path bypass) before or shortly after
this ships, and a manager POLICY call on the unit-list collision costs.

Method note (transparency, not a finding about the reviewed diff): during
mutation 3 (check 5), this reviewer's own restore initially produced a
byte-different but behaviorally-identical file (an encoding artifact of
this reviewer's edit tooling, not of the reviewed change) — caught by the
sha256 check this review's own method requires, corrected with a precisely
scoped fix, and re-verified against both sha256 and git's own blob hash.
Recorded in check 5 above.

