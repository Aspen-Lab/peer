# DIGEST-CATCHUP — Investigator (B) Guide

STATUS: COMPLETE

Role: B (investigator), read-only on the repo. This document is the deliverable;
no product code was created or modified. One scratch script and its fetched
JSON inputs were written under the session scratchpad only (never in the
repo), referred to below as `<scratchpad>/catchup-sim.mjs` and
`<scratchpad>/runs-sep-all-events.json`.

## Progress log

- [x] Read ABC-JEV-INTEGRATION.md §0–§3 (roles, constraints, engineering contract), skimmed §1's current-state block
- [x] Read web/AGENTS.md, docs/PRODUCT_DIRECTION.md
- [x] Task 1: enumerate full path schedule → inbox, every branch, file:line
- [x] Task 2: confirmed the manager's reading by execution (real GitHub API data + a scratch simulation importing the real timezone helpers)
- [x] Task 3: four design options with failure modes/cost/user-decisions, recommendation
- [x] Task 4: tests needed, including a search for any existing test that pins the exact-hour behaviour
- [x] Task 5: POLICY list for the manager

---

## TASK 1 — The entire path, schedule → inbox, every branch

### 1.1 The workflow — `.github/workflows/digest-cron.yml`

- Trigger: `schedule: cron: "5 * * * *"` (line 9) — nominally hourly at :05 past, chosen specifically off the top-of-hour to dodge GitHub's own documented high-load window (comment, lines 5–8). Also `workflow_dispatch` (line 10) — never used by this investigation (constraint).
- Top-level `concurrency: {group: digest-cron, cancel-in-progress: false}` (lines 12–14) applies to the whole workflow run unless a job overrides it.
- **Job `dispatch`** (lines 17–46): 7-minute timeout. Does `curl` with `Authorization: Bearer $CRON_SECRET` to `GET /api/jobs/dispatch-digests` (lines 27–33), logs only a `jq`-filtered counts-only summary of the response (line 41, EMAIL-TOKEN-PRIVACY: this run log is public, so raw per-reader detail must never appear here), and `exit 1` (→ run conclusion "failure") when the HTTP status isn't 200 (lines 43–46). A non-200 doesn't stop the digest loop from having already run inside that one invocation — it just marks the Action run failed.
- **Job `prepare`** (lines 77–109): its own `concurrency: {group: dashboard-prepare-cron}` (lines 80–82) — a *job-level* override, separate from `dispatch`'s group. Calls `GET /api/jobs/prepare-dashboards` the same way. The large comment block above it (lines 48–76) records the team's own understanding of GitHub Actions concurrency here: the two jobs' own groups stop *each job* from piling up against itself, but the workflow-level `digest-cron` group (still in effect for `dispatch`, which has no override) can still serialize whole workflow RUNS across triggers, so a slow `dispatch` run can delay the *next* trigger's `prepare` job from starting. I did not independently re-derive GitHub's concurrency-resolution rules beyond what this comment (already reviewed and merged) asserts; I did independently confirm the observable *symptom* it's meant to explain — see 2.1.
- Both jobs authenticate with the same `CRON_SECRET`; a bad/missing secret is a 401 with zero side effects (confirmed in route code, §1.2).

### 1.2 `web/src/app/api/jobs/dispatch-digests/route.ts` — full walk

1. **Auth** (lines 303–309): `Authorization: Bearer $CRON_SECRET` or 401. First thing done, before any DB call.
2. **Profile pre-filter** (lines 316–322): `SELECT ... FROM profiles WHERE digest_enabled = true AND digest_frequency <> 'off'`. This is a cost optimization only — it does not know about hour or timezone; every per-reader decision below runs once per matching row.
3. **Per-row loop** (line 336 onward):
   a. **Exact-hour gate** (lines 337–341): `hourInTimezone(now, row.digest_timezone)` must equal `row.digest_hour_local` or the row is skipped with reason `hour_mismatch` (line 339) and nothing else in the loop body runs for that reader this invocation. This is the single gate the manager's hypothesis names, and it is exactly as described: a strict `!==` compare, no tolerance, no "or later."
   b. **Frequency gate** (lines 342–346, `frequencyAdmitsToday` defined lines 242–251): `off`→never, `daily`→always, `weekdays`→Mon–Fri (`weekdayInTimezone` 1–5), `weekly`→Monday only (`weekday === 1`). Evaluated using the CURRENT run's weekday in the reader's own zone — i.e. whichever local day the run happens to land on.
   c. **Intent normalization gate** (lines 347–351): `digestFeedRequestFromProfile` can fail (`intent_required`) if the profile's stored intent doesn't normalize; skip, no send.
   d. **"Six hours ago" lookback** (lines 353–365): unconditional (runs on both the flag-on and flag-off paths below) — queries `briefing_deliveries` for any row for this user with `delivered_at >= now - 6h`; if found, skip as `recent_delivery`. This is NOT a per-local-date guard; it's a rolling 6-hour window regardless of calendar-day boundaries. See 2.2 for why this window is materially too short once runs are allowed to catch up hours later.
   e. **30-day seen-paper exclusion** (lines 367–377): collects `item_ids` from every delivery in the last 30 days into `excludeIds`, passed into the feed pipeline so a reader doesn't see the same *papers* twice. This prevents duplicate content inside an email; it does **not** prevent a second email from going out the same day — a second send with a fresh set of papers would still be a second, unwanted email.
   f. **Pipeline run** (lines 384–404): `runFeedPipeline(..., aiTier: 0, excludeIds, topN: paper_count)` — always Tier 0 for the cron path by design (D9, comment lines 391–402), independent of everything else here.
   g. **Dedupe-flag branch** (lines 418–504) — gated on `isDigestDedupeEnabled()` (lines 238–240, reads `PEER_DIGEST_DEDUPE`, only the literal value `"on"` counts):
      - **Flag ON** (lines 419–485): computes `localDate = dateInTimezone(now, row.digest_timezone)` (line 427); calls the atomic RPC `admin.rpc("claim_briefing_delivery", {p_user_id, p_local_date, ...})` (lines 438–447). This RPC (migration below) does `INSERT ... ON CONFLICT (user_id, local_date) DO NOTHING RETURNING id` — the one truly race-proof "have I already claimed today" guarantee in this codebase.
        - RPC errors → `failed_reasons.claim_error` (448–452), no send.
        - **Zero rows returned = someone already claimed today.** For an in-app-only reader this is an unconditional skip, reason `already_claimed` (454–458). For an email/both reader, `handleConflictingEmailClaim` (digest-retry.ts) decides further — see 1.2h below. This is the *conflict ladder* the task asks about.
        - Non-zero → `claimedRowId` set (line 485), proceed to send.
      - **Flag OFF (today's actual production behaviour — see 2.2)** (lines 486–504): byte-for-byte plain `INSERT` into `briefing_deliveries` with no `local_date` column written at all (that column doesn't exist in production; see 1.2j). There is **no per-local-date uniqueness constraint on this path** — the only things stopping a second send that day are (d) the 6-hour lookback and (e) the 30-day paper exclusion (which stops repeat papers, not a repeat email).
   h. **The already_claimed / already_sent / retry ladder** — `handleConflictingEmailClaim` (`web/src/lib/email/digest-retry.ts:83-160`), reused unmodified by both this route and prepare-dashboards' own email-retry phase (1.4):
      1. Row unreadable, or no `payload.email` sub-object at all (legacy row / read failure) → **fail-safe skip**, reason string `"digest already claimed for this local date"` → response code `already_claimed` (`conflictSkipReasonCode`, route.ts:72-85). Never risks a double send on an unknown shape.
      2. `payload.email.sent === true` → skip, `"digest already sent for this local date"` → code `already_sent`.
      3. Unsent, but a full stored body (`subject`/`html`/`text`/`to`/`attemptedAt`) less than `IDEMPOTENCY_REPLAY_WINDOW_MS` = 23h old (digest-retry.ts:24) → **replays the exact stored bytes** with the exact same idempotency key (never re-renders) → `kind: "sent"` or `kind: "failed"` depending on Resend's answer.
      4. Unsent, stored body older than 23h → skip, `"digest email attempt expired unsent (>23h, not retried)"` → code `retry_expired`. Nothing sends; this reader's digest for that local date is simply lost unless something re-triggers it (nothing currently does — see 1.4).
      5. A live Resend `concurrent_idempotent_requests` error while replaying → skip, `retry_in_progress` (harmless, another attempt is genuinely in flight).
   i. **First-attempt send** (only on a fresh claim; `sendFirstDigestAttemptWithIdempotency`, lines 130–167): renders once, **persists the pending record before sending** (so a crash mid-send is replayable by (h).3 later), sends with a deterministic key `digestIdempotencyKey(userId, localDate) = sha256("peer-digest-email:v1:" + userId + ":" + localDate)` (lines 106-109), and on confirmed success collapses the stored payload to `{sent:true, sentAt}`.
   j. **The migration this all depends on**: `web/supabase/migrations/20260924000300_briefing_deliveries_dedupe.sql` adds the nullable `local_date` column, a **partial** unique index `(user_id, local_date) WHERE local_date IS NOT NULL` (lines 41-43), and the `claim_briefing_delivery` function (lines 91-111). Its own header says plainly: **"AUTHORED ONLY. NOT APPLIED by this campaign"** (line 5). `web/.env.example:135-140` confirms the flag convention: `PEER_DIGEST_DEDUPE` ships blank, with an explicit instruction to "Leave unset until AFTER that migration has actually been applied." I found no later entry in ABC-JEV-INTEGRATION.md recording that this migration was applied or the flag flipped (the go-live NOW block only names `20260922000000_private_paper_pools.sql` as the "always-touched" migration and says "the other 6 new migrations stay unapplied safely"). **I cannot query the live Supabase instance (no DB access, per this task's constraints and the ABC campaign's standing `§1k` DB-proof-BLOCKED rule), so I cannot directly confirm today's live flag/migration state — this repo-level evidence is the closest I can get, and it says OFF/unapplied.** Treat this as the working assumption, flagged, not a verified live fact.
   k. **Response shape** (lines 558–574): counts and fixed-vocabulary reason tallies only, by design (EMAIL-TOKEN-PRIVACY, since the workflow log that prints this is public) — never a per-reader list. This is why nobody currently gets an aggregate "N readers missed their hour today" signal either; it only exists as an ephemeral count in one hourly Action log line, never stored or trended anywhere.

### 1.3 `web/src/lib/dashboard/timezone.ts` — the shared clock math

Five pure `Intl.DateTimeFormat`-based functions, all fail-safe (`try/catch` → a sentinel, never throw): `hourInTimezone` (27-41), `weekdayInTimezone` (44-54), `dateInTimezone` (62-78), `offsetMinutesAt` (90-110), and `utcInstantForLocalWallClock` (135-159, the *inverse* — local wall clock → UTC instant, via a 3-iteration converge-past-DST-jumps algorithm, hand-verified against a real 2026-03-08 America/Chicago spring-forward). `dispatch-digests/route.ts` uses the first three directly; `prepare-due.ts` and `due-owners.ts` (1.4) reuse `utcInstantForLocalWallClock`/`dateInTimezone` from here rather than re-deriving the same wall-clock question a third way — the header comments in both extracted-from files call this out explicitly as a deliberate anti-drift measure.

### 1.4 The prepare queue — does it have the same exact-hour problem? **No — it already has "due since" semantics.**

This is the one part of the path that is **already built the way Task 3's recommended fix wants dispatch to work**, just not wired to sending anything yet:

- `web/src/lib/dashboard/due-owners.ts:isOwnerDueForPrepare` (98-124): computes `checkinInstant` (the reader's configured hour, that local day) and `dueAt = checkinInstant - PREPARE_LEAD_MINUTES` (90 min, line 54, a `§1x` BINDING override of `prepare-due.ts`'s own 45-minute default). A row is `due:true` whenever `dueAt <= now + PREPARE_LOOKAHEAD_MS` (3 hours, line 63) — **there is no lower bound**. The function's own doc comment (85-96) and a dedicated test (`due-owners.test.ts:90`, *"has NO lower bound: a dueAt already in the past still reports due:true... self-heals within one owner-local day"*) say this is deliberate: a late-but-still-same-owner-day enqueue is treated as strictly better than silently giving up.
- `prepare-dashboards/route.ts:runDueSelectionAndEnqueue` (209-274) calls this every run for every pre-filtered profile and **re-enqueues unconditionally when due** (comment, 203-207: *"Enqueue defensively, not narrowly... every due-or-soon-due row is (re-)enqueued every run via the idempotent debounced upsert"*). The upsert is `enqueue_prepare_job` (migration `20260924000600_dashboard_prepare_jobs.sql:104-134`) — one row per `(owner_id, local_date)` by a real unique constraint, so re-enqueueing a still-pending job is a safe no-op, and re-enqueueing a `done`/`failed`/`dead` job for a *new* `local_date` revives it fresh. **This queue is architecturally immune to the "GitHub dropped an hour" problem by construction** — a delayed run just finds the same job still (or again) due and upserts it again.
- **But this whole machinery is currently inert.** `dashboardPrepareEnabled()` reads `PEER_DASHBOARD_PREPARE` (route.ts:82-84) and `digestEmailRetryEnabled()` reads `PEER_DIGEST_EMAIL_RETRY` (87-89) — both default OFF (`.env.example:155,169`; ABC-JEV-INTEGRATION.md line 634: *"P10 names PEER_DASHBOARD_PREPARE and PEER_DIGEST_EMAIL_RETRY accepted; both default off; the email-retry phase is a structural no-op while email stays dormant"*). Today, every hourly `prepare` job run returns `{prepare: {enabled:false, reason:"flag_off"}, email_retry: {enabled:false, reason:"flag_off"}}` and does nothing. **The prepare job also only *builds/caches a dashboard batch* — it was never the thing that emails a reader; that's `dispatch-digests` alone**, so even fully turned on, `prepare` would not by itself fix the missed-hour email problem; it's a separate acceptance item (13/14 in the frozen inventory) about having a batch ready *before* a reader's configured hour, not about resending after a miss.
- The **email-retry phase inside `prepare-dashboards`** (`runEmailRetryPhase`, 326-379) *is* directly relevant to catch-up: it re-scans `briefing_deliveries` for claimed-but-unsent rows (`fetchEmailRetryCandidatesReal`, 186-200) and replays them through the exact same `handleConflictingEmailClaim` ladder as 1.2h, gated on a 10-minute floor / 23-hour ceiling (`isEmailRetryEligible`, digest-retry.ts:175-181). It is also currently OFF, and additionally short-circuits to `{enabled:false, reason:"dedupe_disabled"}` (route.ts:422-426) if `PEER_DIGEST_DEDUPE` is off too — so it has a real, useful, already-reviewed job to do the moment both flags are on, but does nothing today.

### 1.5 What a reader sees when a run is missed

**Nothing.** Two places were checked directly:
- `web/src/app/profile/page.tsx:1436-1441` (`EmailSettingsView`, the "Daily email" settings section): when email is on, the only status text is a flat, forward-looking promise — `` `Sending daily at ${formatHourLabel(digestHourLocal)} (${digestTimezone}) to ${destination}.` `` — unconditional on whether yesterday's (or today's) send actually happened. There is no last-sent timestamp, no health indicator, no warning state anywhere in this component.
- `web/src/app/api/briefings/route.ts:16-47` (the "Past briefings" list the settings copy points to): a plain `SELECT ... ORDER BY delivered_at DESC LIMIT 60` of rows that exist. There is no concept of an "expected but missing" day — a 4-day gap in delivery just renders as a gap in the list, with no label explaining why, discoverable only if the reader happens to notice the dates themselves.

So today, a reader whose hour is repeatedly missed has no way to learn that from the product; they'd have to independently notice the email never arrived.

---

## TASK 2 — Confirming the manager's reading by execution

### 2.1 Real run times (GitHub REST API, unauthenticated, fetched 2026-09-29)

Methodology note, disclosed for transparency: my first attempt (`GET .../workflows/digest-cron.yml/runs?event=schedule&per_page=100`, filename-based, no date filter) returned a page whose 100 newest-looking rows were all dated 2026-08-02–2026-08-30 and all `conclusion:"failure"` — inconsistent with any run existing after Aug 30. Resolving the workflow to its numeric id first (`GET /repos/Aspen-Lab/peer/actions/workflows` → confirmed exactly one workflow at this path, id `266890338`, `state:"active"`, created 2026-04-27, no renames in git history) and re-querying **by that id** with an explicit `created=2026-09-01..2026-09-30` range returned a materially different, internally-consistent result whose entries for 2026-09-28/29 match the manager's cited example timestamps **verbatim** (`2026-09-28T13:44:07Z`, `2026-09-28T20:30:43Z`, `2026-09-29T00:56:37Z`, `2026-09-29T06:48:48Z`, `2026-09-29T13:59:40Z` — all present exactly). I used the numeric-id result as ground truth and did not chase the filename-query discrepancy further (out of scope; noted here so it isn't mistaken for a silent inconsistency).

Result for `event:"schedule"` runs, `2026-09-17T00:00:00Z` → now (2026-09-29, fetch time; window fully covered in one page, no further pagination needed — the 100-row page already reaches back to 2026-09-11):

| UTC date | scheduled runs | | UTC date | scheduled runs |
|---|---|---|---|---|
| 09-17 | 6 | | 09-24 | 5 |
| 09-18 | 5 | | 09-25 | 5 |
| 09-19 | 7 | | 09-26 | 6 |
| 09-20 | 6 | | 09-27 | 5 |
| 09-21 | 5 | | 09-28 | 3 |
| 09-22 | 5 | | 09-29 | 3 (partial day at fetch time) |
| 09-23 | 6 | | | |

67 scheduled runs over 13 UTC days — **every single day in range is 3–7, never 24. Manager's frequency claim CONFIRMED by independent execution**, not inherited. (Separately, and not part of this ticket: 2026-09-11 through 09-14 in the same pull show `conclusion:"failure"` for every scheduled run, turning `conclusion:"success"` from 09-15 onward — an unrelated earlier incident, most likely the `CRON_SECRET` mismatch the ABC log's go-live notes describe fixing; mentioned only so it isn't confused with this ticket's problem.)

### 2.2 Catch-up vs. current rule — real simulation, real timezone code

Script: `<scratchpad>/catchup-sim.mjs`, input `<scratchpad>/runs-sep-all-events.json` (raw GitHub API response). The script imports `hourInTimezone`/`dateInTimezone` **directly from the checked-out `web/src/lib/dashboard/timezone.ts`** via Node 24's native `.ts` import (confirmed working, no ts-node/build step needed, no port/duplication of the logic) — not a reimplementation. For each real scheduled-run instant it computes the America/Chicago local date and local hour, groups by local date, then for every candidate `digest_hour_local` 0–23 computes:
- **current rule**: did any run land at local hour exactly `h` on that local date?
- **catch-up rule**: did any run land at local hour `>= h` on that *same* local date (first such run = the send moment)?

against a clean denominator of the 12 **fully-observed** local calendar days in range (2026-09-17..2026-09-28 America/Chicago; 2026-09-16 and 2026-09-29 were excluded as boundary-partial — the UTC fetch window starts/ends mid-local-day for a UTC-5 zone). Full per-hour result:

| chosen hour | current: days sent /12 | current % | catch-up: days sent /12 | catch-up % |
|---:|---:|---:|---:|---:|
| 0 | 4 | 33% | 12 | **100%** |
| 1 | 3 | 25% | 12 | **100%** |
| 2 | 2 | 17% | 12 | **100%** |
| 3 | 0 | **0%** | 12 | **100%** |
| 4 | 3 | 25% | 12 | **100%** |
| 5 | 1 | 8% | 12 | **100%** |
| 6 | 3 | 25% | 12 | **100%** |
| 7 | 1 | 8% | 12 | **100%** |
| 8 | 4 | 33% | 12 | **100%** |
| 9 | 4 | 33% | 12 | **100%** |
| 10 | 0 | **0%** | 12 | **100%** |
| 11 | 4 | 33% | 12 | **100%** |
| 12 | 2 | 17% | 12 | **100%** |
| 13 | 3 | 25% | 12 | **100%** |
| 14 | 3 | 25% | 12 | **100%** |
| 15 | 5 | 42% | 12 | **100%** |
| 16 | 2 | 17% | 12 | **100%** |
| 17 | 5 | 42% | 12 | **100%** |
| 18 | 5 | 42% | 12 | **100%** |
| 19 | 3 | 25% | 10 | 83% |
| 20 | 4 | 33% | 7 | 58% |
| 21 | 0 | **0%** | 3 | 25% |
| 22 | 0 | **0%** | 3 | 25% |
| 23 | 3 | 25% | 3 | 25% |

(24-hour average, current rule: ≈22%, i.e. consistent with the manager's "about 1 day in 5" — but the average hides that hours 3, 10, 21 and 22 got **zero** exact-hour matches across all 12 real days, while 15/17/18 got 42%. It is not uniform across chosen hours.)

**Verdict: manager's causal reading (route.ts:337-341's exact-hour compare is what turns a ~5-run day into a ~1-in-5 delivery day) is CONFIRMED by execution, and the magnitude is worse than "about 1 in 5" for several specific hour choices, not just an average effect.** A same-local-date catch-up rule closes the gap completely for hours 0–18 (100%, every single day) and substantially for 19–20, but has a **real, data-proven residual gap for late-evening hours 21–23** (identical or barely-better than today, because there is structurally no later run left that local day to catch up from) — this is not a hypothetical edge case, it shows up directly in real 2026-09 data and motivates option (D) below.

### 2.3 A second real finding: the 6-hour lookback is not a safe same-day guard once runs may land hours apart

Gap between consecutive real scheduled runs across the same 67-run window: min 2.08h, median 4.88h, max 8.49h; **8 of 66 consecutive gaps exceeded 6 hours.** The flag-off path's only same-day duplicate guard (route.ts:353-365) is exactly a rolling 6-hour lookback. Under a naive catch-up rule with the dedupe flag left off, at least some of these 8 real gaps would have let a reader who was already (imperfectly) covered by the old exact-hour luck get a *second* email that day once catch-up widens who's eligible on the later run. This is why 1.2j/1.2g's finding (the atomic per-local-date claim RPC is authored but not applied/enabled) is load-bearing for Task 3, not a side note.

---

## TASK 3 — Design options

### (A) Catch-up inside the dispatcher — send when local hour ≥ chosen hour on the same local date, and today is not yet claimed/sent

**What reaches a reader:** the same daily email, just at the first opportunity GitHub actually grants that local day at or after their chosen hour, instead of only on the (rare) run that lands in their exact chosen hour.

**Two implementation depths**, both changing the same one line (route.ts:338, `hour !== row.digest_hour_local` → `hour < row.digest_hour_local` as the *skip* condition, i.e. only "not yet due" skips; "due" falls through to the existing claim/send logic unchanged):
- **A1 (no schema change):** on the flag-off path, replace the 6-hour lookback with a check scoped to the reader's *local calendar date* (e.g. does the most recent `briefing_deliveries.delivered_at` for this user fall on `dateInTimezone(now, tz)`?). Cheap, no migration/authorization needed. **Failure mode:** a narrow race if two runs overlap enough that both read "not sent yet" before either writes — mitigated but not eliminated by the workflow's own `cancel-in-progress:false` serialization (1.1); realistically low given runs are minutes long and hours apart, but not zero.
- **A2 (recommended): turn on the already-authored, already-reviewed `PEER_DIGEST_DEDUPE` flag and apply its migration** (1.2j) so the *existing* `claim_briefing_delivery` atomic RPC becomes the real one-per-`(user_id, local_date)` guarantee, race-proof by a real Postgres partial unique index, not application-level timing. This is not new engineering — P4-S7-IDEM already built and reviewed exactly this mechanism; it has simply never been switched on.

**Failure modes, named individually (as required):**
- *A run that never comes that whole local day*: still a full miss, same as today — option A only helps if *some* run lands at/after the chosen hour before local midnight. Real data (2.1) never showed a full missed day in this window, but GitHub's own documentation (2.4 below) does not guarantee that. Complementary to (B)/(C), not a replacement for them.
- *Runs just after local midnight*: handled for free by construction — every gate here is keyed by `dateInTimezone`/`hourInTimezone` computed fresh per run, so a 00:xx run is automatically evaluating the *new* local date's own not-yet-due readers, never yesterday's. Still deserves an explicit regression test (Task 4) given this codebase's own history of DST/midnight bugs (timezone.ts's extensive commentary, route.test.ts's dedicated cross-midnight suite).
- *A late-evening chosen hour*: **proven residual gap** — see 2.2's hours 21-23. Same-local-date catch-up cannot invent a run that doesn't exist before local midnight. This is the one failure mode with real measured evidence it's not fully solved by (A) alone.
- *Retries*: unaffected/composable — (A) only changes whether a *first* claim attempt is made; the 23-hour replay ladder (1.2h) and Resend's own idempotency key are unchanged downstream. Turning on `PEER_DIGEST_DEDUPE` for (A2) also incidentally activates the already-built, currently-100%-dormant automatic email-retry phase in `prepare-dashboards` (1.4) — a real side effect to name explicitly (Task 5), not silently inherit.
- *Two runs close together* (min real gap 2.08h): under A2, the second run's claim attempt returns zero rows → correctly recognized as `already_claimed`/`already_sent` → skip, verified by the existing, already-tested conflict ladder. Under A1 alone, this is exactly the narrow race window named above.
- *The claim RPC as the one-send guarantee*: it is the right mechanism and it already exists; the gap is entirely that it's switched off, not that it needs to be built.
- *Weekly/weekday frequency rules*: correctly composes if `frequencyAdmitsToday` keeps being evaluated at the actual run's local weekday (already true, 1.2b) — a `weekly` reader missed on Monday must **not** get caught up on Tuesday (Tuesday's `frequencyAdmitsToday` call already returns false for `weekly`, since `weekday !== 1`), so this is enforced for free by the existing gate ordering, but is exactly the kind of thing that silently breaks in a careless rewrite and needs a named test (Task 4).
- *The lookback*: the existing 6-hour window (1.2d) must be widened to a local-date-scoped check (A1) or superseded by the RPC (A2) — **left exactly as-is, it actively under-protects catch-up** (2.3's 8-real-gaps-over-6h finding).
- **Cost:** a code change plus (for A2) applying one already-written, already-reviewed migration and flipping one already-named env var — no new infrastructure, no new paid service. **Needs the user:** applying any migration to the live Supabase remains subject to this campaign's standing separate-authorization rule for production DB changes (§1b/§3a) — naming that explicitly here rather than assuming it's already covered by this ticket.
- One cost not previously named anywhere I found in the spec/ABC log: **a "thundering herd" run.** After any real gap (2.1 shows gaps up to 8.49h, i.e. up to ~8 different `digest_hour_local` values could all become newly due at once), a single dispatch invocation could suddenly need to process every reader whose hour falls in that whole stretch, in one 300-second (`maxDuration`, route.ts:181) run, with **no existing time-budget guard in this route's loop** (unlike `prepare-dashboards`, which already has exactly this problem solved — `PREPARE_DRAIN_MAX_JOBS_PER_RUN`/`PREPARE_DRAIN_WALL_CLOCK_BUDGET_MS`, route.ts:68-69,283-286). Worst case is graceful (a claimed reader is safely claimed; an unprocessed one just remains due and is picked up next run — no duplicate, no crash-corruption), just possibly slow to fully drain. Worth deciding whether to port the same bounded-per-run pattern now or accept the graceful-but-slow degradation (Task 5).

### (B) More schedule lines in the workflow — still best-effort

Adding e.g. a second `cron:` line (`:35 * * * *` alongside the existing `:05`) roughly doubles nominal daily attempts. **Cost:** trivial, free. **Does not by itself fix anything** — GitHub's own documentation (2.4) says scheduled runs can be delayed *or dropped* under load independent of how many schedule lines exist; more lines raise the number of chances, they don't guarantee any one fires, and (B) alone does nothing for a reader whose hour still doesn't land exactly on a surviving run (it doesn't touch the selection *rule* at all). Genuinely complementary to (A) (more real run instants for (A)'s catch-up rule to catch up *on*), not a substitute for it.

### (C) Vercel Cron for this route

`vercel.json` today has exactly one cron entry, `/api/jobs/purge-uploads` at `"17 3 * * *"` (once daily) — so there is local precedent for Vercel Cron in this project, but only at daily frequency. From Vercel's public docs (`vercel.com/docs/cron-jobs/usage-and-pricing`, fetched 2026-09-29):

| Plan | Cron jobs / project | Minimum interval | Scheduling precision |
|---|---|---|---|
| Hobby | 100 | **once per day** | per-hour, i.e. **±59 minutes** even at daily frequency |
| Pro | 100 | once per **minute** | per-minute |
| Enterprise | 100 | once per minute | per-minute |

An hourly cron expression on Hobby **fails at deploy time outright** ("Hobby accounts are limited to daily cron jobs"). On Pro/Enterprise, Vercel Cron would invoke the route directly (no third-party queue, no documented "dropped under high load" caveat the way GitHub's does) at real per-minute precision — this would structurally fix the reliability side of the problem on its own, no catch-up rule required (though (A) remains cheap, valuable defense-in-depth against a Vercel-side outage too).

**What I could not verify:** which Vercel plan this project is actually on. I have no account access (constraint) and found no definitive statement in the ABC log — only an indirect, inconclusive hint (an earlier note about an env-var "add" button looking disabled, guessed at the time as "likely a team-role limit," never confirmed). **This is squarely the user's decision to make and state, not mine to assume** — a Hobby project physically cannot run this option at hourly frequency. I also did not verify Vercel's exact recommended cron-authentication convention (e.g. an auto-populated `CRON_SECRET`-equivalent) beyond what's already in this project's existing `purge-uploads` cron; stating that as unverified rather than asserting it matches.

**Needs the user, twice over:** (i) the plan decision above, and (ii) this would reopen a standing BINDING ruling (ABC-JEV-INTEGRATION.md §1x, P9: *"two GitHub Actions jobs... never touch vercel.json"*) — that ruling was made deliberately for reasons recorded in the log; overriding it is a manager/user call, explicitly not mine to make as B.

### (D) Anything else

- **A window that can cross local midnight**, specifically for late chosen hours: extend (A)'s rule so an hour in (say) the last few hours of the day can also be satisfied by the first run on the *next* local date, still filed as "today's" digest. This is the direct, data-backed answer to 2.2's hours 21-23 gap. **Cost is real, not cosmetic**: it blurs what `local_date` means for the delivery row/dedupe key (a "digest for the 20th" physically sent at 00:40 local on the 21st) — touches the same `local_date` key the 30-day dedupe window and the Past-briefings list (1.5) both key off, so it's a bigger design lift than (A) alone, not a one-line addition. I have no visibility into the real distribution of readers' chosen `digest_hour_local` (would need a live, aggregate-only DB query I'm not positioned to run) — whether this is worth building now versus after real usage data shows how much mass sits in the evening hours is named as an open question in Task 5, not decided here.
- **Decoupling dispatch from prepare**: since `prepare` (1.4) already has correct due-since semantics and doesn't need per-minute precision the way `dispatch` benefits from, a hybrid is possible — keep GitHub Actions (plus (A)) for `dispatch`, and only consider Vercel Cron (C) for `prepare` (or vice versa) rather than an all-or-nothing switch. Naming this as an option, not recommending it over the simpler read below.

### Recommendation

**(A), specifically A2** (turn on `PEER_DIGEST_DEDUPE` + apply its already-authored migration, and change the selection rule from exact-hour to "due since, not yet claimed"). Reasons: it is the only option that is a pure, already-substantially-built application-logic fix (no new paid service, no schema surprises — the schema change and the atomic RPC already exist, reviewed, just dormant); it directly closes the dominant real gap this ticket's own execution proved (0%→100% for the large majority of chosen hours in 2.2's real data); and it composes with, rather than competes against, (B) and (C) — both remain worth doing *in addition*, especially (C) if the Vercel plan question resolves in favor of Pro, since (A) is cheap insurance regardless of how reliable the trigger becomes. (D) is a real, data-justified follow-up, not a blocker for shipping (A) first — recommend scoping it separately once real chosen-hour distribution data exists.

### 2.4 GitHub's own documented reliability caveat (for completeness, cited not just inherited)

`docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule` (fetched 2026-09-29): *"the `schedule` event can be delayed during periods of high loads of GitHub Actions workflow runs. High load times include the start of every hour. If the load is sufficiently high enough, some queued jobs may be dropped."* Minimum interval for any scheduled workflow is 5 minutes; public-repo scheduled workflows auto-disable after 60 days with no repository activity (not applicable here — this repo is active daily). This matches, and gives a documented mechanism for, the empirical pattern in 2.1.

---

## TASK 4 — Tests the fix needs

**Existing test search result (must be stated plainly, not assumed): I searched for an existing test pinning the exact-hour behaviour and found none.** A literal grep for `hour_mismatch` across all of `web/` matches only the production line (`route.ts:339`) — zero test files reference it. I additionally read every `it(...)` title in `route.test.ts` (28 tests) and `idempotency.test.ts` (18 tests) and every `digest_hour_local` fixture in both files: each one that sets a specific hour also sets the fake system clock to that *same* local hour (e.g. `route.test.ts:607`+`605`, `:618`+`616`, `:632`+`630`, `:648`+`646`, `:713`+`711`) — i.e. every existing test is an exact-match *positive* case; none constructs a genuine mismatch to prove it's skipped. **So there is nothing here to "rewrite" for that specific branch** — but this also means the skip branch itself has zero regression coverage today, which the new tests below should close, not just the new catch-up behaviour.

New tests needed (styled like this codebase's own precedent for exactly this class of rule, `due-owners.test.ts`, e.g. its line 90 *"has NO lower bound: a dueAt already in the past still reports due:true"*):
1. Exact-hour match still sends (preserves today's one passing case).
2. Local hour **before** chosen hour → still skips as not-yet-due (the new, correctly-named replacement for `hour_mismatch`'s "not yet" half).
3. Local hour **past** chosen hour, nothing claimed/sent yet today → sends (the new catch-up case itself — currently has zero coverage in either direction).
4. Already sent earlier today (at/after chosen hour) → a later same-day run skips, **no duplicate email** — the critical regression test, exercised through the real claim-conflict path (A2) and/or the local-date lookup path (A1), whichever is built.
5. Midnight rollover, two sub-cases: (a) a run at local 00:xx for a reader whose chosen hour is e.g. 1 → correctly still "not yet due" (0 < 1), must not send early; (b) a chosen-hour-23 reader sent at local 23:5x, then a run at local 00:2x the *next* local date must not re-send (new `local_date`, genuinely not yet due for the new day). Given this codebase's repeated real DST/midnight bugs (timezone.ts's own extensive commentary), this needs to be a named, explicit test, not assumed to fall out of the date-keying for free.
6. Reuse the existing DST spring-forward fixture convention (America/Chicago, 2026-03-08, already established in `route.test.ts:596`) against the *new* selection predicate.
7. `weekly` reader missed Monday's chosen hour → Tuesday's run must NOT send (frequency gate still correctly blocks it) — proves catch-up composes with `frequencyAdmitsToday` instead of leaking across an admitted/not-admitted day boundary.
8. `weekdays` reader: a Friday miss must not bleed into Saturday — same shape, different rule.
9. Two runs close together, both with local hour ≥ chosen hour (synthetic; real data's minimum observed gap was 2.08h, so this needs a manufactured case) → only the first sends; the second sees `already_claimed`/`already_sent`.
10. `digest_hour_local = 0` (midnight) specifically reachable/catchable — it's a valid selectable value in the UI (`profile/page.tsx:1460`, `Array.from({length:24},...)`) and a plain number, so it's exactly the shape of value a careless `if (!hour)` truthiness check would mishandle; worth an explicit regression pin given `0` is falsy in JS.
11. If (A2) is chosen: a dedicated test that `PEER_DIGEST_DEDUPE` off still degrades to *some* safe (if weaker) same-day guard rather than silently reverting to zero protection — i.e. whatever A1-style local-date check backs the flag-off path should itself be tested independently of the RPC path, mirroring the existing `route.test.ts:706` "flag off: sanity" pattern.

No existing test needs deletion. `idempotency.test.ts`'s entire suite (the 23-hour replay ladder, downstream of the hour gate) should need no changes at all — it exercises a slice of code that only runs *after* a claim already succeeded, which this fix doesn't touch.

---

## TASK 5 — POLICY list for the manager

1. **A1 vs A2**: ship the lighter no-migration date check now, or apply the already-authored `20260924000300_briefing_deliveries_dedupe.sql` migration and turn on `PEER_DIGEST_DEDUPE` as part of this fix? A2 is recommended (race-proof, already built and reviewed) but touches production DB schema, which needs the user's separate go-ahead under this campaign's standing rule for any live migration.
2. Turning `PEER_DIGEST_DEDUPE` on **also** silently activates the currently-100%-dormant email-retry phase inside `prepare-dashboards` (1.4) — provided `PEER_DASHBOARD_PREPARE`/ledger stay off, the *prepare* half stays a no-op, but the *email_retry* half's only remaining gate is that one dedupe flag. Confirm this side effect is wanted, not accidental scope creep riding along with this ticket.
3. Same-local-date catch-up structurally under-serves late-evening chosen hours (2.2's real 58%/25%/25% for hours 20/21-22/23) — pursue option (D)'s midnight-crossing window now, or defer until there's real data on how many readers actually pick a late-evening hour? I have no access to that distribution (would need a live, aggregate-only DB query).
4. If a run finds a large backlog after a real gap (up to 8.49h observed), should it process everyone in one invocation even at risk of hitting the 5-minute `maxDuration`, or should dispatch adopt the same bounded-per-run/self-healing-next-run pattern `prepare-dashboards` already uses? Either is safe (no duplicates either way); this is a latency/engineering-effort trade-off, not a correctness one.
5. Should a reader ever be told a digest arrived late/caught-up, or should catch-up stay silent (today there is zero user-facing signal either way — 1.5)? A product-voice decision, not an engineering one.
6. Pursue (B) (extra schedule line(s), free, best-effort-only) and/or (C) (Vercel Cron, needs a paid-plan decision) now, later, or not at all? Neither is required for (A) to work.
7. (C) specifically requires the user to state which Vercel plan this project is on (Hobby cannot run hourly cron at all; I could not verify this from the repo).
8. (C) would also reopen the standing BINDING ruling against touching `vercel.json` for this trigger (§1x P9) — overriding a prior binding ruling is explicitly the manager's/user's call, not B's.
9. Confirm the `weekly`/`weekday` non-leak behaviour (Task 3/4 item 7-8) is the *intended* contract (a missed Monday must never quietly become a Tuesday send) — I believe this is obviously correct and not really optional, but naming it since it's a product-meaning decision about what "weekly" means, not purely a code fact.

---

## Evidence index

- Repo: `.github/workflows/digest-cron.yml`; `web/src/app/api/jobs/dispatch-digests/route.ts`; `web/src/lib/dashboard/timezone.ts`; `web/src/lib/dashboard/due-owners.ts`; `web/src/lib/dashboard/prepare-due.ts`; `web/src/app/api/jobs/prepare-dashboards/route.ts`; `web/src/lib/email/digest-retry.ts`; `web/supabase/migrations/20260924000300_briefing_deliveries_dedupe.sql`; `web/supabase/migrations/20260924000600_dashboard_prepare_jobs.sql`; `web/.env.example:126-169`; `vercel.json`; `web/src/app/profile/page.tsx:1276-1700`; `web/src/app/api/briefings/route.ts`; `web/src/app/api/jobs/dispatch-digests/route.test.ts`; `web/src/app/api/jobs/dispatch-digests/idempotency.test.ts`; `web/src/lib/dashboard/due-owners.test.ts`.
- Live, read-only, unauthenticated GitHub REST API pulls (2026-09-29): `/repos/Aspen-Lab/peer/actions/workflows`; `/repos/Aspen-Lab/peer/actions/workflows/266890338/runs?created=2026-09-01..2026-09-30`.
- Public docs fetched 2026-09-29: `docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule`; `vercel.com/docs/cron-jobs/usage-and-pricing`.
- Scratch (session scratchpad only, not in repo): `<scratchpad>/runs-sep-all-events.json` (raw API response), `<scratchpad>/catchup-sim.mjs` (simulation, imports the real `web/src/lib/dashboard/timezone.ts` via Node 24 native `.ts` import).
