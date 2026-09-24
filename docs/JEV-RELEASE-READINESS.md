# Jev / retrieval campaign — release readiness

**What this document is:** a plain-language explanation of where this project stands,
followed by a precise technical appendix for whoever does the actual switching-on work.

**What this document is not:** proof that anything has been tested with real users or
real data. Nothing in this campaign has made a single live call to any outside AI or
search service yet. Every number, every "it works," and every test result described
below comes from offline checks only — code read carefully, and run against fake or
recorded data, never real traffic. Anywhere this document says something passed a check,
it means "passed an offline check," never "proven in the real world."

---

## Part 1 — Plain language

### The big picture

This project is adding a set of new abilities to Peer: better ways to find papers,
a smarter (but paid) AI reviewer called Jev that double-checks whether a paper really
matches what you're working on, a memory system so the dashboard never shows you the
same paper twice, and a way to catch up on papers you missed if you didn't check in for
a few days.

None of this is turned on yet. Every new ability sits behind its own on/off switch,
and every switch defaults to off — meaning Peer behaves exactly as it does today unless
someone deliberately flips a switch. This is deliberate and it is the whole safety
strategy: nothing changes by accident, and anything that does get switched on can be
switched back off without losing anything important.

Think of it like renovating a house room by room while people still live in it. Each
room gets finished, checked, and only then does someone turn the lights on in that room.
Nobody turns on every light in the house at once.

### What's safe today

Every switch, when off, leaves Peer working exactly like it does right now — this has
been checked for each one individually. A few storage changes (new places to keep data)
have been written and carefully read over, but none of them have actually been applied
to the real database yet. Turning on a storage change is always a separate, deliberate
step from turning on the feature that uses it.

The one place a specific order is already spelled out is the "don't show me the same
paper twice" memory: the storage for it has to be turned on first, and only afterward
does the on/off switch for actually using it get flipped. For every other switch, no one
has written down a required order yet — this document proposes a reasonable one, but you
get the final say on the order when the time comes.

### What needs your decision

Six separate choices are waiting on you. None of them are technical — they're about
risk, cost, and privacy trade-offs that only you can weigh:

1. **Who pays for AI calls, and how.** One option lets Peer's own infrastructure cover
   some AI costs under a new shared spending limit; the other keeps today's stricter
   rule, which is safer but turns off a few borrowed features after the next update.
   This also decides whether a backup AI opinion — one that only ever runs quietly in
   the background, never something you see directly — can ever switch on at all, since
   it's built to only spend Peer's own money, never yours.
2. **Should email and the in-app dashboard share one "already shown" memory**, or stay
   fully separate, as they do today? Right now if a paper shows up in your email, it can
   still show up on the dashboard too.
3. **Who or what is allowed to trigger the scheduled email digest** (and also a
   "get things ready a bit before you check in" helper, which has now actually been
   built and tested — it just isn't switched on) **on a timer.** Nobody has wired up an
   automatic trigger yet, on purpose — this is a production change nobody should make
   without asking you first.
4. **How much real, paid use of outside search and AI services to authorize**, and for
   what scope. Nothing has made a real paid call yet. This same decision also tells us
   whether one specific paper-search service still works without a paid key at all — we
   genuinely don't know right now, and checking requires making one real request.
5. **Whether a failed digest email should be automatically retried later.** A safe,
   one-time retry already exists in the code. Turning that into an automatic recurring
   sweep would itself be a new scheduled job, so it needs the same sign-off as decision 3.
6. **Who reviews and labels the ~200 test papers** used to measure whether the new
   ranking is actually better. The rule is: two people who did not write any of Peer's
   search or ranking code, working independently, plus a named tie-breaker for when they
   disagree. We need you to say who those people are.

### What has NOT been tested live

Nothing. To be specific: no real call has been made to Semantic Scholar, OpenAlex, or
Jev by this campaign. No comparison between "old Peer" and "new Peer" has been run on
real papers. No cost number, no accuracy number, and no speed number in this project is
a measurement — every number you may see quoted elsewhere is an estimate, clearly
labeled as such, never a result. The plan for how that testing will eventually happen is
in the technical appendix, but the test itself has not started, and the pass/fail bar
for it has not even been set yet.

### A safety net that's already in place

For every new storage the project might add to the database, someone has already
written the "undo" instructions — a script that would remove it again. These undo
scripts are not wired up to run automatically by anything, ever. They exist purely so
that if the project ever needs to back out of a storage change, the instructions are
ready, reviewed, and waiting for a person to run them by hand, after a separate,
explicit decision about what to do with any data that would be lost. Two of the six undo
scripts would destroy something that cannot be recomputed — one holds a research
interest you typed in yourself, and one exists specifically to remember every paper
you've already been shown, so a promise ("we'll never show you the same paper twice")
isn't quietly broken. Both are marked as needing an exported backup before anyone ever
runs them, and nobody is planning to run any of them without asking you first.

### Two things found while preparing this document

**A storage space that never gets cleaned up.** Peer keeps a private, per-person cache
of paper picks so it doesn't have to redo expensive work on every visit. Nobody has
written a rule for how long to keep that cache around, so today it would simply grow
forever. This isn't a privacy problem — it's private to each person already — but it is
a cost and tidiness problem, and deciding how long to keep it is the kind of call that
needs your sign-off, not something the code should quietly decide by itself. This same
storage space now also holds a second kind of cache, for a handful of experimental
recommendation methods (see the next paragraph), which makes this decision matter more,
not less.

**A few recommendation methods aren't ready to switch on yet, even though the safety net
they were waiting for has now been built.** Four of the newer ways Peer can find papers
for you (three based on papers you've liked or saved, one based on topics you seem
interested in) used to have no memory between visits — every single time you open or
refresh Peer, they would redo their work from scratch. That's slow, wasteful, and could
run up costs quickly if switched on. The safety cache that fixes this has now been built
and is currently being double-checked by someone who didn't write it. Until that check
finishes, none of these four should be turned on, even though their core logic already
works in testing. One of the four — the one based on topics you seem interested in —
used to do nothing at all even if you switched it on, because it had no topics to search
with yet; that gap has now been closed too (it reads topics from your own reading
history), so it's held to the same not-yet-checked bar as the other three, not a
separate "does nothing" bar.

**A minor timing bug — now fixed and double-checked.** If you open Peer in two tabs at
once, or click refresh twice quickly, Peer used to do the expensive work twice instead
of once and reusing the first result. That's fixed now: two tabs, or two fast clicks,
share one answer instead of paying for the work twice. A related, smaller idea — a short
"please wait a bit before refreshing again" pause — has also now been built, as part of
a bigger "get your results ready a little before you sit down to read" feature. Neither
piece is switched on yet, because nothing currently tells either one when it's allowed
to run — that's decision 3 above.

**Two more abilities got built this round, both still switched off.** A backup AI
opinion can now quietly double-check Jev's judgment in the background when Jev itself
sounds unsure, without ever changing what you see. It can't actually run yet, though —
by design, it's only allowed to spend Peer's own money, never yours, and nobody has
turned that spending on yet (decision 1). Separately, a new way of blending results from
Peer's different search methods into one fair ranking has been built, switched off by
default. Whoever reviewed it found two small accuracy gaps — nothing broken or unsafe,
just not as sharp as it should be — and fixing both is underway now. Neither of these
two should be switched on until their own follow-up work is finished and separately
checked.

### Bottom line

Nothing ships itself. Every switch stays off until a person turns it on, in an order
this document proposes but you get to confirm. The riskiest step by far — letting Jev
make real, paid decisions about your papers — sits at the very end of a long chain of
smaller, safer, reversible steps, and needs your explicit go-ahead on cost and scope
before anyone flips it.

---

## Part 2 — Technical appendix

All line numbers and file states below were confirmed by a fresh grep of `web/src` and
`web/supabase/functions` at the time this document was written (2026-09-24). This
codebase has several concurrent writers; re-grep symbol names before relying on an exact
line number in a live edit. All rollout ordering in Section 2 is **PROPOSED** — see that
section's own note.

### 0. Scope and status of this document

- Covers rollout order, rollback (flag-level and SQL-level), the evaluation plan,
  secrets placement, the acceptance-matrix snapshot, and the open user decisions for the
  Jev/retrieval integration campaign (`ABC-JEV-INTEGRATION.md`).
- Originally written by P5-S1 C from `docs/jev-abc/P5-B-20260924T114729Z.md` (the C
  guide) and the binding rulings in `ABC-JEV-INTEGRATION.md` §4's newest entries, which
  override the guide where they differ. Updated by P5-S3 C (this pass, 2026-09-24) to
  fold in everything that landed after P5-S1's fresh independent review: newly-built
  flags (`PEER_RANK_FUSION`, `PEER_JEV_GEMINI_FALLBACK`), a newly-reviewed one
  (`PEER_JEV_SHADOW`), a previously-undocumented one (`OPENALEX_EMAIL`), the now-fixed
  refresh/coalescing bug, the now-built (still fully disconnected) "get results ready
  ahead of time" queue, new pre-flip conditions, and citations switched from line
  numbers to function names because this branch has several concurrent writers and line
  numbers were going stale within the same session.
- Does not itself authorize anything. No flag is flipped, no migration is applied, no
  secret is set, and no SQL in `web/supabase/rollback/` is run as a result of this
  document existing.

### 1. Flag inventory — fresh grep, this session (2026-09-24, P5-S3)

Grep commands run: `grep -rnE "process\.env\.(PEER_|OPENALEX_|JEV_)[A-Z0-9_]*" web/src
--include="*.ts" --include="*.tsx"`, a broader token sweep
(`grep -rhoE "\b(PEER|OPENALEX|JEV)_[A-Z0-9_]*\b" web/src --include="*.ts" --include="*.tsx"
| sort -u`) to catch anything the narrower grep would miss, and
`grep -rn "Deno\.env\.get" web/supabase/functions`.

**Citations below are by function name, not line number.** `web/src/lib/feed/pipeline.ts`
in particular is being actively edited by a concurrent writer as this document is
written — this session watched its own line numbers shift between two greps taken
seconds apart. Re-grep the function name if you need an exact line.

| Flag / name | Default when unset | Accepted value | Where read | Status |
|---|---|---|---|---|
| `PEER_DASHBOARD_LEDGER` | Off (today's behavior) | literal `"on"` only | function `dashboardLedgerEnabled()`, `web/src/lib/dashboard/ledger-flag.ts` | Built, code-reviewed offline. **Pre-flip HARD THRESHOLD (new):** if this ever ships turned off in production (the batchless path, which is the real one today), an "unattributed pending delivery" reconcile — merging a not-yet-attributed pending delivery into the right owner's bucket once that owner becomes known within the same visit — must be built first. See §2 Group A1. |
| `PEER_DIGEST_DEDUPE` | Off (old 6-hour window) | literal `"on"` only | function `isDigestDedupeEnabled()`, `web/src/app/api/jobs/dispatch-digests/route.ts` | Built, code-reviewed offline. (Its cited line number has moved twice since this document was first written — this is exactly why it's now cited by function name instead.) |
| `PEER_JEV_BROKER` | Off | literal `"on"` only | function `jevBrokerEnabled()`, `web/src/lib/decisions/broker-client.ts` | Built; nothing calls it in production yet |
| `PEER_JEV_BROKER_URL` | unset | server URL string (secret-adjacent) | function `readJevShadowConfig()`, `web/src/lib/decisions/flag.ts` | Built |
| `PEER_JEV_BROKER_SECRET` | unset | credential string | Next: function `readJevShadowConfig()`, `flag.ts`; Edge: the request handler in `web/supabase/functions/jev-broker/index.ts` | Built |
| `PEER_JEV_PER_USER_DAILY_CAP` | 50/day (constant `DEFAULT_JEV_PER_USER_DAILY_CAP`, `flag.ts`) | integer | Next: function `readJevShadowConfig()`, `flag.ts`; Edge: function `envNumber()`, `jev-broker/index.ts` | Built — **see §4 caution: must be set to the same number on both sides** |
| `PEER_JEV_GLOBAL_DAILY_CAP` | 2000/day (constant `DEFAULT_JEV_GLOBAL_DAILY_CAP`, `flag.ts`) | integer | same as above | Built — same caution |
| `PEER_JEV_SHADOW` | Off | literal `"on"` only | function `jevShadowEnabled()`, `web/src/lib/decisions/flag.ts` | Built. **Now has its own independent fresh review** (it did not, as of the last version of this document) — offline-verified: eligibility gate, cache wiring, and a privacy probe (8 sentinel strings never reach a log line) all checked. **New recommendation:** the feed route sets no explicit `maxDuration` today; the platform default is 300 s and the shadow's own worst-case run is ~60 s, which fits, but the two numbers were never explicitly pinned against each other in code. Set an explicit `maxDuration` on the feed route before turning this on. See §2 Group B7. |
| `PEER_JEV_GEMINI_FALLBACK` | Off | literal `"on"` only | function `geminiFallbackEnabled()`, `web/src/lib/decisions/flag.ts` | **Now built** (was "not built yet" in the prior version of this document). Code-reviewed offline. Structurally inert regardless of this flag's value: nothing anywhere in the codebase mints or injects the company-funded capability this feature requires, so it cannot fire even when "on" — see §2 Group B8 and user decision 1. |
| `PEER_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP` | 10/day (constant `DEFAULT_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP`, `flag.ts`) — **PROPOSED, not sourced from any vendor number** | integer | function `readGeminiFallbackConfig()`, `flag.ts` | Built. A separate, code-level (not env-configurable) ceiling of at most 5 calls per shadow run also applies — that number is a manager ruling, not a proposed default. |
| `PEER_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP` | 200/day (constant `DEFAULT_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP`, `flag.ts`) — **PROPOSED** | integer | function `readGeminiFallbackConfig()`, `flag.ts` | Built |
| `PEER_RANK_FUSION` | Off | literal `"on"` only | function `rankFusionEnabled()`, `web/src/lib/feed/pipeline.ts` | **Now built** (was "not built yet" in the prior version of this document) — this is the hybrid-retrieval-ranking (RRF) feature. The flag-off state (nothing changes) is code-reviewed offline. Flag-on found 2 accuracy gaps in review; both fixes are **in progress, not yet written** as of this writing. **Do not enable until both fixes land and pass their own independent review** — see §2. |
| `PEER_CHANNEL_OPENALEX_SEMANTIC` | Off | literal `"on"` only | function `channelOpenAlexSemanticEnabled()`, `pipeline.ts` | Built, code-reviewed offline |
| `PEER_CHANNEL_OPENALEX_TOPIC` | Off | literal `"on"` only | function `channelOpenAlexTopicEnabled()`, `pipeline.ts`; topic ids now resolved by function `topPositiveOpenAlexTopicIds()`, `web/src/lib/preferences/topic-seeds.ts` | **No longer a guaranteed no-op** — it is now wired to a real source of topic ids (pulled from the reader's own liked/saved papers via the delivery ledger). Implemented; its own independent review is **in progress, not yet verified**. **Same precondition as the 3 rows below — see §2 Group A4.** |
| `PEER_CHANNEL_S2_RECOMMENDATIONS` | Off | literal `"on"` only | function `channelS2RecommendationsEnabled()`, `web/src/lib/preferences/positive-seeds.ts` | Built, code-reviewed offline. The per-owner daily channel-candidate cache this needs (§2 Group A4) is **now built**, independent review **in progress**. The "both-sides" conflict rule (a paper id present in both the positive and negative seed lists is now sent as neither) is **now implemented**. |
| `PEER_CHANNEL_OPENALEX_SEED_SIMILARITY` | Off | literal `"on"` only | function `channelOpenAlexSeedSimilarityEnabled()`, `positive-seeds.ts` | Same as above. **Same precondition.** |
| `PEER_CHANNEL_POSITIVE_SEED_CITATIONS` | Off | literal `"on"` only | function `channelPositiveSeedCitationsEnabled()`, `positive-seeds.ts` | Same as above. **Same precondition.** |
| `OPENALEX_API_KEY` | Unset = keyless | server secret | function `openAlexAuthHeaders()` — defined separately in each of 4 files: `sources/openalex.ts`, `sources/openalex-semantic.ts`, `sources/openalex-topic.ts`, `affiliation/openalex.ts` | Sent as an `Authorization: Bearer` header, never a URL parameter, at all 4 sites |
| `OPENALEX_EMAIL` | `"peer@example.com"` | any contact-address string — not a secret | module-level constant (commonly named `MAILTO`) at 9 call sites: `api/papers/search/route.ts`, `api/topics/suggest/route.ts`, `affiliation/openalex.ts`, `figures/extract.ts`, `papers/fetch-by-id.ts`, `papers/source-links.ts`, `sources/openalex-semantic.ts`, `sources/openalex-topic.ts`, `sources/openalex.ts` | **New row — was previously undocumented (P5-S1 finding).** Pre-existing behavior, unchanged; only the documentation was missing. |
| `PEER_ENTITLEMENT_MODE` | one-tier (beta) | exactly `"tiered"` restores the free/trial/paid split | function `entitlementMode()`, `entitlement/resolve.ts` | Pre-existing, load-bearing for the Jev broker's entitlement gate |
| `PEER_DEV_ENTITLEMENT` | free + synthesized dev user | local-dev only | function `devEntitlement()`, `entitlement/resolve.ts` | Pre-existing; gated by a runtime check (`isLocalDevRuntime()`), not the production build guard — a stale code comment names the wrong mechanism, harmless |
| `PEER_DIGEST_PROVIDER` | unset | provider id string | function `resolveLocalServerProvider()`, `llm/providers/registry.ts` | Pre-existing, unrelated to this campaign |
| `PEER_REPORT_MODEL_TIER` | "large" | `"small"` switches tier | function `reportModelTier()`, `llm/provider-models.ts` | Pre-existing, unrelated |
| `PEER_FEED_AI_TIER` | 0 | integer | function `feedTierFromEnv()`, `feed/pipeline.ts` | Pre-existing, unrelated |
| `PEER_RUN_LIVE_EVENTS_BENCHMARK` | off | exactly `"1"` | function `canRunLiveEventsBenchmark()`, `events/benchmark-live-gate.ts` | Pre-existing, unrelated; live/opt-in benchmark only |
| `PEER_PROFILE_SNAPSHOT_PATH` | a default fixture path | file path | `events/benchmark.test.ts` — **test-only, not read by any production file** | Pre-existing, unrelated |
| `PEER_PRIVATE_UPLOAD_DIR` | unset | absolute path | function `hostedUploadsEnabled()` and constant `UPLOAD_DIR`, `papers/upload-access.ts` / `papers/upload-store.ts` | Pre-existing, unrelated |
| `PEER_UPLOADS_ENABLED` | `false` | exactly `"true"` | function `hostedUploadsEnabled()`, `papers/upload-access.ts` | Pre-existing, unrelated |
| `JEV_API_KEY` | unset | the real Jev provider credential | Edge only, inside the request handler in `jev-broker/index.ts` | Never read on the Next/Vercel side at all (confirmed by this session's own grep of `web/src` — zero hits) |

**Corrections/confirmations versus the prior version of this document:**
`PEER_JEV_SHADOW` now has an independent fresh review (it did not before) — see its row
above. `PEER_JEV_GEMINI_FALLBACK` and `PEER_RANK_FUSION` are both now built, each with
its own independent fresh review of the flag-off state; `PEER_RANK_FUSION`'s flag-on
path additionally has 2 known gaps with fixes in progress (not yet written). The
per-owner daily cache for the four read-time recommendation channels (internal name:
channel-candidate cache, `web/src/lib/opportunities/channel-candidate-cache.ts`) is now
built; its own independent review is in progress, not yet verified — do not treat its
precondition (§2 Group A4) as satisfied until that review lands. `OPENALEX_EMAIL` is
added as its own row (previously undocumented). The stale `PEER_DIGEST_DEDUPE` line
citation is fixed by switching every citation in this table to function names instead
of line numbers, which is now this table's permanent convention.

### 2. Rollout runbook — PROPOSED, not sourced

**Everything in this section is a proposal, not an instruction.** Only one flag
(`PEER_DASHBOARD_LEDGER`) has an explicit order written down anywhere in this campaign's
source material; every other ordering below is this document's own reasonable
generalization from that one precedent, built because no cross-flag database dependency
forces any particular order. **The user confirms the actual order at rollout time** — a
manager or implementer should not treat the table below as authorization to proceed.

Every flag in this campaign accepts only the literal string `"on"` — never `"true"`,
`"1"`, or any other truthy-looking value — and defaults to today's exact behavior when
unset.

#### Group A — additive, independent of the Jev broker, lowest blast radius

| # | Flag | Preconditions (ALL must hold) | Stop signal |
|---|---|---|---|
| A1 | `PEER_DASHBOARD_LEDGER` | (1) The dashboard-delivery-ledger migration applied. (2) User has separately authorized applying that migration. **This is the one flag with a sourced order** — flip only after the migration apply is authorized and done. **(3) New HARD THRESHOLD:** if production ever launches with this flag left **off** (the batchless path — today's real, default path), an "unattributed pending delivery" reconcile must be built first: a pending delivery that arrived before the reader's identity was known must be merged into the right owner's bucket once that owner becomes known within the same visit. This is a design requirement, not something already authorized to build. | Any response that serves a freshly-built pool while the ledger can't be read — must fail closed (503), never silently fall back to an unguarded pool. |
| A2 | `PEER_DIGEST_DEDUPE` | The briefing-deliveries-dedupe migration applied. (PROPOSED — modeled on A1, not itself sourced.) | A duplicate send on retry, or an old pre-migration row blocking a legitimate new claim. |
| A3 | `OPENALEX_API_KEY` | User decision 4 (live-call authorization) resolved enough to know whether this is optional or effectively mandatory. Not a rollout flag — a secret whose mere presence changes behavior for every OpenAlex call site. | N/A — low risk either way; the open question is timing, not safety. |
| A4 | The 4 read-time recommendation channels: `PEER_CHANNEL_S2_RECOMMENDATIONS`, `PEER_CHANNEL_OPENALEX_SEED_SIMILARITY`, `PEER_CHANNEL_POSITIVE_SEED_CITATIONS`, `PEER_CHANNEL_OPENALEX_TOPIC` | **Precondition status UPDATED this pass:** the per-owner daily channel-candidate cache (design name: P2-S4d) that all four need is now **built** (`web/src/lib/opportunities/channel-candidate-cache.ts`), closing the reason for the precondition described below — but its own independent review is **in progress, not yet verified**. Treat the precondition as still open until that review lands. Reason the precondition existed (manager finding F-M-P2-02, confirmed by direct code read): before this cache, these channels "are never cached... they simply re-run and re-report on every request" — with any of them on, every page open or refresh in the normal (non-ledger) mode fires all enabled channels fresh, unbounded by anything except ordinary request volume. Separately, `PEER_CHANNEL_OPENALEX_TOPIC` is no longer a guaranteed no-op (see §1) — it now shares this same precondition rather than being permanently inert. Also now implemented: the "both-sides" conflict rule (a paper id in both the positive and negative seed lists is sent as neither); a related, smaller gap (the same 200-row seed-history window can in theory be exhausted by roughly 200 toggles on one paper) is an ACCEPTED COST, not a blocker — it degrades to fewer seeds, never to a wrong one. | Any of the four channels observed firing live calls on a simple page reopen once "on" — confirms the cache did not actually land first, or that turning it on preceded its independent review. |
| A5 | `PEER_CHANNEL_OPENALEX_SEMANTIC` | None beyond code; already code-reviewed offline. | Any live comparison being treated as authoritative before user decision 4. |
| A6 | `PEER_RANK_FUSION` (hybrid retrieval ranking / RRF) | Not part of the original guide — added this pass because the feature is now built. Ships flag-off by design. Before ever turning this on: (1) both pre-flip fixes below must land and pass their own independent review (in progress, not yet written as of this writing); (2) the Section 5 evaluation should inform the production default, per that section's own plan. Pre-flip fixes required: (a) the fused-ranking candidates must carry the same publication-year/first-author-surname information the plain de-duplication path already uses, so a pair that de-duplication merges into one paper is not silently credited to only one search channel in the fused ranking; (b) the fused-ranking result must survive being served from the same-day cache, not just a freshly-built response — today a same-day cache read loses that ranking's supporting detail even though the ranking itself is unaffected. | Any user-visible fused ranking before both fixes are independently verified; a same-day cache read that silently drops the fused-ranking detail after the fix claims to be done. |

#### Group B — the Jev path (strictly sequential; each step gated on the previous being clean)

| # | Step | Preconditions | Stop signal |
|---|---|---|---|
| B1 | Resolve user decision 1 (company-funded AI option) far enough to know where the database foundation holding the eventual Jev key will live. | — | Designing B2+ around an unresolved foundation choice. |
| B2 | Apply the private-decisions migration. | B1. | Any write path to that table that isn't the service role. |
| B3 | Deploy the Jev broker Edge Function; set its secrets, **including explicit values (not the code defaults) for both daily-cap numbers.** | B1, B2. This is the first time this function will actually run anywhere — no Edge runtime has been available to this campaign at all. | **The two-sided cap mismatch risk:** the Edge side and the Next side each read their own daily-cap numbers independently; nothing in the code forces them to match. **Ruling: set the same number on both sides; if they ever drift, the lower one silently wins** (each side only enforces its own copy). Record the exact numbers used on both sides in the same change. |
| B4 | Set the broker secret as a Next/Vercel server variable (same value as B3). | B3. | A value that differs from the Edge side — every call will fail authentication. |
| B5 | Turn on `PEER_JEV_BROKER`. | B4. Confirm the route wiring that actually calls this path has landed and passed an independent review — otherwise this flag has no observable effect yet, which is safe but proves nothing. | Any caller reaching the broker before that wiring has an independent review. |
| B6 | One bounded, explicitly user-approved-spend smoke test of a real Jev call, end to end. | B5, user decision 4 (scope, volume, budget), and a separately approved spend ceiling. This is the first live verification of anything in this campaign. | Any live call attempted without an explicit, dated, in-chat spend approval naming the ceiling. |
| B7 | Turn on `PEER_JEV_SHADOW`. | B6 passed clean. `PEER_JEV_SHADOW`'s own code now HAS an independent fresh review (this was still outstanding in the prior version of this document — now closed: eligibility gate, cache wiring, and a privacy probe with a planted-leak control all checked offline). **New precondition added this pass:** set an explicit `maxDuration` on the feed route first — it has none today; the platform default is 300 s and the shadow's own worst-case run is ~60 s, comfortably inside that default, but the two numbers were never pinned against each other in code, only reasoned about after the fact. Its own eligibility gate (all of: broker on, signed-in owner matches the cache-scope owner, paid plan, AI tier ≥ 2, a structured intent present, broker URL+secret configured) is a structural filter, not an adjustable rollout percentage — the safe "how many users" number is however many real users currently satisfy every one of those conditions, which should be estimated (read-only) before flipping, since that number IS the blast radius. | Any evidence the shadow hook is awaited by the main request path, or that it fires on a cache hit or a retry. |
| B8 | `PEER_JEV_GEMINI_FALLBACK` (the background-only backup opinion, invisible to the reader, that can weigh in when Jev itself is unsure) | **Now built** (was "not built" in the prior version of this document): its own flag, daily caps, validation, and a hard per-run ceiling of 5 calls are all code-reviewed offline. Structurally inert regardless of rollout step: it only ever runs on an injected, company-funded capability, and nothing anywhere mints or injects one today — so there is no live rollout step to take yet. Unblocking this requires (1) user decision 1 resolved toward the company-funded option, and (2) that capability actually being wired up (a follow-on implementation step, not authorized by decision 1 alone). Its daily-cap numbers are PROPOSED, not sourced from any vendor figure — confirm before any live rollout. | Any live Gemini call before both the capability exists and decision 1 has been made. |

**Known code-level cost bug (F-B-P4S8-01) — now FIXED and independently verified.**
Signed-in users on a cold cache used to not get deduplicated — two tabs, or a fast
double-click of refresh, would independently rebuild the whole paper pool twice,
doubling source fetches and, if the gates above are open, doubling both paid-AI calls
and Jev-shadow schedules. The fix (keying in-flight de-duplication off the pool's own
identifier — owner id plus a hash of the full intent — instead of an internal object
reference) has landed and was independently proven against the real pipeline under true
concurrent requests, both same-owner (coalesces to 1 fetch) and different-owner/different
-intent (never share a flight). This is not itself gated by any flag — it is always on —
but it lowers the real cost of turning any of the flags above on.

**The related "get results ready ahead of time" feature — also now built, still fully
disconnected.** A 15-minute cooldown between manual refreshes, plus a durable queue that
would let Peer prepare a reader's results shortly before they're expected to check in,
have both been built and independently code-reviewed offline (see acceptance 13/14/15 in
§6): due-time and retry/backoff math, the cooldown check itself, and a job-queue
repository with both an in-memory and a real-database-backed implementation all exist and
pass their offline tests. **Nothing calls any of it.** It is not reachable from any route
today, so it has no effect at all, on or off. Turning it into something real needs (1)
user decision 3 (who/what may trigger this kind of scheduled background work), and (2) a
proof that the queue behaves correctly under real concurrent database access (two workers
racing to claim the same job, a crash mid-job, a real retry) — that proof needs an actual
database, which this campaign does not have. The lead time (45 minutes before a reader's
expected check-in) and the retry/backoff timing are PROPOSED, not sourced from any
external requirement; only the 15-minute cooldown length itself is sourced (from the
original engineering plan).

### 3. Rollback

#### 3.1 Flag-off behavior

| Flag | Turning it off | Data left behind |
|---|---|---|
| `PEER_DASHBOARD_LEDGER` | Reverts to pre-ledger exclusion behavior exactly | Ledger tables untouched, become inert (no delete path exists) |
| `PEER_DIGEST_DEDUPE` | Reverts to the old 6-hour-window check | Additive column/index/function harmless, never read by the old path |
| `PEER_JEV_BROKER` | Broker never attempted | No persisted state of its own. **Also sufficient to stop the shadow hook** — the shadow flag's own eligibility gate requires the broker flag to be on as one of its conditions, so no separate step is needed to disable shadow first during an incident. |
| `PEER_JEV_SHADOW` | Hook stops being supplied to the pipeline; the visible feed response is unchanged even while on, by construction | Already-written decision-cache rows and cost-log lines stay (regenerable, non-guarantee-bearing) |
| `PEER_JEV_GEMINI_FALLBACK` | Shadow runs Jev only, exactly as if this flag never existed — same construction as `PEER_JEV_SHADOW` above | Any already-written fallback-sourced answers stay (regenerable, non-guarantee-bearing, same as above) |
| The 5 channel flags | Pool-cache entries simply stop including that channel's candidates | No persisted state of their own |
| `PEER_RANK_FUSION` | Reverts to the plain, pre-fusion ranking exactly, by construction | The optional fused-ranking provenance field on a cached pool is simply absent again; old and new cached pools both stay valid either way |

#### 3.2 Rollback SQL — one authored file per migration

**Seven files now exist** at `web/supabase/rollback/*_rollback.sql` (was six as of the
last version of this document — a 7th migration, `20260924000600_dashboard_prepare_jobs.sql`,
landed since, for the offline-only "get results ready ahead of time" job queue described
in §2, and it has its own rollback file), one per file currently in
`web/supabase/migrations/2026092*.sql`, plus `web/supabase/rollback/README.md`
explaining the folder's convention. **None of these seven files is ever applied
automatically by anything** — confirmed by this session's own gate sweep (§7). Each
file's header states, verbatim: it is not a migration and is never applied
automatically; which forward migration it reverses; exactly what it destroys; whether
that data is regenerable or guarantee-bearing; and the drop order (reverse of the
forward migration's own dependency order).

Ranked highest caution first (see the README for the full reasoning):

1. `20260924000000_dashboard_delivery_ledger_rollback.sql` — breaks the "never
   resurfaces" guarantee retroactively for every user; the ledger table has no
   expiry column by design. Never run without an export.
2. `20260922010000_profile_feed_intent_rollback.sql` — destroys user-typed research
   intent, not system-computed state. Never run without an export.
3. `20260924000300_briefing_deliveries_dedupe_rollback.sql` — touches an
   already-applied, already-live production table.
4. `20260922000000_private_paper_pools_rollback.sql`, `20260924000400_private_decisions_rollback.sql`,
   `20260924000500_dashboard_rollover_rollback.sql`, `20260924000600_dashboard_prepare_jobs_rollback.sql`
   — all four regenerable/cache-or-queue-like, still covered by the same "never without a
   backup" rule as a blanket policy. The newest of the four (the job-queue table) is
   lowest-stakes of all seven: by design nothing in it is a record of anything that
   already happened, only a scheduling note for work not yet done, and nothing triggers
   that queue at all yet (§2) — so today there is nothing live for this rollback to
   actually interrupt.

**Open item folded into this document (manager addition):** `private_paper_pools` has no
retention or cleanup policy at all today — rows accumulate indefinitely. This applies
today to its existing per-owner daily paper-pool cache rows, and will also apply, once
built, to a second dataset planned to share the same table (a per-owner daily cache of
the read-time recommendation channels from §2 Group A4, under a distinct key prefix).
Deciding a retention period is itself a separately-approved-retention-plan decision —
i.e., a user decision, adjacent to but not one of the 6 tallied in §8 — and nothing may
delete rows from that table until it is made. See
`20260922000000_private_paper_pools_rollback.sql`'s own header and
`web/supabase/rollback/README.md`'s "Known open item" section for the full detail.

A migration-to-rollback parity test (`web/src/lib/release/rollback-parity.test.ts`)
mechanically checks that every campaign migration has a matching rollback file carrying
the required header phrase, so a future migration added without a rollback design fails
the test suite rather than silently shipping unreviewed. RED confirmed before the
rollback files existed (14 of 15 assertions failed); GREEN confirmed after (15 of 15
passed) — see §7.

### 4. Secrets placement (names only — values are never in this document or any source it draws from)

| Secret | Vercel/Next server env | Supabase Edge secret | Forbidden on Vercel by the BYOK production guard? | `NEXT_PUBLIC_`? |
|---|---|---|---|---|
| `JEV_API_KEY` | Never | Yes — the only place it lives | **Yes**, on the deny-list | Never |
| `PEER_JEV_BROKER_SECRET` | Yes — Next authenticates its own call to the broker with it | Yes — the broker verifies it | No — correctly absent from the deny-list, Next genuinely needs this one | Never |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | N/A (separate, pre-existing Next-side vars) | Yes — platform-provided | N/A | Never |
| `OPENALEX_API_KEY` | Yes | No | No | Never |
| `PEER_JEV_PER_USER_DAILY_CAP` / `PEER_JEV_GLOBAL_DAILY_CAP` | Not read anywhere on the Next side — passed as plain function parameters, not an env read | Yes | N/A — caps, not credentials | Never |
| 12 operator-AI provider names (Google/Anthropic/OpenAI/Qwen/DashScope/DeepSeek families, plus the digest-provider override) | Forbidden in production/preview (BYOK-only policy) | N/A — not part of this campaign | **Yes**, all 12 | Never |

### 5. Evaluation plan

**No dataset, no threshold numbers, and no held-out result exist anywhere in this
campaign as of this writing.** This section describes a plan, not a measurement.

**Dataset:** an independently labeled pilot of about 200 project-paper pairs across
HR/organizational topics, statistics, and a materials-science control group — explicitly
"a pilot, not a universal quality certificate." Tuning and held-out sets must be disjoint
**by project** (if any pair from a project is used for tuning, no pair from that same
project may appear in the held-out set, even a different paper). Label provenance and
adjudication of disagreements must be recorded. Ground truth may never be generated by
the same model being evaluated (rules out using Jev, or any single AI under test, to
label its own evaluation set).

**Labelling protocol (ruled, not left open):** two independent domain labellers plus a
named tie-breaker, none of whom wrote any of Peer's retrieval or ranking code. Who they
are is user decision 6 (§8).

**Three comparison arms**, on the same source snapshot where feasible: (a) unchanged
baseline; (b) hybrid retrieval plus deterministic ranking; (c) hybrid plus Jev. Source
ablations: Semantic-Scholar-only / OpenAlex-only / union, keyword-vs-seed, and counts of
uniquely relevant papers per source — vendor claims may never substitute for these.
Arm (b) needs the hybrid-ranking feature (flag name `PEER_RANK_FUSION`, now built —
see §1/§2 — with its flag-off state code-reviewed offline and 2 pre-flip accuracy
fixes in progress as of this writing) code-complete and force-enabled for the pilot's
own test traffic only — this does not require or wait for that flag's production
default to flip, which is this evaluation's conclusion, not its precondition. The two
pre-flip fixes should land before this evaluation arm runs, since a known accuracy gap
in the ranking under test would contaminate the comparison.

**Named metrics, with pinned definitions where the source campaign didn't already fix
one** (pinning is a manager ruling, made before any held-out data exists, changeable only
before a held-out result is seen):

- Recall in the judged candidate set (explicitly not a corpus-wide recall claim).
- Precision@10.
- **Ranking quality = nDCG@10**, computed with graded labels 0/1/2, gain
  <code>2^rel − 1</code>, discount <code>log2(rank + 1)</code>, ideal ordering taken from
  that project's own judged labels, mean over projects with a bootstrap 95% interval.
- False-negative technical-sense cases (the 5 finite adversarial sense categories already
  exist offline; the pilot-scale labeled version does not yet).
- Unknown rate (needs live Jev decisions — blocked on user decision 4).
- New-discovery vs. never-shown-rollover share.
- **Lifetime dashboard duplicate count** = per owner, the number of papers in a served
  dashboard batch whose identity (its canonical key, or any of its known aliases) matches
  a paper in an earlier served batch for the same owner. Target: 0. Measurable only in
  the ledger-mode path (the non-ledger path keeps no server-side delivery record to check
  against).
- Per-active-user cost, cache hits, source failures, p50/p95 readiness.
- **User-level quality breakdown** = every metric above reported per project (and per
  user, when a user has more than one project), each with its sample size — never only a
  single pooled average across everyone.

Report sample counts and uncertainty alongside every number — never only a percentage
uplift.

**Pre-registration rule — currently OPEN, no numbers set:** before any experimental
rollout, the manager must set a quality non-inferiority tolerance and a per-user budget
ceiling from baseline evidence, and record both **before** seeing any held-out result.
Leaving these thresholds unresolved keeps the production gate open, regardless of how
good the code looks. All actual billed experiments additionally need an approved spend
ceiling and safely configured credentials — a user saying "I have a key" is not evidence
that a live call has happened.

**Structural target (quoted in full):** "0/18 unexplained functional gaps, no new
deterministic test regressions, zero observed cross-user leak in adversarial tests, and
independently checked real pipeline cases."

**Metric code lives in a new, dedicated module** (evaluation-only — separate from the
existing channel-comparison harness, which measures overlap/uniqueness between retrieval
channels, a different and narrower thing than the three-arm comparison above). That
module is a different work item (P5-S2), running in parallel with this document.

### 6. Acceptance matrix snapshot (18 items)

Source: the 18-item frozen list in `ABC-JEV-INTEGRATION.md` §3d. Status column reflects
the most recent independent check found on disk as of this writing; a blocked or
in-flight item is never counted as passed. This is a snapshot, not a live query — several
items changed status within the hours before this document was written, and more will
change after it.

| # | Short description | Status | As of / source |
|---|---|---|---|
| 1 | Project/challenge preserved, no dummy-keyword requirement | Passed offline check | 2026-09-24, P1 baseline |
| 2 | Domain senses/aliases kept separate (HR conflict, conflict-of-interest text, software conflict, statistical/material meaning) | Passed offline check | 2026-09-24, P1 baseline |
| 3 | License ledger and visible attributions; no unapproved dictionary import | **Failed / blocked** — no reviewed licensed asset exists yet | 2026-09-24, P1 |
| 4 | All 5 candidate channels demonstrated; live comparison honestly reported | Partial — most channels pass offline; the topic-based channel is now wired to a real source of topic ids instead of doing nothing, but its own independent review is in progress, not yet verified; live comparison still blocked on user decision 4 | 2026-09-24, P2, updated P5-S3 from P2-S4c+d C |
| 5 | A zero-literal-match positive result survives every path; exclusions still work | Passed offline check | 2026-09-24, P2 |
| 6 | Duplicate-paper detection preserves origin and handles edge cases safely | Passed offline check | 2026-09-24, P2 |
| 7 | Hybrid ranking (RRF) deterministic, balanced, capped, diverse | Partial — the feature is now built; its flag-off state (nothing changes) is independently verified offline; the ranking computation itself is code-reviewed and its shipped shape is deterministic/capped as designed, but review found 2 accuracy gaps that must be fixed before the flag can ever be turned on in production; both fixes are in progress, not yet written | 2026-09-24, P2 baseline, updated P5-S3 from P2-S6 fresh A |
| 8 | Same public request reuses retrieval; different scopes never collide | Partial — the reuse mechanism itself passes offline but isn't wired in; the shared-cache half is on hold pending authorization | 2026-09-24, P2 |
| 9 | Personal data fully isolated between users, including adversarial two-user tests | **Blocked** — offline mechanics pass; the real two-user database proof needs a database this campaign does not have | 2026-09-24, P0 |
| 10 | Jev's data format, typed unknowns, score checks, version pinning, fault handling | Passed offline check (no live Jev call has ever been made) | 2026-09-24, P3 |
| 11 | Unchanged input reuses cache; changed input invalidates only the right layer | Partial — the caching rule itself passes offline; full request-to-response wiring is still landing | 2026-09-24, P3 |
| 12 | Company keys never reach the client or logs; spend limits are atomic and can't be doubled | Passed offline check — a real double-counting bug (Edge and Next sides sharing one counter, silently halving every stated limit) was found and fixed, independently re-verified | 2026-09-24 (fix verified 11:52 UTC) |
| 13 | A durable delivery queue survives duplicate sends, two workers, crashes, timeouts | Partial — an offline job-queue engine (due-time math, retry/backoff, a memory-backed and a real-database-backed repository, fencing against stale data) is now built and independently code-reviewed; nothing in the app calls it yet, so it changes nothing live today; proof under real concurrent database access (two workers racing for the same job, a crash mid-job) remains blocked — this campaign has no database to test against; the trigger itself is a separate open user decision | 2026-09-24, updated P5-S3 from P4-S8b fresh A |
| 14 | Scheduled feed ready ahead of your reading time; time-zone-safe; honest status | Partial — the time-zone math for the existing scheduled email remains proven correct; the engine for having results ready a bit early (see item 13) is now built and offline-verified but connected to nothing live yet | 2026-09-24, updated P5-S3 from P4-S8b fresh A |
| 15 | Manual refresh doesn't waste work; cooldowns and budgets work; just opening the app never triggers AI calls | Partial, most of the way closed — opening the app / checking status never triggers an AI call (confirmed, unchanged); the double-work-on-concurrent-refresh bug (see §2) is now fixed and independently proven under real concurrent requests; a manual-refresh cooldown is now built and offline-verified but not wired to any live refresh path yet — that wiring arrives together with item 13's queue, gated on the same trigger decision | 2026-09-24, updated P5-S3 from P4-S8a + P4-S8b fresh A's |
| 16 | Only never-before-shown papers compete the next day, across ~20 named edge cases | Partial — the core mechanism passes offline with two small, accepted, documented trade-offs; two newly found edge cases in the "signed in with no batch yet" path are being fixed now | 2026-09-24, P4 |
| 17 | Pool and daily-brief size limits respected; brief vs. deep report kept separate; the no-AI-keys mode still works | Passed offline check | 2026-09-24, P4 |
| 18 | Paired quality/cost evidence, multilingual cases, an independent reviewer, a tested rollback, no invented numbers | **Not started** — this document and its sibling evaluation-code work item are the start of it; no measurement exists yet | 2026-09-24 — this document |

### 7. Gates run this round (`web/`, all times UTC)

- `npx vitest run src/lib/release/rollback-parity.test.ts` before the rollback files
  existed: **14 failed / 1 passed** (RED, as expected — only the directory-sanity canary
  test could pass with nothing on disk yet).
- Same command after all 6 rollback files + README landed: **15 passed / 0 failed**
  (GREEN).
- Full gate results (FULL `vitest run`, `tsc --noEmit`, `lint`) and the
  `rollback`-reference grep sweep are recorded in this item's checkpoint file
  (`docs/jev-abc/P5-S1-C-*.md`) rather than duplicated here, since they reflect the
  state of the whole branch, not only this document's own files, and this branch has
  several other concurrent writers whose own gate counts change independently.
- **P5-S3 (this documentation pass) re-ran the same gates fresh** from `web/`, 2026-09-24:
  `rollback-parity.test.ts` **17 passed / 0 failed** (now 17, not 15 — the 7th
  migration/rollback pair added since P5-S1); FULL `vitest run` **212 passed | 1 skipped
  test files (213), 4069 passed | 1 skipped tests (4070), 0 failed**; `tsc --noEmit`
  **exit 0, 0 errors**; `npm run lint` **exit 0, 0 errors, 2 warnings** (same
  pre-existing unused-var warnings noted before, unrelated to this campaign). Exact
  counts and commands are in this pass's own checkpoint,
  `docs/jev-abc/P5-S3-C-20260924T153429Z.md`.

### 8. User decisions still open (6)

1. **Company-funded AI option.** Adopt an upstream feature letting Peer's own
   infrastructure pay for some AI calls under a new shared spending cap, versus keep
   today's stricter rule (safer now, turns off some upstream features after the next
   merge). Gates whether/how a related database foundation can be merged at all, which
   in turn gates the whole Jev rollout path in §2 Group B. **Now also gates the
   background-only backup opinion (`PEER_JEV_GEMINI_FALLBACK`, §1/§2 Group B8):** that
   feature is built and off, but it is designed to only ever run on a company-funded
   capability, never a reader's own key, so it stays structurally unreachable until this
   decision resolves toward the company-funded option (and that capability is then
   actually wired up).
2. **Cross-channel dedupe policy.** Should email and dashboard delivery share one
   "already shown" record, or stay fully independent as today?
3. **Who/what triggers the scheduled digest send** — and now also the already-built
   "prepare results ahead of time" job queue and its 15-minute manual-refresh cooldown
   (§2): both exist in code and pass their offline tests, but neither is connected to
   anything, specifically because this decision has not been made. A production
   scheduling change nobody but the user may authorize.
4. **Live call authorization** — exact scope, volume, and budget for real calls to
   Semantic Scholar, OpenAlex, and Jev. Also answers whether one specific paper-search
   service still works without a paid key. Unblocks acceptance items 4 and 18 and the
   entire evaluation pilot in §5.
5. **Automatic email-retry sweep.** A safe one-time retry exists in the code today; a
   recurring automatic sweep would be a new schedule, needing the same authorization as
   decision 3.
6. **Who labels the ~200-pair pilot** — two independent domain labellers plus a named
   tie-breaker, none of whom wrote Peer's retrieval or ranking code (§5).

**Adjacent, not separately tallied in the 6:** the `private_paper_pools` retention period
(§3.2) is functionally the same kind of decision (a separately approved
retention/backup plan under the campaign's evaluation-and-release rules) but was raised
after the 6 above were already counted, so it is recorded here rather than renumbering.
Semantic Scholar's own commercial-use confirmation is treated as folded into decision 4
(both gate "live Semantic Scholar use") and is likewise not separately tallied.
