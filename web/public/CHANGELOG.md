# Changelog

All notable user-facing or infrastructure changes to Peer. Newest at the top.

## v0.10.1 — 2026-09-06

The loading skeleton catches up with the card.

It still drew the card from three releases ago: a single 820px column, a kind
badge and score chip up top, a 3px accent stripe, three body lines, and a
hairline footer with three action buttons. Every one of those has since left
the real card, so the load-in was a jump cut from one layout to another.

It now mirrors what renders: a three-column masonry the width of the feed,
each placeholder a cover card — a 16:9 plate on top (every real card carries
one), then meta, a serif-height title of one to three lines, two or three skim
lines, an author line. No buttons; the real ones are hidden at rest. Line
counts vary per card so the masonry is a masonry before the data arrives, and
the cards arrive with the same reading-order stagger the real ones use.

The component is shared with search, which already prints its own
"searching…" status; the "Brewing your daily briefing" header is a prop now
and search passes none, so the two messages no longer stack.

## v0.10.0 — 2026-09-05

Peer is a paper briefing. Events and jobs are gone from the product.

The founders' verdict, verbatim: "先拿掉 event 和 job 我们 focus 在 paper". This
release removes every user-facing surface for the two once-a-year verticals.
The library code underneath (`lib/events`, `lib/jobs`, `lib/opportunities`)
stays for one more release — see the last paragraph.

**Removed.** The `/events` and `/jobs` routes and their detail pages; the
`/api/events/*`, `/api/jobs/feed` and `/api/jobs/report` routes; the Events and
Jobs entries in the sidebar and mobile bar; the Events and Jobs topic lists on
the profile page and in onboarding; the Locations and Work rights profile
fields (both existed to filter jobs); the onboarding "Work rights" step — the
wizard is seven steps, not eight, and no longer asks for visa status before
research topics; the Adzuna and USAJobs connectors, which existed only to
widen job coverage. Tavily stays, described as what it now is: optional web
discovery for papers.

**Saved is a shelf.** It carried Papers / Events / Jobs segments and a To-do /
Done rail for applications and registrations; its own comment admitted papers
"have no completion action" and sat in To-do forever. It is a list of saved
papers now.

**The daily surface never asks for the other lanes.** `loadFeed` defaults to
`["papers"]`. The feed tile and the report page's "Related from your feed"
list are paper-only, which severs the last paper-side import of
`lib/opportunities/facets` from a rendered surface.

**Dead code swept.** Deleting the consumers orphaned the event/job report kit
(`ReportSection`, `WhyPeerSentThis`, timeline, fact tiles, badges), five UI
primitives that only the event and job cards used, the dashboard and deadlines
board, the visa country picker, the surface-topics composer, the feed "more"
tile, the onboarding tour, and the decorative logo halftone. Seventeen test
files went with their subjects, including the 1,725-line typography test that
asserted Georgia point sizes for the job and event reports. 66 files, −16,801
lines.

**Kept on purpose.** `/api/jobs/dispatch-digests` — "jobs" as in cron jobs.
It is the daily email entry point, its URL is pinned in
`.github/workflows/digest-cron.yml`, and renaming a production cron endpoint
has no product benefit.

**Still to do — the library.** `lib/events`, `lib/jobs` and `lib/opportunities`
are now unreferenced by any product surface but cannot be deleted wholesale:
the paper pipeline imports five files from `lib/opportunities` (`shared`,
`pool-cache`, `pool-cache-runtime`, `page-fetch`, `facets`), and the event/job
fields remain on `UserProfile`, in the feed store, in `/api/profile`'s column
map and in the Supabase schema. That is a separate, deliberate extraction.

## v0.9.4 — 2026-09-05

The feed card is a cover card.

**The left stripe is gone.** The 3px accent rail on every card's left edge
encoded paper / event / job on a mixed feed. On a papers-only feed it was the
same mark on every card — decoration, and the same kind of chrome the rest of
this series has been removing.

**The plate bleeds.** It used to sit inset inside the card with padding around
it and a radius of its own, which reads as "a box with an image in it". It now
runs to the top edge and takes the card's own corners, and the text block
below it has real air.

**The title is set in the display serif.** It is the specimen's name, and it
now shares a typeface with the terms on the plate above it — plate and title
read as one typographic system. Sans is reserved for labels: the venue line
and the authors. The footer hairline is gone; spacing separates.

**The mat is under both fills, with its own ink.** The off-white mat from
v0.9.2 had never actually reached the browser (see below), and once it did the
typographic plate's near-white type vanished on it. The plate now has its own
ink tokens, relative to the mat rather than the card: on dark, dark warm ink on
off-white; on light, the ordinary text colours on a 4% tint. Figure and type
sit on the same ground, which is what makes the two fills read as one slot.

Infra note: Turbopack's persistent dev cache in `.next/dev` was serving a
compile from before the latest `globals.css` edit, and a restart re-read the
cache rather than the file — each restart was one edit behind. Clearing
`.next/dev` fixed it.

## v0.9.3 — 2026-09-05

The sidebar is the spine of a daily ritual, not a list of pages.

**Today is the primary object.** The one thing that changes every day — the
date, how many papers came, how many are unread — now sits at the top of the
sidebar as a block, and that block is the Feed link. "SAT · SEP 5 / Today 10 /
10 unread", and when everything is read, "all read · back tomorrow".

**Frequency is visible.** Search and Saved are reading tools and sit as plain
rows. Events and Jobs sit under their own quiet OCCASIONAL label at a lighter
weight; a once-a-year need should not look like a daily one. This is the same
hierarchy the home page encodes, carried into the nav. Profile is anchored to
the bottom.

**The active state is a rail that travels.** The active nav item used to be a
card — `bg-surface shadow-card`, the same elevation as a content card — which
put chrome and content on one level. It is now a 2px accent rail that slides
to wherever you went, positioned from the DOM in a layout effect and written
back as CSS variables, so moving it never re-renders anything.

**Chrome is quieter.** Six keyboard-shortcut hints were permanently on screen;
they now appear only for the row under the pointer or keyboard focus. The
footer — three unrelated things in a bordered strip — is one line: a sync dot,
a single ? key, the version.

Also: the Events and Jobs page headers read "0 jobsin today's pool" — JSX
swallowed the space after an expression. Template literals now.

## v0.9.2 — 2026-09-05

Every card has a plate.

**The window is universal.** Roughly four papers in ten yield an extractable
figure, and "some have an image and some don't" was the loudest thing wrong
with the feed. There is now one 16:9 window on every card, at the same offset,
always filled. When the extractor finds the paper's own figure, the figure
fills it. When it does not, the window holds the paper's own terms set in the
display serif over a numbered grid, closed by a rule. Two fills, one slot.

**The terms are the paper's, and they are checked.** The source field is
`matchedKeywords ∪ tags`, which is hostile in two directions: `matchedKeywords`
ARE the reader's required topics, so unfiltered they would put the reader's own
query on all ten plates; `tags` are OpenAlex concepts, which mis-disambiguate
often enough to matter — a live protein-structure briefing carried "Generative
grammar" and "Representation (politics)". Allocation now runs once across the
whole briefing and a term must survive four gates: it is not the reader's own
topic (or a substring of one), it is not an arXiv filing code, it is long
enough to set at display size, and **it appears somewhere in the paper's own
title or abstract**. That last gate is what removes mis-disambiguations: a
concept the paper never mentions is not a concept the paper is about. No term
may headline more than two cards.

**Figures are matted, not bled.** `object-contain` on a mat rather than
`object-cover`, because cropping a scientific figure destroys its axis labels.
On dark themes the mat is off-white, so a white-ground chart reads as paper
instead of glaring like a lightbox, and a colour figure keeps its colours.

## v0.9.1 — 2026-09-05

Elevation and motion.

**The shadows were soft-UI, and soft-UI cannot work here.** Neumorphism reads
as extrusion only when the object and its ground are the same material and the
ground is a mid-tone that can travel both ways. The dark families have no such
ground — bg and surface sit about four points of L* apart — so the highlight
had been cut to 4% opacity and the pair had degenerated into one 16px black
smudge with no contact edge. Hover made it worse: blur went 16px to 26px and
black 45% to 60%, so a card went *softer* under the pointer instead of lifting.

Replaced with three layers doing three jobs: a 1px rim for separation, whose
contrast is anchored to the surface so it stops depending on how dark the
ground is; a short-offset contact layer; and a wide ambient layer with heavy
negative spread, which is what keeps a 26px blur from becoming fog.

**Motion.** Cards now arrive staggered in reading order — the plumbing had been
in globals.css all along and the feed had never used it, so all ten faded up on
one frame, which reads as the page reflowing rather than as a delivery.
Figures cross-fade in instead of being inserted. The 500ms hover zoom on
figures is gone; a Ken Burns on a scientific plot reads as an advertisement and
scales the axis labels.

**Thirty icon buttons at rest.** Ten cards each showed three. The action row
keeps its footprint but appears for the card under the pointer, and stays
permanently visible on touch, on keyboard focus, and on a card whose state is
already on.

**A read paper stays readable.** The read state was a blanket 70% opacity over
the whole card, which faded the title and the summary and, on dark, dragged the
card toward the background. Only the cover recedes now.

**Figures that cannot be shown no longer leave a hole.** Finding a figure URL
is not the same as being able to display it — biorxiv answered 401 for every
one. Sending no referrer fixes those, and anything still failing drops its
cover rather than reserving an empty 16:9 box.

## v0.9.0 — 2026-09-05

The briefing has pictures, and ten different papers in it.

**Papers show their own figures.** Peer has always had a rule-based figure
extractor and a route built for exactly this — `/api/figure`'s own header reads
"hit per-card after feed loads" — and no card had ever called it. The feed was
ten identical blocks of text.

It was also looking in the wrong place: the extractor asked ar5iv alone, and
ar5iv now serves a stub for recent preprints. Measured across seven papers from
one briefing, ar5iv returned "no figures" for every one while `arxiv.org/html`
carried 26 `<figure>` elements for the same ids. arXiv's own rendering is tried
first now, with ar5iv kept as the fallback for older papers it still covers.
Extraction is pure scraping with no model call, so figures appear on a
deployment with no credentials configured.

**The grid is masonry.** Roughly four papers in ten carry an extractable
figure, so card heights genuinely differ. A fixed grid either ragged-edged
every row or reserved dead space on the six cards without an image.

**One researcher can no longer take the whole briefing.** A live feed showed
six of ten slots held by the same author, all from the same repository.
`diversify` caps per topic, and its key is the first three title tokens —
"Graph Neural Networks for Protein Structure Prediction" and "Quantum Machine
Learning Protein Structure Prediction" hash differently, so the cap never
fired. There is now a per-author cap of two.

Worse, that pass had never run at all for most users: it sat behind
`requestedTier >= 1` while the client only ever sends 0 or 2. It is
deterministic local computation — no model, no network — so it now runs at
every tier, which is where PRODUCT_DIRECTION's Tier 0 floor puts it.

**Card text says what the paper found.** The skim line was `summaryIntro`, the
first one or two sentences of the abstract, which in a paper is the motivation
and reads identically across a field: three cards in one briefing opened with
three ways of saying protein structure prediction is hard. Everything that
distinguished them sat unread in `summaryResultDiscussion`. The line is now
chosen from the whole abstract, preferring sentences that carry a claim or a
quantity and avoiding both boilerplate openers and sentences whose reference
dangles once lifted out of context.

## v0.8.2 — 2026-09-04

Feed card: the hierarchy now encodes something.

The three loudest slots on a card all held information that was identical
across the whole briefing, while the one field that separated two papers was
in the smallest, faintest, most truncated line.

- **The "PAPER" badge is gone** — on a papers-only feed it said nothing, and it
  said it twice: `paper.source` repeated it at the bottom of every card as the
  literal string "other", which is what that six-value enum ("arxiv" | four ML
  conferences | "other") returns for everything outside those venues.
- **The match percentage is gone.** It spanned 59–64% across the ten cards and
  occupied the top-right corner. Papers have no relevance floor, so it could
  not be used to choose between them either.
- **"Why you · <topics>" is gone from the card.** Its first entry was the
  reader's own required topic echoed back, on every card; the remaining
  entries were OpenAlex concept tags that frequently landed in the wrong
  domain ("Representation (politics)" on a protein-structure paper). Its
  deduplication was case-sensitive, so one card read "protein structure
  prediction, Protein structure prediction, Protein structure". The statement
  it was trying to make is true of the whole briefing, so it now appears once,
  in the page header.
- **Venue and age lead instead**, which is what actually differs: "Scientific
  Reports · 8d ago" against "Zenodo · 6d ago". The published date was already
  on every paper and had never been shown.
- **Venue drops the host institution.** OpenAlex returns "Zenodo (CERN European
  Organization for Nuclear Research)"; at card width that truncated mid-word
  and pushed the date off the line entirely.
- The kind badge still appears for a **Discussion**, so a forum thread is never
  mistaken for peer-reviewed work. That was the badge's real job.

## v0.8.1 — 2026-09-04

Removing things that were not true.

**The contribution calendar was inventing data.** When the real per-day reading
API returned nothing — which is every signed-out visitor, and any fetch error —
the grid fell back to `synthesizeActivity()`, a seeded pseudo-random fill
derived from the total activity count, and gave each invented cell a tooltip
reading "N interactions". The streak badge counted those invented weeks. For a
demo shown to signed-out visitors this presented fabricated numbers as the
user's own history. The function is deleted; with no real data the panel now
says so.

**The persona quiz no longer claims to shape your feed.** Onboarding said "It
helps shape your feed". Its stored result has exactly two readers — the quiz's
own hydration and an onboarding checkmark — and reaches neither the feed,
scoring, nor reports. The copy now says what is true.

**The onboarding tour no longer has a step that cannot fire.** Step 3
spotlighted `[data-tour="highlights"]`, an attribute no element carries, so it
was silently skipped and the counter jumped 2/4 to 4/4.

**`/api/test-digest` is development-only.** It runs the full feed pipeline and
sends an email while bypassing digest_enabled, frequency and time-of-day, and
was reachable by any signed-in caller on a deployed instance.

**Paper titles are legible immediately.** The feed card wrapped every title and
summary in a ~600ms character-scramble reveal — a delay applied to the exact
text the reader came for.

**Dead code.** The unused `DailyDigest` panel and its loading progress bar are
gone; only the headless `PaperDigestLoader` was ever mounted.

## v0.8.0 — 2026-09-04

The daily surface is papers, and only papers.

**The home page.** The default landing tab was `dashboard` — a metrics page
containing zero items of content: four count tiles (Papers today / Events today
/ Jobs today / You saved), a 14-day arrival-volume chart, a "what you're
holding" tracker, a topic-coverage panel and a deadlines board. All removed.
The home page is now the briefing: how many papers arrived, how many are
unread, when it last synced, and the papers.

**Papers, events and jobs are no longer peers.** They were concatenated into
one list, sorted by relevance score alone, and written into one grid — so a
job posting scoring 0.81 outranked a paper scoring 0.79 and occupied an
identical cell. Events moved to `/events`, jobs to `/jobs`. They also no longer
run on every home-page tick: `loadFeed` takes a `lanes` option and the daily
surface asks for `["papers"]`. The progress bar labelled "Finding today's
papers" was 30% driven by conference scrapers and job boards.

**Manual controls left the automatic feed.** The feed route carried eleven
composers exposing fourteen typeable fields. Typing two characters into the
search box deleted the briefing outright. Search now lives at `/search`; the
briefing is untouched by anything done there.

**Credentials have a home.** The AI-provider key, deep-report toggle and
Data-API keys had no section on `/profile` at all — they lived only in the
one-time `/welcome` wizard and pinned permanently to the feed, which is why the
feed page ended up doubling as the settings page. They are on `/profile` now.

**Also.** Persona left the primary nav (its quiz result is read by nothing).
The sidebar version string is read from one constant instead of being
hardcoded in JSX, where it had drifted to v0.1.0 while this file reached
v0.7.22.

Versioning is `0.x.y` until v1; `y` for fixes/chore, `x` for features.

---

## v0.7.22 — 2026-05-19
**Profile page visual cleanup + 4 new color themes (Sage / Lavender / Slate / Plum)**

Two passes on profile UX.

**(1) Visual cleanup of `/profile`.** Removed the "READER" eyebrow label above the user's name in the identity band (no info, pure decoration); deleted the entire dashboard-card footer (`Tuning any time` kicker + `Adjust signals →` button) which was a third redundant entry point to edit mode alongside the header `Edit` pill and inline `adjust` link; shortened the long `Either — surprise me` industry label to `Either` so the career caption no longer overflows the row with `PhD Year 3 · Either · School / Lab`; hid the Reading card's `Shareable reader card` footer (two disabled `Copy card` / `PNG` buttons next to a "Coming soon" badge — features not built yet, so dead UI removed); fixed the header signal counter from `0 of 5` → `0 of 4` to match the four visible `SignalRow` entries (the previous count included `preferredMethods` which has no editor anywhere).

**(2) AppearanceCard rewrite — instant-apply + 4 new themes.** Killed the draft-state + `Select color` / `Cancel` two-step confirm pattern — clicking a theme card now applies immediately via the existing `updateColorTheme` store action. Header dropped the redundant right-side `System` pill and the "Switch palettes directly here. No edit mode required." filler subtitle. Cards dropped the redundant `Cream palette` / `Black palette` body lines and the gray "almost-checked" icon on unselected cards (now: only the selected card shows the orange check). Picker restructured: themes are tagged with a `mode: "auto" | "light" | "dark"` in `colorThemeOptions` and rendered as three labeled groups — `Auto` (System), `Light` (Cream / White / Pink / Blue + new Sage / Lavender), `Dark` (Black + new Slate / Plum). Grid is `grid-cols-3 lg:grid-cols-6` per group so light themes fit one row on desktop.

Four new themes ship with full token sets (bg / bg-secondary / surface / surface-hover / border × 2 / heading / text × 3 / accent / link / tag / peach / yellow × 2 / red / skeleton × 2) in both `globals.css` (declarative `[data-color-theme="X"]` blocks) and `lib/theme.ts` (runtime inline-style overrides). **Sage**: pale green paper `#eff4ea` with deep-teal `#0f766e` accent and olive `#65a30d` tag. **Lavender**: soft purple `#f5f3fc` with violet `#7c3aed` accent and fuchsia `#c026d3` tag. **Slate**: GitHub-dark inspired `#0d1117` with sky-blue `#58a6ff` accent and mint `#56d364` tag. **Plum**: deep `#1a0e1f` with light-violet `#c084fc` accent and pink `#f0abfc` tag.

**(3) Venue badges follow the theme.** `search-result-card.tsx` previously hardcoded four hex colors for source-type badges (`#b32f2f` arXiv red, `#2d6a8a` journal blue, `#7a4ec1` conference purple, `#1f7a4d` open-access green). Replaced with theme tokens — arXiv → `accent`, Journal → `link`, Conference → `tag`, Open Access → `peach` — so the four badges remain mutually distinguishable but the palette now shifts with the active theme. Cleanup also removed three orphan helpers in `profile/page.tsx` (`previewColorTheme`, `IconPalette`, `IconShare` / `IconDownload`) and the now-unused `applyColorTheme` import. File shrunk 2484 → ~2360 lines.

## v0.7.21 — 2026-05-19
**Paper thinking surface — structured working canvas at `/papers/[id]/surface`**

New mode on the paper detail page: a `Surface` button in the `ActionRow` (alongside `Save` / `Cite` / `Like`) links to `/papers/[id]/surface`, which renders the paper as a structured working canvas instead of a long-form report. The route is backed by `lib/papers/surface-model.ts` (498 lines) which derives a set of `SurfaceCell` entries from `Paper` + `UserProfile` — title, key facts, format detection via `FORMAT_TERMS`, method detection via 21 `METHOD_PATTERNS` regexes, reading-time at 220 wpm, tag extraction capped at 8 — and `components/papers/paper-thinking-surface.tsx` (627 lines) which lays the cells out as a focused workspace. The surface renders in an intentionally isolated dark palette (hardcoded CSS vars on the component, does not follow the app color theme) for distraction-light reading; this is by design — switching the app theme should not change the working canvas.

## v0.7.20 — 2026-05-19
**Search command bar: briefing status as docked context chip + refresh affordance**

Codex pattern step 2 — pulling the briefing status into the search-input cluster so the box reads as a stateful command surface, not a blank prompt. `BriefingStatus` moved out of the page header into the search section, where it now sits as a `rounded-full` pill **directly above** the rounded-3xl input box (mb-2 gap, no longer the previous 24px header margin) so the two surfaces feel like one connected unit. Restyled the pill content: small accent dot at the left (the "● live" indicator pattern Codex uses for ongoing context), inline counts (`87 items · 12 unread`), synced-age suffix, and a new refresh icon button on the right that calls `loadFeed` and spins while in flight — same handler the `FeedMoreTile` already uses, so the affordance is now reachable from the top of the page too. Closed state ("Briefing closed · all N reviewed · back tomorrow") uses the same pill chrome with an accent-tinted fill instead of the previous heavier `bg-accent-dim` block. Secondary text (`synced 2m ago`, the reviewed-count tail) hides below the `sm` breakpoint so the pill stays single-line on phone. Pure UI; no change to feed loading, refresh semantics, or `briefingItems` shape.

## v0.7.19 — 2026-05-19
**Daily-briefing loading skeleton: invisible on dark themes → proper paper-card placeholders**

The three loading cards on Discovery were rendering as flat dark rectangles with no internal structure on the `black` theme (and `system` in dark mode). Root cause: `.skeleton-shimmer` was a hardcoded `rgba(24, 24, 27, 0.04 → 0.10)` overlay — dark ink on dark surface, so the four inner placeholder bars per card were technically present but visually black-on-black. The user just saw three empty boxes while the feed loaded for 2-3s.

Fix in two passes. **(1) Theme-aware shimmer** — introduced `--color-skeleton-base` / `--color-skeleton-highlight` tokens, defined per theme: dark-ink overlays on cream / white / pink / blue / light-system (0.05 → 0.12 opacity), light-ink overlays on black and dark-system. `.skeleton-shimmer` now interpolates these via CSS vars, so the same component reads correctly on every palette. Added a `prefers-reduced-motion` branch that drops the animation and renders a static tint. **(2) Skeleton structure** — rewrote `LoadingSkeleton` in `components/ui.tsx` to mirror the real `PaperTile`: top-left accent stripe (matches `KindStripe`), two-pill header row (badge + score chip), two-line title with varied widths, one-line author/venue, three-line relevance reason, and a footer with source label + three icon buttons separated by a top border. Each of the three cards gets slightly different line widths (86/72/92% etc) so the stack reads as distinct papers rather than three identical bars. A small "Brewing your daily briefing" status with a pulse + ping dot sits above the cards as a one-line activity signal. Staggered `animate-fade-in-up` (0/90/180ms) replaces the previous bare drop-in.

## v0.7.18 — 2026-05-19
**Search command bar: send button + two-zone tools + heavier surface**

Codex-inspired follow-up to v0.7.13. Three changes. **(1) Surface weight** — corner radius bumped from `rounded-2xl` to `rounded-3xl`, added a 1px border on the cream theme token plus a layered close/far shadow that thickens on focus-within, so the bar reads as one elevated object rather than a flat card. **(2) Send action** — new accent-orange circular send button on the right of the tools row; click or `Enter` skips the 400ms auto-search debounce and fires the request immediately, with a spinning glyph during flight and a disabled cream state below 2 chars. **(3) Two-zone tools row** — the four existing pill controls (AI search / AI key / Deep report / Tavily) now sit in a left "modes" zone with the send button on the right, giving the bar a clear left-to-right rhythm (what to use → go) instead of a single wrapping pill row. Bonus: the `clear` text button shrank to a small × icon inside the input. No behavior change to any pill or expanded panel — pure UI pass.

## v0.7.17 — 2026-05-18
**Feed: 4.4s → 2.7s cold / 0.7s warm (source pipeline overhaul)**

Daily-briefing first paint felt slow because `/api/feed` was averaging 4.4s end-to-end with constant `[openalex] 400`, `[semantic-scholar] 429`, `[pubmed] 429` spam in the server logs. Root causes were stacked: (1) every source fanned out 4–6 generated queries **sequentially** with an 8s per-call timeout, so one slow query stalled the whole source; (2) no 429 backoff anywhere — semantic-scholar and pubmed just gave up and moved on, but only after eating their full quota of attempts; (3) OpenAlex 400s came from punctuation in the generated phrases (`{}[]:;` from `phrasesFromText` leaking through to the `search=` param); (4) Tavily discovery was awaited *before* source fetch even started, adding a serial 1–2s; (5) `Promise.allSettled` over sources had no outer wall, so one hung source could drag the response past 10s.

Five-front fix in one pass. **(A)** OpenAlex search terms are now sanitized (strip `"!?{}()[]\\^~*:;` and unbalanced quotes), with the response body logged on non-ok so a future 400 is debuggable in one read. **(B)** New shared `sourceFetch` helper (`lib/sources/_fetch.ts`) wraps every academic-source HTTP call with one 429-aware retry that honors `Retry-After` (capped at 1.5s), plus a tighter per-call timeout (6s instead of 7–8s). **(C)** Pipeline now kicks off `runTavilyDiscovery` in parallel with source fetch via `Promise.all` instead of awaiting it first — Tavily still feeds `connectorStats` but its boost queries no longer block the critical path. **(D)** Per-source query fan-out capped (openalex/arxiv/s2: 6 → 3, pubmed: 3 → 2, dblp: 4 → 2) and queries run in parallel inside each source via `Promise.allSettled`, so a source's wall time is now `max(query)` instead of `sum(queries)`. **(E)** New `withSourceTimeout` race in `feed/pipeline.ts` enforces an 8s hard wall per source so a hung adapter can't drag the whole response. Plus a defensive type-coerce in `cleanDisplayText` so a non-string field (e.g. dblp returning `year` as number) no longer throws `text.replace is not a function` mid-map.

Measured end-to-end via three repeated curl POSTs to `/api/feed` with `{topics:["large language models","retrieval augmented generation","graph neural networks"]}`: **cold 2.7s, warm 0.65–0.69s**, all five sources returning items (`openalex:30, semantic_scholar:10, arxiv:30, dblp:30, pubmed:27`), zero `errors` entries in the response meta.

## v0.7.16 — 2026-05-05
**Hotfix: search filters were silently ignored**

`filtersToApiQuery` was emitting OpenAlex-native params directly (`sort=cited_by_count:desc`, `filter=open_access.is_oa:true,cited_by_count:>10`), but `/api/papers/search` reads app-level keys (`sort` ∈ `relevance|cited|newest`, plus `oa`, `cites`, `from`, `to`, `src`, `venue`) and composes the OpenAlex `filter=` clause server-side. The mismatch meant every chip in the FilterBar updated state and the URL fine, but the request that left the browser carried params the server didn't recognize — results came back identical to an unfiltered search. Rewired the helper to emit the app-level keys the route actually reads. End-to-end verified: `sort=cited&cites=100&oa=1` now returns highly-cited open-access works (75k+ citations vs. the relevance baseline's 29k).

## v0.7.15 — 2026-05-05
**Mobile: hard-stop sideways scroll + break-word in paper body**

Some paper-detail summaries contained long unbreakable tokens (concatenated DOIs, sequence IDs, undbroken acronyms) that pushed the right edge of the body card past the viewport on phones, clipping the last word and giving the impression that the page itself was scrolling sideways. Two-layer fix: `overflow-x: hidden` on `body` so no descendant ever drags the page wider than the viewport, and `break-words` on the report-row body paragraph so within the card the text wraps even at unbreakable strings instead of being clipped at a flush right edge.

## v0.7.14 — 2026-05-05
**Discovery: lighter "Tuned for" row**

`MetaRow` was sitting in its own beige-ish card (`bg-bg-secondary/35` rounded-xl) and rendering up to seven topic / method / venue chips, which on most profiles wrapped onto two lines and added a third visual block under the greeting. Dropped the card surface entirely so the row reads as inline text — `Tuned for` label + chips + a smaller pencil edit affordance — and capped visible chips at five with a quiet `+N` overflow indicator. Chip dimensions trimmed (h-6 → h-5, 11.5px → 11px, tighter padding) so five fit on one row at typical viewport widths. Tone alphas eased from `/100` to `/70` so chips read as soft signals rather than hard tags. The row's role unchanged — clicking it still goes to `/profile` and the empty-state CTA still surfaces when no topics are set.

## v0.7.13 — 2026-05-05
**Discovery header: ChatGPT-style command bar + lighter greeting**

Reworked the top of the Discovery page from a heavy stack — big editorial greeting + a search input + three side-by-side `AUTO SEARCH` / `AI KEY HOOKUP` / `TAVILY HOOK` cards — into one cohesive command bar that mirrors how a chat-style input organizes its modal tools. The search input and three controls now share a single rounded surface: input on top, a row of compact tool pills below (`Auto/AI search`, `AI key`, `Tavily`), and an inline expanded settings panel that reveals only when a pill is clicked. Single-tool-open semantics (one shared `openTool` state) replaced the two independent `aiProviderOpen` / `tavilyOpen` booleans, so toggling between AI key and Tavily settings no longer leaves both expanded at once. Active state on each pill keeps a subtle accent tint when a non-default value is set so users can see at a glance which tools are customized. Greeting headline drops from 36/44px to 26/32px and the date row from 21/24px to 14/15px — the page now opens with a confident statement of state rather than a banner that dominates the first viewport. Same applies to the Search-mode title (34/38px → 24/28px). All wiring (loadFeed gating, profile updates, Tier display, helper copy, gating-by-aiPaperSearchEnabled) preserved.

## v0.7.12 — 2026-05-05
**Mobile polish: paper detail page (action row, stats, figure, padding)**

Paper detail (`/papers/[id]`) tightened up on phone-sized viewports across four fronts. (1) **Action row** — `Read paper` plus `Save / Cite / Like / Not interested` previously stacked into 2–3 wrapped rows because every pill was h-11 with `pl-3.5 pr-4 text-[13.5px]`; now they collapse to h-9 / `px-3` / 12.5px on mobile and the primary CTA drops a half-step too (h-10 / px-4 / 13.5px), so the whole action set sits two rows max on a 375px screen. Desktop sizing unchanged. (2) **Stats strip** — `PropertyStrip` keeps its 2-col mobile grid but the gap shrinks (gap-x-3 gap-y-3 vs 5 / 4) so the six properties feel less marooned. (3) **Method/result figures** — `compact` and `hero` `PaperFigureFrame` variants now cap height on mobile (`max-h-[300px]` / `max-h-[360px]`) and lower the min-h floor a notch, so a square pie chart no longer eats half the viewport. `object-contain` keeps proportions; `sm:max-h-none` drops the cap above mobile. (4) **Article container** — `px-6 py-14` becomes `px-4 sm:px-6 py-10 sm:py-14`, reclaiming 16px of horizontal space and trimming an extra 32px of empty top padding on phones. Reading flow gets noticeably calmer below the fold; nothing changes on tablet/desktop.

## v0.7.11 — 2026-05-05
**Hotfix: mobile nav tabs were hidden under the floating account menu**

The fixed `top-3 right-3 z-[55]` UserMenu / GithubStars wrapper in `app/layout.tsx` lived above (z-wise) the mobile top bar (z-50), so on narrow viewports the right-side `Saved / Persona / Profile` tabs sat directly underneath the "Aspen Labs" pill + GitHub-star pill and were unreachable — only `Feed` was visible. The previous mobile-polish pass (v0.7.10) tightened the nav padding which reduced the unintended margin and made the collision suddenly very obvious. Fix: scope the floating wrapper to `hidden lg:flex` so it only renders on desktop, and inline `<UserMenu compact />` inside the mobile nav at the right edge so signed-in users still get the avatar + sign-out, signed-out users still get the GitHub sign-in CTA. Layout on mobile now: `[Logo] [Tabs justified to the right of the logo] [UserMenu]`. Tab font dropped one notch (13 → 12.5px) and active-underline geometry tightened to keep all four tabs comfortable next to the avatar on a 375px viewport.

## v0.7.10 — 2026-05-05
**Mobile polish: top bar + feed summaries**

Mobile top bar tightened — height drops from 56px to 48px, horizontal padding from 24px to 16px, the brand wordmark hides on the narrowest phones (logo alone serves as home), and the active tab now gets a 2px accent underline so the current section is obvious at a glance instead of relying purely on weight/color shifts. Tab gap shrunk so all four tabs fit comfortably alongside the brand on a 375px viewport with breathing room left over. `<main>` top padding adjusted to match the new bar height. Daily-digest header buttons collapse to icon-only on mobile (Regenerate / Listen labels reappear at sm+) and the section's horizontal padding eases from 28px → 20px on small screens, reclaiming text width without crowding content. Feed tile summaries (paper / event / job) bumped from 12.5px → 13.5px on mobile with slightly looser line-height for single-column readability; desktop sizing unchanged so dense grid stays dense.

## v0.7.9 — 2026-05-04
**Persona: actually persist the quiz result**

`/persona` already advertised "Saved locally only — not uploaded" in the result footer, but the quiz result lived in component `useState` only — close the tab or refresh and it was gone, so the footer's promise was a lie. Persist now: on completion the scores are written to `localStorage` under `peer:persona:v1`, on next mount the page hydrates from there and re-derives the persona via `pickPersona` (rather than caching the persona blob, so future tweaks to persona names / blurbs / portraits surface automatically). Retake clears the storage. SSR-safe (`typeof window` guards), tolerant of quota/private-mode failures (silent fall-through to a fresh quiz). Sync to the server profile is a separate follow-up tied to the auth track.

## v0.7.8 — 2026-05-04
**Profile reading calendar: align client bucketing to server's UTC days**

The contribution-style calendar on `/profile` was always rendering blank cells even when `read_items` had data. `/api/read?aggregate=daily` groups reads by `toISOString().slice(0,10)` (UTC YYYY-MM-DD), but `useDailyActivityCells` was building its lookup keys from a `Date` set to *local* midnight then formatted via `toISOString()` — which yields the UTC string of local-midnight, off by a day for any non-UTC user. Reads timestamped late local-evening (= early next-UTC-day) bucketed under tomorrow's key on the server but were looked up under today's key on the client — every cell missed, calendar stayed empty. Switched the client to `setUTCHours(0,0,0,0)` and millisecond-arithmetic day stepping so both sides agree on day boundaries.

## v0.7.7 — 2026-05-04
**Hotfix: prod page-load crash + read-tracking 500s**

Two unrelated bugs were taking the production deploy down. (1) `applyColorTheme` was calling `Object.entries(themeVars[theme])` without guarding for the case where `theme` is `undefined` — which it was for every existing user, because the `profiles.color_theme` column declared in `schema.sql` had never actually been applied to the live DB. The throw bubbled up through React render and Chrome surfaced "This page couldn't load". Added a defensive `if (!vars) return` so unknown / missing themes silently fall back to the CSS defaults instead of crashing the tree. (2) `/api/read` was upserting into `read_items` to refresh `read_at` on repeat reads, but the table had no `UPDATE` RLS policy — so the conflict-resolution path always failed with "new row violates row-level security policy". Added the missing `users update own reads` policy (USING + WITH CHECK on `auth.uid() = user_id`), matching the pattern already used by `saved_items`. Schema source-of-truth in `web/supabase/schema.sql` updated to keep parity. The `profiles.color_theme` schema drift remains — that's a separate auth/Supabase-track follow-up; the defensive code makes it non-blocking.

## v0.7.6 — 2026-04-29
**Persona result: editorial side-by-side layout + 2 more portraits**

Result page goes from a stacked column to a two-column editorial layout — portrait (with cream gradient frame, soft shadow, italic "Profile sketch" caption) sticks to the left on desktop, the title / tagline / blurb / look / axes flow on the right at a comfortable reading width. Title bumps to 52px Instrument Serif, tagline gets italic Source Serif, "Spotted at the conference like" header now sits between hairline rules — a touch more magazine, less form-result. Mobile collapses cleanly to a single column. Two additional portraits seeded: `lab-lead.png` and `synthesist.png`. Five remaining slots open.

## v0.7.5 — 2026-04-29
**Persona: collapse to the canonical 10 + best-fit assignment**

Quiz results now always land on one of the 10 curated PAIR personas (or the flat-profile Polymath fallback). The 10 SOLO names — "The Bench Operator", "The Theorist", "The Polymath" (specialist-pole), "The Builder", "The Provocateur", etc. — were a mid-state fallback for users whose top-two combo wasn't in the curated set, but they had no portraits and felt like a "you're not really any of these" cul-de-sac. Removed. New pickPersona scores all 10 PAIRs by alignment with the user's axis values (sign-aware sum of the two pole projections) and picks the highest-fit one — so a Generalist+Solo profile, which previously fell to "The Polymath" SOLO, now lands on whichever curated PAIR best matches that direction (typically Synthesist or Field Crosser). 11 possible outcomes total (10 PAIRs + flat Polymath), every named result has a slot for a portrait. Renamed the misseeded `bench-operator.png` → `bench-builder.png` since the visual fits Bench Builder perfectly and Bench Operator no longer exists as a result.

## v0.7.4 — 2026-04-28
**Persona art: portrait above each result**

The `/persona` result now renders a portrait above the persona title. Convention is purely file-system based — drop a PNG at `web/public/persona/<slug>.png` (slug = persona name, lowercased, leading "The" stripped, non-alphanumerics → dashes — so `bench-operator.png`, `theoretical-provocateur.png`, `group-builder.png`, etc.) and it appears next deploy. No code change needed per persona; missing images render nothing (the `<img>` errors silently). Seeded the first two from existing references — Bench Operator and Group Builder.

## v0.7.3 — 2026-04-28
**Persona: ship the whole feature + add MBTI-style "look" to result page**

Two things in one. (1) The `/persona` quiz that v0.7.0 announced was never actually committed — `web/src/app/persona/`, `web/src/components/persona/`, and `web/src/lib/persona/` only existed locally and Vercel had no idea about them. Tracked all of them now (same fix shape as v0.7.1 — other agent's WIP wasn't `git add`ed). (2) Added a `look` field to every Persona — concrete MBTI-style appearance for all 10 curated PAIR_NAMES, all 10 SOLO_NAMES (with poles having distinct visuals: e.g. The Bench Operator gets "olive flannel, top-knot, dead-project sticker laptop, coffee, anti-glamour"), and the Polymath flat fallback. New "Spotted at the conference like" section on the result page renders the look as an italicized accent-bordered pull-quote between the blurb and the axes bars. Same data, more recognizable.

## v0.7.2 — 2026-04-28
**Affiliation: school autocomplete + lab field**

The Affiliation row in the profile editor splits into two fields. **School / org** is now an autocomplete-backed input — type to filter ~150 curated entries (top global research universities, CMU/MIT/Oxford/Tsinghua/etc. + industry research labs like Anthropic, DeepMind, FAIR), with substring highlighting on the matched portion, ↑/↓/Enter/Tab keyboard nav, and free-text fallback for anything not in the list. **Lab / group** is a separate plain-text field below for the unit within the org (CSAIL, HCI Group, Vision Lab, your advisor's group). Both are persisted on the profiles row and surface in the read view as `MIT / CSAIL`. New `lab` column on profiles table; schema.sql + the /api/profile mapping updated to round-trip.

## v0.7.1 — 2026-04-28
**Fix: ship the missing search filter modules**

Production deploys had been failing since v0.6.8 — the search filter feature committed `page.tsx` imports for `@/components/search/filter-bar`, `@/components/search/filter-chip`, `@/components/search/more-filters-panel`, and `@/lib/search/filters`, but the directories themselves were never `git add`ed. They existed locally and worked in dev but Vercel's clean checkout couldn't resolve the imports → every commit since v0.6.8 returned the old deploy. Added the four missing files (752 lines) so the production build succeeds and v0.6.9–v0.6.14 actually reach users.

## v0.7.0 — 2026-04-28
**Academic persona quiz at /persona**

A short forced-choice quiz that maps a researcher across five continuous axes — Empirical ↔ Theoretical, Specialist ↔ Generalist, Solo ↔ Collaborative, Builder ↔ Critic, Formal ↔ Narrative — and names a persona from the two strongest signals (e.g. "The Theoretical Provocateur", "The Bench Specialist", "The Synthesist"). Jung-style multi-dimensional rather than MBTI's 16 boxes: every axis is a value in [-1, +1], not a category, and the persona name reflects a combination, not a verdict. 15 questions, 3 per axis, no Likert middle ground. Result card shows axis bars with score markers, a tagline, and a prose blurb in the editorial serif. Saved locally only — no upload. Accessible from the sidebar (or `g x`). First step toward the broader "input your paper, get an academic style profile" feature; URL/PDF analysis comes next, this seeds the framework.

## v0.6.15 — 2026-04-28
**Paper figure adopts the image's natural aspect ratio (no more cropping)**

`PaperFigure` was forcing every figure into a fixed 16:8 (hero) or 16:9 (compact) frame with `object-cover`, which silently cropped portrait charts, square diagrams, and any landscape figure with a different ratio. The container now starts at the variant's default aspect (skeleton state only), then on `onLoad` reads `naturalWidth / naturalHeight` from the image and sets the container's `aspect-ratio` to match. Image switches to `object-contain` so it always fits, and a `transition: aspect-ratio 300ms` smooths the resize when the natural aspect arrives. A `max-h-[80vh]` cap prevents extreme portrait images from dominating the viewport. Net effect: every figure renders at its true proportions, nothing gets cropped.

## v0.6.14 — 2026-04-28
**Profile editor: affiliation field + suggestion chips + cleaner first-run defaults**

Adds an Affiliation field (school / lab / company) to the profile editor, persisted as a new `school` column on `profiles`. Improves first-run by stopping the editor from pre-seeding battery-research demo topics — `defaultProfile.researchTopics` and `preferredVenues` are now empty arrays so the profile-setup nudge in the header surfaces immediately. The Topics, Methods, and Venues ChipInputs gained quick-add suggestion rows ("Try: + transformers + RAG + diffusion models …") shown only when the field is empty, and Topics carries an inline hint reminding people specificity matters (a single word like "whatever" matches nothing useful — we just shipped a fix for that exact case in v0.6.12). Schema.sql + the /api/profile mapping updated together so the new column round-trips cleanly.

## v0.6.13 — 2026-04-28
**Paper detail: rework "At a glance" + "Explore further" + train-feed action**

Three weak spots on the paper detail page got a pass. (1) "At a glance" Signal chips used a binary ✓/× toggle that read awkwardly — `Older paper ×` was double-negation, and `On arXiv ×` for a non-arXiv paper just wasted a slot. Replaced with a new `FactChip` that only surfaces facts when they're present: `Preprint on arXiv` (accent), `Code available` (tag), a relative-time chip (`23 days ago` / `2 years ago`), and a smarter team-size label (`Solo author` / `3 authors · small team` / `12 authors · large team`). (2) "Explore further" link chips now carry a leading icon per destination (document for publisher, mortarboard for Google Scholar, code-brackets for source/search code) so the row is scannable at a glance instead of three near-identical pills. (3) The lonely "Train my feed on this" button at the bottom got a clearer label (`More like this`) and a co-located one-line explainer so it reads as an action, not a stranded chip.

## v0.6.12 — 2026-04-28
**Stop showing mock data as the user's feed**

The feed store had a `realPapers.length > 0 ? realPapers : mockPapers` fallback that silently surfaced battery-research demo fixtures (with hardcoded "your PhD"-style relevance reasons) whenever the real API returned 0 results — for example when the user typed a topic with a typo like `transfomer`. Events and Jobs were even worse: always wired to `mockEvents` / `mockJobs` because no real adapters exist yet. Removed both fallbacks. Empty source = empty feed; the FeedMoreTile already shows a context-aware "Tune your signals" prompt when topics under-deliver, so a real empty state is more honest and more actionable than fake content.

## v0.6.11 — 2026-04-28
**Per-category icons + richer metadata on feed tiles**

Feed grid cards now carry a category-specific line icon next to the kind label (Paper / Discussion / Event / Job) and a thin colored stripe on the left edge for at-a-glance scanning. Inline mini-icons attach to metadata: author for papers, calendar + pin/globe for events, building + pin/globe for jobs. The redesign keeps the same density and serif/sans typography rhythm — purely a scannability pass, no content moved.

## v0.6.10 — 2026-04-28
**Search result card redesign + cleaner result count**

Search cards now read more like Airbnb listings than a database dump. Each card gets a colored type badge (arXiv, Journal, Conference) and an Open Access badge with icons; venue and date sit on a single meta row with calendar/book glyphs; the citation count moves to a quiet footer separator with its own icon and is humanized (`12.4k cited` instead of `12,432 cited`). Title shifted to `line-clamp-3` so longer paper titles breathe; abstract switches to the editorial serif at 13.5px for scannable reading. Result counter at the top no longer surfaces the raw OpenAlex universe size — it just shows how many results are visible (e.g. `12 results for "transformer"`), which fits the triage use case far better than `12 of 4,567,890`. Search API now returns `sourceType` and `isOpenAccess` to drive the badges.

## v0.6.9 — 2026-04-28
**Better paper links: prefer open-access PDFs + clean arXiv URLs**

Two fixes for the "many paper links are wrong" complaint. (1) The OpenAlex adapter now requests `best_oa_location` and `open_access` and prefers, in order: an OA PDF → an OA landing page → the DOI URL → the OpenAlex page itself. Result: papers with a free PDF on arXiv / institutional repository / publisher OA channel surface that link instead of a paywalled DOI redirect. (2) When OpenAlex returns an arXiv preprint via the `10.48550/arxiv.*` DOI prefix, the mapper detects it, swaps the URL to a clean `https://arxiv.org/abs/<id>`, populates `linkArxiv`, and renames the venue from "arXiv (Cornell University)" to plain "arXiv". The detail page CTA correctly says "Read on arXiv" again for these.

## v0.6.8 — 2026-04-27
**Search filters: year, sort, open access, citations, source, venue**

OpenAlex search now exposes the dimensions that actually matter for relevance triage. A chip row appears under the search bar in search mode (year preset or custom range, sort by relevance/citations/date, open-access toggle, min-citations threshold), with source-type and venue search behind a "More filters" inline drawer. State syncs to the URL so a filtered search is shareable and back-button safe; opening a shared link rehydrates every filter. Reset link clears all non-default filters in one click. Daily feed unchanged — filters only render in search mode.

## v0.6.7 — 2026-04-28
**"See more" tile at end of feed grid**

Added a context-aware action tile to the last cell of the homepage grid. Detects three states and adapts copy:

- **Profile under-tuned** (placeholder topics like `Whatever`, `idk`, or single short word) → "Tune your signals" + link to `/profile`. Short-circuits the most common reason for a sparse feed.
- **Sparse but tuned** (< 4 items) → "Light today" + Refresh button.
- **Plenty** → "More?" + Refresh button.

Replaces the loose "Refresh recommendations" link below the grid; collapses two affordances into one tile that lives where the eye lands. Visual differentiation: dashed border, no shadow — reads as an action, not content.

## v0.6.6 — 2026-04-28
**Distinguish HN discussions from academic papers in the feed**

HN posts share the `Paper` data model (and "Papers" tab) with arXiv/OpenAlex items, which made a Show HN thread visually identical to a real publication. The FeedTile now uses an **allowlist** of academic id prefixes (`arxiv:*`, `openalex:*`) to decide which items get the orange "Paper" badge — anything else renders as a muted "Discussion" badge. Allowlist over blocklist on purpose: future non-academic adapters (Twitter, Substack, etc.) default to "Discussion" until explicitly opted in. (A separate Discussions tab is the obvious next step if this surface keeps growing.)

## v0.6.5 — 2026-04-28
**Skip figure extraction for HN items**

HN posts link to arbitrary external URLs (GitHub repos, personal blogs, corporate sites). The `og:image` on those is rarely a meaningful representation of the discussion — usually a generic social preview, repo card, or logo banner. The detail page was loading these as the hero figure, which felt wrong. Now `extractFigure` returns null for any `hn:*` item id; the figure component's `hideOnMiss` collapses gracefully. Cache-bust param bumped `v=2 → v=3` so existing CDN entries refresh.

## v0.6.4 — 2026-04-28
**Fix HN content rendering on detail page**

Three bugs surfaced from a Show HN paper detail view: (1) abstracts arrived with HTML entities (`&#x2F;` `&#x27;`) and `<p>` tags un-decoded — added `decodeHtmlEntities` + `stripHtml` in the mapper before splitting; (2) HN system tags (`story`, `front_page`, `show_hn`, `author_*`, `story_*`) were polluting "Methods & techniques" — now filtered out via `isUsefulKeyword`; (3) primary CTA was hardcoded "Read on arXiv" — now source-aware (`Read on Hacker News` / `Read on arXiv` / fallback `Search arXiv`).

## v0.6.3 — 2026-04-27
**Dense feed grid (Xiaohongshu-PC density)**

Replaced the 3-tier briefing layout (hero + "Worth your time" + "Quick hits") with a single dense card grid that scales 1 → 2 → 3 → 4 columns from mobile through `xl`. New `<FeedTile />` compact card — tighter padding, two-line title, kind badge + relevance %, single-tap save action. Container widens from 820px to 1280px so wide screens actually use the space; header (greeting, search, type tabs) stays narrow-centered for reading rhythm. Search results adopt the same grid.

## v0.6.2 — 2026-04-27
**Public changelog page at `/changelog`**

Added a server-rendered page that reads `public/CHANGELOG.md`, parses the version/date/title/body structure, and renders entries in the editorial brand style (Instrument Serif headlines, Source Serif body, accent-orange version tags). 1-min revalidate so a markdown push lands on the live site without a redeploy. Raw markdown still served verbatim at `/CHANGELOG.md` for the curious.

## v0.6.1 — 2026-04-27
**Start CHANGELOG**

Backfilled past releases from `git log` and seeded an ongoing release log. From here on, every user-facing/infra commit adds an entry.

## v0.6.0 — 2026-04-26
**Hourly digest cron via GitHub Actions**

Replaced the removed Vercel cron with `.github/workflows/digest-cron.yml`. Triggers `/api/jobs/dispatch-digests` every hour at :05 with bearer auth via the `CRON_SECRET` repo secret. Free, preserves per-user timezone hour preference (Vercel Hobby plan rejected hourly cron).

## v0.5.2 — 2026-04-24
**Unblock production deploy**

Removed `web/vercel.json`. Hobby plan rejected the `0 * * * *` schedule, blocking every deploy after v0.5.0. Cron re-added externally in v0.6.0.

## v0.5.1 — 2026-04-24
**Ignore local MCP config**

`.mcp.json` excluded from repo. Local-only tooling config, never product code.

## v0.5.0 — 2026-04-24
**Email digest delivery (Resend)**

Resend wrapper with lazy init + branded HTML/plaintext/subject templates (Gmail-friendly table layout, escapes user-derived fields) + `/api/test-digest` self-send endpoint. Gracefully degrades when `RESEND_API_KEY` is missing — in-app inbox keeps working.

## v0.4.0 — 2026-04-24
**Supabase persistence layer**

Server-side persistence for saved items, read items, feedback signals, and digest deliveries. New RLS-scoped tables: `saved_items`, `read_items`, `feedback_events`, `briefing_deliveries`. Profile gets 5 digest preference columns (timezone, hour, channel, frequency, enabled). API routes: `/api/{saved,read,feedback,briefings}` + cron `/api/jobs/dispatch-digests`. `<FeedSync />` bridges local Zustand ↔ cloud on auth state change. Profile page adds digest preferences UI, Past Briefings inbox, and a reading calendar driven by real per-day read counts.

## v0.3.1 — 2026-04-24
**Profile sync to Supabase + UX polish**

Profile data persists via Supabase `profiles` table (was localStorage-only). User menu floats top-right.

## v0.3.0 — 2026-04-22
**Supabase GitHub auth + stars badge**

Sign-in with GitHub via Supabase Auth. Top-right pill shows the project's live GitHub star count.

## v0.2.3 — 2026-04-21
**Search briefing fixes + UX polish**

Search results route to internal briefing detail page; encoded-colon route param decoded correctly; "Loading briefing…" replaced with a shimmer skeleton.

## v0.2.2 — 2026-04-21
**Feed wired to real recommendations**

`/api/feed` returns scored items from the Tier 0 pipeline; replaces sample data fixture.

## v0.2.1 — 2026-04-20
**Briefing → memory-ful reading inbox**

Briefing surface treats items as a persistent reading list rather than an ephemeral feed.

## v0.2.0 — 2026-04-20
**Tier 0 scoring + multi-source feed pipeline**

Combined keyword / TF-IDF / recency / source-weight scoring. Source adapters for OpenAlex, arXiv, Hacker News. Wired into `/api/feed`. Profile redesigned as editorial dashboard with reading stats. Briefing feed redesigned with hero + quick-hit layout. Switched to HTTPS for arXiv to avoid Vercel-side 301 timeout.

## v0.1.0 — pre-versioning
Earlier work (project scaffolding, initial UI, prototype data layer). See `git log` for full history.
