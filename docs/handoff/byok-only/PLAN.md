# BYOK-only: the plan and the owner's decisions

> Peer is BYOK-only again. This file is investigator B's plan (read-only study of `origin/main` a127ad62; line numbers
> below are on that commit) with the owner's and manager's decisions of 2026-10-06 recorded first. Where a decision and
> the plan below disagree, the decision wins.

## Decisions (2026-10-06)

- **Scope.** The owner chose the FULL scope: (a) the paid tier and the company-key model path, then (b) the usage ledger and
  the company dollar budget. Branch `remove-paid-tier-restore-byok`, a draft PR to `main`, merged by the owner.
  Part 1 (C1) is scope (a), commits N1 to N8 of section 6.3. Part 2 (C2) is scope (b), section 6.4.
- **Everything about charging money or a paid tier is deleted from `main`**, not left unused. AI goes back to
  bring-your-own-key only; the company's own model key is never used for readers again.
- **Q1 (Jev).** In this PR the reader path is cut: the `onFreshShortlist` hook, `buildJevShadowHook` and its helpers, and
  `shadowEntitled` leave `app/api/feed/route.ts`, so no reader request can reach Jev. `lib/decisions/*`, the edge function and
  the Jev env stay in place; a follow-up PR decides their deletion. Their tests stay; the feed route's Jev tests go.
- **Q2 (signed out with a key).** Sign-in stays required for every AI route. `aiAvailability(profile, auth)` returns
  `"byok"` only when the reader has a usable key and is signed in (or auth is unconfigured, the self-host and test case),
  else `"none"`.
- **Q3 (figure choice, upload title).** The model figure matchers (`lib/figures/semantic-match.ts`, `vision-match.ts`,
  `match-context.ts`, and their calls in `extract.ts`) and `modelTitleFallback` in the upload route are deleted. The
  deterministic extractor and the file-name title remain. No call site is left returning null and pretending to be AI.
- **Q4 (local developer opt-in).** Kept: `PEER_DIGEST_PROVIDER` plus a provider env key, through
  `canUseLocalServerProvider()` only, banned on Vercel by the build guard.
- **Q5 (scope boundary).** (a) is this part; (b) follows as C2 on the same branch.
- **Build guard (N6).** `GOOGLE_API_KEY` moves from expected to forbidden on every Vercel environment (the
  `TAVILY_API_KEY` precedent). The owner removes it from the Vercel project before the preview can build.
- **Migration (N1).** A new forward migration `web/supabase/migrations/20261007000000_drop_plan_and_restore_signup.sql`
  (section 5.3, with the `handle_new_user` body of section 5.2; the four plan columns dropped; no grant changes). No rollback
  file (the precedent is `20261001000000`). The three 20260904 files are untouched.
- **Kept on purpose.** Sign-in, the hourly rate limit, `usage_counters` and `lib/usage/counters.ts` (shared
  infrastructure, section 0.3), and `README.md` (it already describes BYOK-only).
- **Copy (N7).** Plain and exact: no "Tier N" and no "BYOK" in any rendered string (`ui-vocabulary.test.ts`); `/privacy` is
  written from the code and changes in the same commit as the behaviour it describes; a `web/public/CHANGELOG.md` entry.

Note on file locations: `ABC-freemium.md` is at the repository root (this plan says `docs/handoff/ABC-freemium.md`).

---

# BYOK-only: map and plan (investigator B)

Read-only investigation. Nothing in `/home/user/peer` was edited, staged or switched.
Ground truth: `origin/main` = `a127ad62` (after `git fetch origin main`). Line numbers below are on that
commit unless a line says "PR tip". A `git archive` snapshot of it sits in
`scratchpad/byok/mirror/` so every `file:line` can be re-checked with plain `grep -n`.
The open PR branch `deep-report-reading-helper-enhancement` moved while I worked (`4c930502` -> `52df1131`);
PR line numbers are at `52df1131`. Re-run the overlap commands in section 7 before you start.

No key or secret value is quoted anywhere in this file.

---------------------------------------------------------------------------------------------------

## 0. Corrections to the brief, and four facts that change the plan

1. **`aiAvailability` returns `"byok" | "system" | "none"`**, not `"peer"` (`web/src/lib/feed/ai-tier.ts:67`).
2. **The paid tier is already switched off on main, but all of its code is still there.**
   `entitlementMode()` returns `"one_tier"` unless `PEER_ENTITLEMENT_MODE === "tiered"` (`lib/entitlement/resolve.ts:98-100`),
   and in `one_tier` every signed-in reader is `effectivePlan: "paid"` (`resolve.ts:149-157`). So today the *paid*
   breakers apply to everyone: 200 deep reports/day/reader and 1000/day house (`lib/usage/deep-report-quota.ts:58,61`).
   The price card was already pulled from /welcome in PR #29 (`8496de33`). `ProPlanSummary` and `plan-copy.ts` are orphans.
   `TierUpgradeBlock`, `QuotaNotice`, `PoolRefreshNotice` do not exist on main (`QuotaNotice` comes back in PR #32).
3. **`usage_counters` / `counters.ts` is shared infrastructure, not a spend ledger.** It carries the hourly AI rate limit on
   every AI route, the Resend caps (`send-test-email` 3/day, `confirm-email` 5/day, both fail-closed), the
   source-retry claims in the paper pipeline, the manual-refresh cooldown, and the Jev caps (also read by the
   `jev-broker` edge function through the `increment_usage_counter` RPC). Scope (b) as worded ("delete the counters")
   cannot be done literally. Section 2.3 lists exactly what is budget (deleted) and what stays.
4. **A client-side object doubles as identity.** `useProfileStore.entitlement.userId` is the owner key for the local
   delivery-ledger namespace (`store/feed.ts:558`, `currentOwnerKey()`) and the "is this reader signed in?" input of
   `aiAvailability`, the welcome wizard and enrichment. Deleting `entitlement` needs a replacement
   (`useSyncGate.authUserId` / `authOutcome` already exist, `components/profile-sync.tsx:57-76,905`).

Also: `GEMINI_API_KEY` is read nowhere. The string "Alex Scholar" appears nowhere in the repo (not in code, docs or
state files). There are no `jobs/report`, `jobs/feed` or `events/*` routes on main (surfaces deleted); `app/api/jobs/*`
is only `dispatch-digests`, `prepare-dashboards`, `purge-uploads`. The jobs/events pipelines
(`lib/jobs/pipeline.ts`, `lib/events/pipeline.ts`) are imported by no non-test file, so the forced-rebuild breaker,
`poolRefreshAllowed` and `systemSearchAllowed` consumers are already unreachable.

**History caveat.** `origin/main` is flattened: its first commit `f020a4b3` (2026-09-16) already contains the whole
freemium build, so `git show <commit>^` on main's own history cannot show "before". The full incremental history is on
`origin/freemium-system-key` (1568 commits, root `c767ddd8`) and is in the local object store. Section 3 uses it.

---------------------------------------------------------------------------------------------------

## 1. Inventory A - paid tier, plans, prices, trial

Counts: **21 production/config files** (7 whole-file deletions + 14 edits), **18 test files** (4 deleted, 14 edited),
plus **7 doc files** = **46 files**. Eighteen of these also appear in Inventory B (overlap is mostly `ai-tier.ts`,
`deep-report-quota.ts`, routes, `.env.example`, the build guard). Line counts: 862 lines deleted whole, ~692 test lines deleted whole.

### 1.1 Whole-file deletions (production)

| File | What it is | Dependents (`git grep`) | Verdict |
|---|---|---|---|
| `web/src/lib/entitlement/types.ts` (110) | `Plan` (10), `Entitlement` (28-77), `FREE_DEEP_REPORTS_PER_MONTH = 5` (80), `TRIAL_DEEP_REPORTS_TOTAL = 20` (82), `ANONYMOUS_ENTITLEMENT` (94), `asPlan` (106) | prod: `api/papers/report/route.ts`, `welcome/page.tsx`, `welcome/completeness.ts`, `opportunities/enrichment.ts`, `usage/deep-report-quota.ts`, `figures/match-context.ts`, `feed/ai-tier.ts`, `security/ai-request.ts`, `security/entitled-context.ts` (+ `entitlement/allowance.ts`, `resolve.ts`); 8 test files | **Replacement needed.** Every non-plan consumer uses it as `Pick<Entitlement,"userId">` = "is there a signed-in reader". Replace with `{ signedIn: boolean }` (client) / `{ user }` (server). The rest is pure deletion. |
| `web/src/lib/entitlement/resolve.ts` (256) | `resolveEntitlement` (227), `fromStoredPlan` (127), `entitlementMode` (98), `devEntitlement` (197), the `plan, trial_started_at, trial_ends_at` select (241-245) | `security/ai-request.ts:4,102,123,184`; `api/profile/route.ts:9,229`; tests `resolve.test.ts`, `profile/route.test.ts` (mock, 53), `ai-route-personas.test.ts` (admin mock) | Pure deletion once those two callers are changed. |
| `web/src/lib/entitlement/allowance.ts` (192) | `deepReportAllowance`, `ClientEntitlement`, `toClientEntitlement` (128), `ANONYMOUS_CLIENT_ENTITLEMENT` (153), `entitlementGrants` (188) | `components/profile-sync.tsx`, `digest/daily-digest.tsx`, `reader/use-model-report.ts`, `app/profile/page.tsx`, `api/profile/route.ts`, `app/page.tsx`, `welcome/page.tsx`, `papers/[id]/page.tsx`, `store/feed.ts`, `store/profile.ts`; 5 tests | **Replacement** (capability + identity, see 0.4), then deletion. |
| `web/src/lib/entitlement/plan-copy.ts` (84) | The only home of the strings "Peer Pro" (50), "Peer Pro is $12/month" (59), ", or $6 for students." (61), "Peer Pro lifts the monthly limit." (70), "Refresh now is on the paid plan..." (81-84) | only `components/plan/pro-plan-summary.tsx` | Pure deletion. |
| `web/src/components/plan/pro-plan-summary.tsx` (+ `.test.tsx`) | Price card. **No importer** since #29 (only comments: `welcome/page.tsx:444`, `account/account-section.test.tsx:111`, `navigation/upgrade-destination.ts:36`) | none | Pure deletion. |
| `web/src/lib/navigation/upgrade-destination.ts` (43) (+ test) | `UPGRADE_HREF = "/welcome?step=ai"` (43) | `components/reader/decision-block.tsx:10,123-125` - it is the "add a key" link (`BUTTON.addKey`) shown when `showAddKey` | **Replacement:** rename to an add-key constant (same destination, `/welcome?step=ai`), keep the dead-link guard (`navigation/dead-links.test.ts`, `upgrade-destination.test.ts:20,77`). |
| `web/supabase/migrations/20260904000200_profile_plan.sql` | `profiles.plan` (default 'free', check free/trial/paid), `trial_started_at`, `trial_ends_at`, `plan_updated_at` (20-25); `handle_new_user()` rewritten to insert `plan='trial'`, 14 days (41-56); table-level `revoke update, insert ... from anon, authenticated` then per-column grants for every column except the four plan columns (87-100) | `upstream-migrations.test.ts` pins it byte-for-byte; `resolve.ts:243` reads it | **Replacement:** a new down migration (section 5). Do not edit this file (it is applied, and pinned). |

### 1.2 Edits (production / config)

| File:lines | Plan-related content | Verdict |
|---|---|---|
| `lib/feed/ai-tier.ts:105-191` | `aiModeChip` (105) and `planChipText` (173) - strings "Pro", "Trial · N days left", "Free". **Both dead**: `aiModeChip` has no importer besides its test | pure deletion |
| `lib/feed/ai-tier.ts:36-87` | `hasUserLlmOverride`, `AiMode`, `aiAvailability`, `feedsUseAi` | keep logic, change the second argument (section 6) |
| `api/profile/route.ts:9-18,195-247` | `clientEntitlement()` calls `resolveEntitlement`, reads the monthly or trial counter, returns `entitlement` in the GET body (201) | replacement: body becomes `{ profile }` |
| `lib/usage/deep-report-quota.ts` (365) | plan-keyed `consumeDeepReport` (203-365): paid branch 228, trial branch 315, free branch monthly; `QuotaSignal` (70), `quotaMessage` (141) | deleted in scope (a) (inputs vanish); importers `api/papers/report/route.ts:26-30,645`, `lib/papers/report.ts:19,157`, `lib/papers/report-stream.ts:2,24`, `use-model-report.ts` handler (324) |
| `api/feed/route.ts:798-814` | `shadowEntitled = gate.entitlement.effectivePlan !== "free"` feeds the Jev shadow's `entitled` flag | **replacement** - owner decision Q1 |
| `store/profile.ts:25,84-85,436,444,856` | `entitlement: ClientEntitlement \| null`, `setEntitlement` | replacement (identity from `useSyncGate`) |
| `components/profile-sync.tsx:24,113-123,821,846,869,949,1036` | `fetchRemote` returns `entitlement`; `setEntitlement(ANONYMOUS_CLIENT_ENTITLEMENT)` on sign-out | replacement |
| `components/reader/decision-block.tsx:10,123-125` | `UPGRADE_HREF` | rename |
| `app/welcome/page.tsx:92,431-445,695,735` | `entitlementGrants(...)`; copy; comment about `ProPlanSummary` | copy + signature |
| `app/welcome/completeness.ts:8-12,68,104,136` | `ANONYMOUS_ENTITLEMENT` default, `aiAvailability(profile, entitlement)` | signature |
| `lib/opportunities/enrichment.ts:3,977,1002` | `Pick<Entitlement,"userId">` (function is imported by no non-test file) | signature or delete |
| `web/.env.example:5-11` | `PEER_ENTITLEMENT_MODE` | delete lines |
| `web/scripts/assert-byok-production-env.mjs:98` | `"PEER_DEV_ENTITLEMENT"` in `FORBIDDEN_ON_VERCEL` (79-99) | delete entry with the variable |
| `lib/decisions/broker-client.ts:30,78,83,174`, `jev-direct-client.ts:34,62-63,97`, `jev-dispatch.ts:61,94,108`, `shadow.ts:86,342` | `entitled: boolean` input, documented as `resolveEntitlement(...).effectivePlan !== "free"` | decision Q1 |
| `supabase/functions/jev-broker/index.ts:205-235` | comment only about `resolve.ts` | comment fix if the function stays |

### 1.3 Tests (A)

Delete whole: `lib/entitlement/resolve.test.ts` (47 plan refs), `lib/entitlement/allowance.test.ts`,
`components/plan/pro-plan-summary.test.tsx`, `lib/navigation/upgrade-destination.test.ts` (becomes the add-key test).
Rewrite/trim: `lib/feed/ai-tier.test.ts` (19 plan refs, 45 entitlement refs), `api/profile/route.test.ts` (14),
`lib/usage/deep-report-quota.test.ts` (delete with the module), `lib/security/upstream-migrations.test.ts` (lines 60-67,
see section 5), `store/profile.test.ts`, `scripts/assert-byok-production-env.test.ts`, `api/feed/route.test.ts`,
`api/ai-route-personas.test.ts`, `welcome/completeness.test.ts`, `lib/navigation/dead-links.test.ts` (comments),
`components/account/account-section.test.tsx:111` (comment), `lib/security/ai-request.test.ts`, `lib/security/entitled-context.test.ts`,
`api/papers/report/route.test.ts`.
(`lib/opportunities/salary.test.ts` and `lib/jobs/card.test.ts` match "$12"/"$6" but are salary strings - false positives.)

### 1.4 Docs that name the tier or prices

`web/public/CHANGELOG.md:1080-1110` (v0.24.0 "One plan, on Peer's model" - the /changelog page serves this; add a new entry, do not rewrite history),
`docs/handoff/SPEC-freemium.md`, `ABC-freemium.md` (17,922 lines; 235 plan/price hits), `ABC-JEV-INTEGRATION.md`,
`docs/JEV-RELEASE-READINESS.md`, `docs/handoff/SUPABASE-MIGRATION-HANDOFF.md`, `docs/handoff/supabase-backup-2026-09-14/*`.
Recommendation: leave as history with a one-line SUPERSEDED banner on `SPEC-freemium.md` and `ABC-freemium.md`; update only the
live knob tables in `JEV-RELEASE-READINESS.md` (`PEER_COMPANY_SPEND_CAP` rows 622-646, 761, 1001-1027). `README.md` already describes BYOK-only
(lines 177-181, 259-263, 436-441, 538) and becomes true again with no edit.

---------------------------------------------------------------------------------------------------

## 2. Inventory B - the company's model key path

Counts: **47 production/config files** (12 whole-file deletions + 35 edits) and **26 test files** (9 deleted, 17 edited) = **73 files**,
plus a separate **Jev set of 25 production files + 19 test files** that is a decision (Q1), not counted.

### 2.1 How a reader gets a model without a key today

Client: `aiAvailability(profile, entitlementGrants(entitlement))` (`ai-tier.ts:69-75`):

```ts
export function aiAvailability(profile, entitlement: Pick<Entitlement,"userId">): AiMode {
  if (hasUserLlmOverride(profile)) return "byok";
  return entitlement.userId !== null ? "system" : "none";
}
```

So "signed in" alone is "system" (Peer's model). The client then sends `aiTier: 2` and no `llmOverride`
(`store/feed.ts:957`, `feedsUseAi(...) ? 2 : 0`) or just calls the route (`use-model-report.ts:176-177`, `papers/[id]/page.tsx:676-677`,
`digest/daily-digest.tsx:108-110`).

Server, three steps (all in `lib/llm/providers/registry.ts`):

```ts
function resolveSystemProvider(): DigestProvider | null {            // 117-126
  if (canUseLocalServerProvider()) { const optIn = resolveLocalOptInProvider(); if (optIn) return optIn; }
  if (process.env.GOOGLE_API_KEY) { return createGeminiApiProvider(process.env.GOOGLE_API_KEY); }   // 122-123, the ONLY read
  return null;
}
export function resolveProvider(override, ctx: ProviderContext) {   // 185-204
  const byok = hasUsableProviderOverride(override);
  const provider = byok ? resolveUserProvider(override) : resolveSystemProvider();
  if (!provider) return null;
  const entitled = isEntitledContext(ctx) ? ctx : null;
  return meterProvider(provider, { userId: entitled?.userId ?? null, byok: entitled?.byok ?? byok, path: entitled?.path });
}
```

### 2.2 Every route that passes through it (origin/main)

| Route | Gate | Provider | Today: signed-out / signed-in no key / key | After |
|---|---|---|---|---|
| `POST /api/feed` | `requireEntitledAiRequest("paper-feed", 60, {allowAnonymous:true})` `feed/route.ts:739`; `entitledAiTier` 743 | `resolveProvider(llmOverride, entitledContext(...))` 750-753 (only tier>=2) | tier 0 (anonymous ceiling 0, even with a key) / Peer's Gemini / own key | tier 0 / tier 0 / own key |
| `POST /api/digest` | `requireEntitledAiRequest("digest", 60)` `digest/route.ts:77` | `resolveProvider(body.llmOverride, entitledContext(...))` 84-90 | 401 / Peer's / own | 401 / no model (`emptyResponse(true)`) / own |
| `GET /api/figure` | `requireEntitledAiRequest("figure", 60)` `figure/route.ts:41` | **none from the reader**: `ctx: { entitlement, byok:false }` 56; matchers `figures/semantic-match.ts:70-73`, `vision-match.ts:141-144` fall to the system provider | 401 / Peer's model chooses figures / same (no key channel exists on a GET) | 401 / deterministic extractor only / same - **decision Q3** |
| `POST /api/papers/report` | `requireEntitledAiRequest("paper-report", 20)` `report/route.ts:613`; `consumeDeepReport` 645 | `resolveProvider` 245, 402, 662 | 401 / Peer's (deep reports metered) / own | 401 / shallow report w/o model / own |
| `POST /api/papers/upload` | `requireEntitledAiRequest("paper-upload-title", 20)` `upload/route.ts:97` (soft: a refusal skips the step) | `resolveProvider(null, ...)` 99 - **never a key; company model only** (`modelTitleFallback`, 95-137) | title via Peer's model / same | file name only |
| `test-digest` | `requireEntitledAiRequest("test-digest", 20)` `test-digest/route.ts:140`; 404 unless `canUseLocalServerProvider()` (124) | none (`aiTier: 0`) | local only | local only |
| `jobs/dispatch-digests`, `jobs/prepare-dashboards` | `CRON_SECRET` bearer | none (`aiTier: 0`) | unaffected | unaffected |
| `GET /api/profile` | `getUser()` 401 | none | returns `entitlement` + reads a counter (229-247) | `{ profile }` |
| `profile/send-test-email`, `profile/confirm-email` | `getUser()` + counter caps | none | **not AI**; use `getCounterStore`/`breakerTripped` (`send-test-email/route.ts:191-197`, `confirm-email/route.ts:184-190`) | unchanged |

Library call sites reached from the feed pool build with a *justification* instead of an entitled context:
`feed/tier2-rerank.ts:76-85` (`"entitlement-proved-by-tier-ceiling"`), `opportunities/query-gen.ts:313-332`. Both become `resolveProvider(llmOverride)`.

### 2.3 Which pieces exist only to budget the company's key (go) and which protect something else (stay)

| Piece | Where | Class |
|---|---|---|
| `Plan`, `Entitlement`, `resolveEntitlement`, `entitlementMode`, `deepReportsBudget`, `systemSearchAllowed`, `poolRefreshAllowed`, `PEER_ENTITLEMENT_MODE`, `PEER_DEV_ENTITLEMENT` | `lib/entitlement/*` | **BUDGET-PER-PLAN - goes (scope a)** |
| `consumeDeepReport`, `deepReport{Month,Day,Trial,GlobalDay}Key`, 5/month, 20/trial, 200/day paid, 1000/day house, `QuotaSignal`, `quotaMessage` | `usage/deep-report-quota.ts`, `usage/counters.ts:111-165` | **BUDGET - goes (scope a; plan-keyed so it cannot survive)** |
| `entitledContext`, `EntitledContext` brand, `SpendJustification`, `unsafeEntitledContextForTests`, `ProviderContext` | `security/entitled-context.ts` (180) | **BUDGET GUARD - goes (scope a)**: compile-time proof that "an entitlement check ran before *the operator's* money was spent". With no operator provider it proves nothing. Rewrites `spend-scans.test.ts` scans 4 (335), 6 (378). |
| `resolveSystemProvider`, `GOOGLE_API_KEY` read, `meterProvider` wrapping | `registry.ts:117-126,195-203` | **COMPANY KEY - goes (scope a)** |
| `usage_events` sink + async-local context + provider wrapper | `usage/events.ts`, `usage/context.ts`, `llm/providers/metered.ts`, `llm/usage-log.ts:12-14,51-82`, migration `20260904000100` | **LEDGER - goes in scope (b)**; note it also writes rows for BYOK calls (`byok: true`), so the privacy sentence "Every call Peer pays for writes one row" is already inaccurate |
| `company-budget.ts` (610), `company_spend_caps`, `company_model_prices`, `PEER_COMPANY_SPEND_CAP`, `CompanySpendCapRefusedError`, reservation in `metered.ts:119-138,190-192` | `usage/company-budget.ts`, migration `20260925000000` | **COMPANY KEY BUDGET - scope (b)**; dormant (unreachable: the flag is only consulted when `!ctx.byok`) once scope (a) lands |
| `rebuild-breaker.ts`, `FORCED_REBUILDS_PER_DAY = 500` (`counters.ts:181`), `forcedRebuildDayKey` | `usage/rebuild-breaker.ts` | **BUDGET - scope (b)**; only called from the orphaned jobs/events pipelines and `sources/web-search.ts` |
| `security/company-spend.ts` + `CompanySpendCapability` plumbing | `feed/route.ts:21-23,618-622,760-761,853,891-892,910`, `feed/types.ts:10,78`, `sources/vertex-search.ts:16-18,250-253`, `feed/pipeline.ts:626` | **dead stub**: `requireCompanySpendCapability()` answers 401/503 always (file lines 34-52), so `sources:["web"]` on the paper feed is already refused. Scope (b). |
| `requireEntitledAiRequest` | `security/ai-request.ts:92-186` | **MIXED, keep the guard half** (below) |
| `entitledAiTier` | `ai-request.ts:217-224` | **GUARD**: server-side downgrade `aiTier>=2 -> 0` for an anonymous caller; a request body cannot raise its own tier. Keep, with `user !== null` as the test. |
| `protectAiRequest` | `ai-request.ts:196-202` | wrapper used only by tests; delete |
| `canUseLocalServerProvider` + `resolveLocalOptInProvider` (`PEER_DIGEST_PROVIDER`) | `registry.ts:53-55,103-109` | **DEV convenience**, banned on Vercel by the build guard; the developer's own env key on a developer's machine, not readers. Keep (the pre-D1 code had this; see 3.1). Decision Q4. |
| `lib/llm/client.ts` (`getAnthropicClient`, `ANTHROPIC_API_KEY`) | 13 lines | **dead** (no importer); delete |
| `usage/counters.ts` store (`increment`, `read`, `InMemoryCounterStore`, `SupabaseCounterStore`, `getCounterStore`, `underLimit`, `breakerTripped`, `rateKey`, `testEmailDayKey`, `confirmEmailRequestDayKey`, `endOfUtc*`) | `counters.ts` | **GUARD - stays in both scopes** (rate limit, email caps, retry claims, refresh cooldown, Jev caps) |
| the hourly per-user rate limit | `ai-request.ts:155-180` | **GUARD - stays**: it still protects Peer's server (full-text fetches, PDF parsing, outbound fan-out to publishers) and the reader from a runaway loop on their own key; and it is what needs a user id |
| the 401 for signed-out callers on `digest`, `figure`, `papers/report`, `paper-upload-title` | `ai-request.ts:131-139` | **GUARD**: `figure` and `report` make the server fetch a caller-supplied URL (`figure/route.test.ts`: "an unauthenticated caller cannot make this route fetch on their behalf either"). Keep sign-in. |
| deployed-without-auth 503 | `ai-request.ts:105-111` | GUARD, stays |
| `PEER_FEED_AI_TIER` banned on Vercel | build guard `assert-byok-production-env.mjs:164-169` | GUARD, stays |
| Jev: `JEV_API_KEY`, direct client, broker, shadow, caps | see 4 and Q1 | **COMPANY KEY on readers' data** (flagged, off by default) |
| operator search: `lib/search/system-key.ts`, `sources/vertex-search.ts`, `sources/gemini-search.ts` (`GOOGLE_VERTEX_*`), `BRAVE_SEARCH_API_KEY` read at `system-key.ts:140` | | already unreachable (hard-false `systemSearchAllowed`, banned on Vercel). Adjacent; delete in the Jev follow-up or leave. |

### 2.4 `entitlementGrants`, `feedsUseAi`, `PEER_DEV_ENTITLEMENT`

* `entitlementGrants(entitlement|null)` returns the anonymous object while the profile fetch is pending (`allowance.ts:188-191`): a *capability* question fails closed while ignorant. Its replacement is simply `signedIn = authOutcome === "signed-in"`.
* `feedsUseAi(profile, ent) = aiAvailability(...) !== "none"` (`ai-tier.ts:82-87`) is the one predicate the chip, the request builder and the profile page share; keep it, narrow `AiMode` to `"byok" | "none"`. The value `"system"` is also a segment in two cache keys (`papers/report-cache-key.ts:42` `ai=${mode}`, `components/digest/digest-cache-key.ts:36`); entries stored under `ai=system` are simply never hit again (browser storage clutter, no wrong hits).
* `PEER_DEV_ENTITLEMENT` is read only at `resolve.ts:198`, only when `isLocalDevRuntime()`; it makes local dev behave as `free|trial|paid` with a synthesised `dev-local` user. It has no meaning without plans: delete it, and its ban in the build guard.

---------------------------------------------------------------------------------------------------

## 3. What BYOK looked like before the freemium work

### 3.1 Where the history is, and the commit map

`origin/main` cannot show it (flattened root `f020a4b3`). Use `origin/freemium-system-key`:

| Commit | Date | What |
|---|---|---|
| `4498ff90` | 2026-07-31 | **"enforce BYOK-only AI in deployed Peer"** - the baseline to restore (registry, `protectAiRequest`, build guard, `CRON_SECRET`) |
| `7d8a6f8f` | 09-04 | 1-01 `resolveEntitlement` |
| `36f39bb3` | 09-04 | 1-02 shared counters (`usage_counters`) |
| `f1e838d2` | 09-04 | 1-03 `meterProvider` + `usage_events` |
| `b1e1e655` | 09-04 | 1-06 `requireEntitledAiRequest`, `entitledAiTier` |
| `9ea21bc9` | 09-04 | 1-10 guard requires/stops banning the system key |
| `5959d4cf` | 09-04 | **1-11/1-12 the system key becomes the default model** (`resolveSystemProvider`) |
| `feb7bb4c` | 09-04 | 1-13 plan columns + 14-day trial migration |
| `a3091d7e` | 09-04 | 1-14 `aiAvailability` collapses four predicates |
| `fb43e370` | 09-04 | 1-15 `"default"` means "Peer's included AI" |
| `bd92a71e` | 09-04 | 1-20..1-23 deep-report counters, spend breakers |
| `673d5b45` | 09-04 | 1-24..1-27 tier vocabulary retired, plan-aware upsell |
| `91418168` | 09-22 | 10-02 `PEER_ENTITLEMENT_MODE` (also on main) |
| `7ddcafc8` | 09-26 | SPEND-CAP (company dollar budget), on main |

You cannot `git revert` these onto main (different histories, merged state); use them as a *reading* of the target shape.

### 3.2 `resolveProvider` just before the system key (`git show 5959d4cf^:web/src/lib/llm/providers/registry.ts`)

```ts
function resolveLocalServerProvider(): DigestProvider | null {
  const explicit = process.env.PEER_DIGEST_PROVIDER as ProviderId | undefined;
  if (explicit && explicit in providers) { return providers[explicit]; }
  if (process.env.GOOGLE_VERTEX_PROJECT) return geminiProvider;
  if (process.env.GOOGLE_API_KEY) { return createGeminiApiProvider(process.env.GOOGLE_API_KEY); }
  if (process.env.ANTHROPIC_API_KEY) return anthropicProvider;  /* openai, qwen, deepseek likewise */
  return null;
}
/** Resolution order: 1. valid per-request BYOK override ... 2. local `next dev` server credentials
 *  (developer convenience only) 3. null (Tier 0 fallback everywhere else). */
export function resolveProvider(override?: ProviderOverrideConfig | null, ctx?: {...}) {
  const byok = hasUsableProviderOverride(override);
  const provider = byok ? resolveUserProvider(override)
    : canUseLocalServerProvider() ? resolveLocalServerProvider() : null;
  if (!provider) return null;
  return meterProvider(provider, { userId: ctx?.userId ?? null, byok: ctx?.byok ?? byok, path: ctx?.path });
}
```

(`GOOGLE_API_KEY` there was a *local-dev-only* read: `canUseLocalServerProvider()` = `isLocalDevRuntime()`.)

### 3.3 The predicates before 1-14 (`git show 5959d4cf^:web/src/lib/feed/ai-tier.ts`, `.../components/reports/provider-configured.ts`)

```ts
export function hasUserLlmOverride(profile) { return profile.feedAiProvider !== "default" && Boolean(profile.feedAiApiKey?.trim()); }
export function hasLocalDeveloperProvider(profile) { return process.env.NODE_ENV === "development" && profile.feedAiProvider === "default"; }
export function feedsUseAi(profile) { return hasUserLlmOverride(profile) || hasLocalDeveloperProvider(profile); }
export function reportProviderConfigured(profile) { return profile.feedAiProvider !== "default" && Boolean(profile.feedAiApiKey?.trim()); }
```

There was no `aiAvailability`; four copies of "has the reader a key" existed (that is what 1-14 collapsed). None of them looked at sign-in.

### 3.4 The server gate before 1-06 (`git show b1e1e655^:web/src/lib/security/ai-request.ts:36-104`)

```ts
/** Protect an endpoint immediately before it spends a user's BYOK model key. Tier 0 routes stay public; local `next dev` stays convenient. */
export async function protectAiRequest(scope: string, limitPerHour = 30): Promise<NextResponse | null> {
  if (isLocalDevelopment()) return null;
  if (!hasSupabaseAuthConfig()) { return deployedRuntimeNeedsAuth() ? NextResponse.json({ error: "AI features require sign-in configuration" }, { status: 503, ... }) : null; }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in before using an AI feature" }, { status: 401, ... });
  ... per-user hourly counter (60/h feeds, 20/h reports) ...
  return null;
}
```

and the call order in the routes (feed `b1e1e655^:web/src/app/api/feed/route.ts:150-157`):

```ts
const aiProvider = requestedAiTier >= 2 ? resolveProvider(llmOverride) : null;
const aiTier = requestedAiTier >= 2 && !aiProvider ? 0 : requestedAiTier;
if (aiTier >= 2 && aiProvider) { const denied = await protectAiRequest("paper-feed", 60); if (denied) return denied; }
```

(digest and `papers/report` did the same: resolve first, then `protectAiRequest`.)

### 3.5 Could a signed-out reader with their own key use AI before freemium?

**No, not in a deployed Peer.** After a provider resolved from the key, `protectAiRequest` answered 401 "Sign in before using an AI feature" (deployed + Supabase auth configured). The client did not know (`feedsUseAi` ignored sign-in), so a signed-out reader with a key sent `aiTier: 2` and got a 401 on the *whole feed* - a bug that R-ENT-4 (`allowAnonymous` -> downgrade to tier 0) later fixed. Allowed: local `next dev`, and a runtime with no Supabase auth configured that is not production/VERCEL (self-host, tests). **On main today it is the same** (feed downgrades to tier 0 instead of 401; digest/report 401), but `aiAvailability` still says `"byok"` to the browser for a signed-out reader with a key, so the chip says "AI on" while the server answers tier 0. The new `aiAvailability` should require sign-in (or `authOutcome === "unconfigured"`), which is the pre-freemium behaviour made consistent. Decision Q2 if the owner wants anonymous BYOK instead (then the rate limit needs an IP key and `figure`/`report` need an SSRF review).

### 3.6 Profile "AI setup" and the welcome `ai` step then

* The key panel (`components/profile/ai-setup.tsx`) was shared by the **feed command bar** (`page.tsx`) and the **/welcome** step; the Profile page had no AI row on that branch (`git grep AiKeyFields origin/freemium-system-key` -> `page.tsx:1013`, `welcome/page.tsx:539` only). The Profile "AI provider" row on main first appears in root commit `f020a4b3`; there is no BYOK-era Profile text to restore.
* Provider option at `fb43e370^`: `{ value: "default", label: "Tier 0 — no AI API" }`; its guide: **"No key is okay. Peer's free Tier 0 briefing still works. Choose a company above only when you want Tier 1/2 AI ranking, richer summaries, and Deep reports."**
* Welcome `ai` step at `673d5b45^`: title "Connect an AI key (optional).", subtitle **"Peer works fully free with zero setup. Adding a key unlocks sharper, AI-written briefings and Deep report — and you can always do this later."**, callout **"Peer runs significantly better with an API key. One key powers smarter Tier 1/2 ranking and full Deep reports across Papers, Events, and Jobs. Without one, you still get a complete free Tier 0 briefing."**, and `isStepDone("ai")` required both halves (`provider !== "default" && key`).
* **Do not paste that copy back.** `lib/feed/ui-vocabulary.test.ts:16` (`BANNED = /Tier [012]|BYOK/`, ABC-freemium 1-27) bans "Tier 0/1/2" and "BYOK" in any rendered string. The new copy must say "your own key" and "reading without a model".

---------------------------------------------------------------------------------------------------

## 4. The other keys (origin/main)

| Variable / service | Read at | What it buys | Class | After readers run on their own keys |
|---|---|---|---|---|
| `GOOGLE_API_KEY` | `llm/providers/registry.ts:122-123` (only read); strings `llm/providers/gemini.ts:420,537`; ban/expect `scripts/assert-byok-production-env.mjs:48`; stripped in `vitest.setup.ts:33` | Gemini calls for every signed-in reader (rank, rerank, digest, reports, figure choice, upload title) | **company model key, per-call cost** | **unused** - and becomes *forbidden on Vercel* (see risk 1) |
| `GEMINI_API_KEY` | nowhere | - | - | n/a |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `QWEN_API_KEY`/`DASHSCOPE_API_KEY`, `DEEPSEEK_API_KEY` | `providers/anthropic.ts:29`, `openai.ts:36`, `qwen.ts:37`, `deepseek.ts:40`, `llm/client.ts:6` (dead) | developer's own key, reachable only via `PEER_DIGEST_PROVIDER` in local dev (`registry.ts:103-109`) | dev convenience, banned on Vercel (guard 85-96) | stay local-only (Q4) |
| `GOOGLE_VERTEX_*` (11 names), `GOOGLE_APPLICATION_CREDENTIALS` | `providers/gemini.ts:241,327,351,374,399,403`, `api/digest/test/route.ts:48-50`, `sources/gemini-search.ts:180,275`, `sources/vertex-search.ts:215-221,334-342,476,504`, `scripts/setup-vertex-search.mjs`, `probe-vertex-search-billing.mjs` | operator's Google Cloud project: Vertex Gemini, grounding, Vertex AI Search | company key; banned by prefix on Vercel (guard 140) | local-only dev; Vertex AI Search is already dead (capability never minted) |
| `JEV_API_KEY` | `decisions/jev-direct-client.ts:75` (the only file allowed, enforced by `security/spend-scans.test.ts:306-333`); edge function `supabase/functions/jev-broker/index.ts:241` (`Deno.env.get`) | Jev decision-model calls on a signed-in reader's shortlist, scheduled by `feed/route.ts` `onFreshShortlist` after the response (needs `PEER_JEV_SHADOW=on` and the key); never changes what the reader sees | **company model key on readers' data**, default off | **still used unless removed** (Q1) |
| `PEER_JEV_PER_USER_DAILY_CAP` (50) / `PEER_JEV_GLOBAL_DAILY_CAP` (2000) | `decisions/flag.ts:24-25,84-85,108-109`; edge function `index.ts:57-58,133-134` | per-reader and global daily call-count ceilings for Jev, in `usage_counters` keys `jev:*` / `jev-edge:*` | budget for the company's Jev key | go with Jev |
| `PEER_JEV_GEMINI_FALLBACK*` (10/200) | `flag.ts:214,233-237` | bounded Gemini fallback inside the Jev shadow; inert (no capability is ever minted, `.env.example:263`) | company key | go with Jev |
| `PEER_JEV_BROKER`, `PEER_JEV_BROKER_URL`, `PEER_JEV_BROKER_SECRET`, `PEER_JEV_TRANSPORT`, `PEER_JEV_SHADOW` | `flag.ts`, `broker-client.ts:100` | transport switches; the broker secret authenticates Next to the edge function | infra for the Jev path | go with Jev |
| `OPENALEX_API_KEY` | `sources/openalex.ts:30`, `openalex-topic.ts:67`, `openalex-semantic.ts:71`, `affiliation/openalex.ts:30` | optional bearer for OpenAlex (`.env.example:19-27`) | **free-tier search key** (unset = unkeyed) | unaffected |
| `OPENALEX_EMAIL` / `UNPAYWALL_EMAIL` | `sources/openalex.ts:11`, `papers/search/route.ts:12`, `topics/suggest/route.ts:9`, `figures/extract.ts:933`, `papers/source-links.ts:127` | polite-pool contact address (a string, not a secret) | free-tier etiquette | unaffected |
| Semantic Scholar | `SEMANTIC_SCHOLAR_API_KEY` at `sources/semantic-scholar-client.ts:26,86` (paces at 1500 ms vs 350 ms); `PEER_CHANNEL_S2_RECOMMENDATIONS` flag | rate-limit headroom on the free API | **free-tier search key** | unaffected |
| `TAVILY_API_KEY` | not read (`search/system-key.ts:147` is a comment); banned on Vercel (guard 97; comment 61-64) | the reader's own Tavily key travels in the request body (`feed/route.ts:638-650`) | BYOK already | unaffected |
| `BRAVE_SEARCH_API_KEY` | `search/system-key.ts:140`, gated by `systemSearchAllowed` (hard false) | operator-funded search | company, unreachable | dead |
| `ADZUNA_*`, `JSEARCH_API_KEY`, `USAJOBS_API_KEY` | `jobs/sources/*.ts` | free-tier job APIs; jobs surface has no route on main | free-tier | unaffected |
| `RESEND_API_KEY` (+ `DIGEST_FROM_EMAIL`, `DIGEST_EMAIL_CONFIRM_SECRET`) | `email/send-digest.ts:69,77`, `api/profile/send-test-email/route.ts:149`, `email/confirm-token.ts:43` | email sending (company's Resend account) | **infrastructure**; its caps use `counters.ts` | unaffected - and the reason `counters.ts` stays |
| `CRON_SECRET` | `jobs/dispatch-digests/route.ts:364`, `jobs/prepare-dashboards/route.ts:443`, `jobs/purge-uploads/route.ts:11`, `scripts/purge-uploads.mjs:28` | bearer for the three cron routes | **infrastructure** | unaffected |
| `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_TOKEN` | `supabase/admin.ts:9`, `api/admin/uploads/block/route.ts:32` | server DB access; admin block | infrastructure | unaffected |
| "Alex Scholar" | nowhere in the repo | - | - | n/a |

**Do any Supabase tables store keys? No - confirmed.** I read all 14 migrations, the 8 rollback files and `schema.sql` for
`key|secret|token|credential|api_key|password|vault`: the only hits are primary-key/cache-key/idempotency columns
(`usage_counters.key`, `canonical_key`, `scope_key`) and prose ("this table never holds a credential",
`usage_events` migration lines 7-9). No `profiles` column holds a model key: `feedAiApiKey` lives in browser storage
(`types/index.ts:556`, persisted by `store/profile.ts`) and is deliberately dropped from sync (`profile-sync.tsx:179,189`
`void feedAiApiKey`; `privacy/page.tsx:45`). It *is* relayed through Peer's server on each AI request
(`llmOverride.apiKey` in the body of feed, digest, report) and never stored. The edge function reads four env vars with
`Deno.env.get`: `PEER_JEV_BROKER_SECRET` (173), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (193), `JEV_API_KEY` (241), plus
`envNumber("PEER_JEV_*_CAP")`.

---------------------------------------------------------------------------------------------------

## 5. Supabase

### 5.1 What exists only for the paid tier or the company budget

| Object | Migration | Production status | Class |
|---|---|---|---|
| `public.usage_counters`, `increment_usage_counter(text, timestamptz, bigint)` (service_role only) | `20260904000000_usage_counters.sql` | applied 2026-09-14 | **shared infra - KEEP** (rate limits, email caps, retry claims, cooldown, Jev). Obsolete *rows* (`deep:*`, `forced_rebuilds_today:*`, `company_spend:*`, and on PR #32 `explain_tenths:*`) can be deleted. |
| `public.usage_events` (+2 indexes) | `20260904000100_usage_events.sql` | applied 2026-09-14 | company-key ledger (scope b); holds `user_id`, counts, `byok` flag; **export before drop** |
| `profiles.plan`, `trial_started_at`, `trial_ends_at`, `plan_updated_at`; `handle_new_user()` trial; table-level write revoke | `20260904000200_profile_plan.sql` | applied 2026-09-14 (the revoke was replaced by `profile_plan_column_grants`, see 5.3) | paid tier (scope a) |
| `public.company_spend_caps`, `public.company_model_prices` | `20260925000000_company_spend_budget.sql` (+ rollback) | "authored only; not applied by this campaign" (header, readiness doc 637) - **verify in production** | company budget (scope b) |
| `public.private_decisions` (Jev decision cache) | `20260924000400_private_decisions.sql` (+ rollback) | authored only | Jev (Q1) |

No other migration, column, trigger or function is plan- or budget-specific. `schema.sql:60-71` still has the **pre-plan** `handle_new_user` body
(it was never updated), so it needs no edit.

### 5.2 The pre-plan `handle_new_user` (quoted from history)

`docs/handoff/supabase-backup-2026-09-14/handle_new_user.before.sql` (taken with `pg_get_functiondef` before any migration; its header says "Rollback = run this"):

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$function$;
```

Identical in substance to `schema.sql:60-71`. The `on_auth_user_created` trigger itself is unchanged by the plan migration.

### 5.3 What the reverse migration does

New file, e.g. `web/supabase/migrations/20261007000000_drop_plan_and_restore_signup.sql` (a *forward* migration; keep the three 20260904 files):

```sql
create or replace function public.handle_new_user() ... -- body from 5.2
alter table public.profiles
  drop column if exists plan, drop column if exists trial_started_at,
  drop column if exists trial_ends_at, drop column if exists plan_updated_at;
-- scope (b) additionally:
drop table if exists public.company_model_prices;
drop table if exists public.company_spend_caps;
drop table if exists public.usage_events;           -- after export
delete from public.usage_counters
  where key like 'deep:%' or key like 'forced_rebuilds_today:%' or key like 'company_spend:%' or key like 'explain_tenths:%';
```

**Grants - do NOT "restore" table-level write.** Production ran `revoke update, insert on public.profiles from anon, authenticated`, then granted
every then-existing column except the four plan columns (`EXECUTION-REPORT.md` 28-41). Dropping a column drops its column grants.
Leave the rest as is: it is least privilege, and `20260922010000_profile_feed_intent.sql:14-15` already relies on it
(`grant update (feed_intent)`, `grant insert (feed_intent)`). Re-granting table-level INSERT/UPDATE to `anon` would only widen access. The standing rule stays:
every future user-editable `profiles` column needs its own `grant update (col), insert (col) ... to authenticated`.

### 5.4 The `rollback/` convention

`web/supabase/rollback/README.md`: authored-only SQL, "NOT A MIGRATION — NEVER APPLIED AUTOMATICALLY" header (verbatim phrase), one file per forward migration
named `<same stem>_rollback.sql`, header states: what it reverses, exactly what data it destroys (or "none"), regenerable vs guarantee-bearing, reverse-dependency order;
"no one should run any until a separately approved retention/backup plan exists" (ABC-JEV-INTEGRATION §3e). Enforced by
`lib/release/rollback-parity.test.ts`, **but only for `web/supabase/migrations/2026092*.sql`** (line 28). Consequences:
* `20261007...` is outside that glob, like `20261001000000_private_uploads_bucket.sql` (no rollback). A rollback file for it would be a "stray" and **fail** the parity test (lines 60-73) unless the glob is widened. Either follow the precedent (no rollback file) or widen the glob and add one.
* If you delete `20260925000000_company_spend_budget.sql` (only OK if production never applied it) you must also delete its rollback file and update the README's "The eight files" table; the parity test then stays green (both removed).
* `lib/security/upstream-migrations.test.ts` pins the three 20260904 migrations **byte-for-byte** against `origin/freemium-round10` by running `git show origin/freemium-round10:web/supabase/migrations/<name>` (lines 17-23, 36-43). Editing or deleting them means rewriting/deleting that test; it also fails on any clone without that remote ref. Hence: keep the files, add the down migration, and trim the test's plan assertions (60-67) at the end.

### 5.5 Risk to existing rows

* `profiles`: `plan` currently holds `trial`/`free` for everyone (5 users migrated as `free` on 2026-09-14, later sign-ups get `trial` + dates) and possibly a hand-set `paid` (D7: "set by hand, service role"). Dropping loses that. Run `select plan, count(*) from public.profiles group by 1;` first; no user-typed data is in these columns.
* `usage_events` rows are the owner's spend audit trail; the rollback README forbids dropping tables without an approved retention plan. Export (`\copy ... to csv`) first.
* `usage_counters`: leaving old keys is harmless; deleting them is cosmetic.
* Ordering is safe both ways: current code treats a Supabase error on the plan select exactly like a missing row and falls to `free` (`resolve.ts:246-249`), and one-tier mode ignores the plan anyway. Applying the migration *before* the code deploy is safe; applying after only means new sign-ups get a trial row for a while.
* Migrations are applied by hand here (Supabase MCP / SQL editor, `EXECUTION-REPORT.md` 3), not by CI.

---------------------------------------------------------------------------------------------------

## 6. The plan

### 6.0 Decisions the owner (not the implementer) must take first

* **Q1 - Jev.** `JEV_API_KEY` is the company's key spent on readers' shortlists (`feed/route.ts:797-820`, background, default off, off unless `PEER_JEV_SHADOW=on`). A literal reading of "the company's model key must no longer be used for readers" removes it: **25 production files (4431 lines) + 19 tests** (`lib/decisions/*` 14 files, `security/jev-broker-auth.ts`, `supabase/functions/jev-broker/*` 6 files, `evaluation/jev-smoke/*`, `vitest.jev-smoke.config.ts`), `private_decisions` migration/rollback, `PEER_JEV_*` env, `lib/llm/usage-log.ts` `logDecisionUsage`. *Recommendation:* in this PR do the minimum that makes the rule true on the reader path - delete the `onFreshShortlist` hook and `shadowEntitled` from `feed/route.ts` (797-820, `buildJevShadowHook` and helpers 500-600) so no reader request can reach Jev - and take the library deletion in a follow-up PR once confirmed. If the owner prefers to keep the shadow, `entitled` becomes `gate.user !== null`.
* **Q2 - signed-out + own key.** Keep today's rule (AI routes need sign-in; feed falls back to tier 0)? Recommended yes; client `aiAvailability` then returns `"byok"` only when signed in or auth is unconfigured.
* **Q3 - figure choice by model and the upload title step** are company-key-only features with no key channel (GET + public CDN cache for figures, multipart for uploads). Recommended: delete the AI matchers (`figures/semantic-match.ts`, `vision-match.ts`, `match-context.ts`, calls at `extract.ts:708,738`) and `modelTitleFallback` (`upload/route.ts:95-137`); the deterministic extractor and the file-name title are the existing degraded paths. Restoring them later needs a POST that carries the reader's override (PR #32 already adds a POST to `/api/figure`).
* **Q4 - local developer opt-in** (`PEER_DIGEST_PROVIDER` + env provider keys, local dev only, banned on Vercel). Recommended keep (it is the pre-D1 shape and README 436-441 documents it). Strict alternative: delete the five env-key providers' singletons.
* **Q5 - scope boundary.** In (a) the plan-keyed deep-report allowance is necessarily deleted (its inputs `effectivePlan`/`deepReportsBudget`/`trialEndsAt` are gone). What (b) adds is the usage ledger and the dollar-budget machinery. Do (a) and (b) in one PR as two commit groups so that (a) alone is a valid stopping point.

### 6.1 What readers see (identical in (a) and (b))

* **Signed out, no key:** reading with no model: paper feed on free structured sources at tier 0, the deterministic reading column, no deep report, no digest bullets; Profile deep-report toggle disabled.
* **Signed out, with a key:** same (server answers tier 0 / 401); the chip must say AI off (needs the `aiAvailability` fix).
* **Signed in, no key:** same Tier 0 reading as above, plus synced profile, saves, delivery ledger, the daily email (already `aiTier: 0`). The only visible change from today is that Peer's AI stops; copy points to adding a key.
* **Signed in, with a key:** everything AI runs on their key; routes keep sign-in and the hourly rate limit.

### 6.2 Copy that must change (quoted from main)

`/privacy` (`app/privacy/page.tsx`):
* L46 **"When Peer's own model is used instead, the request goes to Google's Gemini API from Peer's server."** -> delete (the paragraph before it, L45, stays true).
* L52 **"Every call Peer pays for writes one row: which route, which provider and model, how many tokens, how long it took, whether it succeeded, and whether it ran on your key or Peer's."** and L53 **"That row holds no paper text, no prompt, no answer, and no credential. The table has no column that could hold one."** -> scope (a): reword to "Every model call writes one row ... whether it ran on your key" (it already includes BYOK calls) or drop; scope (b): delete the whole section "What is recorded about model use" (L49-55) because the table is gone.
* L60 **"Google (Gemini) sees a paper's text when a model report is written."** -> "The model provider whose key you added sees a paper's text when a model report is written." (Tavily/Resend/Supabase/Vercel sentences stay.)
* L103 "Last changed 2026-09-17" -> new date.

`/welcome` ai step (`app/welcome/page.tsx`):
* L431 subtitle **"Peer works fully free with zero setup, and its AI is included. Adding your own key is optional — it sends the model calls to your account instead, and you can always do this later."**
* L437-441 **"Peer's AI is included — no key needed. Ranking, summaries and Deep reports across Papers, Events and Jobs all run on it. Adding your own key sends those calls to your own account instead, on whichever model you prefer."** (also: Events and Jobs no longer have routes on main)
* L433-435 and L442-446 comments about plan/price/`ProPlanSummary`.
* `completeness.ts:95-104` comment and `isStepDone("ai")` -> back to "has a key (and is signed in)".

`/profile` (`app/profile/page.tsx`):
* L2095-2098 **"Signed in, Peer uses its own model for ranking, relevance reasons and reports. Add your own key only to use a different provider — Peer then sends model calls to that key instead."**
* L2128-2129 **"Sign in first. Signed out, Peer shows the reading without a model and makes no AI call."** -> "Add your own key above to turn this on. Without a key Peer shows the reading without a model and makes no AI call."
* L2121 `disabled={!feedsUseAi(profile, aiGrants)}` keep, new second argument; L1844-1845 comment/`aiGrants`.

`components/profile/ai-setup.tsx`: L21 label **"Peer's AI (included)"** -> "No AI (reading without a model)"; L287-298 **"No key is needed. Peer's AI is included, and everything above runs on it. Choose a company here only if you would rather use your own model and be billed for it yourself."** -> "Without a key Peer shows the reading without a model. Pick a company and paste its key to turn AI on; that company bills you." (No "Tier N" or "BYOK" - `ui-vocabulary.test.ts`.)
Other in-product strings tied to the tier: none found on main outside these (the `plan` chip text lives in dead code).
Add a `web/public/CHANGELOG.md` entry (the page at /changelog reads it) and leave README as is.

### 6.3 Scope (a) Narrow - ordered commits

Gates after every commit: `cd web && npx tsc --noEmit && npm run lint && npx vitest run <paths touched>`; after the last: `npm test`, and `VERCEL=1 node scripts/assert-byok-production-env.mjs` with and without `GOOGLE_API_KEY` set to a dummy.

| # | Commit | Files | Tests to delete / rewrite |
|---|---|---|---|
| N1 | `feat(supabase): drop the plan columns, restore the signup trigger` | new `migrations/20261007000000_...sql` (5.3 first block); no rollback file (precedent) | none break (`upstream-migrations.test.ts` still true of the untouched originals). Apply to a Supabase branch first: insert an `auth.users` row, check `profiles` has no plan columns, `PUT /api/profile` still saves (column grants intact). |
| N2 | `refactor(client): the browser asks "signed in?", not "which plan?"` | `lib/feed/ai-tier.ts` (`AiMode = "byok"\|"none"`, `aiAvailability(profile, auth)`, delete `aiModeChip`/`planChipText`), `store/profile.ts` (drop `entitlement`, `setEntitlement`: 25,84-85,436,444,856), `components/profile-sync.tsx` (drop `fetchRemote().entitlement` and the three `setEntitlement` calls; `useSyncGate` stays), `store/feed.ts` (`currentOwnerKey()` 558 -> `useSyncGate.getState().authUserId`; entitlement params at 766-1040, 2026, 2189, 2234), `app/page.tsx:85,200`, `papers/[id]/page.tsx:676-677`, `digest/daily-digest.tsx:108-110`, `reader/use-model-report.ts:176-177`, `app/profile/page.tsx:1845,2121-2127`, `app/welcome/page.tsx:92,695,735`, `welcome/completeness.ts`, `opportunities/enrichment.ts`, `reader/decision-block.tsx` (rename import) + new add-key destination file replacing `navigation/upgrade-destination.ts`. Server untouched; `/api/profile` still sends `entitlement`, nobody reads it. | rewrite `ai-tier.test.ts`, `store/profile.test.ts`, `store/feed.test.ts` (the auth-loading cases around 3542), `welcome/completeness.test.ts`, `env/no-client-dev-flags.test.ts`, `navigation/upgrade-destination.test.ts` -> add-key test; add a test that a signed-out reader with a key reads `"none"`. **Gate for risk 3:** the owner-namespace tests in `store/feed.test.ts` must still pass unchanged in meaning. |
| N3 | `refactor(usage): remove the deep-report allowance and the quota payload` | delete `usage/deep-report-quota.ts`; `api/papers/report/route.ts` (22-30 imports, 292-294 company-budget catch, 613-648 `consumeDeepReport`/`quotaDecision`, 662, quota sends 380-399, 672); `lib/papers/report.ts:19,157`; `lib/papers/report-stream.ts:2,24`; `reader/use-model-report.ts:324` quota branch; `api/profile/route.ts` stops calling `getCounterStore().read` (229-247) | delete `usage/deep-report-quota.test.ts`, `usage/quota-exemptions.test.ts`; rewrite `api/papers/report/route.test.ts` (9 spend refs), `ai-route-personas.test.ts` |
| N4 | `refactor(llm,security): provider resolution is the reader's key and nothing else` | `llm/providers/registry.ts` (delete `resolveSystemProvider` 117-126 and the `GOOGLE_API_KEY` read; `resolveProvider(override)` single argument, stop importing entitled-context; keep `resolveLocalOptInProvider`), delete `security/entitled-context.ts`; `security/ai-request.ts` (rename `requireAiRequest(scope, limit, {allowAnonymous})` returning `{ user }`, `aiTierCeiling(requested, user)`, delete `protectAiRequest`, keep 105-180 verbatim minus `resolveEntitlement`); callers: `feed/route.ts` (739-753, 798-820 per Q1), `digest/route.ts` (77-90), `figure/route.ts` (41-56), `papers/report/route.ts` (227-245, 402, 613-617, 662), `papers/upload/route.ts` (97-99; delete `modelTitleFallback` 95-137 per Q3), `test-digest/route.ts` (140), `feed/tier2-rerank.ts:76-85`, `opportunities/query-gen.ts:313-332`; figures: delete `semantic-match.ts`, `vision-match.ts`, `match-context.ts`, trim `extract.ts:641-745`; `llm/client.ts` delete | delete `security/entitled-context.test.ts`; rewrite `security/ai-request.test.ts` (25 ent refs), `llm/providers/registry.test.ts` (19 system-key refs: keep the "BYOK wins / unset key resolves null / local opt-in" cases, delete the system-key cases), `api/feed/route.test.ts`, `digest/route.test.ts`, `figure/route.test.ts`, `papers/upload/route.test.ts`, `test-digest/route.test.ts`, `test-digest/route.entitlement.test.ts`, `feed/archive/route.test.ts`, `feed/ledger-flow.integration.test.ts`, `figures/extract.test.ts`, `figures/arxiv-html-source.test.ts`; rewrite `security/spend-scans.test.ts` (scans 4, 5, 6 -> one scan: "every route that reaches `resolveProvider` is behind `requireAiRequest`"; scans 3 and 7 stay) |
| N5 | `refactor(entitlement): delete the plan layer` | delete `lib/entitlement/*` (types, resolve, allowance, plan-copy), `components/plan/*`; `api/profile/route.ts` returns `{ profile }` (9-18, 201, 227-247 gone); `.env.example` 5-11 | delete `resolve.test.ts`, `allowance.test.ts`, `pro-plan-summary.test.tsx`; rewrite `api/profile/route.test.ts` (keep `profilePatchToRow` forged-plan case at 112 as "plan is not a field") |
| N6 | `chore(build): the guard bans the model key instead of expecting it` | `scripts/assert-byok-production-env.mjs`: move `GOOGLE_API_KEY` from `EXPECTED_ON_VERCEL` (48) to `FORBIDDEN_ON_VERCEL`; drop `"PEER_DEV_ENTITLEMENT"` (98); delete `formatWarningMessage` (176-181) and the warn call (212-214); rewrite the sentence at 192 "Peer runs on an operator-funded model, and needs Supabase to know who a request is for." -> Supabase only; `vitest.setup.ts` keep stripping `GOOGLE_API_KEY` (harmless belt-and-braces) | rewrite `src/scripts/assert-byok-production-env.test.ts` (lines 144, 158-165, 256, 281 assert the opposite today) |
| N7 | `copy: BYOK-only wording` | the strings in 6.2; `web/public/CHANGELOG.md` entry | `app/profile/page.test.tsx`, `privacy` test (PR-added), `welcome` tests if any pin copy; `ui-vocabulary.test.ts` must stay green |
| N8 | `test: final sweep` | `upstream-migrations.test.ts` lines 60-67 (keep the file pin; drop "plan fields server-owned" or make it assert the down migration exists), `test-support/route-harness.ts` (drop unused `OPERATOR_SENTINEL`), docs banner | **Final gate:** `git grep -nEi "effectivePlan\|trial_ends_at\|trialEndsAt\|Peer Pro\|PEER_ENTITLEMENT_MODE\|PEER_DEV_ENTITLEMENT\|resolveSystemProvider\|entitledContext\|lib/entitlement" -- web/src web/scripts web/.env.example` returns nothing except the guard's ban list and tests that assert the ban; `git grep -n "GOOGLE_API_KEY" -- web/src` only in `vitest.setup`, `env-isolation`, the guard test and error strings. |

What stays dormant after (a), to be removed in (b): `usage_events` writes (`metered.ts`, `events.ts`, `context.ts`, `usage-log.ts:51-82`), `company-budget.ts` + `company_spend_*` tables + `PEER_COMPANY_SPEND_CAP` (unreachable: only consulted when `!ctx.byok`), `rebuild-breaker.ts`, `security/company-spend.ts`.

### 6.4 Scope (b) Full - commits after N8

| # | Commit | Files | Tests |
|---|---|---|---|
| F1 | `refactor(llm): no metering wrapper, no usage ledger` | delete `llm/providers/metered.ts`, `usage/events.ts`, `usage/context.ts`; `registry.ts` returns the raw provider (195-203); `llm/usage-log.ts` keep the `[llm]` console line (29-40) and `logDecisionUsage` (if Jev stays), drop 12-14, 42-82; remove `recordUsageEvent` from `jobs/sources/jobweb.ts:7,2254`, `events/sources/eventweb.ts:8,2861`, `sources/web-search.ts:8` | delete `metered.test.ts` (38 refs), `usage/events.test.ts`, `usage/context.test.ts`; trim `usage-log.test.ts`, `gemini.test.ts`, `jobweb.test.ts`, `eventweb.test.ts`, `web-search.test.ts` |
| F2 | `refactor(usage): remove the company dollar budget` | delete `usage/company-budget.ts`; `llm/providers/gemini.ts` exports kept only for estimator (43, 72, 168 comments); delete `security/company-spend.ts`, `CompanySpendCapability` plumbing (`feed/route.ts:21-23,618-622,760-761,853,891-892,910`, `feed/types.ts:10,78`, `sources/vertex-search.ts:16-18,250-253`, `feed/pipeline.ts:626`) | delete `usage/company-budget.test.ts` (594 lines), `security/company-spend.test.ts`; trim `feed/route.test.ts`, `pool-refresh-gates.test.ts` |
| F3 | `refactor(usage): remove the forced-rebuild breaker` | delete `usage/rebuild-breaker.ts`; `counters.ts:111-190` (`deepReport*Key`, `FORCED_REBUILDS_PER_DAY`, `forcedRebuildDayKey`, `endOfUtcMonth` if unused, `logStoreUnavailable`); calls in `jobs/pipeline.ts:22`, `events/pipeline.ts:23`, `jobweb.ts:8`, `eventweb.ts:9`, `web-search.ts:9` and the `poolRefreshAllowed`/`systemSearchAllowed` fields in `jobs/types.ts:112,153-158`, `events/types.ts:68,100-108`, `sources/types.ts:44`, `store/feed.ts:1193` | trim `usage/counters.test.ts` (keep rate/email/confirm keys, `breakerTripped`, `underLimit`), `jobs/sources/jobweb.test.ts`, `llm/providers/gemini.test.ts` |
| F4 | `feat(supabase): drop the ledger and the budget tables` | extend the N1 migration or add `20261007000100_...sql` with the (b) block of 5.3; delete `migrations/20260925000000_company_spend_budget.sql` and `rollback/20260925000000_..._rollback.sql` only after confirming production never applied it; update `rollback/README.md` ("The eight files") ; `.env.example:308-324`; `docs/JEV-RELEASE-READINESS.md` knob rows | `rollback-parity.test.ts` stays green; `upstream-migrations.test.ts` keep |
| F5 | `copy: delete "What is recorded about model use"` | `privacy/page.tsx:49-55` | privacy test |
| F6 | final grep gate | `git grep -nE "usage_events\|company_spend\|company_model_prices\|PEER_COMPANY_SPEND_CAP\|recordUsageEvent\|meterProvider\|consumeForcedRebuild" -- web` returns only migration history and docs | `npm test`, `npm run build` |

**Stays in (b):** `usage_counters`, `increment_usage_counter`, `usage/counters.ts` store, `rateKey`, `testEmailDayKey`, `confirmEmailRequestDayKey`, `breakerTripped`, `underLimit` (see 0.3).

### 6.5 Option C - no company key at all (if Q1 says literal)

Commit C1 after F6: delete the Jev set (25 files / 19 tests above), `private_decisions` migration + rollback (+ README row), `PEER_JEV_*` and `JEV_API_KEY` from `.env.example:180-277`, guard comment 66-77 (the JEV note), `vitest.setup.ts:95-115`, `vitest.env-allowlist.ts` JEV names, `package.json` `test:jev-smoke`, `spend-scans.test.ts` scan 7 (306-333); and delete the Supabase function `jev-broker` from the project (a deployed edge function is not removed by deleting the folder: `supabase functions delete jev-broker`). Plus operator search leftovers: `lib/search/system-key.ts` (+test), `sources/vertex-search.ts`, `sources/gemini-search.ts`, `scripts/setup-vertex-search.mjs`, `scripts/probe-vertex-search-billing.mjs`, `BRAVE_SEARCH_API_KEY`, `GOOGLE_VERTEX_*` guard prefix.

### 6.6 Merge and deploy order

1. Before merging: remove `GOOGLE_API_KEY` from the Vercel project's env (and `PEER_ENTITLEMENT_MODE` if set). N6 makes a Vercel build **fail** while it is present - the same mechanism that was used for `TAVILY_API_KEY` (guard comment 61-64).
2. Export `usage_events` (scope b), run the `plan` census, apply N1 (and F4) in the Supabase SQL editor.
3. Merge, deploy. From that moment every signed-in reader without a key is on the Tier 0 reading. Post the changelog entry the same day.

---------------------------------------------------------------------------------------------------

## 7. Effect on the open PR Aspen-Lab/peer#32

Branch `deep-report-reading-helper-enhancement`, tip `52df1131`, merge base `881e47ba` (main is two merges ahead:
`e59d3f04` uploads, `e0fe2309`). 219 files, +35.7k lines. **At least 37 PR files reference a symbol this plan removes (18 new in the PR, 19 modified from main), 20 of them non-test and 17 tests** (my pattern did not include the `QUOTA` copy block, so `reader/copy.ts` and `reader/explain-box.tsx` are extra). 19 of the files this plan edits are also edited by the PR (so expect textual conflicts too):
`api/figure/route.ts`, `api/papers/report/route.ts`, `api/papers/upload/route.ts`, `papers/[id]/page.tsx`, `privacy/page.tsx`, `profile/page.tsx`, `reader/decision-block.tsx`, `reader/use-model-report.ts`, `figures/extract.ts`, `llm/providers/gemini.ts`, `llm/providers/metered.ts`, `lib/papers/report.ts`, `usage/deep-report-quota.ts` and six test files. The main checkout also has uncommitted edits on top of the branch in `privacy/page.tsx`, `privacy/page.test.tsx`, `reader/reading-map.tsx`, `reader/reading-map.gist.test.tsx` (at my last `git status`).

Recompute: `git diff --name-only origin/main...origin/deep-report-reading-helper-enhancement -- web/src | sort > pr.txt; comm -12 pr.txt <(sort touched.txt)`.

### 7.1 After scope (a) merges, the PR must change

`api/papers/[id]/explain/route.ts` (PR tip lines):
* 68 `requireEntitledAiRequest` -> `requireAiRequest`; 203 the call; **208 `const userId = gate.entitlement.userId` -> `gate.user?.id ?? null`**.
* 69 delete `entitledContext` import; 213-216 `resolveProvider(override, entitledContext(gate.entitlement, "paper-explain", hasUsableProviderOverride(override)))` -> `resolveProvider(override)`.
* 70-71 delete `CompanySpendCapRefusedError` and `companyBudgetQuotaSignal` imports; **282-284** delete the `catch` branch that returns `quota`.
* 72 and **266-270**: `lib/usage/explain-quota.ts` takes `entitlement: Entitlement` (line 49) which no longer exists, and its cap is a company budget (the file's own header: "the allowance is about what Peer's page spends ... not about whose key answered"; "a reader on their own key included"). Delete the file and the 429 `explain_exhausted` reply, **or** (if the owner wants a per-reader day cap on explain) port it to `userId: string | null`, drop the house ceiling (`ALL_USERS_EXPLAIN_TENTHS_PER_DAY`) and the `recordUsageEventAwaited` breaker rows (lines 57, 145, 151). Recommendation: delete; the hourly `requireAiRequest("paper-explain", 40)` stays.
* `lib/papers/explain.ts:60,151,157`: drop the `quota?: QuotaSignal` field and the `explain_exhausted` result variant.
* Client: `reader/explain-box.tsx:64` (`QUOTA` import), 82, 309-310, 459-460, 477-478, 566, 731, 857 (statuses `exhausted` / `allowance_unavailable` and their copy); `reader/copy.ts:55-79` (`QUOTA` block: `exhausted`, `companyBudget`, `unavailable`, `explainExhausted`, `explainUnavailable`).

`api/papers/[id]/paragraph-guide/route.ts`: 51 rename; 52 delete `entitledContext`; 53-54 delete company-budget imports; 156 gate; **161 `gate.entitlement.userId`**; 166-169 `resolveProvider(override)`; **202-204** delete the quota catch; `lib/papers/paragraph-guide.ts:34,73` drop `QuotaSignal`.
(Neither route's prompt/cache/verification logic changes.)

`api/papers/report/route.ts` (PR tip): 22-23 imports; 26-30 drop `consumeDeepReport`, `companyBudgetQuotaSignal`, `CompanySpendCapRefusedError`; `ReportUsageCtx.entitlement` and `providerCtx` (≈250-265) -> plain `override`; **277** and **726** `resolveProvider(override)`; **324-326** quota catch; **680-683** gate/ctx; **702-729** keep the PR's "resolve first, then maybe charge" restructure but delete the `quotaDecision`/`consumeDeepReport` charge (729) and pass `resolved` straight to `streamReport`; delete quota stream events.
`lib/papers/report.ts:19,157`. `reader/use-model-report.ts:19,166,173,223-224,404-436` (quota state, `aiAvailability(profile, entitlementGrants(...))`) -> new `aiAvailability(profile, auth)`. `papers/[id]/page.tsx:46-47,85,749-751,1335-1336`: delete `<QuotaNotice>`, the `entitlement` selector, the imports; **delete `reader/quota-notice.tsx` and `quota-notice.test.tsx`**; `use-paragraph-guide.ts:7-8` (comment).
`api/figure/route.ts` (PR tip 22, 68, 83): `requireAiRequest("figure", 60)`; `ctx` removed per Q3; keep the PR's POST variant and `answer()`.
`api/papers/upload/route.ts` (PR tip): the PR edits comment lines at the same hunk as `modelTitleFallback` that (a) deletes - take the deletion.
`reader/decision-block.tsx` (PR touches it; `UPGRADE_HREF` at 10, 125) -> add-key constant.
`privacy/page.tsx` and `privacy/page.test.tsx` (PR adds sections "Your questions" and "Explain this" with every word pinned): edit **"...the model provider you or the owner configured — Google's Gemini when Peer's own model answers, and the provider whose key you set when you use your own."** (drop the Gemini clause), **"Third, a count of your explanations for the day against your account, which is what the daily allowance is measured by..."** (delete if explain-quota goes), and **"The usage row that each model call writes, described under 'What is recorded about model use'..."** (reword or delete per scope). The PR's own sentence "the key goes with it" stays true.
`profile/page.tsx`: PR hunk at 2113-2118 ("With it on, Peer also writes a one-line gist...") sits next to the lines (a) rewrites (2121-2130): trivial rebase.
Tests: `explain/route.gate.test.ts` (19 refs: it tests charges, day cap and house ceiling across readers - rewrite to the sign-in gate and per-hour limit only), `explain/route.test.ts` (8), `paragraph-guide/route.gate.test.ts` (10), `paragraph-guide/route.test.ts` (16), `usage/explain-quota.test.ts` (44 refs, 339 lines; delete), `reader/use-model-report.quota.test.ts` (21; delete), `reader/use-model-report.effects.test.ts` (3), `reader/quota-notice.test.tsx` (21; delete), `reader/explain-box.search.test.tsx` (17), `reader/route-tint.test.tsx` (7), `reader/for-your-questions.test.tsx` (2), `papers/[id]/page.paragraph-guide.test.ts` (1), `api/figure/route.test.ts`, `api/papers/report/route.test.ts` (19), `figures/extract.test.ts`, `llm/providers/metered.test.ts` (34), `registry.test.ts` (10), `gemini.test.ts` (1), `security/spend-scans.test.ts` (PR changes scan 5's expected count to 8 routes and names the explain and paragraph-guide routes: update the list, the number follows the new scan).
PR changes that are unaffected: `supportsWebSearch`/`webSearch` on `DigestProvider` (`llm/providers/types.ts`) and Gemini grounding - still valid on a reader's own Gemini key.

### 7.2 After scope (b) merges, additionally

* `llm/providers/metered.ts` (PR adds the `supportsWebSearch` copy at lines 217-224): the file is deleted; **the PR's hunk and `metered.test.ts` additions must be dropped**, and `supportsWebSearch` must be set directly on the two Gemini provider objects (it already is: the wrapper only copied it).
* `usage/deep-report-quota.ts` (PR changes 8 doc-comment lines): modify/delete conflict, take the delete (already gone in (a)).
* `usage/explain-quota.ts` imports `./events` (`recordUsageEventAwaited`) and `logStoreUnavailable` from `counters` - both removed; a surviving per-reader cap would need a plain `console.error` and no usage row.
* privacy: the two sentences about "the usage row that each model call writes" (PR "Explain this", third paragraph) must go together with the section they cite.
* Routes drop any residual `company-budget` import (already removed in (a) if you follow the order above).
* No new changes to `counters.ts` consumers: PR tests that use `getCounterStore` / `resetCounterStoreForTests` (`explain/route.gate.test.ts`) keep working because the store stays.

---------------------------------------------------------------------------------------------------

## 8. Testing afterwards

* **Developer with no company key:** (1) run `next dev`, open /profile (or /welcome step AI), pick a provider, paste your own key; it is held in browser storage and sent as `llmOverride` on each AI request. (2) Or export a provider env key locally and set `PEER_DIGEST_PROVIDER=<id>` - `canUseLocalServerProvider()` = `isLocalDevRuntime()` (`NODE_ENV=development`, no `VERCEL`/`VERCEL_ENV`, `lib/env/local-dev.ts:21-27`); refused by the build guard on Vercel and by runtime. (3) With no Supabase configured, `requireAiRequest` lets a local caller through as `user: null` (`ai-request.ts:101-125`), so route work needs no sign-in.
* **`PEER_DEV_ENTITLEMENT`'s role today:** local-dev only (`resolve.ts:197-212`, behind `isLocalDevRuntime()`): sets the synthetic `dev-local` user's plan to free/trial/paid so a developer could exercise plan branches (default `free`: "Under D1 a free user still gets the system LLM, so the day-to-day developer loop is unchanged"). It does not survive: no plans, no variable; its ban in the build guard goes with it (a variable nothing reads cannot be a risk).
* **`web/.env.example` after (a):** `UNPAYWALL_EMAIL`, `OPENALEX_EMAIL`, `OPENALEX_API_KEY`, `PEER_CHANNEL_OPENALEX_SEMANTIC`, `PEER_CHANNEL_OPENALEX_TOPIC`, `PEER_CHANNEL_S2_RECOMMENDATIONS`, `PEER_CHANNEL_OPENALEX_SEED_SIMILARITY`, `PEER_CHANNEL_POSITIVE_SEED_CITATIONS`, `PEER_RANK_FUSION`, `PYTHON_BIN`, `PEER_UPLOADS_ENABLED`, `PEER_UPLOAD_BUCKET`, `PEER_PRIVATE_UPLOAD_DIR`, `CRON_SECRET`, `PEER_DASHBOARD_LEDGER`, `PEER_DIGEST_DEDUPE`, `PEER_DASHBOARD_PREPARE`, `PEER_DIGEST_EMAIL_RETRY`, the Jev group (`JEV_API_KEY`, `PEER_JEV_TRANSPORT`, `PEER_JEV_BROKER`, `PEER_JEV_SHADOW`, `PEER_JEV_BROKER_URL`, `PEER_JEV_BROKER_SECRET`, `PEER_JEV_PER_USER_DAILY_CAP`, `PEER_JEV_GLOBAL_DAILY_CAP`, `PEER_JEV_GEMINI_FALLBACK`, `PEER_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP`, `PEER_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP`), `RESEND_API_KEY`, `DIGEST_FROM_EMAIL`, `DIGEST_EMAIL_CONFIRM_SECRET`, `PEER_COMPANY_SPEND_CAP`. **Removed in (a):** `PEER_ENTITLEMENT_MODE`. **Removed in (b):** `PEER_COMPANY_SPEND_CAP` (lines 308-324). **Removed in option C:** the whole Jev group. (The file never listed `GOOGLE_API_KEY`, the Supabase URL/keys or `ADMIN_TOKEN`; consider adding the Supabase names, they are what the guard requires.)
* **What the unit tests use:** counting stubs and mocks only. `vitest.setup.ts:32-41,110-115` deletes `GOOGLE_API_KEY` and `TAVILY_API_KEY` from `process.env` at import and before every test, and strips `SEMANTIC_SCHOLAR_API_KEY`/`OPENALEX_*` and `JEV_API_KEY` unless the matching opt-in variable is `1` (`PEER_RUN_LIVE_CHANNELS_EVAL`, `PEER_RUN_JEV_SMOKE`). Route suites `vi.mock("@/lib/llm/providers/registry")` or run with no key so `resolveProvider` returns null (`api/figure/route.test.ts:15-26,112-123`: `recordingFetch` asserts no URL matches googleapis/openai/anthropic/deepseek/dashscope; `ai-route-personas.test.ts:62-67`); counters use `InMemoryCounterStore` or a stubbed admin client (`from` and `rpc` both stubbed, `ai-route-personas.test.ts:37-50`); `test-support/env-isolation.test.ts` proves the allow-lists. **I found no real model call in any default test.** The only real-network tests are opt-in and skip themselves in the default run: `evaluation/jev-smoke/jev-smoke.test.ts:24` (`describe.skipIf(!canRun)`, config `vitest.jev-smoke.config.ts`), `evaluation/live-channels/live-channels.test.ts:28`, `events/benchmark.test.ts:121`. After this plan, `GOOGLE_API_KEY` in `vitest.setup.ts` is no longer a spendable key, but keep it stripped (cheap, and it stops a stray developer export from resolving anything).
* **Add tests:** `resolveProvider(null)` returns null with a stubbed dummy `GOOGLE_API_KEY` in the environment (the key is now ignored on every runtime); signed-out + key -> `aiAvailability` `"none"`; build guard exits 1 when `GOOGLE_API_KEY` is set on a Vercel env and prints its *name*, never its value (the existing sentinel test at `assert-byok-production-env.test.ts` already does this for the other names).

---------------------------------------------------------------------------------------------------

## 9. Risks, ranked

1. **Deploy and behaviour change land together (high certainty, high impact).** The guard turns `GOOGLE_API_KEY` from "warn if missing" to "fail the build if present"; the Vercel project almost certainly still has it, so the first build after merge fails until it is removed. And on the first deploy that works, every signed-in reader without a key loses AI at once (ranking tier 2, relevance reasons, reports, digest bullets, figure choice, upload titles). Mitigate: remove the env var first, changelog entry, copy that says what to do, owner sign-off on Q3.
2. **`usage_counters` / `counters.ts` look deletable and are not.** Deleting them silently turns rate limits off (fail-open) and the Resend caps on `send-test-email`/`confirm-email` fail *closed* (every test email 429s), kills the source-retry claims that throttle arXiv/OpenAlex/Crossref/S2 retries, the refresh cooldown, and the Jev caps on the edge function. Keep the store and the RPC; delete budget keys only.
3. **Client identity coupling.** `entitlement.userId` is the owner namespace of the local delivery ledger (`store/feed.ts:558`) and the signed-in test for AI/wizard. Replacing it with `authUserId` changes *when* the owner is known (earlier, which is the safe direction per the comments at 560-600) but a wrong swap re-delivers papers already shown, which the product forbids. Gate: the owner-key tests in `store/feed.test.ts` unchanged.
4. **PR #32 collision (certain).** 37 PR files use removed symbols; 19 files are edited by both; the branch is still moving (another worker is committing, and the main checkout has uncommitted edits in the same privacy/profile/reader files). The PR's explain allowance is itself a company budget and is *new* quota code (`explain-quota.ts`, `QuotaNotice`, `QUOTA.*` copy); merging it first and removing it second wastes the work, merging this first lets it be rewritten once. Section 7 is the exact list.
5. **Company key remains through Jev and operator search unless Q1 is answered.** `JEV_API_KEY` + `PEER_JEV_SHADOW=on` still spends the company's key on a reader's shortlist; `feed/route.ts:798` also derives `entitled` from the plan being deleted, so it must be touched either way.
6. **Features that only ever worked on the company key** (figure choice, upload title) silently become no-ops if their call sites are left in place returning `null`; delete them explicitly so no dead path pretends to be AI.
7. **Migration pinning.** `upstream-migrations.test.ts` fails on any clone lacking `origin/freemium-round10` and pins three files byte-for-byte; `rollback-parity.test.ts` fails on a stray rollback for a non-`2026092*` migration. Edit neither migration; add one; trim the test.
8. **Production DB facts not verifiable from the repo:** whether `company_spend_budget` was ever applied, how many `plan='paid'` rows exist, whether `usage_events` holds data worth keeping. Check before applying (5.5).
9. **Copy gates.** `ui-vocabulary.test.ts` bans "Tier 0/1/2" and "BYOK" in rendered strings, so the BYOK-era sentences cannot be restored verbatim; `/privacy` is "written from the code", so it must change in the same commit as the behaviour (and today's "Every call Peer pays for writes one row" is already wrong, BYOK calls write rows too).
10. **Signed-out + key inconsistency** (chip says AI on, server answers tier 0) is fixed as a side effect of N2 but is a visible change to a small group.

---------------------------------------------------------------------------------------------------

## Appendix - file lists with sizes (origin/main)

Deleted whole, A: `lib/entitlement/{types,resolve,allowance,plan-copy}.ts` (110+256+192+84), `components/plan/pro-plan-summary.tsx`, `lib/navigation/upgrade-destination.ts`, `migrations/20260904000200_profile_plan.sql` (kept as history, not deleted), tests `resolve`, `allowance`, `pro-plan-summary`, `upgrade-destination`.
Deleted whole, B: `security/entitled-context.ts` (180), `security/company-spend.ts` (52), `usage/company-budget.ts` (610), `usage/deep-report-quota.ts` (365), `usage/rebuild-breaker.ts` (124), `usage/events.ts` (103), `usage/context.ts` (59), `llm/providers/metered.ts` (236), `llm/client.ts` (13), migrations `20260904000100`, `20260925000000`, rollback `20260925000000`; tests `entitled-context`, `company-spend`, `company-budget` (594), `deep-report-quota` (557), `quota-exemptions`, `events`, `context`, `metered`, `test-digest/route.entitlement`.
Jev set (Q1): `lib/decisions/{broker-client,combine,decision-cache,flag,gemini-fallback,jev-client,jev-contract,jev-direct-client,jev-dispatch,paper-content-hash,private-decision-cache,rubric,shadow,types}.ts`, `security/jev-broker-auth.ts`, `supabase/functions/jev-broker/{counter-keys,index,jev-client,jev-contract,rubric,types}.ts`, `evaluation/jev-smoke/{gate,inputs,runner}.ts`, `vitest.jev-smoke.config.ts`, 2 JSON fixtures, 19 tests.
