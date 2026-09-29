// GET /api/jobs/prepare-dashboards
//
// TRIGGER-A (ABC-JEV-INTEGRATION.md §1x; guide docs/jev-abc/
// TRIGGER-A-B-20260925T044825Z.md). Wires the already-built, previously
// zero-caller prepare-ahead engine (web/src/lib/dashboard/prepare-worker.ts)
// into the existing hourly GitHub Actions run: due-selection + enqueue
// (acceptance 13/14), draining the queue (acceptance 15 — a cooldown-gated
// manual refresh row and a scheduler-enqueued row share one table and are
// indistinguishable at drain time, so draining the one queue satisfies both),
// and retrying failed digest emails (user decision #5).
//
// Auth mirrors web/src/app/api/jobs/dispatch-digests/route.ts exactly: the
// shared CRON_SECRET check is the FIRST thing this handler does, before any
// Supabase call, so a bad/missing secret has zero side effects.
//
// Cron-triggered hourly via .github/workflows/digest-cron.yml's own SECOND
// job (P9 — independent timeout/concurrency/status from the existing
// `dispatch` job; vercel.json is never touched, this trigger is GitHub
// Actions-only per ABC-JEV-INTEGRATION.md §1p.C.3).
//
// Both PEER_DASHBOARD_PREPARE and PEER_DIGEST_EMAIL_RETRY (P10) default OFF.
// This route has NO EFFECT AT ALL until (1) the workflow change is pushed/
// merged (a separate explicit user yes) AND (2) the flags are turned on.
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  bumpReason,
  conflictSkipReasonCode,
  digestFeedRequestFromProfile,
  digestIdempotencyKey,
  isDigestDedupeEnabled,
  logJobIssue,
  type ProfileRow,
} from "@/app/api/jobs/dispatch-digests/route";
import { classifySendFailure } from "@/lib/email/send-failure";
import { serializeFeedIntent } from "@/lib/feed/intent";
import { dashboardLedgerEnabled } from "@/lib/dashboard/ledger-flag";
import { isOwnerDueForPrepare, PREPARE_LEAD_MINUTES, PREPARE_LOOKAHEAD_MS } from "@/lib/dashboard/due-owners";
import { createPrepareAheadBuildPool, PROFILE_COLUMNS } from "@/lib/dashboard/prepare-pool";
import {
  SupabaseDashboardPrepareJobRepository,
  type DashboardPrepareJobRepository,
} from "@/lib/dashboard/prepare-job-repository";
import { SupabaseDashboardDeliveryLedger, type DashboardDeliveryLedger } from "@/lib/dashboard/delivery-ledger";
import { drainPrepareQueue, type PrepareBuildOutcome, type PrepareJobOutcome } from "@/lib/dashboard/prepare-worker";
import type { DashboardPrepareJob } from "@/lib/dashboard/prepare-job-repository";
import {
  handleConflictingEmailClaim,
  isEmailRetryEligible,
} from "@/lib/email/digest-retry";

type AdminClient = ReturnType<typeof createAdminClient>;

export const dynamic = "force-dynamic";
export const maxDuration = 300; // matches dispatch-digests/route.ts's own ceiling

// P2 (ABC-JEV-INTEGRATION.md §1x, BINDING) — "drain ceiling = 10 per run
// (drainPrepareQueue's default) plus a wall-clock guard: stop claiming new
// jobs once ~200s of the 300s maxDuration have passed (additive optional
// parameter or a loop in the new orchestration function — least invasive;
// test it)." Implemented below as a loop calling drainPrepareQueue with
// maxJobs:1 per iteration, checking the wall clock before each claim —
// zero changes to prepare-worker.ts's own (already-VERIFIED, tested)
// drainPrepareQueue signature. Functionally identical to one call with
// maxJobs:10 whenever the wall-clock budget is never hit; strictly safer
// when it is (can stop mid-batch instead of only between whole-batch calls).
export const PREPARE_DRAIN_MAX_JOBS_PER_RUN = 10;
export const PREPARE_DRAIN_WALL_CLOCK_BUDGET_MS = 200_000; // ~200s of the 300s maxDuration

// PROPOSED, not sourced (same "label, don't hide" convention as
// prepare-due.ts's own backoff constants) — long enough to comfortably
// outlast a slow per-owner pipeline build (warm-pool.yml's own documented
// "20-30s on a cold morning" for the shared anonymous pool; a private
// per-owner build likely costs more per prepare-worker.ts's own header),
// short enough that a genuinely crashed worker's lease still expires well
// inside one hourly cycle for crash recovery (prepare-job-repository.ts's
// own "leased with an expired lease is claimable" reclaim path).
export const PREPARE_LEASE_DURATION_MS = 4 * 60_000;

/** P4 (ABC-JEV-INTEGRATION.md §1x, BINDING) — trim+lowercase `"on"`-only, same convention as every existing flag. */
function dashboardPrepareEnabled(): boolean {
  return process.env.PEER_DASHBOARD_PREPARE?.trim().toLowerCase() === "on";
}

/** P10 (ABC-JEV-INTEGRATION.md §1x, BINDING) — same convention. */
function digestEmailRetryEnabled(): boolean {
  return process.env.PEER_DIGEST_EMAIL_RETRY?.trim().toLowerCase() === "on";
}

export interface RawEmailRetryCandidate {
  userId: string;
  localDate: string;
  attemptedAt: string | undefined;
}

export interface PrepareCycleDeps {
  /** The run's own logical clock — every due/lead computation uses this, never a bare `new Date()`, so tests can pin it (mirrors prepare-worker.ts's own `PrepareWorkerDeps.now` convention). */
  now: () => Date;
  /** Real wall-clock milliseconds elapsed since this invocation started — the P2 guard's own clock, deliberately SEPARATE from the logical `now` above (a test can advance one without the other). */
  elapsedMs: () => number;
  fetchDueProfiles: () => Promise<ProfileRow[]>;
  readCurrentIntentVersion: (ownerId: string) => Promise<string | undefined>;
  jobs: DashboardPrepareJobRepository;
  /** Structurally narrowed exactly like prepare-worker.ts's own `PrepareWorkerDeps.ledger` -- this route cannot call markServed/acknowledgeBatch even by mistake (test 4 in the guide's §3 depends on this). */
  ledger: Pick<DashboardDeliveryLedger, "getBatch" | "prepareBatch">;
  buildPool: (job: DashboardPrepareJob) => Promise<PrepareBuildOutcome>;
  leaseOwner: string;
  leaseDurationMs: number;
  maxJobsPerRun: number;
  wallClockBudgetMs: number;
  fetchEmailRetryCandidates: () => Promise<RawEmailRetryCandidate[]>;
  /** Needed by handleConflictingEmailClaim's own params shape (digest-retry.ts, reused unmodified). */
  admin: AdminClient;
}

// EMAIL-TOKEN-PRIVACY (ABC-JEV-INTEGRATION.md §1as): same rule as
// dispatch-digests/route.ts's own response (see that file's header note) —
// this route's response is likewise printed whole into the (now-public
// repo) GitHub Actions log every hour, so every per-reader field below is a
// count or a fixed-code tally, never a `{user_id, ...}` list. `outcomes`
// (already a `Record<code, count>`) was always compliant and is unchanged;
// `error`/`drain_error` are single orchestration-crash messages with no
// user_id attached and no email-provider content (Supabase/RPC failures),
// so they stay as-is — changing them is outside this ruling's scope.
export interface PrepareCyclePhaseReport {
  enabled: boolean;
  reason?: "flag_off" | "ledger_disabled" | "dedupe_disabled" | "admin_unavailable";
  due_checked?: number;
  enqueued?: number;
  enqueue_failed_count?: number;
  enqueue_failed_reasons?: Record<string, number>;
  skipped_count?: number;
  skipped_reasons?: Record<string, number>;
  error?: string;
  drained?: number;
  outcomes?: Record<string, number>;
  stopped_reason?: "queue_empty" | "max_jobs_reached" | "wall_clock_budget_reached";
  backlog_likely_remaining?: boolean;
  drain_error?: string;
  candidates_checked?: number;
  sent_count?: number;
  failed_count?: number;
  failed_reasons?: Record<string, number>;
}

export interface PrepareCycleReport {
  ran_at: string;
  prepare: PrepareCyclePhaseReport;
  email_retry: PrepareCyclePhaseReport;
}

/** Guide §2.4 due-selection: SQL pre-filter matches dispatch-digests' own exactly (P3, BINDING — "reuse digest_enabled = true AND digest_frequency ≠ 'off'; document that with today's defaults it matches every signed-in profile", per §1.2's finding in the B guide above). */
async function fetchDueProfilesReal(admin: AdminClient): Promise<ProfileRow[]> {
  const { data, error } = await admin
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("digest_enabled", true)
    .neq("digest_frequency", "off");
  if (error) throw new Error(`profiles_query_failed: ${error.message}`);
  return (data ?? []) as ProfileRow[];
}

/** Guide §2.4 `readCurrentIntentVersion` — re-fetches the single profile row fresh, re-runs digestFeedRequestFromProfile, serializes if ok else undefined (prepare-worker.ts's own runPrepareJob treats undefined as "cannot verify -> retry", never as "changed"). */
async function readCurrentIntentVersionReal(admin: AdminClient, ownerId: string): Promise<string | undefined> {
  try {
    const { data, error } = await admin.from("profiles").select(PROFILE_COLUMNS).eq("user_id", ownerId).maybeSingle();
    if (error || !data) return undefined;
    const normalized = digestFeedRequestFromProfile(data as ProfileRow);
    if (!normalized.ok || !normalized.request.intent) return undefined;
    return serializeFeedIntent(normalized.request.intent);
  } catch {
    return undefined;
  }
}

/**
 * Guide §2.9 SELECTION query (never executed against a live DB this
 * campaign -- DB proof BLOCKED per §1k, same as every other Supabase-backed
 * module here): rows on a channel that sends email, not yet confirmed sent,
 * with a stored attempt to replay. The 10min-23h eligibility WINDOW itself
 * is applied by the orchestration below (isEmailRetryEligible,
 * digest-retry.ts) so it stays uniformly testable regardless of which fetch
 * implementation is injected.
 */
async function fetchEmailRetryCandidatesReal(admin: AdminClient): Promise<RawEmailRetryCandidate[]> {
  const { data, error } = await admin
    .from("briefing_deliveries")
    .select("user_id, local_date, payload")
    .neq("channel", "inapp");
  if (error) throw new Error(`briefing_deliveries_query_failed: ${error.message}`);
  const rows = (data ?? []) as {
    user_id: string;
    local_date: string;
    payload?: { email?: { sent?: boolean; attemptedAt?: string } };
  }[];
  return rows
    .filter((row) => row.payload?.email && row.payload.email.sent !== true && row.payload.email.attemptedAt)
    .map((row) => ({ userId: row.user_id, localDate: row.local_date, attemptedAt: row.payload!.email!.attemptedAt }));
}

/**
 * Phase 1 (guide §2.1) — due-selection + enqueue. "Enqueue defensively, not
 * narrowly" (guide §2.4): every due-or-soon-due row is (re-)enqueued every
 * run via the idempotent debounced upsert (prepare-job-repository.ts's own
 * `enqueue_prepare_job`), which is cheap and self-healing against a missed
 * or delayed run.
 */
async function runDueSelectionAndEnqueue(
  deps: PrepareCycleDeps,
  now: Date,
): Promise<
  Pick<
    PrepareCyclePhaseReport,
    "due_checked" | "enqueued" | "enqueue_failed_count" | "enqueue_failed_reasons" | "skipped_count" | "skipped_reasons"
  >
> {
  const rows = await deps.fetchDueProfiles();
  let dueChecked = 0;
  let enqueued = 0;
  const enqueueFailedReasons: Record<string, number> = {};
  const skippedReasons: Record<string, number> = {};

  for (const row of rows) {
    dueChecked++;
    const dueCheck = isOwnerDueForPrepare(
      { digestHourLocal: row.digest_hour_local, digestTimezone: row.digest_timezone },
      now,
      { leadMinutes: PREPARE_LEAD_MINUTES, lookaheadMs: PREPARE_LOOKAHEAD_MS },
    );
    if (!dueCheck.due) {
      // `dueCheck.reason` is already a closed union ("timezone_unresolved" |
      // "outside_window") -- already a fixed code, just moved into a tally.
      bumpReason(skippedReasons, dueCheck.reason);
      continue;
    }
    const normalized = digestFeedRequestFromProfile(row);
    if (!normalized.ok || !normalized.request.intent) {
      bumpReason(skippedReasons, "intent_required");
      continue;
    }
    try {
      // P11 fix (due-owners.ts) — dueCheck.batchLocalDate, NEVER
      // dateInTimezone(now, row.digest_timezone), is what gets written here.
      await deps.jobs.enqueue(
        {
          ownerId: row.user_id,
          localDate: dueCheck.batchLocalDate,
          intentVersion: serializeFeedIntent(normalized.request.intent),
          nextAttemptAt: dueCheck.dueAt,
        },
        now,
      );
      enqueued++;
    } catch (err) {
      bumpReason(enqueueFailedReasons, "enqueue_error");
      logJobIssue(
        "jobs/prepare-dashboards",
        row.user_id,
        "enqueue_error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return {
    due_checked: dueChecked,
    enqueued,
    enqueue_failed_count: Object.values(enqueueFailedReasons).reduce((a, b) => a + b, 0),
    enqueue_failed_reasons: enqueueFailedReasons,
    skipped_count: Object.values(skippedReasons).reduce((a, b) => a + b, 0),
    skipped_reasons: skippedReasons,
  };
}

/** Phase 2 (guide §2.1/§2.5, P2) — drain with a per-run ceiling AND a wall-clock guard. See PREPARE_DRAIN_MAX_JOBS_PER_RUN's own doc comment above for why this loops `drainPrepareQueue` at maxJobs:1 rather than modifying its signature. */
async function runDrainPhase(
  deps: PrepareCycleDeps,
): Promise<Pick<PrepareCyclePhaseReport, "drained" | "outcomes" | "stopped_reason" | "backlog_likely_remaining">> {
  const outcomes: PrepareJobOutcome[] = [];
  let stoppedReason: "queue_empty" | "max_jobs_reached" | "wall_clock_budget_reached" = "max_jobs_reached";

  for (let i = 0; i < deps.maxJobsPerRun; i++) {
    if (deps.elapsedMs() >= deps.wallClockBudgetMs) {
      stoppedReason = "wall_clock_budget_reached";
      break;
    }
    const claimed = await drainPrepareQueue(
      {
        now: deps.now,
        jobs: deps.jobs,
        ledger: deps.ledger,
        buildPool: deps.buildPool,
        readCurrentIntentVersion: deps.readCurrentIntentVersion,
        leaseOwner: deps.leaseOwner,
      },
      { leaseDurationMs: deps.leaseDurationMs, maxJobs: 1 },
    );
    if (claimed.length === 0) {
      stoppedReason = "queue_empty";
      break;
    }
    outcomes.push(...claimed);
  }

  const tally: Record<string, number> = {};
  for (const outcome of outcomes) {
    tally[outcome.kind] = (tally[outcome.kind] ?? 0) + 1;
  }

  return {
    drained: outcomes.length,
    outcomes: tally,
    stopped_reason: stoppedReason,
    // "A reports the backlog left after each run" (P2) — a truthful signal
    // (queue observed non-empty at the point this run stopped claiming),
    // not a separate DB count query: the existing repository contract
    // (prepare-job-repository.ts) has no non-mutating "how many are due"
    // method, and adding one would touch an already-VERIFIED interface for
    // a reporting-only convenience. See the C checkpoint for this reasoning.
    backlog_likely_remaining: stoppedReason !== "queue_empty",
  };
}

/** Phase 3 (guide §2.9, user decision #5) — digest email retry. Structural no-op while nothing in the app can set digest_channel to email/both (§1x correction) -- named plainly in the docs (guide step 6). */
async function runEmailRetryPhase(
  deps: PrepareCycleDeps,
  now: Date,
): Promise<
  Pick<PrepareCyclePhaseReport, "candidates_checked" | "sent_count" | "failed_count" | "failed_reasons" | "skipped_count" | "skipped_reasons">
> {
  const rawCandidates = await deps.fetchEmailRetryCandidates();
  let sentCount = 0;
  const failedReasons: Record<string, number> = {};
  const skippedReasons: Record<string, number> = {};
  let checked = 0;

  for (const row of rawCandidates) {
    checked++;
    if (!isEmailRetryEligible(row.attemptedAt, now)) {
      bumpReason(skippedReasons, "outside_retry_window");
      continue;
    }
    try {
      const idempotencyKey = digestIdempotencyKey(row.userId, row.localDate);
      const outcome = await handleConflictingEmailClaim({
        admin: deps.admin,
        userId: row.userId,
        localDate: row.localDate,
        idempotencyKey,
        now,
      });
      if (outcome.kind === "sent") {
        sentCount += 1;
      } else if (outcome.kind === "failed") {
        // EMAIL-TOKEN-PRIVACY: same treatment as dispatch-digests/route.ts's
        // own retry branch -- `outcome.error` can carry Resend's raw text.
        const code = classifySendFailure({ error: outcome.error });
        bumpReason(failedReasons, code);
        logJobIssue("jobs/prepare-dashboards", row.userId, code, outcome.error);
      } else {
        bumpReason(skippedReasons, conflictSkipReasonCode(outcome.reason));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bumpReason(failedReasons, "retry_error");
      logJobIssue("jobs/prepare-dashboards", row.userId, "retry_error", message);
    }
  }

  return {
    candidates_checked: checked,
    sent_count: sentCount,
    failed_count: Object.values(failedReasons).reduce((a, b) => a + b, 0),
    failed_reasons: failedReasons,
    skipped_count: Object.values(skippedReasons).reduce((a, b) => a + b, 0),
    skipped_reasons: skippedReasons,
  };
}

/**
 * The orchestration (guide §2.1): three independently try/caught phases in
 * one JSON body. A phase's failure never prevents another phase from
 * running in the SAME invocation (guide §3 item 8) -- the coarse-grained
 * half of "a failed prepare doesn't block the email step" is the two-job
 * GitHub Actions design (P9, .github/workflows/digest-cron.yml); this is
 * the fine-grained half, inside one endpoint.
 */
export async function runDashboardPrepareCycle(deps: PrepareCycleDeps, now: Date): Promise<PrepareCycleReport> {
  const report: PrepareCycleReport = {
    ran_at: now.toISOString(),
    prepare: { enabled: false },
    email_retry: { enabled: false },
  };

  if (!dashboardPrepareEnabled()) {
    report.prepare = { enabled: false, reason: "flag_off" };
  } else if (!dashboardLedgerEnabled()) {
    // P4 (BINDING) -- truthful no-op, never a silent skip: a batch minted
    // while the ledger flag is off is never read by a real visit
    // (runLedgerAwareFeed's own first line), so 100% of the spend would be
    // wasted.
    report.prepare = { enabled: false, reason: "ledger_disabled" };
  } else {
    report.prepare.enabled = true;
    try {
      const enqueueResult = await runDueSelectionAndEnqueue(deps, now);
      Object.assign(report.prepare, enqueueResult);
    } catch (err) {
      report.prepare.error = err instanceof Error ? err.message : String(err);
    }
    try {
      const drainResult = await runDrainPhase(deps);
      Object.assign(report.prepare, drainResult);
    } catch (err) {
      report.prepare.drain_error = err instanceof Error ? err.message : String(err);
    }
  }

  if (!digestEmailRetryEnabled()) {
    report.email_retry = { enabled: false, reason: "flag_off" };
  } else if (!isDigestDedupeEnabled()) {
    // No payload.email records exist to retry when the dedupe claim path
    // (dispatch-digests/route.ts) is off -- see this route's own module
    // header and docs/JEV-RELEASE-READINESS.md's flag inventory.
    report.email_retry = { enabled: false, reason: "dedupe_disabled" };
  } else {
    try {
      const retryResult = await runEmailRetryPhase(deps, now);
      report.email_retry = { enabled: true, ...retryResult };
    } catch (err) {
      report.email_retry = { enabled: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return report;
}

export async function GET(req: NextRequest) {
  // Auth: identical shape to dispatch-digests/route.ts -- the check is the
  // FIRST thing this handler does, before any Supabase call, so a bad or
  // missing secret has zero side effects.
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const hasSecret = Boolean(secret && authHeader === `Bearer ${secret}`);
  if (!hasSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Guide §3 item 13 — an unconfigured environment (no
  // NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY; the local-dev shape)
  // must not 500. createAdminClient() itself throws in that shape (see
  // web/src/lib/supabase/admin.ts) — unlike SupabaseDashboardPrepareJobRepository/
  // SupabaseDashboardDeliveryLedger, which check the same env vars
  // themselves and degrade to an internal Memory fallback rather than
  // throwing. This route needs a raw admin client for due-selection/
  // buildPool/email-retry (no repository abstraction wraps those reads), so
  // the whole deps-construction-and-run is wrapped here: a regression pin
  // on NOT bypassing the existing fallback (this route degrades honestly
  // too), not new fallback logic of its own.
  try {
    const admin = createAdminClient();
    const startedAtMs = Date.now();
    const leaseOwner = `prepare-dashboards:${randomUUID()}`;

    const deps: PrepareCycleDeps = {
      now: () => now,
      elapsedMs: () => Date.now() - startedAtMs,
      fetchDueProfiles: () => fetchDueProfilesReal(admin),
      readCurrentIntentVersion: (ownerId) => readCurrentIntentVersionReal(admin, ownerId),
      jobs: new SupabaseDashboardPrepareJobRepository(),
      ledger: new SupabaseDashboardDeliveryLedger(),
      buildPool: createPrepareAheadBuildPool({ admin, now: () => now }),
      leaseOwner,
      leaseDurationMs: PREPARE_LEASE_DURATION_MS,
      maxJobsPerRun: PREPARE_DRAIN_MAX_JOBS_PER_RUN,
      wallClockBudgetMs: PREPARE_DRAIN_WALL_CLOCK_BUDGET_MS,
      fetchEmailRetryCandidates: () => fetchEmailRetryCandidatesReal(admin),
      admin,
    };

    const report = await runDashboardPrepareCycle(deps, now);
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const report: PrepareCycleReport = {
      ran_at: now.toISOString(),
      prepare: { enabled: false, reason: "admin_unavailable", error: message },
      email_retry: { enabled: false, reason: "admin_unavailable", error: message },
    };
    return NextResponse.json(report);
  }
}
