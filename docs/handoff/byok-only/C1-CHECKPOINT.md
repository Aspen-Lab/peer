# C1 checkpoint: scope (a) landed

Branch `remove-paid-tier-restore-byok`, off `origin/main` `a127ad62`. Every commit below is pushed. Nothing here ran a
real model call, touched reader data, or printed a key value (names and obvious dummy sentinels only). `npm run build`
was **not** run: this worktree's `web/node_modules` is a symlink and Turbopack will not build through it, so the PR's
Vercel preview is the build gate (and it will fail until `GOOGLE_API_KEY` is removed from the Vercel project, by design).

This is a relaunch: the previous C1 instance stopped after commit 0 with an untracked N1 migration. That file was read,
checked against plan sections 5.2 and 5.3, verified on a throwaway database, and committed unchanged.

## The commits

| # | Hash | Message |
|---|---|---|
| 0 | `792066ea` | docs(handoff): the BYOK-only plan and its decisions (previous instance) |
| N1 | `148eff46` | feat(supabase): drop the plan columns, restore the signup trigger |
| N2 | `a44d347a` | refactor(client): the browser asks "signed in?", not "which plan?" |
| N3 | `b43edffe` | refactor(usage): remove the deep-report allowance and the quota payload |
| N4 | `f5fb57df` | refactor(llm,security): provider resolution is the reader's key and nothing else |
| N5 | `8340df12` | refactor(entitlement): delete the plan layer |
| N6 | `02acd283` | chore(build): the guard bans the model key instead of expecting it |
| N7 | `0e2891af` | copy: BYOK-only wording |
| N8 | `f16b7bcc` | test: final sweep |
| - | (this commit) | docs(handoff): C1 checkpoint - scope (a) landed |

Net over the eight code commits: 99 files, +1840 / -6189 lines.

## Gate numbers

Baseline on `origin/main` `a127ad62`, measured in this worktree: `tsc` 0; lint 0 errors, **151** warnings; full
`TZ=America/Chicago npm test` **5806 passed, 11 skipped** (5817), 295 files passed + 3 skipped.

| After | tsc | lint (errors / warnings) | tests |
|---|---|---|---|
| N1 | 0 | 0 / 151 | `upstream-migrations` + `rollback-parity`: 23 passed (SQL-only commit, full suite not rerun) |
| N2 | 0 | 0 / 151 | full: 5797 passed, 11 skipped (5808), 295 files |
| N3 | 0 | 0 / 151 (it read 153 once, two unused `afterEach` imports I left in tests; fixed before the commit) | full: 5758 passed, 11 skipped (5769), 294 files |
| N4 | 0 | 0 / 151 | full: 5748 passed, 11 skipped (5759), 292 files |
| N5 | 0 | 0 / 151 | full: 5707 passed, 11 skipped (5718), 289 files |
| N6 | 0 | 0 / 151 | `src/scripts` + `src/test-support` + `src/lib/security`: 112 passed (8 files) |
| N7 | 0 | 0 / 151 | full: 5721 passed, 11 skipped (5732), 291 files |
| N8 | 0 | 0 / 151 | full: **5722 passed, 11 skipped** (5733), 291 files + 3 skipped |

Test count 5806 -> 5722 (-84): the deleted tests listed below, net of the added ones. Lint never rose above 151 at a
commit; it did not fall, because the warnings live in files that were not deleted.

Build guard, by hand, from a clean environment after N6 and again after N8 (`env -i`, the two Supabase names set to
dummies): `VERCEL=1` with no model key exits **0** and prints nothing; with a dummy `GOOGLE_API_KEY` it exits **1** and the
message names only `GOOGLE_API_KEY`, never its value.

## N8 grep gate

`git grep -nEi "effectivePlan|trial_ends_at|trialEndsAt|Peer Pro|PEER_ENTITLEMENT_MODE|PEER_DEV_ENTITLEMENT|resolveSystemProvider|entitledContext|lib/entitlement" -- web/src web/scripts web/.env.example`

**No production file matches.** The only hits are tests that assert the thing is gone:
`app/api/profile/route.test.ts` (a forged plan field is never written, a stored plan column never reaches the browser),
`lib/security/spend-scans.test.ts` (scan 8 names the deleted brand and system default so a revival fails),
`lib/feed/no-company-model-copy.test.ts` (the "Peer Pro" copy scan) and `lib/security/upstream-migrations.test.ts` (the
four plan column names the down migration drops). The build guard no longer carries `PEER_DEV_ENTITLEMENT`.

`git grep -n "GOOGLE_API_KEY" -- web/src`: no code reads it (`spend-scans` scan 8 asserts `process.env.GOOGLE_API_KEY` is
read nowhere in `src` or `scripts`). It appears in `llm/providers/gemini.ts` as two "GOOGLE_API_KEY not set" error strings
(thrown when a reader's key is empty), in one `registry.ts` comment, in `vitest.setup.ts` (outside `src`, still strips it),
in `test-support/env-isolation.test.ts`, in the guard test, and in tests that assert it is ignored or cleared
(`registry.test`, `ai-route-personas.test`, `figure/route.test`, `pool-refresh-gates.test`, `search/system-key.test`,
`route-harness.ts`). The plan's wording said "only vitest.setup, env-isolation, the guard test and error strings"; the
extras are the tests I added or kept to prove the key is ignored.

## Mutations (one or more per commit from N2; each restored by editing back, sha256 identical before and after)

| Commit | Mutation | Result | sha256 of the file(s) restored |
|---|---|---|---|
| N2 | `currentOwnerKey()` forced to `"anonymous"`; `aiAvailability` ignoring the sign-in | 12 failed (7 in `store/feed.test.ts`, 4 `ai-tier.test.ts`, 1 `completeness.test.ts`) | `store/feed.ts` `605a27aa77ed6a0c9420e6d9c9d8bb4f46179f4137e9a9e6b7c7faf27a1312f8`; `lib/feed/ai-tier.ts` `2424292beaf2ade744e5dcca2011a19acb41d362c130eed664f4284ad9cfa76e` |
| N3 | a deep request charging a `deep:` counter again | 2 failed (`papers/report/route.test.ts`) | `api/papers/report/route.ts` `9e4cbbcdb6263facae2503cd5857a4fec770624cc55bb1a5ef6647b2fd70f142` |
| N4 | `resolveProvider` reading `GOOGLE_API_KEY` as a default again; the anonymous cap removed from `aiTierCeiling` | 7 failed (registry x3, personas REAL-registry case x2, spend-scans scan 8, ai-request) | `llm/providers/registry.ts` `cebe8f375f5cf0f6e6cf10209d7e369f233fb30bbb85b75133a08096955cb8ac`; `security/ai-request.ts` `fed047dd9251bf17e74898bf74dcd4eebdea6877ab9e73eae3be909843c85a18` |
| N5 | a client-sent `plan` written into the profile row again | 2 failed (`profile/route.test.ts`) | `api/profile/route.ts` `995ef4fbc80958aeaba4f9652dcd4d997c8e817614dc9a7f8a7f77cdfbfec9de` |
| N6 | `GOOGLE_API_KEY` taken off the guard's forbidden list | 5 failed (`assert-byok-production-env.test.ts`) | `scripts/assert-byok-production-env.mjs` `eeb5767bf307a339dd1221a1eadf573ce3729528fe3c50db28e48e7cbe9728a7` |
| N7 | "Peer's AI (included)" back in `ai-setup.tsx`; "Peer's own model does the work" back on /privacy | 2 failed (one in each new copy test) | `components/profile/ai-setup.tsx` `e274b8a430acf8d8e2cb200f3e21c96ee922d1a93661e7994de0e4b1a272e27a`; `app/privacy/page.tsx` `d4cf020fb311459a6628d1e6a5a33c566de2ae257247b6b4baed55a4b2b2e95f` |
| N8 | a `grant` appended to the down migration | 1 failed (`upstream-migrations.test.ts`) | `migrations/20261007000000_drop_plan_and_restore_signup.sql` `4abc1ac39c345edd2420eb184d4f53395396fba88ead5714ed59ff0c7e2b3815` |

The N2 mutation protocol caught a real gap: after my first pass `currentOwnerKey()` had no caller (I had inlined it into
`resolveOwnerKeyForLoad`), so forcing it to "anonymous" reddened nothing. `resolveOwnerKeyForLoad` was routed through it
again before the commit, which is what makes the owner-namespace tests in `store/feed.test.ts` guard it.

Two scans were also shown to fire by planting a violation in a throwaway file and deleting it: the new
`spend-scans` scans (a second `resolveProvider` argument, a `process.env.GOOGLE_API_KEY` read) and the
`no-company-model-copy` scan.

## Tests deleted, rewritten, added

**Deleted whole (subject deleted):** `lib/usage/deep-report-quota.test.ts`, `lib/usage/quota-exemptions.test.ts` (N3);
`lib/security/entitled-context.test.ts`, `app/api/test-digest/route.entitlement.test.ts` (N4: an operator-search-key
sentinel check on a route that answers 404 outside development; its only live case, "refuses a signed-out visitor", is
covered by `test-digest/route.test.ts`); `lib/entitlement/resolve.test.ts`, `lib/entitlement/allowance.test.ts`,
`components/plan/pro-plan-summary.test.tsx` (N5). `lib/navigation/upgrade-destination.test.ts` was renamed and rewritten
as `add-key-destination.test.ts` (N2, same dead-literal scan).

**Not deleted although the plan said to:** the deep-report-quota test file also held the only live coverage of
`consumeForcedRebuild` (`usage/rebuild-breaker.ts`, which survives until C2). Those cases moved to a new
`lib/usage/rebuild-breaker.test.ts` (plus one new untrip-next-day case). C2 deletes it together with the module.

**Rewritten (substance kept, subject changed):** `lib/feed/ai-tier.test.ts` (two-value predicate; the chip and
plan-string cases are gone with `aiModeChip`/`planChipText`), `store/profile.test.ts` ("holds no plan"; the persisted-shape
pin is unchanged in meaning), `store/feed.test.ts` (owner-namespace cases sign in through the sync gate; otherwise
unchanged, and they pass unchanged in meaning, which is the gate for plan risk 3), `welcome/completeness.test.ts`,
`lib/papers/report-cache-key.test.ts` (two AI modes, not three), `api/papers/report/route.test.ts` (the 3-03 quota suite and
the SPEND-CAP quota suite become "a deep report is not metered by Peer" and "a failed model call degrades quietly"),
`api/profile/route.test.ts` (GET returns only `{ profile }`; plan cases kept), `lib/usage/counters.test.ts`,
`lib/llm/providers/registry.test.ts`, `lib/security/ai-request.test.ts`, `api/ai-route-personas.test.ts` (signed-out /
keyless / keyed), `lib/security/spend-scans.test.ts` (scans 4, 5, 6 became one scan plus scan 8; scans 3 and 7 untouched),
`api/digest|figure|papers/upload|test-digest|feed|feed/archive route tests` and `feed/ledger-flow.integration.test.ts`
(new gate API), `lib/figures/extract.test.ts`, `arxiv-html-source.test.ts`, `store/feed-request-body.test.ts`,
`scripts/assert-byok-production-env.test.ts` (the old "SHIPS without GOOGLE_API_KEY, and says so" and "no longer bans
GOOGLE_API_KEY" cases pinned the opposite behaviour and are replaced, not weakened), `lib/security/upstream-migrations.test.ts`.

**Added (new behaviour pinned):** signed-out reader with a key reads `"none"` (`ai-tier.test.ts`, `completeness.test.ts`);
`resolveProvider(null)` is null with a dummy `GOOGLE_API_KEY` in every runtime (`registry.test.ts`, plus an end-to-end
case through the real registry in `ai-route-personas.test.ts`); the build guard exits 1 on production, preview and
development Vercel builds when `GOOGLE_API_KEY` is set and prints its name, never its value; `no-company-model-copy.test.ts`;
`privacy/page.byok-only.test.tsx` (a different file name from the privacy test PR #32 adds, so the two cannot collide).

## Plan premises that were false or incomplete in the code (the owner's substance was built anyway)

1. **`aiTierCeiling(requested, user)` with `user !== null` does not work** for the runtimes with no sign-in at all (local
   `next dev`, a self-hosted copy, every route test): `user` is null there but the caller is a reader, not an anonymous
   one. The gate returns `{ user, anonymous }` instead, and the ceiling is `anonymous ? 0 : requested`.
2. **The deep-report counter keys were listed under both (a) and (b)** (plan 2.3 says (a), F3 says (b)). Deleting
   `deep-report-quota.ts` leaves them with no consumer, so they went in N3 with `endOfUtcMonth`; the forced-rebuild keys
   stay for F3. For the same reason `GET /api/profile` stopped sending `entitlement` in N3 rather than N5.
3. **`OPERATOR_SENTINEL` in `test-support/route-harness.ts` is not unused** (the rewritten personas test uses it), so N8
   keeps it.
4. **The plan's N1 said to apply the migration to a Supabase branch first.** I had no Supabase access; I applied it to a
   throwaway local PostgreSQL 16 with a Supabase-shaped harness instead (below). The owner still needs the census and a real
   apply.
5. **`opportunities/enrichment.ts`'s two exported gates had no caller at all**, not even a test, so I deleted them (the plan
   allowed "signature or delete"). Their `provider === "default"` branch ("let the server resolve its own provider") was a
   company-key path.
6. **The metering wrapper still wraps every provider** (scope (b) removes it). With no entitled context to read,
   `resolveProvider` now passes `{ userId: null, byok }` to `meterProvider`, so usage rows carry no account id and a
   fallback path name until C2 deletes the wrapper. /privacy says exactly that.
7. **The upload route's title step**: removing `modelTitleFallback` also removed that route's use of the AI gate (it has
   its own sign-in), which is why scan 5's guarded-route count is five, not six.

## Jev: exactly which lines I touched

Q1 as the owner changed it: Jev is untouched except the predicate. Code: `app/api/feed/route.ts:789`,
`const shadowEntitled = gate.user !== null;` (was `gate.entitlement.effectivePlan !== "free"`), with a two-line comment
above it (lines 787-788). The shadow still also requires `gate.user?.id` to equal the cache scope owner, so the new
predicate is subsumed by that condition; I kept it because it feeds the hook's `entitled` flag. `onFreshShortlist`,
`buildJevShadowHook`, `lib/decisions/*` code, `security/jev-broker-auth.ts`, the edge function's code, `JEV_API_KEY`, every
`PEER_JEV_*` name and the Jev spend-scan are untouched. Comment-only edits: `lib/decisions/broker-client.ts` lines 30-34 and
77-78 (they said the caller computes `entitled` from `resolveEntitlement(...).effectivePlan`), `supabase/functions/jev-broker/
index.ts` lines 207-218 (the "STOP" comment about the plan rule it could not copy into Deno), and
`scripts/assert-byok-production-env.mjs` lines 58-60 (the `JEV_API_KEY` paragraph named the deleted `EXPECTED_ON_VERCEL`;
the key is still allowed and silent). Tests: `api/feed/route.test.ts` Jev wiring block follows the new gate mocks, and its
"free plan" case became "no signed-in user (gate.user null, caller not anonymous)"; no other Jev test changed.

Note for C3: after N4 `aiTier >= 2` happens only for a reader whose own model key resolved, so the shadow now runs only for
key-holders, on the company's `JEV_API_KEY`, which is exactly what C3 replaces with a reader-supplied Jev key.

## N1, as verified

The previous instance's `20261007000000_drop_plan_and_restore_signup.sql` matches plan 5.2 and 5.3 and I committed it
unchanged. On a throwaway PostgreSQL 16 cluster (created under the `postgres` user's home because the scratchpad path is not
traversable by that user, then stopped and removed) with roles `anon`/`authenticated`/`service_role`, `auth.users`,
`auth.uid()`, the `profiles` table and trigger from `schema.sql`, table-level grants like Supabase's, then
`20260904000200_profile_plan` and `20260922010000_profile_feed_intent`: a new sign-up got `plan = 'trial'` before; after the
migration it gets an empty row and the function body equals `handle_new_user.before.sql`; the only grants that changed are
the SELECT/REFERENCES grants on the four dropped columns (my harness gave every role table-level ALL); an `authenticated`
session can still update `display_name` and `feed_intent` and cannot name `plan`; the file runs twice without error;
`upstream-migrations` and `rollback-parity` stay green. The DROP COLUMNs have no CASCADE on purpose.

## What the owner must do before merging

1. **Remove `GOOGLE_API_KEY` from the Vercel project's environment variables, every environment.** The guard now fails the
   build while it is present (same mechanism as `TAVILY_API_KEY`), so the preview will not build until then. Remove
   `PEER_ENTITLEMENT_MODE` too if it is set (nothing reads it; it is not on the ban list).
2. **Run the `plan` census, then apply the migration.** `select plan, count(*) from public.profiles group by 1;` first (a
   hand-set `paid` is the only thing that cannot be recovered). Apply `20261007000000_drop_plan_and_restore_signup.sql` in the
   Supabase SQL editor, ideally on a branch first. Either order against the code deploy is safe: the new code never reads
   the plan, and until the migration is applied new sign-ups just get a trial row. `usage_events` and the company-budget
   tables are deliberately NOT touched here (C2); export `usage_events` before that.
3. **Expect the behaviour change on deploy:** every signed-in reader without a key of their own loses ranking by a model,
   relevance reasons, digest bullets, Deep reports, model figure choice and model upload titles at once. `web/public/CHANGELOG.md`
   v0.44.0 and the rewritten copy say so; post the changelog entry the same day.
4. **PR #32 (`deep-report-reading-helper-enhancement`) must change** per plan section 7, with these corrections from what
   actually landed: the gate is `requireAiRequest(scope, limit, { allowAnonymous })` returning `{ user, anonymous }` (so
   `gate.entitlement.userId` becomes `gate.user?.id ?? null`, not `gate.user.id`); `resolveProvider(override)` takes one
   argument; `aiAvailability(profile, authOutcome)` reads `useSyncGate((s) => s.authOutcome)` and `useProfileStore.entitlement`
   is gone; `usage/deep-report-quota.ts` is deleted and so are `QuotaSignal`, the `"quota"` stream event and
   `PaperReport.quota`; `figure` loses `ctx`; `privacy/page.tsx` sentences it pins were rewritten in N7.

## What C2 (scope (b)) needs, found while doing (a)

- **F1** `llm/providers/metered.ts`, `usage/events.ts`, `usage/context.ts`, `llm/usage-log.ts` rows. `registry.ts`'s one
  `meterProvider(provider, { userId: null, byok })` call is the single place to drop; /privacy's "What is recorded about
  model use" section (reworded in N7 to what the code does today) is deleted with it (F5).
- **F2** `usage/company-budget.ts`, `security/company-spend.ts`, the `CompanySpendCapability` plumbing in `feed/route.ts`
  (`companySpendForSources`), `feed/types.ts`, `sources/vertex-search.ts`, `feed/pipeline.ts`. `CompanySpendCapRefusedError`
  is no longer caught anywhere on a reader path (N3 removed the report route's catch), so it is unreachable already.
- **F3** `usage/rebuild-breaker.ts` and its new `rebuild-breaker.test.ts`; `counters.ts` `FORCED_REBUILDS_PER_DAY` and
  `forcedRebuildDayKey`; `poolRefreshAllowed` / `systemSearchAllowed` on `jobs/types.ts`, `events/types.ts`,
  `sources/types.ts`, `store/feed.ts`'s `poolRefresh` ask.
- **Stale comments that name the deleted plan layer, in files C2 deletes or edits** (none matches the N8 grep): `lib/jobs/
  {pipeline,types}.ts`, `lib/events/{pipeline,types}.ts`, `lib/search/system-key.ts`, `usage/rebuild-breaker.ts`,
  `usage/company-budget.ts:197` (`entitlement/resolve.ts`'s `EntitlementSupabaseClient`), `app/api/feed/ack/route.ts:21`,
  `lib/feed/pipeline.ts` (a Jev comment: "signed-in, entitled, `aiTier>=2`").
- **Leftover, not company-keyed:** the browser still sends a `paperTitle` figure request parameter that the server no longer
  reads (`components/paper-figure.tsx`, `reader/report-sections.tsx`, `cards/paper-plate.tsx`, `papers/[id]/page.tsx`); I left
  it because PR #32 edits those reader files. `FeedMeta.llmProviderUsed` still falls back to the string `"default"`.
- **Reader copy edge:** a signed-out reader who has pasted a key sees "needs a key" and the "Add a key" link in the reading
  column (`reading.ts` `keyClause`, `showAddKey`), because `providerConfigured` is false for them. The profile page says "Sign in
  to turn this on" correctly; the reading column does not distinguish. Left alone (`reading.ts` and the reader page are PR #32
  territory).

## Environment notes

- `/tmp/claude-0` is mode 700; at the start I ran a `chmod 755` on it to let a database cluster start, which had no effect
  (it still reads 700), and I used the `postgres` user's home for the throwaway cluster instead (removed afterwards).
- A background `npm test` run first returned a stale "completed" notice while vitest was still running; the baseline in this
  file is from the rerun that finished (5806 passed, 11 skipped), matching the earlier log in `scratchpad/byok/logs/base-test.log`.
