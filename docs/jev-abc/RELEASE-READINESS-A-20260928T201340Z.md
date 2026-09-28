# Release readiness review — A — 2026-09-28T20:13:40Z

**Status: COMPLETE**

Independent, read-only release-readiness review of branch
`Jev-integration-and-sorting-filtering-enhancement` (17 commits ahead of
`origin/main` @ 72a013bc, 0 behind, not pushed) ahead of merge into `main`
(auto-deploys https://peer.homes on Vercel for all users, sharing one
Supabase project with local dev). Authorized by `ABC-JEV-INTEGRATION.md`
§1ar (the user's go-live decision).

Method: read `docs/JEV-RELEASE-READINESS.md` (current through R4-DOCS,
2026-09-25 — stale for Round-4-continued work done 2026-09-26 through
2026-09-28) and `ABC-JEV-INTEGRATION.md` §1 rulings through §1ar (the most
current source), then independently verified the specific claims that
matter for production-with-a-real-database by reading the committed source
directly (not by trusting either document's prose). `gh` CLI is not
installed in this environment — GitHub Actions secrets/variables could not
be listed; noted wherever that matters.

---

## 1. Migrations

Eight migration files exist on this branch that are not on `origin/main`
(`git diff --name-status origin/main...HEAD -- web/supabase/migrations`),
each with a matching rollback file in `web/supabase/rollback/` (mechanically
enforced by `web/src/lib/release/rollback-parity.test.ts`). **Only one has
been applied to the real Supabase database** (per the manager's brief):
`20260922010000_profile_feed_intent.sql` (the `feed_intent` column + two
grants, applied by hand).

| Migration | Creates | Touched with ALL `PEER_*` flags OFF? | What happens if the table/column doesn't exist |
|---|---|---|---|
| `20260922000000_private_paper_pools.sql` | `private_paper_pools` (per-owner paper-pool cache, RLS by `owner_id`) | **YES — always, unconditionally, on every feed request for every signed-in reader.** Not behind any flag. | **Verified by reading the code, not the docs.** `web/src/lib/opportunities/private-paper-cache.ts`: `PrivatePaperPoolCache.get()` (lines 134–156) and `.set()` (158–173) each wrap their one Supabase call in a bare `try { … } catch { return null / return; }`. Any error — including Postgres "relation does not exist" — is treated as a cache miss (read) or silently swallowed (write); line 171's own comment says so: `// A private-cache outage falls through to a request-local fresh build.` **User-visible effect: none.** The feed still builds and serves correctly; it just can't persist the per-owner cache between requests, so every visit recomputes the pool from scratch (slower, more CPU/source-API calls per request, no error surfaced to the reader). This is the one migration where "unapplied" has a real, continuous cost after merge, not just a latent risk. |
| `20260922010000_profile_feed_intent.sql` | `profiles.feed_intent` (nullable jsonb) + column grants | Yes, always (profile save path) | **Already applied.** Also has its own fallback regardless: `web/src/app/api/profile/route.ts` line 346, `isMissingFeedIntentColumn(error)` → `delete row.feed_intent` and retries the upsert, so even a not-yet-applied state degrades to "that one field doesn't save" rather than blocking the whole profile save (this is what caused the 409s described in `ABC-JEV-INTEGRATION.md` §1ah before the user applied it). |
| `20260924000000_dashboard_delivery_ledger.sql` | `dashboard_deliveries`, `dashboard_batches` | **No.** Verified: every constructor of `SupabaseDashboardDeliveryLedger` in `web/src/app/api/feed/route.ts:261`, `web/src/app/api/feed/ack/route.ts:86`, `web/src/app/api/feed/archive/route.ts:141`, and `web/src/app/api/jobs/prepare-dashboards/route.ts:423` sits strictly after an `if (!dashboardLedgerEnabled()) return …` guard (or equivalent) in the same function. `PEER_DASHBOARD_LEDGER` defaults off. | N/A while off — table is never queried. |
| `20260924000300_briefing_deliveries_dedupe.sql` | Adds a column to the pre-existing, already-live `briefing_deliveries` table | **No.** `isDigestDedupeEnabled()` guards the only read/write site, `web/src/app/api/jobs/dispatch-digests/route.ts:360`. `PEER_DIGEST_DEDUPE` defaults off. | N/A while off. Note: `briefing_deliveries` itself already exists in production (it's what `GET /api/briefings` — "Past briefings" — reads today); this migration only adds a column to it. |
| `20260924000400_private_decisions.sql` | `private_decisions` (Jev shadow decision cache) | **No.** `PrivateDecisionCache` is only constructed inside `runJevShadowSafely`, which is only wired up as `onFreshShortlist` inside the `if (jevShadowEnabled() && jevTransport !== "disabled" && … )` block, `web/src/app/api/feed/route.ts:771-780`. `PEER_JEV_SHADOW` defaults off. | N/A while off. |
| `20260924000500_dashboard_rollover.sql` | rollover-pool tracking table | **No** — same `dashboardLedgerEnabled()`/`dashboardPrepareEnabled()` gate family. | N/A while off. |
| `20260924000600_dashboard_prepare_jobs.sql` | `dashboard_prepare_jobs` (job queue) | **No.** `createPrepareAheadBuildPool` (which touches this table) is called only from `web/src/app/api/jobs/prepare-dashboards/route.ts`, itself gated by `dashboardPrepareEnabled()` (line 347), which hard-depends on `PEER_DASHBOARD_LEDGER` also being on. No other caller exists in `web/src` (checked by grep). | N/A while off. |
| `20260925000000_company_spend_budget.sql` | `company_spend_caps`, `company_model_prices` | **No.** `companySpendCapEnabled()` self-gates inside `web/src/lib/usage/company-budget.ts` itself — off means "no config read, no counter call at all," protected by its own test (`metered.test.ts`). `PEER_COMPANY_SPEND_CAP` defaults off. | N/A while off. |

**Bottom line for section 1:** with every `PEER_*` flag left at its default
(off), merging this branch is safe for 7 of the 8 new tables — they are
never queried. The 8th, `private_paper_pools`, is queried on every request
regardless of flags, but degrades gracefully to "no persistent cache" with
zero user-visible error — confirmed by reading the exact catch blocks, not
inferred. Applying that one migration before merge (or promptly after)
removes a real, ongoing cost (repeated full pool rebuilds) but is not a
correctness requirement.

---

## 2. Always-on changes vs origin/main (not behind a flag)

`git diff --stat origin/main...HEAD -- web/src`: 263 files changed, +56704/
−689 lines (large because it also carries the merge of `origin/main`'s own
Round-4+ work and ~120 new checkpoint docs under `docs/jev-abc/`, not just
this campaign's own diff). User-visible, always-on behavior changes:

| Change | Behind a flag? | Risk (one line) |
|---|---|---|
| **Required-topic rule** — a paper now qualifies if it means the same thing as a Required tag, not only if the exact phrase appears (`web/src/lib/scoring/combine.ts`, `keyword.ts`; commit `61aed451`, independently VERIFIED, `docs/jev-abc/REQUIRED-GATE-A-20260928T171334Z.md`) | **No — always on after merge, for every reader with a Required topic set.** | Changes what papers every existing user sees starting the moment this deploys. T4 (similarity-only admission) uses TF-IDF cosine (`scoreTfidf`, reused, no model call) — confirmed no new AI cost. Offline-measured on real papers (test project P1: 4/27 baseline → 17/27 ≈63% under the final anchored rule; P2: 56/62 → 57/62); never measured against this branch's actual production traffic. |
| Paper-pool cache version bump 6→7 (same commit, forces every existing cached pool to rebuild once) | No — same commit | One-time cost blip right after merge: every reader's next visit is a full rebuild instead of a cache hit. Self-heals after one visit per reader. |
| **Browser-tab icon follows the light/dark colour setting** (commit `6849e9cc`, VERIFIED `TAB-ICON-THEME-A3`) | No | Cosmetic only. One caveat: the OS-level theme-change repaint while Peer's tab is in the background was hardened but could not be verified against a real OS event in this tool (BLOCKED-by-tool, not a failure) — reload/navigation/focus-return repaints are all verified. |
| **Daily-email settings section, address confirmation, "Send test email"** (commit `2563bcaf` + polish commits `e605dc24`, `5f3e6721`) | Per-reader opt-in switch, not a build flag — but the UI and API routes are live for everyone the moment this merges | Nobody is opted in by default (`digest_channel` defaults unchanged); a reader must visit Profile and flip their own switch. Send-side needs `RESEND_API_KEY`/`DIGEST_FROM_EMAIL` correctly configured or it fails honestly (see §3). |
| **Sign-in now merges local + account data instead of one silently overwriting the other; "Restore from a backup file" control** (commit `4191bdb1`, VERIFIED_OFFLINE_BOUNDED `SIGNIN-MERGE-A`) | No | Fixes real data loss (§1ah/§1af). Verified offline only — no proof yet against a real two-account, real-network sign-in. |
| **Google sign-in button** (commit `4a90b4a9`, VERIFIED_OFFLINE_BOUNDED `GOOGLE-SIGNIN-A`) | Button always renders; functionally inert until Supabase Auth's Google provider is configured (see §5e) | Same-email accounts merge automatically via Supabase's built-in identity linking; different-email accounts silently create a second, separate account (documented limit, not a bug). |
| **Sign-out warns before discarding unsynced changes; feed writes that failed are now tracked per-item so the warning fires reliably** (commits `5f3e6721`, `b068dd47`, VERIFIED `POLISH-1-SYNC-A`, `FEED-SYNC-FLAG-A2`) | No | Was previously a real silent-data-loss bug; now fixed and independently verified offline. |
| **Jev called directly from the Next server** (`JEV_API_KEY` read in `web/src/lib/decisions/jev-direct-client.ts`) instead of only via the Supabase Edge broker (commit `0107eaa3`) | Yes — inert unless `PEER_JEV_SHADOW=on` too, which stays off | No behavior change while `PEER_JEV_SHADOW` is off; setting `JEV_API_KEY` alone in Vercel does not cause any spending (confirmed: the only caller is gated behind `jevShadowEnabled()`, §1 above). |
| Company AI spend cap machinery (commit `94f7b293`) | Yes — `PEER_COMPANY_SPEND_CAP` off | No effect until explicitly turned on (§5g). |
| "Your reading" home-page layout fix (`16497e85`) | No | Cosmetic/layout only, independently verified. |

**Server-cost changes:** none of the always-on changes above add a new
outbound API or model call on the default hot path — Required-gate's T4 is
lexical/statistical (TF-IDF), not a model call, and everything that does add
real calls (Jev direct, the 5 new retrieval channels, RRF, Gemini fallback)
stays behind its own off-by-default flag. The one real new cost is the pool
cache version bump's one-time rebuild wave, and, until the
`private_paper_pools` migration is applied, the ongoing no-cache overhead
from §1.

**Pending review, not evaluated here (per the manager's brief):**
uncommitted changes in `web/src/lib/scoring/combine.ts`, `keyword.ts`,
`web/src/lib/opportunities/pool-cache.ts`/`pool-cache.test.ts`,
`web/src/lib/scoring/required-gate.test.ts`, and three new
`SENSE-CONTEXT-*` docs are SENSE-CONTEXT's in-flight work (bumps
`PAPER_CACHE_KEY_VERSION` 7→8 in the working tree; **7 is what's actually
committed and would ship today**). A parallel A is reviewing it. Since it
is uncommitted, it is not part of what this branch would push/merge unless
committed first.

---

## 3. Env/secret requirements for production

Cross-checked against `web/scripts/assert-byok-production-env.mjs` (the
Vercel build guard) and `web/.env.example`.

**Guard behavior today:** `REQUIRED_ON_VERCEL` = `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` (both already set, per the manager's brief — build
will not fail on this). `EXPECTED_ON_VERCEL` = `GOOGLE_API_KEY` only (not yet
set → build **warns**, does not fail; Tier 0 still ships). `FORBIDDEN_ON_VERCEL`
= 12 operator-funded AI provider keys + `GOOGLE_VERTEX_*` prefix +
`BRAVE_SEARCH_API_KEY` + `TAVILY_API_KEY` + `PEER_DEV_ENTITLEMENT`, plus any
`PEER_FEED_AI_TIER > 0` — **none of the names the user listed as already-set
or just-added are on this list**, so none of them would fail the build.

| Name | Needed by | Status per the manager's brief | Note |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | everything | Set (friend, Apr 25) | REQUIRED — build fails without these. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or similarly named) | client-side Supabase | Set (friend, Apr 25) | Not read by the guard script but needed by `web/src/lib/supabase/client.ts` for any signed-in feature to work at all. |
| `CRON_SECRET` | both GitHub Actions cron jobs (`dispatch`, new `prepare`) | Set in Vercel (friend, Apr 25) | **Must also exist as a GitHub Actions repo secret of the same name/value** — a separate store. Could not verify via `gh secret list` (CLI not installed here); see §4. |
| `RESEND_API_KEY` | daily-email send path | Set (friend, Apr 25 — **before** `mail.peer.homes` was verified) | **Required user check before relying on email** (§1ar point f, binding): if this key belongs to a different Resend account than the one that just verified `mail.peer.homes`, sends fail even though everything else is configured correctly. The failure is honest (§1al POLISH-1-EMAIL: distinct `sender_not_verified` vs `send_failed` messages), not silent — but should be fixed before the user or any tester relies on it. |
| `OPENALEX_API_KEY`, `OPENALEX_EMAIL`, `SEMANTIC_SCHOLAR_API_KEY` | source channels, all currently gated off except plain keyword search which works keyless | Just added | Correct names, confirmed by grep (`web/src/lib/sources/semantic-scholar-client.ts`, `openalex*.ts`). Not on the forbidden list. |
| `JEV_API_KEY` | direct Jev calls | Just added | Read only in `jev-direct-client.ts`; inert while `PEER_JEV_SHADOW` is off (§2). Allowed and silent per the guard (never required, never warned). |
| `DIGEST_FROM_EMAIL` | daily-email From address | Just added, on verified `mail.peer.homes` | Good — this is the half of the email setup the user already got right. |
| `DIGEST_EMAIL_CONFIRM_SECRET` | confirming a non-account email address for the daily brief | Just added | Unset would only disable confirming a *different* address; the account's own address would still work either way. |
| `NEXT_PUBLIC_SITE_URL` | absolute links in emails (`web/src/lib/site.ts`, `dispatch-digests`, `confirm-email`, `send-test-email`, `test-digest` routes) | Just added, = `https://peer.homes` | Correct — confirmed by reading every call site. Not yet documented in `.env.example` (pre-existing gap, cosmetic). |
| `GOOGLE_API_KEY` | Tier 1/2 company-funded model, and a prerequisite for ever turning on `PEER_COMPANY_SPEND_CAP` | **Not set** | Build only warns, does not fail — Tier 0 (no-model) ships fine without it. Everyone gets Tier-0 briefings until this is set. |
| `PEER_COMPANY_SPEND_CAP` and all other `PEER_*` flags | every new feature in this campaign | **Not set (default off)** | Correct for merge — every flag-gated feature stays off, matching `ABC-JEV-INTEGRATION.md` §1ar(c). |

No name the user listed as set or just-added would trip `FORBIDDEN_ON_VERCEL`
or the `PEER_FEED_AI_TIER>0` build-failure condition. One non-blocking
hygiene item: the five friend-added variables show Vercel's "Needs
Attention" hint (§1ar(2)) — meaning they weren't stored with the "Sensitive"
flag. Worth fixing for values that are real secrets (`SUPABASE_SERVICE_ROLE_KEY`,
`RESEND_API_KEY`) but does not block a successful build or a working site.

---

## 4. Scheduled jobs

`.github/workflows/digest-cron.yml` (only workflow changed on this branch;
`warm-pool.yml` is untouched). Diff: one new job, `prepare`, added alongside
the existing `dispatch` job; both share the same `on: schedule: "5 * * * *"`
(hourly) / `workflow_dispatch` triggers. **Confirmed unchanged:** the
existing `dispatch` job's own trigger, steps, and endpoint.

| Job | Runs | Calls | Reads | What happens today if merged as-is |
|---|---|---|---|---|
| `dispatch` (pre-existing, unchanged) | Hourly | `GET https://hermes-flax-six.vercel.app/api/jobs/dispatch-digests` | `secrets.CRON_SECRET` | Unchanged — already running in production today, per the release doc. |
| `prepare` (new) | Hourly, same schedule | `GET https://hermes-flax-six.vercel.app/api/jobs/prepare-dashboards` | `secrets.CRON_SECRET` | **No behavior change until this workflow file itself is pushed/merged to `main`** (GitHub Actions only runs the version of the workflow file that's on the branch it's configured against) **AND** `PEER_DASHBOARD_PREPARE` + `PEER_DASHBOARD_LEDGER` are both set to `"on"` in Vercel. Until then: the job runs every hour, calls a route that returns a truthful no-op (`"ledger_disabled"`) because the flags are off, and exits 0. Not a failing run, not a 404, not a silent gap — an honest no-op, confirmed by reading `web/src/app/api/jobs/prepare-dashboards/route.ts`'s own gate order. |

**Note on the endpoint domain:** both jobs call `hermes-flax-six.vercel.app`,
not `peer.homes`. This is the **existing, unchanged convention** — the same
domain the live `dispatch` job already uses today, presumably a Vercel-assigned
alias for the same production deployment `peer.homes` fronts (consistent with
`AGENTS.md`'s own source-of-truth link using a `hermes-admin` domain). Not a
defect introduced by this branch, but worth one confirmation: that this alias
still resolves to the same production deployment after merge (see smoke test
§7).

**GitHub secrets/variables:** `gh` CLI is not installed in this review
environment, so `gh secret list` / `gh variable list` could not be run.
**This is unverified, not confirmed-fine.** Since the existing `dispatch` job
is already live and (per the release doc) already running hourly against
production without reported failures, `CRON_SECRET` almost certainly already
exists as a GitHub Actions repo secret with a value matching Vercel's — but
this review could not independently confirm the name list. Recommend the
user or manager check GitHub → repo Settings → Secrets and variables →
Actions once, by hand, before or shortly after merge.

---

## 5. Per-feature verdicts

| Feature | Verdict | Why |
|---|---|---|
| (a) Browser-tab icon follows colour setting | **READY** | Committed, independently VERIFIED (`TAB-ICON-THEME-A3`, DONE). One non-blocking caveat: real OS-theme-change-while-backgrounded repaint is BLOCKED-by-tool (hardened + unit-tested, not exercised against a real OS event); an optional 20-second manual check in the user's own browser was suggested, never required. |
| (b) Daily email end-to-end (another user signs in → own work address → Confirm → email from verified domain → link → daily send at chosen hour; Send test email) | **READY AFTER 1 user step**: confirm/replace `RESEND_API_KEY` in Vercel so it belongs to the Resend account that verified `mail.peer.homes` (§3; binding per `ABC-JEV-INTEGRATION.md` §1ar(f)) | Code is committed and independently verified (`EMAIL-SETTINGS`, `POLISH-1-EMAIL-A` DONE/VERIFIED). `DIGEST_FROM_EMAIL`/`NEXT_PUBLIC_SITE_URL`/`DIGEST_EMAIL_CONFIRM_SECRET` are already correctly set. The scheduled send itself additionally needs `PEER_DASHBOARD_PREPARE`-independent — the *existing* hourly `dispatch` job (unchanged, already live) is what actually sends; no new flag needed for a reader who has switched their own delivery channel to email. Known, accepted, non-blocking limit: the once-per-day guarantee is "soft" (a 6-hour look-back, not atomic) unless `PEER_DIGEST_DEDUPE` is later turned on after its migration is applied — fine under the real hourly-only schedule. |
| (c) Settings save / sign-out warning / feed pending-write tracking | **READY** | All three committed, independently verified offline (`POLISH-1-SYNC-A`, `FEED-SYNC-FLAG-A2`, both VERIFIED). Fixes real pre-existing data-loss bugs. Not yet proven against a real concurrent multi-tab session against production Supabase (same "offline-only" caveat as everything else in this campaign). |
| (d) Required-topic rule (qualify by meaning) | **READY** | Committed (`61aed451`), independently VERIFIED (`REQUIRED-GATE-A`, COMPLETE). Always-on, no flag (§2) — this changes ranking for every existing user immediately at merge, by design per the user's own ruling (§1an). Pool-cache version bump (6→7) is part of the same commit; causes a one-time full-rebuild wave, self-heals. No Supabase table dependency beyond the always-on, gracefully-degrading `private_paper_pools` cache (§1). SENSE-CONTEXT's further refinement (version 7→8) is uncommitted and under separate parallel review — not part of what ships if merged now. |
| (e) Google sign-in | **READY AFTER user completes the documented one-time setup** (no code gap) | Code committed (`4a90b4a9`), independently VERIFIED (`GOOGLE-SIGNIN-A`, 8/8 checks PASS). Required before the button works for anyone: (1) in Google Cloud Console, create an OAuth consent screen + OAuth client with Authorized redirect URI set to Supabase's own callback — **`https://<the-project's-ref>.supabase.co/auth/v1/callback`, not a `peer.homes` URL**; (2) in Supabase dashboard → Authentication → Providers, enable Google and paste that Client ID/Secret; (3) confirm Supabase's Redirect URLs allow-list already includes `https://peer.homes/auth/callback` (Peer's own callback route is provider-agnostic, confirmed by reading `web/src/app/auth/callback/route.ts`). No Vercel env var needed. Same-email accounts merge automatically via Supabase's built-in identity linking (verified against live Supabase docs, not memory); a GitHub and Google account with *different* emails will create two separate Peer accounts — documented limitation, not a bug, no merge-after-the-fact UI exists yet. |
| (f) Sign-in data merge + Restore from backup | **READY** | Committed (`4191bdb1`), independently VERIFIED_OFFLINE_BOUNDED (`SIGNIN-MERGE-A`). Fixes a real prior data-loss bug (§1af/§1ah). Verified offline only — no live two-account, real-network proof exists yet (same caveat as the whole campaign); low risk given the fail-safe "never overwrite non-empty local with empty remote" design. |
| (g) Company AI spend cap | **NOT READY — by design, multi-step, last in the queue** | Code committed (`94f7b293`), independently VERIFIED_OFFLINE_BOUNDED (`SPEND-CAP-A`, 13/13 checks). Activation order (binding, §1ar(e)): (1) apply `20260925000000_company_spend_budget.sql` in the Supabase SQL Editor (not yet done); (2) enter `company_model_prices` rows by hand for the 4 reachable Gemini model ids (mandatory — no code-level default; the mechanism fails closed with zero rows) — `company_spend_caps` rows are optional, code defaults are $5.00/day global and $0.50/day per-user, already confirmed by the user on 2026-09-27; (3) set `GOOGLE_API_KEY` in Vercel (not yet set — nothing in this chain works without it); (4) set `PEER_COMPANY_SPEND_CAP=on`. Never proven against a real database (this campaign has none) — offline-only mutation testing only. The user's own Gemini billing being prepaid is a reasonable second, independent safety net on top of this. |

---

## 6. Risks of merging the whole branch

The branch also carries all of Rounds 1–4's Jev-integration work (hybrid
retrieval/RRF, 5 retrieval channels, Jev shadow/broker/direct, evaluation
harnesses) — all confirmed off by default and gated (§1/§2 above; full
detail in `docs/JEV-RELEASE-READINESS.md` §1/§6, current through
2026-09-25).

1. **Nothing in this entire campaign has been verified against a real
   Supabase database, real concurrent traffic, or a live end-to-end browser
   run on the deployed site.** Every "VERIFIED"/"VERIFIED_OFFLINE_BOUNDED"
   label in this report and in the source docs means "independently
   re-checked against code and fixtures," never "proven live." This is the
   single biggest risk category across the whole branch, not specific to
   any one feature.
2. **`private_paper_pools` not yet applied** (§1): safe (graceful degrade,
   confirmed by reading the exact catch blocks) but every signed-in reader's
   feed pays a full rebuild cost on every visit until it's applied. Low risk,
   real ongoing cost.
3. **`RESEND_API_KEY` account mismatch** (§3): if unresolved, daily email
   fails honestly for every user who opts in, silently-to-the-operator (no
   crash, just failed sends) until someone notices. Cheap to fix, easy to
   miss.
4. **Required-topic rule change is unconditional** (§2/§5d): every existing
   signed-in reader's Required-topic filtering changes behavior the moment
   this merges — intentional, user-approved (§1an), offline-measured only
   (no live measurement against this branch's actual users).
5. **CRON_SECRET's presence in GitHub Actions repo secrets is unverified**
   in this review (§4, `gh` CLI unavailable) — if absent or mismatched, both
   the existing `dispatch` job and the new `prepare` job fail every hour
   (loud, `::error::` annotated, not silent) until fixed.
6. **SENSE-CONTEXT is genuinely in flight and uncommitted** — not itself a
   merge risk (uncommitted work doesn't ship), but a scheduling risk: don't
   commit and merge mid-review.
7. Signed-out reading (the product's baseline, no-account experience) was
   not touched by anything reviewed here — no evidence of risk to it, but
   also not specifically re-verified in this pass beyond what `docs/JEV-RELEASE-READINESS.md`
   already established (Tier 0 always ships regardless of any flag or
   missing model key).

**Recommended order of user steps before merge**, combining §3/§4/§5:
1. In Vercel, confirm/replace `RESEND_API_KEY` so it belongs to the Resend
   account that verified `mail.peer.homes` (§3, §5b).
2. In GitHub repo settings, confirm `CRON_SECRET` exists as an Actions
   secret and matches the Vercel value (§4) — this review could not check
   it.
3. Apply `20260922000000_private_paper_pools.sql` in the Supabase SQL
   Editor (removes the only always-on migration gap, §1).
4. Complete the Google Cloud Console + Supabase Auth provider setup for
   Google sign-in (§5e) if the user wants that live at merge time.
5. Push the branch, open the PR (one PR, commits kept unsquashed per
   §1ar(b)), merge.
6. Only after merge, work through the company-spend-cap activation order
   (§5g) at the user's own pace — it is explicitly the last, most
   deliberate step, not a merge blocker.
7. Apply the remaining 6 migrations and flip their flags only when each
   corresponding feature is individually wanted live (all currently safe to
   leave off and unapplied at merge time, per §1).

---

## 7. Smoke-test plan after deploy

**Read-only, signed-out, against https://peer.homes (no sign-in):**
1. Load the home page; confirm it renders a Tier-0 (or Tier-1/2 if
   `GOOGLE_API_KEY` was set) paper list with no error, matching today's
   baseline behavior.
2. Check the browser tab icon in light and dark OS mode; toggle the OS
   theme and reload — icon should match.
3. `curl -I https://peer.homes` and `curl -I https://hermes-flax-six.vercel.app`
   — confirm both resolve to the same live deployment (validates §4's
   domain-alias assumption).
4. Open browser dev tools → Network while loading the home page; confirm no
   request contains a plaintext API key or service-role key in a URL.
5. Confirm `/welcome` and the Required-topics explanation copy read the new
   REQUIRED-GATE wording ("Peer looks for papers about these topics, even
   when they use different words…").

**Signed-in, done by the user (not the manager):**
6. Sign in with an existing account; confirm the profile page loads with
   previously-saved data intact (validates SIGNIN-MERGE didn't regress
   anything for an existing account).
7. Visit Profile → Daily email; enter a work email address, click Confirm,
   check that inbox for the confirmation link, click it, then click "Send
   test email" and confirm delivery (validates §5b end-to-end — do this
   only after the `RESEND_API_KEY` check in step 1 of §6's ordered list).
8. Try Google sign-in once the one-time setup (§5e) is done; confirm it
   lands on the same profile as the existing GitHub account when the two
   emails match.
9. Trigger a sign-out with an intentionally-unsynced local change (e.g.
   airplane-mode a save, then sign out) and confirm the new warning appears
   instead of silently discarding it.

---

## Summary for the manager

7 of 8 new migrations are safe to leave unapplied at merge (never touched
with flags off); the 8th (`private_paper_pools`) is always touched but
degrades gracefully with zero user-visible error, confirmed by reading the
exact error-handling code. All new features stay behind off-by-default
flags except: the Required-topic rule change (always on, user-approved,
§1an), the always-visible-but-inert Google sign-in button, and the
always-visible daily-email settings UI (opt-in per reader). No merge
blocker was found in the code itself. Two real pre-merge action items exist
outside the code: the `RESEND_API_KEY`/Resend-account mismatch risk (§3,
§5b) and the unverified GitHub Actions `CRON_SECRET` (§4, tool limitation
in this review, not a known problem).
