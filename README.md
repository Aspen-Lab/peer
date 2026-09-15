<p align="center">
  <img src="assets/logo.png" alt="Peer" width="160" />
</p>

<h1 align="center">Peer</h1>

<p align="center">
  <em>A calm daily forecast for your field. Peer does the searching so you don't —
  it fetches papers from academic sources, scores them against what you actually
  care about, and hands you a small, precise morning briefing.</em>
</p>

---

> **Read this before you change anything.** This README is the contributor map of the
> whole repo: what each surface does, how the pipeline is wired, which invariants must
> not break, and where the landmines are. The product principles in
> [`VISION.md`](VISION.md) and [`docs/PRODUCT_DIRECTION.md`](docs/PRODUCT_DIRECTION.md)
> are the *why*; this file is the *how*. When they conflict, the live admin site
> (<https://hermes-admin-eta.vercel.app/>) wins.

## Table of contents

- [What Peer is](#what-peer-is)
- [The non-negotiable principles](#the-non-negotiable-principles)
- [Repository layout](#repository-layout)
- [The web app (primary surface)](#the-web-app-primary-surface)
  - [Stack](#stack)
  - [The five-stage feed pipeline](#the-five-stage-feed-pipeline)
  - [The three-tier intelligence model](#the-three-tier-intelligence-model)
  - [Sources](#sources)
  - [Scoring (Tier 0)](#scoring-tier-0)
  - [The preference ledger (learning loop)](#the-preference-ledger-learning-loop)
  - [LLM providers (Tier 2 / BYOK)](#llm-providers-tier-2--byok)
  - [Deep paper reports & figures](#deep-paper-reports--figures)
  - [Onboarding & persona quiz](#onboarding--persona-quiz)
  - [Themes](#themes)
  - [State management](#state-management)
  - [Supabase data model](#supabase-data-model)
  - [API routes](#api-routes)
  - [The digest cron](#the-digest-cron)
  - [Environment variables](#environment-variables)
  - [Running the web app](#running-the-web-app)
- [The Python CLI](#the-python-cli)
- [The iOS app](#the-ios-app)
- [Invariants — do not break these](#invariants--do-not-break-these)
- [Contributing & git workflow](#contributing--git-workflow)
- [License](#license)

---

## What Peer is

Peer is a self-hosted **information agent**. The user declares who they are and what
they care about (topics, current project, open challenges, advisor, preferred journals),
and Peer fetches from academic sources, scores every candidate against that profile,
removes duplicates, and surfaces a short daily briefing of the most relevant papers
(plus events and jobs). Named after the Greek messenger god — it is the user's personal
messenger for their field.

There are **three surfaces in one repo**. They are *parallel implementations of the same
idea*, not shared code:

| Surface | Path | Status | What it is |
| --- | --- | --- | --- |
| **Web app** | [`web/`](web/) | **Most active — start here** | Next.js dashboard deployed on Vercel. Full pipeline + onboarding + personalization + email digests. |
| **Python CLI** | [`python/`](python/) | Original MVP, stable | Local-first CLI (`peer init`, `peer run --once`). Pure Tier 0. Markdown output. |
| **iOS app** | [`Peer/`](Peer/), `Peer.xcodeproj` | UI scaffolding | SwiftUI app. Not yet wired to the backend. |

> ⚠️ **The Python and TypeScript pipelines are separate codebases.** Fixing scoring in
> one does **not** fix it in the other. When someone says "the pipeline," confirm which
> surface they mean. Default to `web/` unless told otherwise.

## The non-negotiable principles

Every change is judged against these. Reject anything that violates them.

1. **Time efficiency over information volume.** *Ten precise items beat one hundred noisy
   ones.* Favor cutting, summarizing, prioritizing. Never add a doomscroll/firehose pattern.
2. **User-declared intent.** Optimize from what the user explicitly stated, not guessed
   engagement signals.
3. **Tier 0 must always work.** The whole product must function end-to-end with **zero
   API keys**. Higher tiers add quality; they never become a hard dependency. (See
   [three-tier model](#the-three-tier-intelligence-model).)
4. **File over app / portability.** Output stays portable where possible — Markdown, email,
   JSON, feeds. No proprietary lock-in.
5. **Reliability through graceful degradation.** When a source, model, or budget fails,
   drop a tier — never block the user.
6. **Calm, weather-forecast tone.** Distilled and precise, never busy. The goal is "checking
   Peer is the first thing I do every morning."

Full detail: [`docs/PRODUCT_DIRECTION.md`](docs/PRODUCT_DIRECTION.md) and [`VISION.md`](VISION.md).

## Repository layout

```
.
├── README.md            ← you are here
├── VISION.md            ← product vision (the "why")
├── AGENTS.md            ← project rules for AI coding agents + git workflow
├── QUALITY-CAMPAIGN-REPORT.md  ← jobs & events report quality campaign: what shipped, and how it was verified
├── assets/              ← shared brand assets (logo)
├── docs/                ← architecture & product blueprints (see below)
├── python/              ← Python CLI surface
├── web/                 ← Next.js web app surface (primary)
├── Peer/              ← SwiftUI iOS sources
└── Peer.xcodeproj/    ← Xcode project
```

Key docs in [`docs/`](docs/):

- `PRODUCT_DIRECTION.md` — durable product/architecture decision filter.
- `THREE_TIER_ARCHITECTURE.md` — the progressive-enhancement doctrine.
- `BLUEPRINT_byok_and_providers.md` — bring-your-own-key + multi-provider design.
- `BLUEPRINT_deep_dive_with_plan_edit.md` — **parked** deep-dive feature spec (out of scope until unparked).
- `SETUP_gemini_vertex.md` — server-side Gemini/Vertex setup.
- `THIRD_PARTY_NOTICES.md` — dependency licenses.

---

## The web app (primary surface)

Everything below lives in [`web/`](web/). This is where almost all recent work happens.

> ⚠️ **This is not the Next.js you may know.** It runs **Next.js 16 + React 19 +
> Tailwind 4**, which have breaking changes from older versions. Per
> [`web/AGENTS.md`](web/AGENTS.md): read the relevant guide in
> `node_modules/next/dist/docs/` before writing framework code, and heed deprecation
> notices.

### Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 5.
- **Styling:** Tailwind CSS 4 (via `@tailwindcss/postcss`), CSS variables for theming.
- **Auth & DB:** Supabase (GitHub OAuth, Postgres with row-level security).
- **State:** Zustand stores with `persist` (localStorage) + fire-and-forget cloud sync.
- **Email:** Resend.
- **LLM SDKs:** Anthropic, Google GenAI / Vertex, OpenAI, plus HTTP-based Qwen & DeepSeek.
- **Tests:** Vitest (`npm test`).

### The five-stage pipeline

The whole feed is orchestrated by
[`web/src/lib/feed/pipeline.ts`](web/src/lib/feed/pipeline.ts) → `runFeedPipeline()`.
Stages, in order:

1. **Collect** — fetch from sources concurrently (`Promise.allSettled`). Each source is
   wrapped in `withSourceTimeout` (8s hard wall) so one slow source never stalls the run.
   Optional parallel work: Tavily web discovery (Tier ≥ 1) and advisor citation-neighborhood
   discovery (when an advisor is confirmed).
2. **Filter to paper sources** — unless the request explicitly includes non-paper context
   sources (`hn`, `web`), only academic sources flow forward.
3. **Dedupe** — [`dedup.ts`](web/src/lib/feed/dedup.ts) merges the same work across sources.
4. **Score** — [`scoring/combine.ts`](web/src/lib/scoring/combine.ts) → `scoreItems()`
   produces a 0–1 relevance score with an inspectable breakdown (see below).
5. **Rerank & shape** — Tier 1 rerank ([`rerank.ts`](web/src/lib/feed/rerank.ts)),
   optional Tier 2 LLM rerank ([`tier2-rerank.ts`](web/src/lib/feed/tier2-rerank.ts)),
   then a **preferred-journal boost applied last** (×4/3, clamped to 1.0), then `excludeIds`
   filtering (don't re-show recently seen items), then slice to `topN`.

The response carries rich `meta` (per-source counts, errors, before/after dedup, latency,
the compiled search brief, the AI tier actually used). **Keep that meta populated** — the UI
and debugging depend on it.

> The user's profile is compiled into a **search brief** by
> [`profile-compiler.ts`](web/src/lib/feed/profile-compiler.ts) (`compileSearchBrief`).
> This turns human knobs (focus, freshness, source mix, importance, discovery mode, avoid
> toggles) into generated queries, a time window, must-include/avoid lists, and source-mix
> weights. If you add a profile knob, wire it through here.

### The three-tier intelligence model

This is **doctrine**, not a suggestion. Each tier must stand alone; higher tiers add
capability without removing the floor. The active tier only changes **stage 4 (scoring)**
and **stage 5 (rerank/distillation)** — the UI shape stays identical across tiers.

| Tier | What it uses | Keys needed | In this repo |
| --- | --- | --- | --- |
| **0 — Rule engine** (the floor) | Keyword + TF-IDF + recency + source weight + preference ledger | **None** | `web/src/lib/scoring/` — fully implemented |
| **1 — Local / lightweight** | Tier 0 + heuristic rerank + Tavily discovery | None (Tavily optional) | `rerank.ts`, `tavily-discovery.ts` |
| **2 — Cloud LLM** | LLM rerank + AI-written digest + deep reports | **User BYOK key** | `tier2-rerank.ts`, `lib/llm/`, `lib/papers/` |

The deployed feed defaults to **Tier 0**. A user who pastes their own key in the UI can
turn on Tier 2 with that key. Deployed preview/production code never falls back to an
operator-funded model account. If no user key resolves, the LLM features **hide themselves**
and the feed keeps working on Tier 0 — that is the correct pattern.
**Never make a feature that hard-crashes when a key is missing.**

### Sources

Registered in [`web/src/lib/sources/index.ts`](web/src/lib/sources/index.ts). Each source
is a `SourceAdapter` exposing a uniform `fetch()`; the pipeline has no source-specific logic
beyond normalization.

| `SourceId` | Adapter | Notes |
| --- | --- | --- |
| `openalex` | `openalex.ts` | Primary academic source (250M+ works). Also powers live search. |
| `arxiv` | `arxiv.ts` | Preprints. |
| `semantic_scholar` | `semantic-scholar.ts` | Optional `SEMANTIC_SCHOLAR_API_KEY` for figures. |
| `dblp` | `dblp.ts` | CS bibliography. |
| `pubmed` | `pubmed.ts` | Biomedical. |
| `web` | `web-search.ts` | Brave/Tavily-backed web scouting (non-paper context). |
| `hn` | `hn.ts` | Hacker News (non-paper context). |

The five `ACADEMIC_PAPER_SOURCES` are the default. `hn`/`web` are **context** sources only
included when explicitly requested.

> **Adding a source:** create the adapter implementing `SourceAdapter`, add it to both
> exports in `index.ts` (`sources[]` and `bySourceId`), and add its id to the `SourceId`
> union in `types.ts`. If it returns papers, make sure it's in `ACADEMIC_PAPER_SOURCES`
> in `pipeline.ts`.

### Scoring (Tier 0)

[`scoring/combine.ts`](web/src/lib/scoring/combine.ts) is the heart of Tier 0 and must
stay inspectable. Per item:

```
base     = w.keyword·keyword + w.tfidf·tfidf + w.recency·recency + w.source·source
combined = clamp01( base · policyPenalty · legacyPenalty · preferencePenalty
                    + softBonus + preferenceBoost )
```

Important behaviors to preserve:

- **Hard topic gate:** if the user has required topics and an item matches **none**, it is
  dropped (`kw.score === 0` → `continue`). Required topics are sacred.
- **Soft topics** add up to +0.18 bonus (curiosity, not a gate).
- **Negative/avoid topics** apply multiplicative penalties, but a **required topic is never
  penalized** even if it also appears in a dislike list (`isProtectedRequiredTopic`).
- Weights are normalized to sum to 1 (`normalizeWeights`); defaults in `scoring/types.ts`.
- Every item ships a `scoreBreakdown` and a human `relevanceReason` — **keep these
  populated** for transparency.

### The preference ledger (learning loop)

[`web/src/lib/preferences/ledger.ts`](web/src/lib/preferences/ledger.ts) is the gradual
learning system. Like/Save add positive evidence; "Not interested" adds negative evidence
(only after its undo window commits). It is intentionally **slow and smoothed** so one click
never overcorrects:

- **Time decay:** 60-day half-life on every entry.
- **Saturating curves:** positive boost caps at +0.18; negative penalty caps at ×0.40 of base.
- **Concept canonicalization:** OpenAlex items merge by stable `source:id`; others fall back
  to normalized-label keys, with cross-source bridging by label.
- **TF-IDF-style distinctiveness:** rare concepts count more than ubiquitous ones.

The ledger is stored on the profile (`preference_ledger jsonb`) and summarized for the
profile screen via `summarizePreferenceLedger`. Has unit tests: `ledger.test.ts`.

> ⚠️ Tuning the constants (`HALF_LIFE_DAYS`, `POSITIVE_BOOST_MAX`, `NEGATIVE_PENALTY_MAX`)
> directly changes how aggressively the feed shifts. Change deliberately — this is the
> "grows with the user" mechanism. Don't make it overreact.

### LLM providers (Tier 2 / BYOK)

Provider abstraction lives in [`web/src/lib/llm/providers/`](web/src/lib/llm/providers/).
Code against the `DigestProvider` interface — **never against a single SDK directly**.

- Supported: **Anthropic, Gemini (API + Vertex), OpenAI, Qwen, DeepSeek**. (`ollama` is a
  placeholder in the registry.)
- Resolution order ([`registry.ts`](web/src/lib/llm/providers/registry.ts) → `resolveProvider`):
  1. per-request **BYOK** override (user's own key + provider), then
  2. only during local `next dev`, an explicit developer env provider, then
  3. `null` → Tier 0 fallback.
- Vercel preview and production ignore operator model credentials even if someone adds
  them by mistake. The build guard also rejects that deployment configuration.
- The digest model default is `claude-haiku-4-5-20251001` ([`llm/client.ts`](web/src/lib/llm/client.ts)).
- Two model sizes per provider: a **small** model (classify/compress) and a **large** model
  (extract/synthesize) — used by deep reports below.

> When you add a provider: implement `DigestProvider` (incl. `generateJsonText` with
> `tier: "small" | "large"`) and register its user-supplied override. Do not add a
> deployed server-key fallback. Keep local developer credentials local-only.

### Deep paper reports & figures

Per-paper "deep report" turns a paper into a one-glance mini-dashboard
([`lib/papers/`](web/src/lib/papers/)). The flagship is
[`deep-report.ts`](web/src/lib/papers/deep-report.ts), a **two-pass** generator:

1. **Pass 1 (small model) — COMPRESS:** read the full body, return *verbatim* signal
   sentences (novelty / results / methods / prior-work comparisons). Trims ~30k tokens to ~1.5k.
   Skipped for short papers (< ~10k chars).
2. **Pass 2 (large model) — EXTRACT:** produce the structured `PaperReport` with grounded
   evidence and an explicit novelty line per result. Review/survey papers get a different schema.

Full text is fetched HTML-first, PDF as fallback ([`full-text.ts`](web/src/lib/papers/full-text.ts),
`html-text.ts`, `pdf-text.ts` — the last shells out to Python via `PYTHON_BIN`). Paywalled
papers gracefully fall back to an abstract-only report **with a notice banner**
(`buildPaywalledFallback`) — never an error.

Figures get their own subsystem ([`lib/figures/`](web/src/lib/figures/)): extraction, PDF
extraction, semantic matching, and vision matching, then binding to report results
([`figure-binding.ts`](web/src/lib/papers/figure-binding.ts)).

**Upload your own PDF** (the black square left of the front-page search box) reads a paper Peer
never crawled: `POST /api/papers/upload` hashes the file (`upload-store.ts`, id `upload:<sha16>`,
idempotent) and stores it under `web/.local-data/uploads/` — **gitignored and local to this
machine only; an upload made in one `next dev`/deployment is not visible from another, and nothing
here is persisted on Vercel.** `full-text.ts` and `lib/figures/extract.ts` both recognize an
`upload:` id and read the stored file directly, so the rest of the deep-report/figure pipeline
needs no separate code path. A PDF with no extractable text (a scanned image, most often) still
uploads successfully; the reading page says so plainly instead of pretending a report exists.

> ⚠️ Deep reports burn tokens (small + large model **per paper**). They are gated behind
> an explicit user toggle and require a resolvable key. Any LLM failure must return `null`
> so the caller falls back to the abstract path. Preserve that.

### Onboarding & persona quiz

First-run wizard at [`web/src/app/welcome/page.tsx`](web/src/app/welcome/page.tsx) —
Apple-setup style, one idea per page: **basics → topics → work → radar → ai → persona**.

- **Topics is the only gate** — the feed needs at least one required topic for a real first
  briefing. Everything else is skippable.
- It writes straight to the shared **profile store** (same store and field components as
  `/profile`), then marks `onboardedAt` and hands off to the feed with the coachmark tour
  (`/?tour=1`, see [`onboarding-tour.tsx`](web/src/components/onboarding-tour.tsx)).
- The optional **persona quiz** ([`/persona`](web/src/app/persona/page.tsx),
  [`lib/persona/`](web/src/lib/persona/)) maps reading style across five axes.

### Themes

Six color themes: `system`, `cream`, `white`, `black`, `pink`, `blue`. Applied via CSS
variables in [`lib/theme.ts`](web/src/lib/theme.ts) (`applyColorTheme`), persisted on the
profile (`color_theme`), and synced by [`theme-sync.tsx`](web/src/components/theme-sync.tsx).
Use the semantic CSS variables (`bg`, `surface`, `text`, `heading`, `accent`, `border`, …) —
**never hard-code colors** if you want themes to keep working.

### State management

Three Zustand stores ([`web/src/store/`](web/src/store/)), all with optimistic local writes
and fire-and-forget cloud sync:

- [`profile.ts`](web/src/store/profile.ts) — the user profile (topics, knobs, keys, ledger,
  digest prefs, theme, onboarding flag). `hydrateFromRemote` merges a server snapshot
  (undefined fields keep local values). Persisted under `peer-profile`.
- [`feed.ts`](web/src/store/feed.ts) — papers/events/jobs, loading, read items, AI-search toggle.
- [`ui.ts`](web/src/store/ui.ts) — transient UI state.

Sync components: `profile-sync.tsx`, `feed-sync.tsx`, `theme-sync.tsx`.

> Local keys (BYOK API keys, Tavily key) are stored **only in the browser** (localStorage),
> not in Supabase. Keep it that way.

### Supabase data model

One-shot schema in [`web/supabase/schema.sql`](web/supabase/schema.sql) (run it in the
Supabase SQL editor). All tables are **RLS-scoped to `auth.uid()`**. Tables:

| Table | Purpose |
| --- | --- |
| `profiles` | All user profile fields + feed knobs + digest prefs + `preference_ledger` + theme. Auto-created on signup; `updated_at` auto-touched. |
| `saved_items` | Unified saved papers/events/jobs. `payload` is a full snapshot so links survive source decay. |
| `read_items` | One row per (user, item) — powers the reading calendar/streak. |
| `feedback_events` | Append-only signal stream (`liked` / `saved` / `notInterested` / `moreLikeThis`). |
| `briefing_deliveries` | One row per scheduled digest run; drives the in-app "past briefings" inbox. Written by the cron with the service role (bypasses RLS). |

> ⚠️ Schema changes must stay **idempotent** (`if not exists`, `add column if not exists`) —
> the file is re-run on every deploy. Never drop RLS.

### API routes

Under [`web/src/app/api/`](web/src/app/api/). Highlights:

| Route | Purpose |
| --- | --- |
| `feed/` | Run the feed pipeline for the current user. |
| `papers/search/` | Live academic search (OpenAlex). |
| `papers/[id]/`, `papers/report/` | Fetch a paper; generate its report. |
| `figure/` | Resolve/serve paper figures. |
| `digest/`, `digest/test/`, `test-digest/` | Build / test the synthesized digest. |
| `jobs/dispatch-digests/` | **Cron target** — fans out due digests (auth via `CRON_SECRET`). |
| `profile/`, `saved/`, `read/`, `feedback/`, `briefings/` | Profile + interaction persistence. |
| `affiliation/resolve/`, `affiliation/seeds/` | Advisor (OpenAlex author) resolution & seed works. |
| `topics/suggest/` | Topic autocomplete. |
| `auth/callback/`, `auth/signout/`, `auth/error/` | Supabase GitHub OAuth flow. |

### The digest cron

Hourly digests run via a **GitHub Action**
([`.github/workflows/digest-cron.yml`](.github/workflows/digest-cron.yml)), *not* Vercel
cron (the Hobby plan rejects hourly schedules). It runs at `5 * * * *` (5 past the hour,
because Actions cron is best-effort) and `GET`s `/api/jobs/dispatch-digests` with a
`Bearer ${CRON_SECRET}` header. That endpoint checks each user's `digest_hour_local` /
timezone / frequency and sends in-app and/or email (Resend) digests.

> If you change the dispatch endpoint, keep the `CRON_SECRET` auth and the per-user
> hour/timezone gating intact, and update the `ENDPOINT` URL in the workflow if the deploy
> URL changes.

### Environment variables

None are required for Tier 0 to function. Grouped by purpose:

**Supabase (required for auth/persistence):**
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `…_ANON_KEY`),
`SUPABASE_SERVICE_ROLE_KEY` (server/cron only).

**Feed / tiers:** `PEER_FEED_AI_TIER` (0/1/2, default 0). `PEER_DIGEST_PROVIDER` is
accepted only by local `next dev`. `PEER_REPORT_MODEL_TIER` (`large` default, or
`small`) picks which Gemini tier writes the paper report; everything else runs small.

**Local-development-only LLM provider keys:**
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`,
`GOOGLE_VERTEX_PROJECT` / `GOOGLE_VERTEX_LOCATION` / `GOOGLE_APPLICATION_CREDENTIALS`
(Gemini 3 models are served from Vertex's global endpoint; the configured region is only the
last-resort fallback), `QWEN_API_KEY` (or `DASHSCOPE_API_KEY`), `DEEPSEEK_API_KEY`.
Do not add these to Vercel. Preview/production builds fail when operator-funded model
credentials are present; online users must supply their own key through the BYOK UI.

**Search / enrichment:** `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`,
`SEMANTIC_SCHOLAR_API_KEY` (raises Semantic Scholar's per-IP figure-lookup rate limit; optional —
without one, Peer queues and paces those requests to stay under the unauthenticated limit instead
of failing), `OPENALEX_EMAIL`, `UNPAYWALL_EMAIL` (polite-pool emails).

**Jobs feed (all optional — Remotive/Arbeitnow/Himalayas run keyless):**
`ADZUNA_APP_ID` + `ADZUNA_APP_KEY` (free at developer.adzuna.com; best industry
coverage), `USAJOBS_API_KEY` + `USAJOBS_USER_AGENT` (your email; US federal research
posts), `JSEARCH_API_KEY` (or `RAPIDAPI_KEY`; Google-for-Jobs aggregate via RapidAPI,
paid beyond a small free tier). `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` above also
unlock web discovery of academic job boards (HigherEdJobs, jobs.ac.uk, Nature Careers —
none expose usable feeds directly).

**Events feed:** fully keyless (ccfddl, confs.tech, researchseminars.org).
`TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` add profile-driven web discovery for
non-CS fields; an LLM key upgrades its query generation from templates to
profile-aware prompts.

**Email digest:** `RESEND_API_KEY`, `DIGEST_FROM_EMAIL`.

**Misc:** `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `PYTHON_BIN` (for PDF extraction shell-out).

### Running the web app

```bash
cd web
npm install
npm run dev      # http://localhost:3000
npm test         # vitest
npm run build    # production build
npm run lint
```

Without any env vars you get Tier 0 + live OpenAlex search. Add Supabase keys for auth and
profile persistence; add an LLM key for Tier 2 features.

---

## The Python CLI

The original local-first MVP, in [`python/`](python/). Pure Tier 0 (TF-IDF + keyword +
source priority, scikit-learn), SQLite state, Markdown/Obsidian output. Entry point:
`peer_news.cli:main`.

```bash
cd python
pip install -e .
peer init          # writes peer.yml in the current directory
# edit peer.yml — add keywords, topics, sources
peer run --once
```

Output lands as `YYYY-MM-DD.md` (path from config). Pipeline mirrors the web stages:
collect → tag → score → filter → render. Config reference:
[`python/config.example.yaml`](python/config.example.yaml).

Layout:

```
python/src/peer_news/
├── cli.py              # `peer` entry point
├── pipeline.py         # orchestration
├── config.py, models.py
├── sources/            # arxiv, hackernews, reddit, rss
├── scoring/            # keyword, tfidf, source_priority
├── tagging/rules.py
├── storage/            # SQLite (schema.sql)
└── output/             # markdown, obsidian
```

> This is a **separate implementation** from `web/`. The two do not share code. Keep the
> Tier 0 contract (works with no keys) here too.

## The iOS app

SwiftUI sources in [`Peer/`](Peer/), project in `Peer.xcodeproj`. Currently **UI
scaffolding** — Models (`Paper`, `Event`, `Job`, `UserProfile`), state (`FeedState`,
`ProfileState`), discovery/detail/profile views, a theme, and a `RecommendationService`.
It is **not yet wired to the web backend**; treat it as a design prototype until that
integration lands. Open in Xcode to build.

---

## Invariants — do not break these

A checklist before you merge. Each maps to a principle above.

- [ ] **Tier 0 still works with no keys.** The feed renders, search works, the digest just
      hides itself. No feature hard-crashes on a missing key.
- [ ] **Required topics gate the feed.** Items matching no required topic are dropped; a
      required topic is never penalized.
- [ ] **Graceful degradation everywhere.** LLM/source/figure failures return `null`/empty
      and fall back, never throw to the user. Per-source timeouts stay.
- [ ] **Scoring stays inspectable** — `scoreBreakdown` + `relevanceReason` populated.
- [ ] **Preference learning stays gradual** — decay + saturating caps; no single-click overreaction.
- [ ] **Provider abstraction respected** — no direct SDK calls outside `lib/llm/providers/`;
      deployed AI calls use user BYOK only; server keys remain local-development-only.
- [ ] **Supabase RLS intact** and schema migrations idempotent.
- [ ] **Themeable** — semantic CSS variables, no hard-coded colors.
- [ ] **Pipeline `meta` populated** for the UI/debugging.
- [ ] **Calm tone preserved** — no noise, gamification, or engagement-bait additions.
- [ ] You read the Next.js 16 / React 19 docs in `node_modules/next/dist/docs/` before
      touching framework code.

## Contributing & git workflow

From [`AGENTS.md`](AGENTS.md):

- **Never create a branch without explicit approval**; confirm the name first. Default to
  committing on the current branch.
- **PR order:** make changes → commit → push branch → open PR. Only push/open a PR when
  explicitly asked.
- **State the current branch** at the start of any session.
- Open an issue first for anything larger than a bugfix so we can align on fit — especially
  new source adapters and anything touching the pipeline.

## License

MIT.

---

### In plain English (for a middle schooler)

Peer is like a smart newspaper that only prints the stuff *you* care about. You tell it
what you're studying, and every morning it digs through tons of science articles, picks the
few best ones, and explains why they matter — so you don't have to search yourself. This
README is the instruction manual: it tells anyone who wants to fix or add to Peer how all
the parts fit together, and lists the rules they must not break (like: it always has to work
even without any paid AI, and it should never get spammy or noisy). There are three versions
of Peer — a website (the main one), a command-line tool, and a phone app — and they each do
the same job in their own way.
