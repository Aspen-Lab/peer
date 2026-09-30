# NON-ASCII-TEXT — A review (fresh, independent)

STATUS: VERIFIED (see VERDICT section near the end for the full ranked
findings; one MEDIUM finding flagged POLICY — manager decides)

Role: A (reviewer). Read-only on product code and tests; no policy calls (flag
"POLICY — manager decides"). Measuring the implementer's round 1 + round 2
(§1bo.8) work against ABC-JEV-INTEGRATION.md §1bo (points 1-7) and its
AMENDMENT §1bo.8, both BINDING. Treating every claim in
docs/jev-abc/NON-ASCII-TEXT-C-20260930T075350Z.md as unverified until
reproduced myself.

Branch: `Jev-integration-and-sorting-filtering-enhancement`, HEAD 490d67b3.
Change is UNCOMMITTED in the working tree (git diff, not a commit range).

## Plan (updated as I go)

1. Adversarial invariant check: run the manager's probe
   (`<scratchpad>/mgr-nascii-mixed.mjs`) first, then write my own harder
   constructed cases (fullwidth Latin, CJK brackets, English-in-Chinese-
   parens, CJK+emoji, hyphenated compounds, accented Latin next to Chinese,
   Challenge+Project together, very long mixed text, punctuation-only text).
2. Required outcomes per §1bo.8(b): phrases survive, formulas survive, CJK
   parts yield nothing, literal query only for no-CJK text, accented Latin
   whole.
3. Byte-identical proof for pure-ASCII queries against HEAD's real code,
   extracted read-only via `git archive`, run through the same functions in
   both trees over a corpus (existing English test fixtures + 20+ constructed
   English texts).
4. Matching: CJK Required tag (Chinese/kana incl. ー/Hangul) matches prose at
   start/middle/end/whole; Latin-in-longer-word still fails; mixed-script tags
   keep the regex path; termOccurrences agrees with termVariantMatches for
   CJK; whole-pool Latin re-check myself.
5. Tests/mutations: read every new/changed test, diff test files against HEAD
   to confirm nothing deleted/weakened, reproduce 3 mutations myself with
   sha256 + line-ending proof.
6. Cache: PAPER_CACHE_KEY_VERSION 20 single exported prefix; is one bump right
   for both rounds.
7. Unforeseen harm to an ordinary valid case (e.g. numeric fragments as
   queries; pre-existing at HEAD?) + code-comment accuracy.
8. Gates: vitest, tsc, eslint, build — run myself, compare to implementer's
   reported numbers and to HEAD baseline.
9. Privacy scan of changed files + both checkpoint docs (counts only).

## Findings log (append-only as I go)

### Check 1 — adversarial invariant (in progress)

Ran the manager's own probe (`<scratchpad>/mgr-nascii-mixed.mjs`) against the
current working tree: 0 CJK-script queries across all 6 mixed fixtures ×
2 fields (project/challenge), confirmed.

Wrote my own harder probe `<scratchpad>/a-nascii-adversarial1.mjs` (20
fixtures + 1 combined-fields case): fullwidth Latin+digits, CJK brackets
「」【】《》, English-in-Chinese-parens, CJK+emoji, hyphenated compound in
Chinese, accented Latin next to Chinese, very long mixed text, punctuation-
only (CJK and ASCII), fullwidth colon, CJK iteration mark 々, digits+formula
only, single CJK char, CJK+URL, Traditional Chinese, kana+Hangul+Han+Latin
together, zero-width/NBSP characters, halfwidth katakana, CJK
currency/symbols, and Project+Challenge together. **Result: 0 queries
containing a Han/Hiragana/Katakana/Hangul character across all 21 cases** —
the strict invariant holds under this adversarial set.

**Found (not a strict-invariant violation, but a real gap) — see full
writeup under "Findings" below**: two very common Chinese punctuation marks,
the em dash (used doubled, "——") and the horizontal ellipsis ("……"), are
Unicode Script=Common, not Han, and are NOT in the implementer's hand-picked
`CJK_PUNCTUATION_RANGES` (which only covers U+3000-303F and parts of
U+FF00-FFEF). When either sits with no whitespace directly against an
embedded Latin phrase, the phrase chunk survives the delimiter step WITH the
dash/ellipsis glued onto it, e.g. `"电池性能提升——solid-state electrolyte的应用..."`
yields the query `"——solid-state electrolyte"` instead of the clean
`"solid-state electrolyte"`. Reproduced twice, independently, with fresh
constructed sentences (not the implementer's fixtures). Detail and severity
verdict below.

### Check 3 — byte-identical proof against HEAD (DONE)

Extracted HEAD (490d67b3) read-only via `git archive HEAD web/src | tar -x -C
<scratchpad>/a-head` (confirmed: no CJK helpers present, old ASCII-only
regex at its original line, `PAPER_CACHE_KEY_VERSION = 19`). Built my own
resolver hook `<scratchpad>/a-head-hook.mjs` pointed at that copy, and a
parameterized runner `<scratchpad>/a-corpus-run.mjs` that imports
`compileSearchBrief`/`briefToSeedTexts`/`termMatches`/`termVariantMatches`/
`termOccurrences`/`canonicalize` from whichever tree its env vars point at.

Corpus: **10 existing English project/challenge fixtures** copied verbatim
from `web/src/lib/feed/profile-compiler.test.ts` (every `project:`/
`challenge:` string literal and named `*_TEXT` constant in that file,
including `BATTERY_PROJECT_TEXT` and `TWO_PHRASE_PROJECT_TEXT`) + **22 new
constructed English texts** (hyphens, slashes, chemical formulas, numbers,
parentheses, acronyms) + 3 challenge-field texts + 2 seedTexts fixtures +
**12 existing English (haystack, term) pairs** copied verbatim from
`web/src/lib/scoring/term-expand.test.ts`'s pre-existing "canonicalize and
termMatches" describe block + **12 new constructed pairs**.

Ran the SAME script against both trees (`a-corpus-HEAD.json` /
`a-corpus-LIVE.json`), diffed with `<scratchpad>/a-corpus-diff.mjs`:

**PURE-ASCII: 0 differences** across all 32 project texts, 3 challenge
texts, 2 seedTexts cases, and 24 term-match pairs (`generatedQueries`,
`termMatches`, `termVariantMatches`, `termOccurrences` all byte/value
-identical between HEAD and the fixed tree). This independently confirms
the checkpoint's byte-identical claim — not by argument, by running the
real committed code side by side with the real working-tree code.

**Non-ASCII: 9 differences**, all listed, each with a verdict:
- Pure-Chinese (T2), Japanese (M5), Korean (M6) project texts: HEAD leaked
  the whole paragraph as one query; LIVE yields `[]`. INTENDED (§1bo point 2
  / §1bo.8).
- Mixed T3: HEAD gave the paragraph + 4 lowercase keyword fragments; LIVE
  gives the clean phrase + formulas in ORIGINAL CASE + the same keywords.
  INTENDED (§1bo.8(b); matches the implementer's own documented, verified
  case-dedup behaviour change).
- Accented Latin T4: HEAD's 5 queries were corrupted fragments
  (tude/lectrolytes/...); LIVE's are the correct whole words
  (étude/électrolytes/...). INTENDED (§1bo point 1).
- Fullwidth Latin/digits (A1): HEAD leaked the whole paragraph; LIVE yields
  the fullwidth runs AS-IS (`"２０２４"`, not normalized to `"2024"`). Not a
  CJK-character violation (fullwidth Latin/digit code points are
  Script=Latin/Common, not one of the 4 scripts) and not asked for by
  the ruling (which only requires the delimiter to EXCLUDE fullwidth
  Latin/digit ranges, which it correctly does) — LOW, informational: the
  fullwidth query is syntactically harmless but very unlikely to match
  anything in an English-language source; noted, not a defect against
  scope.
- Punctuation-only (A9) and the em-dash/ellipsis-gap cases: see the Check 1
  writeup above / Findings below. INTENDED for the strict letter-only
  invariant; a real gap for the "phrase survives cleanly" outcome.

### Check 4 — matching (DONE)

Own adversarial script `<scratchpad>/a-nascii-matching.mjs` against the live
tree, independent of the implementer's fixtures: Han/Katakana(with the
prolonged-sound mark ー, in two different words)/Hangul Required tags at
start/middle/end/whole-string positions — all match; absent-tag negatives —
all correctly false; Latin tag inside a longer Latin word ("cat" in
"category"/"categorical"/"concatenation", "ion" in "region"/"fashion", "LCO"
in "falcon") — all correctly do NOT match; mixed CJK+Latin tags glued with
no boundary — correctly do NOT match, the same tag cleanly delimited — DOES
match (regex path confirmed still in effect for mixed-script tags, not the
containment shortcut); `termOccurrences` agreement with `termMatches`
admission across 5 CJK/kana/Hangul pairs, with exact expected counts (3, 0,
2, 2, 1) all correct. **0 failures out of 30 checks.**

Whole-pool Latin re-check, done independently (own file discovery + own tag-
pairing, disclosed): found 13 files matching the implementer's
"live*/A-live*/p3-live*" naming pattern in `<scratchpad>/out/` (they say 12
— see Findings, low-severity count-only discrepancy, does not change the
pair-level result since the extra file `A-live4-lco.json` has 0 items), all
verified by inspection to carry `meta.searchBrief.coreTopics`; independently
located and paired the 11 named bare-array files with their companion
report files by reading each companion's real `tag`/`topics` field content
(never hand-copied) — pairing disclosed in `<scratchpad>/a-wholepool-run.mjs`.
Computed admission (`termMatches` on title OR joined item tags OR abstract)
for every (file, tag, item) triple via both `a-head-hook.mjs` and
`nascii-hook.mjs`: **704 pairs, 474 admitted true on both sides, 0
differences.** (474 true matches the implementer's own reported true-count
exactly, despite a different total pair count from the independent file/tag
selection — corroborating, not just repeating, their number.)

### Check 5 — tests and mutations (DONE)

Diffed the 3 test files against HEAD directly (`grep '^-[^-]'` over the
diff, i.e. every deleted line): **the only deletions in any of the 3 test
files are 2 comment lines in pool-cache.test.ts** (the stale "v18" comment,
replaced by a corrected chain — disclosed by the implementer as a
CORRECTION). Zero test assertions, zero `it(...)` blocks removed or
weakened anywhere. Confirmed directly, not by trusting the checkpoint.

Reproduced all 3 named mutations myself end to end (sha256 before/after
each, line-endings re-checked via `git ls-files --eol` after every restore):
baseline sha256 `921b91de1b3d32829a2c9b874dcb55b3c512db36677891199c3c15e19ba712c2`.
1. Restore ASCII-only keyword regex → **3 failed / 44 passed**, exactly the
   3 accented-Latin tests. Matches the checkpoint's round-2 re-confirmation
   number exactly. Reverted; sha256 identical; still `i/lf w/lf`.
2. Remove the CJK delimiter step → **8 failed / 39 passed**, exactly the
   round-2 mixed-text tests. Matches exactly. Reverted; sha256 identical.
3. Narrow `CJK_SCRIPT_CLASS` to Han-only → **6 failed / 41 passed**, Japanese
   AND Korean tests. Matches exactly. Reverted; sha256 identical.

All 3 mutation round-trips restored the file byte-for-byte (confirmed by
sha256, not just by re-reading the diff).

### Check 2 — required outcomes, §1bo.8(b)-(e) (DONE, cross-referencing checks 1/3/4 above)

- Embedded Latin phrases survive as phrases: confirmed in the general case
  (M1/M4/A3/A5/A8/A16 and the official suite). One narrow exception found —
  see the em-dash/ellipsis finding below; the phrase still survives, but not
  always cleanly.
- Formulas survive: confirmed broadly (fullwidth-adjacent, emoji-adjacent,
  zero-space-glued, currency-adjacent — A1/A4/A8/A11/A12/A19/A20/M3 all
  keep the bare formula).
- CJK parts yield nothing: confirmed, 0 offenders across every adversarial
  case run in checks 1/3/4 (40+ constructed texts).
- Keyword branch strips all 4 scripts: confirmed directly (code reads
  `CJK_SCRIPT_STRIP` off the shared `CJK_SCRIPT_CLASS`) and empirically
  (Japanese/Korean/mixed-kana-Hangul-Han-Latin cases all clean).
- Literal query only for text with no CJK character at all: confirmed by
  code (the `containsCjkCharacter` guard in `literalQueryIfShort` covers all
  4 scripts) and empirically (no mixed-text case in ~40 constructed
  fixtures ever produced the whole original mixed string as a query).
- Pure-ASCII byte-identical: proved in check 3 (0 differences, independent
  corpus).
- Accented Latin as in round 1: confirmed (T4/A6/Schrödinger cases).
- (c) `termVariantMatches`/`termOccurrences` share one classifier, Latin
  byte-identical: confirmed in check 4 (0 fails; whole-pool 0 differences).
- (d) Seed texts unchanged (context only, never sent to a source):
  confirmed — `briefToSeedTexts` output's first entry is consistently the
  untouched original text, CJK characters included, across every mixed/pure-
  CJK fixture I ran (e.g. the M1 case's seed list leads with the full
  original Chinese+Latin sentence, unmodified).
- (e) Other scripts (Cyrillic, Arabic, …) out of scope: confirmed not
  addressed, consistent with the ruling; noted that a variant mixing e.g.
  Cyrillic with a CJK script would currently be classified CJK-only
  (contains a CJK char, no Latin/digit) and get containment matching —
  unevidenced, explicitly out of scope, not a defect against this ruling.
- (f)/(g): tests and process — covered in check 5 above.

### Check 6 — cache version (DONE)

Confirmed by code reading: `PAPER_POOL_KEY_PREFIX` is a genuine single
source of truth (`` `peer-pool-v${PAPER_CACHE_KEY_VERSION}-papers-` ``), and
its only two consumers outside pool-cache.ts (`private-paper-cache.ts`,
`paper-daily-cache.test.ts`) import it rather than hard-coding their own
copy — checked directly, not assumed.

One bump (19→20) for both rounds is correct: round 1's v20 never shipped
(round 1 was still `IMPLEMENTED_PENDING_REVIEW` when the manager's own probe
caught the round-2 mixed-text bug, before any A review or commit), so no
real cache was ever written under a "round-1-only v20" behaviour. There is
nothing for a second bump (v21) to invalidate that v20 doesn't already
cover. The doc comment accurately describes both rounds' combined effect on
pool membership and gate outcomes.

### Check 7 — unforeseen harm + comment accuracy (DONE)

**Pre-existing numeric-fragment behaviour (not a new issue):** a bare
number or unit like `"2024"` or `"500Wh/kg"` embedded in free text becomes
its own standalone query (seen in the M2 mixed fixture). Verified this is
**pre-existing, byte-identical HEAD behaviour for pure-English text with the
same numbers** (`"Our target for 2024 is 500Wh/kg..."` produces the
identical `"2024"`/`"500wh/kg"` fragments on both HEAD and the fixed tree) —
the keyword branch's `token.length >= 4` filter has always kept any 4+
character alphanumeric token, regardless of whether it reads as a "real
word." Unrelated to and unaffected by this item; not a new regression.

**Comment-accuracy spot checks — all confirmed accurate by code reading:**
the `literalQueryWordCount`-is-dead-code-by-the-time-it-runs claim (traced
the exact call order: `containsCjkCharacter` already excludes all 4 scripts
one line above, so the function's own Han-only counting term can never see
a CJK character); the `cleanList` original-case-wins explanation for why
LiCoO2/NMC811 now assert original case (`cleanList` dedups on a lower-cased
key but keeps the first-seen spelling, and `longPhrases` — original case —
is concatenated before `keywords` — lower-cased — so the phrase branch's
spelling wins); the fullwidth-exclusion ranges in `CJK_PUNCTUATION_RANGES`
correctly exclude fullwidth digits/Latin letters as documented.

**FINDING (MEDIUM) — CJK_PUNCTUATION_RANGES omits two very common Chinese
punctuation marks, so a Latin phrase directly against one of them survives
with the mark glued on, not cleanly isolated.** U+2014 EM DASH (used
doubled, "——", as a standard Chinese punctuation mark for an appositive or
parenthetical aside) and U+2026 HORIZONTAL ELLIPSIS ("……", standard Chinese
ellipsis) are Unicode Script=Common, not Han — outside both
`CJK_SCRIPT_CLASS` and the hand-picked `CJK_PUNCTUATION_RANGES` (which only
covers U+3000-303F and parts of U+FF00-FFEF; General Punctuation
U+2000-206F is not addressed anywhere in the diff or its comments). When
either sits with zero whitespace directly against an embedded Latin phrase
or formula, the delimiter step does not fire there, so the surviving
chunk/query carries the mark as a prefix or suffix. Reproduced with 6
independently-constructed sentences (none copied from the implementer's or
manager's own fixtures), e.g.:
  - `"电池性能提升——solid-state electrolyte的应用..."` → query
    `"——solid-state electrolyte"` (not the clean phrase).
  - `"我们的研究目标是提升能量密度——LiCoO2正极材料是关键..."` → query
    `"——LiCoO2"` (not the clean formula; a second, correct, lower-cased
    `"licoo2"` also survives via the keyword branch).
  - `"这项技术——NMC811 cathode——已经在多个实验室验证过。"` → query
    `"——NMC811 cathode——"` (marks on both sides).
  - A punctuation-only text (only CJK/fullwidth marks) leaves a bare
    `"——……"` fragment as its own query — useless but harmless.
  **Verified this NEVER leaks an actual CJK-script letter** — re-ran 4 fresh
  sentences through the invariant check used in check 1; 0 offenders every
  time. So invariant (a) (binding) is NOT violated by this gap; required
  outcome (b)'s "embedded Latin phrases survive as phrases" is only
  partially met in this specific, narrow adjacency (no-whitespace-against-
  em-dash-or-ellipsis) case. Plausible for an ordinary Chinese-writing
  researcher (Chinese em dash is commonly written with no surrounding
  space), but requires that specific juxtaposition — not a broad, everyday
  failure. Cheap to close (extend `CJK_PUNCTUATION_RANGES` to include
  U+2014, U+2013 and U+2026 at minimum). **POLICY — manager decides**
  whether this ships as an accepted, named gap (with a tripwire test) or
  needs a third round.

**Minor observation, not a defect against scope:** fullwidth Latin letters
and digits (e.g. a project text typed with an IME stuck in fullwidth mode)
pass through unnormalized (`"２０２４"` stays fullwidth, not `"2024"`) —
correct per the ruling (the delimiter must exclude, not consume, fullwidth
Latin/digit ranges, which it does), but the resulting query is unlikely to
match anything in an English-language source. Not asked for by the ruling;
noting only because it is adjacent to this item's territory.

**Documentation-only discrepancies found while re-deriving the whole-pool
check (check 4), neither affecting correctness:**
- The checkpoint's "12 files" (direct-`coreTopics` group) undercounts by
  one against what is actually present under the stated `live*/A-live*/
  p3-live*` naming pattern in `<scratchpad>/out/` — I found 13, all
  structurally valid. Immaterial to the pair-level result: the extra file
  (`A-live4-lco.json`) has 0 items, so it contributes 0 pairs either way.
- The checkpoint describes the 11 bare-array files' companion reports as
  read from "their own `tags`/`tag` field" — in fact 4 of them
  (`report-P1a...`/`report-P1b...`/`report-P2...`/`report-P4...`) use a
  `topics` field, and only the 3 `sc-report-*.json` companions use `tag`
  literally. Cosmetic; does not change which tag was actually used.

### Check 8 — gates (DONE, run independently from a clean `web/` checkout state)

All 4 run to completion on the first try (no font-fetch retry needed):

| Gate | My result | Checkpoint's claim | Match |
|---|---|---|---|
| `npx vitest run` | 294 files (291 passed + 3 skipped) / **5625 passed** + 6 skipped / 0 failed | same | EXACT |
| `npx tsc --noEmit` | 0 errors, exit 0 | 0 errors | EXACT |
| `npx eslint .` | 0 errors / 151 warnings; none in any of the 6 changed files (grepped the full output) | same | EXACT |
| `npm run build` | Compiled successfully; same single pre-existing, unrelated Turbopack NFT-tracing warning through `pdf-text.ts`; no font-fetch retry needed | same | EXACT |

Baseline cross-check: HEAD's own vitest count (from the checkpoint) is 5575
passed; the working tree adds 30 new tests this round (16 + 14, per the
checkpoint's own per-file deltas) on top of round 1's +20, landing at 5625 —
arithmetic checks out (5575 + 20 + 30 = 5625).

### Check 9 — privacy scan (DONE)

Scanned all 6 changed files + both checkpoint docs for email addresses,
Windows user-profile paths, the user's own known email local-part, and
secret-shaped strings (API-key prefixes, PEM blocks, long `KEY=`-style
assignments): **0 matches for all patterns, in every file.** Also checked
for real, identifying person names (searched for capitalized two-word
sequences and cross-checked every hit — all are generic domain phrases,
e.g. a journal name, "Research Scientist," script names like "Japanese
Hiragana," never a real person). One recurring pair of single-word
surnames appears as accent-handling test fixtures (1 use in the product
file, 6/2 uses across the two test/checkpoint docs) — these are generic,
widely-known example surnames used purely to exercise accented-Latin
handling, carried over unchanged from the pre-existing investigation guide,
not tied to any real individual's data in this context. Counts only, per
instruction; no matched text reproduced here.

---

## VERDICT

**VERIFIED**, with one MEDIUM finding named for the manager's decision
(POLICY — manager decides) and two LOW/documentation-only notes. Nothing
found violates the binding invariant §1bo.8(a) (no query contains a
Han/Hiragana/Katakana/Hangul character) across roughly 40 independently
constructed adversarial texts, including ones specifically designed to
probe gaps the manager's and implementer's own fixtures did not cover
(fullwidth Latin/digits, CJK brackets, English-in-Chinese-parens, CJK+emoji,
hyphenated compounds, accented Latin touching Chinese, Project+Challenge
combined, very long mixed text, punctuation-only text, zero-width/NBSP
characters, halfwidth katakana, CJK currency symbols, Traditional Chinese,
and the em-dash/ellipsis adjacency case that produced this review's one real
finding).

### Findings, ranked by severity

1. **MEDIUM — POLICY, manager decides:** `CJK_PUNCTUATION_RANGES` omits
   U+2014 (em dash) and U+2026 (ellipsis), two common Chinese punctuation
   marks, so a Latin phrase/formula glued (no whitespace) directly against
   one survives as a query with the mark attached, instead of cleanly
   isolated. Never leaks an actual CJK-script letter (invariant (a) holds).
   Reproduced independently with 6 fresh constructed sentences. Cheap fix
   available (extend the punctuation range) if the manager wants a round 3;
   otherwise ships as a named, accepted gap with a tripwire test.
2. **LOW — documentation only:** the whole-pool check's file count ("12")
   undercounts the actual matching files by one (13 found; immaterial, the
   extra file has 0 items) and its "tags/tag field" description doesn't
   match all companion files (4 of 7 distinct companions actually use
   `topics`). Does not affect the shipped code or the correctness of the
   check's own conclusion (which I independently re-derived: 0 differences).
3. **LOW — informational, not a defect:** fullwidth Latin/digit runs survive
   unnormalized (still fullwidth glyphs); correct per the ruling's own
   scope, likely low-value against English-language sources. No action
   implied.

### Proof summary

- **Byte-identical (check 3):** 0 differences across 32 project texts (10
  existing verbatim + 22 new), 3 challenge texts, 2 seedTexts cases, and 24
  `termMatches`/`termVariantMatches`/`termOccurrences` pairs (12 existing
  verbatim + 12 new), diffed against HEAD 490d67b3 extracted read-only via
  `git archive`. 9 non-ASCII differences, all listed with a verdict, all
  intended except the em-dash/ellipsis gap above.
- **Mutation proof (check 5):** all 3 named mutations reproduced
  independently; exact red-test counts matched the checkpoint's own numbers
  every time (3/44, 8/39, 6/41); every file round-trip confirmed byte-exact
  by sha256 (baseline
  `921b91de1b3d32829a2c9b874dcb55b3c512db36677891199c3c15e19ba712c2`) and by
  `git ls-files --eol` (LF preserved throughout).
- **Gates (check 8):** vitest 294 (291+3 skipped)/5625 passed+6 skipped/0
  failed; tsc 0 errors; eslint 0 errors/151 warnings (none in changed
  files); build OK — all four EXACTLY matching the checkpoint's reported
  numbers, run independently on my own clean invocation.

STATUS: VERIFIED
