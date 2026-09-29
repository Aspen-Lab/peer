import { describe, expect, it, vi } from "vitest";
import {
  MemoryDashboardPrepareJobRepository,
  SupabaseDashboardPrepareJobRepository,
  isClaimable,
  type DashboardPrepareJobRepository,
} from "./prepare-job-repository";

const OWNER = "owner-1";
const DATE = "2026-09-24";

function enqueueParams(overrides: Partial<Parameters<DashboardPrepareJobRepository["enqueue"]>[0]> = {}) {
  return {
    ownerId: OWNER,
    localDate: DATE,
    intentVersion: "intent-v1",
    // Due strictly BEFORE the 12:00:00.000Z clock most tests below use for
    // `now`, so a bare `enqueueParams()` + `claim(..., now)` is immediately
    // claimable by default; tests that specifically need a NOT-yet-due job
    // override this explicitly.
    nextAttemptAt: new Date("2026-09-24T11:00:00.000Z"),
    ...overrides,
  };
}

describe("isClaimable — pure predicate", () => {
  const now = new Date("2026-09-24T13:00:00.000Z");

  it("a pending job due at or before now is claimable", () => {
    expect(isClaimable({ status: "pending", nextAttemptAt: "2026-09-24T13:00:00.000Z" }, now)).toBe(true);
    expect(isClaimable({ status: "pending", nextAttemptAt: "2026-09-24T12:59:59.999Z" }, now)).toBe(true);
  });

  it("a pending job due in the future is not claimable", () => {
    expect(isClaimable({ status: "pending", nextAttemptAt: "2026-09-24T13:00:00.001Z" }, now)).toBe(false);
  });

  it("a leased job with an expired lease is claimable (crash recovery)", () => {
    expect(
      isClaimable({ status: "leased", nextAttemptAt: "2026-09-24T10:00:00.000Z", leaseExpiresAt: "2026-09-24T12:59:59.999Z" }, now),
    ).toBe(true);
  });

  it("a leased job with a live lease is not claimable", () => {
    expect(
      isClaimable({ status: "leased", nextAttemptAt: "2026-09-24T10:00:00.000Z", leaseExpiresAt: "2026-09-24T13:00:00.001Z" }, now),
    ).toBe(false);
  });

  it("a leased job with no leaseExpiresAt at all is not claimable", () => {
    expect(isClaimable({ status: "leased", nextAttemptAt: "2026-09-24T10:00:00.000Z", leaseExpiresAt: undefined }, now)).toBe(false);
  });

  it("done/failed/dead jobs are never claimable", () => {
    for (const status of ["done", "failed", "dead"] as const) {
      expect(isClaimable({ status, nextAttemptAt: "2020-01-01T00:00:00.000Z" }, now)).toBe(false);
    }
  });
});

function runRepositoryContract(makeRepo: () => DashboardPrepareJobRepository, label: string) {
  describe(`${label} — enqueue (debounced upsert)`, () => {
    it("creates a fresh pending job when none exists", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      const job = await repo.enqueue(enqueueParams(), now);
      expect(job.status).toBe("pending");
      expect(job.attempts).toBe(0);
      expect(job.intentVersion).toBe("intent-v1");
      expect(job.ownerId).toBe(OWNER);
      expect(job.localDate).toBe(DATE);
    });

    it("a second enqueue for the same owner+date refreshes intentVersion/nextAttemptAt without creating a second job", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      const first = await repo.enqueue(enqueueParams({ intentVersion: "intent-A" }), now);
      const second = await repo.enqueue(
        enqueueParams({ intentVersion: "intent-B", nextAttemptAt: new Date("2026-09-24T14:00:00.000Z") }),
        now,
      );
      expect(second.id).toBe(first.id); // same row, not a duplicate
      expect(second.intentVersion).toBe("intent-B"); // newest wins — the debounce
      expect(second.nextAttemptAt).toBe("2026-09-24T14:00:00.000Z");
      const stored = await repo.getByOwnerDate(OWNER, DATE);
      expect(stored?.intentVersion).toBe("intent-B");
    });

    it("debouncing a still-PENDING job leaves attempts/status untouched", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams(), now);
      const updated = await repo.enqueue(enqueueParams({ intentVersion: "intent-v2" }), now);
      expect(updated.status).toBe("pending");
      expect(updated.attempts).toBe(0);
    });

    it("debouncing a currently-LEASED job leaves the lease/attempts/status untouched (only refreshes intent/due-time for its NEXT attempt)", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      const created = await repo.enqueue(enqueueParams(), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      expect(claimed?.id).toBe(created.id);

      const debounced = await repo.enqueue(enqueueParams({ intentVersion: "intent-newer" }), now);
      expect(debounced.status).toBe("leased");
      expect(debounced.leaseOwner).toBe("worker-A");
      expect(debounced.attempts).toBe(1); // unchanged by the debounce
      expect(debounced.intentVersion).toBe("intent-newer"); // still refreshed
    });

    it("revives a DONE job to pending with attempts reset to 0 and lastError cleared", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      const created = await repo.enqueue(enqueueParams(), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      await repo.complete(claimed!.id, "worker-A", undefined, now);

      const revived = await repo.enqueue(enqueueParams({ intentVersion: "intent-fresh" }), now);
      expect(revived.id).toBe(created.id);
      expect(revived.status).toBe("pending");
      expect(revived.attempts).toBe(0);
      expect(revived.lastError).toBeUndefined();
      expect(revived.intentVersion).toBe("intent-fresh");
    });

    it("revives a DEAD job (exhausted attempts) to pending with a fresh attempt budget", async () => {
      const repo = makeRepo();
      let now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams({ maxAttempts: 1 }), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      const failed = await repo.fail(claimed!.id, "worker-A", "boom", new Date(now.getTime() + 1000), now);
      expect(failed?.status).toBe("dead");

      now = new Date(now.getTime() + 2000);
      const revived = await repo.enqueue(enqueueParams({ intentVersion: "intent-fresh", maxAttempts: 5 }), now);
      expect(revived.status).toBe("pending");
      expect(revived.attempts).toBe(0);
      expect(revived.maxAttempts).toBe(5);
    });
  });

  describe(`${label} — claim (lease, crash recovery, duplicate-enqueue coalescing)`, () => {
    it("returns null when nothing is due", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams({ nextAttemptAt: new Date("2026-09-24T13:00:00.000Z") }), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      expect(claimed).toBeNull();
    });

    it("claims a due job and increments attempts", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams(), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      expect(claimed?.status).toBe("leased");
      expect(claimed?.leaseOwner).toBe("worker-A");
      expect(claimed?.attempts).toBe(1);
      expect(claimed?.leaseExpiresAt).toBe(new Date(now.getTime() + 60_000).toISOString());
    });

    it("claims the EARLIEST-due job first among several due jobs", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams({ localDate: "2026-09-25", nextAttemptAt: new Date("2026-09-24T11:00:00.000Z") }), now);
      const earlier = await repo.enqueue(
        enqueueParams({ localDate: "2026-09-26", nextAttemptAt: new Date("2026-09-24T09:00:00.000Z") }),
        now,
      );
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      expect(claimed?.id).toBe(earlier.id);
    });

    it("TWO WORKERS: a second claim while the first worker's lease is still live gets nothing (only one worker holds the row)", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams(), now);
      const first = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      const second = await repo.claim({ leaseOwner: "worker-B", leaseDurationMs: 60_000 }, new Date(now.getTime() + 1000));
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it("CRASH RECOVERY: a second worker reclaims the row once the first worker's lease has expired, with a fake clock", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams(), now);
      const first = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      expect(first?.attempts).toBe(1);
      // worker-A "crashes" here — never calls complete/fail.

      const stillLive = await repo.claim({ leaseOwner: "worker-B", leaseDurationMs: 60_000 }, new Date(now.getTime() + 59_000));
      expect(stillLive).toBeNull(); // lease not expired yet

      const reclaimed = await repo.claim({ leaseOwner: "worker-B", leaseDurationMs: 60_000 }, new Date(now.getTime() + 61_000));
      expect(reclaimed).not.toBeNull();
      expect(reclaimed?.leaseOwner).toBe("worker-B");
      expect(reclaimed?.attempts).toBe(2); // incremented again on reclaim
    });

    it("DUPLICATE ENQUEUE COALESCING: two enqueue calls before any claim still produce exactly one claimable row", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams({ intentVersion: "intent-A" }), now);
      await repo.enqueue(enqueueParams({ intentVersion: "intent-B" }), now);
      const first = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      const second = await repo.claim({ leaseOwner: "worker-B", leaseDurationMs: 60_000 }, now);
      expect(first?.intentVersion).toBe("intent-B"); // the coalesced, newest value
      expect(second).toBeNull(); // no second row was ever created
    });
  });

  describe(`${label} — heartbeat`, () => {
    it("extends a currently-held lease and returns true", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams(), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      const extended = new Date(now.getTime() + 30_000);
      const ok = await repo.heartbeat(claimed!.id, "worker-A", 120_000, extended);
      expect(ok).toBe(true);
      const job = await repo.getById(claimed!.id);
      expect(job?.leaseExpiresAt).toBe(new Date(extended.getTime() + 120_000).toISOString());
    });

    it("returns false for the wrong leaseOwner", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams(), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      const ok = await repo.heartbeat(claimed!.id, "worker-B", 120_000, now);
      expect(ok).toBe(false);
    });

    it("returns false for a job that is not currently leased", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      const created = await repo.enqueue(enqueueParams(), now);
      const ok = await repo.heartbeat(created.id, "worker-A", 120_000, now);
      expect(ok).toBe(false);
    });
  });

  describe(`${label} — complete / fail (terminal transitions, fenced by lease ownership)`, () => {
    it("complete transitions leased -> done and clears the lease", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams(), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      const done = await repo.complete(claimed!.id, "worker-A", undefined, now);
      expect(done?.status).toBe("done");
      expect(done?.leaseOwner).toBeUndefined();
      expect(done?.lastError).toBeUndefined();
    });

    it("complete records a discard reason (e.g. stale-intent) without treating it as a failure", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams(), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      const done = await repo.complete(claimed!.id, "worker-A", "intent_changed", now);
      expect(done?.status).toBe("done");
      expect(done?.lastError).toBe("intent_changed");
    });

    it("complete is fenced: a caller that doesn't hold the current lease gets null and the job is untouched", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams(), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      const result = await repo.complete(claimed!.id, "worker-B", undefined, now);
      expect(result).toBeNull();
      const job = await repo.getById(claimed!.id);
      expect(job?.status).toBe("leased");
      expect(job?.leaseOwner).toBe("worker-A");
    });

    it("a worker whose lease already expired and was reclaimed by another worker cannot complete/fail the job out from under the new holder", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams(), now);
      await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now); // worker-A "crashes"
      const reclaimTime = new Date(now.getTime() + 61_000);
      const reclaimed = await repo.claim({ leaseOwner: "worker-B", leaseDurationMs: 60_000 }, reclaimTime);
      expect(reclaimed).not.toBeNull();

      // worker-A finally wakes up and tries to complete its stale claim.
      const stale = await repo.complete(reclaimed!.id, "worker-A", undefined, reclaimTime);
      expect(stale).toBeNull();
      const job = await repo.getById(reclaimed!.id);
      expect(job?.leaseOwner).toBe("worker-B"); // worker-B's hold is untouched
    });

    it("fail with attempts below maxAttempts returns to pending with the given backoff instant", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams({ maxAttempts: 5 }), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      expect(claimed?.attempts).toBe(1);
      const nextAt = new Date(now.getTime() + 5 * 60_000);
      const failed = await repo.fail(claimed!.id, "worker-A", "network error", nextAt, now);
      expect(failed?.status).toBe("pending");
      expect(failed?.nextAttemptAt).toBe(nextAt.toISOString());
      expect(failed?.lastError).toBe("network error");
      expect(failed?.leaseOwner).toBeUndefined();
    });

    it("fail with attempts >= maxAttempts goes to dead and leaves nextAttemptAt unchanged", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams({ maxAttempts: 1, nextAttemptAt: new Date("2026-09-24T11:00:00.000Z") }), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      expect(claimed?.attempts).toBe(1);
      const failed = await repo.fail(claimed!.id, "worker-A", "fatal", new Date(now.getTime() + 60_000), now);
      expect(failed?.status).toBe("dead");
      expect(failed?.nextAttemptAt).toBe("2026-09-24T11:00:00.000Z"); // unchanged
    });

    it("a dead job is never claimable again", async () => {
      const repo = makeRepo();
      const now = new Date("2026-09-24T12:00:00.000Z");
      await repo.enqueue(enqueueParams({ maxAttempts: 1 }), now);
      const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
      await repo.fail(claimed!.id, "worker-A", "fatal", now, now);
      const reclaim = await repo.claim({ leaseOwner: "worker-B", leaseDurationMs: 60_000 }, new Date(now.getTime() + 999_999_999));
      expect(reclaim).toBeNull();
    });
  });

  describe(`${label} — getById / getByOwnerDate`, () => {
    it("return null for an id/owner+date that doesn't exist", async () => {
      const repo = makeRepo();
      expect(await repo.getById("nope")).toBeNull();
      expect(await repo.getByOwnerDate("nobody", "2020-01-01")).toBeNull();
    });
  });
}

runRepositoryContract(() => new MemoryDashboardPrepareJobRepository(), "MemoryDashboardPrepareJobRepository");

// ── SupabaseDashboardPrepareJobRepository — same contract, driven through a
// fake client whose rpc()/from() implementations apply the IDENTICAL
// semantics the migration's five SQL functions specify (upsert-with-debounce,
// window-then-lease claim ordered by next_attempt_at, lease-fenced
// complete/fail) — see 20260924000600_dashboard_prepare_jobs.sql. This is
// not a real Postgres (DB atomicity proof stays BLOCKED, §1k) but it does
// prove the adapter calls the right function with the right arguments and
// maps rows correctly in both directions.
interface FakeRow {
  id: string;
  owner_id: string;
  local_date: string;
  intent_version: string;
  status: "pending" | "leased" | "done" | "failed" | "dead";
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function makeFakeSupabaseClient() {
  const rows = new Map<string, FakeRow>();
  let nextId = 1;
  let forcedError: string | null = null;

  function findByOwnerDate(ownerId: string, localDate: string): FakeRow | undefined {
    for (const row of rows.values()) {
      if (row.owner_id === ownerId && row.local_date === localDate) return row;
    }
    return undefined;
  }

  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (forcedError) {
      const err = forcedError;
      forcedError = null;
      return { data: null, error: err };
    }
    if (fn === "enqueue_prepare_job") {
      const a = args as { p_owner_id: string; p_local_date: string; p_intent_version: string; p_next_attempt_at: string; p_max_attempts: number };
      const existing = findByOwnerDate(a.p_owner_id, a.p_local_date);
      const now = new Date().toISOString();
      if (existing) {
        const revive = existing.status === "done" || existing.status === "failed" || existing.status === "dead";
        existing.intent_version = a.p_intent_version;
        existing.next_attempt_at = a.p_next_attempt_at;
        existing.max_attempts = a.p_max_attempts;
        existing.updated_at = now;
        if (revive) {
          existing.status = "pending";
          existing.attempts = 0;
          existing.last_error = null;
          existing.lease_owner = null;
          existing.lease_expires_at = null;
        }
        return { data: existing, error: null };
      }
      const row: FakeRow = {
        id: `fake-${nextId++}`,
        owner_id: a.p_owner_id,
        local_date: a.p_local_date,
        intent_version: a.p_intent_version,
        status: "pending",
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        attempts: 0,
        max_attempts: a.p_max_attempts,
        next_attempt_at: a.p_next_attempt_at,
        last_error: null,
        created_at: now,
        updated_at: now,
      };
      rows.set(row.id, row);
      return { data: row, error: null };
    }
    if (fn === "claim_prepare_job") {
      const a = args as { p_lease_owner: string; p_lease_seconds: number; p_now: string };
      const nowMs = Date.parse(a.p_now);
      const claimable = [...rows.values()]
        .filter(
          (r) =>
            (r.status === "pending" && Date.parse(r.next_attempt_at) <= nowMs) ||
            (r.status === "leased" && r.lease_expires_at !== null && Date.parse(r.lease_expires_at) < nowMs),
        )
        .sort((x, y) => Date.parse(x.next_attempt_at) - Date.parse(y.next_attempt_at));
      const row = claimable[0];
      if (!row) return { data: null, error: null };
      row.status = "leased";
      row.lease_owner = a.p_lease_owner;
      row.lease_expires_at = new Date(nowMs + a.p_lease_seconds * 1000).toISOString();
      row.heartbeat_at = a.p_now;
      row.attempts += 1;
      row.updated_at = a.p_now;
      return { data: row, error: null };
    }
    if (fn === "heartbeat_prepare_job") {
      const a = args as { p_id: string; p_lease_owner: string; p_lease_seconds: number; p_now: string };
      const row = rows.get(a.p_id);
      if (!row || row.lease_owner !== a.p_lease_owner || row.status !== "leased") return { data: false, error: null };
      row.lease_expires_at = new Date(Date.parse(a.p_now) + a.p_lease_seconds * 1000).toISOString();
      row.heartbeat_at = a.p_now;
      row.updated_at = a.p_now;
      return { data: true, error: null };
    }
    if (fn === "complete_prepare_job") {
      const a = args as { p_id: string; p_lease_owner: string; p_last_error: string | null; p_now: string };
      const row = rows.get(a.p_id);
      if (!row || row.lease_owner !== a.p_lease_owner || row.status !== "leased") return { data: null, error: null };
      row.status = "done";
      row.last_error = a.p_last_error;
      row.lease_owner = null;
      row.lease_expires_at = null;
      row.updated_at = a.p_now;
      return { data: row, error: null };
    }
    if (fn === "fail_prepare_job") {
      const a = args as { p_id: string; p_lease_owner: string; p_error: string; p_next_attempt_at: string; p_now: string };
      const row = rows.get(a.p_id);
      if (!row || row.lease_owner !== a.p_lease_owner || row.status !== "leased") return { data: null, error: null };
      row.last_error = a.p_error;
      row.lease_owner = null;
      row.lease_expires_at = null;
      row.updated_at = a.p_now;
      if (row.attempts >= row.max_attempts) {
        row.status = "dead";
      } else {
        row.status = "pending";
        row.next_attempt_at = a.p_next_attempt_at;
      }
      return { data: row, error: null };
    }
    throw new Error(`makeFakeSupabaseClient: unexpected rpc "${fn}"`);
  });

  const from = vi.fn((table: string) => {
    if (table !== "dashboard_prepare_jobs") throw new Error(`unexpected table "${table}"`);
    return {
      select: () => {
        const filters: Array<[string, string]> = [];
        const builder = {
          eq(column: string, value: string) {
            filters.push([column, value]);
            return builder;
          },
          async maybeSingle() {
            if (forcedError) {
              const err = forcedError;
              forcedError = null;
              return { data: null, error: err };
            }
            const match = [...rows.values()].find((r) => filters.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v));
            return { data: match ?? null, error: null };
          },
        };
        return builder;
      },
    };
  });

  return {
    client: { from, rpc },
    forceNextError: (message: string) => {
      forcedError = message;
    },
    rowCount: () => rows.size,
  };
}

describe("SupabaseDashboardPrepareJobRepository — against a fake client applying the migration's semantics", () => {
  runRepositoryContract(() => {
    const { client } = makeFakeSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new SupabaseDashboardPrepareJobRepository(client as any);
  }, "SupabaseDashboardPrepareJobRepository(fake client)");

  it("calls enqueue_prepare_job with the exact snake_case args and maps the row back to camelCase", async () => {
    const { client } = makeFakeSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new SupabaseDashboardPrepareJobRepository(client as any);
    const job = await repo.enqueue(enqueueParams({ maxAttempts: 3 }), new Date("2026-09-24T12:00:00.000Z"));
    expect(client.rpc).toHaveBeenCalledWith("enqueue_prepare_job", {
      p_owner_id: OWNER,
      p_local_date: DATE,
      p_intent_version: "intent-v1",
      p_next_attempt_at: "2026-09-24T11:00:00.000Z",
      p_max_attempts: 3,
    });
    expect(job.ownerId).toBe(OWNER);
    expect(job.maxAttempts).toBe(3);
  });

  it("throws on a write RPC error (enqueue) rather than returning a success-shaped fallback", async () => {
    const { client, forceNextError } = makeFakeSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new SupabaseDashboardPrepareJobRepository(client as any);
    forceNextError("connection reset");
    await expect(repo.enqueue(enqueueParams(), new Date())).rejects.toThrow(/enqueue_prepare_job RPC failed/);
  });

  it("throws on a write RPC error (claim) rather than silently returning null (which would look like an honest empty queue)", async () => {
    const { client, forceNextError } = makeFakeSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new SupabaseDashboardPrepareJobRepository(client as any);
    await repo.enqueue(enqueueParams(), new Date("2026-09-24T12:00:00.000Z"));
    forceNextError("timeout");
    await expect(repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, new Date("2026-09-24T12:00:00.000Z"))).rejects.toThrow(
      /claim_prepare_job RPC failed/,
    );
  });

  it("getById/getByOwnerDate fail OPEN to null on a configured-client read error (never throw)", async () => {
    const { client, forceNextError } = makeFakeSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new SupabaseDashboardPrepareJobRepository(client as any);
    forceNextError("read boom");
    const result = await repo.getById("whatever");
    expect(result).toBeNull();
  });

  it("an unconfigured repository (client = null) degrades to the Memory fallback rather than throwing", async () => {
    const repo = new SupabaseDashboardPrepareJobRepository(null);
    const now = new Date("2026-09-24T12:00:00.000Z");
    const job = await repo.enqueue(enqueueParams(), now);
    expect(job.status).toBe("pending");
    const claimed = await repo.claim({ leaseOwner: "worker-A", leaseDurationMs: 60_000 }, now);
    expect(claimed?.id).toBe(job.id);
  });
});
