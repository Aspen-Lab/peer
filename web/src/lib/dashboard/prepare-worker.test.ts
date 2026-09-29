import { describe, expect, it, vi } from "vitest";
import { MemoryDashboardDeliveryLedger, type DashboardDeliveryLedger, type PaperIdentity } from "./delivery-ledger";
import { MemoryDashboardPrepareJobRepository, type DashboardPrepareJob } from "./prepare-job-repository";
import { drainPrepareQueue, runPrepareJob, type PrepareBuildOutcome, type PrepareWorkerDeps } from "./prepare-worker";

const OWNER = "owner-1";
const DATE = "2026-09-24";
const INTENT_V1 = '{"version":"feed-intent-v1","requiredConcepts":["battery"]}';
const INTENT_V2 = '{"version":"feed-intent-v1","requiredConcepts":["battery","materials"]}';

const SAMPLE_PAPERS: PaperIdentity[] = [{ key: "doi:10.1/a", aliases: [] }];

async function claimedJob(overrides: Partial<DashboardPrepareJob> = {}): Promise<{
  repo: MemoryDashboardPrepareJobRepository;
  job: DashboardPrepareJob;
}> {
  const repo = new MemoryDashboardPrepareJobRepository();
  const now = new Date("2026-09-24T13:00:00.000Z");
  await repo.enqueue(
    {
      ownerId: OWNER,
      localDate: DATE,
      intentVersion: INTENT_V1,
      nextAttemptAt: new Date("2026-09-24T12:00:00.000Z"),
      maxAttempts: overrides.maxAttempts ?? 5,
    },
    now,
  );
  const job = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
  if (!job) throw new Error("test setup: expected a claimable job");
  return { repo, job };
}

/** Every method of DashboardDeliveryLedger, forced to a generic vi.fn() Mock
 * type — lets `overrides` below accept only mock-typed replacements, so the
 * returned object's methods are always real vi.fn() spies regardless of
 * whether a test overrides them. */
type LedgerMocks = { [K in keyof DashboardDeliveryLedger]: ReturnType<typeof vi.fn> };

/** A minimal, spy-based ledger double covering the full interface (so the
 * "never calls markServed/acknowledgeBatch" assertion is meaningful even
 * though PrepareWorkerDeps only TYPES getBatch/prepareBatch as available). */
function makeSpyLedger(overrides: Partial<LedgerMocks> = {}): DashboardDeliveryLedger & LedgerMocks {
  return {
    listDelivered: vi.fn(async () => new Set<string>()),
    listServedUnacknowledged: vi.fn(async () => new Set<string>()),
    getBatch: vi.fn(async () => null),
    prepareBatch: vi.fn(async (ownerId: string, localDate: string, papers: readonly PaperIdentity[], intentVersion?: string) => ({
      id: "batch-1",
      ownerId,
      localDate,
      papers,
      status: "prepared" as const,
      intentVersion,
      createdAt: new Date().toISOString(),
    })),
    markServed: vi.fn(async () => undefined),
    acknowledgeBatch: vi.fn(async () => "acknowledged" as const),
    readExclusions: vi.fn(async () => ({ status: "ok" as const, keys: new Set<string>() })),
    ...overrides,
  } as DashboardDeliveryLedger & LedgerMocks;
}

function makeDeps(overrides: Partial<PrepareWorkerDeps> = {}): PrepareWorkerDeps {
  const repo = new MemoryDashboardPrepareJobRepository();
  return {
    now: () => new Date("2026-09-24T13:00:00.000Z"),
    jobs: repo,
    ledger: makeSpyLedger(),
    buildPool: vi.fn(async (): Promise<PrepareBuildOutcome> => ({ ok: true, papers: SAMPLE_PAPERS })),
    readCurrentIntentVersion: vi.fn(async () => INTENT_V1),
    leaseOwner: "worker-A",
    ...overrides,
  };
}

describe("runPrepareJob — outcomes", () => {
  it("already-prepared: a batch already exists -> completes the job without ever calling buildPool", async () => {
    const { repo, job } = await claimedJob();
    const ledger = makeSpyLedger({
      getBatch: vi.fn(async () => ({
        id: "existing-batch",
        ownerId: OWNER,
        localDate: DATE,
        papers: SAMPLE_PAPERS,
        status: "prepared" as const,
        createdAt: new Date().toISOString(),
      })),
    });
    const buildPool = vi.fn(async (): Promise<PrepareBuildOutcome> => ({ ok: true, papers: SAMPLE_PAPERS }));
    const outcome = await runPrepareJob(job, makeDeps({ jobs: repo, ledger, buildPool }));

    expect(outcome).toEqual({ kind: "already-prepared", batchId: "existing-batch" });
    expect(buildPool).not.toHaveBeenCalled();
    const stored = await repo.getById(job.id);
    expect(stored?.status).toBe("done");
  });

  it("already-prepared: if the completion write itself throws (e.g. a transient Supabase error), the outcome stays the accurate 'already-prepared' — not a false 'failed' — with the bookkeeping failure reported separately (F-A-P4S8b-01)", async () => {
    const { job } = await claimedJob();
    const ledger = makeSpyLedger({
      getBatch: vi.fn(async () => ({
        id: "existing-batch",
        ownerId: OWNER,
        localDate: DATE,
        papers: SAMPLE_PAPERS,
        status: "prepared" as const,
        createdAt: new Date().toISOString(),
      })),
    });
    const buildPool = vi.fn(async (): Promise<PrepareBuildOutcome> => ({ ok: true, papers: SAMPLE_PAPERS }));
    const throwingJobs = {
      enqueue: vi.fn(),
      claim: vi.fn(),
      heartbeat: vi.fn(),
      complete: vi.fn(async () => {
        throw new Error("transient supabase error");
      }),
      fail: vi.fn(),
      getById: vi.fn(async () => null),
      getByOwnerDate: vi.fn(async () => null),
    };
    const outcome = await runPrepareJob(
      job,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeDeps({ jobs: throwingJobs as any, ledger, buildPool }),
    );

    expect(outcome).toEqual({
      kind: "already-prepared",
      batchId: "existing-batch",
      completionError: "transient supabase error",
    });
    expect(buildPool).not.toHaveBeenCalled();
    // The old (buggy) behaviour routed a throwing `complete()` through the
    // shared outer catch into `failJob`, which calls `deps.jobs.fail(...)`.
    // The fixed behaviour must never do that for this branch — a batch
    // already exists, so this was never a real failure.
    expect(throwingJobs.fail).not.toHaveBeenCalled();
  });

  it("prepared: happy path builds, fences successfully, and writes a prepared batch", async () => {
    const { repo, job } = await claimedJob();
    const ledger = makeSpyLedger();
    const readCurrentIntentVersion = vi.fn(async () => INTENT_V1);
    const outcome = await runPrepareJob(job, makeDeps({ jobs: repo, ledger, readCurrentIntentVersion }));

    expect(outcome.kind).toBe("prepared");
    expect(ledger.prepareBatch).toHaveBeenCalledWith(OWNER, DATE, SAMPLE_PAPERS, INTENT_V1, undefined);
    expect(readCurrentIntentVersion).toHaveBeenCalledTimes(1);
    const stored = await repo.getById(job.id);
    expect(stored?.status).toBe("done");
    expect(stored?.lastError).toBeUndefined();
  });

  it("stale-intent: a real 'intent changed mid-flight' fixture — the fresh read differs from the job's captured version, so NOTHING is written", async () => {
    const { repo, job } = await claimedJob();
    const ledger = makeSpyLedger();
    // Simulates the owner changing their intent WHILE this job's buildPool
    // was running: the job was queued under INTENT_V1, but by the time the
    // worker re-checks (right before writing), the owner is on INTENT_V2.
    const readCurrentIntentVersion = vi.fn(async () => INTENT_V2);
    const outcome = await runPrepareJob(job, makeDeps({ jobs: repo, ledger, readCurrentIntentVersion }));

    expect(outcome).toEqual({ kind: "stale-intent" });
    expect(ledger.prepareBatch).not.toHaveBeenCalled();
    const stored = await repo.getById(job.id);
    expect(stored?.status).toBe("done");
    expect(stored?.lastError).toBe("intent_changed");
  });

  it("intent-unreadable: an unreadable current intent is treated as a retryable failure, never a publish", async () => {
    const { repo, job } = await claimedJob();
    const ledger = makeSpyLedger();
    const readCurrentIntentVersion = vi.fn(async () => undefined);
    const outcome = await runPrepareJob(job, makeDeps({ jobs: repo, ledger, readCurrentIntentVersion }));

    expect(outcome).toEqual({ kind: "failed", reason: "intent_unreadable", dead: false });
    expect(ledger.prepareBatch).not.toHaveBeenCalled();
    const stored = await repo.getById(job.id);
    expect(stored?.status).toBe("pending"); // retryable
  });

  it("build failure below maxAttempts: retryable, backoff scheduled, job stays pending", async () => {
    const { repo, job } = await claimedJob({ maxAttempts: 5 });
    const buildPool = vi.fn(async (): Promise<PrepareBuildOutcome> => ({ ok: false, error: "academic source outage" }));
    const outcome = await runPrepareJob(job, makeDeps({ jobs: repo, buildPool }));

    expect(outcome).toEqual({ kind: "failed", reason: "academic source outage", dead: false });
    const stored = await repo.getById(job.id);
    expect(stored?.status).toBe("pending");
    expect(stored?.lastError).toBe("academic source outage");
    expect(Date.parse(stored!.nextAttemptAt)).toBeGreaterThan(Date.parse("2026-09-24T13:00:00.000Z"));
  });

  it("build failure once attempts are exhausted: the job goes dead", async () => {
    const { repo, job } = await claimedJob({ maxAttempts: 1 }); // claim already used the only attempt
    const buildPool = vi.fn(async (): Promise<PrepareBuildOutcome> => ({ ok: false, error: "fatal" }));
    const outcome = await runPrepareJob(job, makeDeps({ jobs: repo, buildPool }));

    expect(outcome).toEqual({ kind: "failed", reason: "fatal", dead: true });
    const stored = await repo.getById(job.id);
    expect(stored?.status).toBe("dead");
  });

  it("never marks served or acknowledged — structural (type) AND runtime (spy) proof, on the happy path", async () => {
    const { repo, job } = await claimedJob();
    const ledger = makeSpyLedger();
    await runPrepareJob(job, makeDeps({ jobs: repo, ledger }));
    expect(ledger.markServed).not.toHaveBeenCalled();
    expect(ledger.acknowledgeBatch).not.toHaveBeenCalled();
  });

  it("never throws even when buildPool rejects — resolves to a typed failed outcome instead", async () => {
    const { repo, job } = await claimedJob();
    const buildPool = vi.fn(async (): Promise<PrepareBuildOutcome> => {
      throw new Error("unexpected pipeline crash");
    });
    await expect(runPrepareJob(job, makeDeps({ jobs: repo, buildPool }))).resolves.toEqual({
      kind: "failed",
      reason: "unexpected pipeline crash",
      dead: false,
    });
  });

  it("never throws even when the job repository's own fail() call also throws", async () => {
    const { job } = await claimedJob();
    const buildPool = vi.fn(async (): Promise<PrepareBuildOutcome> => ({ ok: false, error: "boom" }));
    const throwingJobs = {
      enqueue: vi.fn(),
      claim: vi.fn(),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(async () => {
        throw new Error("repository unreachable");
      }),
      getById: vi.fn(async () => null),
      getByOwnerDate: vi.fn(async () => null),
    };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runPrepareJob(job, makeDeps({ jobs: throwingJobs as any, buildPool })),
    ).resolves.toEqual({ kind: "failed", reason: "boom", dead: false });
  });

  it("invariant guard: if prepareBatch ever returns a non-'prepared' status, the worker fails the job rather than reporting success", async () => {
    const { repo, job } = await claimedJob();
    const ledger = makeSpyLedger({
      prepareBatch: vi.fn(async () => ({
        id: "batch-x",
        ownerId: OWNER,
        localDate: DATE,
        papers: SAMPLE_PAPERS,
        status: "served" as const, // rigged — must never happen from a fresh prepareBatch call
        createdAt: new Date().toISOString(),
      })),
    });
    const outcome = await runPrepareJob(job, makeDeps({ jobs: repo, ledger }));
    expect(outcome.kind).toBe("failed");
    const stored = await repo.getById(job.id);
    expect(stored?.status).toBe("pending"); // routed through the normal retry path, not silently marked done
  });

  it("refuses to run against a job it does not hold the lease for (wrong leaseOwner) and makes no repository/ledger calls", async () => {
    const { repo, job } = await claimedJob(); // leased by "worker-A"
    const ledger = makeSpyLedger();
    const buildPool = vi.fn(async (): Promise<PrepareBuildOutcome> => ({ ok: true, papers: SAMPLE_PAPERS }));
    const outcome = await runPrepareJob(job, makeDeps({ jobs: repo, ledger, buildPool, leaseOwner: "worker-B" }));

    expect(outcome).toEqual({ kind: "not-leased-by-this-worker" });
    expect(buildPool).not.toHaveBeenCalled();
    expect(ledger.getBatch).not.toHaveBeenCalled();
  });

  it("refuses to run against a job that is not currently leased at all (e.g. a stale in-memory reference to an already-completed job)", async () => {
    const { repo, job } = await claimedJob();
    await repo.complete(job.id, "worker-A", undefined, new Date());
    const staleReference = { ...job, status: "done" as const };
    const outcome = await runPrepareJob(staleReference, makeDeps({ jobs: repo, leaseOwner: "worker-A" }));
    expect(outcome).toEqual({ kind: "not-leased-by-this-worker" });
  });
});

describe("runPrepareJob — TWO WORKERS, simulated end to end against the real Memory repository + ledger", () => {
  it("two workers racing the same due job: the second gets nothing to claim once the first has completed it", async () => {
    const repo = new MemoryDashboardPrepareJobRepository();
    const ledger = new MemoryDashboardDeliveryLedger();
    const now = new Date("2026-09-24T13:00:00.000Z");
    await repo.enqueue(
      { ownerId: OWNER, localDate: DATE, intentVersion: INTENT_V1, nextAttemptAt: new Date("2026-09-24T12:00:00.000Z") },
      now,
    );

    const jobA = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
    expect(jobA).not.toBeNull();
    const depsA = makeDeps({ jobs: repo, ledger, leaseOwner: "worker-A" });
    const outcomeA = await runPrepareJob(jobA!, depsA);
    expect(outcomeA.kind).toBe("prepared");

    const jobB = await repo.claim({ leaseOwner: "worker-B", leaseDurationMs: 60_000 }, new Date(now.getTime() + 1000));
    expect(jobB).toBeNull(); // job is 'done' — nothing left to claim

    const batch = await ledger.getBatch(OWNER, DATE);
    expect(batch?.status).toBe("prepared");
  });

  it("crash + reclaim: worker-A claims and never finishes (simulated crash); worker-B reclaims after the lease expires and completes it, producing exactly one batch", async () => {
    const repo = new MemoryDashboardPrepareJobRepository();
    const ledger = new MemoryDashboardDeliveryLedger();
    const now = new Date("2026-09-24T13:00:00.000Z");
    await repo.enqueue(
      { ownerId: OWNER, localDate: DATE, intentVersion: INTENT_V1, nextAttemptAt: new Date("2026-09-24T12:00:00.000Z") },
      now,
    );

    const jobA = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
    expect(jobA?.attempts).toBe(1);
    // worker-A "crashes" here — runPrepareJob is deliberately never called for it.

    const reclaimTime = new Date(now.getTime() + 61_000);
    const jobB = await repo.claim({ leaseOwner: "worker-B", leaseDurationMs: 60_000 }, reclaimTime);
    expect(jobB).not.toBeNull();
    expect(jobB?.attempts).toBe(2);

    const depsB = makeDeps({ jobs: repo, ledger, leaseOwner: "worker-B", now: () => reclaimTime });
    const outcomeB = await runPrepareJob(jobB!, depsB);
    expect(outcomeB.kind).toBe("prepared");

    const stored = await repo.getById(jobB!.id);
    expect(stored?.status).toBe("done");
    const batch = await ledger.getBatch(OWNER, DATE);
    expect(batch).not.toBeNull();
  });
});

describe("drainPrepareQueue", () => {
  it("claims and runs due jobs up to maxJobs, then stops", async () => {
    const repo = new MemoryDashboardPrepareJobRepository();
    const ledger = new MemoryDashboardDeliveryLedger();
    const now = new Date("2026-09-24T13:00:00.000Z");
    for (const localDate of ["2026-09-22", "2026-09-23", "2026-09-24"]) {
      await repo.enqueue(
        { ownerId: OWNER, localDate, intentVersion: INTENT_V1, nextAttemptAt: new Date("2026-09-24T12:00:00.000Z") },
        now,
      );
    }
    const deps = makeDeps({ jobs: repo, ledger, now: () => now });
    const firstBatch = await drainPrepareQueue(deps, { leaseDurationMs: 60_000, maxJobs: 2 });
    expect(firstBatch).toHaveLength(2);
    expect(firstBatch.every((o) => o.kind === "prepared")).toBe(true);

    const secondBatch = await drainPrepareQueue(deps, { leaseDurationMs: 60_000, maxJobs: 2 });
    expect(secondBatch).toHaveLength(1); // only one job left
  });

  it("returns an empty array when nothing is due", async () => {
    const repo = new MemoryDashboardPrepareJobRepository();
    const deps = makeDeps({ jobs: repo });
    const outcomes = await drainPrepareQueue(deps, { leaseDurationMs: 60_000 });
    expect(outcomes).toEqual([]);
  });
});
