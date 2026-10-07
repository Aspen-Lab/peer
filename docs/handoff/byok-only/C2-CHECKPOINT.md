# C2 checkpoint: scope (b) landed

Branch `remove-paid-tier-restore-byok`, after C1's checkpoint `093c2e11`. Every commit below is pushed. Nothing here ran a
real model call, touched reader data, or printed a key value (names and obvious dummy sentinels only). `npm run build` was
**not** run: this worktree's `web/node_modules` is a symlink and Turbopack will not build through it, so the PR's Vercel
preview is the build gate.

## The commits

| # | Hash | Message |
|---|---|---|
| F1 | `d7577a1b` | refactor(llm): no metering wrapper, no usage ledger |
| F2 | `e8081892` | refactor(usage): remove the company dollar budget |
| F3 | `d8306207` | refactor(usage): remove the forced-rebuild breaker and the operator search |
| F4 | `b9709bd6` | feat(supabase): drop the ledger and the budget tables |
| F5 | `5c36cec2` | copy: delete "What is recorded about model use" |
| F6 | `904ed312` | chore: final grep gate for scope (b) |
| - | (this commit) | docs(handoff): C2 checkpoint - scope (b) landed |

C2 net over the six code commits: 72 files, +906 / -9992 lines; 22 files deleted (19 under `web/src`, 2 under `web/scripts`,
1 under `docs`), 1 added (the migration). The F3 commit is the large one (38 files, -7002), because the operator search
modules and their tests are most of it.

## Gate numbers

Baseline at `093c2e11` (C1's number, re-measured here for tsc and lint): `tsc` 0; lint 0 errors / **151** warnings; full
`TZ=America/Chicago npm test` **5722 passed, 11 skipped**, 291 files passed + 3 skipped.

| After | tsc | lint (errors / warnings) | tests |
|---|---|---|---|
| F1 | 0 | 0 / 151 | touched dirs (`llm usage sources jobs events security app/api`): 2163 passed, 4 skipped |
| F2 | 0 | 0 / 151 | broad run 2847 passed; it caught `broker-parity` (see F2 below), fixed, `decisions` 283 passed |
| F3 | 0 | 0 / 151 | full: **5480 passed, 8 skipped** (5488), 281 files passed + 3 skipped |
| F4 | 0 | 0 / 151 | `security` + `release`: 85 passed |
| F5 | 0 | 0 / 151 | `app` + `navigation`: 622 passed |
| F6 | 0 | 0 / 151 | full: **5485 passed, 8 skipped** (5493), 281 files passed + 3 skipped |

Test count 5722 -> 5485 (-237): ten test files were deleted with their subjects (`metered`, `events`, `context`,
`company-budget`, `company-spend`, `rebuild-breaker`, `system-key`, `vertex-search`, `gemini-search`,
`scripts/vertex-search-project`), which also accounts for the skipped count going from 11 to 8 (company-budget had three
skipped cases), net of the cases added below. Lint never rose above 151 at a commit and did not fall: the 151 warnings live
in files that were not deleted (the full warning lists after F1, F2 and F3 were diffed against the baseline run: no warning
added, none removed; after F4, F5 and F6 only the count was compared). The full suite was run only after F3 and F6, as the brief says; the other commits ran the touched directories.

Build guard, by hand, from a clean environment (`env -i`, the three Supabase names set to dummies, sentinel values only,
output filtered so no value is printed): `VERCEL=1` with no banned name exits **0** and prints nothing; with any one of
`GOOGLE_API_KEY`, `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_SEARCH_PROJECT`,
`GOOGLE_VERTEX_SEARCH_ENGINE_ID` set it exits **1** and the message names only that variable. The guard script and its bans
are untouched.

## F6 grep result

`git grep -nE "usage_events|company_spend|company_model_prices|PEER_COMPANY_SPEND_CAP|recordUsageEvent|meterProvider|consumeForcedRebuild|systemSearchAllowed|poolRefreshAllowed|vertex-search|gemini-search|BRAVE_SEARCH_API_KEY" -- web/src web/scripts web/.env.example`

returns 26 lines in exactly six files, and **no production file**:

- `scripts/assert-byok-production-env.mjs` (3): the guard's ban list and the two comments explaining it; and
  `src/scripts/assert-byok-production-env.test.ts` (1), the test that asserts the ban.
- `src/lib/security/upstream-migrations.test.ts` (12): migration history pins (`20260904000100_usage_events.sql`) and the
  new migration's own pins (the three DROPs, the five key families, the kept budget migration and its rollback).
- `src/lib/security/spend-scans.test.ts` (8): scan 3 names the deleted modules and symbols so that a revival fails.
- `src/lib/llm/usage-log.test.ts` (1): asserts `usage-log.ts` names no ledger symbol.
- `src/test-support/route-harness.ts` (1): the helper that arms the banned search names to prove the environment buys
  nothing (excluded from the scans, as the other test scaffolding is).

The brief's phrase "migration history, docs and the guard's ban list with the tests that assert it" holds, with those
six files as "the tests that assert it". Docs are outside the grep's scope.

## Importer checks (before each deletion, `git grep` over `web/src web/scripts`)

| Deleted | Importers found | Verdict |
|---|---|---|
| `llm/providers/metered.ts` | `registry.ts` (its single `meterProvider` call), `metered.test.ts` | provider returned raw |
| `usage/events.ts` | `metered.ts`, `usage-log.ts`, `rebuild-breaker.ts`, `jobweb`/`eventweb`/`web-search` (`recordUsageEvent`), six tests | all edited or deleted in F1 |
| `usage/context.ts` | `metered.ts`, `usage-log.ts`, its test | same |
| `usage/company-budget.ts` | `metered.ts` and `usage-log.ts` (gone in F1), its own test and `metered.test.ts`; comments in `gemini.ts`, `jev-contract.ts` | deleted F2; comments fixed |
| `security/company-spend.ts` | `feed/route.ts`, `feed/types.ts`, `sources/vertex-search.ts`, its test; comments in `gemini-fallback.ts` | deleted F2; plumbing removed |
| `usage/rebuild-breaker.ts` | `jobweb`, `eventweb`, `web-search`, `jobs/pipeline`, `events/pipeline`, its test | deleted F3 |
| `search/system-key.ts` | `jobweb`, `eventweb`, `web-search`, its test, `spend-scans` (the gate path) | deleted F3 |
| `sources/vertex-search.ts` | `feed/pipeline`, `jobs/pipeline`, `events/pipeline`, `jobweb`, `eventweb`, `web-search`, `events/benchmark.test`, its test, `scripts/vertex-search-project.test` | deleted F3 |
| `sources/gemini-search.ts` | the same six, `eventweb.test` (`pageTitleFromHtml`), `paper-source-timeout.test`, its test | deleted F3 |
| `scripts/setup-vertex-search.mjs`, `probe-vertex-search-billing.mjs` | only `vertex-search-project.test.ts`, `spend-scans`, `docs/SETUP_vertex_ai_search.md` | deleted F3 (and the doc) |

The importers that were not themselves company-key paths were `jobweb`, `eventweb` and the papers `web-search`: each had a
Tavily branch that runs on a key the reader sends. I did not delete them; I cut the company branches out and left the
Tavily-on-the-reader's-key branch (see the second item under "Premises" below).

**`app/api/digest/test/route.ts` stays.** It is not company-key-only: it answers 404 unless `canUseLocalServerProvider()`
and reads the developer's own `GOOGLE_VERTEX_PROJECT` / `GOOGLE_APPLICATION_CREDENTIALS` on the developer's machine, the
same local opt-in class as `PEER_DIGEST_PROVIDER` (Q4, kept). A deployed Peer cannot reach it and the guard bans those
names on Vercel. `spend-scans` scan 5 lists it as a justified exemption.

## Premises that were false or incomplete in the code (the owner's substance was built anyway)

1. **`supportsWebSearch` does not exist on this branch.** The brief says it "must stay readable on the two Gemini provider
   objects"; it is PR #32's field, and nothing here sets or reads it. What is true and now pinned: `resolveProvider` returns
   the provider object itself (`registry.test.ts`, two identity cases, one with a `supportsWebSearch: true` marker), so
   whatever PR #32 sets on the Gemini objects is readable by callers.
2. **Deleting `security/company-spend.ts` changes `/api/feed`'s behaviour for `sources:["web"]`.** The plan called the
   plumbing a dead stub, which it was, but its effect was that any request naming the `web` source got 401/503, even one
   carrying a reader's own Tavily key. The refusal existed only because the one search that source could run was
   Peer-funded. With no company search left there is nothing to refuse, so `web` is now an ordinary source name and the
   route hands the pipeline no capability. The source itself is inert: `feed/pipeline.ts` gives the papers `web` source no
   search options (it never passed the reader's Tavily key, by the earlier "papers do not spend Tavily" decision), and
   `web-search.ts` returns `[]` without a key. Three route tests that pinned the 503 are rewritten to pin the new behaviour.
3. **The fields the brief names are `poolRefresh`, `systemSearchAllowed` and two siblings.** `poolRefreshAllowed` exists
   nowhere in code (only in comments about the deleted entitlement). The removed fields are `poolRefresh` (store request
   bodies, `JobsFeedRequest`, `EventsFeedRequest`, the two `buildDaily*Pool` option types), `systemSearchAllowed`, `userId`
   and `provider` on the `webSearch` blocks of `SourceQuery`/`JobsQuery`/`EventsQuery`, and the `WebSearchProvider` type.
4. **`logStoreUnavailable` was used only by the breaker**, so "if still used" resolved to deleted. `counters.ts` now holds
   exactly the shared infrastructure; `counters.test.ts` pins the export set so a deep-report or forced-rebuild key cannot
   quietly return.
5. **The jobs and events pipelines have no route on main**, so the forced rebuild and the operator search were unreachable
   there already. I still removed them (the brief says so); `getOrBuildCachedPool`'s generic `forceRebuild` argument and
   its `pool-cache.test.ts` cases stay, with no production caller left (not company-keyed; left alone).
6. **`jev-contract.ts` has a byte-identical copy in the `jev-broker` edge function** (`broker-parity.test.ts`). The brief
   says the file keeps its exports and only comments changed; the three `SPEND-CAP` comments naming the deleted estimator
   had to change in both copies or the parity test fails. Comment-only; no edge-function behaviour changed, so no redeploy is
   needed for it.
7. **The brief's F4 counter-delete includes `jev:%` and `jev-edge:%`; the Jev Gemini fallback's `jev-gemini:` namespace is
   not listed**, and nothing could ever have written a `jev-gemini:` row (no capability is minted anywhere). I followed the
   brief's SQL exactly and say so here.

## What each commit did

**F1.** Deleted `metered.ts`, `usage/events.ts`, `usage/context.ts` and their tests. `registry.ts` returns the raw provider.
`usage-log.ts` keeps `logLlmUsage` (the `[llm]` console line) and `logDecisionUsage` / `DecisionUsageLog` (Jev's console line,
not a ledger); the persisted-row write and the company-reservation accumulation are gone. `recordUsageEvent` is out of
`jobweb`, `eventweb` and `web-search`. The forced-rebuild breaker lost its usage-row write (and an unused `surface`
argument) so it still compiled until F3 deleted it. `gemini.ts`'s docblock now says "console line", not "row".

**F2.** Deleted `company-budget.ts` and `company-spend.ts` with tests; `CompanySpendCapability` is gone from `feed/route.ts`
(`companySpendForSources` and its three uses), `feed/types.ts` and `feed/pipeline.ts`. `webSearchOptions` loses its
capability argument and returns `undefined` (the module goes in F3). `gemini.ts` un-exports `chainForTier`,
`disableThinking`, `outputCap` and `GEMINI_API_MODEL_CHAIN`, which existed only for the estimator (PR #32 uses none of
them: checked with `git grep` on its branch). `jev-contract.ts` keeps `isCjkHeavy` / `LATIN_CHARS_PER_TOKEN` /
`CJK_CHARS_PER_TOKEN`.

**F3.** Deleted the breaker, `system-key.ts`, `vertex-search.ts`, `gemini-search.ts`, the two Vertex scripts and their
tests; trimmed `counters.ts`; removed the `poolRefresh` ask from `store/feed.ts` and the pipelines. `jobweb` and `eventweb`
export `resolveSearchProvider(query): "tavily" | null` (a reader's own key present, or nothing); `web-search.ts` runs
Tavily on the reader's key or returns `[]`. README no longer lists `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` as server keys,
and `docs/SETUP_vertex_ai_search.md` (the operator tutorial for the deleted engine) is removed. `BRAVE_SEARCH_API_KEY` is read
by no code; the guard still bans it and `GOOGLE_VERTEX_*`.

**F4.** `web/supabase/migrations/20261007000100_drop_ledger_and_budget.sql`: the three `drop table if exists` statements and
the `usage_counters` delete, exactly as the brief gives them, with a header that tells the owner to export `usage_events`
first and says what is destroyed. No rollback file (the `20261001` precedent). `20260925000000_company_spend_budget.sql` and
its rollback stay as history; `rollback-parity` is green. `.env.example` loses `PEER_COMPANY_SPEND_CAP`;
`docs/JEV-RELEASE-READINESS.md` loses its knob rows (the table row, the A7 row, the revert row) and the SPEND-CAP section
(a removal note takes its place); the historical sweep ledgers in that file are left as history. **Verified on a throwaway
PostgreSQL 16** built from the real `20260904000000`, `20260904000100` and `20260925000000` migrations (and again from a
database that never had the budget migration), seeded with a row in every counter key family: the three tables are gone,
only the `rate:`, `test_email:`, `confirm_email:` and `jev-gemini:` counter rows remain, the file runs twice without error,
and `increment_usage_counter` still works. The cluster was stopped and deleted afterwards.

**F5.** The "What is recorded about model use" section is deleted from `/privacy` and the page test now pins that none of its
phrases comes back and that the neighbouring sections stay. The page's "Last changed" still reads 2026-10-06: N7 had already
set it to the date of this session, so the value is unchanged. The `web/public/CHANGELOG.md` v0.44.0 entry now also says the
record of model use, the dollar budget, the forced-rebuild limit and Peer-funded search are gone, and gives the operator the
new migration.

**F6.** The gate above; `ai-route-personas.test.ts` arms the banned names through the shared helper; the "no outgoing call"
cases in `web-search`, `jobweb` and `eventweb` tests stub `fetch`; two comments naming deleted symbols are reworded.

## Tests deleted, rewritten, added

**Deleted whole (subject deleted):** `llm/providers/metered.test.ts`, `usage/events.test.ts`, `usage/context.test.ts` (F1);
`usage/company-budget.test.ts`, `security/company-spend.test.ts` (F2); `usage/rebuild-breaker.test.ts` (the C1 file),
`search/system-key.test.ts`, `sources/vertex-search.test.ts`, `sources/gemini-search.test.ts`,
`scripts/vertex-search-project.test.ts` (F3).

**Rewritten (substance kept, subject changed):** `llm/providers/gemini.test.ts` (the "ok reflects what the request returned"
cases now read the `[llm]` console line instead of usage rows); `jobweb.test.ts`, `eventweb.test.ts`, `web-search.test.ts`
(the provider-resolution, deny-list and breaker/usage-row cases whose subject is gone became "the environment buys nothing"
and "a dead reader key is reported"; the admission, mapping and title rules are untouched, and the laquo end-to-end chain
now starts from `cleanDisplayText`, which is what the deleted page-title reader called); `api/feed/route.test.ts` (web
source); `api/test-digest/route.test.ts`, `api/profile/send-test-email/route.test.ts` (a vacuous key check became
"carries no search or model options"); `security/spend-scans.test.ts` (scan 3 is now "no operator search credential is read
anywhere" and fails on a revival; the in-scope-by-name list loses the two deleted scripts); `usage/counters.test.ts`;
`store/feed-request-body.test.ts` (the 6-03 forced-rebuild ask block is replaced by "no `poolRefresh` on the wire");
`opportunities/pool-refresh-gates.test.ts` (four gate cases about a deleted gate became three "nothing can force a rebuild"
cases); `feed/paper-source-timeout.test.ts`; `events/benchmark.test.ts` (its live gate); `app/privacy/page.byok-only.test.tsx`;
`api/ai-route-personas.test.ts`.

**Added (new behaviour pinned):** the registry hands back the provider object itself (`registry.test.ts`, 2); `logLlmUsage`
prints one console line and `usage-log.ts` imports no ledger, scope, budget or database client (`usage-log.test.ts`, 3);
`/api/feed` passes the `web` source through with no capability (3, replacing the three refusal cases); the exact export set of
`counters.ts` (1); no `poolRefresh` on the wire (1); the new migration's three DROPs, five key families, kept
infrastructure counters and absence of a rollback file (`upstream-migrations.test.ts`, 4); `spend-scans` scan 3 (the
modules, scripts and symbols must stay deleted; no Brave/Tavily/Vertex-search read anywhere); the pool cannot be forced to
rebuild (3).

## Mutations (one per commit; each restored by editing back, sha256 identical before and after and equal to the committed file)

| Commit | Mutation | Result | sha256 of the file restored |
|---|---|---|---|
| F1 | `resolveProvider` returning a rebuilt copy of the provider (a wrapper again) | 2 failed (`registry.test.ts` identity cases) | `llm/providers/registry.ts` `737b0802efa34b85a318af02571e0410192b0a36773b39959f9f3b7ec8ac8371` |
| F2 | `/api/feed` POST refusing the `web` source with a 503 again | 2 failed (`route.test.ts`; the GET case was not mutated) | `api/feed/route.ts` `3d90b305a66cdb638a0f416ad79df84aa733b98320cede824d3bd4126d6f514d` |
| F3 | `jobweb.resolveSearchProvider` accepting `process.env.BRAVE_SEARCH_API_KEY` | 3 failed (`jobweb.test.ts` "stays DARK with every environment credential set", `spend-scans` scan 3, the build-guard boundary case) | `jobs/sources/jobweb.ts` `dd1ac487ee313b2944dbf6ff7ecb439068ef2183afbcd0e6cdd866a3e3d96165` |
| F4 | the counter delete widened with `or key like 'rate:%'` | 1 failed (`upstream-migrations.test.ts`, "keeps the shared counter table...") | `migrations/20261007000100_drop_ledger_and_budget.sql` `be349a3b80f95c5de9790156840cc83515687a58e5e8b874b86522cb185f52e6` |
| F5 | the "What is recorded about model use" section put back on the page | 1 failed (`page.byok-only.test.tsx`) | `app/privacy/page.tsx` `6532e7731e16e94c75546cb42fcdf22246a27f9b796fc2951bc0eb72913ef49b` |
| F6 | `web-search.ts` reading `process.env.TAVILY_API_KEY` as a fallback key | 5 failed (three `web-search.test.ts` cases, `spend-scans` scan 3 and the guard boundary case) | `sources/web-search.ts` `d4cea6ba10190c1d21039eb42a299d8f03d8a3b3debcf709bede7044e27fafd1` |

Disclosure about the F6 mutation run: those `web-search` cases spied on `fetch` without stubbing it, so under the mutation
the first case let one real request out to Tavily's search endpoint carrying a dummy sentinel key (not a secret, not a model
call, no reader data). I then stubbed `fetch` in every "no outgoing call" case of the three adapter tests, so a regression
now fails on the assertion instead of reaching the network. The sentinel was never anything but `OPERATOR-NOT-A-KEY`.

## What C3 must know

- **`app/api/feed/route.ts` gate (final shape).** `const gate = await requireAiRequest("paper-feed", 60, { allowAnonymous:
  true })`; a `NextResponse` is returned as is. `gate` is `{ user: {id} | null, anonymous: boolean }` (a runtime with no
  sign-in at all is not anonymous). `aiTierCeiling(requestedAiTier, gate)` caps an anonymous caller at tier 0;
  `resolveProvider(llmOverride)` (one argument, the raw provider or null) runs only for `cappedTier >= 2`, and a null
  provider drops the request to tier 0. The Jev hook is untouched from C1: `shadowEntitled = gate.user !== null`, and the
  hook is built only when `jevShadowEnabled()`, a transport resolves, `gate.user.id === paperCacheScope.ownerId`,
  `aiTier >= 2` and an intent exists. There is no `companySpendCapability`, no `entitlement`, no plan.
- **`llm/usage-log.ts` (final shape).** Exports `LlmUsage`, `logLlmUsage` (one `[llm] provider/model path=... in= out=
  think= Nms ok|ERR` console line, nothing persisted), `now`, `DecisionUsageLog`, `logDecisionUsage` (one `[decision]` line).
  Its own test greps its source for owner/paper/intent/key field names, so keep `DecisionUsageLog` free of them.
- **`usage/counters.ts` (final shape).** Exports `CounterReading`, `CounterStore`, `InMemoryCounterStore`,
  `SupabaseCounterStore`, `CounterSupabaseClient`, `getCounterStore`, `resetCounterStoreForTests`, `underLimit` (fails
  open), `breakerTripped` (fails closed), `rateKey`, `testEmailDayKey`, `confirmEmailRequestDayKey`, `endOfUtcHour`,
  `endOfUtcDay`. Consumers: the hourly AI rate limit, the two Resend caps, the source-retry claims, the refresh cooldown, and
  Jev's caps (`security/jev-broker-auth.ts`, `decisions/gemini-fallback.ts`, the edge function through the RPC). A new
  per-reader Jev cap can use `breakerTripped` + `endOfUtcDay` the way those do.
- **`jev-contract.ts`** keeps its exports; its three comments changed in both copies (web and the edge function).
- **Jev's counter rows:** the F4 migration deletes every `jev:%` and `jev-edge:%` row once; nothing reads an old row, so a
  C3 that reuses the prefixes starts clean.
- **A company-funded path still sits in Jev's library: `lib/decisions/gemini-fallback.ts`** (with
  `PEER_JEV_GEMINI_FALLBACK*` in `flag.ts` and the `jev-gemini:` counters). It is a Gemini call "on a company-funded
  provider" inside the Jev shadow. It is inert (nothing mints the capability it requires, and `company-spend.ts`, which its
  comments named, was the only thing that could have), and the brief kept Jev's library for C3, so I only reworded the
  comments that named the deleted module. If "no company-API path" is to hold to the letter, it needs a ruling in C3: delete
  it with its flags and tests, or keep it on a reader-supplied key.
- **`JEV_API_KEY`** is still read in exactly one file (`jev-direct-client.ts`; scan 7 unchanged), and the shadow still runs on
  the company's key until C3 swaps it.
- **PR #32 (beyond C1's list):** drop its hunks in `metered.ts` and `metered.test.ts` (both files are gone); its
  `usage/explain-quota.ts` imports `./events` and `logStoreUnavailable` (both gone), so a surviving cap needs a plain
  `console.error` and no usage row; its privacy sentences about "the usage row that each model call writes" and the section
  they cite must go; `FeedRequest.companySpendCapability` and `webSearchOptions`' second argument no longer exist; `gemini.ts`
  no longer exports `chainForTier` / `outputCap` / `disableThinking` / `GEMINI_API_MODEL_CHAIN` (the PR uses none).

## What the owner must do before merging

1. Everything C1 listed still applies: remove `GOOGLE_API_KEY` from the Vercel project (the build fails while it is set),
   take the `plan` census and apply `20261007000000_drop_plan_and_restore_signup.sql`.
2. **Export `usage_events`, then apply `20261007000100_drop_ledger_and_budget.sql`** in the Supabase SQL editor (ideally on a
   branch first). The export is the only thing here that cannot be recovered: `\copy (select * from public.usage_events) to
   'usage_events.csv' csv header`, or "Export to CSV" on the table. Either order against the code deploy is safe: the code
   reads and writes none of these tables.
3. Remove `BRAVE_SEARCH_API_KEY`, any `GOOGLE_VERTEX_*` name and `TAVILY_API_KEY` from Vercel if set (the guard already
   fails the build on them), and `PEER_COMPANY_SPEND_CAP` (nothing reads it; the guard does not list it).
4. Expect one visible behaviour change from (b) beyond the privacy copy: a request that names the `web` source on
   `/api/feed` is no longer refused with 401/503; it runs as an ordinary source and returns nothing from it (the papers
   `web` source has no key to run on).
5. The Vercel preview is the build gate; `npm run build` was not run here.
6. Decide the Jev Gemini fallback (see "What C3 must know") before C3 starts.

## Environment notes

- I created a throwaway PostgreSQL 16 cluster under `/var/lib/postgresql/c2-verify` to verify F4 and removed it afterwards
  (`/var/lib/postgresql` holds only its original `16` directory again).
- A mistaken `cat > c2logs_dummy` in a chained command created an empty file in the worktree root and hung until stopped; I
  deleted it before any commit (it was never staged).
- Logs and the lint output used for the per-commit warning diffs are in the session scratchpad (`byok/c2logs/`), not in the
  repository.
