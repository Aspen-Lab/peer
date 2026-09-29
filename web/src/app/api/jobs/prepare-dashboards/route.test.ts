import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ProfileRow } from "@/app/api/jobs/dispatch-digests/route";
import { digestFeedRequestFromProfile, digestIdempotencyKey } from "@/app/api/jobs/dispatch-digests/route";
import { serializeFeedIntent } from "@/lib/feed/intent";
import {
  MemoryDashboardDeliveryLedger,
  type DashboardDeliveryLedger,
  type PaperIdentity,
} from "@/lib/dashboard/delivery-ledger";
import { MemoryDashboardPrepareJobRepository } from "@/lib/dashboard/prepare-job-repository";
import type { PrepareBuildOutcome } from "@/lib/dashboard/prepare-worker";
import {
  GET,
  runDashboardPrepareCycle,
  type PrepareCycleDeps,
  type RawEmailRetryCandidate,
} from "./route";

// TRIGGER-A (ABC-JEV-INTEGRATION.md §1x; guide docs/jev-abc/
// TRIGGER-A-B-20260925T044825Z.md §3, renumbered/adapted per the §1x
// rulings — see docs/jev-abc/TRIGGER-A-C-*.md for the mapping). Mirrors
// web/src/lib/dashboard/prepare-worker.test.ts's DI-based testing style for
// the orchestration-level tests (`runDashboardPrepareCycle` called
// directly, no live Next request or real Supabase), and
// web/src/app/api/jobs/dispatch-digests/idempotency.test.ts's `vi.hoisted`
// mock + `chain()` helper conventions for the email-retry / GET-level tests.
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  sendDigestEmail: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/email/send-digest", () => ({ sendDigestEmail: mocks.sendDigestEmail }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const OWNER = "owner-1";
const SAMPLE_PAPERS: PaperIdentity[] = [{ key: "doi:10.1/a", aliases: [] }];

function baseRow(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    user_id: OWNER,
    display_name: null,
    research_topics: ["battery materials"],
    preferred_methods: [],
    current_project: null,
    current_challenges: null,
    disliked_topics: [],
    preference_ledger: null,
    feed_focus: null,
    feed_freshness: null,
    paper_count: 10,
    feed_source_mix: null,
    feed_importance: null,
    feed_method_mode: null,
    feed_discovery_mode: null,
    feed_avoid_reviews: null,
    feed_avoid_old_papers: null,
    feed_avoid_broad_surveys: null,
    digest_enabled: true,
    digest_hour_local: 8,
    digest_timezone: "UTC",
    digest_channel: "inapp",
    digest_frequency: "daily",
    digest_email: null,
    ...overrides,
  };
}

/** What phase 1 computes and stamps as `intent_version` for a given row -- used to build a `readCurrentIntentVersion` fake that reports "nothing changed" so runPrepareJob's fencing check (prepare-worker.ts) passes fresh in a test, instead of the honest "intent_unreadable" retry it correctly returns when a fake reports undefined. */
function intentVersionFor(row: ProfileRow): string {
  const normalized = digestFeedRequestFromProfile(row);
  if (!normalized.ok || !normalized.request.intent) throw new Error("test fixture row has no usable intent");
  return serializeFeedIntent(normalized.request.intent);
}

type LedgerMocks = { [K in keyof DashboardDeliveryLedger]: ReturnType<typeof vi.fn> };

/** Full spy-wrapped ledger (mirrors prepare-worker.test.ts's own makeSpyLedger) so "never calls markServed/acknowledgeBatch" is a real runtime assertion, not just a type-level one. */
function makeSpyLedger(overrides: Partial<LedgerMocks> = {}): DashboardDeliveryLedger & LedgerMocks {
  return {
    listDelivered: vi.fn(async () => new Set<string>()),
    listServedUnacknowledged: vi.fn(async () => new Set<string>()),
    listServedBatchDates: vi.fn(async () => []),
    getBatch: vi.fn(async () => null),
    prepareBatch: vi.fn(
      async (ownerId: string, localDate: string, papers: readonly PaperIdentity[], intentVersion?: string) => ({
        id: `batch-${ownerId}-${localDate}`,
        ownerId,
        localDate,
        papers,
        status: "prepared" as const,
        intentVersion,
        createdAt: new Date().toISOString(),
      }),
    ),
    markServed: vi.fn(async () => undefined),
    acknowledgeBatch: vi.fn(async () => "acknowledged" as const),
    readExclusions: vi.fn(async () => ({ status: "ok" as const, keys: new Set<string>() })),
    ...overrides,
  } as DashboardDeliveryLedger & LedgerMocks;
}

function makeDeps(overrides: Partial<PrepareCycleDeps> = {}): PrepareCycleDeps {
  return {
    now: () => new Date("2026-09-24T13:00:00.000Z"),
    elapsedMs: () => 0,
    fetchDueProfiles: vi.fn(async () => []),
    readCurrentIntentVersion: vi.fn(async () => undefined),
    jobs: new MemoryDashboardPrepareJobRepository(),
    ledger: makeSpyLedger(),
    buildPool: vi.fn(async (): Promise<PrepareBuildOutcome> => ({ ok: true, papers: SAMPLE_PAPERS })),
    leaseOwner: "worker-A",
    leaseDurationMs: 60_000,
    maxJobsPerRun: 10,
    wallClockBudgetMs: 200_000,
    fetchEmailRetryCandidates: vi.fn(async () => []),
    admin: {} as PrepareCycleDeps["admin"],
    ...overrides,
  };
}

function enableCycle() {
  vi.stubEnv("PEER_DASHBOARD_PREPARE", "on");
  vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
}

// ── 1. Auth, no side effects ────────────────────────────────────────────
describe("GET /api/jobs/prepare-dashboards — auth", () => {
  it("missing/wrong CRON_SECRET -> 401, and createAdminClient is never called (zero side effects)", async () => {
    vi.stubEnv("CRON_SECRET", "real-secret");
    const request = new NextRequest("http://localhost/api/jobs/prepare-dashboards");
    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("a present-but-wrong Authorization header also 401s with zero side effects", async () => {
    vi.stubEnv("CRON_SECRET", "real-secret");
    const request = new NextRequest("http://localhost/api/jobs/prepare-dashboards", {
      headers: { authorization: "Bearer wrong" },
    });
    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

// ── 13. Unconfigured environment doesn't crash ──────────────────────────
describe("GET /api/jobs/prepare-dashboards — unconfigured environment", () => {
  it("createAdminClient throwing (no Supabase env vars, local-dev shape) still returns 200 with an honest degraded report, never a 500", async () => {
    vi.stubEnv("CRON_SECRET", "real-secret");
    mocks.createAdminClient.mockImplementationOnce(() => {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL env var");
    });
    const request = new NextRequest("http://localhost/api/jobs/prepare-dashboards", {
      headers: { authorization: "Bearer real-secret" },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.prepare).toMatchObject({ enabled: false, reason: "admin_unavailable" });
    expect(body.email_retry).toMatchObject({ enabled: false, reason: "admin_unavailable" });
  });
});

// ── 2. Flag off -> no-op ─────────────────────────────────────────────────
describe("runDashboardPrepareCycle — flag gating", () => {
  it("PEER_DASHBOARD_PREPARE unset -> phase 1/2 make zero repository/ledger calls", async () => {
    const deps = makeDeps();
    const report = await runDashboardPrepareCycle(deps, deps.now());
    expect(report.prepare).toEqual({ enabled: false, reason: "flag_off" });
    expect(deps.fetchDueProfiles).not.toHaveBeenCalled();
    expect((deps.ledger as DashboardDeliveryLedger & LedgerMocks).prepareBatch).not.toHaveBeenCalled();
  });

  it.each(["true", "1", "TRUE ", "yes"])("PEER_DASHBOARD_PREPARE=%s (anything but exactly 'on') -> still flag_off", async (value) => {
    vi.stubEnv("PEER_DASHBOARD_PREPARE", value);
    const deps = makeDeps();
    const report = await runDashboardPrepareCycle(deps, deps.now());
    expect(report.prepare).toEqual({ enabled: false, reason: "flag_off" });
  });

  it("PEER_DIGEST_EMAIL_RETRY unset -> phase 3 makes zero calls, independently of phase 1/2's own gate", async () => {
    enableCycle();
    const deps = makeDeps();
    const report = await runDashboardPrepareCycle(deps, deps.now());
    expect(report.email_retry).toEqual({ enabled: false, reason: "flag_off" });
    expect(deps.fetchEmailRetryCandidates).not.toHaveBeenCalled();
  });

  // 3. PEER_DASHBOARD_PREPARE=on but PEER_DASHBOARD_LEDGER off -> P4
  it("PEER_DASHBOARD_PREPARE=on but PEER_DASHBOARD_LEDGER off -> truthful ledger_disabled no-op, zero enqueue/drain calls", async () => {
    vi.stubEnv("PEER_DASHBOARD_PREPARE", "on");
    // PEER_DASHBOARD_LEDGER deliberately left unset.
    const deps = makeDeps();
    const report = await runDashboardPrepareCycle(deps, deps.now());
    expect(report.prepare).toEqual({ enabled: false, reason: "ledger_disabled" });
    expect(deps.fetchDueProfiles).not.toHaveBeenCalled();
  });

  it("PEER_DIGEST_EMAIL_RETRY=on but PEER_DIGEST_DEDUPE off -> dedupe_disabled no-op", async () => {
    vi.stubEnv("PEER_DIGEST_EMAIL_RETRY", "on");
    const deps = makeDeps();
    const report = await runDashboardPrepareCycle(deps, deps.now());
    expect(report.email_retry).toEqual({ enabled: false, reason: "dedupe_disabled" });
    expect(deps.fetchEmailRetryCandidates).not.toHaveBeenCalled();
  });
});

// ── 4. A prepared batch is never counted as pushed ──────────────────────
describe("runDashboardPrepareCycle — prepared batches stay prepared", () => {
  it("a real due+claimable job runs end to end (due-select -> enqueue -> drain -> runPrepareJob) and only ever calls prepareBatch, never markServed/acknowledgeBatch", async () => {
    enableCycle();
    vi.stubEnv("TZ", "UTC");
    const now = new Date("2026-09-24T13:00:00.000Z"); // well after 08:00 UTC checkin - 90min lead
    // A REAL, stateful ledger, spy-wrapped -- not the stateless mock double
    // (makeSpyLedger) prepare-worker.test.ts uses for single-outcome unit
    // tests. This test needs getBatch to actually reflect what prepareBatch
    // wrote, so "the resulting batch's status stays 'prepared'" is a real
    // read-back, not an assumption about the double's own canned return.
    const ledger = new MemoryDashboardDeliveryLedger();
    const prepareBatchSpy = vi.spyOn(ledger, "prepareBatch");
    const markServedSpy = vi.spyOn(ledger, "markServed");
    const acknowledgeBatchSpy = vi.spyOn(ledger, "acknowledgeBatch");
    const deps = makeDeps({
      now: () => now,
      fetchDueProfiles: vi.fn(async () => [baseRow()]),
      readCurrentIntentVersion: vi.fn(async () => intentVersionFor(baseRow())),
      ledger,
    });

    const report = await runDashboardPrepareCycle(deps, now);

    expect(report.prepare.enqueued).toBe(1);
    expect(report.prepare.drained).toBe(1);
    expect(report.prepare.outcomes).toEqual({ prepared: 1 });
    expect(prepareBatchSpy).toHaveBeenCalledTimes(1);
    expect(prepareBatchSpy).toHaveBeenCalledWith(OWNER, "2026-09-24", SAMPLE_PAPERS, expect.any(String), undefined);
    expect(markServedSpy).not.toHaveBeenCalled();
    expect(acknowledgeBatchSpy).not.toHaveBeenCalled();

    const batch = await deps.jobs.getByOwnerDate(OWNER, "2026-09-24");
    expect(batch?.status).toBe("done");
    const stored = await ledger.getBatch(OWNER, "2026-09-24");
    expect(stored?.status).toBe("prepared");
  });
});

// ── 5. Two overlapping "runs" don't double-prepare ──────────────────────
describe("runDashboardPrepareCycle — overlapping runs", () => {
  it("two sequential calls sharing one durable job repository + ledger produce exactly one prepareBatch call total", async () => {
    enableCycle();
    vi.stubEnv("TZ", "UTC");
    const now = new Date("2026-09-24T13:00:00.000Z");
    const jobs = new MemoryDashboardPrepareJobRepository();
    // Real, stateful, spy-wrapped ledger -- see the item-4 test above for
    // why the stateless mock double doesn't work for a multi-run test.
    const ledger = new MemoryDashboardDeliveryLedger();
    const prepareBatchSpy = vi.spyOn(ledger, "prepareBatch");
    const deps = makeDeps({
      now: () => now,
      fetchDueProfiles: vi.fn(async () => [baseRow()]),
      readCurrentIntentVersion: vi.fn(async () => intentVersionFor(baseRow())),
      jobs,
      ledger,
    });

    const firstReport = await runDashboardPrepareCycle(deps, now);
    const secondReport = await runDashboardPrepareCycle(deps, now);

    expect(firstReport.prepare.outcomes).toEqual({ prepared: 1 });
    // Simulating a second GH job run: the debounced upsert revives the
    // (now 'done') row to 'pending' (prepare-job-repository.ts's own
    // documented enqueue_prepare_job semantics), so the second run's drain
    // DOES re-claim it -- but runPrepareJob's own already-prepared
    // short-circuit (it finds the batch prepareBatch already wrote, via the
    // REAL ledger's own getBatch this time) means no second build/
    // prepareBatch call ever happens. This is the actual mechanism guide §3
    // item 5 protects, expressed precisely rather than via the "claim
    // returns null" framing that only applies to a row that was never
    // revived.
    expect(secondReport.prepare.outcomes).toEqual({ "already-prepared": 1 });
    expect(prepareBatchSpy).toHaveBeenCalledTimes(1);
  });
});

// ── DST-edge wiring (guide item 6 is proven at the pure due-owners.ts
// level in due-owners.test.ts; this pins that THIS route wires
// PREPARE_LEAD_MINUTES/PREPARE_LOOKAHEAD_MS/batchLocalDate through
// correctly end to end) ──────────────────────────────────────────────────
describe("runDashboardPrepareCycle — DST-edge wiring", () => {
  it("a America/Chicago spring-forward row is enqueued under the correct P11-aligned local_date and due instant", async () => {
    enableCycle();
    vi.stubEnv("TZ", "UTC");
    // Pre-transition (the jump itself is at 08:00Z) but already >= 06:00Z,
    // so dateInTimezone(now, "America/Chicago") resolves unambiguously to
    // "2026-03-08" (00:05 CST local) -- AND before dueAt (06:30Z), so
    // phase 2's drain (which runs automatically right after phase 1, in the
    // same cycle) finds this job not yet claimable and leaves the value
    // this test checks untouched, isolating phase 1's own computation from
    // phase 2's.
    const now = new Date("2026-03-08T06:05:00.000Z");
    const jobs = new MemoryDashboardPrepareJobRepository();
    const deps = makeDeps({
      now: () => now,
      fetchDueProfiles: vi.fn(async () => [baseRow({ digest_hour_local: 3, digest_timezone: "America/Chicago" })]),
      jobs,
      readCurrentIntentVersion: vi.fn(async () => undefined),
    });

    const report = await runDashboardPrepareCycle(deps, now);
    expect(report.prepare.enqueued).toBe(1);
    expect(report.prepare.drained).toBe(0); // not yet claimable -- proves this pin isolates phase 1 only

    const job = await jobs.getByOwnerDate(OWNER, "2026-03-08");
    expect(job).not.toBeNull();
    expect(job?.nextAttemptAt).toBe("2026-03-08T06:30:00.000Z");
  });
});

// ── 7 + P2. Per-run ceiling and wall-clock guard ─────────────────────────
describe("runDashboardPrepareCycle — drain ceiling and wall-clock guard (P2)", () => {
  async function seedClaimableJobs(jobs: MemoryDashboardPrepareJobRepository, count: number, now: Date) {
    for (let i = 0; i < count; i++) {
      await jobs.enqueue(
        {
          ownerId: `owner-${i}`,
          localDate: "2026-09-24",
          intentVersion: "v1",
          nextAttemptAt: new Date(now.getTime() - 1000),
        },
        now,
      );
    }
  }

  it("claims at most maxJobsPerRun in one call; the remainder stay pending for the next call", async () => {
    const now = new Date("2026-09-24T13:00:00.000Z");
    const jobs = new MemoryDashboardPrepareJobRepository();
    await seedClaimableJobs(jobs, 15, now);
    enableCycle();
    const deps = makeDeps({ now: () => now, jobs, maxJobsPerRun: 10 });

    const first = await runDashboardPrepareCycle(deps, now);
    expect(first.prepare.drained).toBe(10);
    expect(first.prepare.stopped_reason).toBe("max_jobs_reached");
    expect(first.prepare.backlog_likely_remaining).toBe(true);

    const second = await runDashboardPrepareCycle(deps, now);
    expect(second.prepare.drained).toBe(5);
    expect(second.prepare.stopped_reason).toBe("queue_empty");
    expect(second.prepare.backlog_likely_remaining).toBe(false);
  });

  it("stops claiming new jobs once the wall-clock budget is exceeded, before reaching maxJobsPerRun", async () => {
    const now = new Date("2026-09-24T13:00:00.000Z");
    const jobs = new MemoryDashboardPrepareJobRepository();
    await seedClaimableJobs(jobs, 10, now);
    enableCycle();
    let elapsedCalls = 0;
    const deps = makeDeps({
      now: () => now,
      jobs,
      maxJobsPerRun: 10,
      wallClockBudgetMs: 200_000,
      elapsedMs: () => {
        elapsedCalls++;
        return elapsedCalls <= 2 ? 0 : 999_999; // exceeds budget starting the 3rd check
      },
    });

    const report = await runDashboardPrepareCycle(deps, now);
    expect(report.prepare.drained).toBe(2);
    expect(report.prepare.stopped_reason).toBe("wall_clock_budget_reached");
    expect(report.prepare.backlog_likely_remaining).toBe(true);
  });
});

// ── 8. A failed prepare doesn't block the email step ─────────────────────
describe("runDashboardPrepareCycle — phase independence", () => {
  it("phase 1 (due-select) throwing does not prevent phase 2 (drain) or phase 3 (email retry) from running and reporting their own counts", async () => {
    enableCycle();
    vi.stubEnv("PEER_DIGEST_EMAIL_RETRY", "on");
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const deps = makeDeps({
      fetchDueProfiles: vi.fn(async () => {
        throw new Error("profiles table unreachable");
      }),
      fetchEmailRetryCandidates: vi.fn(async () => []),
    });

    const report = await runDashboardPrepareCycle(deps, deps.now());
    expect(report.prepare.error).toContain("profiles table unreachable");
    expect(report.prepare.drained).toBe(0); // phase 2 still ran (empty queue), not skipped
    // EMAIL-TOKEN-PRIVACY (§1as): counts/tallies replace the old
    // sent/failed/skipped arrays — see this file's header comment.
    expect(report.email_retry).toEqual({
      enabled: true,
      candidates_checked: 0,
      sent_count: 0,
      failed_count: 0,
      failed_reasons: {},
      skipped_count: 0,
      skipped_reasons: {},
    });
  });

  it("phase 2 (drain) throwing does not prevent phase 3 (email retry) from running", async () => {
    enableCycle();
    vi.stubEnv("PEER_DIGEST_EMAIL_RETRY", "on");
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const throwingJobs = new MemoryDashboardPrepareJobRepository();
    throwingJobs.claim = vi.fn(async () => {
      throw new Error("lease claim RPC failed");
    });
    const deps = makeDeps({
      jobs: throwingJobs,
      fetchEmailRetryCandidates: vi.fn(async () => []),
    });

    const report = await runDashboardPrepareCycle(deps, deps.now());
    expect(report.prepare.drain_error).toContain("lease claim RPC failed");
    // EMAIL-TOKEN-PRIVACY (§1as): counts/tallies replace the old
    // sent/failed/skipped arrays — see this file's header comment.
    expect(report.email_retry).toEqual({
      enabled: true,
      candidates_checked: 0,
      sent_count: 0,
      failed_count: 0,
      failed_reasons: {},
      skipped_count: 0,
      skipped_reasons: {},
    });
  });
});

// ── 9. A failed email is retried at most within the same local date and
// never sent twice ────────────────────────────────────────────────────────
function chain(result: { data: unknown; error: unknown }) {
  const node = {
    eq: () => node,
    limit: () => node,
    then: (onFulfilled: (v: typeof result) => unknown, onRejected?: (r: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return node;
}

function makeEmailAdmin(conflictRow: { id: number; payload: { email?: Record<string, unknown> } } | null) {
  const selectResult = { data: conflictRow ? [conflictRow] : [], error: null };
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) }));
  const from = vi.fn(() => ({
    select: vi.fn(() => chain(selectResult)),
    update,
  }));
  return { from } as unknown as PrepareCycleDeps["admin"];
}

describe("runDashboardPrepareCycle — digest email retry (P10; structural no-op while email stays dormant)", () => {
  function enableRetry() {
    vi.stubEnv("PEER_DIGEST_EMAIL_RETRY", "on");
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
  }

  it("finds an unsent attempt, replays it via handleConflictingEmailClaim with the SAME idempotency key digestIdempotencyKey would produce, and marks it sent", async () => {
    enableRetry();
    const now = new Date("2026-09-24T13:00:00.000Z");
    const attemptedAt = new Date(now.getTime() - 30 * 60_000).toISOString(); // 30 min old
    const candidate: RawEmailRetryCandidate = { userId: "user-1", localDate: "2026-09-24", attemptedAt };
    const admin = makeEmailAdmin({
      id: 42,
      payload: { email: { to: "u@example.com", subject: "S", html: "<p>H</p>", text: "T", attemptedAt } },
    });
    mocks.sendDigestEmail.mockResolvedValueOnce({ sent: true, messageId: "msg-1" });

    const deps = makeDeps({
      now: () => now,
      admin,
      fetchEmailRetryCandidates: vi.fn(async () => [candidate]),
    });

    const report = await runDashboardPrepareCycle(deps, now);

    // EMAIL-TOKEN-PRIVACY (§1as): no per-reader user_id/messageId list in
    // the response — a count only. The stronger, still-precise assertion
    // (this really was user-1's retry, with the right key) is the
    // sendDigestEmail call-args check right below, unchanged.
    expect(report.email_retry.sent_count).toBe(1);
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendDigestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: digestIdempotencyKey("user-1", "2026-09-24") }),
    );
  });

  it("EMAIL-TOKEN-PRIVACY: a provider error naming an address never reaches the JSON response — only a fixed code", async () => {
    enableRetry();
    const now = new Date("2026-09-24T13:00:00.000Z");
    const attemptedAt = new Date(now.getTime() - 30 * 60_000).toISOString();
    const candidate: RawEmailRetryCandidate = { userId: "user-1", localDate: "2026-09-24", attemptedAt };
    const admin = makeEmailAdmin({
      id: 42,
      payload: { email: { to: "owner@example.test", subject: "S", html: "<p>H</p>", text: "T", attemptedAt } },
    });
    mocks.sendDigestEmail.mockResolvedValueOnce({
      sent: false,
      errorCode: "validation_error",
      error: "You can only send testing emails to your own email address (owner@example.test).",
    });

    const deps = makeDeps({ now: () => now, admin, fetchEmailRetryCandidates: vi.fn(async () => [candidate]) });
    const report = await runDashboardPrepareCycle(deps, now);

    expect(report.email_retry.failed_count).toBe(1);
    // digest-retry.ts's ConflictOutcome carries no errorCode, so the retry
    // path's classification always lands on the generic fixed code (never
    // guessed further from message text alone) — see this route's own
    // classifySendFailure({error: outcome.error}) call.
    expect(report.email_retry.failed_reasons).toEqual({ send_failed: 1 });
    expect(JSON.stringify(report)).not.toContain("owner@example.test");
    expect(JSON.stringify(report)).not.toContain("@");
  });

  it("a row already marked sent is skipped, never re-sent (a second hourly pass finding zero live candidates for it)", async () => {
    enableRetry();
    const now = new Date("2026-09-24T14:00:00.000Z");
    const attemptedAt = new Date(now.getTime() - 90 * 60_000).toISOString();
    const candidate: RawEmailRetryCandidate = { userId: "user-1", localDate: "2026-09-24", attemptedAt };
    const admin = makeEmailAdmin({ id: 42, payload: { email: { sent: true, sentAt: attemptedAt } } });

    const deps = makeDeps({ now: () => now, admin, fetchEmailRetryCandidates: vi.fn(async () => [candidate]) });
    const report = await runDashboardPrepareCycle(deps, now);

    // EMAIL-TOKEN-PRIVACY (§1as): a count, not a per-reader user_id list.
    expect(report.email_retry.sent_count).toBe(0);
    // EMAIL-TOKEN-PRIVACY (§1as): digest-retry.ts's own "digest already sent
    // for this local date" reason maps to the fixed code "already_sent"
    // (conflictSkipReasonCode, dispatch-digests/route.ts) before it ever
    // reaches this response.
    expect(report.email_retry.skipped_reasons).toEqual({ already_sent: 1 });
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  it("an attempt older than 23h is excluded at the SELECTION window and never reaches Resend", async () => {
    enableRetry();
    const now = new Date("2026-09-25T13:00:00.000Z");
    const attemptedAt = new Date(now.getTime() - 25 * 60 * 60_000).toISOString(); // 25h old
    const candidate: RawEmailRetryCandidate = { userId: "user-1", localDate: "2026-09-24", attemptedAt };
    const admin = makeEmailAdmin(null);

    const deps = makeDeps({ now: () => now, admin, fetchEmailRetryCandidates: vi.fn(async () => [candidate]) });
    const report = await runDashboardPrepareCycle(deps, now);

    // EMAIL-TOKEN-PRIVACY (§1as): fixed-code tally, not a {user_id,reason} list.
    expect(report.email_retry.skipped_reasons).toEqual({ outside_retry_window: 1 });
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  it("an attempt younger than the 10-minute defense-in-depth floor is excluded, deferred to a later run", async () => {
    enableRetry();
    const now = new Date("2026-09-24T13:00:00.000Z");
    const attemptedAt = new Date(now.getTime() - 2 * 60_000).toISOString(); // 2 min old
    const candidate: RawEmailRetryCandidate = { userId: "user-1", localDate: "2026-09-24", attemptedAt };
    const admin = makeEmailAdmin(null);

    const deps = makeDeps({ now: () => now, admin, fetchEmailRetryCandidates: vi.fn(async () => [candidate]) });
    const report = await runDashboardPrepareCycle(deps, now);

    // EMAIL-TOKEN-PRIVACY (§1as): fixed-code tally, not a {user_id,reason} list.
    expect(report.email_retry.skipped_reasons).toEqual({ outside_retry_window: 1 });
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });
});

// ── 10. Enqueue is idempotent across repeated runs ──────────────────────
describe("runDashboardPrepareCycle — enqueue idempotency", () => {
  it("calling the due-selection phase 3 times in a row for the same owner/date produces exactly one durable job row, refreshed not duplicated", async () => {
    enableCycle();
    vi.stubEnv("TZ", "UTC");
    // now stays BEFORE dueAt this time so the job is never drained/claimed
    // mid-test -- isolates the enqueue-idempotency question from §5's
    // already-prepared short-circuit.
    const now = new Date("2026-09-24T05:00:00.000Z");
    const jobs = new MemoryDashboardPrepareJobRepository();
    const deps = makeDeps({ now: () => now, jobs, fetchDueProfiles: vi.fn(async () => [baseRow()]) });

    await runDashboardPrepareCycle(deps, now);
    const first = await jobs.getByOwnerDate(OWNER, "2026-09-24");
    await runDashboardPrepareCycle(deps, now);
    const second = await jobs.getByOwnerDate(OWNER, "2026-09-24");
    const thirdReport = await runDashboardPrepareCycle(deps, now);
    const third = await jobs.getByOwnerDate(OWNER, "2026-09-24");

    expect(first?.id).toBe(second?.id);
    expect(second?.id).toBe(third?.id);
    expect(thirdReport.prepare.enqueued).toBe(1); // never reported as more than one per run
    expect(third?.status).toBe("pending"); // never claimed, since dueAt > now throughout
  });
});
