STATUS: COMPLETE

# QUERY-COMBO-MEASURE — investigation (agent B)

Investigator: agent B, ABC loop. Read-only on every repo product file; designs and measures,
never edits product code, never decides policy (marked "POLICY — manager decides").

Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD `ea58c54e`. Measured against a
STABLE read-only extract of this HEAD (`git archive HEAD web/src`), not the live working tree,
because an implementer is editing `web/src/lib/scoring/keyword.ts` concurrently. Started
2026-09-30T15:35:33Z (`date -u`).

## Question

ABC-JEV-INTEGRATION.md §1az adopted "bare phrase before its own tag-anchored combination" (Tier 1
before Tier 1b) as a risk-averse default, on MIXED 2-fixture evidence: one combination measured
~4x its bare phrase's own qualify rate; one collapsed a 58-item pool to 1. Three items shipped
since then that change which phrases `phrasesFromText`/`compileSearchBrief` produce: QUERY-QUALITY
(§1ay, raw-paragraph-as-query fix + comma splitting), QUERY-GENERIC-WORDS (§1bs/§1bu.8, strips
years/units/decimals from single-word queries, dash/ellipsis delimiters), NON-ASCII-TEXT (§1bo,
CJK handling). Question: with today's phrases, should Tier 1b come before Tier 1? Flip only on
clear evidence.

## Plan

1. Extract HEAD read-only to `<scratchpad>/qcm-head` via `git archive`; adapt
   `<scratchpad>/pusf-hook.mjs` into `<scratchpad>/qcm-hook.mjs` pointing at that copy, so the
   REAL `compileSearchBrief`/`phrasesFromText` run unmodified, off product code.
2. Build 6 constructed/fictional reader profiles, each with exactly one Required tag (clean
   bare-vs-combo comparison, no multi-tag cap interaction): battery/solid-state electrolyte,
   catalysis, a biology topic, an ML topic, a run-on (no-comma) project text, and a verbatim reuse
   of the existing `BATTERY_PROJECT_TEXT`/"LCO" fixture (the "PhD research on..." stress case
   already on record in QUERY-BUDGET-B, §1az's own collapse-to-1 example) for direct continuity.
   Where the domain word would make the tag redundant with its own phrase, the tag is a more
   specific sub-term absent from the phrase verbatim (mirrors how fixture A's "LCO" and fixture
   B's "scRNA-seq" were both absent from their own project phrase) — stated per-profile below.
3. Zero network cost: run the real `compileSearchBrief` per profile, read `generatedQueries`, and
   derive (a) today's cap window per source (openalex/S2/arxiv=3, dblp/pubmed=2) and (b) the
   window under a probe-local post-hoc reorder that moves the Tier 1b combo ahead of Tier 1's bare
   phrases (pure reordering of the same strings, exactly as QUERY-BUDGET-B's own §2.1 did — never
   product code).
4. Live, ceiling 30 GETs total, OpenAlex (`https://api.openalex.org/works?search=...`, same
   filters/shape as `web/src/lib/sources/openalex.ts`'s real adapter — no key, no `mailto`) and
   arXiv's public API, spaced >= 1.5s apart (backing off further on any 429, stopping and
   recording BLOCKED on repeats): for each profile, one call for the bare phrase and one for the
   tag+phrase combo. Record in-window result count and judge the top 10 titles on-topic for the
   profile's Required tag.
   - **On-topic rule, stated before judging any result:** a title is on-topic if, read plainly, the
     paper is about the tagged material/system/method/phenomenon itself (or a direct component,
     application, or close synonym of it) — not merely a shared broad field. Ambiguous-from-title
     alone counts as on-topic only if the tag term or a same-referent synonym appears in the title;
     a title that is clearly about something else in the same general field (e.g. a different
     battery chemistry, a different cancer hallmark, a different ML architecture) counts as
     off-topic. Duplicate/near-duplicate titles in the same top 10 are each judged independently.
   - OpenAlex for all 6 profiles (12 calls); arXiv for a subset chosen for topical fit (ML,
     battery/solid-state electrolyte, run-on) to cross-validate (6 calls) — 18 planned, leaving
     budget headroom for retries within the 30 ceiling.
5. **Pre-set verdict rule (stated now, before any live result is read):** flip Tier 1b ahead of
   Tier 1 only if combinations win on-topic-top-10 in >= 5 of 6 profiles AND never collapse a pool
   below 5 results where the bare phrase had >= 20. Otherwise keep or mark inconclusive.
6. Write the exact change (if "flip"), or a protective test recommendation (if "keep"/
   "inconclusive"), the cache-version implication, severity in plain words, and the POLICY list.

This file is updated after each step; STATUS stays honest at every point; every timestamp below is
from `date -u`.

---

## 1. Setup log

`git archive HEAD web/src | tar -x -C <scratchpad>/qcm-head` (2026-09-30T15:39Z) — verified against
the live tree by grepping `PAPER_CACHE_KEY_VERSION` in both: 22 in each, so the extract is a
faithful HEAD snapshot untouched by the concurrent `keyword.ts` edit. `<scratchpad>/qcm-hook.mjs`
is `<scratchpad>/pusf-hook.mjs` with `WEB_SRC` repointed at `<scratchpad>/qcm-head/web/src`
(`NEXT_PKG` left at the real repo's `node_modules/next`, read-only, unused by this investigation's
import path). Ran via the exact invocation in the brief, from `<scratchpad>`.

## 2. The 6 profiles (constructed, fictional)

Every profile has exactly one Required tag (clean bare-vs-combo comparison; no multi-tag cap
interaction from §1az's R2 guarantee). Where the phrase and tag could trivially overlap, the tag
is a more specific sub-term absent from the phrase verbatim — the same separation fixture A
("LCO" / "PhD research on solid-state battery materials") and fixture B ("scRNA-seq" /
"Investigating single-cell transcriptomics...") already had in QUERY-BUDGET-B.

| # | Domain | Tag (Required) | Project text shape |
|---|---|---|---|
| P1 | Battery / solid-state electrolyte | `garnet electrolyte` | comma-shaped, real-abstract phrasing, 2 real phrases |
| P2 | Catalysis | `NiFe layered double hydroxide` | comma-shaped, real-abstract phrasing, 2 real phrases (2nd is the challenge's own literal query) |
| P3 | Biology (functional genomics) | `T-cell exhaustion` | comma-shaped, real-abstract phrasing, 2 real phrases |
| P4 | ML (molecular property prediction) | `few-shot molecular prediction` | comma-shaped, real-abstract phrasing, 2 real phrases |
| P5 | Energy systems, **run-on** (no commas, one long clause-chained sentence) | `grid-scale energy storage` | 0 real phrases by design — the stress case the ticket asks for |
| P6 | Battery / LCO, **"PhD research on…" opening** | `LCO` | verbatim reuse of `BATTERY_PROJECT_TEXT` (`profile-compiler.test.ts`) — the exact fixture behind §1az's collapse-to-1 finding |

Exact texts are in `<scratchpad>/qcm-1-briefs.mjs`. No person's name anywhere in any fixture.

## 3. Step 1 — zero network cost: real `compileSearchBrief`, today vs flipped

Method: called the real, unmodified `compileSearchBrief` (only `compileSearchBrief`/
`briefToSeedTexts` are exported from `profile-compiler.ts`; `phrasesFromText` is not), then
classified each entry of the REAL `generatedQueries` output — tag / bare phrase / the one
Tier-1b combo / bare word / extra Tier-3 combo — purely from the real strings (a phrase is
"combo-shaped" iff it starts with `"<tag> "`; the *first* combo-shaped entry in today's own order
is Tier 1b, matching `strongestPhrase = projectTerms[0]` being spent exactly once). "Flipped" =
the same real strings with the one Tier-1b entry moved to right after the tag, ahead of every
Tier-1 phrase — a pure permutation, never a reimplementation of `phrasesFromText`'s splitting
logic, same method QUERY-BUDGET-B's own probe used. Script: `<scratchpad>/qcm-1-briefs.mjs`, run
2026-09-30T15:41Z, exit 0, full output `<scratchpad>/qcm-1-out.json`.

| # | Today's cap=3 window (openalex/S2/arxiv) | Flipped cap=3 window | Today's cap=2 (dblp/pubmed) | Flipped cap=2 |
|---|---|---|---|---|
| P1 | tag, phrase1, phrase2 (**combo OUT**) | tag, **combo**, phrase1 (phrase2 out) | tag, phrase1 (**combo OUT**) | tag, **combo** (phrase1 out) |
| P2 | tag, phrase1, phrase2(challenge) (**combo OUT**) | tag, **combo**, phrase1 (phrase2 out) | tag, phrase1 (**combo OUT**) | tag, **combo** (phrase1 out) |
| P3 | tag, phrase1, phrase2 (**combo OUT**) | tag, **combo**, phrase1 (phrase2 out) | tag, phrase1 (**combo OUT**) | tag, **combo** (phrase1 out) |
| P4 | tag, phrase1, phrase2(challenge) (**combo OUT**) | tag, **combo**, phrase1 (phrase2 out) | tag, phrase1 (**combo OUT**) | tag, **combo** (phrase1 out) |
| P5 | tag, combo, word1 — **identical, today = flipped** (0 real phrases: nothing to reorder) | *(same as today)* | tag, combo — **identical** | *(same as today)* |
| P6 | tag, phrase1, combo — **same 3 items either order** (only 1 phrase exists, cap=3 fits all) | tag, combo, phrase1 (same set) | tag, phrase1 (**combo OUT**) | tag, **combo** (phrase1 out) |

**Reading this honestly before any live result:** for P1-P4, flipping changes what OpenAlex/
Semantic Scholar/arXiv actually receive (the combo enters, a second bare phrase — or the
challenge's own literal query, for P2/P4 — leaves) and, for every one of the 6 profiles, flipping
changes what dblp/pubmed receive (bare phrase OUT, combo IN) since only 2 slots exist and today's
order always spends them on {tag, bare phrase}. Two structural findings, from the real function,
that matter for the verdict regardless of any live result:
- **P5 (true run-on, 0 real phrases): the flip is structurally moot.** `phrasesFromText` produced
  no phrase at all (its single >10-word chunk with no comma/semicolon/colon break never clears the
  `<=10 words` filter), so `projectTerms[0]` — `strongestPhrase` — is itself a bare KEYWORD
  ("working"), not a phrase. Today's code already places this "combo" (really tag+keyword: `grid-
  scale energy storage working`) immediately after the tag, because there is no Tier-1 phrase to
  place it behind. Flipping Tier 1b ahead of Tier 1 changes nothing here — Tier 1 is empty in both
  orders. This profile therefore cannot supply a bare-phrase-vs-combo comparison at all (no bare
  phrase exists); it is excluded from the live tally below and from the pre-set rule's denominator
  (noted there, not silently dropped).
- **P6 (the known "PhD research on…" collapse fixture) no longer changes the openalex/S2/arxiv SET
  at cap=3** — only P6's order changes, not membership, because exactly 1 real phrase exists, so
  {tag, phrase, combo} = 3 items fill exactly 3 slots either way. This is new since QUERY-BUDGET-B:
  the shipped tiering already guarantees both the phrase AND the combo reach openalex/S2/arxiv for
  this fixture today. The flip only matters for this fixture at the 2-cap sources (dblp/pubmed).

## 4. Step 2 — live measurement

**Pre-set on-topic rule (restated verbatim from the plan, unchanged before reading any result):** a
title counts on-topic if, read plainly, the paper is about the tagged material/system/method/
phenomenon itself (or a direct component, application, or close synonym) — not merely a shared
broad field. Title-ambiguous cases count on-topic only if the tag term or a same-referent synonym
appears in the title; a title clearly about something else in the same general field counts
off-topic. Each of the top 10 is judged independently.

Live run: `<scratchpad>/qcm-2-live.mjs`, started 2026-09-30T15:42:33Z, finished
2026-09-30T15:50Z (allowing for two rounds of 30s/90s 429-backoff, seen on 2 of the 18 calls —
same anonymous-tier rate-limiting QUERY-BUDGET-B and QUERY-QUALITY-B both hit; both recovered,
neither call was ever marked BLOCKED). **18/18 calls completed, all HTTP 200, 0 BLOCKED.** Full
record: `<scratchpad>/qcm-2-live-out.json`. A separate, targeted follow-up (`<scratchpad>/
qcm-3-ids.mjs`, 2 calls: one 429 then one 200 after a 30s backoff) re-ran the single most
decision-critical query — P6's combo — once more, this time keeping the OpenAlex work id, so this
guide can cite that result properly (id + short title fragment) instead of a full title, per this
task's privacy rule; result unchanged (still exactly 1, same paper). **Total network calls this
investigation: 20 of the 30 ceiling** — stopped once the evidence was unambiguous under the pre-set
rule (§5) rather than spending the remaining budget on data that could not change the verdict.

**arXiv result, reported plainly because it is a real finding, not a bug in this probe:** all 6
arXiv calls (P1, P4, P6 bare and combo) returned **0 results** — `total: 0` from
`opensearch:totalResults`, both arms, every profile tried. Traced to `arxiv.ts`'s own
`buildQuery`: a single query becomes `(all:"<the whole phrase>")` — a QUOTED exact-phrase search
against arXiv's field index. A constructed, paraphrased project-text sentence essentially never
appears as an exact substring of any real paper's title/abstract/comment/category text, tag or no
tag — so this null result is **symmetric between bare and combo** (0 vs 0 every time) and supplies
**no comparative signal either way** for this item's question; excluded from the tally below.
Flagged as its own POLICY lead (§6) since it suggests arXiv's adapter may be getting near-zero
yield from any multi-word phrase query today, independent of tiering — outside this item's charter
to fix.

**On-topic judging (OpenAlex only, the only source with comparative signal), same rule applied to
every title in both arms of a pair, so the comparison is fair even where the absolute numbers run
low:**

| # | Tag | Bare phrase: total / on-topic-of-10 | Combo: total / on-topic-of-10 | Collapse check (bare>=20 -> combo<5?) |
|---|---|---|---|---|
| P1 | garnet electrolyte | 57 / **1** | 18 / **1** | no (18 >= 5) |
| P2 | NiFe layered double hydroxide | 17 / **1** | 7 / **1** (of 7 returned) | n/a (bare<20) |
| P3 | T-cell exhaustion | 1 / **0** | 1 / **0** | n/a (bare<20) |
| P4 | few-shot molecular prediction | 441 / **0** | 56 / **1** | no (56 >= 5) |
| P6 | LCO (reused fixture) | 59 / **0** | **1** / **0** | **YES — 59 to 1, VIOLATION** |
| P5 | grid-scale energy storage (bonus: tag-alone vs the tag+keyword "combo", no real bare phrase exists — see §3) | tag-alone 54 / **1** | combo-bonus 0 / n/a | bonus only, not tallied |

**Tally against the pre-set rule:** combo strictly beats bare (more on-topic in top 10) in **1 of 5**
valid comparison profiles (P4 only); ties in 3 (P1, P2, P3 — same count both arms); loses outright
on the collapse condition in 1 (P6, reproducing §1az's own "58/59 -> 1" finding almost exactly, a
day later, independently). P5 has no real bare phrase (§3's structural finding) and is excluded
from the denominator, not counted as a win either way — the strictest honest reading, since it
cannot supply a win.

**Beyond the pre-set count rule, reported as color, not as a rule override:** in P1 and P2, the
single on-topic hit both arms found is the SAME paper, but the combo ranks it higher (P1: position
9 of 10 bare -> position 3 of 10 combo; P2: position 5 of 10 bare -> position 1 of 7 combo) by
shrinking the pool around it. This is a real, mildly positive combo signal the raw "count in top
10" metric misses — noted for the manager, but the pre-set rule was stated before any result was
read specifically so a result like this could not retroactively loosen it, so it does not change
the tally above.

## 5. Verdict

**Pre-set rule (restated verbatim, unchanged since §Plan):** flip only if combinations win
on-topic-top-10 in >= 5 of 6 profiles AND never collapse a pool below 5 results where the bare
phrase had >= 20.

**Both conditions fail, clearly:**
- Win rate: 1 of 5 valid profiles (P4), far short of 5 of 6 (or, reading P5's structural
  non-applicability as strictly as possible in combo's favor, 1 of 5 is still far short of "all 5
  win").
- Collapse condition: **violated** — P6 (the reused, already-known "PhD research on…" fixture)
  collapsed a 59-result pool to 1 live today, independently reproducing §1az's original 58-to-1
  finding almost exactly, on fresh data, after QUERY-QUALITY/QUERY-GENERIC-WORDS/NON-ASCII-TEXT all
  shipped. The risk that justified the original risk-averse default is still live, today, not a
  stale artifact of the earlier 2-fixture measurement. The one survivor (OpenAlex id `W7214083402`,
  "Thermal Spray as a Scalable Alternative…") is about thin-film solid-state batteries generically —
  no LCO/lithium-cobalt-oxide mention — so it is also off-topic under this guide's own on-topic
  rule; the combo did not even trade breadth for precision here, it just lost almost everything.

**VERDICT: KEEP today's order (Tier 1 bare phrase before Tier 1b tag+phrase combo). Do not flip.**
Close QUERY-COMBO-MEASURE with this evidence recorded. This is a clean keep, not a borderline
inconclusive — neither half of the pre-set rule came close to being met, and the collapse half was
actively, freshly reproduced.

Two structural findings from §3 stand regardless of the live verdict and are worth the manager's
attention alongside it:
1. For a profile with exactly one real phrase (P6's shape), today's order already sends the SAME
   {tag, phrase, combo} set to openalex/S2/arxiv (cap=3) either way — the flip only matters there
   for dblp/pubmed (cap=2). The risk this item measured (and re-confirmed) is entirely about what
   happens when the combo is promoted at the COST of displacing something else, which is exactly
   dblp/pubmed's situation today for every profile shape measured (§3's table).
2. For a true run-on text with no comma-shaped phrase (P5's shape), Tier 1b silently degrades to
   "tag + strongest bare keyword" rather than "tag + phrase" — today's code does not guard against
   `strongestPhrase` being a single word. The order question is moot for this shape (§3), but
   whether that combo should exist at all is a separate question this item did not charter and does
   not answer (POLICY lead, §6).

## 6. Recommendation, tests, cache, severity, POLICY

**Recommendation: close QUERY-COMBO-MEASURE as KEEP, no product change.** Add one protective test
(C's, not written here) that pins today's order so a future change cannot silently flip it without
a red test:

- **Test:** a 1-tag profile with a project text producing >= 2 real comma-split phrases (e.g. this
  guide's P1/P2/P3/P4 shape, or a new fixture C constructs) — assert the cap=3 window
  (`generatedQueries.slice(0,3)`) is `[tag, phrase1, phrase2]` (the Tier-1b combo is NOT in the
  first 3), and the cap=2 window (`generatedQueries.slice(0,2)`) is `[tag, phrase1]` (the combo is
  NOT in the first 2). **Mutation it catches:** swapping the shipped order (moving the
  `topics.map((topic) => \`${topic} ${strongestPhrase}\`)` block ahead of `...phraseTerms` in
  `profile-compiler.ts`'s `baseQueries` assembly) turns this test red — the exact change this
  investigation recommends AGAINST making. A second mutation (removing the combo block entirely)
  should leave this specific test green (it only asserts what's absent from the front, not that the
  combo exists at all elsewhere in the list) — C should add a separate existing-coverage check for
  that if none currently exists.
- **Cache:** no product change, so **no `PAPER_CACHE_KEY_VERSION` bump** — stays at 22 (HEAD's
  current value; noted "+1 from the committed value" would apply only if this item shipped a
  change, which it does not).

**Severity, in plain words:** this is a close-the-loop finding, not a bug. The question was "should
we reorder two kinds of search query" — the answer is "no, keep the current order," and the
evidence for keeping it is now stronger (fresh, independent reproduction of the one failure mode
that mattered) than when the order was first chosen. Nothing is broken; nothing needs to change.

### POLICY — manager decides

1. **Close QUERY-COMBO-MEASURE as KEEP** (this guide's recommendation) — confirm, or ask for a
   larger follow-up measurement (more profiles/calls) if 20 calls' worth of evidence across 6
   profiles feels thin for a permanent close. This investigation's own read: the collapse condition
   failing on a fresh, independent reproduction of the exact original risk is strong enough
   evidence on its own, separate from the win-rate tally, that more profiles would be unlikely to
   change the direction.
2. **arXiv long-phrase queries returning 0 results, symmetric across bare/combo (§4):** a real,
   live-confirmed finding, out of this item's charter. Worth its own small follow-up if arXiv
   coverage matters to the product — today, for any project-text-derived multi-word phrase (tag or
   combo), arXiv's adapter is plausibly contributing near-zero papers regardless of this item's
   verdict.
3. **P5's structural finding (§3, §5.2):** `strongestPhrase` (and therefore the Tier-1b combo) can
   silently be a single bare keyword rather than a phrase when a reader's project text has no
   comma/semicolon/colon-shaped break under the 10-word cap. Whether the combo should be built at
   all in that case (vs. skipped, since there is no real phrase to anchor it to) is a separate
   question from tier ORDER and was not measured here. Lead only, not measured.
4. **The ranking-quality signal (§4's "beyond the pre-set rule" note):** in 2 of 5 valid profiles,
   the combo query ranked the one on-topic hit both arms found noticeably higher by shrinking the
   pool, even though it did not increase the on-topic COUNT in the top 10. Not part of this item's
   pre-set verdict (stated before results, deliberately not reopened after), but a real pattern
   worth a dedicated ranking-focused (not retrieval-count-focused) follow-up if the manager wants
   one — different question, different measurement design (would need pool-wide T4 scoring, not a
   single-query top-10 read, per QUERY-BUDGET-B's own noted limitation, §3.2 of that guide).

---

STATUS: COMPLETE — 2026-09-30T15:53Z. Verdict: KEEP today's order (no flip). 20 of 30 permitted
network calls used, 0 BLOCKED (one transient 429 on the id-lookup follow-up, resolved on retry
after a 30s backoff). No product file touched; no test written to the repo (recommended above for
C); no cache bump.
