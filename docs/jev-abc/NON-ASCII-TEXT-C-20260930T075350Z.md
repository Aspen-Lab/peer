# NON-ASCII-TEXT — C implementation

STATUS: IMPLEMENTED_PENDING_REVIEW (round 1 AND round 2/§1bo.8 both
complete; see "ROUND 2 (§1bo.8)" section at the end of this file for the
mixed-text/4-script amendment round)

Item: ABC-JEV-INTEGRATION.md §1bo (binding), built on §1ay/QUERY-QUALITY and
§1az/QUERY-BUDGET. Guide: docs/jev-abc/NON-ASCII-TEXT-B-20260930T071406Z.md.

Role: C (implementer). Only writer of repo product files until report.

Branch: `Jev-integration-and-sorting-filtering-enhancement`, HEAD 490d67b3 at
start.

---

## Plan

1. `web/src/lib/feed/profile-compiler.ts`
   - `phrasesFromText`'s `keywords` branch (the free-text keyword regex,
     around line 126): strip Han-script (CJK) characters first, then keep
     Unicode letters/digits (`\p{L}\p{N}`) instead of the old ASCII-only
     `[a-z0-9+\-/.]` class, so accented Latin ("électrolytes", "Müller")
     survives whole and CJK never becomes part of a keyword token.
   - `phrasesFromText`'s `longPhrases`/`chunks` branch (around line 118): add
     a filter so a chunk that is CJK-only (every non-whitespace character is
     Han script) is dropped before it can become a "phrase" query — closes a
     SECOND leak beyond `literalQueryIfShort` (the ASCII-only chunk delimiter
     at line 114 treats an entire unspaced/fullwidth-punctuated CJK
     paragraph as one chunk, which then also passes the whitespace-based
     `<=10 words` phrase filter by the same no-spaces accident
     `literalQueryIfShort` has). Needed so "a pure-Chinese Project yields no
     derived or literal query" (§1bo point 2) actually holds end to end —
     fixing only `literalQueryIfShort` leaves this second path leaking the
     whole paragraph as a "phrase" instead. Scoped strictly to CJK-ONLY
     chunks, so a mixed chunk (T3-shaped: Chinese prose with embedded
     LiCoO2/NMC811/solid-state electrolyte) is untouched — those Latin/
     formula terms already survive today via the keyword branch, and the
     guide's own test 3 says that path must not regress, not that the mixed
     blob must additionally disappear.
   - `literalQueryIfShort` (around line 147): per §1bo point 1 ("the
     literal-query length guard counts CJK characters so a Chinese paragraph
     can never become one query"), count each CJK character as its own
     "word" toward `MAX_LITERAL_QUERY_WORDS` (today's `.split(/\s+/)` sees
     zero whitespace inside unspaced CJK and always counts 1, so the guard
     never fires). Additionally, per point 2's unconditional "a pure-Chinese
     Project yields no ... literal query", a CJK-only text is excluded
     outright regardless of its character count, so a short pure-Chinese
     phrase is not able to slip through the count-based guard alone.
   - No change planned to `isMultiWord`/tier classification (row 4) or
     `materialsOrDatasets` (row 6) or `expandTerm`'s CJK cosmetic garbage
     (row 11) — none are named in §1bo's WHAT TO BUILD, and after the three
     fixes above no CJK-only segment should reach those paths anyway.

2. `web/src/lib/scoring/term-expand.ts`
   - `termVariantMatches` (around line 268): add an early branch — when
     `variant` consists entirely of Han-script characters (plus optional
     whitespace), use plain substring containment
     (`canonicalHaystack.includes(variant)`) instead of the whitespace-
     anchored word-boundary regex. Every other variant (Latin-script, mixed-
     script) falls through to the EXACT existing regex code, unchanged —
     byte-identical by construction, not just by testing.

3. `web/src/lib/opportunities/pool-cache.ts`
   - `PAPER_CACHE_KEY_VERSION` 19 -> 20, extending the doc-comment chain in
     place (same paragraph style as v13..v19) with the NON-ASCII-TEXT/§1bo
     reasoning: query generation and matching for non-ASCII reader text
     changes pool membership (a v19 pool may be missing candidates the fixed
     queries would fetch, or may include garbage-CJK-paragraph query noise
     the fix removes) and gate outcomes (a CJK Required tag can newly admit
     a paper via T1 that used to reach the gate only through T4, if at all).

## Tests planned (the guide's 12 / my task's 6 categories)

- Accented Latin ("Müller", "électrolyte", "pérovskite") survives whole in
  the keyword-branch output (profile-compiler.test.ts).
- A pure-Chinese paragraph (T2/T5-shaped) yields zero project-text-derived
  queries.
- Mixed Chinese+Latin text (T3-shaped) still yields "licoo2", "solid-state",
  "electrolyte", "nmc811" (protective, must not regress).
- `literalQueryIfShort`/keyword-branch mutation guards.
- CJK Required tag matches CJK prose at start/middle/end/whole-string
  positions (term-expand.test.ts), reproducing the guide's Task 1.3 table.
- Every existing Latin boundary test unchanged, byte-identical, PLUS a new
  protective companion (a Latin tag inside a longer Latin word still does
  NOT match, and a CJK-shaped substring inside a longer CJK word DOES match
  per the plain-containment rule, named so the distinction is deliberate).
- Cache version test (19 -> 20).

## Whole-pool Latin check (plan)

Real saved pools in `<scratchpad>/out/` (path given to the probe only via an
env var). Two groups:
- 12 files whose own `meta.searchBrief.coreTopics` names their Required
  tags directly (no external mapping): the `live*`/`A-live*`/`p3-live*`
  pool files.
- 11 files that are bare item arrays, paired with a Required tag read at
  run time from a companion report file's own `tags`/`tag` field (not
  hand-copied): `tagged-LCO.json`, `tagged-P1b.json`, `raw-P1a.json`,
  `raw-P1b.json`, `raw-P2.json`, `tagged-P4.json`,
  `tagged-P4-pubmed-full.json`, `raw-P4.json`,
  `sc-neg-electrolyte-clinical-pubmed.json`, `sc-neg-lco-openalex.json`,
  `sc-neg-solid-state-openalex.json`.

Probe: `web/src/__c_ascii_probe_wholepool.mjs` (deleted before hand-off),
run once before any source edit and once after, against the REAL
`termMatches`/`canonicalize` exports (direct Node import, no bundler-path
resolver needed — `term-expand.ts` has zero imports of its own). Diff by
(file, tag, itemId). Every tag in this real data is Latin-script, so the
required result is exactly zero differences across both runs.

## Mutations planned (restore, prove test goes red, restore again; sha256
before/after each round-trip identical; each file's own line endings kept —
profile-compiler.ts/test.ts are LF, term-expand.ts/test.ts and
pool-cache.ts are CRLF per `git ls-files --eol`, confirmed before any edit)

1. Restore the ASCII-only keyword regex -> the accented-Latin test goes red.
2. Restore the whitespace-only `literalQueryIfShort` guard (and re-permit a
   CJK-only literal/phrase query) -> the pure-Chinese-paragraph test goes
   red.
3. Drop the CJK containment branch in `termVariantMatches` -> the CJK
   mid-prose match test goes red.

## Gates (web/, one at a time; baseline at HEAD 490d67b3: 294 files
(291 + 3 skipped) / 5575 passed + 6 skipped / 0 failed; tsc 0 errors; eslint
0 errors / 151 warnings; build OK)

- [ ] `npx vitest run`
- [ ] `npx tsc --noEmit`
- [ ] `npx eslint .`
- [ ] `npm run build`

---

## Progress log

- [x] Whole-pool BEFORE snapshot captured (743 (tag,item) pairs, 23 real
      saved pool files, 6 distinct real Required tags — all Latin-script).
- [x] `term-expand.ts`: `termVariantMatches` CJK containment branch added
      (`isCjkOnlyVariant`). Sanity-checked directly against the guide's own
      §1.3 proof table (all 4 previously-false cases now true; the
      whole-string/space-delimited cases and the Latin `category`/`cat`,
      `region`/`ion` cases unchanged).
- [x] `profile-compiler.ts`: `isCjkOnlyText` helper added; `keywords` branch
      regex fixed (Unicode letters/digits, Han stripped first);
      `longPhrases` gets a CJK-only-chunk filter (needed in addition to the
      `literalQueryIfShort` fix — verified independently below);
      `literalQueryIfShort` now counts CJK characters AND excludes CJK-only
      text unconditionally (`literalQueryWordCount`).
- [x] `pool-cache.ts`: `PAPER_CACHE_KEY_VERSION` 19 -> 20, doc chain
      extended in place.
- [x] Tests added: 10 new tests in profile-compiler.test.ts (NON-ASCII-TEXT
      describe block), 8 new tests in term-expand.test.ts (CJK containment
      describe block), 1 new pinned-version test + 1 corrected stale
      comment in pool-cache.test.ts. All pre-existing tests in these 3 test
      files left unchanged (no assertion edits were needed — the fix is
      additive to code paths those pre-existing tests don't exercise).
- [x] Whole-pool AFTER snapshot captured (743 pairs) — diffed against
      BEFORE by (file, tag, itemId): **0 differences**. Probe deleted
      (`web/src/__c_ascii_probe_wholepool.mjs`), confirmed gone via
      `git status`.
- [x] Mutation 1 (restore ASCII-only keyword regex): exactly the 3
      accented-Latin tests went red (28/31 stayed green); reverted,
      sha256 identical to pre-mutation.
- [x] Mutation 2 (restore whitespace-only `literalQueryIfShort`): exactly
      the 6 CJK/pure-Chinese tests went red (25/31 stayed green,
      including the T3 mixed-text test); reverted, sha256 identical.
      BONUS (not one of the 3 prescribed mutations, but my own added
      `longPhrases` CJK filter needed its own proof): reverting THAT
      filter alone (with `literalQueryIfShort` left fixed) ALSO flips the
      same 6 tests red — confirms the two fixes are independently
      necessary, not redundant. Reverted, sha256 identical.
- [x] Mutation 3 (drop the CJK containment branch in `termVariantMatches`):
      exactly the 5 CJK-mid-prose tests went red (63/68 stayed green,
      including the whole-string/space-delimited CJK cases and every
      Latin/mixed-variant case); reverted, sha256 identical.
- [x] Line endings verified byte-level (PowerShell) after every edit and
      every mutation round-trip: profile-compiler.ts/.test.ts stayed 100%
      LF throughout; term-expand.ts/.test.ts and pool-cache.ts/.test.ts
      stayed 100% CRLF throughout. `git ls-files --eol` unchanged from
      baseline for all 6 files.

## Gates — RESULT

- [x] `npx vitest run` — 294 files (291 + 3 skipped) / **5595 passed** + 6
      skipped / 0 failed. Baseline was 5575 passed; the +20 delta is
      exactly the new tests added (profile-compiler.test.ts +10,
      term-expand.test.ts +9, pool-cache.test.ts +1).
- [x] `npx tsc --noEmit` — 0 errors, exit code 0.
- [x] `npx eslint .` — 0 errors / 151 warnings, matching baseline exactly
      (no new warnings; none of the changed files appear in the warning
      list).
- [x] `npm run build` — succeeded first try (no font-fetch retry needed).
      One PRE-EXISTING, unrelated Turbopack warning about NFT tracing
      through `pdf-text.ts` (nothing to do with this item's files).

## Final summary

STATUS: IMPLEMENTED_PENDING_REVIEW

**Changed files:**
- `web/src/lib/feed/profile-compiler.ts` — `isCjkOnlyText` helper added;
  `phrasesFromText`'s keyword-branch regex now keeps Unicode letters/digits
  after stripping Han-script characters (accented Latin survives whole; no
  CJK reaches a keyword token); `phrasesFromText`'s `longPhrases` gets a
  CJK-only-chunk filter (a second, independently-necessary leak — proven by
  its own isolated mutation, see below); `literalQueryIfShort` now counts
  each CJK character as its own word toward the cap AND excludes CJK-only
  text unconditionally, via a new `literalQueryWordCount` helper.
- `web/src/lib/feed/profile-compiler.test.ts` — new describe block, 10
  tests (accented-Latin whole-word survival x3, pure-Chinese-yields-nothing
  x4 incl. a tag-first case, T3 mixed-text protective, a pure-Chinese
  CHALLENGE case, one explicit mutation-guard test). Every pre-existing
  test unchanged, byte for byte.
- `web/src/lib/scoring/term-expand.ts` — `isCjkOnlyVariant` helper +
  `CJK_ONLY_VARIANT` regex added; `termVariantMatches` gets one new early
  branch (plain containment for a CJK-only variant); the pre-existing
  regex path is untouched code, reached exactly as before for every
  Latin-script or mixed-script variant.
- `web/src/lib/scoring/term-expand.test.ts` — new describe block, 9 tests
  (CJK mid/start/end-of-sentence matching x3, whole-string/space-delimited
  CJK, absent-tag negative, multi-character CJK substring, a direct
  `termVariantMatches` unit test, a Latin protective companion
  ("cat"/"category"), a mixed-CJK+Latin-variant scoping test). Every
  pre-existing test (including every Latin boundary case:
  "ion"/region/fashion, the two-letter-acronym cases, "cat"-style
  containment) unchanged, byte for byte, and still green.
- `web/src/lib/opportunities/pool-cache.ts` — `PAPER_CACHE_KEY_VERSION`
  19 -> 20, doc-comment chain extended in place with the same v13..v19
  paragraph style.
- `web/src/lib/opportunities/pool-cache.test.ts` — one new test pinning
  the exact v20 prefix; corrected a STALE comment (pre-existing, not
  introduced by me — it still said "papers is now v18" when the code was
  already at v19 from DATASET-RECORDS) while extending the same chain to
  v20; marked with a CORRECTION note per house style. No existing
  assertion was changed or weakened — this was a comment-only fix plus one
  new test.

**Whole-pool Latin check (§1bo point 3):** ran the real `termMatches`
against every (Required tag, item) pair from 23 real saved pool files in
`<scratchpad>/out/` (743 pairs total, 6 distinct real Required tags — "solid
state", "solid-state battery electrolyte", "electrolyte", "solid
electrolyte", "LCO", "sodium-ion battery cathode materials" — all
Latin-script; 474 true / 269 false outcomes), once before any source edit
and once after. **0 differences.** The pool directory and output paths were
given to the probe only via environment variables (`NASCII_POOL_DIR`,
`NASCII_PROBE_OUT`), never as a literal string in any file; the probe
(`web/src/__c_ascii_probe_wholepool.mjs`) was deleted afterward, confirmed
absent via `git status --short` (not listed).

**Mutation proof (sha256 before === sha256 after every round-trip; line
endings verified byte-level with PowerShell after every edit and every
mutation, unchanged from baseline throughout — profile-compiler.ts/.test.ts
100% LF, term-expand.ts/.test.ts and pool-cache.ts/.test.ts 100% CRLF):**
1. Restored the ASCII-only keyword regex -> exactly the 3 accented-Latin
   tests went red (28/31 stayed green). Reverted; sha256 identical.
2. Restored the whitespace-only `literalQueryIfShort` guard -> exactly the
   6 pure-Chinese/CJK tests went red (25/31 stayed green, including the T3
   mixed-text protective test). Reverted; sha256 identical. BONUS (my own
   added `longPhrases` CJK filter, not one of the 3 prescribed mutations,
   but proven independently necessary): reverting THAT filter alone (with
   `literalQueryIfShort` left fixed) ALSO flips the same 6 tests red,
   confirming both fixes are needed together, neither is dead code.
   Reverted; sha256 identical.
3. Dropped the CJK containment branch in `termVariantMatches` -> exactly
   the 5 CJK-mid-prose tests went red (63/68 stayed green, including the
   whole-string/space-delimited CJK cases and every Latin/mixed-variant
   case). Reverted; sha256 identical.

**Out of scope, left untouched, per §1bo's own WHAT TO BUILD (not silently
skipped — named here):** `isMultiWord`/tier classification (row 4 of the
guide) and `materialsOrDatasets`'s English-only regex (row 6) — after the
three fixes above, no CJK-only segment reaches either path anyway, so there
was nothing live left to fix; `expandTerm`'s cosmetic CJK-plural garbage
(row 11, e.g. `expandTerm("电池")` still also yields `["电池s","电池ss"]`) —
harmless (these never match real text, proven by the whole-pool check's own
logic), not named in §1bo, left as-is; `termOccurrences` (used only for
`groundingWeight`'s ranking-tier boost, not the Required-gate itself) still
uses its own inlined word-boundary regex rather than routing through
`termVariantMatches` — this predates this item (it was ALREADY a separate
code path from `termVariantMatches`, not something I split out), is not
named anywhere in §1bo's WHAT TO BUILD or the guide's Task 4 test list, and
its only effect for a CJK tag is a more conservative grounding weight
(0.4 instead of 0.7/0.9) on an item that still passes the gate via T1 — a
ranking-only, non-blocking gap, noted here rather than silently left. No
English-only Profile hint, no machine translation, no multilingual
retrieval, no change to tokenize.ts's short-word length filter — all
explicitly out of scope per the task.

**Git:** no commit, no push, no stash, no branch operation performed.
`web/.env`/`web/.env.local` never opened. Root `node_modules/` and the dev
server untouched. No tool call or edit was denied during this session.

STATUS: IMPLEMENTED_PENDING_REVIEW

---

# ROUND 2 (§1bo.8)

STATUS: IN_PROGRESS

Item: ABC-JEV-INTEGRATION.md §1bo.8, AMENDMENT (2026-09-30T08:2xZ) — the
manager's check of round 1 found MIXED CJK+Latin text still leaks whole
paragraphs as queries, and round 1's "CJK" scope was Han-only (missed
Japanese Hiragana/Katakana and Korean Hangul). Manager evidence:
`<scratchpad>/mgr-nascii-mixed.mjs` (read, not re-run verbatim — its
findings are reproduced and extended by my own vitest-based tests below,
consistent with how round 1 verified through the real project test runner
rather than a standalone Node script).

## Cause (confirmed by re-reading round 1's own code, matches the manager's
finding exactly)

`phrasesFromText`'s `longPhrases` branch has the SAME no-spaces blind spot
round 1 fixed in `literalQueryIfShort`: `chunks` only splits on ASCII
`. , ; : \n` / " - ", so a mixed CJK+Latin chunk with no ASCII delimiter
around it (or one bounded by an EXISTING ascii delimiter but still
CJK+Latin mixed internally) survives as one chunk, and
`part.split(/\s+/).length <= 10` under-counts it whenever real ASCII spaces
around the embedded Latin words keep the total word count low. Round 1's
own CJK-only filter (`isCjkOnlyText`) does not catch this because the chunk
is MIXED, not CJK-only — by design (round 1 deliberately left mixed-blob
chunks alone, reasoning the guide's own test list only asked for the
Latin/formula terms to survive, not for the raw blob's removal). §1bo.8
overrides that: for a Chinese materials researcher, mixed text is the
ordinary case, so the raw blob must go too. Separately, every CJK check in
round 1 (`isCjkOnlyText`, `isCjkOnlyVariant`, the keyword-branch strip) used
`\p{Script=Han}` only — Hiragana, Katakana and Hangul characters are all
`\p{L}` (Unicode Letter), so without their OWN script check they pass
straight through every "keep letters" step untouched.

## Plan

1. **`web/src/lib/feed/profile-compiler.ts`**
   - Introduce one shared `CJK_SCRIPT_CLASS` string constant (the four
     scripts, as a regex character-class fragment) so every CJK check in
     this file (`containsCjkCharacter`, `isCjkOnlyText`, the new delimiter
     regex, the keyword-branch strip) is built from the SAME source — a
     single place to broaden or (for mutation testing) narrow script
     coverage, so they cannot silently drift apart.
   - **Mechanism (chosen, stated per §1bo.8(b)): a CJK run acts as a chunk
     delimiter before the phrase split.** Add a preprocessing
     `.replace(CJK_DELIMITER_RUN, "\n")` step before the existing
     `.split(/[.,;:\n]|(?:\s+-\s+)/)` in `phrasesFromText`'s `chunks`
     computation. `CJK_DELIMITER_RUN` matches a maximal run of (any of the
     four CJK scripts) OR (CJK/fullwidth punctuation — the CJK Symbols and
     Punctuation block U+3000-303F and the fullwidth punctuation
     sub-ranges of U+FF00-FFEF, explicitly EXCLUDING the fullwidth
     alphanumeric sub-ranges so a rare fullwidth Latin word is not
     shredded). Feeding "\n" into the EXISTING split reuses the current
     pipeline exactly — no parallel chunking logic. This turns a CJK run,
     anywhere, spaced or not, into a hard boundary, so an embedded Latin
     phrase ("solid-state electrolyte") or an unspaced formula ("LiCoO2"
     glued directly to surrounding Chinese) becomes its OWN chunk.
   - Broaden `isCjkOnlyText`'s script check to the shared 4-script class
     (kept as a DEFENSIVE second layer on `longPhrases` — with the
     delimiter step in place, a chunk that survives the split can no
     longer contain a CJK character at all, so this filter becomes
     provably redundant for any case the delimiter itself correctly
     handles; kept anyway, cheap, matches this codebase's own
     "defence in depth" precedent (§1bl DATASET-RECORDS), and guards
     against a gap in my hand-picked punctuation ranges).
   - Broaden the keyword-branch script strip from Han-only to the shared
     4-script class (this one is NOT redundant — the keyword branch does
     not go through the new delimiter/chunk pipeline at all, so it needs
     its own complete strip; this is what fixes the Japanese
     "における"/"しています" kana leaking as bogus keyword tokens).
   - `literalQueryIfShort`: widen from "CJK-ONLY text never becomes a
     literal query" to "text containing ANY CJK character never becomes a
     literal query" (new `containsCjkCharacter` check, built from the same
     shared script class) — literalQueryIfShort returns the whole original
     string verbatim, so even one embedded CJK character would put a CJK
     character into a query, violating invariant (a). `literalQueryWordCount`
     is left in place unchanged (its CJK-character-counting term is now
     provably always 0 by the time it runs, since `containsCjkCharacter`
     already excluded anything with CJK content one line above — dead-code
     in effect, kept anyway as the smaller, lower-risk diff over deleting
     and re-proving an equivalent plain word count).
2. **`web/src/lib/scoring/term-expand.ts`**
   - Broaden `isCjkOnlyVariant`'s script check (and its `CJK_ONLY_VARIANT`
     regex) from Han-only to the same 4-script class (own local constant —
     this file does not import from profile-compiler.ts and I am not
     introducing a new cross-module dependency for one shared regex
     fragment; round 1 already established the pattern of each file
     defining its own small constants like `WORD_CHAR`).
   - `termOccurrences`: add the SAME CJK-containment branch
     `isCjkOnlyVariant` already gives `termVariantMatches` — a CJK-only
     variant is counted by plain (non-overlapping) substring occurrence
     instead of the boundary regex, so `groundingWeight` (the only caller,
     via ranking, not the gate) stops silently under-counting a CJK tag's
     real mentions. "Guard the path": both functions branch on the SAME
     `isCjkOnlyVariant` predicate, so they cannot drift apart.
3. **`web/src/lib/opportunities/pool-cache.ts`** — no further version bump.
   Round 1's 19->20 bump has not shipped yet (round 1 is still
   IMPLEMENTED_PENDING_REVIEW, nothing committed); v20 is the version for
   the WHOLE NON-ASCII-TEXT fix, round 1 and this round together, landing
   in one eventual commit. I will extend the existing v20 doc-comment
   paragraph in place to also describe round 2's mixed-text/4-script
   refinement, so the comment accurately describes what v20 actually ships
   — not add a v21.

## Tests planned (§1bo.8(f))

- The four mixed cases: no query contains a CJK character; the guide's T3
  text keeps "solid-state electrolyte" as ONE phrase; the ASCII-punctuated
  fixture keeps "NMC811 cathode degradation" as ONE phrase; each keeps its
  bare formulas (LiCoO2, NMC811) — using the manager's own 4 constructed
  texts for direct traceability.
- A Japanese paragraph and a Korean paragraph: no query contains a CJK
  character (pure-kana / pure-Hangul cases, and a kana+Han+Latin mixed
  case for Japanese, matching the manager's own kana finding).
- A kana Required tag and a Hangul Required tag each match continuous prose
  containing them (term-expand.ts, same shape as round 1's Chinese proof
  table).
- Protective: pure-ASCII text keeps byte-identical `generatedQueries`
  against round 1's own pinned fixtures (BATTERY_PROJECT_TEXT etc. — these
  are round 1's EXISTING tests, left unchanged; I will also add one new
  explicit protective test over a fresh Latin-only fixture with hyphens/
  punctuation, per §1bo.8(b)'s "add a protective test" instruction).
- Round 1's tests all stay, unchanged (no assertion needs to change — round
  1's fixtures are either pure-English, already covered, or pure-CJK, whose
  outcome — no query at all — is unaffected by widening the scope of what
  ALSO yields no query).

## Mutations planned (§1bo.8(g); restore each; sha256 before/after
identical; keep each file's own line endings)

1. Remove the CJK delimiter step from `phrasesFromText` (comment out /
   revert the `.replace(CJK_DELIMITER_RUN, "\n")` line only) -> a mixed
   test (T3 "solid-state electrolyte" as one phrase, or the
   no-CJK-character invariant) goes red.
2. Narrow the shared `CJK_SCRIPT_CLASS` back to Han-only -> the Japanese
   test goes red.
3. Bonus (not required by §1bo.8(g), extra rigor matching round 1's own
   practice): the same Han-only narrowing applied to term-expand.ts's
   `isCjkOnlyVariant` -> the kana/Hangul term-matching tests go red.
4. Round 1's 3 mutations re-confirmed still hold under the round-2 code
   (ASCII-only keyword regex restore; whitespace-only literalQueryIfShort
   restore; termVariantMatches CJK branch drop).

## Whole-pool Latin check (re-run, §1bo.8(c))

Same 23 real saved pool files, same env-var-only path passing, same
delete-and-git-status-proof discipline as round 1. Expect 0 differences
again (none of the real saved-pool Required tags contain Hiragana,
Katakana or Hangul either, so this is testing "still byte-identical after
this round's refactor," not new ground).

## Escape clause

If treating a CJK run as an unconditional phrase-delimiter would ever
strip something out of an ORDINARY valid English/Latin project text (i.e.
if the mechanism cannot be scoped tightly enough to affect ONLY text that
actually contains a CJK character), STOP and report rather than
improvising — per the task brief. (Expected: it cannot fire at all on
CJK-free text, since the delimiter regex requires at least one CJK-range
codepoint to match anything; this will be verified by the protective
byte-identical tests before I call this done.)

Next: implement `web/src/lib/feed/profile-compiler.ts`, then
`web/src/lib/scoring/term-expand.ts`, verify each with real vitest runs,
then the mutations, then the whole-pool re-check, then full gates.

## Progress log

- [x] `web/src/lib/feed/profile-compiler.ts`: shared `CJK_SCRIPT_CLASS` (4
      scripts) + `CJK_PUNCTUATION_RANGES` + `CJK_DELIMITER_RUN` +
      `CJK_SCRIPT_STRIP` + `containsCjkCharacter` added; `isCjkOnlyText`
      broadened to 4 scripts (kept as a defensive backstop); the delimiter
      step inserted into `phrasesFromText`'s chunk pipeline; the keyword
      branch's script-strip broadened; `literalQueryIfShort` switched from
      `isCjkOnlyText` to `containsCjkCharacter` (any-CJK, not just
      CJK-only).
- [x] `web/src/lib/scoring/term-expand.ts`: `CJK_SCRIPT_CLASS`/
      `CJK_CHARACTER` broadened to 4 scripts; `isCjkOnlyVariant`
      REDESIGNED (not just broadened) after a real Unicode bug was found by
      execution — see below; `termOccurrences` gets the same
      `isCjkOnlyVariant`-gated containment branch as `termVariantMatches`.
- [x] `web/src/lib/opportunities/pool-cache.ts`: v20's doc comment extended
      in place to describe round 2's mixed-text/4-script refinement; no
      further version bump (stated reasoning: round 1 has not shipped yet,
      v20 is the version for the whole item).
- [x] **Real bug found and fixed by execution, not by inspection:** my
      first draft of the katakana/Hangul-broadened `isCjkOnlyVariant`
      required EVERY character in a variant to positively match one of the
      four `\p{Script=...}` properties. The katakana word "バッテリー"
      (battery) failed this — Unicode classifies U+30FC, the
      katakana-hiragana PROLONGED SOUND MARK (used in most katakana
      loanwords), as `Script=Common`, not `Script=Katakana`. Found via a
      real, failing vitest run (5 tests red), not predicted in advance.
      Fixed by redesigning `isCjkOnlyVariant` to the same "has a CJK
      character AND no disqualifying Latin/digit" shape
      `isCjkOnlyText` already used (robust to any Script=Common CJK-adjacent
      mark), and by adding U+30FB-30FC to profile-compiler.ts's
      `CJK_PUNCTUATION_RANGES` (needed there too, since the delimiter
      mechanism positively enumerates characters rather than asking "is
      there a disqualifying character present").
- [x] Tests added: 16 new tests in profile-compiler.test.ts (round 2
      describe block: the it.each 6-fixture "no query contains a CJK
      character" invariant check, the manager's 4 mixed-text fixtures'
      individual phrase/formula assertions, Japanese, Korean,
      tag-first-with-Japanese, protective pure-ASCII, protective
      round-1-pin-reconfirmed, 2 mutation guards — verified against the
      exact vitest count delta, 31 -> 47); 2 pre-existing round-1
      assertions corrected with the required "NON-ASCII-TEXT (§1bo.8)"
      comment (LiCoO2/NMC811 now assert ORIGINAL CASE, a real,
      verified-by-execution behaviour change: round 2's delimiter isolates
      the formula in its original case via `longPhrases`, which now wins
      cleanList's case-insensitive dedup over the lowercase keyword-branch
      form — explained in the test's own comment); 14 new tests in
      term-expand.test.ts (68 -> 82; kana/Hangul termVariantMatches/
      termMatches proof table + a direct
      termVariantMatches check + an absence check + a mutation-guard check,
      plus 4 termOccurrences tests incl. a Latin-protective one). Every
      pre-existing test from round 1 (and the original pre-NON-ASCII-TEXT
      suite) left unchanged otherwise.
- [x] Whole-pool check re-run: 743 pairs, 23 real pool files, 6 real Latin
      Required tags (474 true / 269 false outcomes). Diffed TWO ways: (1)
      against the very first pre-fix baseline (`wholepool-BEFORE.json`,
      captured before round 1 touched anything) — **0 differences**,
      proving Latin-tag matching is completely unaffected by BOTH rounds
      combined; (2) against round 1's own after-snapshot — **0
      differences**, isolating that round 2 alone changed nothing for
      Latin tags. Probe deleted, confirmed absent via `git status --short`.
- [x] Mutation 1 (§1bo.8(g), remove the CJK delimiter step): exactly 8
      round-2 mixed-text tests went red (39/47 stayed green — every
      round-1 test and every round-2 pure-CJK/Japanese/Korean/protective
      test unaffected). Reverted; sha256 identical.
- [x] Mutation 2 (§1bo.8(g), narrow `CJK_SCRIPT_CLASS` to Han-only in
      profile-compiler.ts): exactly 6 tests went red (Japanese AND Korean,
      since narrowing the one shared constant removes Hiragana/Katakana
      AND Hangul together — 41/47 stayed green). Reverted; sha256
      identical.
- [x] Bonus mutation (not required by §1bo.8(g), same rigor as round 1's
      own bonus check — extra proof my term-expand.ts broadening is not
      dead code): the same Han-only narrowing applied to term-expand.ts's
      `CJK_SCRIPT_CLASS`: exactly 9 kana/Hangul tests went red (73/82
      stayed green, including every Chinese/Latin/mixed-variant test).
      Reverted; sha256 identical.
- [x] Round 1's 3 mutations RE-CONFIRMED under the round-2 code (not just
      assumed): (1) ASCII-only keyword regex restore -> still exactly the
      3 accented-Latin tests red (44/47 green), reverted, sha256 identical;
      (2) whitespace-only `literalQueryIfShort` restore -> now 11 tests red
      (round 1's 6 PLUS round 2's tests that also depend on this same
      guard — a stronger, not weaker, red than round 1 alone; 36/47
      green), reverted, sha256 identical; (3) drop the CJK containment
      branch in `termVariantMatches` -> now 13 tests red (round 1's 5 PLUS
      round 2's 8 kana/Hangul termMatches tests; confirmed
      `termOccurrences`'s OWN independent branch is untouched by this
      specific mutation — its dedicated test stayed green, proving the two
      functions really do "guard the path" independently while sharing one
      classifier; 69/82 green), reverted, sha256 identical.
- [x] Line endings verified byte-level (PowerShell) after every edit and
      every mutation round-trip this round too: profile-compiler.ts/
      .test.ts stayed 100% LF throughout; term-expand.ts/.test.ts and
      pool-cache.ts/.test.ts stayed 100% CRLF throughout.

## Gates — RESULT

- [x] `npx vitest run` — 294 files (291 + 3 skipped) / **5625 passed** + 6
      skipped / 0 failed. Round-1 baseline was 5595 passed; the +30 delta
      is exactly the new tests added this round (16 + 14, verified against
      the exact per-file test-count deltas, 31->47 and 68->82).
- [x] `npx tsc --noEmit` — 0 errors, exit code 0.
- [x] `npx eslint .` — 0 errors / 151 warnings, matching baseline exactly.
- [x] `npm run build` — succeeded first try (no font-fetch retry needed).
      Same single pre-existing, unrelated Turbopack NFT-tracing warning
      through `pdf-text.ts` seen in round 1.

## ROUND 2 final summary

STATUS: IMPLEMENTED_PENDING_REVIEW

**Changed files (same 6 as round 1 — no new files added this round):**
- `web/src/lib/feed/profile-compiler.ts`
- `web/src/lib/feed/profile-compiler.test.ts`
- `web/src/lib/scoring/term-expand.ts`
- `web/src/lib/scoring/term-expand.test.ts`
- `web/src/lib/opportunities/pool-cache.ts` (comment only — version stays
  20, reasoning stated above)
- `web/src/lib/opportunities/pool-cache.test.ts` (one new pinned-version
  test; one stale pre-existing comment corrected, unrelated to my own
  earlier edit — it still said "v18" after DATASET-RECORDS had already
  shipped v19)

**Invariant shipped (§1bo.8(a)):** no query built from free text contains a
CJK character (Han, Hiragana, Katakana or Hangul), full stop — proved by
the it.each 6-fixture test in profile-compiler.test.ts using the manager's
own constructed texts (M1-M6) plus a fresh Japanese/Korean pair, and by
every existing round-1 pure-CJK test continuing to pass under the widened
scope.

**Mechanism (§1bo.8(b), stated as required):** a CJK run (any of the four
scripts, or CJK/fullwidth punctuation) now acts as a chunk delimiter,
spliced into `phrasesFromText`'s existing ASCII-delimiter chunk split via a
`"\n"` substitution — reusing the existing pipeline rather than adding a
parallel one. This isolates an embedded Latin phrase ("solid-state
electrolyte") as its own chunk and a formula glued directly onto
surrounding CJK text with zero whitespace ("LiCoO2") the same way, while
every CJK part of the same field contributes nothing. Verified inert on
pure-ASCII text (the pattern requires at least one CJK-range codepoint to
match anything) by a dedicated protective test and by round 1's own pinned
fixtures re-running byte-identical.

**Real bug found and fixed by execution (not predicted in advance):** my
first draft's CJK-only classification required every character in a
Required-tag variant to positively match one of the four `\p{Script=...}`
properties. A real, common katakana word ("バッテリー", battery) failed
this, because Unicode classifies its prolonged-sound mark (U+30FC) as
`Script=Common`, not `Script=Katakana` — caught by 5 failing vitest tests,
not by inspection. Fixed by redesigning the check to "has a CJK character
AND no disqualifying Latin letter or digit," the same shape
`isCjkOnlyText` already used; profile-compiler.ts's delimiter character
ranges were separately widened to also cover U+30FB-30FC for the same
reason. Documented in both files' comments so a future reader does not
reintroduce the stricter, wrong version.

**Whole-pool Latin check (§1bo.8(c), re-run):** same 23 real saved pool
files, same env-var-only path passing, same delete-and-git-status-proof
discipline. Diffed TWO ways this round: against the very first pre-fix
baseline (captured before round 1 touched anything) — **0 differences**
across all 743 pairs, proving Latin-tag matching is completely unaffected
by both rounds combined; and against round 1's own after-snapshot — **0
differences**, isolating that round 2 alone changed nothing for the 6 real
Latin Required tags (solid state / solid-state battery electrolyte /
electrolyte / solid electrolyte / LCO / sodium-ion battery cathode
materials; 474 true / 269 false outcomes both times). Probe deleted,
confirmed absent via `git status --short`.

**Mutation proof this round (sha256 before === after every round-trip;
line endings verified byte-level throughout, unchanged from baseline):**
1. Removed the CJK-delimiter step from `phrasesFromText` -> exactly 8
   round-2 mixed-text tests red (39/47 green — every round-1 and every
   round-2 pure-CJK/Japanese/Korean/protective test unaffected). Reverted;
   sha256 identical.
2. Narrowed `CJK_SCRIPT_CLASS` to Han-only in profile-compiler.ts ->
   exactly 6 tests red, both Japanese AND Korean (41/47 green). Reverted;
   sha256 identical.
3. BONUS: the same Han-only narrowing in term-expand.ts -> exactly 9
   kana/Hangul tests red (73/82 green, zero Chinese/Latin/mixed tests
   affected). Reverted; sha256 identical.
4. **Round 1's 3 mutations RE-CONFIRMED under the round-2 code** (not
   assumed): ASCII-only keyword regex restore (still exactly 3 red);
   whitespace-only `literalQueryIfShort` restore (now 11 red — round 1's 6
   plus round 2's tests sharing the same guard, a STRONGER red, not a
   weaker one); drop the `termVariantMatches` CJK branch (now 13 red —
   round 1's 5 plus round 2's 8 kana/Hangul tests, while confirming
   `termOccurrences`'s own independent branch is untouched by this specific
   mutation — proving the "guard the path" design really does keep the two
   functions independent while sharing one classifier). All reverted;
   sha256 identical each time.

**Out of scope, unchanged from round 1's own list** (row 4/6/11 of the
guide, `termOccurrences`'s status is now RESOLVED per §1bo.8(c) rather than
left as a noted gap): no English-only Profile hint, no machine translation,
no multilingual retrieval, no change to tokenize.ts's short-word length
filter, no change to `isMultiWord` tier classification or
`materialsOrDatasets`'s English-only regex, no fix to `expandTerm`'s
cosmetic CJK-plural garbage. Other scripts (Cyrillic, Arabic, …) explicitly
out of scope per §1bo.8(e) — no evidence, not shipped.

**Git:** no commit, no push, no stash, no branch operation performed this
round either. `web/.env`/`web/.env.local` never opened. Root
`node_modules/` and the dev server untouched. No tool call or edit was
denied during this round (so no BLOCKED sub-steps to report). No person's
name written anywhere; scratchpad referred to only as "<scratchpad>/…"
throughout, including in the reused probe script.

STATUS: IMPLEMENTED_PENDING_REVIEW
