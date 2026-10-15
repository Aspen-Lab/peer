> Jobs and events were removed from Peer; this file is history.

# Event & job relevance architecture

How Peer decides which conferences and job postings to show. This surface was
rebuilt in July 2026; this document describes the design that replaced the
original one and, briefly, why.

## The problem this replaced

Events and jobs used **catalog-dump retrieval**: download three fixed feeds,
then filter locally for relevance. Measured with a battery-materials PhD
profile, the entire 124-item candidate pool contained **zero** items about
batteries, electrolytes, cathodes, or energy storage:

| Source | Items | What it actually is |
|---|---|---|
| ccfddl | 80 | Computer-science conference deadlines (AAAI, NeurIPS, ECCV) |
| confs.tech | 24 | Developer conferences (AWS Community Day, flutterCon) |
| researchseminars | 20 | Math/physics seminars (p-adic Gross-Zagier, Antarctic ice shelves) |

No filter can fix an empty pool. The best achievable outcome was an empty feed;
what users actually got was the least-bad noise, ranked confidently. Jobs had
the same disease: three remote *software* job boards.

Papers never had this problem because they use **search-based retrieval** —
they ask the source for the user's topic. Events and jobs now do the same.

## The model

```
required topics ──> web search (many queries, academic + industry vocabulary) ──┐
                                                                                ├─> candidate pool
curated catalogs (ccfddl / confs.tech / researchseminars / job boards) ─────────┘
                                          │
                                          ├─> quality filter   (is this even a real event/posting?)
                                          ├─> relevance gate   (does it match a REQUIRED topic?)
                                          ├─> ranking          (relevance-dominant; explore topics add bonus)
                                          └─> score floor      (show fewer, never pad with noise)
```

### Required vs explore topics

- **Required** (`topics`) drives *retrieval* and *admission*. These generate the
  web search queries and an item must match one to be shown at all.
- **Explore** (`softTopics`) drives *ranking only*. A match lifts an item's
  score; it never admits an item on its own.

Both now reach the search engine. Previously only the first three required
topics generated queries and only the first three queries were used, so a
profile of `[LCO, topochemical, ion exchange, molten salt, battery]` never sent
the word "battery" to the search engine at all.

## Term matching (`lib/scoring/term-expand.ts`)

Shared with the paper pipeline. A user term expands to every surface form it
should match:

| Input | Also matches |
|---|---|
| `battery` | `batteries` |
| `solid state battery` | `solid-state battery`, `solid state batteries`, `SSB`, `all-solid-state battery` |
| `lithium ion` | `li-ion`, `lithium-ion` |
| `XRD` | `x-ray diffraction` |

- `canonicalize()` collapses hyphens, slashes, underscores, and punctuation on
  **both** sides, so `solid-state` and `solid state` are one term.
- Matching is whole-word and Unicode-aware, so `ion` does not match `region`.
- **Two-letter acronyms are forbidden** (`MIN_ABBREVIATION_LENGTH`). `SE` is
  Software Engineering / Southeast; `CV` appears in nearly every job posting
  ("send your CV"), which made `cyclic voltammetry` match the whole job board.
  Long forms still expand normally — only the ambiguous alias is withheld.

### Generic terms

Words like `materials`, `energy`, `data`, `simulation` match unrelated text
constantly ("marketing materials", "training materials"). They are handled
structurally, in three layers, rather than by denylisting phrases:

1. **Scope** — the gate reads only title + a short summary, never the full body.
2. **Weight** — `termSpecificity()` scores them 0.3 vs 1.0 for a multi-word term.
3. **Gate** — `passesRequiredGate()` never opens on a lone generic match.

## The relevance gate (`lib/opportunities/shared.ts`)

An item is admitted when it either:

- matches a **specific** required topic in **title + summary**, or
- matches **two distinct** required topics anywhere.

Notably the gate reads `topics` only, **not** `methods`. Previously methods
counted, so a single `machine learning` method matched the AI-tag bundle on
every conference in the CS catalog and 35 AI conferences flooded the feed at
once.

Web-discovered items are **not** exempt from this gate. They keep only a date
exemption, because conference pages routinely omit a parseable date from a
search snippet.

## Ranking

Relevance dominates. Before, it was a minority of the score, so an irrelevant
conference with a near deadline beat a perfect match three months out.

| | keyword | tfidf | urgency/career | rank/industry | location | recency | source |
|---|---|---|---|---|---|---|---|
| **Events** | 0.45 | 0.20 | 0.12 | 0.08 | 0.05 | — | 0.10 |
| **Jobs** | 0.40 | 0.15 | 0.15 | 0.08 | 0.07 | 0.08 | 0.07 |

Relevance is 0.65 (events) and 0.55 (jobs), up from 0.43 and 0.41.

The keyword score **saturates** rather than dividing by topic count. Listing
nine interests used to reduce a perfect single-topic match to ~3% of the
ranking, i.e. being specific made matching worse.

## Score floor

`MIN_SCORE = 0.35`, applied after ranking. **The feed may return fewer than
`topN` items.** Showing two good events beats padding five slots with noise —
padding is what surfaced an Instagram reel as an academic event.

## Quality filters

Web search returns pages, not events. Both adapters reject non-items:

**Events** (`lib/events/sources/eventweb.ts`)
- Denied hosts: social media, journal/article repositories, predatory
  conference mills (waset.org et al.).
- Denied paths: `/article/`, `/doi/`, `/abs/`, `/reel/`, `/posts/`.
- Calendar indexes, archives, and research-group homepages — they pass the
  event-signal check because they are full of the word "events".
- Every result must positively read as an event.

**Jobs** (`lib/jobs/sources/jobweb.ts`)
- Aggregator search/category pages ("60 Molten Salt Jobs, Employment") and
  careers-index pages ("CAREERS"). On known aggregator hosts a posting
  identifier in the URL is required, since their category paths are otherwise
  indistinguishable from postings.
- Expired postings: `postedAt` older than 270 days, or a season+year in the
  title naming a cycle that has passed.

## Naming

Search result titles are often site chrome. `"DLR Events | Events for July
2026"` pointed at a specific ion-exchange-membrane workshop. `eventNameFrom()`
prefers an informative title segment, then the event URL's slug, then the
snippet — so the card names the event rather than the website.

## Honest reasons

The reason line no longer asserts relevance it does not have. It previously
fell back to `"Upcoming in your field"` when nothing matched, and told a
battery researcher that AAAI "covers your machine learning focus".

## Benchmark

`lib/events/benchmark.test.ts` is the acceptance test: with the real stored
profile, the feed must surface the **Solid-State Battery Summit** (Cambridge
EnerTech, Aug 11–12 2026, Chicago) with no denied hosts.

It is a commercial industry summit, not an academic call-for-papers — none of
the curated catalogs can structurally contain it, so it only passes if
search-based retrieval is working end to end.

The test is skipped unless a Tavily key is present. It reads the dev profile
snapshot (`web/.local-data/profile.json`, gitignored) or
`PEER_PROFILE_SNAPSHOT_PATH`. It must never log the key.

## Not done here

Per-surface required/explore keyword sets (separate topics for papers vs events
vs jobs, edited from a collapsible panel under each tab) are designed but not
implemented — a user's desired papers, events, and jobs are genuinely different
targets. That work touches onboarding and the profile store and was deferred to
avoid colliding with in-flight changes there.
