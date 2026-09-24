# Vertex AI Search — moving Peer's web search onto the GenAI App Builder credit

**Why this exists.** Peer's three web-discovery surfaces (papers, jobs, events)
currently search through **Gemini + Google Search grounding** on Vertex. That
path bills under *Grounding with Google Search* — roughly **$35 per 1000
queries** — and it is the biggest single line on the project's Vertex bill.

The project holds a **$1,000 one-time "Trial credit for GenAI App Builder"**
(valid one year from issue). That
credit's product family is now called **Vertex AI Search**, and Vertex AI Search
costs roughly **$1.5–4 per 1000 queries**. Same job, about ten times cheaper,
and paid from the credit instead of the card.

This document is the operator half of that migration. The code half is already
merged and is **inert until you finish step 3 below**.

---

## What the code does now

A `vertex` web-search provider lives in
[vertex-search.ts](../web/src/lib/sources/vertex-search.ts). It returns the exact
same `{title, url, snippet}` rows the grounding provider returns, so no mapper,
admission rule or report changes.

Resolution order, when Tavily is not enabled:

```
vertex (Vertex AI Search)  →  gemini (grounding)  →  brave  →  tavily
```

`vertex` is chosen **only** when both a project and a Search App id are
configured. With no Search App configured, every surface resolves exactly as it
does today — this change is behaviourally invisible until you switch it on.

**Grounding is not deleted.** Vertex AI Search only searches the sites you seed
into it, so it cannot discover a host it has never crawled. When a query returns
fewer than `GOOGLE_VERTEX_SEARCH_MIN_RESULTS` rows (default **3**), the provider
tops that query up with one grounding call. Expected steady state: most queries
paid from the credit, a small tail still paying for grounding.

---

## Before you start — confirm the credit actually covers this

The Credits page shows **Usage scope: "Certain usage; see the terms of the
offer"**. Open that terms link and check the SKU list before seeding a large data
store. You are looking for the **Vertex AI Search / Discovery Engine** SKUs
(`Vertex AI Search - Search Request`, or the Search Standard/Enterprise edition
lines).

Two things the credit will **not** cover, stated plainly so the forecast is not a
surprise:

- **Model calls** (summaries, report generation, query refinement) keep billing
  to the card. That is the smaller half of the spend.
- **Grounding with Google Search**, including the backfill described above.

**Enabling an API does not widen a credit.** They are unrelated switches: an API
being on decides whether a call is *allowed*, the offer terms decide which SKUs
the credit *pays for*. Turning on the Discovery Engine API does not move Gemini
generation or Search grounding onto this credit, and no configuration in Peer
can. The only mechanism that shifts spend onto the credit is moving work from an
uncovered SKU to a covered one — which is exactly what the `vertex` provider
does for search, and why model calls are left where they are.

---

## Step 0 — Check you are pointing at the right project

> **This repository is public.** Every `<project-id>` / `<service-account>`
> placeholder below stands for a real value that lives only in `web/.env.local`
> (git-ignored) and in the Google Cloud console. Do not paste the real ids back
> into this file.


`web/.env.local` currently sets `GOOGLE_VERTEX_PROJECT=<project-id>`.
Probed 2026-08-26: that service account authenticates fine, but it is **not
obviously the project the Credits screenshot came from.**

GCP credits attach to a **billing account**, not to a project. So this works
only if `<project-id>` is linked to the billing account that holds the
$1,000 GenAI App Builder credit. Confirm in Console → **Billing → Account
management → Projects linked to this billing account** before assuming the
credit will absorb the spend. If it is a different billing account, either link
the project across or set `GOOGLE_VERTEX_SEARCH_PROJECT` to a project that is on
the right one.

## Step 1 — Enable the API — DONE (2026-08-26)

Console → **APIs & Services** → **Discovery Engine API** → Status **Enabled**.
Verified by probe: the failure moved off `SERVICE_DISABLED`.

## Step 1b — Grant the service account a Discovery Engine role

**Probed 2026-08-26, the current blocker.** With the API enabled, a list call
still returns:

```
403 PERMISSION_DENIED
Permission 'discoveryengine.engines.list' denied on resource
'//discoveryengine.googleapis.com/projects/<project-id>/locations/global/collections/default_collection'
```

Enabling an API and being allowed to call it are two separate switches. The
service account Peer runs as —
`<service-account>@<project-id>.iam.gserviceaccount.com` — holds
**Vertex AI User**, which does not carry any `discoveryengine.*` permission.

Console → **IAM & Admin → IAM** → find that service account → pencil → **Add
another role**:

| Role | Grants | Pick this when |
| --- | --- | --- |
| **Discovery Engine Viewer** (`roles/discoveryengine.viewer`) | run searches, read apps | You create the Search App yourself in the console. **Least privilege — prefer this.** |
| **Discovery Engine Admin** (`roles/discoveryengine.admin`) | the above, plus create/seed data stores | You want the Search App and its site list built through the API instead. |

**Decision (2026-08-26): Discovery Engine Admin**, so the Search App and its
site list can be built through the API rather than by hand. Downgrade to Viewer
once the app exists — nothing at runtime needs more than read access.

`gcloud` is **not installed on this machine** (probed 2026-08-26), so use the
console path above rather than a CLI command.

### Where this stands, 2026-08-26 — **LIVE AND GREEN**

| Step | State |
| --- | --- |
| Discovery Engine API | enabled |
| `roles/discoveryengine.admin` on the service account | granted |
| `roles/aiplatform.user` (shown as **Agent Platform User**) | re-granted after being displaced |
| Data store `peer-web` (PUBLIC_WEBSITE, global) | 50 patterns — at the cap |
| Search app `peer-web` | **Enterprise tier** |
| `GOOGLE_VERTEX_SEARCH_ENGINE_ID` | `peer-web` |
| Provider the Papers, Jobs and Events surfaces select | **`vertex`** |
| Test suite | **2558 / 2558**, three consecutive full runs |

Per-query yield measured through Peer's own adapters — every query returned a
full page:

| Query | Rows | Time |
| --- | --- | --- |
| molten salt reactor workshop 2026 | 10 | 1.3 s |
| machine learning conference 2026 call for papers | 10 | 0.7 s |
| postdoc position computational neuroscience | 10 | 0.4 s |
| materials science summer school 2026 | 10 | 1.0 s |
| battery research symposium 2026 | 10 | 0.7 s |
| protein structure prediction seminar | 10 | 0.6 s |

Whole-surface comparison, same profile, same day, A/B by blanking the engine id:

| | grounding (`gemini`) | Vertex AI Search (`vertex`) |
| --- | --- | --- |
| `eventweb` rows fetched | 40 | **79** |
| bare adapter fan-out | **over 120 s** | **1.9 s** |
| live events benchmark | passes | **passes** |

### Two findings that cost a rebuild — do not repeat them

1. **Website search is an ENTERPRISE-tier feature.** A `SEARCH_TIER_STANDARD`
   engine is created happily and then refuses every single query with
   `400 Cannot use enterprise edition features (website search ...)`. Enterprise
   prices at roughly $4/1000 queries rather than $1.5 — still about nine times
   under grounding. The tier change takes a minute or two to propagate; queries
   in that window return 400 intermittently.
2. **Wildcard TLD patterns are refused.** `*.edu/*`, `*.gov/*`, `*.ac.uk/*` all
   come back `INVALID_ARGUMENT`; a pattern must name a concrete registrable
   domain. "All of academia" cannot be one line, which is what makes the 50-slot
   cap bite.

### The 50-pattern cap is the real design constraint

A basic website data store holds **at most 50 URI patterns**. That is a budget,
and what fills it decides how much of the bill the credit absorbs:

- An **aggregator** (`10times.com`, `himalayas.app`, `conferenceindex.org`,
  `link.springer.com`) earns its slot on nearly every query, whatever the topic.
- A **single university** earns its slot only when that university happens to
  have something matching.

The current 50 are 23 aggregators/publishers/job boards plus 27 US universities
— an artefact of the order they were submitted in, not a decision. Re-running
`scripts/setup-vertex-search.mjs` after re-ordering the list does not evict
anything; deleting a pattern is a separate API call.

To go past 50, attach a **second data store** to the same app. Not yet tested.

## Step 2 — Create the Search App — DONE (built by `scripts/setup-vertex-search.mjs`)

Console → **AI Applications** (formerly Agent Builder) → **Apps** → **Create
app**.

1. App type: **Search**
2. Edition: **Search — Standard** is enough for `{title, link, snippet}`.
   Enterprise adds extractive answers; the provider reads them if present but
   does not need them.
3. Content: **Website content**
4. **Advanced website indexing is not required.** Basic indexing serves
   `derivedStructData.title` / `link` / `snippets`, which is everything Peer
   reads. Advanced indexing needs domain verification for every site.
5. Location: **global** (this is the default for a website data store, and the
   value the provider assumes).

Then seed the data store with the sites Peer actually searches. Include patterns
use `*` wildcards, e.g.:

```
*.edu/*
*.ac.uk/*
events.ornl.gov/*
www.grc.org/*
```

**Seed BROAD PATTERNS, not the host list from the cache.** The local pool cache
holds 106 distinct hosts, but they come from one battery/energy profile
(`linkedin.com`, `thebatteryshow.com`, `cambridgeenertech.com`, …). Seeding those
would build an index that serves battery researchers and nobody else, and Peer's
whole point is arbitrary research profiles. Seed the *kinds* of site instead —
academic TLDs, publisher and society hubs, the job boards already in the census —
and let the observed hosts be a cross-check that the patterns cover them.

## Step 3 — Configure the environment — DONE

Copy the **App ID** from the app's list row (it looks like `peer-web_1234567890`)
and add **both** of these lines to `web/.env.local`:

```
GOOGLE_VERTEX_SEARCH_PROJECT=<the project the Search App lives in>
GOOGLE_VERTEX_SEARCH_ENGINE_ID=peer-web_1234567890
```

**Both lines are required, and one on its own does nothing.** The provider is
chosen only when a project *and* an app id are configured — the same condition
already stated at the top of this file. Setting the engine id alone leaves the
provider off, silently: every surface keeps the provider it has today and
nothing is printed.

**`GOOGLE_VERTEX_PROJECT` is not read here.** That name is the **models**
project, and it is a different capability on purpose. There is no fallback and
no default: from ABC-freemium 9-01, both operator scripts **exit 1** naming
`GOOGLE_VERTEX_SEARCH_PROJECT` if only the old name is set. If you already built
an index while the old name was the only one set, nothing has to be rebuilt —
set `GOOGLE_VERTEX_SEARCH_PROJECT` to that same project id and the identical
index is reachable.

The rest are optional overrides:

| Variable | Default | What it does |
| --- | --- | --- |
| `GOOGLE_VERTEX_SEARCH_PROJECT` | **none — required** | The project the Search App lives in. One of the two signals that turn the provider on. |
| `GOOGLE_VERTEX_SEARCH_ENGINE_ID` | **none — required** | The Search App id. The other signal. Either one missing leaves the provider off. |
| `GOOGLE_VERTEX_SEARCH_DATA_STORE_ID` | — | Query a data store directly instead of an app. Ignored when an engine id is set; satisfies the app-id half if the engine id is absent. |
| `GOOGLE_VERTEX_SEARCH_LOCATION` | `global` | Region of the data store. `global` is the un-prefixed hostname; anything else prefixes it. |
| `GOOGLE_VERTEX_SEARCH_COLLECTION` | `default_collection` | Rarely changed. |
| `GOOGLE_VERTEX_SEARCH_SERVING_CONFIG` | `default_search` | Rarely changed. |
| `GOOGLE_VERTEX_SEARCH_MIN_RESULTS` | `3` | Below this many rows, one grounding call tops the query up. `0` disables the backfill. |
| `GOOGLE_VERTEX_SEARCH_FALLBACK` | **off** | Set to `on` (or `true`/`1`) to **arm** the grounding backfill. Grounding is ~$35/1,000 queries and is **not** covered by the GenAI App Builder credit, so it is off unless you deliberately turn it on. Changed by ABC-freemium 8-01(b); this row used to say the default was `on`, which was backwards. |

The credential is the one you already have: the service-account JSON at
`GOOGLE_APPLICATION_CREDENTIALS`. **No new secret** — only the extra IAM role
from step 1b.

Restart the dev server after editing `.env.local`.

## Step 4 — Verify the credit is actually being drawn down

This is the only proof that matters, and it is a two-day check because billing
lags.

1. Run one census (events or jobs) and confirm the surface returns rows.
2. Next day: Console → **Billing → Credits** → the "Trial credit for GenAI App
   Builder" row. **Percent remaining must have moved off 100%.**
3. Same page, **Reports** → set *Group by* to **SKU** (not Service). The Vertex
   AI Search SKU should be present and the *Grounding with Google Search* SKU
   should have shrunk sharply.

If percent remaining is still exactly 100% after a day of real traffic, the
credit's SKU list does not cover these calls — stop and re-read the terms link
before seeding more sites.

---

## Open items

1. **The 50-pattern ceiling is hard, and the escape routes are closed.**
   Measured: attaching a second data store to an existing single-store engine
   returns `400 Engines with a single data store cannot add or remove data
   stores`; creating a fresh multi-store engine over two website stores returns
   `400 BasicSiteSearch data stores are not currently supported`. Going wider
   needs a **second search app and a second query per search** — twice the
   per-query cost, still roughly four times under grounding. `peer-web-2` exists
   from that experiment, holds 39 ready-made patterns, is attached to nothing
   and costs nothing; it is the input for that decision if it is ever taken.
2. **The events surface still occasionally hits its 25 s wall.** Seven of the
   last eight runs are green. The one red was a live-network timeout, which is
   the same failure mode this surface had on grounding (Ruling 76a) — narrowed,
   not eliminated. The next lever, if it recurs, is a fan-out-wide cap on
   concurrent page fetches rather than the per-query cap that is there now.
3. **The seed list is a budget spent by judgment.** Four university patterns
   (`yale`, `columbia`, `jhu`, `osu`) were evicted to make room for the four
   adjudicated conference hosts the benchmark locks. Both lists are named
   constants at the top of `scripts/setup-vertex-search.mjs`; changing the trade
   is an edit and a re-run.

## Rolling back

Delete `GOOGLE_VERTEX_SEARCH_ENGINE_ID` from `web/.env.local` and restart. Every
surface returns to grounding immediately; nothing else needs reverting.

To keep vertex but force one surface back onto grounding for a comparison run,
send `webSearch.provider: "gemini"` explicitly — an explicit preference always
wins over the default order.

## Related

- [SETUP_gemini_vertex.md](SETUP_gemini_vertex.md) — the model credentials this
  provider reuses.
- [vertex-search.ts](../web/src/lib/sources/vertex-search.ts) — the provider.
- [gemini-search.ts](../web/src/lib/sources/gemini-search.ts) — the grounding
  provider it sits in front of, and the shared resolution order.
