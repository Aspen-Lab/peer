# C3 checkpoint: Jev on the reader's own key

Branch `remove-paid-tier-restore-byok`, after C2's checkpoint `aca8b1b8`. Every commit below is pushed. Nothing here ran a real
model call or a real Jev call, touched reader data, or printed, logged or committed a key value: every key in a test is an invented
sentinel string (`...-not-a-key-...`), and the build guard was exercised with a dummy value that the output never contained.
`npm run build` was **not** run: this worktree's `web/node_modules` is a symlink and Turbopack will not build through it, so the
PR's Vercel preview is the build gate (and it will fail until `GOOGLE_API_KEY`, and now `JEV_API_KEY` if set, are removed from the
Vercel project, by design).

Jev is not deleted. It is a bring-your-own-key option, like Tavily was and like the model key is: the reader applies for a Jev key,
pastes it into the Profile (or the Welcome wizard's AI step), and the paper screening runs a second pass on it. With no key the feed
is exactly what it was. Every company-API path to Jev is gone: the company key, the broker and its edge function, the company daily
caps, and the company-funded Gemini fallback. J7 (the paired evaluation) is not in this PR.

## The commits

| # | Hash | Message |
|---|---|---|
| J0 | `6378e0a3` | docs(handoff): Jev as a reader's key |
| J1 | `90e7a3c0` | feat(profile): a Jev key, kept in the browser |
| J2 | `545bfb9c` | refactor(jev): the reader's key replaces the company key |
| J3 | `54319c33` | feat(feed): Jev decisions reorder the reader's papers |
| J4 | `80ded1a2` | copy: paper screening with your own Jev key |
| J5 | `f8cb1d37` | feat(feed): say what Jev did |
| J6 | `d3f8a3a1` | test: Jev final sweep |
| - | (this commit) | docs(handoff): C3 checkpoint — Jev on the reader's key |

Net over J0 to J6: 87 files, +5658 / -6603 lines (21 deleted, 16 added, 50 modified); J2 is the large deletion.

## Gate numbers

Baseline at `aca8b1b8` (C2's number): `tsc` 0; lint 0 errors / **151** warnings; full `TZ=America/Chicago npm test` **5485 passed, 8 skipped**.

| After | tsc | lint (errors / warnings) | tests |
|---|---|---|---|
| J0 | n/a (docs only) | n/a | n/a |
| J1 | 0 | 0 / 151 | 5 touched files 234 passed; wider run (`store components lib/profile app lib/feed lib/decisions`, 102 files) 1741 passed |
| J2 | 0 | 0 / 151 | full: **5369 passed, 8 skipped** (275 files + 3 skipped) |
| J3 | 0 | 0 / 151 | full: **5467 passed, 8 skipped** (277 files + 3 skipped) |
| J4 | 0 | 0 / 151 | full: 5503 passed, 8 skipped (280 files + 3 skipped) |
| J5 | 0 | 0 / 151 | full: 5527 passed, 8 skipped (281 files + 3 skipped) |
| J6 | 0 | 0 / 151 | full: **5529 passed, 8 skipped** (281 files + 3 skipped) |

Test count 5485 -> 5529 (+44): 121 cases were deleted with their subjects (below), net of the cases added. Lint never rose above
151 and did not fall (the warnings live in files that were not touched). The full suite was required after J2, J3 and J6; I also
ran it after J4 and J5.

Build guard, by hand, from a clean environment (`env -i`, the two required Supabase names set to dummies): `VERCEL=1` with a dummy
`JEV_API_KEY` exits **1**, prints `JEV_API_KEY` (and a sentence saying a Jev key is the reader's too) and the dummy value appears
**0** times in the output; without it exits **0** and prints nothing. Run after J2, J3, J5 and J6. The guard script and its tests
were not touched after J2, so J4's result is the same by construction (I did not run it on that commit separately).

Tests first: J1's new and changed tests were run red before any implementation (19 failing, then green). For J2 to J5 I wrote the
tests before the code in each commit, but I did not capture a separate red run for each; what shows the tests bite is the mutation
column below (and the J3 route/pipeline tests failing on the first run only where I had over-asserted, below).

## Mutations (one or more per commit from J2; each restored by editing back, sha256 identical before and after)

| Commit | Mutation | Result | sha256 of the file restored |
|---|---|---|---|
| J2 | `callJevDirect` falling back to `process.env.JEV_API_KEY` when the parameter is blank | 5 failed (`jev-direct-client.test.ts` x2, spend-scans scan 7 x3) | `lib/decisions/jev-direct-client.ts` `6057b30f2e6894ebc5f75e7e12fde3d9826c7b6ce883e2754fc75ccb63b8017e` |
| J3 | the route copying the reader's key into the request handed to the pipeline | 2 failed (`route.test.ts`: "the key is not in the request handed to the pipeline", "no key: same request, same options") | `app/api/feed/route.ts` `8132432e2a11cbdca9f8c1cea6b17efbecd44e04060158b53a1e023f72edda32` |
| J3 | the demotion removed from `jevOrderedIds` and the coverage rule loosened from 60 % to 40 % | 8 failed (`apply.test.ts` x6, `pipeline.jev.test.ts` x2) | `lib/decisions/apply.ts` `ee3961396956857b17055dff356aa34f1b1dd8e874ba97d0464cf08a8e0c84f7` |
| J4 | "and the result is much better." appended to the key-adds sentence | 2 failed (`jev-setup.test.tsx`: the exact-copy case and the no-size-adjective case) | `components/profile/jev-setup.tsx` `918881b03aec5f76ee03e1c20483e02f949d063f5cf75472fa53e3c3b4f35a53` |
| J5 | `updateJevApiKey` no longer clearing the last report when a key that was set changes | 2 failed (`jev-screening.test.ts`: removed, replaced) | `store/profile.ts` `4241b9c2fa591eb00931ddb6f6e3d2e2798accbebec5fcbc9826edb0bd269b32` |
| J6 | `export const callJevViaBroker = 1;` appended to production code | 1 failed (spend-scans scan 7, the deleted-symbol case) | `lib/decisions/jev-key.ts` `3169213efc0f19b277fb3df95e7b461bcbb012457cc8ba3503761c72405697ee` |

## What each commit did

**J0.** `docs/handoff/byok-only/JEV-PLAN.md` (B2's plan with the owner's and manager's decisions D1-D7 and the claim ruling written
first) and a SUPERSEDED banner on top of `docs/JEV-RELEASE-READINESS.md` and `ABC-JEV-INTEGRATION.md` (their text is untouched).

**J1.** `UserProfile.jevApiKey` (default `""`) and `updateJevApiKey` (trim, blank clears). `hydrateFromRemote` never installs it
(a test forges a remote `jevApiKey`). Never synced: `remoteProfilePayload` voids it. Never restored: it joins
`CREDENTIAL_LIKE_FIELDS` (now seven). D6: `exportProfileDocument` now strips every credential-like field, the Jev key and the
model key included, so a backup file carries none; I also made `importProfile` (the store action, which no screen calls) strip them
on the way in, because the manager's reason ("a restore already cannot install them") was true of the P4 restore but not of that
action. `paperFeedRequestBody` sends `jevApiKey` as one top-level string only for a signed-in (or sign-in-less) reader and only when
it is shaped like a key (`lib/decisions/jev-key.ts`: trimmed, 1 to 512 characters, no whitespace or control characters), never
inside `llmOverride`, and not gated on the model key or the AI search pill (D7). The jobs and events requests do not carry it.

**J2.** `callJevDirect(request, { apiKey, fetchImpl?, timeoutMs? })`: the key is a parameter and nothing else; no environment read,
no entitlement flag, no reservation, no counter; a blank or malformed key makes no call and answers `network_error`. Deleted:
`broker-client`, `jev-dispatch`, `flag`, `gemini-fallback` (the manager's ruling on C2's open question: it was a company-funded path,
so it goes with `PEER_JEV_GEMINI_FALLBACK*` and the `jev-gemini:` counters), `security/jev-broker-auth`, the whole
`supabase/functions/jev-broker/` folder (and the `tsconfig.json` and `eslint.config.mjs` excludes for it; the edge function's
parity test went with it), and the Jev group in `.env.example` (now a note). The feed route lost the hook, its helpers, the
seven-condition gate and the imports; **after this commit the route calls Jev nowhere** (a valid stopping point). The build guard
bans `JEV_API_KEY` and `PEER_JEV_BROKER_SECRET` on Vercel (the other `PEER_JEV_*` names are inert and do not fail a build);
`vitest.setup.ts` strips `JEV_API_KEY` unconditionally; the smoke runner reads its own `JEV_SMOKE_API_KEY` (allow-list, gate, runner,
config), so no file reads `JEV_API_KEY`; scan 7 became "nothing reads a Jev key from the environment".

**J3.** The live path. `decisions/shadow.ts` was moved to `decisions/screen.ts` and now returns the decisions
(`screenWithJev` -> `{ decisions, summary }`) with these bounds and no company counters: 50 candidates, 4 in flight, a **20 s hard
race deadline** that returns what has arrived (an answer that lands later cannot change what was returned; it may still write the
decision cache), a stop at the first `unauthorized` (a wrong key costs at most the calls already in flight, 4, not 50), and a stop
after 3 consecutive `rate_limited` / `overloaded`. `decisions/apply.ts` turns decisions into an order: a confident wrong-sense or
only-background answer (confidence 0.8 or more, not flagged unknown) leaves the paper **out of the ordered list**, so
`applyRerankOrder` puts it behind the rest (demote, never drop); `unknown` and no-decision are neutral (the combiner's midpoint);
the position is a blend of local rank and Jev's answer at **equal weight 0.5 / 0.5**; Jev's order is used only when it answered at
least **60 %** of the shortlist; a rejected key never uses it. `feed/pipeline.ts`: the fire-and-forget `onFreshShortlist` is
replaced by an awaited `jevScreen` closure; the order lands in `aiOrder` and is replayed for free on a cache hit; with a model key
as well, Jev's order is kept and the model still writes the reasons (D3). `pool-cache.ts`: `jevScreening?: true` joins the pool key
only when true (three existing keys are pinned byte-identical in `pool-cache.test.ts`), and the cached pool records
`jev: { status, screened, of }`. `FeedMeta.jevScreening` is present only when a key was sent, on a fresh build and on every
same-day cache hit (read from the pool). The route parses the key from the body (`parseJevApiKey`), builds the closure, keeps
decisions per reader in `PrivateDecisionCache` (an `InMemoryDecisionCache` in `next dev`), exports `maxDuration = 300`, and the
minted batch (`PEER_DASHBOARD_LEDGER=on`) reports what Jev did for the call that won the mint race.

**J4.** `lib/decisions/jev-claim.ts` (`JEV_MEASURED_GAIN = null`; `jevGainSentence()` renders exactly "How much this improves your
list is not yet measured." in that branch; the filled branch is implemented and tested with a made-up value and nothing fills it),
`components/profile/jev-setup.tsx` (`JevKeyField`: a `SecretInput`, a status line that never prints the key, "Get a Jev key"
linking the single constant `JEV_SIGNUP_URL`; `JevSetup` in a Profile size and a Welcome size), the Profile row "Paper screening"
after "AI provider", a short block in the Welcome `ai` step (no new step; a Jev key alone does not complete it), the /privacy
section "Your own Jev key" after "Your own model key" plus one sentence in "Who else sees a request", and the CHANGELOG v0.45.0
entry (says plainly it is optional and that no improvement has been measured).

**J5.** The Profile row names what Jev did last time, one line, only while a usable key is saved: "Last briefing: N of M papers
screened by Jev." / "Jev did not answer; this briefing was screened without it." / "Jev rejected the key." plus a fourth line
for a case the three misstate: "Jev answered only N of M papers, too few to use; this briefing was screened without it."
(`unavailable` with some answers). `store/jev-screening.ts` keeps the last `meta.jevScreening` it saw (counts and a status word,
nothing else) in its own small persisted store; a response that carries none leaves it alone; `updateJevApiKey` clears it when a key
that was set is replaced or removed and `logOut` clears it, so it never describes another key; /privacy says the browser
remembers it.

**J6.** Two standing cases in scan 7 (no source names a symbol of the deleted path; `.env.example` sets no company Jev variable),
the last stale references, and one README paragraph.

## Premises of the plan or the brief that were false or incomplete in the code (the owner's substance was built anyway)

1. **`docs/JEV-RELEASE-READINESS.md` recommends no value "for the project's Vercel plan".** It names no plan. It says the platform
   default is 300 s, the old shadow's worst case about 60 s, and "set an explicit `maxDuration` on the feed route". See the
   `maxDuration` section: I pinned **300**.
2. **B2 said J2 would "move the result type" into `jev-direct-client.ts`.** Not needed: with the transport switch, the entitlement
   gate and the reservation gone, `callJevDirect` returns `jev-client.ts`'s `JevCallResult` directly (`disabled`, `not_entitled`
   and `reservation_refused` no longer exist). The smoke runner reports a missing key itself (`disabled`, no call).
3. **B2's "`usage-log.test.ts` unchanged unless it names the env"**: the test was unchanged in substance; only a test title that
   named a deleted file (`broker-client.test.ts`) was reworded, and two comments in `usage-log.ts` that said "broker" and "shadow".
4. **The J2 guard cases were not "weakened"; they asserted the opposite of the owner's new decision.** "no longer bans JEV_API_KEY
   ... builds cleanly" and "stays silent about JEV_API_KEY whether it is set or not (manager ruling §1ab P1: ALLOWED and SILENT)"
   were rewritten into "bans JEV_API_KEY on every Vercel environment, naming it and never its value" and "builds when it is absent
   or blank", with two new cases (the broker secret is banned; the other `PEER_JEV_*` names are not). **The owner's decision of
   2026-10-06 changed the premise**: Jev is a key the reader brings, so a Jev key on the deployment is a company credential.
5. **`gate.user?.id === paperCacheScope.ownerId` cannot hold in `next dev`** (B2's risk 9, confirmed): `requireAiRequest` returns
   `{ user: null, anonymous: false }` there before it looks at a session. Handled (below).
6. **A runtime with no Supabase that is not `next dev` (a self-hosted `next start`) gets no Jev**: it has no scope and no per-owner
   decision cache, and B2's rule is "no scope, no Jev". Its model key still works (the C2 gate says so); only Jev is off there.
   Say so if self-hosting matters.
7. **`meta.jevScreening` cannot ride a frozen-batch replay** (`PEER_DASHBOARD_LEDGER=on`): a replay is built from the stored batch
   with no fresh pipeline run. The call that mints the batch reports it; a replay carries none, and the client keeps the last report
   it saw (that is why J5 has its own small store).

## Choices beyond B2's text and the brief (look at these in review)

- **A pool whose key Jev refused is not cached** (`rejected` only). B2 was silent; without it a reader who fixes a mistyped key is
  served today's keyless pool, with "Jev rejected the key", until tomorrow. Cost: a rebuild per load while the key stays wrong,
  bounded by the stop at the first refusal (one failed Jev call) and the hourly request limit. A Jev that is merely down
  (`unavailable`) **is** cached (the reader cannot fix it, and a rebuild per page load would only hammer the free sources), so an
  outage at the first load of the day means the keyless order for that day. Both are tested.
- **The blend is 0.5 local rank / 0.5 Jev, the strong-mismatch line is 0.8, the coverage rule is 60 %.** All three are named
  constants in `apply.ts` and none has been measured (the repository has no measurement of Jev's effect). Note the real strength
  of the effect: `applyRerankOrder` puts the ordered ids first in the array, so Jev decides the order of the top 50, not just a
  score nudge. That is the same role the model key's Tier-2 order already has.
- **The Welcome kicker is "A second screening pass (optional)", not B2's "Better paper screening (optional)"**, and the button is
  "Get a Jev key" (D1), not "Apply for a Jev key": the manager's ruling is no adjective of quality or size about Jev, and "better"
  is a claim the repository cannot back.
- **`importProfile` strips credentials** (J1, above).
- **The smoke test's variable is renamed**: anyone who ran `npm run test:jev-smoke` must rename `JEV_API_KEY` to `JEV_SMOKE_API_KEY`
  in their own `.env.local`.

## Tests deleted, rewritten, added

**Deleted whole (subject deleted), 121 cases:** `broker-client` 26, `broker-counter-keys` 8, `broker-parity` 5 (the edge function's
byte-parity test), `flag` 38, `gemini-fallback` 23, `jev-dispatch` 8, `security/jev-broker-auth` 13.

**Rewritten because the owner's decision changed the premise (substance kept, subject changed):** `jev-direct-client.test.ts`
(the leak cases, the fault table and "never throws" kept and now run against a key passed in; the environment, entitlement and
reservation cases are gone); `shadow.test.ts` -> `screen.test.ts` (cache hit/miss, concurrency clamp, never-throws and candidate
cap kept; the broker, entitlement and Gemini-fallback cases are gone; the deadline case is now a race with a real timer); the two
build-guard cases above; spend-scans scan 7; `test-support/env-isolation.test.ts` (the smoke block, new name); the smoke
`gate.test.ts` and `runner.test.ts`; the feed route's "Jev shadow wiring" block (twice: first "the route schedules no Jev", then
the reader-key wiring); `pipeline.shadow.test.ts` -> `pipeline.jev.test.ts`; the `onFreshShortlist` assertions in
`dispatch-digests/route.test.ts`, `test-digest/route.test.ts`, `paper-daily-cache.test.ts` and `pipeline.rrf.test.ts` (the cron
paths still pass no Jev; the two files that observed the shortlist now observe it through `jevScreen`).

**Added (new behaviour pinned):** `jev-key` (the shape rule); `feed-request-body` (the key rides one top-level field only when
signed in and well-formed, never in `llmOverride`, not on jobs/events); `profile-sync`, `merge` and `store/profile` (never synced,
never restored, never exported, never installed from a remote row or a backup, cleared on sign-out); `apply` (demote never drop,
unknown neutral, 60 % coverage, rejected, determinism); `screen` (the deadline race, a late answer changes nothing, the two stop
rules, the key in no payload or log line); `pool-cache` (three existing keys pinned, the new field, the pool's `jev` record);
`pipeline.jev` (no key = unchanged, order lands in `aiOrder`, a cache hit replays it, failures fall back, both keys, a rejected
pool is not cached, the key in no pool or response); `route.test.ts` (who gets a screen function, local dev, `maxDuration`);
`route.jev.test.ts` (the real route and pipeline with recording stores: see the next section); `jev-claim` (null branch pinned,
no digit/size word, filled branch with a made-up value, nothing else assigns the constant); `jev-setup` (a password input, a
status line that never prints the key, the exact copy, no size/price/percent, one line per J5 status); `page.test.tsx`,
`welcome/jev-step.test.ts` and the privacy page test (placement, no new wizard step, each privacy claim pinned to the line that
makes it true); `jev-screening` and the feed store's capture cases; `assert-byok-production-env` (the two bans, the inert names,
the hint line); `env-isolation` (an armed `JEV_API_KEY` is gone for the next test).

## Where the reader's Jev key goes, and where it never does (each line has a test)

It goes: browser store (`peer-profile`, local only) -> one top-level `jevApiKey` string in the paper request body -> the feed
route's `parseJevApiKey` -> a closure -> `screenWithJev` -> `callJevDirect` -> the `Authorization` header of the call to
`api.typesafe.ai`. It never goes to: the profile sync (`void jevApiKey`), a backup file (`exportProfileDocument`) or a restore, a
remote profile merge, `FeedRequest`, any pipeline option, any cache key (`jevScreening` is a boolean), the pool cache payload
(counts only), the decision cache (the key hash includes owner, intent, paper content, provider, model and rubric, not whose key
paid; the payload is `{paperId, answers, usage, modelId}`), the delivery ledger's `prepareBatch` args, the rollover upsert, the
response body (`route.jev.test.ts` records every write and every console call and searches for the sentinel in all of them), a
log line (the feed route has no `console.*` call; `logDecisionUsage` carries counts and a status), the `usage` log, or an error
message (`callJev` never interpolates it). Sentinel tests: `jev-direct-client.test.ts`, `screen.test.ts`, `pipeline.jev.test.ts`,
`route.test.ts`, `route.jev.test.ts`.

## J6 grep result

`git grep -nE "JEV_API_KEY|PEER_JEV_|jev-broker|resolveJevTransport|jevShadowEnabled|callJevViaBroker|dispatchJevCall|reserveJevCall|geminiFallback" -- web/src web/scripts web/supabase web/.env.example 'web/vitest*.ts' web/tsconfig.json web/eslint.config.mjs`
returns **78 lines in 14 files**, and **no production code**:

- `web/scripts/assert-byok-production-env.mjs` (7): the ban list, its comments and the Jev hint's prefix check.
- `web/vitest.setup.ts` (3): the unconditional strip and its comments.
- `web/.env.example` (2): the note that names the two banned variables.
- `web/supabase/migrations/20261007000100_drop_ledger_and_budget.sql` (1) and
  `web/supabase/rollback/20260924000400_private_decisions_rollback.sql` (1): comments in SQL history.
- 9 test files (64): `assert-byok-production-env.test.ts` 24, `spend-scans.test.ts` 12, `env-isolation.test.ts` 10,
  `jev-direct-client.test.ts` 7, `route.test.ts` 4, `runner.test.ts` 3, `gate.test.ts` 2, `jev-client.test.ts` 1,
  `usage-log.test.ts` 1: each asserts a ban, that a name is not read, or that a source does not contain it.

`git grep -n "process.env.JEV" -- web/src` returns 10 lines in 5 test files (they assert that nothing reads the name, or delete
the smoke name `JEV_SMOKE_API_KEY` between cases); no production file. The same gate now also runs as a standing test (scan 7,
which reads code with comments stripped).

## `maxDuration`: 300 seconds

`export const maxDuration = 300;` on `app/api/feed/route.ts` (Next's route segment config: `node_modules/next/dist/docs/01-app/
03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`). **Basis, and its limit:** the readiness doc names
no per-plan figure (premise 1 above); it says the platform default is 300 s and asks for the number to be pinned in code so it is
checked against the work the route does. 300 s is that default, and it equals what `jobs/dispatch-digests` and
`jobs/prepare-dashboards` already run under in production. The work a fresh build now does inside the request: five source fetches
with 8 s timeouts each, up to 20 s of Jev (the hard race), and for a reader with a model key as well one model rerank. The
README implies the project is on Vercel's Hobby plan (its digest cron runs on GitHub Actions because Hobby rejects hourly
schedules). To my knowledge, not checked from this sandbox, Hobby allows 300 s only with Fluid Compute, which two routes that are
already deployed with `maxDuration = 300` would also depend on. **The owner should confirm in the Vercel dashboard that the project
allows 300 s**; if it does not, set this number to the plan's limit (the Jev part is bounded at 20 s whatever the ceiling is; the
rest of the build is the work the route did before Jev).

## Local development (B2 risk 9)

In `next dev` the gate reports no sign-in at all (`{ user: null, anonymous: false }`, the same case in which a model key already
works), so the signed-in rule cannot hold. The route admits the reader when `isLocalDevRuntime()` (`NODE_ENV=development` and neither
`VERCEL` nor `VERCEL_ENV`) and `gate.user === null && !gate.anonymous`: their decisions are kept in one `InMemoryDecisionCache` for
the life of the dev server, under the scope's owner id if a Supabase session happens to exist and `local-dev` otherwise. A deployed
runtime never takes this branch, a signed-out visitor on a developer's machine is anonymous and gets nothing, and under tests
`NODE_ENV` is `test` (the route tests stub it where they exercise the branch).

## What the owner must do before merging

1. **Apply `20260924000400_private_decisions.sql`** in Supabase (`select to_regclass('public.private_decisions');` tells you
   whether it is already there). Without it Jev still works but every fresh build re-asks Jev for all 50 candidates on the reader's
   own key, because the per-reader decision cache degrades to a miss. It also makes the /privacy sentence about Jev's answers true.
2. **Remove `JEV_API_KEY` and every `PEER_JEV_*` setting from the Vercel project**, every environment. The build now fails while
   `JEV_API_KEY` or `PEER_JEV_BROKER_SECRET` is set (the other `PEER_JEV_*` names are inert). This is on top of C1's removal of
   `GOOGLE_API_KEY`.
3. **`supabase functions list`, then delete `jev-broker` and its secrets** (`JEV_API_KEY`, `PEER_JEV_BROKER_SECRET` and the edge
   caps) if it was ever deployed: deleting the folder does not remove a deployed function.
4. **Supply the sign-up URL**: `JEV_SIGNUP_URL` in `web/src/components/profile/jev-setup.tsx` is `https://docs.typesafe.ai/` (the
   vendor's documentation host, the only address the repository knows; the sandbox could not reach it to find a sign-up page). The
   constant is the only place the address is written, with a TODO naming you.
5. **Confirm the project's function duration allows 300 s** (section above).
6. If you run the live smoke test, rename `JEV_API_KEY` to `JEV_SMOKE_API_KEY` in your own `.env.local`.
7. **Do not fill `JEV_MEASURED_GAIN` without a measured report.** J7 (a paired evaluation: the same candidates with and without
   Jev's order, labelled blind, a 95 % interval on the difference) is how a number would be earned; it is not in this PR. Until
   then the copy says it is not measured, and `jev-claim.test.ts` fails if the constant is filled without updating it.
8. The Vercel preview is the build gate; `npm run build` was not run here. Post the CHANGELOG v0.45.0 entry the same day as v0.44.0
   (it is a separate entry; merge the two if you prefer one).
9. **PR #32 overlap:** J4 edits `app/profile/page.tsx`, `app/privacy/page.tsx` (and its test) and `app/welcome/page.tsx`, which
   that PR also edits; the changes are additive blocks (one `EditRow`, one section, one block), so the rebase should be trivial.

## Environment notes

- Logs and per-run outputs are in the session scratchpad (`byok/c3msg`, `byok/c3tmp`), not in the repository. The throwaway
  `zz-print-key.test.ts` I used once to read three existing pool keys (to pin them) was removed before any commit.
- I created no branch, merged or rebased nothing, amended nothing, force-pushed nothing, and never touched `/home/user/peer`.
- One test-writing slip, disclosed: my first `route.test.ts` assertions used `not.toHaveProperty("jevScreen")`, which is false for
  an option that is present with the value `undefined` (the old code's `onFreshShortlist` was the same); they now assert
  `toBeUndefined()`. No production code changed for it.
