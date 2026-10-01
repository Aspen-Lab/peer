# NON-ASCII-TEXT — B investigation

STATUS: COMPLETE

Item: ABC-JEV-INTEGRATION.md §1ay point 4 / §5 row `NON-ASCII-TEXT`. "The keyword
regex in profile-compiler.ts drops all non-ASCII text, so a project written in
Chinese loses almost everything." Also flagged out-of-scope in §1az.4 (QUERY-BUDGET)
and §1ay.4 (QUERY-QUALITY): "NON-ASCII-TEXT unaffected" by those two fixes.

Role: B (investigator). Read-only on product code. This guide is the only file
written in the repo; all scratch scripts live under the session scratchpad
(`<scratchpad>/…`), never under `web/`. No network calls. No test suite / tsc /
eslint / build run (that is C's and A's job, not B's).

Branch: `Jev-integration-and-sorting-filtering-enhancement`, HEAD 35c2d2ed at start.

Proof method: Node 24 imports `.ts` files directly (confirmed by execution — no
flags needed, native ESM + type-stripping). This repo's imports are
bundler-style (extensionless relative specifiers, `@/` path alias), which plain
Node does not resolve, so a small **read-only resolver hook**
(`<scratchpad>/nascii-hook.mjs`) rewrites those two patterns before handing them
back to Node's own resolver — it does not change, copy, or shadow any file
under `web/`. Every function quoted below was executed through this hook
directly from the real file at its real path; nothing was ported or
reimplemented. Scripts: `<scratchpad>/nascii-hook.mjs`,
`<scratchpad>/nascii-measure.mjs`, `<scratchpad>/nascii-measure2.mjs`,
`<scratchpad>/nascii-boundary.mjs`.

---

## 0. One-paragraph summary

Reader-declared **structured** fields — Required topics, Explore topics, avoid
terms, methods — are never touched by any ASCII-only code; they pass through
byte-identical regardless of script, and the actual paper-matching engine
(`term-expand.ts`'s `canonicalize`) is already Unicode-correct. The damage is
narrower and more specific than "drops all non-ASCII text": it happens only to
**free text** (Project, Challenges, seed texts) when that free text is turned
into search queries. A pure-Chinese Project field yields **zero** derived
keyword queries (correct letters, wrong assumption: the code deletes every
non-ASCII character to build a fallback keyword list) but is not simply
"dropped" — a separate bug (a whitespace-counting length guard) lets the
**entire untouched paragraph** leak through as one giant, low-value literal
query instead. Accented Latin (Müller, électrolyte) is not dropped either — it
is **corrupted** into wrong fragments ("ller", "lectrolytes") that can also
silently evict good, correct words later in the same sentence. And even where
Chinese characters *are* preserved correctly (`canonicalize`), a completely
separate bug in the word-boundary matcher (`term-expand.ts`) means a Chinese
Required tag almost never matches Chinese prose containing it, because that
matcher assumes words are separated by whitespace — true for English, never
true for continuous Chinese text. All four claims below are proven by running
the real functions, not inferred from reading the regex.

---

## Task 1 — inventory of every split/filter/match step on reader text

### 1.1 Table

| # | File:line | Function | Reader-text input | What happens to Chinese | What happens to mixed CN+Latin | What happens to accented Latin |
|---|---|---|---|---|---|---|
| 1 | `web/src/lib/feed/profile-compiler.ts:104-133` | `phrasesFromText` — `keywords` branch (line 126) | Project, Challenge, seed texts | **Deleted entirely.** Every CJK char is not in `[a-z0-9+\-/.\s]`, becomes a space, then the length≥4 filter (line 128) drops what's left (nothing). | Embedded Latin/formula terms (LiCoO2, NMC811, "solid-state", "electrolyte") **survive** cleanly; surrounding Chinese words are deleted the same as pure Chinese. | **Corrupted, not dropped.** An accented letter becomes a space, splitting the word; the ASCII remainder survives if ≥4 chars ("Müller"→"ller", "électrolytes"→"lectrolytes", "Étude"→"tude"). |
| 2 | `profile-compiler.ts:104-120` | `phrasesFromText` — `chunks`/`longPhrases` branch | same | Not character-filtered, but the split delimiter (line 114) is ASCII-only (`. , ; : \n` or `" - "`) — fullwidth CJK punctuation (，。；：) is invisible to it, so a whole Chinese paragraph stays **one chunk**. That chunk then passes the `≤10 words` phrase-length filter (line 119) almost by accident, because `.split(/\s+/)` can't see word boundaries inside unspaced CJK — the **entire paragraph** counts as "1 word." | Same one-chunk behavior, UNLESS the embedded Latin terms introduce real ASCII spaces — then the whitespace word-count can exceed 10 and correctly exclude it (script-dependent, not reliable). | Real prose with real spaces is correctly measured (a genuine 18-word French/English sentence correctly fails the ≤10 filter and is excluded) — this path works as designed for space-delimited scripts. |
| 3 | `profile-compiler.ts:147-151` | `literalQueryIfShort` | Project, Challenge (whole field) | **Never truncated.** `.split(/\s+/)` on unspaced CJK returns a 1-element array no matter how long the paragraph is, so the `≤6 words` cap (`MAX_LITERAL_QUERY_WORDS`, line 145) never fires — the whole raw paragraph is sent verbatim as one literal query, unconditionally. | Same, when the Chinese portion dominates and no early ASCII delimiter breaks it up. | Correctly gated — a García/Müller-style sentence with real spaces is correctly excluded once >6 words. |
| 4 | `profile-compiler.ts:207` | `projectQueries` — `isMultiWord` | Derived project terms | An unspaced CJK blob is misclassified as a single **"word"** (Tier 2, lowest priority) rather than a "phrase," purely because it contains no ASCII whitespace. | Flips to "phrase" (Tier 1, high priority) the instant the blob contains ANY embedded Latin run with spaces around it — an incidental, script-accidental classification, not a semantic one. | Not applicable (real phrases are already excluded upstream by longPhrases' word-count filter, see row 2). |
| 5 | `profile-compiler.ts:210,215` | `projectQueries` — `strongestPhrase` × topics | Project text × Required topics | When `projectTerms[0]` is the whole raw CJK paragraph, every Required topic gets combined into a garbage `"<topic> <entire paragraph>"` query (proven in Task 2). | Same risk when the dominant blob outranks the Latin fragments. | N/A |
| 6 | `profile-compiler.ts:273` | `compileSearchBrief` — `materialsOrDatasets` | `activeQuestions` (derived from Challenge/seed text) | English-only regex (`/data\|dataset\|material\|cathode\|anode\|electrolyte\|benchmark/i`) never matches Chinese text, so a Chinese challenge about materials/cathodes always yields `[]` here — silent, separate from the keyword-regex bug. | Same — the filter only looks at the derived string, not per-word. | Same (would only match if the ASCII substrings happen to survive). |
| 7 | `web/src/lib/scoring/tokenize.ts:18` | `tokenize` — character class | Reader text reaching `tokenize`/`tokenizeFolded`: `senseContextText`/`profileText` (`combine.ts:71-77,45-52`) → SENSE-CONTEXT gate (`keyword.ts:480-484`); `brief.mustInclude/niceToHave/activeQuestions/methods/avoid` → `rerank.ts:7-13` overlap scoring | **Correctly preserved.** `\p{L}\p{N}\s-` (Unicode-aware) keeps every CJK character — this is the "good" character class, unlike row 1. | Latin terms and CJK both preserved. | Correctly preserved and correctly space-segmented (confirmed by execution: "müller","électrolytes" tokenize as clean, separate, correct words). |
| 8 | `tokenize.ts:19` | `tokenize` — segmentation | same | **Whole run becomes one token.** `.split(/\s+/)` cannot find word boundaries inside unspaced CJK — a full sentence tokenizes to 1-2 giant "tokens," useless for the word-overlap scoring this feeds (SENSE-CONTEXT gate, rerank avoid/mustInclude/niceToHave overlap). | Same for the CJK portion; Latin portions segment normally. | Segments correctly (French/English use real spaces). |
| 9 | `tokenize.ts:20` | `tokenize` — length filter | same | **Drops short, meaningful CJK words.** `t.length >= 3` deletes 2-character words like 电池 (battery) entirely, while common English words are rarely this short. A 3-char word survives only as one undivided token (row 8). | N/A (short CJK words inside a mixed sentence still get merged into the surrounding undivided run — see row 8). | No impact — accented words are rarely under 3 letters. |
| 10 | `web/src/lib/scoring/term-expand.ts:50-58` | `canonicalize` | Required/Explore/avoid topics AND item (paper) title/abstract/tags — the actual Required-gate matching engine (`keyword.ts` calls this consistently on both sides) | **Correctly preserved**, including NFKC normalization. This is the reference-correct implementation the other two files' ad hoc regexes should have matched. `canonicalize('Müller électrolyte 电池')` → `'müller électrolyte 电池'` (unchanged but case-folded). | Correct. | Correct — diacritics kept, not stripped. |
| 11 | `term-expand.ts:206-229` | `inflectedForms` (feeds `expandTerm`) | Required/Explore topics | **Cosmetic corruption, not data loss.** English-only suffix rules don't recognize CJK; falls to the `else` branch and mechanically appends Latin "s". Confirmed: `expandTerm('电池')` → `["电池","电池s","电池ss"]` (a BFS re-visit produces two garbage variants). Harmless in practice (nothing real will ever match "电池ss") but wastes matching work and proves the code was never CJK-aware. | N/A | N/A (an accented Latin tag like "Müller" would get ordinary English pluralization rules applied to it, e.g. "müllers" — not wrong, just unverified for correctness of French/German plurals; out of scope here). |
| 12 | `term-expand.ts:253,268-272` | `termVariantMatches` (used by both `termMatches` and `termOccurrences` — the actual gate) | Required/Explore topic vs. item text, whichever side is CJK | **Separate, major bug.** The whole-word boundary check (`(?<![\p{L}\p{N}\p{M}])...(?![\p{L}\p{N}\p{M}])`) assumes words are delimited by whitespace/punctuation. Chinese text never delimits words this way, so a Chinese tag fails to match Chinese prose containing it in every realistic case (proven in 1.3 below) — it only matches when the tag is the *entire* haystack or is explicitly space-delimited on both sides (a keyword-list style string, not prose). | N/A (mixed haystacks with real English use normal word-boundary matching correctly). | N/A (accented Latin words are space-delimited like normal English, so the boundary check works correctly for them — confirmed: `termMatches` on French/English prose is fine). |
| 13 | `web/src/lib/scoring/combine.ts:119-125` | `topicMatchesItem` (legacy negativeTopics / avoid path) | avoid / negativeTopics (reader-declared) | **Correctly preserved** — plain `.toLowerCase().includes()`, Unicode-safe, no character stripping. Confirmed: a Chinese avoid-term ("综述", "review") survives `cleanList` and this substring check untouched. | Correct. | Correct. |
| 14 | `combine.ts:45-52,71-77` | `profileText` / `senseContextText` | methods, venues, seedTexts (reader-declared "work text") joined into one string, then fed to `tokenize`/`tokenizeFolded` | Inherits rows 7-9's segmentation/length problems — a Chinese seed text becomes 1-2 undivided tokens in the SENSE-CONTEXT gate's context-agreement check. | Same. | No impact (see rows 7-9). |
| 15 | `web/src/app/profile/page.tsx:1914-1933` | Profile page "Project"/"Challenges" `EditRow` fields | The raw textarea input itself | **Not filtered at all** — the UI accepts and stores any script untouched; the damage happens later, server-side, in `phrasesFromText`. | same | same |

### 1.2 What does NOT lose data

Required topics, Explore topics, avoid terms, and methods are never run through
the ASCII-only regex (row 1). They only pass through `cleanList`
(`profile-compiler.ts:90-102`, trim + whitespace-collapse + lowercase dedup
key — no character stripping) and, at matching time, `canonicalize` (row 10,
Unicode-correct). **Proven by execution** (`nascii-measure.mjs`, "TASK 2c"):

```
req = { project: "", topics: ["电池"], methods: [], seedTexts: [] }
compileSearchBrief(req).generatedQueries === ["电池"]   // untouched
```

and (`nascii-measure2.mjs`): a Chinese avoid term `"综述"` survives into
`brief.avoid` unchanged, and a Chinese method `"扫描电子显微镜"` survives into
`brief.methods` and gets combined into a Tier-3 query
`"battery 扫描电子显微镜"` unchanged. The bug is scoped to **free-text-derived
queries**, not to the reader's explicit tags.

### 1.3 The separate word-boundary bug, proven

This is the most consequential finding beyond the item's own framing: even
where non-ASCII text survives untouched (`canonicalize`), the actual gate
(`termMatches`) still fails for Chinese, for an unrelated reason. Executed via
`<scratchpad>/nascii-boundary.mjs`:

| Haystack (after `canonicalize`) | Tag | `termMatches` |
|---|---|---|
| `"这篇论文研究了电池的性能"` (normal prose containing 电池) | `电池` | **false** |
| `"电池"` (tag is the entire haystack) | `电池` | true |
| `"电池性能很好"` (tag at the very start) | `电池` | **false** |
| `"我们研究电池"` (tag at the very end) | `电池` | **false** |
| `"关键词 电池 研究"` (explicit space-delimited list, not prose) | `电池` | true |
| `"this paper studies battery performance in depth"` (English control) | `battery` | true |

A Chinese Required tag matches Chinese text only when the tag *is* the whole
string or sits between literal whitespace on both sides — i.e., essentially
never, for real prose (an abstract, a title). This means fixing the query-side
regex (Task 3 option a) is necessary but **not sufficient**: even a paper that
genuinely contains the reader's Chinese term in its own (Chinese) text would
still fail the Required-gate today, because of this independent bug in
`termVariantMatches`.

---

## Task 2 — five constructed project texts through the real pipeline

Executed via `compileSearchBrief`/`briefToSeedTexts`, the actual exported
functions, imported from the real file
(`web/src/lib/feed/profile-compiler.ts`) with no modification.

**T1 — all-English:** "We are developing high-energy lithium-ion battery
cathodes using solid-state electrolytes, focused on cycling stability and
dendrite suppression."
```
generatedQueries: ["We are developing high-energy lithium-ion battery cathodes using solid-state electrolytes",
                    "focused on cycling stability and dendrite suppression",
                    "developing", "high-energy", "lithium-ion"]
```
5 usable queries: 2 real phrases + 3 keywords.

**T2 — all-Chinese:** "我们正在研究高比能锂离子电池正极材料，重点关注固态电解质界面的稳定性和枝晶抑制机制。"
(*"We are researching high-specific-energy lithium-ion battery cathode
materials, focusing on the stability of the solid electrolyte interface and
dendrite-suppression mechanisms."*)
```
generatedQueries: ["我们正在研究高比能锂离子电池正极材料，重点关注固态电解质界面的稳定性和枝晶抑制机制。"]
```
**1 query: the entire untouched paragraph.** Zero derived keywords (the
keyword-regex path yields nothing; nothing else survives dedup). With a
Required topic `"battery"` added, every Tier-1b query becomes
`"battery <entire paragraph>"` — confirmed:
```
["battery", "battery 我们正在研究...枝晶抑制机制。", "我们正在研究...枝晶抑制机制。"]
```

**T3 — mixed (Chinese sentence with embedded LiCoO2 / solid-state electrolyte
/ NMC811):** "我们的项目专注于 LiCoO2 正极材料和 solid-state electrolyte 的界面工程，并测试 NMC811 材料的循环稳定性。"
```
generatedQueries: ["我们的项目专注于 LiCoO2 正极材料和 solid-state electrolyte 的界面工程，并测试 NMC811 材料的循环稳定性。",
                    "licoo2", "solid-state", "electrolyte", "nmc811"]
```
The embedded Latin/formula terms **do** survive as 4 clean queries — the best
case in this set — but "正极材料" (cathode material), "界面工程" (interface
engineering), "循环稳定性" (cycling stability) are silently gone, and the whole
raw blob is still present as query #1 (same as T2).

**T4 — accented Latin:** "Étude du transport ionique dans les électrolytes
solides à base de pérovskite de type Müller pour batteries au lithium."
```
generatedQueries: ["tude", "transport", "ionique", "dans", "lectrolytes"]
```
**Worst case measured.** "Étude"→"tude", "électrolytes"→"lectrolytes" (both
wrong, unrecognizable fragments — not the words a search index would know).
Two genuinely correct, useful words that WERE extracted correctly —
"batteries" and "lithium" — are silently evicted, because the keyword branch
takes the first 5 raw matches in left-to-right order (`profile-compiler.ts:130`)
*before* re-ranking, and the corrupted fragments happen to come first in this
sentence. `generatedQueries` ends up with **zero** words a source would
recognize, despite the source sentence being squarely about batteries and
lithium.

**T5 — short Chinese terms:** "电池研究：提高电池寿命和安全性。" (*"Battery
research: improve battery lifespan and safety."*)
```
generatedQueries: ["电池研究：提高电池寿命和安全性。"]
```
Same one-giant-blob pattern as T2 (the fullwidth colon "：" is invisible to
`phrasesFromText`'s ASCII-only delimiter, row 2 above) — worth contrasting with
`tokenize()` (row 7-8), which DOES recognize "：" as punctuation
(Unicode-category-based) and splits on it: `tokenize(T5)` →
`["电池研究","提高电池寿命和安全性"]`, 2 tokens, still each undivided internally.
Two different splitters in this codebase, with two different degrees of CJK
punctuation awareness.

Full transcripts (also covering `challenge`, `seedTexts`, `negativeTopics`,
`methods` inputs — all confirm the same pattern) are in
`<scratchpad>/nascii-measure.mjs` and `<scratchpad>/nascii-measure2.mjs`
output, reproducible by re-running them with the same Node command recorded at
the top of this file.

---

## Task 3 — options

**(a) Keep non-ASCII letters in the query-derivation regex (`\p{L}\p{N}`).**
Reader gets: accented Latin stops being corrupted (fixes T4 completely); a
Chinese project text stops silently deleting itself in the keyword branch —
but on its own this does **not** fix Chinese granularity, because the deeper
cause is segmentation (rows 2-4), not just the character class. Must ship
together with a script-aware phrase/word-length guard (fix rows 2-4) and the
`termVariantMatches` CJK boundary fix (row 12) to be a real improvement rather
than "technically correct, practically unchanged." Cost: cheap, deterministic,
one-time. Risk: even fully fixed, Chinese queries sent to OpenAlex/S2/arXiv/
PubMed/dblp mostly return nothing or noise, because those corpora are
overwhelmingly English-language — this option cannot manufacture Chinese-
language recall that doesn't exist in the source data. Must be honestly
communicated as "stops the bugs, doesn't create new recall."

**(b) Extract only Latin-script/formula terms from mixed text; never derive a
query from Chinese.** Reader gets: same good outcome as (a) for T3 (mixed);
for pure-Chinese text (T2/T5), the reader gets **nothing** derived from free
text at all (clean silence instead of noisy blob) — Required/Explore tags
still work as today. This is close to today's actual (accidental) behavior,
made deliberate and honest, plus fixing the accented-Latin corruption and the
whole-blob literal-query leak. Cost: similar to (a), slightly narrower change.
Risk: does not address the headline complaint ("loses almost everything") for
a reader who writes only in Chinese — it just stops the loss from being ugly.

**(c) Tell the reader on the Profile page that Project/Challenges works best
in English.** Concretely: one line of copy under the existing "Project"
(`web/src/app/profile/page.tsx:1914-1933`, `currentProject`) and "Challenges"
(`:1927-1933`, `currentChallenges`) fields, e.g. "Works best in English —
specific terms (chemical formulas, method names) still help even in another
language." Reader gets: honest expectations; can choose to write in English
or English+formulas for full query generation, or rely on Chinese
Required/Explore tags (which work for matching, modulo corpus-language
coverage). Cost: trivial, no logic change. Risk: does not fix the code; can
read as putting the burden on a Chinese-writing user of their own bilingual
product — **named as POLICY below, not shipped without the user's sign-off**,
per the task's own instruction.

**(d) Machine translation (AI call).** Translate Project/Challenge/seed text
to English before deriving queries (a Tier 2 cloud-LLM enhancement per
`docs/PRODUCT_DIRECTION.md`'s three-tier model — never a hard dependency, per
that doc's "Reliability through degradation" rule). Reader gets: potentially
the best outcome — full-quality English queries from Chinese meaning, and
could add translated terms alongside the original Chinese so `canonicalize`-
level matching still benefits from the original text too. Cost: real,
ongoing, per-call spend against the same company-spend-cap infrastructure this
campaign already built for Jev decisions (`PEER_COMPANY_SPEND_CAP`), or BYOK;
added latency; needs caching keyed off the intent hash so the same project
text isn't re-translated (re-billed) every feed refresh. Risk: a wrong
technical-term translation silently changes what the reader declared (tension
with `docs/PRODUCT_DIRECTION.md`'s "User-declared intent over guessed
preference"); must degrade to (a)/(b)'s behavior when no key/budget is
available, never a hard failure. **Named as POLICY below** — a real product
and cost decision, per the task's own instruction.

**(e) Other options worth naming, not for this item's immediate scope:**
- **(e1) Multilingual/local sentence embeddings (Tier 1, no per-call cost).**
  `briefToSeedTexts` already feeds seed texts into whatever semantic-
  similarity/seed-recommendation channel this campaign's spec (§3c) describes.
  A local multilingual embedding model could compare the raw Chinese project
  text against English paper embeddings directly, sidestepping translation
  entirely, and fits `docs/PRODUCT_DIRECTION.md`'s own Tier 1 definition
  ("Local embeddings... semantic similarity for related terms") better than
  option (d) fits Tier 2. This is a real design/engineering project, not a
  regex fix — recommend logging as a separate follow-up item, not bundled here.
- **(e2) Fix `termVariantMatches` (row 12) for CJK-only variants** — use
  substring containment instead of the whitespace-boundary regex when the
  variant is entirely CJK script (containment IS the correct notion of "word"
  in a script that doesn't delimit words with spaces). Small, deterministic,
  Tier 0, no product decision, no cost — recommend shipping regardless of
  which of (a)/(b)/(c)/(d) the user picks, since it fixes a real defect
  `canonicalize` already implies should work.
- **(e3) Recognize CJK fullwidth punctuation as a phrase delimiter**
  (`profile-compiler.ts:114`) — cheap, orthogonal, Tier 0.
- **(e4) Relax `tokenize.ts`'s `length >= 3` filter (row 9) for CJK-script
  tokens only** — small correctness tuning, same measure-against-real-data
  discipline this campaign already used for the TOKENIZE-PLURALS item; must
  not relax the length floor for Latin-script tokens (would reintroduce noise).

### Recommendation

Ship (a) — corrected to include the segmentation and boundary fixes it needs
to actually work (rows 2-4, 12; i.e., (e2) and (e3) travel with it) — now, as
a Tier 0 bug fix requiring no product decision: it stops active data
corruption (accented Latin) and stops an unbounded raw-text leak (CJK literal
query), and it makes the Required-gate matcher behave the way `canonicalize`
already implies it should. Explicitly tell the user, when this ships, that it
is a correctness fix, **not** a Chinese-recall improvement: the five source
adapters are English-language corpora, and no regex change manufactures
Chinese-language papers that don't exist in them. Options (c) and (d) are
genuine product decisions and must go to the user before either ships — see
POLICY below. Option (e1) is a good longer-term direction, worth a separate
follow-up item, not this item's scope.

---

## Task 4 — tests and POLICY list

### Tests the fix needs

1. Pin today's `compileSearchBrief` output for all 5 constructed texts in this
   guide (byte-exact), so any change is a deliberate, reviewed diff — matching
   this campaign's `§3a` baseline discipline.
2. Accented-Latin regression fixtures: "Müller", "électrolyte", "pérovskite"
   each survive as themselves (not "ller"/"lectrolytes"/"rovskite") in the
   keyword-branch output.
3. Protective: mixed-text formula/English extraction (LiCoO2, NMC811,
   "solid-state", "electrolyte") must not regress — this already works today.
4. A long, unspaced CJK paragraph is never sent as one unbounded literal query
   — assert a length/word-count guard that works without relying on
   whitespace; mutation (revert the guard) → red.
5. `termVariantMatches`/`termMatches`: a Chinese Required tag matches Chinese
   prose that contains it in a normal (non-edge, non-space-delimited)
   position — the case this guide proved false today. Protective companion
   test: the fix must NOT let short Latin-script substrings start matching
   inside longer words (e.g. "cat" must still not match "category") — the
   CJK carve-out must be scoped to CJK-only variants, not a blanket substring
   match.
6. `expandTerm` on a CJK term: either fixed (no "电池s"/"电池ss") or, if left
   as low-priority cosmetic debt, pinned so a future change is deliberate.
7. If `tokenize.ts`'s length filter is relaxed for CJK (POLICY 6 below): a
   short real CJK word (e.g. "电池") is retained; protective test that 1-2
   letter LATIN fragments are still dropped (the relaxation must be
   script-scoped, not a blanket floor change).
8. `materialsOrDatasets` (row 6): either accept the English-only scope as a
   named, accepted gap (test pins it), or extend the regex — a product-neutral
   engineering call C can make either way, but must be explicit, not silent.
9. If option (c) ships: a snapshot/copy test that the new hint text renders
   under Project/Challenges.
10. If option (d) ships: BYOK / company-enabled / company-disabled /
    unauthenticated cases per `§3a`'s existing requirement; a cache test that
    identical Chinese text is not re-translated (re-billed) on repeat
    requests; fixture tests with a mocked translation call — never live.
11. Every shipped guard gets a mutation test that turns red when reverted, per
    this campaign's standard (seen throughout `§1ay`-`§1az`'s rulings).
12. Bump `PAPER_CACHE_KEY_VERSION` if generated queries or pool membership can
    change for any existing profile (they can, for T2/T3/T5-shaped project
    text) — C determines the exact new value by reading the current one at
    implementation time, per this campaign's existing convention.

### POLICY (numbered; items 3 and 4 are product/cost decisions for the user)

1. **Character-class + segmentation + boundary-matcher correctness fixes**
   (option a, corrected with e2/e3 above): recommend **ship now** — Tier 0,
   deterministic, no ongoing cost, no product-judgment call. Pure bug fix in
   the same spirit as this campaign's other B→C correctness items.
2. **Query-generation stance for pure-Chinese free text** — (a)'s "keep what
   little survives, stop corrupting it" vs. (b)'s "derive nothing from
   Chinese, only from embedded Latin/formula terms": a small behavioral
   choice that changes shipped query strings (cache-key-bump territory).
   Recommend (a)'s honest-but-minimal stance, named explicitly in the ruling
   the user reviews rather than defaulted silently.
3. **Telling the reader that Project/Challenges works best in English**
   (option c): a product-tone decision. **Not to ship without the user's
   explicit sign-off** — this is exactly the case the task instructions
   named directly.
4. **Machine translation** (option d): real ongoing spend, latency, and
   mistranslation risk against the reader's own declared intent; gated by the
   same company-spend-cap infrastructure this campaign already built.
   **The user's call** — named directly per the task instructions, not a
   default C can enable.
5. **Multilingual/local embedding retrieval** (e1): out of scope for this
   item's fix. Recommend logging as a new, separate follow-up item in this
   ledger (like the existing QUERY-COMBO-MEASURE/NMC-HYPONYM leads) rather
   than bundling into NON-ASCII-TEXT's close-out. The user/manager's call on
   priority.
6. **Scope of the CJK short-word length-filter relaxation** (tokenize.ts row
   9 / e4): a small, measurable tuning call in the same spirit as the
   already-settled TOKENIZE-PLURALS precedent — recommend C measure it
   against real data before shipping (same discipline, not a fresh
   permission), named here so it is not silently skipped or silently shipped
   unmeasured.

---

## Progress checklist

- [x] Task 1 — enumerated every split/filter/match step, file:line cited,
      proved by execution (15-row table + the separate word-boundary finding)
- [x] Task 2 — 5 constructed project texts measured through the real
      `compileSearchBrief`/`briefToSeedTexts`, plus challenge/seedTexts/
      negativeTopics/methods variants
- [x] Task 3 — options (a)-(e) with reader-outcome/cost/risk, recommendation given
- [x] Task 4 — tests enumerated, numbered POLICY list written, items 3-4
      explicitly named as the user's product/cost decisions

STATUS: COMPLETE
