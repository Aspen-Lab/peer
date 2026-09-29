# LIVE-EVAL-4-LABELS — A (measurer) checkpoint: S2-vs-OpenAlex relevance from the user's labels

STATUS: MEASURED

Branch: `Jev-integration-and-sorting-filtering-enhancement`. Fresh agent, pure offline computation —
no network call, no dev server touched, no repo file other than this one written/edited.

Source data (all in the gitignored run folder, never committed):
`web/output/live-eval/20260925T055826Z/{labels.json, blinded-sheet.json, blinded-sheet-key.json,
label-sheet.md, summary.json, starter-*.json ×6, battery-materials-profile.json}`.

Labels: the user's chat reply on 2026-09-27, already transcribed into `labels.json` by the manager
— 32 `relevant`, 8 `not_relevant` (items 06, 17, 22, 24, 31, 34, 35, 36), no blank/`unsure` answers.

## 0. Row-to-item mapping — verified, not assumed

Wrote a script (`computeḍjson` below) that parsed every numbered line of `label-sheet.md` and
compared it, index by index, against `blinded-sheet.json`'s `rows[]` array (matching `itemId`,
the DOI substring when present, and a title fragment). **All 40 rows matched `row N = item-NN`
exactly, zero mismatches.** `labels.json` is keyed by `item-NN` directly, so this is the mapping
actually used throughout.

## Method — what was literally computed, and how it relates to the pipeline's own functions

- **`ingestLabels` (blinded-sheet.ts):** reimplemented by hand, not imported (avoided fighting
  `@/...` path aliases in a throwaway script) — but it is a direct, line-for-line port: `relevant`
  → true/1, `not_relevant` → false/0, anything else → `unlabeledItemIds`. Since all 40 items have a
  real answer, `unlabeledItemIds` is empty and every one of the 40 canonical keys gets a label.
- **`compareChannels`'s `RelevanceBreakdown`/role logic (channel-comparison.ts):** NOT called
  directly. `compareChannels` runs once **per input**, and its relevance breakdown is scoped to
  that one input's own works. Our human-labeled sample is a **blinded pool sampled across all 7
  inputs at once** (`runner.ts`'s `allWorks` is a flat concatenation of each input's
  `comparison.works[]`, confirmed by reading it — see below), so running `compareChannels` per
  input would split the 40 labels into 7 tiny, mostly-empty groups (one input gets exactly 1
  labeled item) instead of the single pooled keyword/seed comparison the task asks for. Instead,
  I computed the **same definitions** `RelevanceBreakdown` uses (S2-only / OpenAlex-only / both /
  union / gain-over-each-side), by the same set arithmetic, directly over the pooled 40-item
  labeled sample. Said plainly here rather than left implicit.
- **`precisionAtK` / `recallInJudgedSet` / `computeChannelMetrics` (metrics.ts /
  blinded-sheet.ts):** NOT called. Both are rank-cutoff metrics for **one ranked list per
  channel per project**. A channel here has up to 7 different ranked lists (one per input/query),
  and only a handful of any one channel's items are in the 40-item labeled sample — there is no
  single coherent "top 10" across 7 unrelated queries to truncate to, so calling `precisionAtK`
  would require an arbitrary, misleading choice of whose ranking to use. Instead I computed the
  **unranked** "precision within the judged set" the task itself asks for: `relevant / judged` per
  channel, membership-only (did this channel surface this exact work, yes/no — order doesn't
  matter). I additionally report each channel's **share of all 32 relevant items** (relevant found
  by that channel ÷ 32 total relevant) — mathematically identical to what `recallInJudgedSet` would
  return with no `k` cutoff, so no ranking assumption is smuggled in either.
- **Channel → role map** (keyword/seed/semantic/topic/citation) was read directly from each input
  file's own `comparison.perChannel[].role`, not hardcoded, and was identical across all 7 inputs.
- **Which channel(s) found a given labeled item:** for each of the 40 canonical keys
  (`blinded-sheet-key.json`), searched **all 7 inputs' own `comparison.works[]`** for a matching
  `key` string and took the **union** of `channels` across every input where it appeared. This is
  necessary (not optional) because `buildBlindedSheet` samples from a flat, cross-input pool without
  re-clustering — the same real paper can appear as two separate `WorkEntry` objects (one per
  input) sharing the identical string key when it has a DOI/OpenAlex/S2/arXiv id, and the sheet
  itself never records which input's copy was actually drawn. Cross-check: this method reproduces
  `LIVE-EVAL-4-FIX-A-20260925T055351Z.md`'s own topic-tagging **exactly** — 39 of 40 items resolved
  to exactly one input, 1 item (item-03) resolved to two (`starter-machine-learning` +
  `starter-materials-science`), matching that checkpoint's own count precisely, via a completely
  independent script.

Full computed data: `computed.json` in this agent's scratch folder (not part of the repo).

## 1. Per channel — judged, relevant, precision within the judged set

| Channel | Role | Judged | Relevant | Precision | Share of all 32 relevant |
|---|---|---:|---:|---:|---:|
| s2-keyword | keyword | 15 | 15 | **1.000** | 0.469 |
| openalex-keyword | keyword | 18 | 14 | 0.778 | 0.438 |
| openalex-semantic | semantic | 14 | 12 | 0.857 | 0.375 |
| openalex-topic | topic | 7 | 6 | 0.857 | 0.188 |
| openalex-citations | citation | 4 | 2 | 0.500 | 0.063 |
| s2-seed | seed | 4 | 3 | 0.750 | 0.094 |
| openalex-seed-similarity | seed | 0 | 0 | n/a — no data | 0.000 |

`openalex-seed-similarity` judged=0 because it **failed both its attempts this run** (client-side
timeout, not a 429 — per `LIVE-EVAL-4-FIX-A-20260925T055351Z.md`), so it contributed zero works to
the pool it could have been sampled from. This is a data gap, not a quality finding.

Per-channel counts are **not a partition** of the 40 items: 16 of the 40 were surfaced by more than
one channel (list in §3), so the judged column sums to 62, not 40.

### Per role — S2-only / OpenAlex-only / both, and union gain (keyword; seed)

**Keyword role** (`s2-keyword` vs `openalex-keyword`; 24 of the 40 items were found by at least one
of the two):

| | Judged | Relevant |
|---|---:|---:|
| S2-only | 6 | 6 |
| OpenAlex-only | 9 | 5 |
| Both | 9 | 9 |
| **Union (either side)** | 24 | **20** |

- Using only `s2-keyword`, you'd get 15 of the 20 union-relevant works, **missing the 5
  OpenAlex-only relevant ones** (gain from adding OpenAlex: +5, +33% over S2 alone).
- Using only `openalex-keyword`, you'd get 14 of the 20, **missing the 6 S2-only relevant ones**
  (gain from adding S2: +6, +43% over OpenAlex alone).
- Reading this honestly: the two keyword channels are complementary, not redundant, in this sample
  — neither one contains the other's relevant works.

**Seed role** (`s2-seed` vs `openalex-seed-similarity`) — **no two-sided comparison possible**:
only `s2-seed` produced any data (4 judged, 3 relevant); `openalex-seed-similarity` judged=0 (failed
both attempts, see above). Reporting `s2-seed` alone: judged 4, relevant 3, precision 0.750. Not
enough data to say anything about OpenAlex's seed-similarity channel this run, and nothing at all
about "S2 vs OpenAlex" for the seed role — this mirrors `LIVE-EVAL-4-FIX-A`'s own finding
("no side-by-side comparison possible this run") exactly.

**Semantic, topic, citation roles have no S2 counterpart channel at all** (structurally single-
sided, not a failure like seed's OpenAlex side) — S2 never ran a semantic/topic/citation call in
this harness, so there is nothing to compare those three against. Their standalone judged/relevant/
precision numbers are in the §1 table above.

## 2. Per input — judged, relevant (so battery-materials can be read on its own)

| Input | Judged | Relevant | Precision |
|---|---:|---:|---:|
| starter-machine-learning | 7 | 7 | 1.000 |
| starter-neuroscience | 3 | 3 | 1.000 |
| starter-molecular-biology | 6 | 5 | 0.833 |
| starter-materials-science | 5 | 4 | 0.800 |
| starter-climate-science | 1 | 1 | 1.000 |
| starter-quantum-computing | 5 | 3 | 0.600 |
| **battery-materials-profile** | **14** | **10** | **0.714** |

Row sum is 41, not 40 — item-03 is counted under both `starter-machine-learning` and
`starter-materials-science` (see §3). `battery-materials-profile` — the user's own field — got the
most judged rows (14 of 40) by far, and the lowest precision of any input with more than 1 judged
row (0.714): 4 of its 14 sampled works were marked not relevant (items 06, 17, 24, 35), against 0-1
misses everywhere else. `starter-climate-science` has only 1 judged row — not enough data to say
anything about that topic specifically.

## 3. Caveats — read before trusting any number above

- **Small, single-run sample.** 40 human-judged items total, one run, no repeat/no cross-validation.
  At n=4 (s2-seed, openalex-citations) a single different label swings precision by 25 points; at
  n=0 (openalex-seed-similarity) there is nothing to measure at all. Treat every precision figure
  above as "consistent with," never "proven to be."
- **The sampling scheme is stratified by channel-signature, not by input or by relevance**
  (`blinded-sheet.ts`'s `buildBlindedSheet`: works are bucketed by the exact sorted set of channels
  that found them, then sampled round-robin across buckets, then the sample order is reshuffled).
  It does NOT stratify by input, so representation across the 7 inputs in the 40-item sample is
  uneven and driven by how many distinct channel-combinations each input's run produced — NOT by
  topic importance. `battery-materials-profile` ran 7 channels across 2 topics (183 of the 610
  total pooled candidate works, ~30%) while every "starter" input ran only 4 channels (66-77 works
  each); that mechanical fact, not any relevance signal, is most of why battery-materials supplied
  14 of the 40 labeled rows. Precision-per-channel is not similarly biased (bucketing is
  relevance-blind), but sample SIZE per channel/role/input is very uneven and small.
- **16 of the 40 items were found by more than one channel** (all relevant except two): item-03
  (openalex-keyword, openalex-semantic, s2-keyword), item-04 (same three), item-05 (openalex-keyword,
  openalex-semantic), item-09 (openalex-topic, s2-keyword), item-11 (openalex-keyword, s2-keyword),
  item-14 (openalex-semantic, s2-keyword), item-15 (openalex-keyword, s2-keyword), item-16
  (openalex-keyword, openalex-semantic), item-19 (openalex-keyword, s2-keyword), item-21
  (openalex-keyword, openalex-semantic), item-27 (openalex-keyword, openalex-semantic, s2-keyword),
  item-28 (all four keyword/semantic/topic channels bar s2-seed side), item-30 (openalex-keyword,
  s2-keyword), item-34 (**not relevant**: openalex-keyword, openalex-semantic), item-36 (**not
  relevant**: openalex-keyword, openalex-topic), item-37 (openalex-keyword, openalex-semantic,
  s2-keyword). Each such item counts toward every contributing channel's judged/relevant tally, so
  channel rows overlap rather than partition the 40.
- **One item spans two inputs.** item-03 ("Machine learning for molecular and materials science")
  was independently surfaced by both `starter-machine-learning` (found there only by `s2-keyword`)
  and `starter-materials-science` (found there by `openalex-keyword`, `openalex-semantic`, AND
  `s2-keyword`) — two distinct queries turning up the same real paper. The channel/role tables
  above use the union of channels across both appearances; the per-input table (§2) counts it under
  both inputs, which is why that column sums to 41.
- **9 of the 40 items have no DOI** (item-04, 06, 07, 09, 15, 27, 31, 34, 38) and are keyed by an
  OpenAlex work id, an S2 paper id, or an arXiv id instead. This is an identifier-availability fact
  only — it does not correlate with relevance in any direction worth reporting at this sample size.
- **No rank/order was used anywhere in this report** (see Method) — so rank ties are not applicable
  to anything computed here.
- **This measures precision only** — never recall against the full universe of relevant papers that
  exist (only "recall within this judged sample," reported as "share of all 32 relevant items"), and
  never nDCG (explicitly out of scope for this item per `ABC-JEV-INTEGRATION.md` §1w P5).
- **Not enough data to say**, plainly: whether OpenAlex's seed-similarity channel is any good at all
  (0 judged); which channel is "better" for the seed role overall (only one side has any data);
  whether battery-materials' lower precision reflects the channels, the query, or just this one
  draw of 14 items; or whether any single-topic input's 100% precision (machine-learning,
  neuroscience, climate-science) would hold up on more data (climate-science's "100%" is 1 item).

## 4. Plain-language summary

The user checked 40 sample papers by hand and said which ones actually fit what they're researching
— 32 were good matches, 8 weren't. Two things stood out. First, when both search engines were asked
the same plain keyword question, Semantic Scholar's answers were all good in this small batch (15
for 15), while OpenAlex's had a few misses (14 good out of 18) — but OpenAlex also found some good
papers Semantic Scholar's keyword search missed entirely, and vice versa, so neither one covers the
other; skipping either would have cost real, relevant papers. Second, OpenAlex's other tricks —
searching by meaning and by topic — also pulled in good papers on their own. So this is less "one
engine is better" and more "they each catch different things." One important limit: this is a single
small test (40 papers, one run), and the battery-materials samples — the user's own field — actually
had the lowest hit rate of any well-sampled topic (10 good out of 14), which is worth a second look
with more data before drawing conclusions.
