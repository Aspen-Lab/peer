STATUS: COMPLETE

# TOKENIZE-PLURALS — B investigation guide

Role: B (investigator). Read-only on product code; this file (and one now-deleted
temporary probe under `web/src`) is my only write. Rulings this item answers to:
ABC-JEV-INTEGRATION.md §1ao point 5 ("tokenize plural-blindness: not in this item
... needs its own measurement") and its ADDENDUM ("2 genuine P1 papers lost to
plural-blindness stay with TOKENIZE-PLURALS"); §1ao POLICY 5 (the original open
question). Prior guide: docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md §2.3
(first documented the gap). Prior checkpoint: docs/jev-abc/REQUIRED-GATE-C-20260928T163436Z.md
§1 (named the 2 real papers, re-confirmed under anchored T4).

**Bottom line up front:** the codebase already has TWO separate, independent
"plural handlers." `term-expand.ts` (T1, literal Required-tag matching) already
folds plurals correctly for a single-word tag or the last word of a multi-word
tag — confirmed by real data: two of my four profiles show **zero** effect from
any tokenize.ts change, precisely because T1 already closes the gap for that tag
shape. `tokenize.ts` (the shared primitive behind TF-IDF similarity and the
SENSE-CONTEXT check) has no plural handling at all, and that gap is real,
measurable, narrow, and safe on every real fixture I could test it against: **+3
REQUIRED-GATE admissions** (2 clearly genuine, 1 debatable) on the profile the
user's own original example came from, **+1** on a second profile, **+15**
SENSE-CONTEXT papers rescued from an unwarranted ranking demotion across two
tags, and **zero** false positives on 150 real wrong-domain papers used as
negative controls. Full numbers and every paper that moved are in §3.

## 1. Path enumeration

Every consumer of `web/src/lib/scoring/tokenize.ts`'s exported `tokenize`/
`normalizePhrase`, found by grepping `web/src` for `tokenize|normalizePhrase`
(12 files matched; each read in full) plus a separate grep for
`from "@/lib/scoring"` (the barrel, to catch anything importing indirectly).

### 1.1 Real consumers (import `tokenize`/`normalizePhrase` from `./tokenize`)

- **`web/src/lib/scoring/tfidf.ts:2`** — `import { tokenize } from "./tokenize"`.
  Used in `itemDocText`→`buildIdf`/`termFrequency` (line 64, building the
  pool-wide index) and in `scoreTfidf` (line 81, tokenizing the query/profile
  text). **Not normalized for plurals today.** This is the TF-IDF cosine engine
  behind: (a) T4, the Required-gate similarity fallback (`combine.ts`'s
  `scoreTfidf(item.id, topic, index)` / `scoreTfidf(item.id, pText, index)`,
  lines 289–290), and (b) `topicality`/`tp` — the ranking signal EVERY scored
  item gets, Required-gate candidate or not (`combine.ts` line 321,
  `poolPercentile` line 329). This is the single biggest reason the task says
  "any change moves ranking globally."
- **`web/src/lib/scoring/keyword.ts:11`** — `import { tokenize } from "./tokenize"`.
  Used in `senseContextStripSet` (line 290, tokenizing each `expandTerm`
  variant + its hyphen-joined spelling) and `senseContextGate` (lines 384/386,
  tokenizing the item's own text and the reader's context text). **Not
  normalized for plurals today.** This is the SENSE-CONTEXT check (§1ap) that
  demotes — not drops — a short/ambiguous Required-tag match that disagrees
  with the reader's declared work. A plural mismatch here does not change
  admission (a demoted match still counts, at grounding 0.25 instead of full
  strength — `SENSE_CONTEXT_DEMOTED_GROUNDING`, keyword.ts:214) but does change
  **ranking**: `combine.ts`'s `fullyDemoted` flag (line 368) multiplies an
  item's whole blended score by 0.25 when every Required-tag match on it was
  demoted.
- **`web/src/lib/scoring/combine.ts:21`** — `import { normalizePhrase } from
  "./tokenize"`. Used in `topicMatchesItem` (line 120) and
  `isProtectedRequiredTopic` (line 128) — a **substring** check
  (`haystack.includes(needle)`), not a tokenizer, feeding `negativePenalty`
  (exclusions the reader marked "avoid"), `legacyDislikePenalty`, and the
  exclusions filter (line 195, `if (exclusions.some(...)) continue`).
  `normalizePhrase` only lowercases/trims/collapses whitespace — no stemming.
  **This is plural-blind too, and by construction cannot be fixed by folding
  `tokenize()`'s token stream**, since it never calls `tokenize()` — it is a
  raw substring test. Concretely: `"battery"` is not a substring of
  `"batteries"` (verified: b-a-t-t-e-r-y vs b-a-t-t-e-r-i-e-s diverge after
  "batter"), so a reader who excludes "battery" would not have that exclusion
  catch a paper that only ever says "batteries". This is a **separate, sibling
  gap** in a third mechanism, not fixable by any of the options in §2 below —
  flagged for the manager's POLICY list (§4), out of this item's scope to fix.
- **`web/src/lib/feed/rerank.ts:3`** — `import { tokenize } from
  "@/lib/scoring/tokenize"`. Used in `overlapScore` (lines 7–13, the Tier-1
  search-brief rerank's must/nice/question/method/avoid overlap scoring) and
  `topicKey` (lines 19–21, first-3-tokens key used by `diversify` to cap how
  many same-topic papers appear together). **Not normalized for plurals
  today.** Not the Required-gate; a different, later-stage rerank that only
  runs when a reader has an active search brief. Inherits whatever `tokenize()`
  becomes, automatically, with no code change needed there — **not separately
  measured in this investigation** (time-boxed to the task's named
  REQUIRED-GATE/SENSE-CONTEXT asks; flagged for the manager, §4 POLICY 6).
- **`web/src/lib/scoring/index.ts:2`** — barrel re-export only
  (`export { tokenize, normalizePhrase } from "./tokenize"`). The only thing
  imported through the barrel elsewhere in `web/src` is `scoreItems`
  (`web/src/lib/feed/pipeline.ts:11`), not `tokenize`/`normalizePhrase`
  directly — no additional hidden consumer.
- **`web/scripts/build-reference-idf.mjs:85–92`** — a **verbatim, hand-kept
  copy** of `tokenize.ts`'s `tokenize` (same STOPWORDS set, same regex, same
  filter), used to build `web/src/lib/scoring/reference-idf.json` offline from
  a real OpenAlex sample. Not an import (that file's own header explains why:
  no tsx/ts-node runner for `.mjs` scripts in this repo). **Kept honest by a
  drift tripwire**, `web/src/lib/scoring/reference-idf-build.test.ts`, which
  imports BOTH tokenizers and asserts byte-identical output on a fixed sample
  (lines 24–46 of that test). **Any edit to `tokenize.ts`'s tokenizer that
  isn't mirrored in the script breaks this test immediately** — this is the
  mechanism, not a risk I'm inferring; I read both copies and confirmed they
  are identical today.

### 1.2 Grep hits that are NOT real consumers (own private, same-named, unrelated function)

Read in full to confirm each has its own private `tokenize()`/`normalizePhrase`-shaped
helper that never imports from `./tokenize` — false positives from the grep,
listed so "12 files matched" doesn't read as 12 real consumers:

- `web/src/lib/figures/extract.ts:36` — own private `tokenize()` for figure-caption
  keyword matching (different alphabet-only regex, `[^a-z0-9]+`).
- `web/src/lib/affiliation/openalex.ts:203` — own private `tokenize()` for
  ranking a researcher's OpenAlex works by project-text relevance.
- `web/src/lib/papers/figure-binding.ts:528` — own private `tokenize()`, same
  figure-caption-matching family as `extract.ts`.
- `web/src/lib/scoring/review-policy.ts:36` — own private `tokenize()`
  (`isReviewLike`/`shouldPushReviewPaper`'s seed-overlap check). Also
  plural-blind, also a different, unrelated mechanism — noted for completeness,
  not in scope.
- `web/src/lib/scoring/reference-idf-build.test.ts` — imports **both** real
  tokenizers specifically to compare them (the drift tripwire itself, already
  covered in 1.1).

`web/src/lib/feed/senses.ts` (the sense-catalog matcher `resolveSenseEvidence`
uses for typed sense selections like "conflict"/"SEM") imports only
`canonicalize` from `term-expand.ts` — confirmed by reading its imports. **Zero
dependency on `tokenize.ts`**; entirely unaffected by anything in this guide.

### 1.3 Where T1 (`termMatches`/`expandTerm`) already handles plurals, and where it doesn't

`term-expand.ts` does **not** import `tokenize.ts` at all — it is a completely
separate mechanism with its own inflection logic (`singularize`, lines 84–97;
`inflectedForms`, lines 99–122; both private). This means **T1/T2/T3 admission
counts are structurally invariant to any `tokenize.ts` change** — confirmed
empirically in §3 (identical T1 counts in every world I measured).

What T1's own plural handling covers, read from the code:

- **A single-word tag**: `inflectedForms` operates on "the last (and only)
  word," so `expandTerm("electrolyte")` already returns
  `{"electrolyte","electrolytes"}` — both forms are tried. This is why P4
  ("electrolyte") and P-LCO ("LCO") show **zero** measured effect from any
  tokenize.ts option (§3.1) — T1 already closes the gap for this tag shape.
- **The LAST word of a multi-word tag**: same mechanism — `expandTerm("solid
  electrolyte")` includes `"solid electrolytes"` too.
- **What it does NOT cover**: a non-last word needing pluralizing (irrelevant
  here — Peer's Required tags are ordinary English noun phrases, plural marker
  on the head noun, which is last), and — the actual mechanism behind every
  real gap this investigation found — **the item's text simply not containing
  the tag's OTHER required words at all**, contiguous, in order. `termMatches`
  is a whole-phrase, contiguous, in-order match (term-expand.ts:160–170); no
  amount of last-word pluralizing makes `"solid-state battery electrolyte"`
  match a sentence that never says "battery." That's not a plural bug, it's T1
  being a literal-phrase matcher — which is exactly why the REQUIRED-GATE item
  gave these cases a similarity-based fallback (T4) instead, and T4 is where
  the real, measurable plural gap lives (tfidf.ts's `tokenize()`, unfolded).
- **A related, smaller, genuinely separate gap found while reading this code**
  (not this item's scope — `term-expand.ts`, not `tokenize.ts` — flagged for
  the manager, §4 POLICY 5): `IRREGULAR_INFLECTIONS` (term-expand.ts:75–82)
  hand-lists only `battery/matrix/analysis` and their plurals. Every OTHER
  "-sis" word (`synthesis`, `hypothesis`, `basis`, `diagnosis`, `thesis`,
  `crisis`, `emphasis`) falls through to the generic `/s$/` rule and gets a
  **wrong, nonsense variant** added (e.g. `inflectedForms("synthesis")` adds
  `"synthesi"`, not the true plural `"syntheses"`) — harmless (the nonsense
  variant just never matches anything) but means a Required tag whose last
  word is e.g. "synthesis" would NOT also match text saying "syntheses" via
  T1. I did not fix this — it's a different file, a different mechanism, and
  out of this item's assignment — but the task asked me to find exactly where
  T1 does and doesn't handle plurals, so it's recorded here rather than
  re-discovered later.

## 2. Options, with costs

All three options below were run for real (§3), not just theorized — path
enumeration alone doesn't tell you what actually flips, which is the whole
reason B ran a probe instead of just reading code.

### Option A — fold plurals inside `tokenize()` itself (global)

A light, rule-based fold applied to `tokenize()`'s output tokens (after
lowercasing/splitting/stopword-filtering, so it composes cleanly): an irregular
map checked first (mirroring `term-expand.ts`'s own shape), then suffix rules
(`-ies→y`, `-ches/-shes/-xes/-ses→` strip 2, plain `-s→` strip 1), gated by a
length guard (>4 chars) and a protected list. **This is the shape I built and
measured in §3** — full rule in §2.4.

**Blast radius**: every real consumer in §1.1 changes at once — the pool-wide
TF-IDF index (`buildIndex`), hence T4 admission AND `topicality`/`tp` ranking
for **every** scored item, not just Required-gate candidates; the
SENSE-CONTEXT gate; `rerank.ts`'s Tier-1 overlap scoring and topic
diversification; and the build script's tokenizer copy, which must be edited
in lockstep or `reference-idf-build.test.ts`'s drift tripwire fails
immediately (it is a byte-identical-output assertion, not a fuzzy one — I read
it, this is not a maybe).

**What `reference-idf.json`/its build script need**: `reference-idf.json`'s
17,489 keys were built from the OLD, unfolded tokenizer. My static census
(§3.4, no external calls — reads the committed table only) found **2,118 of
those keys would silently merge with another existing key** if queried with a
folded token (e.g. `"electrolytes"`'s weight becomes irrelevant; lookups land
on `"electrolyte"`'s existing, singular-only-sampled weight instead — a real
but graceful approximation, not a crash), and roughly 760 more folded forms
would not be a key at all and fall back to the table's existing
"unseen-token" default (`REFERENCE_IDF_MAX_WEIGHT`, keyword.ts:237–240 — an
existing, already-exercised code path, not a new one). **A correct rollout
needs the table rebuilt** with the SAME (new) tokenizer via `node
scripts/build-reference-idf.mjs` — ≤40 keyless OpenAlex calls, per that
script's own documented budget — but I did not do this in this investigation
(the task's standing constraint is no external calls); my SENSE-CONTEXT
measurement in §3.3 therefore ran against the CURRENT (stale-relative-to-a-
folded-tokenizer) table, which is the realistic worst case for a
ship-then-rebuild sequencing, and still showed zero false positives.

**Cache version**: same reasoning as REQUIRED-GATE §1ao.9 — this changes both
admission and ranking, so `PAPER_CACHE_KEY_VERSION`/`PAPER_POOL_KEY_PREFIX`
(`web/src/lib/opportunities/pool-cache.ts`, currently 7 after REQUIRED-GATE)
needs another bump so an old-rule cached pool is never served after this
ships, following the exact single-source-of-truth pattern REQUIRED-GATE-C
already built (`web/src/lib/opportunities/private-paper-cache.ts` imports the
same prefix constant).

**Risk of false merges**: real and nameable, not hypothetical — see §2.4 for
the exact list I protected against and one I found by making the mistake
myself (§2.4, the "-izes/-yzes" case). Structurally, THIS option's fold also
reaches `topicality`/`tp` — the ranking score every item gets — and I did
**not** measure whether that global reweighting shifts anyone's top-N rank
order for better or worse; I only measured admission (does a paper qualify at
all) and the SENSE-CONTEXT pass/fail boolean, both of which stayed clean. A
ranking-QUALITY pass is unmeasured and would be the natural next step before
trusting Option A's full blast radius, not just its admission safety.

### Option B — fold only at comparison points (tag vs. text), not the global index

Concretely: leave the pool-wide `buildIndex`/`topicality` signal exactly as
today (built from the real, unfolded `tokenize()`); build a **second,
parallel** folded index used only inside the Required-gate T4 check
(`combine.ts`'s `simTopic`/`simProject`), and swap the tokenizer used inside
`senseContextGate`'s two comparisons the same way. `reference-idf.json` — used
only inside `senseContextGate`, never inside `buildIndex` — sees the identical
staleness question as Option A for that ONE axis (its role in general ranking
doesn't exist, so there's nothing else to go stale there).

**Measured result: byte-for-byte identical admission and SENSE-CONTEXT numbers
to Option A, on every profile and every tag I tested (§3).** This is not a
coincidence I'm glossing over — I built it this way on purpose to isolate the
real difference between the two options, and confirmed it empirically rather
than assuming it. The two options differ **only** in blast radius: Option B
leaves `topicality`/`tp` (every scored item's ranking, Required-gate candidate
or not) and `rerank.ts` untouched, and needs no build-script/drift-tripwire
change at all (the shared `tokenize()` itself never changes).

**Cost**: real, different from Option A's cost — not simpler, just contained
differently. It requires new plumbing in TWO product files (`combine.ts` needs
to carry a second, folded index through the T4 loop instead of reusing the one
`buildIndex` already built for `topicality`; `keyword.ts`'s
`senseContextStripSet`/`senseContextGate` need a folded-tokenize call site
instead of `tokenize()` directly) rather than Option A's one change deep
inside `tokenize.ts` that every caller inherits automatically. Building a
second per-request index over a pool of dozens–low hundreds of items is not a
measurable runtime cost (my whole probe, building 2–3 such indices per profile
across 4 profiles, ran in well under half a second including test-harness
overhead) — the cost here is code surface and a second place the fold logic
must be kept in sync, not speed.

### Option C — do nothing beyond T1 (today's shipped behaviour)

This is literally my "baseline" world in every measurement in §3 — I didn't
need a separate run for it. Given §1.3's finding that T1 already fully closes
the plural gap for single-word and last-word-of-phrase tags, Option C's real
cost is narrow and now precisely known rather than assumed: on the four real
profiles measured, 3 REQUIRED-GATE admissions (2 clearly genuine, 1 debatable)
and 1 more genuine admission stay lost; 15 genuine papers across two tags stay
under an unwarranted SENSE-CONTEXT ranking demotion. Zero risk, zero
implementation cost, a known and now-quantified opportunity cost.

### 2.4 The fold rule I measured with, and how I bounded it

```
irregular map (battery→batteries, matrix→matrices, analysis→analyses, and a
  handful more in the same closed-list spirit as term-expand.ts's own)
protected word list (closed, not exhaustive — see below)
protected suffix guard: /(?:ics|sis|xis|itis|osis|opsis)$/
-ies → y            (only if length > 4)
-zzes → strip 2      (buzz-class: true double-consonant "-es")
-zes → strip 1        (analyze/synthesize/utilize-class: silent-e + "s" — see below)
-ches/-shes/-xes/-ses → strip 2
plain -s → strip 1   (only if length > 4, and not already "-ss")
```

**"Beware a closed list over an open class" — this bit me during the
investigation, not just in theory.** My first version of the rule folded
`"zes"` as one bucket (matching `term-expand.ts`'s own existing
`/(?:ch|sh|x|z)es$/` shape). Running it over the **committed**
`reference-idf.json`'s 17,489 real keys (§3.4's census, before I fixed it)
surfaced that it mis-stemmed every common science-writing verb in the
silent-e "-ize/-yze" family — `analyzes→analyz`, `optimizes→optimiz`,
`synthesizes→synthesiz`, `utilizes→utiliz`, `recognizes→recogniz`,
`characterizes→characteriz` — because a bare `zes$` rule can't distinguish
`"buzz"+"es"` (true double-consonant plural) from `"analyze"+"s"` (silent e,
just add s). I split the double-z case out before shipping the numbers in §3,
verified the fix against both families, and **re-ran the entire measurement
with the corrected rule — the REQUIRED-GATE/SENSE-CONTEXT numbers in §3 did
not move at all**, because the bug was a conservative UNDER-fold (it failed to
merge some inflections, it never created a false merge), not a false-positive
risk — but it is exactly the class of mistake the task asked me to be honest
about, and `term-expand.ts`'s own existing rule has the identical latent bug
today (low-stakes there, since a Required TAG is rarely a verb).

Other named risks, checked against this exact rule (not asserted from memory):
- `"physics"/"mathematics"/"kinetics"/"ceramics"/"electronics"/"optics"` —
  protected by the `-ics` suffix guard. Honest cost: this also protects the
  rarer genuine plural sense of the same spelling (e.g. "the ceramics were
  sintered" — plural of "a ceramic," an object) — English is ambiguous here
  even for a human without context; the guard trades a real but rarer
  false-fold risk for a rarer false-negative.
- `"species"` — would fold to the nonsense `"specy"` without protection
  (matches `/ies$/`); added to the explicit protected-word list after tracing
  it by hand.
- `"gas"/"gases"`, `"glass"/"glasses"` — the true plural folds correctly
  (`glasses→glass`, `gases→gas`, both verified); only the bare singular is
  protected (too short to trigger the length>4 guard anyway).
- Acronyms like `"SEMs"` (lowercased `"sems"` after `tokenize()`) — protected
  twice over: on the explicit list, and structurally too short (4 chars) to
  clear the length>4 guard even without the list entry. A longer acronym+s
  (5+ chars, e.g. a hypothetical "NASICONs") is NOT structurally protected by
  length alone and would fold — checked by hand, this specific case folds to
  the correct singular class name, not a false merge, but it is a real,
  open-ended risk class the manager should know isn't closed by the length
  guard for longer acronyms.
- Chemical formulas (`"LiCoO2"`-shaped tokens) are untouched structurally —
  they don't end in a plural-looking suffix, nothing to guard.

**This rule is explicitly a closed list over an open class, not a claim of
completeness.** I found one real bug in it myself by testing it against real
data instead of trusting the design; there is no guarantee it is the last one.
§4's test recommendation reflects that.

## 3. Measurement — through the real exported functions, on the saved real data

**Method**: one temporary probe, `web/src/lib/scoring/__tokenize_plurals_probe.test.ts`
(run via `npx vitest run` from `web/`, deleted immediately after use — it is
not in the working tree any more). It called the REAL exported `tokenize`,
`buildIndex`/`scoreTfidf`, `scoreKeyword`, `isShortOrAmbiguous`,
`senseContextGate`, `selfDeclaresDifferentSense`, `canonicalize`,
`termSpecificity`, `expandTerm`, `isGenericTerm`, and the real exported
`REQUIRED_TAG_*`/`SENSE_CONTEXT_*` constants, unmodified. Where a product
internal isn't exported (`tfidf.ts`'s `buildIdf`/`toTfidf`/cosine;
`keyword.ts`'s `senseContextStripSet`/`toReferenceVector`/overlap-coefficient),
I kept a verbatim, tokenizer-parameterized local port — the same justification
`build-reference-idf.mjs` already uses for its own tokenizer port. **Port
validation, done before trusting anything else**: the local port's output was
compared against the REAL exported `buildIndex`/`scoreTfidf`/`senseContextGate`
on the real (unfolded) tokenizer, over the P4 pool plus 40 sampled
item×tag `senseContextGate` calls — **max delta 0** (floating-point exact) in
both. Read from `<scratchpad>/tokenize-plurals-probe-results.json` (my
probe's saved output — kept in the scratchpad, not the repo).

Real saved data used (all under `<scratchpad>/out/`, produced by the earlier
REQUIRED-GATE/SENSE-CONTEXT investigations, read here verbatim, zero new
external calls): `raw-P1a.json`+`raw-P1b.json` (P1, deduped), `raw-P2.json`
(P2), `tagged-LCO.json` (P-LCO), `raw-P4.json` (P4), and, for SENSE-CONTEXT
negatives, `sc-neg-electrolyte-clinical-pubmed.json`,
`sc-neg-lco-openalex.json`, `sc-neg-solid-state-openalex.json`. "In window"
(ageDays ≤ 60, `staleAfterDays("week")`, confirmed by reading
`web/src/lib/feed/freshness.ts:26`) computed against the same reference
instant REQUIRED-GATE-B's own guide is timestamped with
(2026-09-28T16:05:42Z), so pool/inWindow counts are directly comparable to the
established table.

### 3.1 REQUIRED-GATE — P1/P2/P-LCO/P4, baseline vs. Option A vs. Option B

| Profile | Tags | Pool/inWindow | T1 (all worlds) | T4 baseline | T4 Option A | T4 Option B | Total baseline | Total A/B | Flips |
|---|---|---|---|---|---|---|---|---|---|
| P1 long tags | `solid-state battery electrolyte`, `sodium-ion battery cathode materials` | 30/27 | 4 | 13 | 16 | 16 | 17/27 | **20/27** | +3 |
| P2 short tag | `solid electrolyte` | 100/62 | 56 | 0 | 1 | 1 | 56/62 | **57/62** | +1 |
| P-LCO | `LCO` | 50/3 | 3 | 0 | 0 | 0 | 3/3 | 3/3 | 0 |
| P4 wrong-sense trap | `electrolyte` | 150/145 | 89* | 0 | 0 | 0 | 89/145 | 89/145 | 0 |

\* The established REQUIRED-GATE-C anchored number for P4's T1 was 91; my
baseline (today's HEAD, 57186e30) gets 89 on the identical saved pool. My
baseline for P1 (17/27) and P2 (56/62) reproduce REQUIRED-GATE-C's own
anchored numbers **exactly**, which is why I trust the harness; I ran a direct
diagnostic (`scoreKeyword` with vs. without the `senseContext` opt on the same
P4 pool) and got 89 either way, ruling out SENSE-CONTEXT as the cause. The
2-item drift most likely reflects ordinary codebase movement between
2026-09-28 (when REQUIRED-GATE ran) and today, across the several SENSE-CONTEXT
rounds and other items that landed in between — not a flaw in this method, and
not relevant to the before/after comparison either way, since both sides of
every comparison in this table were computed against the exact same, current
code.

**Option A and Option B produced byte-identical REQUIRED-GATE numbers on every
profile** — confirming §2's structural claim that they differ only in blast
radius (topicality ranking, reference-idf.json's role there), not in
Required-gate outcomes.

**Every paper that moved, and whether it's genuine** (P-LCO/P4: none moved):

- **P1 (+3)**:
  1. `openalex:W4416056717`, *"Microstructural insights into fast ion transport
     in solid electrolytes via multiscale modeling"* — **genuine**. Says
     "electrolytes" (plural) only; the tag says "electrolyte" (singular).
     `simTopic` 0 → 0.063, `simProject` → 0.095, clears the anchored floor.
     This is one of the two papers REQUIRED-GATE-C's ADDENDUM named.
  2. `openalex:W7197006276`, *"Raman Signatures of Lithium Ion Dynamics in
     LLZO Garnet Electrolytes: Atomistic Insights from MD-Raman
     Calculations"* — **genuine**. Same mechanism (title says
     "Electrolytes"). The second paper REQUIRED-GATE-C named.
  3. `openalex:W7201986330`, *"Ionic Liquid Electrolytes for Extreme
     Temperature Conditions: Challenges and Perspective"* — **debatable**,
     reported honestly rather than rounded in: this is the SAME item
     REQUIRED-GATE-C's own report flagged as "debatable liquid-vs-solid
     relevance" when discussing anchoring's cost. It flips under folding for
     the identical plural-mismatch reason as the other two, and I'm not
     resolving the domain-relevance judgment call here — just reporting that
     it's the same paper, independently re-found.
- **P2 (+1)**: `openalex:W7203555874`, *"Propelling metal sulfide cathodes
  toward all‑solid‑state batteries: Insights and advances"* — **genuine**
  (a solid-state-battery cathode paper), but worth being precise about the
  mechanism: this item has no abstract and no tags (title only), and its
  title never contains the word "electrolyte" in any form. The flip is NOT a
  direct tag-word match — it comes from `simProject` (cosine against the tag
  **plus** the reader's longer project text) crossing the floor because the
  item's "cathodes"/"batteries" tokens now share a dimension with the project
  text's "cathode"/"battery" mentions, plus a smaller diffuse shift from
  corpus-wide IDF reweighting (folding changes document-frequency counts for
  many tokens across the whole 100-item pool at once, not just the tag's own
  word). **This is a real, named cost of Option A/B, not just an upside**:
  under a global (or pool-wide, for the gate) fold, some flips are explained
  by the tag's own word gaining an overlap (the P1 cases), and some are a
  step removed — driven by shared vocabulary elsewhere in the comparison
  text, nudged by a corpus-wide reweighting that is harder to audit
  per-item than "this paper now says the tag's word."

### 3.2 SENSE-CONTEXT — per-tag pass/fail, baseline vs. folded

Only tags where `isShortOrAmbiguous` is true go through this gate at all
(confirmed: true for all three tags tested; P1's two long tags never reach
this gate, by design — see keyword.ts:242–259's own reasoning, unchanged by
this item). Positives = the real battery-domain pools already used above (in
window); negatives = the real wrong-domain pools saved earlier
(`sc-neg-*.json`, 50 each). Context text = the same project-text fixture
REQUIRED-GATE used.

| Tag | Positives pass, baseline | Positives pass, folded | Negatives pass, baseline | Negatives pass, folded |
|---|---|---|---|---|
| `electrolyte` | 57/145 | **69/145** (+12) | 0/50 | 0/50 |
| `LCO` | 2/3 | 2/3 (+0) | 0/50 | 0/50 |
| `solid state` | 51/62 | **54/62** (+3) | 0/50 | 0/50 |

**Zero negative flips on any tag** — none of the 150 real wrong-domain papers
(50 clinical "electrolyte imbalance"-shaped, 50 physics "valence-bond solid
state"-shaped, 50 light-cycle-oil "LCO"-shaped) started passing the context
gate under folding. This is the key safety finding for SENSE-CONTEXT
specifically: folding plurals did not measurably weaken the one mechanism this
codebase has for keeping a wrong-domain literal hit out.

A "pass" here means a match escapes the ×0.25 ranking demotion — it does NOT
change REQUIRED-GATE admission (§1.1's point about demotion vs. drop), so
these +12/+3 papers were already qualifying and visible today, just ranked far
lower than their actual relevance warrants.

**Every `electrolyte` positive flip** (12 papers; two are the same paper from
two sources, `openalex:W7203493877` / `pubmed:42612502`, a known
cross-source-duplicate shape unrelated to this item):

1. "Anti‑freezing cyclodextrin‑modified cellulose eutectic hydrogel
   electrolytes for ultralong cycling low‑temperature zinc‑ion batteries" —
   genuine.
2. "Design of a full-solid-waste cementitious material using electrolytic
   manganese residue as a sulfate activator" — **debatable**, flagged
   honestly rather than rounded in: baseline similarity was exactly 0
   (shared essentially no vocabulary with the reader's context at all); this
   is a cement/construction-materials paper whose only connection is that its
   waste feedstock comes from manganese electrolysis, not a battery paper
   itself. Of the twelve, this is the one I would NOT call a clean win.
3. "Succinic anhydride as a bifunctional electrolyte additive enabling
   self-purification and dual-interphase stabilization in high-energy
   lithium-ion batteries" — genuine.
4/7. "Carbon quantum dot-induced electrolyte structuring regulates Zn
   nucleation and Zn(100) texture evolution in aqueous zinc metal batteries"
   (OpenAlex + PubMed copies) — genuine.
5. "Constructing a mechanically robust and polysulfide-trapping aloe-based
   binder ... lithium-sulfur batteries" — genuine.
6. "Synergistic vacancy engineering and phosphorus doping in FeS to
   accelerate sulfur reduction kinetics in lithium-sulfur batteries" —
   genuine.
8. "A kinetic model of electron transfer at the electrode-electrolyte
   interface: Statistical mechanics and electrochemical aspects" — genuine.
9. "Simulation of a Battery Cell on Quantum Computers: Reactions &
   Transport" — genuine.
10. "Disentangling Surface Charge and Electrolyte Effects on Interfacial
    Water at Electrified Pt(111)" — genuine (electrochemistry).
11. "Vibrational, structural, and chemical fingerprints of ion diffusion in
    crystalline solids" — genuine but generic; plausibly relevant (ion
    diffusion in solids), not centrally about electrolytes by title alone.
12. "Voltage-Controlled Phosphate Precipitation Gating in Solid-State
    Nanopore Memristors" — **debatable**, a memristor/nanopore paper only
    loosely adjacent to battery electrolytes via shared "solid-state"/
    materials vocabulary.

Net: **9–10 of 12 clearly genuine, 2 debatable** — reported without rounding
either direction, matching how REQUIRED-GATE-C reported its own comparable
cases.

**Every `solid state` positive flip** (3 papers, all clearly genuine):
"Sequence Decomposition Constructs Dual‑Layer Solid Electrolyte Interphase";
"MXene-enabled interface engineering of alloy-type anodes for high
performance lithium-ion batteries: Progress, mechanisms, and future
perspectives"; "Volatilization of Na₂O and Its Impact on the Processing of
Solid Electrolytes."

### 3.3 Why T1/T2/T3 counts never move

Confirmed empirically, not just argued from §1.3: the T1 column in §3.1 is
identical across baseline/Option A/Option B for all four profiles, because
(as traced in §1.3) `term-expand.ts` never imports `tokenize.ts`. T2/T3 ride
on the same `termMatches` primitive as T1 (keyword.ts's
`matchesSelfDeclaredAbbreviation`/`matchesSourceTag`), so the same invariance
holds for them (and REQUIRED-GATE already separately measured T2adds=T3adds=0
on all four profiles for a different reason — see REQUIRED-GATE-C's own
FINDING section).

### 3.4 `reference-idf.json` static fold-collision census (no external calls)

Read the **committed** table directly (17,489 keys) and applied the §2.4 fold
rule to every key, counting how many would land on a DIFFERENT existing or
new key:

- **2,881 of 17,489 keys (16%)** would change identity under the fold.
- **2,118 of those** would land on a form that is ALREADY a separate key in
  the table today — i.e. folding would silently merge two existing entries
  (e.g. `"electrolytes"`'s own sampled weight becomes moot; a folded query
  lands on `"electrolyte"`'s existing, singular-only-sampled weight instead).
- The remaining **~760** would produce a folded form that is not a key at all
  — these already fall back to the table's documented unseen-token default
  (`REFERENCE_IDF_MAX_WEIGHT`) today for any query token the table never saw,
  so this is an existing, already-exercised code path, not a new failure
  mode — just a larger share of lookups using the approximation than before a
  rebuild.

This is the concrete number behind §2's "what does the table need" cost for
both Option A and Option B's SENSE-CONTEXT axis.

## 4. Recommendation, tests for C, and POLICY

### 4.1 Recommendation

Ship **Option B's scope** (fold only at the Required-gate T4 comparison and
the SENSE-CONTEXT comparison) rather than Option A's global fold, **for a
first change** — because §3 measured them as delivering byte-identical
benefit on every real fixture tested, while Option A additionally changes
`topicality`/`tp` (the ranking signal every scored item gets) and
`rerank.ts`'s overlap scoring, neither of which this investigation measured
for ranking-quality impact (only admission-safety, and only indirectly, via
the same fixtures). A global fold is not shown to be unsafe — it's shown to
be **unmeasured** beyond what Option B already covers, and the task's own
framing ("any change moves ranking globally — so measurement comes first")
argues for shipping the contained, fully-measured version first and treating
Option A's extra reach as a follow-up with its own ranking-quality
measurement, not a reason to hold back the measured, narrow win. This is my
recommendation, not a ruling — §4.3 lists it as a POLICY call because the
manager may weigh Option A's much simpler implementation (one change in
`tokenize.ts`, inherited everywhere) differently against its larger unmeasured
surface.

Either option: the opportunity cost of shipping neither (Option C) is now
precisely known rather than assumed — 3 admissions (2 clean, 1 debatable) + 1
admission + 15 demotion-rescues (12–13 clean, 2 debatable) across the four
real profiles measured, zero measured false-positive cost on 150 real
negative-control papers.

### 4.2 Tests for C

1. **TF-IDF-level regression, real-data-grounded**: short excerpts of
   `openalex:W4416056717`/`W7197006276` (the two named papers) against tag
   `"solid-state battery electrolyte"` — assert `simTopic`/`simProject` clear
   the anchored floor after the fix where they were exactly 0 before
   (mirrors `required-gate.test.ts`'s existing fixture idiom).
2. **Protected-word regression, one test per named risk**: `"physics"` must
   not fold toward `"physic"`; `"species"` must not fold toward `"specy"`;
   `"sems"`/short acronym+s forms must not fold; `"gases"`/`"glasses"` MUST
   still fold correctly (a protected list that over-protects is its own
   silent regression) — assert both directions, not just the guard.
3. **The "-izes/-yzes" regression I found and fixed mid-investigation**:
   `"analyzes"→"analyze"`, `"optimizes"→"optimize"`,
   `"characterizes"→"characterize"` must NOT produce the broken fragment
   (`"analyz"`, `"optimiz"`, `"characteriz"`) a naive `zes$` rule produces —
   this is a real bug I made and caught, not a hypothetical, and deserves a
   named regression test so it can't silently come back.
4. **SENSE-CONTEXT regression, real fixture**: one of the §3.2 genuine
   `electrolyte` flips (e.g. the zinc-ion hydrogel electrolyte paper) demoted
   at baseline, passing after the fix; paired with a real negative fixture
   from `sc-neg-electrolyte-clinical-pubmed.json` (e.g. "Electrolyte
   disorders related emergencies in children") that must STILL fail after
   the fix — the paired positive/negative shape is the actual safety
   invariant, not the positive alone.
5. **Drift tripwire, mandatory, not optional**: whichever option ships,
   `build-reference-idf.mjs`'s tokenizer port (lines 85–92) must be edited to
   match `tokenize.ts` byte-for-byte (Option A) — or, if Option B ships,
   confirm `reference-idf-build.test.ts` still passes unmodified (Option B
   never changes `tokenize.ts` itself, only comparison-time call sites, so
   the shared tokenizer and its port stay identical and the tripwire is
   inert) — either way this needs an explicit check, not an assumption.
6. **Cache version bump**: mirror REQUIRED-GATE-C's own pattern exactly —
   bump `PAPER_CACHE_KEY_VERSION`/`PAPER_POOL_KEY_PREFIX` (currently 7) to 8,
   update the same cluster of files REQUIRED-GATE-C touched
   (`private-paper-cache.ts` + the 3 test files that assert the literal
   version), so an old-rule cached pool is never served after this ships.
7. **Invariant**: T1/T2/T3 admission counts on the EXISTING test suite
   (`term-expand.test.ts`, `admission.test.ts`, `ranking.test.ts`,
   `required-gate.test.ts`) must stay byte-for-byte unchanged — confirmed
   structurally possible in §3.3 and should be asserted by simply running
   that suite unmodified as a gate, the same discipline REQUIRED-GATE and
   SENSE-CONTEXT both used.

### 4.3 POLICY — manager decides

1. **Option A vs. Option B vs. Option C** (§4.1 is my recommendation, not a
   ruling) — the real tradeoff is Option A's simplicity (one change,
   inherited everywhere) against its larger, partly-unmeasured surface
   (`topicality` ranking for every item, `rerank.ts`), versus Option B's
   contained, fully-measured-identical benefit at a real (small)
   implementation-complexity cost (a second parallel index threaded through
   two files).
2. **Whether `reference-idf.json` is rebuilt in the same change** (≤40 fresh
   keyless OpenAlex calls) or deferred. My SENSE-CONTEXT measurement (§3.2)
   already ran against the stale-relative-to-folding table and found zero
   false positives, so deferring is defensible, not blocking — but it is a
   real scheduling decision, not mine to make.
3. **Whether the §2.4 fold rule ships as-is or gets a larger validation pass
   first.** It is a closed list over an open class by explicit design; I
   found and fixed one real bug in it myself via the reference-idf census
   (§2.4) — evidence more may exist, not proof the rest is clean. The
   manager may want C to re-run that same census-style check as a pre-ship
   gate.
4. **Whether to unify this new fold logic with `term-expand.ts`'s existing,
   separate `singularize`/`inflectedForms`** (shared irregular/protected
   lists) rather than maintaining two independent plural-handling
   implementations that can drift apart — a real refactor-scope question,
   not resolved here.
5. **The separate, smaller `term-expand.ts` gap found in §1.3** (the
   "-sis" class: only `battery`/`matrix`/`analysis` are irregular-mapped;
   `synthesis`/`hypothesis`/`basis`/`diagnosis`/etc. are not) — a different
   file, arguably its own tiny follow-up item, not this one's scope.
6. **`rerank.ts`'s Tier-1 overlap scoring and topic diversification** — not
   separately measured here (time-boxed to the task's named
   REQUIRED-GATE/SENSE-CONTEXT asks); it inherits whichever option ships
   automatically, with no code change of its own needed, but its ranking
   behaviour would shift too and hasn't had its own quality check.
7. **The `combine.ts`/`normalizePhrase`-based exclusion/negative-topic
   substring match (§1.1)** is plural-blind for a DIFFERENT, structural
   reason (it's a substring test, never calls `tokenize()`) and is not fixed
   by any option in §2 — whether it's worth its own follow-up item is a
   separate call.
8. **Cache version bump to 8** (§4.2 point 6) — near-certain yes if A or B
   ships, listed so it's a decision on record rather than assumed silently.

STATUS: COMPLETE
