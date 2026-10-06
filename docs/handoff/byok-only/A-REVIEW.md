**VERDICT: NOT READY**

One blocking finding: a test gap on the reader's Jev key that mutation C4 proves and about ten lines of test code close. There is no live defect, no money path and no company credential a reader's request can spend. Five SHOULD-FIX items (three of them rendered sentences) and the owner's pre-merge actions (section 5) stand between this branch and a clean merge.

# A review of the BYOK-only branch (PR Aspen-Lab/peer#33)

Reviewer A, 2026-10-06. Branch `remove-paid-tier-restore-byok`, head `918e6103` (equal to `origin/remove-paid-tier-restore-byok`; `git pull --ff-only` said "Already up to date"), base `main` = `a127ad62`, commit 0 `792066ea`. Worktree `scratchpad/byok/wt`. 211 files changed (+9541 / -22545). I read PLAN, JEV-PLAN and the three checkpoints first, then the code at its current state: every production file in `git diff a127ad62..918e6103 --stat` (large deletions by their importers and by grep, edits by diff), and the test diff for weakening. I changed no production or test code except thirty-three reversible mutations, each restored byte-identical and proven with sha256 (4.4); no key value appears in this file (names and invented sentinels only); I made no network call (the only commands that ran test code were `npx tsc`, `npm run lint` and `vitest`, with `fetch` stubbed by the tests, plus a run under a preload that refuses real network calls, 4.1).

## What I found, in one screen

- **Money.** No payment dependency, checkout/pricing/billing route or page, plan/tier/trial/entitlement/premium concept in code, plan column (after `20261007000000`), price table, payment key name, or "upgrade"/"buy" string remains. The 250 grep hits are other senses of a word, tests that assert absence, applied-history SQL and CHANGELOG history (1.1).
- **Company credentials.** No reader request can spend a company model key, search key, Jev key or Gemini fallback: `resolveProvider(override)` is the reader's key or null, `PEER_DIGEST_PROVIDER` is dev-only and the build refuses it on Vercel, the Jev key is a parameter with no environment read, the broker, the budget ledger, the operator search and the Gemini fallback are gone. Two kinds of company credential are still spent for readers and the owner should rule on them (N7: Resend; OpenAlex and Semantic Scholar), and three dormant job-API keys are one import from live (SF-5). The guard prints names only (checked by hand).
- **The Jev key** is traced end to end (3.1) and every "never" holds: not synced, not in the remote merge, the backup, the restore, `FeedRequest`, a pipeline option, a pool or decision cache key or payload, the ledger, the rollover upsert, the response, a log line (log, warn, error), or an error message. Bounds hold (50 / 4 / 20 s / first 401 / 3 throttled / hourly limit). A late answer after the deadline can only reach the decision cache (C22 proves the test sees it).
- **BLOCKING (1):** B-1, the sentinel tests do not watch `console.info`/`console.debug`; mutation C4 survives the whole suite (`route.jev.test.ts`, `screen.test.ts`, `pipeline.jev.test.ts`, `jev-direct-client.test.ts`, `jev-client.test.ts`). Not a live leak; a ten-line test fix.
- **SHOULD-FIX (5):** SF-1 "A paper Jev cannot judge stays where it was." is false (`jev-setup.tsx:40`, CHANGELOG v0.45.0, `apply.ts:17`); SF-2 `APP_VERSION` still 0.44.0 (`version.ts:6`); SF-3 "not stored" is untrue of a Gemini key held in a never-evicted map (`gemini.ts:220,243-247`); SF-4 the Jev row says "applies to your next briefing" to a signed-out reader (`jev-setup.tsx`); SF-5 dormant company job-API key fallbacks, JSearch bills per request (`jobs/sources/*`, guard list).
- **Gates (mine, at `918e6103`):** `tsc` 0; lint 0 errors / **151** warnings; `TZ=America/Chicago npm test` **5529 passed / 8 skipped** (281 files + 3 skipped), identical when every real network call is refused (0 attempts logged). `npm run build` was not run (symlinked `node_modules`); the Vercel preview is the build gate and is red by design until `GOOGLE_API_KEY` is removed.
- **Mutations:** 33 of my own (6 in scope (a), 5 in (b), 22 in the Jev work), each against the whole suite and restored byte-identical (sha256 recorded, all equal to the committed blobs): 31 caught, 2 survived: C4 (B-1) and C21 (an equivalent mutant, N5).
- **Owner checklist (section 5):** blocking before merge are items 1 (Vercel variables; preview green), 4 (`private_decisions` migration), 5 (plan census, then migration 1), 6 (export `usage_events`, then migration 2), 7 (`supabase functions delete jev-broker`), 8 (version bump) and 9 (B-1 and SF-1, SF-3, SF-4). The rest can follow.

---

## Findings

Grading as in the brief. BLOCKING: money can move, a company credential can be spent, a reader key can leak or persist, a test weakened to hide a regression, a mutation uncaught in the key path. SHOULD-FIX: a wrong or unbacked sentence in rendered copy, a bound that is not what the copy says, a checklist gap. NOTE: style, a comment, a choice I would have made differently but accept.

### BLOCKING

**B-1. A reader's Jev key written to `console.info` or `console.debug` would pass the whole suite.**
Files: `web/src/app/api/feed/route.jev.test.ts:221-223`, `web/src/lib/decisions/screen.test.ts:581-583`, `web/src/lib/feed/pipeline.jev.test.ts:484-485`, `web/src/lib/decisions/jev-direct-client.test.ts:328-330`, `web/src/lib/decisions/jev-client.test.ts:263-265`.
What is wrong: the brief asks whether the sentinel tests search every write and every console call. They search every store write the flow makes, the response, and `console.log`, `console.warn` and `console.error`; none spies `info` or `debug` (`pipeline.jev.test.ts` spies `log` and `warn` only). `feed-sync.tsx:174` shows the codebase does use `console.info`.
Evidence: mutation C4 (4.4). `console.info(options.apiKey)` inserted before `logAttempt(result, latencyMs)` at `screen.ts:332` leaves the full suite green (5529 passed, 8 skipped), and a marker run shows the mutated line executing 184 times inside the Jev suites with all 65 tests passing. By the brief's own grading a mutation uncaught in the key path is blocking. **There is no live defect:** no production line logs the key (the feed route has no `console.` call at all, asserted on its source by `privacy/page.byok-only.test.tsx`; `screen.ts` logs only through `logDecisionUsage`, which has no key field). It is a hole in the guard around the one secret this branch adds.
Smallest fix: one helper in `web/src/test-support/` that spies `log`, `info`, `debug`, `warn` and `error` and returns their joined text, used in the five places above (about ten lines); optionally a scan in `spend-scans.test.ts` that no `console.` call under `lib/decisions/` or `app/api/feed/` names `apiKey` or `jevApiKey`. Re-run C4: it must go red.

### SHOULD-FIX

**SF-1. "A paper Jev cannot judge stays where it was." is false.**
`web/src/components/profile/jev-setup.tsx:40` (Profile and Welcome), `web/public/CHANGELOG.md:15-16` (v0.45.0); pinned by `web/src/components/profile/jev-setup.test.tsx:97`; the same claim in the code comment `web/src/lib/decisions/apply.ts:17-18` ("so it keeps its local place").
Evidence: `apply.ts:102-107` ranks by `0.5 * localRank + 0.5 * jev`, and a paper with no usable answer contributes the neutral 0.5, so it is ranked as a middling paper, not left in place. Same arithmetic: 50 papers, the one at local index 4 unjudged and the other 49 answered 0.8, it ends at position 18; at index 0 it ends at position 14; others at 0.65 and index 4 gives position 11 (replicated in Python from the file's formula; the tests only pin "no decision at all" and "among papers Jev judged neutral", `apply.test.ts:93,98`). It stays put only when nothing was judged.
Smallest fix: change the sentence to what the code does and update the one test line and the comment, e.g. "A paper Jev cannot judge counts as neutral: Jev neither lifts nor demotes it, but papers Jev rates well can move ahead of it." (Changing the code to keep unjudged papers in their slots is the larger alternative.)

**SF-2. `APP_VERSION` was not bumped with the v0.45.0 entry.**
`web/src/lib/version.ts:6` is `"0.44.0"`; `web/public/CHANGELOG.md:5` is `## v0.45.0`. The file's own comment says to bump it in the same commit as the CHANGELOG entry. It is rendered in `components/shell/version-line.tsx:25` and written into every exported reading as `peer_version` (`lib/papers/reading-markdown.ts:236`). No test compares them.
Smallest fix: `"0.45.0"` (and, if you want it gated, a test that the top CHANGELOG heading equals `APP_VERSION`).

**SF-3. "The key is used for that request and is not stored." is not literally true for a Gemini key.**
`web/src/app/privacy/page.tsx:47`. `web/src/lib/llm/providers/gemini.ts:220,243-247`: `const apiClients = new Map<string, GoogleGenAI>()` is keyed by the reader's raw API key and never evicted, so every Gemini key a server instance has seen stays in that instance's memory for its life, and the map grows without bound with distinct keys (a signed-in reader can make 60 requests an hour with 60 different strings). Nothing is persisted to disk or to the database, so the Jev sentence is unaffected (`callJev` caches nothing), but the model-key sentence promises more than the code does. Pre-existing code; the sentence is new in this branch (C1's copy commit `0e2891af`).
Smallest fix: build the client per call (`new GoogleGenAI({ apiKey })` is cheap) and delete the map; or say "is not saved".

**SF-4. The Profile "Paper screening" row tells a signed-out reader a key "applies to your next briefing" and is "saved", with no note that it is never used until they sign in.**
`web/src/components/profile/jev-setup.tsx:44-45,110-114` (no sign-in text anywhere in the file) against `web/src/store/feed.ts:778-781` (the key is sent only for `signed-in` or `unconfigured`) and `route.ts:711-731` (the server uses it only for a signed-in owner). The model-key row has the equivalent note (`profile/page.tsx` "Sign in to turn this on").
Smallest fix: read `useSyncGate((s) => s.authOutcome)` in `JevSetup` and, when it is `signed-out` and a usable key is saved, show "Sign in to use it: Jev screens only for a signed-in reader."

**SF-5. Company job-API keys are still read as a fallback, JSearch bills per request, and none of them is on the guard's list.**
`web/src/lib/jobs/sources/jsearch.ts:81`, `adzuna.ts:128-129`, `usajobs.ts:93-95` (`request key || process.env.X`); `README.md:466` calls JSearch "paid beyond a small free tier"; `spend-scans.test.ts:223-226` says a key that "ever bills per request, is cut the same round". Today no route reaches them (`runJobsPipeline`, `jobs/pipeline.ts:262`, and `jobs/sources/index.ts` are imported by no non-test file), so no reader request can spend them: **not blocking**. But the branch's red line is "no company credential spent on anyone's behalf", and these are one import away from live.
Smallest fix: delete the `|| process.env.X` half in the three adapters (a reader's own key travels in the request), empty the "accepted" list in scan 3, and add `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JSEARCH_API_KEY`, `USAJOBS_API_KEY` (and, one line, `GEMINI_API_KEY`) to `FORBIDDEN_ON_VERCEL`.

### NOTE

**N1. Choice (i): a rejected-key pool is not cached.** Accept for merge; see 3.3. The cost the checkpoint did not state is that a reader with both keys re-runs the model rerank on their model key on every load while the Jev key stays wrong. Follow-up on the client: omit `jevApiKey` from `paperFeedRequestBody` while `useJevScreeningStore.report.status === "rejected"` (the store already clears the report when the key changes).

**N2. Choice (ii): an `unavailable` pool is cached for the day.** Right (a rebuild per load during an outage would wait the full 20 s each time). Consider a short TTL later.

**N3. Choices (iii), (iv), (v)** are right (3.3). `exportProfileDocument` and `importProfile` have no UI caller today, so D6 is correct and inert.

**N4. A comment says "one failed Jev call".** `web/src/lib/feed/pipeline.ts:1884`; `screen.ts` allows up to four in flight and C3's checkpoint says both. Say "at most the calls already in flight".

**N5. Equivalent mutant C21.** The `closed` guard on `decisions.set` (`screen.ts:324`) is redundant: `snapshot()` copies the map. The "late answer cannot change the result" test passes because of the copy. Keep both; the test name overstates what it exercises.

**N6. Both keys: reasons may not match Jev's top 20.** `feed/pipeline.ts:874-892`: Tier 2 explains the top 20 of its own ranking (`tier2-rerank.ts` `REASON_LIMIT`); Jev's order is shown.

**N7. Company credentials that are spent for a reader and that PLAN section 4 left in scope.** Resend (`send-test-email`, `confirm-email` to an arbitrary typed address, the cron digest) and the OpenAlex and Semantic Scholar keys (`GET`/`POST /api/feed` with anonymous allowed, `GET /api/affiliation/resolve` and `/seeds`, none of which needs a sign-in or a rate limit). Free or capped, but not "no company credential". The owner should say whether the red line covers them. (`/api/papers/search` and `/api/topics/suggest` call OpenAlex directly, unkeyed.)

**N8. Small copy and privacy precision.** (a) "the 50 best candidates" is an upper bound (`slice(0, 50)`); with a smaller pool it is all of them. (b) The privacy page does not say the key reaches the server on every load (only a fresh build calls Jev), does not list the selected word meanings (`senses`) among what Jev receives (`jev-contract.ts:189-210`), and does not list the paper id, model id and token counts kept in `private_decisions.payload`. (c) `screened` counts cache hits, so "Jev answered only N of M" can include answers from earlier days. (d) "Jev reads English best." is backed by `docs/jev-abc/P3-B-20260924T0525Z.md:48,88` (the vendor's page as fetched 2026-09-24), not by the code; cite it in a comment at `jev-setup.tsx:40`. (e) `parseJevApiKey` accepts non-Latin-1 characters; `fetch` then rejects the header before any request, every call is `network_error`, and the day's pool is cached as "unavailable" with "Jev did not answer" instead of "That does not look like a key".

**N9. `GEMINI_API_KEY` is not on the guard's forbidden list.** `@google/genai` reads it (and `GOOGLE_API_KEY`) when constructed without a key (`getApiKeyFromEnv`, `node_modules/@google/genai/dist/node/index.mjs:21278`); both construction sites pass explicit options, so nothing reaches it. One line of defence in depth (SF-5 fix).

**N10. The guard's required list omits the publishable/anon Supabase key** that `hasSupabaseAuthConfig()` needs; a deployment without it builds and answers 503 on every AI route.

**N11. Stale or loose sentences in unchanged or shared copy.** `app/welcome/page.tsx:457-460` "Tavily web scouting ... remains limited by Peer's daily search schedule" names a schedule that no longer exists (Events and Jobs have no route). `web/public/CHANGELOG.md:73` "the only search a briefing can run is on a Tavily key you paste in yourself": true as an upper bound, but no briefing surface sends that key. `README.md:445` lists `GOOGLE_API_KEY` as a local-development provider key (nothing reads it) and `README.md:466` names `RAPIDAPI_KEY` (nothing reads it). `README.md:189` "never synced, stored or logged" means by the server; the browser stores it.

**N12. Provider cost copy is pre-existing and unbacked.** `components/profile/ai-setup.tsx:70-76` shows monthly dollar estimates for the reader's own provider ("about $60/month during Sonnet 5 introductory pricing"). They are not Peer's prices and no money moves to the owner; they are numbers nothing in the repository measures.

**N13. A word survives in applied history.** `web/supabase/migrations/20260904000200_profile_plan.sql:29,33` still says "a future Stripe webhook". The file is applied history pinned byte for byte; the columns it describes are dropped by `20261007000000`.

**N14. Key-validity oracle.** A signed-in reader can make Peer's server send up to four Jev calls per fresh build with a key of their choosing and see `meta.jevScreening.status` (`rejected` or not). It tells them whether a string is a valid Jev key. Real keys are not guessable, 60 builds an hour is the cap per account, and sign-up is open; low.

**N15. Late in-flight Jev calls and billing.** After the 20 s deadline up to four calls are still running (not aborted) and a throttled one retries twice; they can be billed to the reader and can only write the decision cache (3.2).

**N16. Provider errors are logged server-side.** `api/papers/report/route.ts` `console.error("[papers/report] shallow generation failed:", err)`, `gemini.ts` `console.warn("[gemini] ... failed:", err)`. Some providers echo a masked fragment of a rejected key in the error text. Not a Jev path; the model-key privacy sentence says "not stored", not "not logged".

**N17. Local-dev reachability, and one checkpoint claim.** The local Jev branch is reachable in `next dev` with Supabase configured, not only without it (3.4); safe, but the brief's wording should be corrected. C3's checkpoint says a self-hosted runtime without Supabase keeps its model key; the code answers 503 on the feed POST and every other AI route there (pre-existing, 3.4).

**N18. The blend weights are pinned only by the end-to-end tests.** `apply.ts:7-30` says each rule is "pinned by `apply.test.ts`"; mutation C19 (local weight 0, Jev weight 1) is caught by `pipeline.jev.test.ts` and `route.jev.test.ts` but not by `apply.test.ts`. The weights are unmeasured named constants (3.2); say so in the header or add one exact-value case.

---

## 1. The red line

### 1.1 Can money move? No.

`git grep -niE "stripe|paddle|lemon ?squeezy|checkout|pricing|subscription|billing|entitle|trial|premium|upgrade|paid tier|plan_|\"plan\"|price" -- web/src web/scripts web/supabase web/public web/package.json` returns 250 lines in 85 files (154 lines in non-test files). Every hit was read. None is a path:

| What matched | Where | Verdict |
|---|---|---|
| No payment SDK or dependency | `web/package.json` (21 runtime dependencies: Anthropic, Google, Resend, Supabase, Vercel Analytics and UI libraries; no payment library); `package-lock.json` has one `paypal.me` URL, a funding link in a dependency's own metadata | not a path |
| No checkout, pricing, billing or plan route or page | `web/src/app` has `api auth changelog data-sources notes papers persona privacy profile saved search welcome`; `git ls-tree` for `pricing\|billing\|checkout\|upgrade\|subscribe\|plans` under `web/src/app` is empty | not a path |
| No plan, tier, trial, entitlement or premium concept in code | zero hits in non-test production code except the sense of a word (below); `lib/entitlement/*`, `components/plan/*`, `usage/deep-report-quota.ts`, `navigation/upgrade-destination.ts` are deleted | not a path |
| A word in another sense | `subscription.unsubscribe()` (Supabase auth, `use-auth-user.ts:41`, `profile-sync.tsx:1000`, `feed-sync.tsx:303`), `stripe` as a UI rail (`ui.tsx:502`, `feed-tile.tsx:24`), `price`/`priced` in comments and in the event-price regex (`event-details.ts:43-45,262-286`, `eventweb.ts:255` a URL-path filter), `trial run` (`build-reference-idf.mjs:24`), `upgradeCandidateQuality` (`figures/extract.ts:608-700`), "subscription required" paywall detectors (`full-text.ts:67`, `pdf-extract.ts:131`), "entitled to work in Canada" (`visa.ts:106`), `MAX_EVENT_PLAN_ENTRIES` (`enrichment.ts:137`) | not a finding |
| The word in provider copy | `ai-setup.tsx:23,70-75,413-422,489`: "Anthropic Claude - premium quality", "about $60/month ...", "A ChatGPT subscription and OpenAI API billing are separate". These describe what a reader's own provider bills the reader. No money moves to the owner. Unchanged from main. See NOTE N12 (unbacked dollar estimates) | not a path |
| History kept on purpose | `migrations/20260904000200_profile_plan.sql` (plan columns, and two comments that say "a future Stripe webhook"), `20260925000000_company_spend_budget.sql` and its rollback, `20260904000100_usage_events.sql`: applied history, pinned byte for byte by `upstream-migrations.test.ts`; the two new migrations drop what they created. `web/public/CHANGELOG.md:1174-1182` (v0.24.0, "free / trial / paid machinery") is history; v0.44.0 says the plans went | not a path |
| Tests that assert absence | `spend-scans.test.ts`, `no-company-model-copy.test.ts`, `upstream-migrations.test.ts`, `api/profile/route.test.ts` ("a forged plan field is never written", "a stored plan never reaches the browser") | good |
| No upgrade or buy string in rendered copy | `git grep -iE "free plan\|paid tier\|Peer Pro\|go pro\|upgrade (to\|now)\|buy \|purchase\|credit card"` over production code returns only a paywall detector and a comment | not a path |
| No payment key name anywhere | the guard's lists and `.env.example` name no Stripe/Paddle/Lemon variable; `.env.example` is 213 lines of names and flags | not a path |

The database side: after `20261007000000` a database that ran every migration has no `plan`, `trial_started_at`, `trial_ends_at` or `plan_updated_at` column, `handle_new_user()` is the pre-plan body (byte-for-byte `docs/handoff/supabase-backup-2026-09-14/handle_new_user.before.sql`), and `profiles` grants are not widened.

### 1.2 Can Peer spend a company credential for a reader? Not on any route today. Four things the owner should look at.

Every `process.env.*` read of a `KEY`, `SECRET`, `TOKEN`, `PASSWORD` or `CREDENTIALS` name in `web/src`, non-test (command: `git grep -nE "process\.env(\.|\[)" -- web/src` filtered, then each read traced):

| Variable | Read at | What it is for | Can a reader's request cause an outbound call on it? |
|---|---|---|---|
| `ADMIN_TOKEN` | `api/admin/uploads/block/route.ts:32` | inbound bearer for the admin block route | No: it is compared, never sent |
| `CRON_SECRET` | `jobs/dispatch-digests/route.ts:364`, `jobs/prepare-dashboards/route.ts:443`, `jobs/purge-uploads/route.ts:11` | inbound bearer for the three cron routes | No |
| `DIGEST_EMAIL_CONFIRM_SECRET` | `email/confirm-token.ts:43` | HMAC key for the "confirm this address" link | No outbound call; local crypto |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase/admin.ts:9` and the stores that build an admin client (`counters.ts`, `delivery-ledger.ts`, `rollover-store.ts`, `private-decision-cache.ts`, `pool-cache-supabase.ts`, ...) | the company's own database, on the server | Yes, by design: every signed-in request writes its own rows. Infrastructure, not model spend |
| `NEXT_PUBLIC_SUPABASE_*` | several | public project URL and publishable key | n/a |
| `RESEND_API_KEY` | `email/send-digest.ts:69`, `api/profile/send-test-email/route.ts:149` | the company's Resend account | **Yes.** `POST /api/profile/send-test-email` (signed in, 3 a day, fails closed, to the reader's own address), `POST /api/profile/confirm-email` (5 a day, to an address the reader types), and the cron digest to readers who opted in. PLAN section 4 classed it as infrastructure and C1-C3 left it. It is a company credential spent for a reader, so the owner should say whether it is inside the red line (N7) |
| `OPENALEX_API_KEY` | `sources/openalex.ts:30`, `openalex-topic.ts:67`, `openalex-semantic.ts:71`, `affiliation/openalex.ts:30` | optional bearer to OpenAlex; unset means unkeyed | **Yes**, on every feed build, including the signed-out `GET`/`POST /api/feed` and the open `GET /api/affiliation/resolve` and `/seeds` (no sign-in, no rate limit). `/api/papers/search` and `/api/topics/suggest` call OpenAlex directly, unkeyed. `.env.example:16-18` says whether OpenAlex bills past a free allowance is unverified. Owner to confirm it is a free allowance (N7) |
| `SEMANTIC_SCHOLAR_API_KEY` | `sources/semantic-scholar-client.ts:26,86` | rate-limit headroom on the free API | Yes, same as above; free |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JSEARCH_API_KEY`, `USAJOBS_API_KEY`, `USAJOBS_USER_AGENT` | `jobs/sources/adzuna.ts:128-129`, `jsearch.ts:81`, `usajobs.ts:93-95` | `request key \|\| company env key` for the jobs surface | **No route reaches them**: `runJobsPipeline` (`jobs/pipeline.ts:262`) and `jobs/sources/index.ts` are imported by no non-test file. But `README.md:466` says JSearch is "paid beyond a small free tier", and `spend-scans.test.ts:223-226` says such a key "is cut the same round" it ever bills per request. Dormant, not live (SF-5) |
| `ANTHROPIC_API_KEY` | `llm/providers/anthropic.ts:29` | the developer's own key, singleton only | No on Vercel: reached only through `resolveLocalOptInProvider()`, behind `isLocalDevRuntime()` |
| `OPENAI_API_KEY`, `QWEN_API_KEY`/`DASHSCOPE_API_KEY`, `DEEPSEEK_API_KEY` | `openai.ts:36`, `qwen.ts:37`, `deepseek.ts:40` | same | same. The reader-key constructors take the key as an argument and the default only applies for `undefined`, which `resolveUserProvider` never passes |
| `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS` | `llm/providers/gemini.ts:227,313,337,360,385,389`, `api/digest/test/route.ts:48-50`, `events/benchmark-live-gate.ts:5` | the developer's Vertex project (Application Default Credentials) | No on Vercel: `geminiProvider` (the Vertex singleton, also the `ollama` placeholder) is reached only through the local opt-in; `api/digest/test/route.ts:42` answers 404 unless `canUseLocalServerProvider()`. Banned on Vercel by prefix |
| `GOOGLE_API_KEY` | read by no code (`spend-scans.test.ts` scan 8). `createGeminiApiProvider(apiKey)` throws "GOOGLE_API_KEY not set" strings at `gemini.ts:406,523` when handed an empty reader key | none | No. Both `new GoogleGenAI(...)` sites (`gemini.ts:233,246`) pass `vertexai`+`project` or an explicit `apiKey`, so the SDK's own implicit read of `GOOGLE_API_KEY`/`GEMINI_API_KEY` (`@google/genai` `getApiKeyFromEnv()`) is never reached |
| `JEV_API_KEY`, `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `PEER_JEV_*` | read by no code | none | No. Scans 3 and 7 assert it |

The four things: (1) Resend and (2) OpenAlex/Semantic Scholar are company credentials a reader's request does spend on, both left in scope by PLAN section 4 as infrastructure or free tier; the owner should confirm (N7). (3) The jobs-source env fallbacks are dormant but one import from live, and JSearch bills per request (SF-5). (4) `GEMINI_API_KEY` and the job-API names are not on the guard's forbidden list (1.3).

### 1.3 The build guard (`web/scripts/assert-byok-production-env.mjs`)

Run by hand from a clean environment (`env -i`, invented sentinels, output searched for them):

| Run | Result |
|---|---|
| `VERCEL=1`, the two required Supabase names, nothing else | exit 0, prints nothing |
| `VERCEL=1` with the 13 names armed: `GOOGLE_API_KEY, PEER_DIGEST_PROVIDER, GOOGLE_VERTEX_PROJECT, GOOGLE_VERTEX_LOCATION, ANTHROPIC_API_KEY, OPENAI_API_KEY, QWEN_API_KEY, DEEPSEEK_API_KEY, BRAVE_SEARCH_API_KEY, TAVILY_API_KEY, JEV_API_KEY, PEER_JEV_BROKER_SECRET` and `PEER_FEED_AI_TIER=2` | exit 1; the message lists all 13 **names**; the invented values appear 0 times in the output |
| `VERCEL=1` without the Supabase names | exit 1, names `NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY` |
| no `VERCEL`, a banned name set | exit 0 (local `next dev` keeps its `.env.local`) |
| `GEMINI_API_KEY`, `JSEARCH_API_KEY`, `ADZUNA_APP_KEY`, `USAJOBS_API_KEY`, `OPENALEX_API_KEY`, `RESEND_API_KEY`, `PEER_ENTITLEMENT_MODE`, `PEER_COMPANY_SPEND_CAP`, `PEER_JEV_SHADOW`, each alone, on Vercel | exit 0 (not banned) |

Names only in the output: yes; nothing indexes `env` for printing (`configuredForbiddenNames` returns names filtered from literal arrays, lines 136-146; `formatAuditMessage` joins them), and `assert-byok-production-env.test.ts` asserts it with a sentinel. Forbidden list (lines 67-93 plus the `GOOGLE_VERTEX_` prefix, 134): the model key, the five env provider keys, the Vertex family, Tavily, Brave, `JEV_API_KEY`, `PEER_JEV_BROKER_SECRET`, `PEER_DIGEST_PROVIDER`, and `PEER_FEED_AI_TIER` above 0. Required list (29-32): the two Supabase names.

Gaps, none blocking: the forbidden list does not name `GEMINI_API_KEY` (the SDK reads it implicitly when constructed without a key; nothing here constructs one, so it is defence in depth, N9) or the dormant job-API keys (SF-5). The required list omits the publishable/anon key that `hasSupabaseAuthConfig()` also needs, so a deployment without it builds and then answers 503 on every AI route (N10). The guard runs as `prebuild`; if the Vercel project overrides the Build Command with something that skips `npm run build`, it does not run (checklist).

## 2. The BYOK gate

### 2.1 Absent or invalid key means no AI, on every path

- `requireAiRequest` (`security/ai-request.ts:96-180`) runs before every `resolveProvider` (scan 5 asserts the five guarded routes: digest, feed, figure, report, test-digest; `figure` and `test-digest` reach no model but fetch or send; the explain and paragraph-guide routes belong to PR #32 and are not on this branch). Signed out and not `allowAnonymous` is 401 (line 128-136). Anonymous is allowed on the feed only, and `aiTierCeiling` (191-197) caps an anonymous caller at tier 0 whatever the body asks.
- `aiAvailability(profile, auth)` (`feed/ai-tier.ts:58-61`) is `"byok"` only for a non-default provider with a non-blank key and an auth outcome of `signed-in` or `unconfigured`. Mutation A1 (key check removed) fails 3 test files.
- `resolveProvider(override)` (`llm/providers/registry.ts:122-127`): a usable override builds the reader's provider (key from the request, trimmed, at most 4096 characters), otherwise `canUseLocalServerProvider() ? resolveLocalOptInProvider() : null`. There is no third branch. `git grep` for every provider singleton and `create*Provider` outside the registry finds none; the only callers of `resolveProvider` are digest, feed, report (x3), `tier2-rerank.ts:73` and `query-gen.ts:325`. A wrong-but-non-empty key resolves, the provider call fails, and each caller degrades (`digest/route.ts:92` "Degrade gracefully to Tier 0 on any LLM error"; tier-2 keeps the Tier-1 order).
- `PEER_DIGEST_PROVIDER` is local-only: `canUseLocalServerProvider()` is `isLocalDevRuntime()` (`env/local-dev.ts:22-28`: `NODE_ENV==="development"` and no `VERCEL` and no `VERCEL_ENV`). On a Vercel build the guard fails the build and names it (A4: removing it from the list fails `assert-byok-production-env.test.ts`); at runtime a deployed process ignores it (A3: dropping the local-only check fails `registry.test.ts` "does not treat a Vercel preview as local development" and "resolves nothing in production with every operator credential set").
- Feed route `web` source: `parseSources` accepts `web` (`route.ts:535-543`), and `sources/web-search.ts:42` returns `[]` when `query.webSearch?.tavilyApiKey` is blank; `feed/pipeline.ts` hands the `web` source no `webSearch` at all (the diff removed the line). So the request that used to get 401/503 now runs a source that makes no call. It spends nothing.
- `GET /api/feed` has no gate, no rate limit and no model (`aiTier` absent, `PEER_FEED_AI_TIER` banned on Vercel). Unchanged from main; it does reach OpenAlex and Semantic Scholar with the company's free-tier keys (N7).

### 2.2 The two migrations

`20261007000000_drop_plan_and_restore_signup.sql`: `create or replace function handle_new_user()` with the pre-plan body, then `alter table profiles drop column if exists` x4, no `cascade`. Safe on a database that never had `20260904000200` (every drop is `if exists`; the function is re-declared either way). Safe on one that did: the `plan` check constraint goes with its column; no view, policy or index depends on the columns (the original migration's only RLS work is column grants, which go with the columns); no grant is widened (the table-level revoke from `20260904000200` stands, as `20260922010000` relies on). C1 ran it twice on a throwaway PostgreSQL 16. It destroys the four columns' values; the census query is in its header.

`20261007000100_drop_ledger_and_budget.sql`: `drop table if exists` x3 (`company_model_prices`, `company_spend_caps`, `usage_events`), no `cascade`; `delete from usage_counters where key like 'deep:%' or 'forced_rebuilds_today:%' or 'company_spend:%' or 'jev:%' or 'jev-edge:%'`. Safe on a database that never had the budget migration (`if exists`; `usage_counters` exists from `20260904000000`, which the code needs anyway) and on one that did. It destroys `usage_events` (export first, header says how).

Dropped columns and tables read by surviving code: none. `git grep -E "usage_events|company_spend_caps|company_model_prices|plan_updated_at|trial_ends_at|trial_started_at"` over production code returns nothing; `api/profile/route.ts` no longer reads a plan and `profilePatchToRow` ignores a forged one (tested).

`usage_counters` prefixes that survive, and who writes them:

| Key prefix | Writer |
|---|---|
| `rate:<scope>:<user>:<hour>` | `requireAiRequest` (`ai-request.ts:153`), every AI route |
| `test_email:<user>:<day>` | `api/profile/send-test-email/route.ts:191` (3 a day, fails closed) |
| `confirm_email:<user>:<day>` | `api/profile/confirm-email/route.ts:184` (5 a day, fails closed) |
| `pool-retry:<hash>:<source>:<ms>`, `pool-retry-day:...` | `feed/pipeline.ts:1085,1097` (`claimSourceRetry`, the one bounded self-heal of a degraded cached pool) |
| `rate:refresh:...`, `rate:refresh-day:...` | `dashboard/refresh-cooldown.ts:136-152`, **not wired to any route** (`claimManualRefresh` has no production caller) |

None starts with a deleted prefix, so the `delete` removes nothing a live writer uses.

## 3. Jev on the reader's key (C3)

### 3.1 The key, end to end, and every "never"

Path (each hop read in the code):

1. `UserProfile.jevApiKey` (`types/index.ts`, default `""`), written only by `updateJevApiKey` (`store/profile.ts`, trims, blank clears) and persisted in the browser's `peer-profile` store like the model key.
2. `paperFeedRequestBody` (`store/feed.ts:778-781`): `jevApiKey` is `parseJevApiKey(profile.jevApiKey)` only when `auth` is `signed-in` or `unconfigured`; it is one top-level body field, never inside `llmOverride`, not gated on the AI search pill or a model key (D7).
3. `POST /api/feed` (`app/api/feed/route.ts:711`): `parseJevApiKey((body as Record<string, unknown>).jevApiKey)` (`lib/decisions/jev-key.ts`: a string, trimmed, 1 to 512 characters, no whitespace or control character).
4. The closure (`route.ts:711-731`): built only when `gate.user.id === paperCacheScope.ownerId`, or, in `next dev` only, for the reader the dev gate lets through. It captures `jevApiKey`, `ownerId`, `intent`, `senseConcepts`, `cache`. It is passed to `runLedgerAwareFeed` as the fifth argument, not inside the `FeedRequest` object.
5. `screenWithJev` (`decisions/screen.ts:220`) calls `callJevDirect(request, { apiKey: options.apiKey, ... })` (line 287).
6. `callJevDirect` (`jev-direct-client.ts:56-75`) re-parses the key, builds the wire request, calls `callJev` with `apiKey`; no environment read, no entitlement flag, no counter. Mutation C1 (read `process.env.JEV_API_KEY` when the parameter is blank) fails 5 tests in `jev-direct-client.test.ts` and `spend-scans.test.ts`.
7. `callJev` (`jev-client.ts:83`): `authorization: \`Bearer ${options.apiKey}\`` and nowhere else. The endpoint is the fixed `DEFAULT_JEV_ENDPOINT` (`https://api.typesafe.ai/v1/systemone`); the route and `callJevDirect` never pass an `endpoint`, so the key cannot be redirected. Mutation C18 (key also put in the URL) fails the route and unit sentinel tests.

Each "never", with the line that makes it true:

| Never in | Why it holds | Test that pins it |
|---|---|---|
| the profile sync payload | `profile-sync.tsx:148-175` destructures `jevApiKey` out of `remoteProfilePayload` and `void`s it (line 174) | `profile-sync.test.tsx` (full key-set pin and redaction case); mutation C7 fails it |
| the remote merge | `store/profile.ts` `hydrateFromRemote` has no `jevApiKey` line (it does have lines for `feedAiApiKey` and `tavilyApiKey`; the Jev key was not added) | `store/profile.test.ts` "a remote profile can never set it" |
| the backup export | `exportProfileDocument` returns `stripCredentialFields(profile)` and `CREDENTIAL_LIKE_FIELDS` has `"jevApiKey"` (`merge.ts:496-503`) | `store/profile.test.ts` "a backup file carries no credential"; mutation C6 fails it |
| the restore and `importProfile` | `mergeProfileFromBackup` strips again; `importProfile` now strips (`profile.ts:809`) | same file, "importProfile cannot install a credential" |
| `FeedRequest` | not a field of the type (`feed/types.ts`) and the closure is the only carrier | `route.test.ts` "the key is not in the request handed to the pipeline, in any field"; mutation C2 fails 2 tests |
| a pipeline option | the option is `jevScreen`, a function; the key is not an input of `runFeedPipeline` | `pipeline.jev.test.ts` |
| a pool cache key or payload | `derivePoolCacheKey` takes `jevScreening: true`, a boolean (`pool-cache.ts:522`); the pool records `jev: {status, screened, of}` | `pool-cache.test.ts` (three existing keys pinned byte-identical; the field); mutation C17 fails it |
| the decision cache key or payload | key is `deriveDecisionCacheKey({ownerId, intentHash, paperContentHash, provider, modelVersion, rubricVersion})`; payload is `DecisionResult {paperId, answers, usage, modelId}` | `route.jev.test.ts` and `screen.test.ts`; mutation C3 (key added to the payload) fails them |
| the delivery ledger, the rollover upsert | they receive items, identities, an intent version; the closure never reaches them | `route.jev.test.ts` ledger-on case searches `prepareBatch` and `upsert` call arguments |
| the response | `meta.jevScreening` is `{status, screened, of}` | `route.jev.test.ts`, `route.test.ts` |
| a console line | the feed route has no `console.` call at all (`privacy/page.byok-only.test.tsx` asserts it on the source); `logDecisionUsage` takes counts and a status | see the coverage gap below |
| an error message | `callJev` and `callJevDirect` interpolate nothing; `invalid_response.detail` is the validator's text about Jev's response | `jev-client.test.ts`, `jev-direct-client.test.ts` |
| `logDecisionUsage` | `DecisionUsageLog` has no key, owner, paper or intent field; `usage-log.test.ts` greps the source for such names | `usage-log.test.ts` |

**Coverage of the sentinel tests.** `route.jev.test.ts` records every write the real route and the real pipeline make to the stores that exist in the default configuration: the pool cache's `set` (key and JSON), the decision cache's `get` and `set` (key and JSON), and, in the ledger-on case, the arguments of `prepareBatch` and `upsert`; it also searches the response text and the text of `console.log`, `console.warn` and `console.error`. That is every write the flow performs when the optional channel caches are off (`PEER_CHANNEL_*` unset, which is the default). It is not every console method: `route.jev.test.ts:221-223`, `screen.test.ts:581-583`, `pipeline.jev.test.ts:484-485` (log and warn only), `jev-direct-client.test.ts:328-330` and `jev-client.test.ts:263-265` spy on `log`, `warn` and `error`. A `console.info` or `console.debug` of the key would pass all five. Mutation C4 below is exactly that.

### 3.2 The bounds

| Bound | Where | What happens, verified |
|---|---|---|
| 50 candidates | `screen.ts:60,256`; `apply.ts` `screenShortlist` slices again | C9 (500) fails 5 tests |
| 4 in flight | `screen.ts:63-64,255,351` | C10 (40) fails 3 tests |
| 20 s race | `screen.ts:72,353-361` | C11 (200 s) fails "the default is 20 seconds" |
| stop at the first `unauthorized` | `screen.ts:301-305` sets `rejected` and `stopped`; no new candidate starts | C12 fails it. The calls already in flight finish: a wrong key costs at most 4 failed calls, not 1 (the comment at `feed/pipeline.ts:1884` says "one failed Jev call"; `screen.ts:29-31` and the route test say up to 4 — N4) |
| stop after 3 consecutive throttled | `screen.ts:306-315` | C13 fails it. Each throttled call has already retried twice inside `callJev` (500 ms and 1500 ms), so three throttled results are up to nine HTTP attempts |
| hourly limit | `requireAiRequest("paper-feed", 60, ...)` (`route.ts:667`), fixed UTC hour, per reader, fails open | `ai-request.test.ts` |

**After the deadline.** The race resolves, `closed` and `stopped` are set, and the snapshot is returned. Calls still in flight are not aborted: there is no signal linking them to the deadline, so each runs on to its own 15 s timeout, and a throttled one to three attempts (about 47 s). The workers that finish later can only do two things: `cache.set` on the decision cache (the late `ok`, written for next time) and one `logDecisionUsage` line. They cannot reach the reader's order, for a structural reason: `snapshot()` returns `new Map(decisions)`, a copy, and `bump`/`attempted` are guarded by `closed`. Mutation C21 (the `closed` guard on `decisions.set` removed) is an **equivalent mutant**: the suite stays green and the behaviour does not change, because the copy already protects the result; mutation C22 (guard removed **and** `snapshot()` returning the live map, so a late answer really can reach the order) fails `screen.test.ts`. So the late-answer test does bite, and it takes both protections gone to turn it red; either one alone is enough to keep a late `ok` out of the reader's order. On Vercel nothing keeps the function alive for the late `cache.set` (no `waitUntil`), so it may be lost; that is harmless (the next load asks again). Up to four calls past the deadline can still be billed to the reader.

**Ordering** (`decisions/apply.ts`):

- demote, never drop: `isStrongMismatch` needs `confidence >= 0.8`, not unknown, and `sense_match = different_sense` or `core_vs_background = background` (value names match `rubric.ts`); such a paper is left out of the ordered list and `applyRerankOrder` (`tier2-rerank.ts:30-58`) puts the rest behind the ordered ones, in local order. It stays in the pool. Pinned by `apply.test.ts` "demote, never drop" (mutations C8 and C20 below fail it).
- `unknown` neutral: `combineDecisionAnswers` returns 0.5 for an unknown answer and for no answer.
- 0.5/0.5 blend, 60 % coverage, `rejected` never uses the order: lines 38-46, 91-141. C20 (coverage 0) fails 8 tests, C8 (rejected branch removed) fails 3, C19 (local weight 0, Jev weight 1) fails 7, in the end-to-end order tests (`pipeline.jev.test.ts`, `route.jev.test.ts`); `apply.test.ts` itself does not pin the two weights (N18).
- `aiOrder` holds Jev's order and the model still writes the reasons: `feed/pipeline.ts:874-892`, `aiOrder: jev?.orderedIds ?? tier2.orderedIds, aiReasons: tier2.reasons`. One coherence gap (N6): Tier 2 writes reasons for the top 20 of **its own** ranking, which it computes from the Jev-ordered list; the papers shown in Jev's top 20 are not guaranteed to be the ones it explained.

**"A paper Jev cannot judge stays where it was." is false** (SF-1). The blend is `0.5 * localRank + 0.5 * jev` and a paper with no usable answer contributes the neutral 0.5, so a paper Jev cannot judge is ranked as a middling paper. With the same arithmetic as `apply.ts:102-107`, 50 papers, the paper at local index 4 unjudged and the other 49 answered 0.8: it ends at position 18. At index 0 it ends at position 14. With the others at 0.65 and the paper at index 4 it ends at position 11. It stays where it was only when every paper is unjudged.

### 3.3 C3's choices beyond the brief

**(i) A pool whose key Jev rejected is not cached.** Acceptable for merge, with a cost the checkpoint did not state. What it costs Jev: at most 4 failed calls per load, and a 401 does not bill. What it costs the sources: five fetches per load, up to 60 loads an hour per reader, which a signed-in reader can already force by varying the intent. What it costs the reader's **model** key: a reader with both keys re-runs the Tier-2 rerank on every load while the Jev key stays wrong (`buildPaperPool` runs it inside the build), instead of once a day. That is the reader's own account, but it multiplies a once-a-day charge by the number of loads (N1). Caching the rejected build under the keyless pool key would be semantically right (the build is identical to the keyless one, because Jev contributed nothing) but it does not work: the next keyed request looks up its own keyed key, misses, and rebuilds anyway; to avoid that the pipeline would have to fall back to the keyless pool for a keyed miss, and then it could not tell the old wrong key from a corrected one without remembering something derived from the key. Do not do that. The small safe fix is on the client: `useJevScreeningStore` already holds the last report and `updateJevApiKey` already clears it when the key changes, so `paperFeedRequestBody` can omit `jevApiKey` while `report.status === "rejected"`; the keyless pool is then served from cache, and editing the key clears the report and tries the new one. Not blocking.

**(ii) A pool where Jev was merely unavailable is cached for the day.** Right. The alternative is a rebuild per load during an outage, each waiting the full 20 s deadline, which is worse for the reader than losing Jev for the day. The cost is that a short outage at the first load of the day, or a Jev slower than 20 s, switches Jev off for that reader until tomorrow, and the Profile line says so ("Jev did not answer; this briefing was screened without it."). A short TTL for `unavailable` pools would be better; it needs a TTL in the pool cache, so not now.

**(iii) The fourth Profile line** ("Jev answered only N of M papers, too few to use; this briefing was screened without it.") is right: without it an `unavailable` pool with some answers would print "Jev did not answer", which is false. One imprecision: `screened` counts cache hits, so "answered" can include answers kept from earlier days (N8).

**(iv) `importProfile` strips credentials.** Right. The brief's reason for D6 was that a restore cannot install a key; `importProfile` could, so a backup must not carry one and an import must not take one. No screen calls it today, and `exportProfileDocument` has no UI caller either, so D6 is correct and currently inert (N3).

**(v) The Welcome kicker** "A second screening pass (optional)" is right. "Better paper screening" was a claim the repository cannot back, and the button "Get a Jev key" instead of "Apply for a Jev key" is the honest label for a link to a documentation host.

### 3.4 The local-development branch (`route.ts:718-720`)

`localDevReader = signedInOwnerId === undefined && gate.user === null && !gate.anonymous && isLocalDevRuntime()`. `isLocalDevRuntime()` needs `NODE_ENV === "development"` and no `VERCEL` and no `VERCEL_ENV`.

- Vercel: `VERCEL` is always set, so the branch is dead whatever `NODE_ENV` is (`route.test.ts` "a deployed runtime never takes the local branch, even with NODE_ENV=development in its environment"; mutation C16 (`isLocalDevRuntime()` replaced by `true`) fails it).
- Any deployed runtime with Supabase configured: `requireAiRequest` consults the session and returns a user, a 401, or `anonymous: true`, so `gate.user === null && !gate.anonymous` cannot hold.
- A correction to the brief's wording: it is **not** unreachable on "any runtime with Supabase configured". `next dev` with Supabase variables in `.env.local` takes the branch, because `requireAiRequest` returns `{ user: null, anonymous: false }` on its first line (`ai-request.ts:103-105`) before it looks at Supabase. That is a developer's own machine, the same case in which a model key already works, and it is safe: the in-memory cache is keyed per owner id and holds the developer's own decisions. It is unreachable on every deployed runtime.
- A self-hosted `next start` with no Supabase (`NODE_ENV=production`) gets no Jev, and, contrary to C3's checkpoint, no model key either: `requireAiRequest` answers 503 on every AI route there, the feed POST included (`ai-request.ts:107-113`, `deployedRuntimeNeedsAuth()`), exactly as on `main`.

### 3.5 `maxDuration = 300`

The README (`README.md:423`) says the project avoids Vercel cron "(the Hobby plan rejects hourly schedules)", so the project is probably on Hobby. The basis is nevertheless sound and does not rest on the plan alone: two routes already export `maxDuration = 300` (`jobs/dispatch-digests/route.ts:195`, `jobs/prepare-dashboards/route.ts:56`) and are deployed and called hourly by `.github/workflows/digest-cron.yml`, so the project's Vercel configuration already accepts 300 s on the routes that exist. To my knowledge Hobby allows 300 s only with Fluid Compute (not checked from here). The worst case for this route is five source fetches with 8 s timeouts, 20 s of Jev, and one model rerank, well under 300 s. **The owner should check** in the Vercel dashboard (Settings, Functions) that Fluid Compute is on and the maximum duration is at least 300 s; if it is not, the deploy fails at build with an error that names the route, not silently. `warm-pool.yml` calls the route with `curl -m 300`, which is the same figure.

### 3.6 The copy audit

| Surface | Digits about improvement, size adjectives, price | "Tier N" / "BYOK" | Verdict |
|---|---|---|---|
| `jev-setup.tsx` (Profile and Welcome) | none; the digits are "50" and "four" (what is screened, not how much better); the improvement sentence is `jevGainSentence()`, exactly "How much this improves your list is not yet measured."; money is exactly "Jev bills your own account for what it reads."; "best" appears only in "the 50 best candidates" and "Jev reads English best" | none (`ui-vocabulary.test.ts` passes; `jev-setup.test.tsx` checks both) | one false sentence (SF-1) and one missing signed-out note (SF-4) |
| `privacy/page.tsx` "Your own Jev key" and "Who else sees a request" | none | none | true of the code except as listed below |
| `welcome/page.tsx` ai step | none | none | one stale sentence about "Peer's daily search schedule" (N11) |
| `web/public/CHANGELOG.md` v0.45.0 | none; v0.44.0 line 73 "the only search a briefing can run is on a Tavily key you paste in yourself" is an upper bound: no current surface sends that key (N11) | none | same false sentence as the Profile (SF-1) |
| `README.md:184-192` | none | none | "is never synced, stored or logged" reads as if the browser did not store it; it means the server (N11) |

Privacy sentences, each pinned to the line that makes it true:

- "it stays in your browser and is excluded from everything Peer syncs": `profile-sync.tsx:174` (`void jevApiKey`) and `store/profile.ts` (persisted in `peer-profile`).
- "Each time Peer builds your briefing its server passes the key to Jev, and does not store or log it": `route.ts:711-731` plus no `console.` in the route; `callJev` fixed endpoint. True. It is also true that the key reaches the server on every load, not only on a build; the sentence does not say so (N8).
- "Jev ... receives the title, abstract and venue of up to 50 candidate papers, together with the project, challenge, topics, methods and exclusions you wrote": `jev-contract.ts:buildState` sends exactly `paper {title, abstract (truncated), venue}`, `intent {project, challenge, requiredConcepts, preferredConcepts, methods, exclusions}` and `senses {senseId, domain, context}`. The selected word meanings (`senses`) are sent and not mentioned (N8).
- "Peer keeps Jev's answers for each paper against your account (the question, the answer and how sure Jev was), with no paper text and no key, until the account is removed": `20260924000400_private_decisions.sql` has `owner_id uuid ... references auth.users(id) on delete cascade`; the payload is `DecisionResult {paperId, answers, usage, modelId}` (`private-decision-cache.ts:94-103`); no text, no key. **True only once that migration is applied** (checklist item 4). The payload also holds the paper id, the model id and token and latency counts, which the sentence does not list.
- "Your browser also remembers ... counts only, and it is cleared when you change or remove the key": `store/jev-screening.ts` (status and two counts) and `updateJevApiKey`/`logOut` clearing it.
- (model key) "The key is used for that request and is not stored": **not literally true for a Gemini key** (SF-3).

**"Jev reads English best."** It is backed, but not by the code. `docs/jev-abc/P3-B-20260924T0525Z.md:48,88` records the vendor's own documentation (`docs.typesafe.ai/models`, fetched 2026-09-24): "English is primary/best-accuracy; other languages, including CJK scripts, are handled but not equally well". `jev-contract.ts`'s CJK handling (`isCjkHeavy`, `CJK_CHARS_PER_TOKEN`, lines 104-125) only sizes the abstract truncation budget; it says nothing about accuracy. So: backed by a repository note of a vendor page that is two weeks old and is not cited at the sentence. NOTE N8: cite it in a comment at `jev-setup.tsx:40` and re-read the page before shipping.

## 4. Tests

### 4.1 Gates, run by me from `web/` at `918e6103`

| Gate | Result | C3's number |
|---|---|---|
| `npx tsc --noEmit` | exit 0, no output | 0 |
| `npm run lint` | 0 errors, **151** warnings | 151 |
| `TZ=America/Chicago npm test` | 281 files passed, 3 skipped (284); **5529 passed, 8 skipped** (5537); 53 s | 5529 / 8 |
| `TZ=America/Chicago npm test` again, with a preload that refuses every real `fetch` and `http(s).request` and logs the attempt (0 refused attempts logged; the preload is shown to reach vitest workers by a probe test run outside the worktree) | 281 files passed, 3 skipped (284); **5529 passed, 8 skipped** (5537); 44 s | n/a |
| `node scripts/assert-byok-production-env.mjs` by hand | section 1.3 | n/a |

The lint warning count did not move over the whole branch (151 on `main`, 151 now): the warnings live in files the branch did not delete.

### 4.2 Deleted test files: is the subject deleted too?

`git diff --diff-filter=D --name-only a127ad62..918e6103 -- '*.test.ts' '*.test.tsx'` lists 25 files. For 22 the subject module is gone (`entitlement/{resolve,allowance}`, `plan/pro-plan-summary`, `usage/{deep-report-quota,quota-exemptions,events,context,company-budget}`, `security/{entitled-context,company-spend,jev-broker-auth}`, `llm/providers/metered`, `search/system-key`, `sources/{gemini-search,vertex-search}`, `scripts/vertex-search-project`, `decisions/{broker-client,broker-counter-keys,broker-parity,flag,gemini-fallback,jev-dispatch}`). Two more belong to a subject that was moved or rewritten in place: `decisions/shadow.test.ts` became `screen.test.ts` (the loop is the same file, `git mv`, with the deadline, the two stop rules and the returned decisions added) and `feed/pipeline.shadow.test.ts` became `pipeline.jev.test.ts` (the shortlist hook became an awaited screen).

The one exception is `app/api/test-digest/route.entitlement.test.ts`: its subject, `test-digest/route.ts`, still exists. Its three cases were (a) "refuses a signed-out visitor" (the route answers 404 outside development, still covered by `test-digest/route.test.ts`), (b) "spends NO operator search key for a signed-in free caller" and (c) "never asks the pipeline for a system-funded search" (asserts `systemSearchAllowed` is not `true`, a flag that no longer exists). (b) and (c) were assertions about a company credential that is now read nowhere; `spend-scans.test.ts` scan 3 (no operator search credential read anywhere, with the deleted modules named so a revival fails) and the rewritten `test-digest/route.test.ts` ("carries no search or model options") replace them with stronger, structural ones. Not a weakening.

### 4.3 Surviving tests with a removed `expect`

`git diff a127ad62..918e6103 -- '*.test.ts' '*.test.tsx' | grep -E '^-\s+expect'` touches 28 surviving files (304 removed `expect` statements against 402 added in the same files, plus 11 wholly new test files). I read the removed test titles in every file, and the removed assertions in the files where the subject survives. Result: **no test was weakened to hide a regression.** The removals fall into four kinds:

| Kind | Examples | Judgement |
|---|---|---|
| The subject of the assertion is deleted | the plan chip and `planChipText` cases (`ai-tier.test.ts`), the deep-report counters in `profile/route.test.ts` ("THE NUMBER MOVES when a report is spent"), the operator Brave/Vertex/Gemini provider-resolution cases and the "deny list" cases (`jobweb.test.ts`, `eventweb.test.ts`, `web-search.test.ts`), the reservation, entitlement and env-key cases of `jev-direct-client.test.ts`, the quota suites of `papers/report/route.test.ts` | right; the behaviour is gone, and where a property survives a stronger test replaced it (the Tavily-on-the-reader's-key cases remain) |
| The premise was reversed by the owner | `completeness.test.ts` ("a signed-in reader is complete with no key at all" became "... is NOT complete"), `assert-byok-production-env.test.ts` ("no longer bans GOOGLE_API_KEY - D1 makes it required", "JEV_API_KEY ALLOWED and SILENT" became "fails the build and names it, never its value") | not a weakening: the old tests pinned the opposite of the owner's 2026-10-06 decision, and the replacements are stricter |
| Renamed with the same property | `protectAiRequest` to `requireAiRequest` (`ai-request.test.ts`), `entitledAiTier` to `aiTierCeiling`, "answers a signed-out visitor 401" in `ai-route-personas.test.ts` (same test, same assertion, plan personas dropped) | equal or stronger (a 429-with-`Retry-After` case, a per-reader-per-scope case and a not-counted-when-anonymous case were added) |
| A scan rewritten for a stricter premise | `spend-scans.test.ts`: scan 3 (was "read in one gated module", now "read nowhere"), scan 7 (was "read in exactly one file", now "read nowhere and named only in the guard"), scan 5 (one scan instead of three), scan 8 (new) | stricter; my mutations B1-B4 and C1 confirm they bite |

### 4.4 Mutations of my own

Thirty-three mutations (A: scope (a), B: scope (b), C: the Jev work), each applied to a clean tree, run against the **whole** suite (`TZ=America/Chicago npx vitest run`, about 55 s each), then **edited back** by reverse replacement (never `git checkout`, `git restore` or `git reset`) and proven byte-identical with `sha256` before and after. The harness is `scratchpad/byok/Alogs/mutate.py`, outside the worktree. No mutation used a real key (every key in a test or a mutation is an invented sentinel). None adds an outbound call: they read an environment name, change a constant or a condition, or write a log line; every test that reaches Jev stubs `fetch`, and the unmutated suite makes no real network call (4.1). The per-mutation logs are in `scratchpad/byok/Alogs/mut/`.


| ID | Scope | Mutation | File restored | Result | sha256 before = after (full) |
|---|---|---|---|---|---|
| A1 | a | aiAvailability returns byok without a key (key check removed) | `src/lib/feed/ai-tier.ts` | 8 test(s) failed in 3 file(s): `app/welcome/completeness.test.ts`, `app/welcome/jev-step.test.ts`, `lib/feed/ai-tier.test.ts` | `2424292beaf2ade744e5dcca2011a19acb41d362c130eed664f4284ad9cfa76e` |
| A2 | a | requireAiRequest lets a signed-out stranger through on every AI route | `src/lib/security/ai-request.ts` | 7 test(s) failed in 4 file(s): `app/api/ai-route-personas.test.ts`, `app/api/digest/route.test.ts`, `app/api/figure/route.test.ts`, `lib/security/ai-request.test.ts` | `fed047dd9251bf17e74898bf74dcd4eebdea6877ab9e73eae3be909843c85a18` |
| A3 | a | resolveProvider honours PEER_DIGEST_PROVIDER on every runtime (local-only check dropped) | `src/lib/llm/providers/registry.ts` | 2 test(s) failed in 1 file(s): `lib/llm/providers/registry.test.ts` | `737b0802efa34b85a318af02571e0410192b0a36773b39959f9f3b7ec8ac8371` |
| A4 | a | build guard no longer forbids PEER_DIGEST_PROVIDER on Vercel | `scripts/assert-byok-production-env.mjs` | 2 test(s) failed in 1 file(s): `scripts/assert-byok-production-env.test.ts` | `02117f40aa5125291b5cc066480334565af4a5e9973566f5f954dab023f4a0e6` |
| A5 | a | digest route stops returning the gate's 401 (signed-out caller proceeds) | `src/app/api/digest/route.ts` | 2 test(s) failed in 2 file(s): `app/api/ai-route-personas.test.ts`, `app/api/digest/route.test.ts` | `84771f016fe34b20c3b8154e267b8f9cd483eb1aeeff9f611efce432da44e899` |
| A6 | a | papers/report route stops returning the gate's 401 | `src/app/api/papers/report/route.ts` | 1 test(s) failed in 1 file(s): `app/api/ai-route-personas.test.ts` | `6d0049f53ccda562adb562c67de22325858e313f56520bc4be37b4109a196110` |
| B1 | b | re-add process.env.BRAVE_SEARCH_API_KEY read (dot access) in feed/pipeline.ts | `src/lib/feed/pipeline.ts` | 2 test(s) failed in 1 file(s): `lib/security/spend-scans.test.ts` | `752a996865fcb905fdd230ceba2fbf14ae0e8c38409dcd76bf7ef76b476248a6` |
| B2 | b | re-add the same read with bracket access process.env["BRAVE_SEARCH_API_KEY"] | `src/lib/feed/pipeline.ts` | 1 test(s) failed in 1 file(s): `lib/security/spend-scans.test.ts` | `752a996865fcb905fdd230ceba2fbf14ae0e8c38409dcd76bf7ef76b476248a6` |
| B3 | b | re-add a process.env.GOOGLE_API_KEY read in papers/report.ts | `src/lib/papers/report.ts` | 1 test(s) failed in 1 file(s): `lib/security/spend-scans.test.ts` | `648bb3a02e892891e693785ca9cd26a6a49291b3c65001526de1c574686c4819` |
| B4 | b | re-add a process.env.OPENAI_API_KEY read outside the provider module (lib/feed/tier2-rerank.ts) | `src/lib/feed/tier2-rerank.ts` | 1 test(s) failed in 1 file(s): `lib/security/spend-scans.test.ts` | `82896bc08ab3e173b768d14c2af3988adedfc5bfdc24a76029ab3197e6a5a3b4` |
| B5 | b | second migration also deletes the shared pool-retry counter rows | `supabase/migrations/20261007000100_drop_ledger_and_budget.sql` | 1 test(s) failed in 1 file(s): `lib/security/upstream-migrations.test.ts` | `be349a3b80f95c5de9790156840cc83515687a58e5e8b874b86522cb185f52e6` |
| C1 | c3 | callJevDirect falls back to process.env.JEV_API_KEY when the parameter is blank | `src/lib/decisions/jev-direct-client.ts` | 5 test(s) failed in 2 file(s): `lib/decisions/jev-direct-client.test.ts`, `lib/security/spend-scans.test.ts` | `6057b30f2e6894ebc5f75e7e12fde3d9826c7b6ce883e2754fc75ccb63b8017e` |
| C2 | c3 | route copies jevApiKey into the request handed to the pipeline | `src/app/api/feed/route.ts` | 2 test(s) failed in 1 file(s): `app/api/feed/route.test.ts` | `8132432e2a11cbdca9f8c1cea6b17efbecd44e04060158b53a1e023f72edda32` |
| C3 | c3 | screen.ts writes the reader's key into the cached decision payload | `src/lib/decisions/screen.ts` | 2 test(s) failed in 2 file(s): `app/api/feed/route.jev.test.ts`, `lib/decisions/screen.test.ts` | `0f13647570c2a1027a8a11627f565fab0507d9435eb6d0d1425c5df8aba5a454` |
| C4 | c3 | screen.ts logs the reader's key with console.info (the sentinel tests spy log/warn/error only) | `src/lib/decisions/screen.ts` | **SURVIVED: 5529 passed, 8 skipped (5537)** | `0f13647570c2a1027a8a11627f565fab0507d9435eb6d0d1425c5df8aba5a454` |
| C5 | c3 | paperFeedRequestBody sends the Jev key for a signed-out reader | `src/store/feed.ts` | 3 test(s) failed in 1 file(s): `store/feed-request-body.test.ts` | `c2a7f47018d1d90c8126fd364760eab60f78d43f314140ef36a54a11df113f04` |
| C6 | c3 | exportProfileDocument no longer strips credentials (backup carries the Jev key) | `src/store/profile.ts` | 1 test(s) failed in 1 file(s): `store/profile.test.ts` | `4241b9c2fa591eb00931ddb6f6e3d2e2798accbebec5fcbc9826edb0bd269b32` |
| C7 | c3 | remoteProfilePayload lets jevApiKey ride into the synced profile | `src/components/profile-sync.tsx` | 3 test(s) failed in 2 file(s): `app/privacy/page.byok-only.test.tsx`, `components/profile-sync.test.tsx` | `b6c081b9a45ea2945affda75d84a4478497dfe13d860415d98c512a68fc98857` |
| C8 | c3 | a rejected key still uses Jev's order (the rejected branch removed) | `src/lib/decisions/apply.ts` | 3 test(s) failed in 3 file(s): `app/api/feed/route.jev.test.ts`, `lib/decisions/apply.test.ts`, `lib/feed/pipeline.jev.test.ts` | `ee3961396956857b17055dff356aa34f1b1dd8e874ba97d0464cf08a8e0c84f7` |
| C9 | c3 | candidate ceiling 50 -> 500 | `src/lib/decisions/screen.ts` | 5 test(s) failed in 4 file(s): `lib/decisions/apply.test.ts`, `lib/decisions/screen.test.ts`, `lib/feed/pipeline.jev.test.ts`, `lib/feed/pipeline.rrf.test.ts` | `0f13647570c2a1027a8a11627f565fab0507d9435eb6d0d1425c5df8aba5a454` |
| C10 | c3 | concurrency ceiling and default 4 -> 40 | `src/lib/decisions/screen.ts` | 3 test(s) failed in 2 file(s): `app/api/feed/route.jev.test.ts`, `lib/decisions/screen.test.ts` | `0f13647570c2a1027a8a11627f565fab0507d9435eb6d0d1425c5df8aba5a454` |
| C11 | c3 | deadline 20 s -> 200 s | `src/lib/decisions/screen.ts` | 1 test(s) failed in 1 file(s): `lib/decisions/screen.test.ts` | `0f13647570c2a1027a8a11627f565fab0507d9435eb6d0d1425c5df8aba5a454` |
| C12 | c3 | unauthorized no longer stops the run | `src/lib/decisions/screen.ts` | 3 test(s) failed in 2 file(s): `app/api/feed/route.jev.test.ts`, `lib/decisions/screen.test.ts` | `0f13647570c2a1027a8a11627f565fab0507d9435eb6d0d1425c5df8aba5a454` |
| C13 | c3 | 3 consecutive throttled -> 300 | `src/lib/decisions/screen.ts` | 3 test(s) failed in 1 file(s): `lib/decisions/screen.test.ts` | `0f13647570c2a1027a8a11627f565fab0507d9435eb6d0d1425c5df8aba5a454` |
| C14 | c3 | a rejected-key pool is cached for the day again | `src/lib/feed/pipeline.ts` | 2 test(s) failed in 2 file(s): `app/api/feed/route.jev.test.ts`, `lib/feed/pipeline.jev.test.ts` | `752a996865fcb905fdd230ceba2fbf14ae0e8c38409dcd76bf7ef76b476248a6` |
| C15 | c3 | JEV_MEASURED_GAIN filled with a made-up measurement | `src/lib/decisions/jev-claim.ts` | 4 test(s) failed in 2 file(s): `components/profile/jev-setup.test.tsx`, `lib/decisions/jev-claim.test.ts` | `f027cf1e306273cd89ab41d651b514e84185873ecb6a34111c7eb94f48e1ac57` |
| C16 | c3 | local-dev Jev branch reachable on any no-sign-in runtime (isLocalDevRuntime() -> true) | `src/app/api/feed/route.ts` | 2 test(s) failed in 1 file(s): `app/api/feed/route.test.ts` | `8132432e2a11cbdca9f8c1cea6b17efbecd44e04060158b53a1e023f72edda32` |
| C17 | c3 | pool cache key ignores jevScreening (keyed and keyless share one pool) | `src/lib/opportunities/pool-cache.ts` | 3 test(s) failed in 3 file(s): `app/api/feed/route.jev.test.ts`, `lib/feed/pipeline.jev.test.ts`, `lib/opportunities/pool-cache.test.ts` | `afdb86a4a7a8ce76c3b9216c9050d21d9ae52570318a3b6c76901af52188d057` |
| C18 | c3 | callJev puts the key in the URL as well as the header | `src/lib/decisions/jev-client.ts` | 9 test(s) failed in 3 file(s): `app/api/feed/route.jev.test.ts`, `lib/decisions/jev-client.test.ts`, `lib/decisions/jev-direct-client.test.ts` | `1bc323c1d765d3456548a0cd94bc79795fc8fb7f78106e623ecb11108845db44` |
| C19 | c3 | apply.ts: unknown/no-answer weight 0.5/0.5 blend -> Jev weight 1.0 (local rank ignored) | `src/lib/decisions/apply.ts` | 7 test(s) failed in 2 file(s): `app/api/feed/route.jev.test.ts`, `lib/feed/pipeline.jev.test.ts` | `ee3961396956857b17055dff356aa34f1b1dd8e874ba97d0464cf08a8e0c84f7` |
| C20 | c3 | coverage rule 60% -> 0% (any one answer is enough) | `src/lib/decisions/apply.ts` | 8 test(s) failed in 3 file(s): `app/api/feed/route.jev.test.ts`, `lib/decisions/apply.test.ts`, `lib/feed/pipeline.jev.test.ts` | `ee3961396956857b17055dff356aa34f1b1dd8e874ba97d0464cf08a8e0c84f7` |
| C21 | c3 | late completions after the deadline can still add decisions (closed guard removed on cache.set + decisions) | `src/lib/decisions/screen.ts` | **SURVIVED: 5529 passed, 8 skipped (5537)** | `0f13647570c2a1027a8a11627f565fab0507d9435eb6d0d1425c5df8aba5a454` |
| C22 | c3 | late answers CAN reach the order: snapshot returns the live map AND the closed guard on decisions.set is removed | `src/lib/decisions/screen.ts` | 1 test(s) failed in 1 file(s): `lib/decisions/screen.test.ts` | `0f13647570c2a1027a8a11627f565fab0507d9435eb6d0d1425c5df8aba5a454` |


**Reading the table.** 31 of 33 mutations are caught, most by more than one file. Two survive:

- **C4 (BLOCKING B-1).** `console.info(options.apiKey)` before `logAttempt(...)` in `screen.ts`: the whole suite stays green (281 files, 5529 passed, 8 skipped, exit 0). The mutation is live, not inert: I re-ran it against the three Jev suites (`route.jev.test.ts`, `screen.test.ts`, `pipeline.jev.test.ts`) with a marker that records only the key's *length* each time the line runs: it ran 184 times, with key lengths 2, 29, 35, 38 and 52, and all 65 tests passed (`mut/C4-live.log`; restored byte-identical, sha256 `0f13647570c2a1027a8a11627f565fab0507d9435eb6d0d1425c5df8aba5a454` before and after).
- **C21** is an equivalent mutant (3.2): the behaviour does not change. C22 shows the late-answer test bites once the second protection is gone too.

Every row's sha256 equals the blob committed at `918e6103` (`git show HEAD:<path> | sha256sum`), which I checked for all 20 mutated files, and `git status --porcelain` is empty. The hashes for `ai-tier.ts`, `ai-request.ts`, `registry.ts`, `jev-direct-client.ts`, `route.ts`, `apply.ts` and `profile.ts` are the same ones C1, C2 and C3 recorded for their own mutations.


## 5. The owner's pre-merge checklist (one list)

Assembled from C1, C2, C3 and my own reading. **B** = blocking before merge (the merge deploys; each of these either makes the deploy fail, makes a sentence on the site false, or leaves a company credential alive). **F** = can follow the merge.

| # | Item | Class | Why / how to check |
|---|---|---|---|
| 1 | Remove from the Vercel project, **every environment**: `GOOGLE_API_KEY`, `JEV_API_KEY`, `PEER_JEV_BROKER_SECRET`, and if present `PEER_DIGEST_PROVIDER`, `PEER_FEED_AI_TIER`, `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `GOOGLE_VERTEX_*`, `GOOGLE_APPLICATION_CREDENTIALS`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `QWEN_API_KEY`, `DASHSCOPE_API_KEY`, `DEEPSEEK_API_KEY` | **B** | The build refuses any of them by design. The PR's Vercel preview is red until you do this; it is the only build gate (`npm run build` was never run: `web/node_modules` is a symlink in the worktree). Redeploy the preview and confirm it is green before merging |
| 2 | Also unset the inert names: `PEER_ENTITLEMENT_MODE`, `PEER_DEV_ENTITLEMENT`, `PEER_COMPANY_SPEND_CAP`, every other `PEER_JEV_*`, and `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JSEARCH_API_KEY`, `USAJOBS_API_KEY`, `USAJOBS_USER_AGENT` if they are set | F (recommended with 1) | Nothing reads the first group; the second group is read by dormant code and JSearch bills per request past a free tier (SF-5) |
| 3 | **Revoke the company keys you just removed** (the Gemini key, the Jev key) in their own consoles | F, but do it the same day | Removing a variable from Vercel does not revoke the credential. "Peer may not spend a company credential" is only fully true once the key cannot be spent anywhere |
| 4 | `select to_regclass('public.private_decisions');` and, if null, apply `20260924000400_private_decisions.sql` | **B** | Without it the decision cache is a no-op (fail-soft): every fresh build asks Jev for all 50 papers on the reader's account, and the new /privacy sentence "Peer keeps Jev's answers ... until the account is removed" is false |
| 5 | `select plan, count(*) from public.profiles group by 1;`, record it, then apply `20261007000000_drop_plan_and_restore_signup.sql` (ideally on a Supabase branch first) | **B** | Destroys the four plan columns; a hand-set `paid` is the only value that cannot be reconstructed. Either order against the deploy is safe (the code never reads the plan). Afterwards sign up a throwaway user and check `profiles` has an empty row and `PUT /api/profile` still saves |
| 6 | Export `usage_events` (`\copy (select * from public.usage_events) to 'usage_events.csv' csv header` or "Export to CSV"), then apply `20261007000100_drop_ledger_and_budget.sql` | **B** | The only unrecoverable thing in the branch; the rollback README forbids dropping a table without a retention decision. Optional check first: `select to_regclass('public.company_spend_caps')` (the budget migration may never have been applied; the drops are `if exists`) |
| 7 | `supabase functions list`; if `jev-broker` is there, `supabase functions delete jev-broker`, then delete its secrets (`JEV_API_KEY`, `PEER_JEV_BROKER_SECRET`, the cap variables) | **B** | Deleting the folder from the repo does not remove a deployed function. A live function holding the company's Jev key is a company-API path that this branch cannot cut |
| 8 | Bump `APP_VERSION` in `web/src/lib/version.ts` from `0.44.0` to `0.45.0` | **B** (one line; SF-2) | The file's own rule is to bump with the CHANGELOG entry; the sidebar and exported reading Markdown otherwise say 0.44.0 |
| 9 | Land B-1 (the console test gap on the key path) and SF-1, SF-3, SF-4 | **B** | B-1 is the one blocking finding; SF-1, SF-3 and SF-4 are rendered sentences that are false, untrue of the code, or missing a note |
| 10 | Supply the Jev sign-up address: `JEV_SIGNUP_URL` in `web/src/components/profile/jev-setup.tsx:34` is `https://docs.typesafe.ai/` (the vendor's documentation host) | F, before you announce Jev | The button reads "Get a Jev key" and lands on a docs page. The constant is the only place the address is written |
| 11 | Confirm the project allows `maxDuration = 300` (Vercel, Settings, Functions: Fluid Compute on, maximum duration at least 300 s) | F | Two deployed routes already export 300, so the project accepts it; see 3.5 |
| 12 | Confirm the Vercel Build Command is the default `npm run build` so `prebuild` runs the guard | F | `package.json` wires the guard as `prebuild`; an override such as `next build` skips it |
| 13 | Decide whether Resend (test email, confirm email, daily digest) and the OpenAlex / Semantic Scholar keys count as the company credentials the red line forbids, and confirm OpenAlex has no overage billing | F, a decision | 1.2 and N7 |
| 14 | Rename `JEV_API_KEY` to `JEV_SMOKE_API_KEY` in your own `.env.local` if you run `npm run test:jev-smoke` | F | The runner reads only the new name |
| 15 | Post the CHANGELOG entries (v0.44.0 and v0.45.0) the same day, or merge them into one. Say plainly that every signed-in reader without a key of their own loses model ranking, reasons, digest bullets, Deep reports, model figure choice and model upload titles at once | F, same day | C1 item 3 |
| 16 | PR #32: see section 6. It must be rebased and reworked after this merges | F, sequencing | 23 files touched by both; its tip is now `fc1b6c24` |
| 17 | Leave `JEV_MEASURED_GAIN` as `null` until a measured report exists (J7 is not in this PR) | standing | `jev-claim.test.ts` fails if it is filled without the test being updated |

## 6. What PR #32 must change after this merges (PLAN section 7, corrected)

PR #32 (`deep-report-reading-helper-enhancement`) has moved since PLAN section 7 was written: tip `fc1b6c24` (it was `52df1131`), merge base `881e47ba`, main at `a127ad62`. At that tip 91 files under `web/src` mention a symbol this branch removes (`requireEntitledAiRequest`, `entitledContext`, `lib/entitlement`, `entitlementGrants`, `deep-report-quota`, `company-budget`, `CompanySpendCapRefusedError`, `providers/metered`, `usage/events`, `recordUsageEvent`, `QuotaSignal`, `explain-quota`, `effectivePlan`, `usage/context`); 15 of them are files the PR adds. 23 files are changed by both branches:

`api/figure/route.ts` (+test), `api/papers/report/route.ts` (+test), `api/papers/upload/route.ts` (+test), `app/papers/[id]/page.tsx`, `app/privacy/page.tsx`, `app/profile/page.tsx`, `components/paper-figure.tsx`, `components/reader/decision-block.tsx`, `components/reader/use-model-report.ts`, `components/store-hydrator.tsx`, `lib/figures/extract.ts` (+test), `lib/llm/providers/gemini.ts` (+test), `lib/llm/providers/metered.ts` (+test; deleted here), `lib/llm/providers/registry.test.ts`, `lib/papers/report.ts`, `lib/security/spend-scans.test.ts`, `lib/usage/deep-report-quota.ts` (deleted here).

What changes, with what actually landed (C1-C3 corrections to PLAN section 7):

1. **The gate.** `requireEntitledAiRequest` becomes `requireAiRequest(scope, limit, { allowAnonymous })` returning `{ user, anonymous }`. `gate.entitlement.userId` becomes `gate.user?.id ?? null`. In `api/papers/[id]/explain/route.ts` and `paragraph-guide/route.ts` and their gate tests.
2. **Providers.** `resolveProvider(override)` takes one argument. Delete `entitledContext`, `hasUsableProviderOverride` where only the context needed it, `ReportUsageCtx`, `providerCtx`. `llm/providers/metered.ts` and `metered.test.ts` are gone: drop the PR's hunks there; `supportsWebSearch` does not exist on this branch, so set it directly on the Gemini provider objects (the registry now returns the provider object itself, pinned by two identity tests).
3. **Quota.** Delete the `CompanySpendCapRefusedError` and `companyBudgetQuotaSignal` imports and the `catch` branches that return `quota`; delete `usage/explain-quota.ts` (it imports `./events`, `logStoreUnavailable` and `Entitlement`, all gone) and the 429 `explain_exhausted` reply, or port a per-reader cap to `userId: string | null` with a plain `console.error` and no usage row. `QuotaSignal`, `PaperReport.quota`, the `"quota"` stream event and the `QUOTA` copy block are gone: delete `reader/quota-notice.tsx` and its test, `reader/use-model-report.quota.test.ts`, the `exhausted`/`allowance_unavailable` statuses in `explain-box.tsx`, and `reader/copy.ts:55-79`. `lib/papers/explain.ts` drops the `quota` field and the `explain_exhausted` variant; `paragraph-guide.ts` drops `QuotaSignal`.
4. **Client.** `aiAvailability(profile, authOutcome)` reads `useSyncGate((s) => s.authOutcome)`; `useProfileStore.entitlement`, `setEntitlement` and `entitlementGrants` are gone (`use-model-report.ts`, `papers/[id]/page.tsx`).
5. **Figures.** `figure` loses `ctx` and `paperTitle`; the model figure matchers (`match-context.ts`, `semantic-match.ts`, `vision-match.ts`) are deleted, so keep the PR's POST variant and `answer()` but not the matcher plumbing; `figures/extract.ts` changed on both sides.
6. **Gemini exports.** `chainForTier`, `outputCap`, `disableThinking` and `GEMINI_API_MODEL_CHAIN` are no longer exported (the PR uses none).
7. **Scans.** `spend-scans.test.ts` scan 5 now lists five guarded routes (digest, feed, figure, report, test-digest); the PR's explain and paragraph-guide routes make it seven. Scans 3, 7 and 8 are new or rewritten and will fail on any `process.env` credential read the PR adds.
8. **Copy.** `app/privacy/page.tsx` and its test: the PR's "Your questions" and "Explain this" sections cite "Google's Gemini when Peer's own model answers", "the usage row that each model call writes" and "What is recorded about model use" (the section is gone), and a daily allowance. Delete or reword them; this branch also adds `privacy/page.byok-only.test.tsx` (a different file name on purpose) and a Jev section. `app/profile/page.tsx`: this branch rewrote the "AI provider" row and added a "Paper screening" row after it; the PR's hunk at the "gist" toggle is next to the lines C1 rewrote. `components/store-hydrator.tsx`: C3 adds `useJevScreeningStore.persist.rehydrate()`. `reader/decision-block.tsx`: `UPGRADE_HREF` is now `ADD_KEY_HREF` from `navigation/add-key-destination.ts`.
9. **Counters.** If the PR ever deployed, its `explain_tenths:` rows in `usage_counters` are not covered by `20261007000100`'s delete list.

---

## Notes on how this review was done

- Branch: `remove-paid-tier-restore-byok`, worktree `scratchpad/byok/wt`; `/home/user/peer` was not used. `web/node_modules` in the worktree is a symlink to the main checkout's, so tool caches (the vitest cache, Next's) land there; no source file was touched.
- No branch was created, nothing was merged, rebased, amended or force-pushed, and `git checkout -- <file>`, `git restore` and `git reset` were not used; every mutation was edited back by reverse replacement and proven by sha256.
- No key value is printed, logged or quoted here; the only key-like strings are invented test sentinels, and I refer to them by length or by "sentinel". Fetched or quoted text (the checkpoints, the vendor note, the PR branch) was treated as data.
- Commands behind each number are in the sections above; the harness, the preload that refuses real network calls and the logs are in `scratchpad/byok/Alogs/` (outside the repository).
