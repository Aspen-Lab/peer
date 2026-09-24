// Durable prepare-job queue repository (P4-S8b, Round 3) — offline slice,
// acceptance 13/14, ABC-JEV-INTEGRATION.md §3c "Queue" paragraph / §1p.C.
// FOUNDATION ONLY: nothing in this campaign wires a route, page, or
// vercel.json cron entry to any of this — who/what triggers a worker to
// claim rows is USER decision #3 (docs/jev-abc/
// P4-S8-B-20260924T115008Z.md POLICY E4/E5). See prepare-worker.ts's header
// for the worker that actually processes a claimed job, and
// 20260924000600_dashboard_prepare_jobs.sql for the schema/atomic-function
// contract this module's Supabase implementation calls.
//
// Same Memory/Supabase double convention as delivery-ledger.ts (see that
// file's header for the full rationale) — `MemoryDashboardPrepareJobRepository`
// is the reference state-machine implementation (exported, not confined to
// a test file, for the same reason delivery-ledger's Memory double is: it
// IS the contract, and a future caller's own tests should reuse it rather
// than hand-roll a second copy). `SupabaseDashboardPrepareJobRepository`
// calls the migration's five SQL functions and degrades to an internal
// Memory fallback when unconfigured, mirroring
// SupabaseDashboardDeliveryLedger exactly.
//
// **Two failure rules, on purpose (same split as delivery-ledger.ts /
// counters.ts):**
//  - READS (getById/getByOwnerDate) degrade to `null` on a configured-client
//    failure — a lookup miss is always a safe default for a queue (worst
//    case: a caller thinks no job exists yet and enqueues a fresh one; the
//    unique constraint then arbitrates, never a duplicate).
//  - WRITES (enqueue/claim/heartbeat/complete/fail) THROW on a
//    configured-client failure rather than returning a success-shaped
//    fallback. A write that silently looked like it succeeded is exactly
//    the dangerous case delivery-ledger.ts's own header warns about — most
//    of all for `claim`, where a silently-swallowed failure that still
//    returned "no job claimed" would be indistinguishable from an honest
//    empty queue, and one that returned a fabricated job would let two
//    workers believe they both hold the same lease. prepare-worker.ts's own
//    `runPrepareJob` wraps every call in a try/catch specifically so this
//    repository is free to throw here without that becoming an unhandled
//    rejection in production.
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type PrepareJobStatus = "pending" | "leased" | "done" | "failed" | "dead";

export interface DashboardPrepareJob {
  readonly id: string;
  readonly ownerId: string;
  readonly localDate: string;
  readonly intentVersion: string;
  readonly status: PrepareJobStatus;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: string;
  readonly heartbeatAt?: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: string;
  readonly lastError?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EnqueuePrepareJobParams {
  ownerId: string;
  localDate: string;
  intentVersion: string;
  nextAttemptAt: Date;
  /** PROPOSED default (5) applied by the implementation when omitted — see the migration's own header. */
  maxAttempts?: number;
}

export interface ClaimPrepareJobParams {
  /** Opaque worker-instance id. Required on every claim/heartbeat/complete/fail call — see the module header's fencing rule. */
  leaseOwner: string;
  leaseDurationMs: number;
}

/**
 * Pure predicate: is this job claimable RIGHT NOW? Mirrors
 * pipeline.ts's `isEligibleForRetry` shape (a pure now-vs-stored-instant
 * check with no I/O) and is the exact condition both repository
 * implementations' `claim` methods apply — exported so the state-machine
 * logic itself, not just its effect, is independently testable.
 *
 * `leased` with an expired lease is claimable: this IS the crash-recovery
 * path (a worker that died mid-job simply lets its lease expire; the next
 * claim reclaims it — no separate "detect a dead worker" step).
 */
export function isClaimable(
  job: Pick<DashboardPrepareJob, "status" | "nextAttemptAt" | "leaseExpiresAt">,
  now: Date,
): boolean {
  if (job.status === "pending") return Date.parse(job.nextAttemptAt) <= now.getTime();
  if (job.status === "leased") {
    return job.leaseExpiresAt !== undefined && Date.parse(job.leaseExpiresAt) < now.getTime();
  }
  return false;
}

const DEFAULT_MAX_ATTEMPTS = 5;

export interface DashboardPrepareJobRepository {
  /**
   * Idempotent debounced upsert on (ownerId, localDate) — §3c "changes
   * debounced with one pending newest-intent job." A pending/leased
   * existing row has its intentVersion/nextAttemptAt/maxAttempts refreshed
   * to this call's values; status/attempts/lease are left untouched. A
   * done/failed/dead existing row is revived to 'pending' with attempts
   * reset to 0 and lastError cleared. See the migration's own
   * `enqueue_prepare_job` comment for the full reasoning — both
   * implementations apply identical semantics.
   */
  enqueue(params: EnqueuePrepareJobParams, now: Date): Promise<DashboardPrepareJob>;
  /** Claims the earliest-due claimable job (see `isClaimable`), or null if none is due. Increments `attempts`. */
  claim(params: ClaimPrepareJobParams, now: Date): Promise<DashboardPrepareJob | null>;
  /** Extends an already-held lease. Returns false (no-op) if `id` isn't currently leased BY `leaseOwner`. */
  heartbeat(id: string, leaseOwner: string, leaseDurationMs: number, now: Date): Promise<boolean>;
  /**
   * Marks the job 'done' — a genuine publish (`lastError` undefined) or a
   * deliberate non-retryable discard (`lastError` a short reason like
   * `"intent_changed"`). Fenced on `leaseOwner`/status='leased': returns
   * null (no-op) if this caller no longer holds the lease (already
   * reclaimed by someone else).
   */
  complete(id: string, leaseOwner: string, lastError: string | undefined, now: Date): Promise<DashboardPrepareJob | null>;
  /**
   * Records a failed attempt. `attempts` is NOT incremented here (claim
   * already did it) — this only decides the next state: 'pending' with
   * `nextAttemptAt` set to the caller-computed backoff instant (see
   * prepare-due.ts), or 'dead' once `attempts >= maxAttempts` (in which
   * case `nextAttemptAt` is left unchanged — a dead job is never claimable
   * again, see `isClaimable`). Fenced identically to `complete`.
   */
  fail(id: string, leaseOwner: string, error: string, nextAttemptAt: Date, now: Date): Promise<DashboardPrepareJob | null>;
  getById(id: string): Promise<DashboardPrepareJob | null>;
  getByOwnerDate(ownerId: string, localDate: string): Promise<DashboardPrepareJob | null>;
}

// ── The in-memory reference implementation ──────────────────────────────

interface MutableJob {
  id: string;
  ownerId: string;
  localDate: string;
  intentVersion: string;
  status: PrepareJobStatus;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  heartbeatAt?: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

function freeze(job: MutableJob): DashboardPrepareJob {
  return {
    id: job.id,
    ownerId: job.ownerId,
    localDate: job.localDate,
    intentVersion: job.intentVersion,
    status: job.status,
    leaseOwner: job.leaseOwner,
    leaseExpiresAt: job.leaseExpiresAt,
    heartbeatAt: job.heartbeatAt,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    nextAttemptAt: job.nextAttemptAt,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

const TERMINAL_STATUSES: readonly PrepareJobStatus[] = ["done", "failed", "dead"];

/**
 * Non-durable reference implementation of the full contract — process
 * memory only, never used in production. See the module header for why
 * this class is exported rather than redefined per test file.
 */
export class MemoryDashboardPrepareJobRepository implements DashboardPrepareJobRepository {
  private readonly jobsById = new Map<string, MutableJob>();
  private readonly idByOwnerDate = new Map<string, string>();

  private ownerDateKey(ownerId: string, localDate: string): string {
    return `${ownerId}\u0000${localDate}`;
  }

  async enqueue(params: EnqueuePrepareJobParams, now: Date): Promise<DashboardPrepareJob> {
    const dateKey = this.ownerDateKey(params.ownerId, params.localDate);
    const existingId = this.idByOwnerDate.get(dateKey);
    const existing = existingId ? this.jobsById.get(existingId) : undefined;
    const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    if (existing) {
      const revive = TERMINAL_STATUSES.includes(existing.status);
      existing.intentVersion = params.intentVersion;
      existing.nextAttemptAt = params.nextAttemptAt.toISOString();
      existing.maxAttempts = maxAttempts;
      existing.updatedAt = now.toISOString();
      if (revive) {
        existing.status = "pending";
        existing.attempts = 0;
        existing.lastError = undefined;
        existing.leaseOwner = undefined;
        existing.leaseExpiresAt = undefined;
      }
      return freeze(existing);
    }

    const job: MutableJob = {
      id: randomUUID(),
      ownerId: params.ownerId,
      localDate: params.localDate,
      intentVersion: params.intentVersion,
      status: "pending",
      attempts: 0,
      maxAttempts,
      nextAttemptAt: params.nextAttemptAt.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.jobsById.set(job.id, job);
    this.idByOwnerDate.set(dateKey, job.id);
    return freeze(job);
  }

  async claim(params: ClaimPrepareJobParams, now: Date): Promise<DashboardPrepareJob | null> {
    let best: MutableJob | undefined;
    for (const job of this.jobsById.values()) {
      if (!isClaimable(job, now)) continue;
      if (!best || Date.parse(job.nextAttemptAt) < Date.parse(best.nextAttemptAt)) {
        best = job;
      }
    }
    if (!best) return null;

    best.status = "leased";
    best.leaseOwner = params.leaseOwner;
    best.leaseExpiresAt = new Date(now.getTime() + params.leaseDurationMs).toISOString();
    best.heartbeatAt = now.toISOString();
    best.attempts += 1;
    best.updatedAt = now.toISOString();
    return freeze(best);
  }

  async heartbeat(id: string, leaseOwner: string, leaseDurationMs: number, now: Date): Promise<boolean> {
    const job = this.jobsById.get(id);
    if (!job || job.leaseOwner !== leaseOwner || job.status !== "leased") return false;
    job.leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
    job.heartbeatAt = now.toISOString();
    job.updatedAt = now.toISOString();
    return true;
  }

  async complete(
    id: string,
    leaseOwner: string,
    lastError: string | undefined,
    now: Date,
  ): Promise<DashboardPrepareJob | null> {
    const job = this.jobsById.get(id);
    if (!job || job.leaseOwner !== leaseOwner || job.status !== "leased") return null;
    job.status = "done";
    job.lastError = lastError;
    job.leaseOwner = undefined;
    job.leaseExpiresAt = undefined;
    job.updatedAt = now.toISOString();
    return freeze(job);
  }

  async fail(
    id: string,
    leaseOwner: string,
    error: string,
    nextAttemptAt: Date,
    now: Date,
  ): Promise<DashboardPrepareJob | null> {
    const job = this.jobsById.get(id);
    if (!job || job.leaseOwner !== leaseOwner || job.status !== "leased") return null;
    job.lastError = error;
    job.leaseOwner = undefined;
    job.leaseExpiresAt = undefined;
    job.updatedAt = now.toISOString();
    if (job.attempts >= job.maxAttempts) {
      job.status = "dead";
      // nextAttemptAt deliberately left unchanged — a dead job is never
      // claimable again regardless of its stored due time (isClaimable
      // only ever checks 'pending'/'leased').
    } else {
      job.status = "pending";
      job.nextAttemptAt = nextAttemptAt.toISOString();
    }
    return freeze(job);
  }

  async getById(id: string): Promise<DashboardPrepareJob | null> {
    const job = this.jobsById.get(id);
    return job ? freeze(job) : null;
  }

  async getByOwnerDate(ownerId: string, localDate: string): Promise<DashboardPrepareJob | null> {
    const id = this.idByOwnerDate.get(this.ownerDateKey(ownerId, localDate));
    const job = id ? this.jobsById.get(id) : undefined;
    return job ? freeze(job) : null;
  }
}

// ── The Supabase implementation ─────────────────────────────────────────

interface PrepareJobRow {
  id: string;
  owner_id: string;
  local_date: string;
  intent_version: string;
  status: PrepareJobStatus;
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

/** Same hand-rolled, narrow-shape convention as delivery-ledger.ts's SelectQuery — see that file's doc comment. */
interface SelectQuery extends PromiseLike<{ data: PrepareJobRow[] | null; error: unknown }> {
  eq(column: string, value: string): SelectQuery;
  maybeSingle(): Promise<{ data: PrepareJobRow | null; error: unknown }>;
}

interface SupabasePrepareJobClient {
  from(table: "dashboard_prepare_jobs"): { select(columns: string): SelectQuery };
  rpc(
    fn: "enqueue_prepare_job",
    args: { p_owner_id: string; p_local_date: string; p_intent_version: string; p_next_attempt_at: string; p_max_attempts: number },
  ): Promise<{ data: PrepareJobRow | null; error: unknown }>;
  rpc(
    fn: "claim_prepare_job",
    args: { p_lease_owner: string; p_lease_seconds: number; p_now: string },
  ): Promise<{ data: PrepareJobRow | null; error: unknown }>;
  rpc(
    fn: "heartbeat_prepare_job",
    args: { p_id: string; p_lease_owner: string; p_lease_seconds: number; p_now: string },
  ): Promise<{ data: boolean | null; error: unknown }>;
  rpc(
    fn: "complete_prepare_job",
    args: { p_id: string; p_lease_owner: string; p_last_error: string | null; p_now: string },
  ): Promise<{ data: PrepareJobRow | null; error: unknown }>;
  rpc(
    fn: "fail_prepare_job",
    args: { p_id: string; p_lease_owner: string; p_error: string; p_next_attempt_at: string; p_now: string },
  ): Promise<{ data: PrepareJobRow | null; error: unknown }>;
}

function configuredPrepareJobClient(): SupabasePrepareJobClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    return createAdminClient() as unknown as SupabasePrepareJobClient;
  } catch {
    return null;
  }
}

function rowToJob(row: PrepareJobRow): DashboardPrepareJob {
  return {
    id: row.id,
    ownerId: row.owner_id,
    localDate: row.local_date,
    intentVersion: row.intent_version,
    status: row.status,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    heartbeatAt: row.heartbeat_at ?? undefined,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Server-only adapter calling 20260924000600_dashboard_prepare_jobs.sql's
 * five functions. See the module header for the unconfigured-degrade
 * fallback and the read/write failure asymmetry.
 */
export class SupabaseDashboardPrepareJobRepository implements DashboardPrepareJobRepository {
  private readonly client: SupabasePrepareJobClient | null;
  // Only ever consulted when `client` is null (unconfigured) — same
  // "reuse, don't re-implement the state machine" precedent as
  // SupabaseDashboardDeliveryLedger.fallback.
  private readonly fallback = new MemoryDashboardPrepareJobRepository();

  constructor(client: SupabasePrepareJobClient | null = configuredPrepareJobClient()) {
    this.client = client;
  }

  async enqueue(params: EnqueuePrepareJobParams, now: Date): Promise<DashboardPrepareJob> {
    if (!this.client) return this.fallback.enqueue(params, now);
    const { data, error } = await this.client.rpc("enqueue_prepare_job", {
      p_owner_id: params.ownerId,
      p_local_date: params.localDate,
      p_intent_version: params.intentVersion,
      p_next_attempt_at: params.nextAttemptAt.toISOString(),
      p_max_attempts: params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    });
    if (error || !data) {
      throw new Error(`enqueue_prepare_job RPC failed for owner ${params.ownerId}/${params.localDate}: ${String(error)}`);
    }
    return rowToJob(data);
  }

  async claim(params: ClaimPrepareJobParams, now: Date): Promise<DashboardPrepareJob | null> {
    if (!this.client) return this.fallback.claim(params, now);
    const { data, error } = await this.client.rpc("claim_prepare_job", {
      p_lease_owner: params.leaseOwner,
      p_lease_seconds: Math.max(1, Math.round(params.leaseDurationMs / 1000)),
      p_now: now.toISOString(),
    });
    if (error) {
      throw new Error(`claim_prepare_job RPC failed for lease owner ${params.leaseOwner}: ${String(error)}`);
    }
    return data ? rowToJob(data) : null; // null/no data is an honest "nothing claimable" — not a failure
  }

  async heartbeat(id: string, leaseOwner: string, leaseDurationMs: number, now: Date): Promise<boolean> {
    if (!this.client) return this.fallback.heartbeat(id, leaseOwner, leaseDurationMs, now);
    const { data, error } = await this.client.rpc("heartbeat_prepare_job", {
      p_id: id,
      p_lease_owner: leaseOwner,
      p_lease_seconds: Math.max(1, Math.round(leaseDurationMs / 1000)),
      p_now: now.toISOString(),
    });
    if (error) {
      throw new Error(`heartbeat_prepare_job RPC failed for job ${id}: ${String(error)}`);
    }
    return data === true;
  }

  async complete(
    id: string,
    leaseOwner: string,
    lastError: string | undefined,
    now: Date,
  ): Promise<DashboardPrepareJob | null> {
    if (!this.client) return this.fallback.complete(id, leaseOwner, lastError, now);
    const { data, error } = await this.client.rpc("complete_prepare_job", {
      p_id: id,
      p_lease_owner: leaseOwner,
      p_last_error: lastError ?? null,
      p_now: now.toISOString(),
    });
    if (error) {
      throw new Error(`complete_prepare_job RPC failed for job ${id}: ${String(error)}`);
    }
    return data ? rowToJob(data) : null; // null = lease already lost to another worker, not a throw-worthy failure
  }

  async fail(
    id: string,
    leaseOwner: string,
    error: string,
    nextAttemptAt: Date,
    now: Date,
  ): Promise<DashboardPrepareJob | null> {
    if (!this.client) return this.fallback.fail(id, leaseOwner, error, nextAttemptAt, now);
    const { data, error: rpcError } = await this.client.rpc("fail_prepare_job", {
      p_id: id,
      p_lease_owner: leaseOwner,
      p_error: error,
      p_next_attempt_at: nextAttemptAt.toISOString(),
      p_now: now.toISOString(),
    });
    if (rpcError) {
      throw new Error(`fail_prepare_job RPC failed for job ${id}: ${String(rpcError)}`);
    }
    return data ? rowToJob(data) : null;
  }

  async getById(id: string): Promise<DashboardPrepareJob | null> {
    if (!this.client) return this.fallback.getById(id);
    try {
      const { data, error } = await this.client
        .from("dashboard_prepare_jobs")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      return rowToJob(data);
    } catch {
      return null;
    }
  }

  async getByOwnerDate(ownerId: string, localDate: string): Promise<DashboardPrepareJob | null> {
    if (!this.client) return this.fallback.getByOwnerDate(ownerId, localDate);
    try {
      const { data, error } = await this.client
        .from("dashboard_prepare_jobs")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("local_date", localDate)
        .maybeSingle();
      if (error || !data) return null;
      return rowToJob(data);
    } catch {
      return null;
    }
  }
}
